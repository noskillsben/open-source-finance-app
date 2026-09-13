"""DESIGN.md § Accounts, § On-budget floor, § Balance checks → Opening balance."""
import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Account
from app.services.accounts import (
    account_balance_cents,
    create_account_with_opening_valuation,
    on_budget_cents,
    tracked_debt_cents,
)


def test_account_names_are_unique_case_insensitively(db_session):
    create_account_with_opening_valuation(
        db_session, name="TD Chequing", created_on=datetime.date(2026, 1, 1),
        type="Chequing", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=100_00,
    )
    db_session.flush()

    with pytest.raises(IntegrityError):
        create_account_with_opening_valuation(
            db_session, name="td chequing", created_on=datetime.date(2026, 1, 2),
            type="Chequing", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=1_00,
        )
        db_session.flush()


def test_opening_valuation_is_created_with_the_account(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Cash", created_on=datetime.date(2026, 3, 15),
        type="Cash", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=5_000,
    )
    db_session.flush()

    assert len(account.valuations) == 1
    valuation = account.valuations[0]
    assert valuation.date == account.created_on
    assert valuation.balance_cents == 5_000
    assert account_balance_cents(account) == 5_000


def test_debt_terms_default_to_null_not_zero(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="New Card", created_on=datetime.date(2026, 1, 1),
        type="Credit card", on_budget=True, on_budget_floor_cents=-1_000_00, opening_balance_cents=0,
    )
    db_session.flush()

    assert account.annual_rate is None
    assert account.credit_limit_cents is None


@pytest.mark.parametrize(
    "balance_cents, floor_cents, expected_on_budget, expected_tracked_debt",
    [
        (0, 0, 0, 0),
        # Savings, no floor.
        (10_000_00, 0, 10_000_00, 0),
        # Chequing with a $500 overdraft floor, balance within it.
        (-200_00, -500_00, 300_00, 0),
        # Credit card, $1,000 of budgetable credit: balance -250 -> 750 on-budget, no tracked debt.
        (-250_00, -1_000_00, 750_00, 0),
        # Same card past the floor: balance -1,500 -> 0 on-budget, 500 tracked debt.
        (-1_500_00, -1_000_00, 0, -500_00),
    ],
)
def test_on_budget_floor_formula(balance_cents, floor_cents, expected_on_budget, expected_tracked_debt):
    assert on_budget_cents(balance_cents, floor_cents) == expected_on_budget
    assert tracked_debt_cents(balance_cents, floor_cents) == expected_tracked_debt
