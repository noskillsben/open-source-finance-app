from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Category, Transaction
from app.schemas import (
    CategoryAvailableOut,
    EarmarkLineOut,
    EarmarkMoveIn,
    PayBatchIn,
    ReadyToAssignOut,
)
from app.services.categories import category_balance_cents, pool_absorber_name, pool_available_cents
from app.services.earmarks import (
    EarmarkError,
    move_money,
    overspent_cents,
    pay_batch_lines,
    ready_to_assign_cents,
    replace_pay_batch,
)

router = APIRouter()



@router.get("/api/ready-to-assign", response_model=ReadyToAssignOut)
def ready_to_assign(as_of: date, session: Session = Depends(get_session)) -> ReadyToAssignOut:
    """Both headline numbers on `as_of` and each category's available amount. The picker date
    is the only "today", so the caller always says which day.
    """
    return ReadyToAssignOut(
        ready_to_assign_cents=ready_to_assign_cents(session, as_of=as_of),
        overspent_cents=overspent_cents(session, as_of=as_of),
        categories=[
            CategoryAvailableOut(
                category_id=category_id,
                available_cents=category_balance_cents(session, category_id, as_of=as_of),
                pool_available_cents=pool_available_cents(session, category_id, as_of=as_of),
                pool_absorber=pool_absorber_name(session, category_id, as_of=as_of),
            )
            for category_id in session.scalars(select(Category.id).order_by(Category.id))
        ],
    )


@router.post("/api/earmark-moves", response_model=list[EarmarkLineOut], status_code=201)
def create_earmark_move(payload: EarmarkMoveIn, session: Session = Depends(get_session)) -> list[EarmarkLineOut]:
    if payload.transaction_id is not None:
        raise HTTPException(
            status_code=400,
            detail="A pay's money moves are saved whole through PUT /api/transactions/{id}/pay-batch.",
        )
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


@router.get("/api/transactions/{transaction_id}/pay-batch", response_model=list[EarmarkLineOut])
def get_pay_batch(transaction_id: int, session: Session = Depends(get_session)) -> list[EarmarkLineOut]:
    """The pay-batch lines pointing at a transaction (DESIGN.md § Earmarks)."""
    if session.get(Transaction, transaction_id) is None:
        raise HTTPException(status_code=404, detail=f"No transaction with id {transaction_id}.")
    return [EarmarkLineOut.model_validate(line) for line in pay_batch_lines(session, transaction_id)]


@router.put("/api/transactions/{transaction_id}/pay-batch", response_model=list[EarmarkLineOut])
def put_pay_batch(
    transaction_id: int, payload: PayBatchIn, session: Session = Depends(get_session)
) -> list[EarmarkLineOut]:
    """Replace every pay-batch line for a transaction with the stated list, in this request's
    one database transaction — all of them land or none do (DESIGN.md § Earmarks). An empty list
    removes the batch ("Delete this pay", Pay screen layout block 11).
    """
    transaction = session.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status_code=404, detail=f"No transaction with id {transaction_id}.")
    try:
        lines = replace_pay_batch(session, transaction, [line.model_dump() for line in payload.lines])
    except EarmarkError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return [EarmarkLineOut.model_validate(line) for line in lines]
