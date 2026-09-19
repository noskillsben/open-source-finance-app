"""DESIGN.md § Accounts, § On-budget floor, § Balance checks → Opening balance."""
import datetime

import pytest
from sqlalchemy import select
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.db import get_session
from app.main import app
from app.models import Account, Transaction
from app.services.accounts import (
    account_balance_cents,
    create_account_with_opening_valuation,
    credit_limit_note,
    on_budget_cents,
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
    "balance_cents, floor_cents, expected_on_budget",
    [
        (0, 0, 0),
        # Savings, no floor.
        (10_000_00, 0, 10_000_00),
        # Chequing with a $500 overdraft floor, balance within it.
        (-200_00, -500_00, 300_00),
        # Credit card, $1,000 of budgetable credit: balance -250 -> 750 on-budget.
        (-250_00, -1_000_00, 750_00),
        # Same card past the floor: unclamped, on-budget money goes negative — no separate
        # "tracked debt" figure (DESIGN.md § On-budget floor, "the floor does not clamp").
        (-1_500_00, -1_000_00, -500_00),
    ],
)
def test_on_budget_floor_formula(balance_cents, floor_cents, expected_on_budget):
    assert on_budget_cents(balance_cents, floor_cents) == expected_on_budget


def test_credit_limit_note_is_silent_when_limit_is_unknown():
    assert credit_limit_note(-500_00, None) is None


def test_credit_limit_note_is_silent_when_balance_is_within_the_limit():
    assert credit_limit_note(-750_00, 1_000_00) is None


def test_credit_limit_note_warns_past_the_limit():
    assert credit_limit_note(-1_500_00, 1_000_00) is not None


def test_credit_limit_note_with_zero_limit_warns_below_zero():
    # 0 means no credit, not unknown (DESIGN.md § Credit limit — the floor of reality).
    assert credit_limit_note(-1_00, 0) is not None
    assert credit_limit_note(0, 0) is None


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def _account_body(**terms):
    return {
        "name": "Card", "type": "Credit card", "on_budget": True, "on_budget_floor_cents": 0,
        "created_on": "2026-03-01", "opening_balance_cents": 0, "terms": terms,
    }


def test_interest_rate_round_trips_as_an_exact_string_through_create_list_and_update(db_session):
    client = _client(db_session)
    try:
        created = client.post("/api/accounts", json=_account_body(annual_rate=5.99, deferred_rate="0"))
        account_id = created.json()["id"]
        listed = client.get("/api/accounts")
        body = _account_body(annual_rate=5.99)
        updated = client.put(
            f"/api/accounts/{account_id}",
            json={k: v for k, v in body.items() if k not in ("created_on", "opening_balance_cents")},
        )
    finally:
        app.dependency_overrides.clear()

    assert created.status_code == 201
    assert created.json()["terms"]["annual_rate"] == "5.9900"  # a string, not 5.99 or 5.989999...
    assert created.json()["terms"]["deferred_rate"] == "0.0000"  # a stated 0 stays 0
    listed_terms = next(a for a in listed.json() if a["id"] == account_id)["terms"]
    assert listed_terms["annual_rate"] == "5.9900"
    assert updated.status_code == 200
    assert updated.json()["terms"]["annual_rate"] == "5.9900"
    assert updated.json()["terms"]["deferred_rate"] is None  # update overwrote terms; unstated is unknown


def test_null_interest_rate_stays_null_through_the_api(db_session):
    client = _client(db_session)
    try:
        created = client.post("/api/accounts", json=_account_body())
        listed = client.get("/api/accounts")
    finally:
        app.dependency_overrides.clear()

    assert created.json()["terms"]["annual_rate"] is None
    assert created.json()["terms"]["deferred_rate"] is None
    assert listed.json()[0]["terms"]["annual_rate"] is None
