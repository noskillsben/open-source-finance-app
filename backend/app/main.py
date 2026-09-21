from datetime import date

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import select, text, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.db import get_session
from app.models import Account, Category, Domain, Payee, Transaction, Valuation
from app.schemas import (
    AccountCreate,
    AccountLineOut,
    AccountOut,
    AccountUpdate,
    ArchiveIn,
    ArchiveOut,
    BalanceCheckIn,
    BalanceCheckOut,
    CategoryCreate,
    CategoryLineOut,
    CategoryAvailableOut,
    CategoryOut,
    CategoryUpdate,
    DebtTerms,
    DomainCreate,
    DomainOut,
    DomainUpdate,
    EarmarkLineOut,
    EarmarkMoveIn,
    Health,
    IntegrityFindingOut,
    PayeeCreate,
    PayeeOut,
    ReadyToAssignOut,
    TransactionCreate,
    TransactionOut,
)
from app.services.accounts import (
    _opening_adjustment_transaction,
    _opening_valuation,
    account_balance_cents,
    account_latest_ledger_date,
    backfill_opening_balance,
    create_account_with_opening_valuation,
    credit_limit_note,
    dollars,
    floor_note,
    update_account,
)
from app.services.archiving import Archivable, ArchiveError, archive, unarchive, visible_as_of
from app.services.categories import (
    CategoryError,
    apply_category_settings,
    build_category_archivable,
    category_balance_cents,
)
from app.services.earmarks import EarmarkError, move_money, overspent_cents, ready_to_assign_cents
from app.services.integrity import find_integrity_issues
from app.services.payees import payee_latest_ledger_date
from app.services.transactions import TransactionError, write_transaction
from app.services.valuations import check_balance, entries_added_since_check, latest_valuation
from app.seed import guard_not_me

app = FastAPI(title="Open Source Finance App", version="0.0.1", docs_url="/docs", openapi_url="/api/openapi.json")


@app.get("/api/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # the health page is the one place a swallowed error is acceptable
        database = f"error: {type(exc).__name__}"
    return Health(status="ok", database=database, app_mode=settings.app_mode)


def _account_out(session: Session, account: Account, *, as_of: date | None = None) -> AccountOut:
    valuation = latest_valuation(session, account.id)
    balance_cents = account_balance_cents(session, account.id, as_of=as_of)
    notes = []
    floor = floor_note(balance_cents, account.on_budget_floor_cents, account.on_budget)
    if floor is not None:
        notes.append(f"{floor}.")
    limit_note = credit_limit_note(balance_cents, account.credit_limit_cents)
    if limit_note is not None:
        notes.append(f"{limit_note}.")
    return AccountOut(
        id=account.id, name=account.name, created_on=account.created_on, archived_on=account.archived_on,
        type=account.type, on_budget=account.on_budget, on_budget_floor_cents=account.on_budget_floor_cents,
        balance_cents=balance_cents,
        checked_on=valuation.date if valuation is not None else None,
        checked_valuation_id=valuation.id if valuation is not None else None,
        entries_added_since_check=(
            entries_added_since_check(session, account.id, valuation) if valuation is not None else 0
        ),
        notes=notes,
        terms=DebtTerms.model_validate(account, from_attributes=True),
    )


def _visible(model, as_of: date | None, include_archived: bool):
    # `include_archived` is the "show archived" toggle: every row that existed by `as_of`,
    # archived or not, so the UI can offer Unarchive. Without it, the effective-date rule applies.
    if not include_archived:
        return visible_as_of(model, as_of)
    return (model.created_on <= as_of) if as_of is not None else true()


@app.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[AccountOut]:
    visible = _visible(Account, as_of, include_archived)
    accounts = session.scalars(select(Account).where(visible).order_by(Account.name)).all()
    return [_account_out(session, a, as_of=as_of) for a in accounts]


def _reject_floor_below_credit_limit(floor_cents: int, credit_limit_cents: int | None) -> None:
    """DESIGN.md § On-budget floor: the floor may not be set below `-credit_limit_cents` where
    that limit is known — you cannot budget with credit the lender has not extended. A settings
    surface, so this one is a block, unlike the credit-limit warnings above.
    """
    if credit_limit_cents is not None and floor_cents < -credit_limit_cents:
        raise HTTPException(
            status_code=400,
            detail=f"The on-budget floor can't be set below the credit limit of -{dollars(credit_limit_cents)}.",
        )


@app.post("/api/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountCreate, session: Session = Depends(get_session)) -> AccountOut:
    _reject_floor_below_credit_limit(payload.on_budget_floor_cents, payload.terms.credit_limit_cents)
    try:
        account = create_account_with_opening_valuation(
            session,
            name=payload.name,
            created_on=payload.created_on,
            type=payload.type,
            on_budget=payload.on_budget,
            on_budget_floor_cents=payload.on_budget_floor_cents,
            opening_balance_cents=payload.opening_balance_cents,
            **payload.terms.model_dump(),
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"An account named {payload.name!r} already exists.")
    return _account_out(session, account)


@app.put("/api/accounts/{account_id}", response_model=AccountOut)
def update_account_route(
    account_id: int, payload: AccountUpdate, session: Session = Depends(get_session)
) -> AccountOut:
    account = session.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    # "terms" wasn't sent means leave the account's existing terms alone — null means unknown,
    # never zero (DESIGN.md § Debt terms), and an edit that omits terms isn't the user saying
    # "I don't know these anymore."
    terms_sent = "terms" in payload.model_fields_set
    terms = payload.terms.model_dump() if terms_sent else {}
    effective_credit_limit_cents = (
        payload.terms.credit_limit_cents if terms_sent else account.credit_limit_cents
    )
    _reject_floor_below_credit_limit(payload.on_budget_floor_cents, effective_credit_limit_cents)
    update_account(
        account,
        name=payload.name,
        type=payload.type,
        on_budget=payload.on_budget,
        on_budget_floor_cents=payload.on_budget_floor_cents,
        **terms,
    )
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"An account named {payload.name!r} already exists.")
    return _account_out(session, account)


@app.post("/api/accounts/{account_id}/balance-check", response_model=BalanceCheckOut)
def balance_check_account(
    account_id: int, payload: BalanceCheckIn, session: Session = Depends(get_session)
) -> BalanceCheckOut:
    """DESIGN.md § Balance checks — one table: state a balance, get the difference and, if
    it's non-zero, an adjustment through the normal write path. Nothing locks.
    """
    account = session.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    if payload.category_id is not None and session.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=400, detail=f"Unknown category id: {payload.category_id}")

    valuation, transaction, diff_cents = check_balance(
        session,
        account_id=account_id,
        check_date=payload.date,
        stated_balance_cents=payload.stated_balance_cents,
        category_id=payload.category_id,
    )
    session.flush()
    return BalanceCheckOut(
        valuation_id=valuation.id,
        diff_cents=diff_cents,
        transaction=_transaction_out(session, transaction) if transaction is not None else None,
        account=_account_out(session, account),
    )


@app.post("/api/accounts/{account_id}/archive", response_model=ArchiveOut)
def archive_account(
    account_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    account = session.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    target = Archivable(
        entity=account,
        latest_ledger_date=account_latest_ledger_date(session, account_id),
        balance_cents=account_balance_cents(session, account_id, as_of=payload.archived_on),
    )
    try:
        warnings = archive(target, payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=account.id, archived_on=account.archived_on, warnings=warnings)


@app.post("/api/accounts/{account_id}/unarchive", response_model=ArchiveOut)
def unarchive_account(account_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    account = session.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    unarchive(account)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(
            status_code=409, detail=f"An account named {account.name!r} already exists."
        )
    return ArchiveOut(id=account.id, archived_on=account.archived_on, warnings=[])


@app.get("/api/categories", response_model=list[CategoryOut])
def list_categories(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[CategoryOut]:
    categories = session.scalars(
        select(Category).where(_visible(Category, as_of, include_archived)).order_by(Category.name)
    ).all()
    return [CategoryOut.model_validate(c) for c in categories]


@app.post("/api/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, session: Session = Depends(get_session)) -> CategoryOut:
    category = Category(created_on=payload.created_on)
    try:
        apply_category_settings(
            session, category, name=payload.name, parent_id=payload.parent_id,
            pool_id=payload.pool_id, domain_id=payload.domain_id, need_level=payload.need_level,
        )
    except CategoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.add(category)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A category named {payload.name!r} already exists.")
    return CategoryOut.model_validate(category)


@app.put("/api/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, payload: CategoryUpdate, session: Session = Depends(get_session)
) -> CategoryOut:
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"No category with id {category_id}.")
    try:
        apply_category_settings(
            session, category, name=payload.name, parent_id=payload.parent_id,
            pool_id=payload.pool_id, domain_id=payload.domain_id, need_level=payload.need_level,
        )
    except CategoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A category named {payload.name!r} already exists.")
    return CategoryOut.model_validate(category)


@app.get("/api/ready-to-assign", response_model=ReadyToAssignOut)
def ready_to_assign(as_of: date, session: Session = Depends(get_session)) -> ReadyToAssignOut:
    """Both headline numbers on `as_of` and each category's available amount. The picker date
    is the only "today", so the caller always says which day.
    """
    return ReadyToAssignOut(
        ready_to_assign_cents=ready_to_assign_cents(session, as_of=as_of),
        overspent_cents=overspent_cents(session, as_of=as_of),
        categories=[
            CategoryAvailableOut(
                category_id=category_id, available_cents=category_balance_cents(session, category_id, as_of=as_of)
            )
            for category_id in session.scalars(select(Category.id).order_by(Category.id))
        ],
    )


@app.post("/api/earmark-moves", response_model=list[EarmarkLineOut], status_code=201)
def create_earmark_move(payload: EarmarkMoveIn, session: Session = Depends(get_session)) -> list[EarmarkLineOut]:
    try:
        lines = move_money(
            session,
            move_date=payload.date,
            from_category_id=payload.from_category_id,
            to_category_id=payload.to_category_id,
            cents=payload.cents,
        )
    except EarmarkError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return [EarmarkLineOut.model_validate(line) for line in lines]


@app.get("/api/domains", response_model=list[DomainOut])
def list_domains(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[DomainOut]:
    domains = session.scalars(
        select(Domain).where(_visible(Domain, as_of, include_archived)).order_by(Domain.name)
    ).all()
    return [DomainOut.model_validate(d) for d in domains]


@app.post("/api/domains", response_model=DomainOut, status_code=201)
def create_domain(payload: DomainCreate, session: Session = Depends(get_session)) -> DomainOut:
    domain = Domain(name=payload.name, description=payload.description, created_on=payload.created_on)
    session.add(domain)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A domain named {payload.name!r} already exists.")
    return DomainOut.model_validate(domain)


@app.put("/api/domains/{domain_id}", response_model=DomainOut)
def update_domain(domain_id: int, payload: DomainUpdate, session: Session = Depends(get_session)) -> DomainOut:
    domain = session.get(Domain, domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"No domain with id {domain_id}.")
    domain.name = payload.name
    domain.description = payload.description
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A domain named {payload.name!r} already exists.")
    return DomainOut.model_validate(domain)


@app.post("/api/domains/{domain_id}/archive", response_model=ArchiveOut)
def archive_domain(
    domain_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    domain = session.get(Domain, domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"No domain with id {domain_id}.")
    # No ledger row points at a domain (it is a reporting label on categories), so there is no
    # date bound and no balance to warn about.
    try:
        warnings = archive(Archivable(entity=domain, latest_ledger_date=None), payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=domain.id, archived_on=domain.archived_on, warnings=warnings)


@app.post("/api/domains/{domain_id}/unarchive", response_model=ArchiveOut)
def unarchive_domain(domain_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    domain = session.get(Domain, domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"No domain with id {domain_id}.")
    name = domain.name  # read before the flush: a failed flush rolls the session back and expires the row
    unarchive(domain)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A domain named {name!r} already exists.")
    return ArchiveOut(id=domain.id, archived_on=domain.archived_on, warnings=[])


@app.post("/api/categories/{category_id}/archive", response_model=ArchiveOut)
def archive_category(
    category_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"No category with id {category_id}.")
    target = build_category_archivable(session, category, as_of=payload.archived_on)
    try:
        warnings = archive(target, payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=category.id, archived_on=category.archived_on, warnings=warnings)


@app.post("/api/categories/{category_id}/unarchive", response_model=ArchiveOut)
def unarchive_category(category_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"No category with id {category_id}.")
    unarchive(category)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(
            status_code=409, detail=f"A category named {category.name!r} already exists."
        )
    return ArchiveOut(id=category.id, archived_on=category.archived_on, warnings=[])


@app.get("/api/payees", response_model=list[PayeeOut])
def list_payees(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[PayeeOut]:
    payees = session.scalars(
        select(Payee).where(_visible(Payee, as_of, include_archived)).order_by(Payee.name)
    ).all()
    return [
        PayeeOut(id=p.id, name=p.name, created_on=p.created_on, archived_on=p.archived_on)
        for p in payees
    ]


@app.post("/api/payees", response_model=PayeeOut, status_code=201)
def create_payee(payload: PayeeCreate, session: Session = Depends(get_session)) -> PayeeOut:
    payee = Payee(name=payload.name, created_on=payload.created_on)
    session.add(payee)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A payee named {payload.name!r} already exists.")
    return PayeeOut(id=payee.id, name=payee.name, created_on=payee.created_on, archived_on=payee.archived_on)


@app.post("/api/payees/{payee_id}/archive", response_model=ArchiveOut)
def archive_payee(
    payee_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    payee = session.get(Payee, payee_id)
    if payee is None:
        raise HTTPException(status_code=404, detail=f"No payee with id {payee_id}.")
    try:
        guard_not_me(payee)
        target = Archivable(entity=payee, latest_ledger_date=payee_latest_ledger_date(session, payee_id))
        warnings = archive(target, payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=payee.id, archived_on=payee.archived_on, warnings=warnings)


@app.post("/api/payees/{payee_id}/unarchive", response_model=ArchiveOut)
def unarchive_payee(payee_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    payee = session.get(Payee, payee_id)
    if payee is None:
        raise HTTPException(status_code=404, detail=f"No payee with id {payee_id}.")
    unarchive(payee)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(
            status_code=409, detail=f"A payee named {payee.name!r} already exists."
        )
    return ArchiveOut(id=payee.id, archived_on=payee.archived_on, warnings=[])


def _transaction_query():
    return select(Transaction).options(
        selectinload(Transaction.account_lines), selectinload(Transaction.category_lines)
    )


def _transaction_notes(session: Session, transaction: Transaction) -> list[str]:
    """Advisory notes for a save: "This predates your <date> check" (DESIGN.md § Balance
    checks) for each account whose latest check is on or after this transaction's date, and a
    credit-limit note (DESIGN.md § Credit limit — the floor of reality) when the balance on
    this transaction's own date, after this save, is past the account's credit limit. The
    check's own adjustment never notes itself. Also one note per archived payee, category or
    account the transaction references when it is dated on or after that entity's
    `archived_on` (DESIGN.md § General concepts) — advisory only, nothing is refused.
    """
    notes = []
    archived = []
    if transaction.payee_id is not None:
        archived.append(session.get(Payee, transaction.payee_id))
    archived.extend(line.category for line in transaction.category_lines)
    archived.extend(line.account for line in transaction.account_lines)
    seen = set()
    for entity in archived:
        key = (type(entity), entity.id)
        if key in seen:
            continue
        seen.add(key)
        if entity.archived_on is not None and transaction.date >= entity.archived_on:
            notes.append(
                f"{entity.name} was archived on {entity.archived_on}; "
                "this transaction is dated after that."
            )
    for line in transaction.account_lines:
        valuation = latest_valuation(session, line.account_id)
        if (
            valuation is not None
            and transaction.date <= valuation.date
            and transaction.valuation_id != valuation.id
        ):
            notes.append(f"This predates your {valuation.date} check on {line.account.name}.")
        balance_cents = account_balance_cents(session, line.account_id, as_of=transaction.date)
        limit_note = credit_limit_note(balance_cents, line.account.credit_limit_cents)
        if limit_note is not None:
            notes.append(f"{limit_note} on {line.account.name}.")
    return notes


def _transaction_shape(t: Transaction, notes: list[str]) -> TransactionOut:
    return TransactionOut(
        id=t.id, date=t.date, memo=t.memo, payee_id=t.payee_id, valuation_id=t.valuation_id,
        account_lines=[
            AccountLineOut(id=l.id, account_id=l.account_id, cents=l.cents, budget_cents=l.budget_cents)
            for l in t.account_lines
        ],
        category_lines=[
            CategoryLineOut(id=l.id, category_id=l.category_id, cents=l.cents, need_level=l.need_level)
            for l in t.category_lines
        ],
        notes=notes,
    )


def _transaction_out(session: Session, t: Transaction) -> TransactionOut:
    return _transaction_shape(t, _transaction_notes(session, t))


@app.get("/api/transactions", response_model=list[TransactionOut])
def list_transactions(session: Session = Depends(get_session)) -> list[TransactionOut]:
    transactions = session.scalars(_transaction_query().order_by(Transaction.date, Transaction.id)).all()
    # Notes belong to the save response and the account page, never the historical list
    # (each one costs per-line queries), so the list carries none.
    return [_transaction_shape(t, []) for t in transactions]


@app.post("/api/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(payload: TransactionCreate, session: Session = Depends(get_session)) -> TransactionOut:
    try:
        transaction = write_transaction(
            session,
            transaction=None,
            txn_date=payload.date,
            memo=payload.memo,
            payee_id=payload.payee_id,
            account_lines=[line.model_dump() for line in payload.account_lines],
            category_lines=[line.model_dump() for line in payload.category_lines],
        )
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return _transaction_out(session, transaction)


@app.put("/api/transactions/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: int, payload: TransactionCreate, session: Session = Depends(get_session)
) -> TransactionOut:
    transaction = session.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status_code=404, detail=f"No transaction with id {transaction_id}.")
    try:
        transaction = write_transaction(
            session,
            transaction=transaction,
            txn_date=payload.date,
            memo=payload.memo,
            payee_id=payload.payee_id,
            account_lines=[line.model_dump() for line in payload.account_lines],
            category_lines=[line.model_dump() for line in payload.category_lines],
        )
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return _transaction_out(session, transaction)


@app.post("/api/transactions/{transaction_id}/re-save", response_model=TransactionOut)
def re_save_transaction(transaction_id: int, session: Session = Depends(get_session)) -> TransactionOut:
    """The integrity check's fix: run a transaction back through the normal write path with
    its own stored lines, so its `budget_cents` reflect current settings (DESIGN.md § General
    concepts → Settings never rewrite history). No separate fix logic — same write as any edit.
    """
    transaction = session.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status_code=404, detail=f"No transaction with id {transaction_id}.")
    account_lines = [{"account_id": l.account_id, "cents": l.cents} for l in transaction.account_lines]
    category_lines = [
        {"category_id": l.category_id, "cents": l.cents, "need_level": l.need_level}
        for l in transaction.category_lines
    ]
    try:
        transaction = write_transaction(
            session,
            transaction=transaction,
            txn_date=transaction.date,
            memo=transaction.memo,
            payee_id=transaction.payee_id,
            account_lines=account_lines,
            category_lines=category_lines,
        )
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return _transaction_out(session, transaction)


@app.delete("/api/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, session: Session = Depends(get_session)) -> None:
    transaction = session.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status_code=404, detail=f"No transaction with id {transaction_id}.")
    if transaction.valuation_id is not None:
        account = transaction.valuation.account
        if transaction is _opening_adjustment_transaction(session, account):
            raise HTTPException(
                status_code=400,
                detail="this is the account's opening-balance adjustment; fix it with a balance check or backfill, not by hand",
            )
    # Undo any backfill this transaction caused: the same unwind the edit path runs, with the
    # new line at 0 cents. Restores the opening amount; created_on and the opening date stay.
    for line in transaction.account_lines:
        backfill_opening_balance(
            session, line.account, transaction.date, 0,
            old_line_cents=line.cents, old_line_netted=line.netted_into_opening,
            exclude_transaction_id=transaction.id,
        )
    session.delete(transaction)
    session.flush()


@app.delete("/api/valuations/{valuation_id}", status_code=204)
def delete_valuation(valuation_id: int, session: Session = Depends(get_session)) -> None:
    """DESIGN.md § Balance checks — "Nothing is locked": a valuation and its adjustment (if
    any) are deleted together, one write. The opening valuation is the one exception — it's
    what makes the account's start date true, and is corrected by backfilling instead.
    """
    valuation = session.get(Valuation, valuation_id)
    if valuation is None:
        raise HTTPException(status_code=404, detail=f"No valuation with id {valuation_id}.")
    account = valuation.account
    if valuation is _opening_valuation(session, account):
        raise HTTPException(
            status_code=400,
            detail="this is the account's opening valuation; fix it by backfilling instead",
        )
    adjustment = session.scalar(select(Transaction).where(Transaction.valuation_id == valuation.id))
    if adjustment is not None:
        session.delete(adjustment)
    session.delete(valuation)
    session.flush()


@app.get("/api/integrity-check", response_model=list[IntegrityFindingOut])
def integrity_check(session: Session = Depends(get_session)) -> list[IntegrityFindingOut]:
    """The app's own integrity check, not a dev-only tool (DESIGN.md § Transactions →
    Invariant): replays every transaction and lists any drift. No fixing here — that's
    `re_save_transaction`, one row at a time.
    """
    return [
        IntegrityFindingOut(
            transaction_id=f.transaction_id, date=f.date, payee_id=f.payee_id,
            kind=f.kind, expected_cents=f.expected_cents, stored_cents=f.stored_cents,
        )
        for f in find_integrity_issues(session)
    ]
