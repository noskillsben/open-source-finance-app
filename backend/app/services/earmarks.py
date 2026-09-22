"""The earmark ledger and ready to assign (DESIGN.md § Earmarks; § Categories → Pools, "Ready
to assign is not a category").
"""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Category, EarmarkLine
from app.services.accounts import account_balance_cents, on_budget_cents
from app.services.categories import category_balance_cents
from app.services.transactions import backdate_created_on


class EarmarkError(ValueError):
    """An assignment the service refuses — a planning surface, so a block is allowed."""


def _category_balances(session: Session, as_of: date) -> list[int]:
    """Every category's balance on `as_of`, archived ones included — an archived category can
    still hold money, and dropping it would change the difference below.
    """
    return [
        category_balance_cents(session, category_id, as_of=as_of)
        for category_id in session.scalars(select(Category.id))
    ]


def ready_to_assign_cents(session: Session, *, as_of: date) -> int:
    """The one definition: every on-budget account's on-budget money (balance − floor,
    unclamped) minus every category's balance. A plain difference — no `max()`, so an
    overspent category reads back into it (DESIGN.md § Pools). Computed, never stored.
    """
    on_budget_total = sum(
        on_budget_cents(account_balance_cents(session, account.id, as_of=as_of), account.on_budget_floor_cents)
        for account in session.scalars(select(Account).where(Account.on_budget.is_(True)))
    )
    return on_budget_total - sum(_category_balances(session, as_of))


def overspent_cents(session: Session, *, as_of: date) -> int:
    """The negative category balances on `as_of`, summed (zero or negative). Display only — the
    headline's "includes −$X in overspent categories"; it feeds no write and changes no number.
    """
    return sum(balance for balance in _category_balances(session, as_of) if balance < 0)


def _movable_category(session: Session, category_id: int, move_date: date) -> Category:
    category = session.get(Category, category_id)
    if category is None:
        raise EarmarkError(f"Unknown category id: {category_id}")
    if category.archived_on is not None and category.archived_on <= move_date:
        raise EarmarkError(f"{category.name} was archived on {category.archived_on.isoformat()}.")
    return category


def _write_move_line(session: Session, category: Category, move_date: date, cents: int) -> EarmarkLine:
    backdate_created_on(category, move_date)
    line = EarmarkLine(date=move_date, category_id=category.id, cents=cents, source="move")
    session.add(line)
    return line


def sweep_archived_category_balance(
    session: Session, category: Category, *, archived_on: date, balance_cents: int
) -> EarmarkLine | None:
    """Empty an archived category's balance, or shortfall, back into ready to assign
    (DESIGN.md § General concepts → Non-ledger rows are archived: "archiving a category
    empties it into ready to assign"). Writes nothing when there is nothing to sweep. This
    bypasses `_movable_category`'s archived guard deliberately — the design's stated
    exemption, since the sweep line is dated on `archived_on` itself, after the category is
    archived.
    """
    if balance_cents == 0:
        return None
    line = EarmarkLine(date=archived_on, category_id=category.id, cents=-balance_cents, source="archive_sweep")
    session.add(line)
    return line


def move_money(
    session: Session, *, move_date: date, from_category_id: int | None, to_category_id: int | None, cents: int
) -> list[EarmarkLine]:
    """Move `cents` (positive) out of one category and into another. A null side is ready to
    assign, so that side writes no line: category → category is two lines (−from, +to), either
    side null is one. No balance check — a move is a recording surface, and a category may go
    negative. Validates everything, then writes.
    """
    if cents <= 0:
        raise EarmarkError("Enter an amount to move.")
    if from_category_id is None and to_category_id is None:
        raise EarmarkError("Pick a category to move money from or to.")
    if from_category_id == to_category_id:
        raise EarmarkError("Pick two different categories.")
    source = _movable_category(session, from_category_id, move_date) if from_category_id is not None else None
    target = _movable_category(session, to_category_id, move_date) if to_category_id is not None else None
    lines = []
    if source is not None:
        lines.append(_write_move_line(session, source, move_date, -cents))
    if target is not None:
        lines.append(_write_move_line(session, target, move_date, cents))
    session.flush()
    return lines
