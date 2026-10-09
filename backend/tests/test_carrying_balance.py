"""DESIGN.md § Carrying a balance: the note on an account's row when part of a statement is
still unpaid after its due date. Read-time arithmetic over the terms and the ledger.
"""
import datetime

import pytest

from app.models import AccountLine, Transaction
from app.services.accounts import carried_statement_note, create_account_with_opening_valuation

D = datetime.date


def _card(db_session, *, close_day=15, grace_days=25, type="Credit card", created_on=D(2026, 1, 1)):
    card = create_account_with_opening_valuation(
        db_session, name="Card", created_on=created_on,
        type=type, on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    card.statement_close_day = close_day
    card.grace_days = grace_days
    db_session.flush()
    return card


def _line(db_session, account, day, cents):
    db_session.add(Transaction(
        date=day, memo=None, payee_id=None,
        account_lines=[AccountLine(account_id=account.id, cents=cents, budget_cents=0)],
        category_lines=[],
    ))
    db_session.flush()


def _note(db_session, card, as_of):
    return carried_statement_note(db_session, card, as_of)


def test_says_what_is_carried_once_the_due_date_has_passed(db_session):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)

    assert _note(db_session, card, D(2026, 10, 10)) == "Carrying $230.00 from the Sep 15 statement (due Oct 10)."


def test_silent_before_the_due_date(db_session):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)

    assert _note(db_session, card, D(2026, 10, 9)) is None


def test_zero_grace_days_is_due_on_the_close_date(db_session):
    card = _card(db_session, grace_days=0)
    _line(db_session, card, D(2026, 9, 1), -230_00)

    assert _note(db_session, card, D(2026, 9, 14)) is None
    assert _note(db_session, card, D(2026, 9, 15)) == "Carrying $230.00 from the Sep 15 statement (due Sep 15)."


def test_a_close_day_past_a_short_month_means_its_last_day(db_session):
    card = _card(db_session, close_day=31, grace_days=5)
    _line(db_session, card, D(2026, 2, 1), -100_00)

    assert _note(db_session, card, D(2026, 3, 5)) == "Carrying $100.00 from the Feb 28 statement (due Mar 5)."


def test_a_partial_payment_or_refund_reduces_what_is_carried(db_session):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)
    _line(db_session, card, D(2026, 9, 20), 100_00)
    _line(db_session, card, D(2026, 10, 2), 30_00)

    assert _note(db_session, card, D(2026, 10, 10)) == "Carrying $100.00 from the Sep 15 statement (due Oct 10)."


def test_paying_the_rest_late_clears_it(db_session):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)
    _line(db_session, card, D(2026, 10, 12), 230_00)

    assert _note(db_session, card, D(2026, 10, 11)) is not None
    assert _note(db_session, card, D(2026, 10, 12)) is None


def test_a_card_paid_in_full_says_nothing(db_session):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)
    _line(db_session, card, D(2026, 10, 5), 230_00)

    assert _note(db_session, card, D(2026, 10, 10)) is None


def test_payments_dated_on_the_close_day_are_part_of_the_statement_balance(db_session):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)
    _line(db_session, card, D(2026, 9, 15), 230_00)

    assert _note(db_session, card, D(2026, 10, 10)) is None


def test_the_latest_due_statement_counts(db_session):
    card = _card(db_session, grace_days=10)
    _line(db_session, card, D(2026, 8, 1), -100_00)
    _line(db_session, card, D(2026, 9, 1), -50_00)

    assert _note(db_session, card, D(2026, 9, 30)) == "Carrying $150.00 from the Sep 15 statement (due Sep 25)."


@pytest.mark.parametrize("close_day,grace_days", [(None, 25), (15, None), (None, None)])
def test_silent_when_a_term_is_unknown(db_session, close_day, grace_days):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)
    card.statement_close_day, card.grace_days = close_day, grace_days

    assert _note(db_session, card, D(2026, 10, 10)) is None


def test_silent_when_no_statement_has_closed_since_the_account_began(db_session):
    card = _card(db_session, created_on=D(2026, 9, 20))
    _line(db_session, card, D(2026, 9, 21), -230_00)

    assert _note(db_session, card, D(2026, 10, 10)) is None


def test_silent_when_the_statement_was_not_owing(db_session):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), 50_00)

    assert _note(db_session, card, D(2026, 10, 10)) is None


def test_silent_without_a_picker_date(db_session):
    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)

    assert _note(db_session, card, None) is None


def test_reads_the_terms_not_the_account_type(db_session):
    loan = _card(db_session, type="Loan")
    _line(db_session, loan, D(2026, 9, 1), -230_00)

    assert _note(db_session, loan, D(2026, 10, 10)) is not None


def test_the_account_row_carries_the_note(db_session):
    from fastapi.testclient import TestClient
    from app.db import get_session
    from app.main import app

    card = _card(db_session)
    _line(db_session, card, D(2026, 9, 1), -230_00)
    app.dependency_overrides[get_session] = lambda: db_session
    try:
        rows = TestClient(app).get("/api/accounts", params={"as_of": "2026-10-10"}).json()
    finally:
        app.dependency_overrides.clear()

    row = next(a for a in rows if a["id"] == card.id)
    assert "Carrying $230.00 from the Sep 15 statement (due Oct 10)." in row["notes"]
