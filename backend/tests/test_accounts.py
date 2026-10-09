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


def _listed_account(db_session, account_id):
    client = _client(db_session)
    try:
        return next(a for a in client.get("/api/accounts").json() if a["id"] == account_id)
    finally:
        app.dependency_overrides.clear()


def test_a_card_with_a_balance_and_a_floor_of_zero_shows_no_note(db_session):
    card = create_account_with_opening_valuation(
        db_session, name="Card", created_on=datetime.date(2026, 1, 1),
        type="Credit card", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=-300_00,
    )
    card.credit_limit_cents = 1_000_00
    db_session.flush()

    assert _listed_account(db_session, card.id)["notes"] == []


def test_an_account_past_its_credit_limit_still_warns(db_session):
    card = create_account_with_opening_valuation(
        db_session, name="Card", created_on=datetime.date(2026, 1, 1),
        type="Credit card", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=-1_500_00,
    )
    card.credit_limit_cents = 1_000_00
    db_session.flush()

    assert _listed_account(db_session, card.id)["notes"] == ["This balance is past the credit limit."]


def _post_terms(db_session, **terms):
    client = _client(db_session)
    try:
        return client.post("/api/accounts", json=_account_body(**terms))
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "terms",
    [
        {"statement_close_day": 0},
        {"statement_close_day": 32},
        {"grace_days": -1},
        {"annual_rate": -0.01},
        {"deferred_rate": "-1"},
        {"annual_rate": "100000"},
        {"compounding_rule": "weekly"},
        {"prepayment_model": "whenever"},
    ],
)
def test_a_term_outside_its_range_is_a_422(db_session, terms):
    assert _post_terms(db_session, **terms).status_code == 422


@pytest.mark.parametrize(
    "terms",
    [
        {"statement_close_day": 1},
        {"statement_close_day": 31},
        {"grace_days": 0},
        {"annual_rate": 0},
        {"compounding_rule": "daily"},
        {"compounding_rule": "monthly"},
        {"compounding_rule": "semi-annual"},
        {"prepayment_model": "open"},
        {"prepayment_model": "closed with privileges"},
        {"prepayment_model": "penalty"},
        {"minimum_payment_rule": "greater of $10 or 3% of the balance"},
    ],
)
def test_a_term_inside_its_range_is_accepted(db_session, terms):
    assert _post_terms(db_session, **terms).status_code == 201


def test_a_rate_is_rounded_half_even_to_four_places(db_session):
    created = _post_terms(db_session, annual_rate="5.00005", deferred_rate="5.00015")
    assert created.json()["terms"]["annual_rate"] == "5.0000"  # tie goes to the even digit
    assert created.json()["terms"]["deferred_rate"] == "5.0002"


def test_zero_and_blank_round_trip_as_different_answers(db_session):
    created = _post_terms(db_session, grace_days=0, annual_rate=0, statement_close_day=None)
    terms = created.json()["terms"]
    assert terms["grace_days"] == 0
    assert terms["annual_rate"] == "0.0000"
    assert terms["statement_close_day"] is None
    assert terms["deferred_rate"] is None
    assert terms["credit_limit_cents"] is None


def test_an_update_that_omits_terms_leaves_the_existing_terms_alone(db_session):
    client = _client(db_session)
    try:
        created = client.post(
            "/api/accounts", json=_account_body(annual_rate="5.99", grace_days=21, compounding_rule="daily")
        )
        updated = client.put(
            f"/api/accounts/{created.json()['id']}",
            json={"name": "Renamed", "type": "Credit card", "on_budget": True, "on_budget_floor_cents": 0},
        )
    finally:
        app.dependency_overrides.clear()

    assert updated.status_code == 200
    assert updated.json()["name"] == "Renamed"
    assert updated.json()["terms"]["annual_rate"] == "5.9900"
    assert updated.json()["terms"]["grace_days"] == 21
    assert updated.json()["terms"]["compounding_rule"] == "daily"


def test_an_update_with_an_invalid_term_is_a_422_and_changes_nothing(db_session):
    client = _client(db_session)
    try:
        created = client.post("/api/accounts", json=_account_body(grace_days=21))
        updated = client.put(
            f"/api/accounts/{created.json()['id']}",
            json={
                "name": "Card", "type": "Credit card", "on_budget": True, "on_budget_floor_cents": 0,
                "terms": {"grace_days": -3},
            },
        )
        listed = client.get("/api/accounts")
    finally:
        app.dependency_overrides.clear()

    assert updated.status_code == 422
    assert listed.json()[0]["terms"]["grace_days"] == 21
