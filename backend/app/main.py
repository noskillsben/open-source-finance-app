from datetime import date

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.db import get_session
from app.models import Account, Category, Payee, Transaction
from app.schemas import (
    AccountCreate,
    AccountLineOut,
    AccountOut,
    AccountUpdate,
    ArchiveIn,
    ArchiveOut,
    CategoryCreate,
    CategoryLineOut,
    CategoryOut,
    Health,
    PayeeCreate,
    PayeeOut,
    TransactionCreate,
    TransactionOut,
)
from app.services.accounts import (
    account_balance_cents,
    account_latest_ledger_date,
    create_account_with_opening_valuation,
    update_account,
)
from app.services.archiving import Archivable, ArchiveError, archive, unarchive, visible_as_of
from app.services.categories import build_category_archivable
from app.services.transactions import TransactionError, write_transaction

app = FastAPI(title="Open Source Finance App", version="0.0.1", docs_url="/docs", openapi_url="/api/openapi.json")


@app.get("/api/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # the health page is the one place a swallowed error is acceptable
        database = f"error: {type(exc).__name__}"
    return Health(status="ok", database=database, app_mode=settings.app_mode)


@app.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(as_of: date | None = None, session: Session = Depends(get_session)) -> list[AccountOut]:
    accounts = session.scalars(
        select(Account).where(visible_as_of(Account, as_of)).order_by(Account.name)
    ).all()
    return [
        AccountOut(
            id=a.id, name=a.name, created_on=a.created_on, archived_on=a.archived_on, type=a.type,
            on_budget=a.on_budget, on_budget_floor_cents=a.on_budget_floor_cents,
            balance_cents=account_balance_cents(session, a.id, as_of=as_of),
        )
        for a in accounts
    ]


@app.post("/api/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountCreate, session: Session = Depends(get_session)) -> AccountOut:
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
    return AccountOut(
        id=account.id, name=account.name, created_on=account.created_on, archived_on=account.archived_on,
        type=account.type, on_budget=account.on_budget, on_budget_floor_cents=account.on_budget_floor_cents,
        balance_cents=payload.opening_balance_cents,
    )


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
    terms = payload.terms.model_dump() if "terms" in payload.model_fields_set else {}
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
    return AccountOut(
        id=account.id, name=account.name, created_on=account.created_on, archived_on=account.archived_on,
        type=account.type, on_budget=account.on_budget, on_budget_floor_cents=account.on_budget_floor_cents,
        balance_cents=account_balance_cents(session, account.id),
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
def list_categories(as_of: date | None = None, session: Session = Depends(get_session)) -> list[CategoryOut]:
    categories = session.scalars(
        select(Category).where(visible_as_of(Category, as_of)).order_by(Category.name)
    ).all()
    return [
        CategoryOut(id=c.id, name=c.name, parent_id=c.parent_id, created_on=c.created_on, archived_on=c.archived_on)
        for c in categories
    ]


@app.post("/api/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, session: Session = Depends(get_session)) -> CategoryOut:
    category = Category(name=payload.name, created_on=payload.created_on, parent_id=payload.parent_id)
    session.add(category)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A category named {payload.name!r} already exists.")
    return CategoryOut(
        id=category.id, name=category.name, parent_id=category.parent_id,
        created_on=category.created_on, archived_on=category.archived_on,
    )


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
def list_payees(session: Session = Depends(get_session)) -> list[PayeeOut]:
    payees = session.scalars(
        select(Payee).where(Payee.archived_on.is_(None)).order_by(Payee.name)
    ).all()
    return [PayeeOut(id=p.id, name=p.name) for p in payees]


@app.post("/api/payees", response_model=PayeeOut, status_code=201)
def create_payee(payload: PayeeCreate, session: Session = Depends(get_session)) -> PayeeOut:
    payee = Payee(name=payload.name, created_on=payload.created_on)
    session.add(payee)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A payee named {payload.name!r} already exists.")
    return PayeeOut(id=payee.id, name=payee.name)


def _transaction_query():
    return select(Transaction).options(
        selectinload(Transaction.account_lines), selectinload(Transaction.category_lines)
    )


def _transaction_out(t: Transaction) -> TransactionOut:
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
    )


@app.get("/api/transactions", response_model=list[TransactionOut])
def list_transactions(session: Session = Depends(get_session)) -> list[TransactionOut]:
    transactions = session.scalars(_transaction_query().order_by(Transaction.date, Transaction.id)).all()
    return [_transaction_out(t) for t in transactions]


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
    return _transaction_out(transaction)


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
    return _transaction_out(transaction)


@app.delete("/api/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, session: Session = Depends(get_session)) -> None:
    transaction = session.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status_code=404, detail=f"No transaction with id {transaction_id}.")
    if transaction.valuation_id is not None:
        raise HTTPException(
            status_code=400,
            detail="this is the account's opening-balance adjustment; fix it with a balance check or backfill, not by hand",
        )
    session.delete(transaction)
    session.flush()
