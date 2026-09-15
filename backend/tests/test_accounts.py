"""DESIGN.md § Accounts, § On-budget floor, § Balance checks → Opening balance."""
import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Account, Transaction
from app.services.accounts import (
    account_balance_cents,
    create_account_with_opening_valuation,
    on_budget_cents,
    tracked_debt_cents,
    update_account,
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
    assert account_balance_cents(db_session, account.id) == 5_000


def test_opening_adjustment_transaction_is_written_with_the_account(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Cash", created_on=datetime.date(2026, 3, 15),
        type="Cash", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=5_000,
    )
    db_session.flush()

    valuation = account.valuations[0]
    txn = db_session.scalar(select(Transaction).where(Transaction.valuation_id == valuation.id))

    assert txn is not None
    assert txn.date == account.created_on
    assert txn.valuation_id == valuation.id
    assert len(txn.account_lines) == 1
    assert txn.account_lines[0].account_id == account.id
    assert txn.account_lines[0].cents == 5_000
    assert txn.account_lines[0].budget_cents == 5_000  # unassigned inflow, on-budget
    assert txn.category_lines == []  # the invariant holds: budget movement 5_000, no categories
    assert account_balance_cents(db_session, account.id) == 5_000  # unchanged from before this change


def test_opening_adjustment_on_tracking_account_lands_off_budget(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Car loan", created_on=datetime.date(2026, 3, 15),
        type="Loan", on_budget=False, on_budget_floor_cents=0, opening_balance_cents=-5_000_00,
    )
    db_session.flush()

    valuation = account.valuations[0]
    txn = db_session.scalar(select(Transaction).where(Transaction.valuation_id == valuation.id))

    assert txn.account_lines[0].budget_cents == 0


def test_debt_terms_default_to_null_not_zero(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="New Card", created_on=datetime.date(2026, 1, 1),
        type="Credit card", on_budget=True, on_budget_floor_cents=-1_000_00, opening_balance_cents=0,
    )
    db_session.flush()

    assert account.annual_rate is None
    assert account.credit_limit_cents is None


def test_editing_settings_does_not_change_budget_cents_on_existing_lines(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Card", created_on=datetime.date(2026, 1, 1),
        type="Credit card", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=-200_00,
    )
    db_session.flush()
    valuation = account.valuations[0]
    txn = db_session.scalar(select(Transaction).where(Transaction.valuation_id == valuation.id))
    original_budget_cents = txn.account_lines[0].budget_cents

    update_account(
        account, name="Card", type="Credit card", on_budget=False, on_budget_floor_cents=-1_000_00,
    )
    db_session.flush()

    db_session.refresh(txn)
    assert txn.account_lines[0].budget_cents == original_budget_cents
    assert account.on_budget_floor_cents == -1_000_00
    assert account.on_budget is False


def test_renaming_to_a_taken_name_case_insensitively_is_refused(db_session):
    create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=datetime.date(2026, 1, 1),
        type="Chequing", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()
    savings = create_account_with_opening_valuation(
        db_session, name="Savings", created_on=datetime.date(2026, 1, 1),
        type="Savings", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()

    update_account(savings, name="chequing", type="Savings", on_budget=True, on_budget_floor_cents=0)
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_renaming_to_its_own_current_name_succeeds(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=datetime.date(2026, 1, 1),
        type="Chequing", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()

    update_account(account, name="Chequing", type="Chequing", on_budget=True, on_budget_floor_cents=100_00)
    db_session.flush()

    assert account.on_budget_floor_cents == 100_00


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
