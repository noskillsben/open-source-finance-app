from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Account, Category, Payee, Valuation
from app.routers.shapes import _transaction_out
from app.schemas import (
    AccountBalanceOut,
    AccountCreate,
    AccountOut,
    AccountUpdate,
    ArchiveIn,
    ArchiveOut,
    BalanceCheckIn,
    BalanceCheckOut,
    BalanceCheckPreviewOut,
    CategoryLineIn,
    DebtTerms,
)
from app.services.accounts import (
    AccountError,
    account_balance_cents,
    account_balances,
    account_latest_ledger_date,
    create_account_with_opening_valuation,
    carried_statement_notes,
    credit_limit_note,
    reject_floor_below_credit_limit,
    update_account,
)
from app.services.splits import live_split_block
from app.services.archiving import Archivable, ArchiveError, _visible, archive, unarchive
from app.services.links import (
    LinkError,
    add_category_link,
    check_new_account_link,
    drift_notes,
    linked_category_ids_by_account,
    prune_archived_links,
    suggest_split,
)
from app.services.transactions import TransactionError
from app.services.valuations import (
    check_balance,
    delete_valuation as remove_valuation,
    valuation_picture,
)

router = APIRouter()



def _account_out(session: Session, account: Account, *, as_of: date | None = None) -> AccountOut:
    return _accounts_out(session, [account], as_of=as_of)[0]


def _accounts_out(session: Session, accounts: list[Account], *, as_of: date | None = None) -> list[AccountOut]:
    """One row per account, with every ledger-derived number for the whole list read in a fixed
    number of grouped queries instead of a handful per account. Each number equals the
    single-account function it replaces (`account_balance_cents`, `latest_valuation`,
    `entries_added_since_check`, `carried_statement_note`, `drift_cents`/`drift_note`).
    """
    balances = account_balances(session, as_of=as_of)
    pictures = valuation_picture(session, [a.id for a in accounts], as_of=as_of)
    carried = carried_statement_notes(session, accounts, as_of)
    drift = drift_notes(session, accounts, as_of=as_of)
    links = linked_category_ids_by_account(session)
    out = []
    for account in accounts:
        balance_cents = balances.get(account.id, 0)
        valuation, is_opening, entries = pictures[account.id]
        notes = []
        limit_note = credit_limit_note(balance_cents, account.credit_limit_cents)
        if limit_note is not None:
            notes.append(f"{limit_note}.")
        if carried[account.id] is not None:
            notes.append(carried[account.id])
        if drift[account.id] is not None:
            notes.append(drift[account.id])
        out.append(AccountOut(
            id=account.id, name=account.name, created_on=account.created_on, archived_on=account.archived_on,
            type=account.type, on_budget=account.on_budget, on_budget_floor_cents=account.on_budget_floor_cents,
            balance_cents=balance_cents, locked_payee_id=account.locked_payee_id,
            boundary_category_id=account.boundary_category_id,
            linked_category_ids=links.get(account.id, []),
            checked_on=valuation.date if valuation is not None else None,
            checked_valuation_id=valuation.id if valuation is not None else None,
            checked_is_opening=is_opening,
            entries_added_since_check=entries,
            notes=notes,
            terms=DebtTerms.model_validate(account, from_attributes=True),
        ))
    return out


@router.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[AccountOut]:
    visible = _visible(Account, as_of, include_archived)
    accounts = session.scalars(select(Account).where(visible).order_by(Account.name)).all()
    return _accounts_out(session, list(accounts), as_of=as_of)


def _reject_floor_below_credit_limit(floor_cents: int, credit_limit_cents: int | None) -> None:
    try:
        reject_floor_below_credit_limit(floor_cents, credit_limit_cents)
    except AccountError as exc:
        raise HTTPException(status_code=400, detail=str(exc))



def _reject_unknown_payee(session: Session, payee_id: int | None) -> None:
    if payee_id is not None and session.get(Payee, payee_id) is None:
        raise HTTPException(status_code=400, detail=f"Unknown payee id: {payee_id}")


def _reject_bad_boundary_category(session: Session, category_id: int | None) -> None:
    if category_id is None:
        return
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=400, detail=f"Unknown category id: {category_id}")
    if category.archived_on is not None:
        raise HTTPException(status_code=400, detail=f"Category {category.name!r} is archived.")


@router.post("/api/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountCreate, session: Session = Depends(get_session)) -> AccountOut:
    _reject_unknown_payee(session, payload.locked_payee_id)
    _reject_bad_boundary_category(session, payload.boundary_category_id)
    _reject_floor_below_credit_limit(payload.on_budget_floor_cents, payload.terms.credit_limit_cents)
    if payload.linked_category_id is not None:
        try:
            check_new_account_link(
                session, payload.linked_category_id,
                account_created_on=payload.created_on, on_budget=payload.on_budget,
            )
        except LinkError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    try:
        account = create_account_with_opening_valuation(
            session,
            name=payload.name,
            created_on=payload.created_on,
            type=payload.type,
            on_budget=payload.on_budget,
            on_budget_floor_cents=payload.on_budget_floor_cents,
            opening_balance_cents=payload.opening_balance_cents,
            locked_payee_id=payload.locked_payee_id,
            boundary_category_id=payload.boundary_category_id,
            **payload.terms.model_dump(),
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"An account named {payload.name!r} already exists.")
    if payload.linked_category_id is not None:
        add_category_link(session, payload.linked_category_id, account.id)
    return _account_out(session, account)


@router.put("/api/accounts/{account_id}", response_model=AccountOut)
def update_account_route(
    account_id: int, payload: AccountUpdate, session: Session = Depends(get_session)
) -> AccountOut:
    account = session.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    # "terms" wasn't sent means leave the account's existing terms alone — null means unknown,
    # never zero (DESIGN.md § Debt terms), and an edit that omits terms isn't the user saying
    # "I don't know these anymore."
    _reject_unknown_payee(session, payload.locked_payee_id)
    terms_sent = "terms" in payload.model_fields_set
    terms = payload.terms.model_dump() if terms_sent else {}
    if "locked_payee_id" in payload.model_fields_set:  # likewise: omitted leaves the lock as it is
        terms["locked_payee_id"] = payload.locked_payee_id
    if "boundary_category_id" in payload.model_fields_set:  # likewise
        # Re-sending the category already stored is not a new choice: it may have been archived since.
        if payload.boundary_category_id != account.boundary_category_id:
            _reject_bad_boundary_category(session, payload.boundary_category_id)
        terms["boundary_category_id"] = payload.boundary_category_id
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


@router.get("/api/accounts/{account_id}/balance", response_model=AccountBalanceOut)
def account_balance(
    account_id: int, as_of: date, exclude_transaction_id: int | None = None,
    session: Session = Depends(get_session),
) -> AccountBalanceOut:
    """The account's balance from every line dated on or before `as_of`, leaving out
    `exclude_transaction_id` — the balance before the line the envelope step is about.
    """
    if session.get(Account, account_id) is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    return AccountBalanceOut(balance_cents=account_balance_cents(
        session, account_id, as_of=as_of, exclude_transaction_id=exclude_transaction_id,
    ))


@router.get("/api/accounts/{account_id}/balance-check-preview", response_model=BalanceCheckPreviewOut)
def balance_check_preview(
    account_id: int, date: date, stated_balance_cents: int, session: Session = Depends(get_session)
) -> BalanceCheckPreviewOut:
    """The difference a balance check would find and, on an account with linked categories,
    the pro-rata split of it across them (DESIGN.md § Linked categories) — a suggestion the
    form lets the user edit before it saves. Writes nothing.
    """
    if session.get(Account, account_id) is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    diff_cents = stated_balance_cents - account_balance_cents(session, account_id, as_of=date)
    lines = suggest_split(session, account_id, as_of=date, diff_cents=diff_cents)
    return BalanceCheckPreviewOut(diff_cents=diff_cents, category_lines=[CategoryLineIn(**line) for line in lines])


@router.post("/api/accounts/{account_id}/balance-check", response_model=BalanceCheckOut)
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

    try:
        valuation, transaction, diff_cents = check_balance(
            session,
            account_id=account_id,
            check_date=payload.date,
            stated_balance_cents=payload.stated_balance_cents,
            category_id=payload.category_id,
            category_lines=(
                [line.model_dump() for line in payload.category_lines] if payload.category_lines is not None else None
            ),
        )
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return BalanceCheckOut(
        valuation_id=valuation.id,
        diff_cents=diff_cents,
        transaction=_transaction_out(session, transaction) if transaction is not None else None,
        account=_account_out(session, account),
    )


@router.post("/api/accounts/{account_id}/archive", response_model=ArchiveOut)
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
        blocked=live_split_block(session, account_id=account_id),
    )
    try:
        warnings = archive(target, payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    prune_archived_links(session)
    return ArchiveOut(id=account.id, archived_on=account.archived_on, warnings=warnings)


@router.post("/api/accounts/{account_id}/unarchive", response_model=ArchiveOut)
def unarchive_account(account_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    account = session.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    name = account.name  # read before the flush: a failed flush rolls the session back and expires the row
    unarchive(account)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"An account named {name!r} already exists.")
    return ArchiveOut(id=account.id, archived_on=account.archived_on, warnings=[])


@router.delete("/api/valuations/{valuation_id}", status_code=204)
def delete_valuation(valuation_id: int, session: Session = Depends(get_session)) -> None:
    """DESIGN.md § Balance checks — "Nothing is locked": a valuation and its adjustment (if
    any) are deleted together, one write. The opening valuation is the one exception — it's
    what makes the account's start date true, and is corrected by backfilling instead.
    """
    valuation = session.get(Valuation, valuation_id)
    if valuation is None:
        raise HTTPException(status_code=404, detail=f"No valuation with id {valuation_id}.")
    try:
        remove_valuation(session, valuation)
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
