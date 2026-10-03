"""Named pays (DESIGN.md § Income streams): a planned recurring money event the user states
first, that goals later attach to (#21) and the pay screen later records against (#24). This
issue only ever writes the stream and its expected deductions — never a transaction.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Account, Category, CategoryLine, IncomeStream, IncomeStreamDeduction, Payee, Transaction,
)
from app.services.cadence import CADENCES, add_months, roll_forward, step


class IncomeStreamError(Exception):
    """A named pay the service refuses — a planning surface, so a block is allowed
    (DESIGN.md § General concepts → blocks are allowed on planning and settings surfaces).
    """


def income_stream_latest_ledger_date(session: Session, income_stream_id: int) -> date | None:
    """The most recent transaction date that still names this named pay — the archive-date
    bound (DESIGN.md: `archived_on` must be strictly later than the latest ledger row still
    pointing at the entity). Set by the pay screen (#24).
    """
    return session.scalar(
        select(func.max(Transaction.date)).where(Transaction.income_stream_id == income_stream_id)
    )


def next_payday(stream: IncomeStream, *, as_of: date) -> date:
    """`anchor_payday` rolled forward by the cadence to the first payday on or after `as_of`,
    at read time, never stored (DESIGN.md § Income streams) — the same roll-forward a recurring
    bill's due date uses (app/services/cadence.py).
    """
    return roll_forward(stream.cadence, stream.cadence_weeks, stream.anchor_payday, as_of=as_of)


def apply_income_stream(
    session: Session, stream: IncomeStream | None, *, on: date, name: str, payee_id: int | None,
    cadence: str, cadence_weeks: int | None, anchor_payday: date, expected_gross_cents: int | None,
    expected_net_low_cents: int, expected_net_high_cents: int, income_category_id: int,
    destination_account_id: int, deductions: list[dict],
) -> IncomeStream:
    """The one write path for a named pay, shared by create and edit. Validates everything
    before touching the row, then replaces the deductions as a set (DESIGN.md: "replaced as a
    set on save through the one write path").
    """
    if cadence not in CADENCES:
        raise IncomeStreamError(f"Unknown cadence {cadence!r}.")
    if cadence == "weeks":
        if cadence_weeks is None or cadence_weeks < 1:
            raise IncomeStreamError("'Every N weeks' needs N, at least 1.")
    elif cadence_weeks is not None:
        raise IncomeStreamError("The number of weeks only applies to an 'every N weeks' cadence.")

    for label, cents in (
        ("expected gross", expected_gross_cents),
        ("expected net low", expected_net_low_cents),
        ("expected net high", expected_net_high_cents),
    ):
        if cents is not None and cents < 0:
            raise IncomeStreamError(f"The {label} amount cannot be negative.")
    if expected_net_low_cents > expected_net_high_cents:
        raise IncomeStreamError("The low estimate cannot be more than the high estimate.")

    if payee_id is not None and session.get(Payee, payee_id) is None:
        raise IncomeStreamError(f"Unknown payee id: {payee_id}")
    if session.get(Category, income_category_id) is None:
        raise IncomeStreamError(f"Unknown category id: {income_category_id}")
    if session.get(Account, destination_account_id) is None:
        raise IncomeStreamError(f"Unknown account id: {destination_account_id}")

    deduction_category_ids = [d["category_id"] for d in deductions]
    for category_id in deduction_category_ids:
        if session.get(Category, category_id) is None:
            raise IncomeStreamError(f"Unknown deduction category id: {category_id}")
    for cents in (d["amount_cents"] for d in deductions):
        if cents < 0:
            raise IncomeStreamError("A deduction amount cannot be negative.")

    if stream is None:
        stream = IncomeStream(created_on=on)
        session.add(stream)
    stream.name = name
    stream.payee_id = payee_id
    stream.cadence = cadence
    stream.cadence_weeks = cadence_weeks
    stream.anchor_payday = anchor_payday
    stream.expected_gross_cents = expected_gross_cents
    stream.expected_net_low_cents = expected_net_low_cents
    stream.expected_net_high_cents = expected_net_high_cents
    stream.income_category_id = income_category_id
    stream.destination_account_id = destination_account_id
    stream.deductions = [
        IncomeStreamDeduction(category_id=d["category_id"], amount_cents=d["amount_cents"])
        for d in deductions
    ]
    return stream


def recorded_pay_transaction(session: Session, income_stream_id: int, payday: date) -> Transaction | None:
    """The transaction recorded for this named pay on this payday: `income_stream_id` plus the
    date, the only identity a recorded pay has (DESIGN.md § Re-opening a recorded pay). The
    earliest one if more than one exists.
    """
    return session.scalars(
        select(Transaction)
        .options(selectinload(Transaction.account_lines), selectinload(Transaction.category_lines))
        .where(Transaction.income_stream_id == income_stream_id, Transaction.date == payday)
        .order_by(Transaction.id)
        .limit(1)
    ).first()


@dataclass
class PayPeriod:
    period_end: date | None
    previous_payday: date
    recorded: Transaction | None
    last_period_actuals: dict[int, int]


def pay_period(session: Session, stream: IncomeStream | None, payday: date) -> PayPeriod:
    """What the pay screen needs for one payday, stepped from the payday given (never from the
    anchor), so a screen opened for a past or future payday shows the same period it always did.

    A named pay: the period ends the day before the following payday; last period is the window
    from the previous payday up to, not including, this payday. A one-off has no cadence, so no
    period end and no recorded transaction, and its window is the calendar month before the
    payday's month (DESIGN.md § Record income → "A one-off on the pay screen").

    Last period's actual is per category, in cents, from outflow lines only (cents < 0): a
    refund (a positive line) is not netted off.
    """
    if stream is None:
        month_start = payday.replace(day=1)
        start, end = add_months(month_start, -1), month_start
        period_end = None
        recorded = None
    else:
        start = step(stream.cadence, stream.cadence_weeks, payday, -1)
        end = payday
        period_end = step(stream.cadence, stream.cadence_weeks, payday, 1) - timedelta(days=1)
        recorded = recorded_pay_transaction(session, stream.id, payday)
    rows = session.execute(
        select(CategoryLine.category_id, func.sum(-CategoryLine.cents))
        .join(Transaction, CategoryLine.transaction_id == Transaction.id)
        .where(Transaction.date >= start, Transaction.date < end, CategoryLine.cents < 0)
        .group_by(CategoryLine.category_id)
    ).all()
    return PayPeriod(
        period_end=period_end, previous_payday=start, recorded=recorded,
        last_period_actuals={category_id: int(cents) for category_id, cents in rows},
    )
