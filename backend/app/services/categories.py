"""Category queries the archive mechanism needs (DESIGN.md § Categories, § General concepts →
Non-ledger rows are archived).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Category, CategoryLine, Domain, EarmarkLine, Transaction
from app.need_levels import NEED_LEVELS
from app.services.archiving import Archivable


def category_latest_ledger_date(session: Session, category_id: int) -> date | None:
    """The most recent ledger date — a transaction's or an earmark line's — that still
    references this category — the archive-date bound (DESIGN.md: `archived_on` must be
    strictly later than the latest ledger row still pointing at the entity). An archive-sweep
    line is excluded: it is dated on `archived_on` itself, the one row the design exempts from
    this bound, so it must never be what blocks a later archive-date check.
    """
    transaction_date = session.scalar(
        select(func.max(Transaction.date))
        .join(CategoryLine, CategoryLine.transaction_id == Transaction.id)
        .where(CategoryLine.category_id == category_id)
    )
    earmark_date = session.scalar(
        select(func.max(EarmarkLine.date)).where(
            EarmarkLine.category_id == category_id, EarmarkLine.source != "archive_sweep"
        )
    )
    return max((d for d in (transaction_date, earmark_date) if d is not None), default=None)


def category_balance_cents(session: Session, category_id: int, *, as_of: date) -> int:
    """A category's balance on `as_of`: its earmark lines plus its transaction category lines,
    up to that date (DESIGN.md § Earmarks, § No stored balances). The one definition — the
    archive warning and ready to assign both read it.
    """
    from_transactions = session.scalar(
        select(func.coalesce(func.sum(CategoryLine.cents), 0))
        .join(Transaction, CategoryLine.transaction_id == Transaction.id)
        .where(CategoryLine.category_id == category_id, Transaction.date <= as_of)
    )
    from_earmarks = session.scalar(
        select(func.coalesce(func.sum(EarmarkLine.cents), 0))
        .where(EarmarkLine.category_id == category_id, EarmarkLine.date <= as_of)
    )
    return from_transactions + from_earmarks


def category_month_cents(session: Session, category_id: int, *, as_of: date) -> tuple[int, int]:
    """(assigned, spent) for the calendar month of `as_of`, first day through `as_of`
    (DESIGN.md § Categories → Goals). Assigned is the signed sum of the category's earmark lines
    of every source; spent is the signed sum of its transaction category lines (a refund lowers
    it). The calendar month, never the pay period; read-time only, nothing stored. Available on
    `as_of` = available at the end of the previous month + assigned + spent.
    """
    first = as_of.replace(day=1)
    assigned = session.scalar(
        select(func.coalesce(func.sum(EarmarkLine.cents), 0)).where(
            EarmarkLine.category_id == category_id, EarmarkLine.date >= first, EarmarkLine.date <= as_of
        )
    )
    spent = session.scalar(
        select(func.coalesce(func.sum(CategoryLine.cents), 0))
        .join(Transaction, CategoryLine.transaction_id == Transaction.id)
        .where(CategoryLine.category_id == category_id, Transaction.date >= first, Transaction.date <= as_of)
    )
    return assigned, spent


def category_balances(session: Session, *, as_of: date) -> dict[int, int]:
    """Every category's balance on `as_of`, archived ones included, in two grouped queries (one
    per line source) instead of two per category. Must equal `category_balance_cents` for each
    category — that function stays the single-category definition for writes and archive checks.
    A category with no lines reads 0.
    """
    balances = {category_id: 0 for category_id in session.scalars(select(Category.id))}
    from_transactions = session.execute(
        select(CategoryLine.category_id, func.sum(CategoryLine.cents))
        .join(Transaction, CategoryLine.transaction_id == Transaction.id)
        .where(Transaction.date <= as_of)
        .group_by(CategoryLine.category_id)
    )
    from_earmarks = session.execute(
        select(EarmarkLine.category_id, func.sum(EarmarkLine.cents))
        .where(EarmarkLine.date <= as_of)
        .group_by(EarmarkLine.category_id)
    )
    for category_id, cents in (*from_transactions, *from_earmarks):
        balances[category_id] = balances.get(category_id, 0) + int(cents)
    return balances


def category_month_map(session: Session, *, as_of: date) -> dict[int, tuple[int, int]]:
    """(assigned, spent) for every category's calendar month of `as_of` in two grouped queries;
    equal to `category_month_cents` per category. A category with no lines reads (0, 0).
    """
    first = as_of.replace(day=1)
    month = {category_id: (0, 0) for category_id in session.scalars(select(Category.id))}
    assigned = dict(session.execute(
        select(EarmarkLine.category_id, func.sum(EarmarkLine.cents))
        .where(EarmarkLine.date >= first, EarmarkLine.date <= as_of)
        .group_by(EarmarkLine.category_id)
    ).all())
    spent = dict(session.execute(
        select(CategoryLine.category_id, func.sum(CategoryLine.cents))
        .join(Transaction, CategoryLine.transaction_id == Transaction.id)
        .where(Transaction.date >= first, Transaction.date <= as_of)
        .group_by(CategoryLine.category_id)
    ).all())
    for category_id in set(assigned) | set(spent):
        month[category_id] = (int(assigned.get(category_id, 0)), int(spent.get(category_id, 0)))
    return month


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


def pool_chain(session: Session, category_id: int) -> list[Category]:
    """The categories `category_id` draws on, nearest first (DESIGN.md § Pools: draws follow
    the chain). Excludes the category itself; the seen-set keeps a cycle already in the data
    from looping.
    """
    seen = {category_id}
    chain: list[Category] = []
    current = session.get(Category, category_id).pool_id
    while current is not None and current not in seen:
        seen.add(current)
        pool = session.get(Category, current)
        chain.append(pool)
        current = pool.pool_id
    return chain


def pool_available_cents(session: Session, category_id: int, *, as_of: date) -> int:
    """What the pool chain could cover if `category_id` overspent on `as_of`: each pool's
    balance, a negative one counting as nothing because a draw never takes from a pool below
    zero, and a pool archived on or before `as_of` counting as nothing because a draw skips it
    (DESIGN.md § Pools — the "+$170 available if overspent" pill). Same rules as the draw.
    """
    return sum(
        max(category_balance_cents(session, pool.id, as_of=as_of), 0)
        for pool in pool_chain(session, category_id)
        if pool.archived_on is None or pool.archived_on > as_of
    )


def pool_absorber_name(session: Session, category_id: int, *, as_of: date) -> str | None:
    """The name of the first pool in `category_id`'s chain that would absorb a shortfall on
    `as_of` — the same pools the draw walk considers (archived ones skipped). Drives the
    "then Food absorbs the rest" pill; None when no pool in the chain absorbs.
    """
    return next((
        pool.name
        for pool in pool_chain(session, category_id)
        if pool.absorb_overspending and (pool.archived_on is None or pool.archived_on > as_of)
    ), None)


def _chain_in_memory(categories: dict[int, Category], category_id: int) -> list[Category]:
    """`pool_chain` over a category map loaded once — same walk, same cycle guard, no queries."""
    seen = {category_id}
    chain: list[Category] = []
    current = categories[category_id].pool_id
    while current is not None and current not in seen:
        seen.add(current)
        pool = categories[current]
        chain.append(pool)
        current = pool.pool_id
    return chain


def pool_availability(
    categories: dict[int, Category], balances: dict[int, int], *, as_of: date
) -> dict[int, tuple[int, str | None]]:
    """(pool available, pool absorber name) for every category, resolving pool chains in memory
    from one category load and one balances map. Equal to `pool_available_cents` and
    `pool_absorber_name` per category (same rules: a negative pool counts as nothing, a pool
    archived on or before `as_of` is skipped).
    """
    result = {}
    for category_id in categories:
        live = [
            pool for pool in _chain_in_memory(categories, category_id)
            if pool.archived_on is None or pool.archived_on > as_of
        ]
        result[category_id] = (
            sum(max(balances[pool.id], 0) for pool in live),
            next((pool.name for pool in live if pool.absorb_overspending), None),
        )
    return result


def apply_category_settings(
    session: Session, category: Category, *, name: str, parent_id: int | None,
    pool_id: int | None, domain_id: int | None, need_level: str | None,
    absorb_overspending: bool = False,
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
    category.absorb_overspending = absorb_overspending
