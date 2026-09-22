"""Category goals (DESIGN.md § Goals): one rule per category, progress being the category's
balance compared to the rule. Binding a goal to a named pay is #21.
"""
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, Goal
from app.services.cadence import CADENCES, roll_forward, step
from app.services.categories import category_balance_cents

KINDS = ("recurring_bill", "target", "commitment")


class GoalError(Exception):
    """A goal the service refuses — a settings surface, so a block is allowed."""


def _step(goal: Goal, day: date, n: int) -> date:
    return step(goal.cadence, goal.cadence_weeks, day, n)


def apply_goal(
    session: Session, category: Category, goal: Goal | None, *, on: date, name: str, kind: str,
    amount_cents: int | None, cadence: str | None, cadence_weeks: int | None,
    target_date: date | None, level_cents: int | None,
) -> Goal:
    """The one write path for a goal, shared by create and edit. Validates everything before
    touching the row; a field the kind doesn't use must be left empty (null, never zero).
    """
    if kind not in KINDS:
        raise GoalError(f"Unknown goal kind {kind!r}.")
    if cadence is not None and cadence not in CADENCES:
        raise GoalError(f"Unknown cadence {cadence!r}.")
    if cadence == "weeks":
        if cadence_weeks is None or cadence_weeks < 1:
            raise GoalError("'Every N weeks' needs N, at least 1.")
    elif cadence_weeks is not None:
        raise GoalError("The number of weeks only applies to an 'every N weeks' cadence.")
    for label, cents in (("amount", amount_cents), ("level", level_cents)):
        if cents is not None and cents < 0:
            raise GoalError(f"The {label} cannot be negative.")

    if kind == "recurring_bill":
        if amount_cents is None or cadence is None:
            raise GoalError("A recurring bill needs an amount and a cadence.")
        if level_cents is not None:
            raise GoalError("A recurring bill has no level.")
    elif kind == "target":
        if amount_cents is None:
            raise GoalError("A target needs an amount.")
        if level_cents is not None:
            raise GoalError("A target has no level.")
        if cadence is not None and target_date is None:
            raise GoalError("A per-period contribution needs a target date.")
    else:
        if target_date is not None:
            raise GoalError("A commitment has no target date.")
        if cadence is None:
            raise GoalError("A commitment needs a cadence.")
        if (amount_cents is None) == (level_cents is None):
            raise GoalError("A commitment either adds a fixed amount or refills to a level — give one, not both.")

    if goal is None:
        goal = Goal(category_id=category.id, created_on=on)
        session.add(goal)
    goal.name = name
    goal.kind = kind
    goal.amount_cents = amount_cents
    goal.cadence = cadence
    goal.cadence_weeks = cadence_weeks
    goal.target_date = target_date
    goal.level_cents = level_cents
    return goal


def live_goal(session: Session, category_id: int) -> Goal | None:
    return session.scalar(select(Goal).where(Goal.category_id == category_id, Goal.archived_on.is_(None)))


def contribution_cents(goal: Goal, balance_cents: int, *, as_of: date) -> int | None:
    """A target's per-period contribution: the shortfall spread over the whole cadence periods
    between `as_of` and the target date (at least one), rounded UP to the cent so the periods
    never leave it short; 0 once the balance has reached the amount.
    """
    if goal.kind != "target" or goal.cadence is None or goal.target_date is None:
        return None
    shortfall = max(goal.amount_cents - balance_cents, 0)
    periods = 0
    while _step(goal, as_of, periods + 1) <= goal.target_date:
        periods += 1
    return -(-shortfall // max(periods, 1))


def due_date(goal: Goal, *, as_of: date) -> date | None:
    """The date shown for a goal. A recurring bill's rolls forward by its cadence to the first
    one on or after `as_of`; a target's is its target date.
    """
    if goal.target_date is None:
        return None
    if goal.kind != "recurring_bill":
        return goal.target_date
    return roll_forward(goal.cadence, goal.cadence_weeks, goal.target_date, as_of=as_of)


@dataclass
class Progress:
    balance_cents: int
    target_cents: int | None
    owed_cents: int | None
    due_date: date | None
    per_period_cents: int | None


def goal_progress(session: Session, goal: Goal, *, as_of: date) -> Progress:
    # Postgres sums come back as Decimal, whose // truncates toward zero — the round-up needs an int.
    balance = int(category_balance_cents(session, goal.category_id, as_of=as_of))
    if goal.kind == "commitment":
        target = goal.level_cents  # an "add" commitment has no target
        per_period = goal.amount_cents
    else:
        target = goal.amount_cents
        per_period = contribution_cents(goal, balance, as_of=as_of)
    return Progress(
        balance_cents=balance,
        target_cents=target,
        owed_cents=None if target is None else max(target - balance, 0),
        due_date=due_date(goal, as_of=as_of),
        per_period_cents=per_period,
    )
