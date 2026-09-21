"""Category queries the archive mechanism needs (DESIGN.md § Categories, § General concepts →
Non-ledger rows are archived).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Category, CategoryLine, Domain, Transaction
from app.need_levels import NEED_LEVELS
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


class CategoryError(Exception):
    """A category setting the service refuses — a planning surface, so a block is allowed
    (DESIGN.md § General concepts → blocks are allowed on planning and settings surfaces).
    """


def _reaches(session: Session, start_id: int | None, target_id: int, link: str) -> bool:
    """Follow `link` ("parent_id" or "pool_id") from `start_id` up its chain; True if the chain
    passes through `target_id`. Bounded by the seen-set, so a cycle already in the data can't hang it.
    """
    seen: set[int] = set()
    current = start_id
    while current is not None and current not in seen:
        if current == target_id:
            return True
        seen.add(current)
        current = session.scalar(select(getattr(Category, link)).where(Category.id == current))
    return False


def apply_category_settings(
    session: Session, category: Category, *, name: str, parent_id: int | None,
    pool_id: int | None, domain_id: int | None, need_level: str | None,
) -> None:
    """The one write path for a category's settings, shared by create and edit. Validates
    everything before touching the row. A category may not be its own pool, directly or through
    a chain (DESIGN.md § Pools), nor its own ancestor in the tree. Enforced here, not in the DB.
    """
    if need_level is not None and need_level not in NEED_LEVELS:
        raise CategoryError(f"Unknown need level {need_level!r}.")
    for label, related_id in (("parent", parent_id), ("pool", pool_id)):
        if related_id is not None and session.get(Category, related_id) is None:
            raise CategoryError(f"Unknown {label} category id: {related_id}")
    if domain_id is not None and session.get(Domain, domain_id) is None:
        raise CategoryError(f"Unknown domain id: {domain_id}")
    if category.id is not None:
        if _reaches(session, pool_id, category.id, "pool_id"):
            raise CategoryError("A category cannot be its own pool, directly or through a chain of pools.")
        if _reaches(session, parent_id, category.id, "parent_id"):
            raise CategoryError("A category cannot be placed under itself or one of its own sub-categories.")

    category.name = name
    category.parent_id = parent_id
    category.pool_id = pool_id
    category.domain_id = domain_id
    category.need_level = need_level
