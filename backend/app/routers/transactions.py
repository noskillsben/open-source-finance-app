from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_session
from app.models import Transaction
from app.routers.shapes import _transaction_out, _transaction_shape
from app.schemas import TransactionCreate, TransactionOut
from app.services.transaction_actions import (
    delete_transaction as remove_transaction,
    re_save_transaction as re_save,
)
from app.services.transactions import TransactionError, read_deposits_for, write_transaction

router = APIRouter()



def _transaction_query():
    return select(Transaction).options(
        selectinload(Transaction.account_lines), selectinload(Transaction.category_lines)
    )


@router.get("/api/transactions", response_model=list[TransactionOut])
def list_transactions(session: Session = Depends(get_session)) -> list[TransactionOut]:
    transactions = session.scalars(_transaction_query().order_by(Transaction.date, Transaction.id)).all()
    # Notes belong to the save response and the account page, never the historical list
    # (each one costs per-line queries), so the list carries none. Deposits ride along: the
    # edit form pre-fills from them, and an edit that lost them would clear them.
    deposits = read_deposits_for(session, list(transactions))
    return [_transaction_shape(t, [], deposits.get(t.id)) for t in transactions]


@router.post("/api/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(payload: TransactionCreate, session: Session = Depends(get_session)) -> TransactionOut:
    try:
        transaction = write_transaction(
            session,
            transaction=None,
            txn_date=payload.date,
            memo=payload.memo,
            payee_id=payload.payee_id,
            income_stream_id=payload.income_stream_id,
            goal_id=payload.goal_id,
            goal_due_on=payload.goal_due_on,
            account_lines=[line.model_dump() for line in payload.account_lines],
            category_lines=[line.model_dump() for line in payload.category_lines],
            deposits=[item.model_dump() for item in payload.deposits],
        )
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return _transaction_out(session, transaction)


@router.put("/api/transactions/{transaction_id}", response_model=TransactionOut)
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
            goal_id=payload.goal_id,
            goal_due_on=payload.goal_due_on,
            account_lines=[line.model_dump() for line in payload.account_lines],
            category_lines=[line.model_dump() for line in payload.category_lines],
            deposits=[item.model_dump() for item in payload.deposits],
        )
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return _transaction_out(session, transaction)


@router.post("/api/transactions/{transaction_id}/re-save", response_model=TransactionOut)
def re_save_transaction(transaction_id: int, session: Session = Depends(get_session)) -> TransactionOut:
    """The integrity check's fix: run a transaction back through the normal write path with
    its own stored lines, so its `budget_cents` reflect current settings (DESIGN.md § General
    concepts → Settings never rewrite history). No separate fix logic — same write as any edit.
    """
    transaction = session.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status_code=404, detail=f"No transaction with id {transaction_id}.")
    try:
        transaction = re_save(session, transaction)
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return _transaction_out(session, transaction)



@router.delete("/api/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, session: Session = Depends(get_session)) -> None:
    transaction = session.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status_code=404, detail=f"No transaction with id {transaction_id}.")
    try:
        remove_transaction(session, transaction)
    except TransactionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
