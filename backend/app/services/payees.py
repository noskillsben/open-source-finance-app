"""Payee queries the archive mechanism needs (DESIGN.md § Payees, § General concepts →
Non-ledger rows are archived).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Transaction


def payee_latest_ledger_date(session: Session, payee_id: int) -> date | None:
    """The most recent transaction date that still references this payee — the archive-date
    bound (DESIGN.md: `archived_on` must be strictly later than the latest ledger row still
    pointing at the entity). Unlike accounts and categories, a transaction names its payee
    directly, so no join table is involved.
    """
    return session.scalar(
        select(func.max(Transaction.date)).where(Transaction.payee_id == payee_id)
    )
