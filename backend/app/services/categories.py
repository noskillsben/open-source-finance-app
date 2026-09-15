"""Category queries the archive mechanism needs (DESIGN.md § Categories, § General concepts →
Non-ledger rows are archived).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Category, CategoryLine, Transaction
from app.services.archiving import Archivable


def category_latest_ledger_date(session: Session, category_id: int) -> date | None:
    """The most recent transaction date that still references this category — the archive-date
    bound (DESIGN.md: `archived_on` must be strictly later than the latest ledger row still
    pointing at the entity).
    """
    return session.scalar(
        select(func.max(Transaction.date))
        .join(CategoryLine, CategoryLine.transaction_id == Transaction.id)
        .where(CategoryLine.category_id == category_id)
    )


def category_balance_cents(session: Session, category_id: int, *, as_of: date) -> int:
    """Sum of this category's lines up to `as_of` (DESIGN.md § No stored balances) — used only
    for the archive warning; the planning-surface balance/goal math is EPIC #2's job.
    """
    return session.scalar(
        select(func.coalesce(func.sum(CategoryLine.cents), 0))
        .join(Transaction, CategoryLine.transaction_id == Transaction.id)
        .where(CategoryLine.category_id == category_id, Transaction.date <= as_of)
    )


def category_children(session: Session, category_id: int) -> list[Category]:
    """Direct children still active — archiving a parent cascades into these
    (DESIGN.md: "archiving a category with children archives the children with the same
    date"); an already-archived child is left with its own `archived_on`.
    """
    return list(
        session.scalars(
            select(Category).where(Category.parent_id == category_id, Category.archived_on.is_(None))
        )
    )


def build_category_archivable(session: Session, category: Category, *, as_of: date) -> Archivable:
    """Recursively wire up `category` and its active children for `archiving.archive()` — one
    postable category can carry its own spending as well as children (DESIGN.md § Categories:
    "Every category is postable, parent or not"), so it gets a balance and a ledger bound too.
    """
    return Archivable(
        entity=category,
        latest_ledger_date=category_latest_ledger_date(session, category.id),
        balance_cents=category_balance_cents(session, category.id, as_of=as_of),
        children=[
            build_category_archivable(session, child, as_of=as_of)
            for child in category_children(session, category.id)
        ],
    )
