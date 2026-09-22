"""The cadence shape shared by goals and named pays (DESIGN.md § Goals, § Income streams):
monthly, quarterly, yearly, or every N weeks. "Due" or "next payday" is a stated date rolled
forward by the cadence to the first one on or after a picker date, at read time, never stored —
one mechanism, so a goal's due date and a named pay's next payday can't drift apart.
"""
import calendar
from datetime import date, timedelta

CADENCES = ("monthly", "quarterly", "yearly", "weeks")
_MONTHS = {"monthly": 1, "quarterly": 3, "yearly": 12}


def add_months(day: date, months: int) -> date:
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    return date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def step(cadence: str, cadence_weeks: int | None, day: date, n: int) -> date:
    """`day` moved forward by `n` cadence periods."""
    if cadence == "weeks":
        return day + timedelta(weeks=cadence_weeks * n)
    return add_months(day, _MONTHS[cadence] * n)


def roll_forward(cadence: str, cadence_weeks: int | None, anchor: date, *, as_of: date) -> date:
    """`anchor` rolled forward by whole cadence periods to the first date on or after `as_of`."""
    n = 0
    while step(cadence, cadence_weeks, anchor, n) < as_of:
        n += 1
    return step(cadence, cadence_weeks, anchor, n)
