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


def assign_to_category(session: Session, *, move_date: date, category_id: int, cents: int) -> EarmarkLine:
    """One earmark move line, ready to assign → category (a negative amount goes the other
    way). Validates everything, then writes.
    """
    if cents == 0:
        raise EarmarkError("Enter an amount to assign.")
    category = session.get(Category, category_id)
    if category is None:
        raise EarmarkError(f"Unknown category id: {category_id}")
    if category.archived_on is not None and category.archived_on <= move_date:
        raise EarmarkError(f"{category.name} was archived on {category.archived_on.isoformat()}.")
    backdate_created_on(category, move_date)
    line = EarmarkLine(date=move_date, category_id=category_id, cents=cents, source="move")
    session.add(line)
    session.flush()
    return line
