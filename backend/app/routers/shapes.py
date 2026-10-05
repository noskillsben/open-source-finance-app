"""Response shapes more than one router builds, so each lives in one place."""
from sqlalchemy.orm import Session

from app.models import Transaction
from app.schemas import AccountLineOut, CategoryLineOut, DepositIn, TransactionOut
from app.services.transaction_notes import transaction_notes
from app.services.transactions import read_deposits


def _transaction_shape(t: Transaction, notes: list[str], deposits: list[dict] | None = None) -> TransactionOut:
    return TransactionOut(
        deposits=[DepositIn(**item) for item in deposits or []],
        id=t.id, date=t.date, memo=t.memo, payee_id=t.payee_id, valuation_id=t.valuation_id,
        income_stream_id=t.income_stream_id, goal_id=t.goal_id, goal_due_on=t.goal_due_on,
        split_id=t.split_id, paid_by_payee_id=t.paid_by_payee_id,
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
    return _transaction_shape(t, transaction_notes(session, t), read_deposits(session, t))
