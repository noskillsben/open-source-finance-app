"""Named pays (DESIGN.md § Income streams): a planned recurring money event the user states
first, that goals later attach to (#21) and the pay screen later records against (#24). This
issue only ever writes the stream and its expected deductions — never a transaction.
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, Category, IncomeStream, IncomeStreamDeduction, Payee, Transaction
from app.services.cadence import CADENCES, roll_forward


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
