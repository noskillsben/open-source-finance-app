"""#250: a loan I made, on terms (DESIGN.md § Transactions -> Money owed to me, § Account type).
The type is a label: on-budget by default, and every mechanism here is one an account already had."""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.account_types import ACCOUNT_TYPES
from app.db import get_session
from app.main import app
from app.models import Account, Category, Payee
from app.services.accounts import account_balance_cents, create_account_with_opening_valuation
from app.services.categories import category_balance_cents
from app.services.earmarks import move_money, ready_to_assign_cents
from app.services.splits import RECEIVABLE_TYPE

DAY = datetime.date(2026, 3, 1)


@pytest.fixture()
def client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _category(db_session, name):
    category = Category(name=name, created_on=DAY)
    db_session.add(category)
    db_session.flush()
    return category


def test_the_type_is_accepted_and_defaults_on_budget(client):
    assert ACCOUNT_TYPES["Money owed to me"] is True
    assert RECEIVABLE_TYPE == "Money owed to me"
    response = client.post("/api/accounts", json={
        "name": "Friend", "created_on": DAY.isoformat(), "type": "Money owed to me",
        "on_budget": True, "opening_balance_cents": 0,
    })
    assert response.status_code == 201
    assert response.json()["type"] == "Money owed to me"


def test_a_split_member_account_is_created_with_the_type(client, db_session):
    sam = Payee(name="Sam", created_on=DAY)
    db_session.add(sam)
    db_session.flush()
    response = client.post("/api/splits", json={
        "name": "Rent", "created_on": DAY.isoformat(), "members": [{"payee_id": sam.id, "percent": "50"}],
    })
    assert response.status_code == 201
    account = db_session.get(Account, response.json()["members"][0]["account_id"])
    assert (account.type, account.on_budget) == ("Money owed to me", True)


def test_lend_and_repay_with_interest(client, db_session):
    chequing = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=3000_00,
    )
    fund = _category(db_session, "Emergency fund")
    interest = _category(db_session, "Interest income")
    friend_payee = Payee(name="Friend", created_on=DAY)
    db_session.add(friend_payee)
    db_session.flush()
    move_money(db_session, move_date=DAY, from_category_id=None, to_category_id=fund.id, cents=2000_00)

    # one form: borrower (locked payee), terms, then the link
    created = client.post("/api/accounts", json={
        "name": "Loan to Friend", "created_on": DAY.isoformat(), "type": "Money owed to me",
        "on_budget": True, "opening_balance_cents": 0, "locked_payee_id": friend_payee.id,
        "terms": {"annual_rate": "3", "credit_limit_cents": 2000_00},
    })
    assert created.status_code == 201
    friend = db_session.get(Account, created.json()["id"])
    assert friend.locked_payee_id == friend_payee.id and friend.annual_rate is not None
    link = client.put(
        f"/api/categories/{fund.id}/linked-accounts",
        json={"on": DAY.isoformat(), "account_ids": [friend.id]},
    )
    assert link.status_code == 200
    ready_before = ready_to_assign_cents(db_session, as_of=DAY)

    # lend: a plain transfer; "already earmarked" writes nothing, so the fund keeps holding it
    lend = client.post("/api/transactions", json={
        "date": DAY.isoformat(), "deposits": [],
        "account_lines": [{"account_id": chequing.id, "cents": -2000_00}, {"account_id": friend.id, "cents": 2000_00}],
        "category_lines": [],
    })
    assert lend.status_code == 201
    assert account_balance_cents(db_session, friend.id, as_of=DAY) == 2000_00
    assert category_balance_cents(db_session, fund.id, as_of=DAY) == 2000_00
    assert ready_to_assign_cents(db_session, as_of=DAY) == ready_before

    # spending the fund warns that the money is with the account
    spend = client.post("/api/transactions", json={
        "date": DAY.isoformat(),
        "account_lines": [{"account_id": chequing.id, "cents": -50_00}],
        "category_lines": [{"category_id": fund.id, "cents": -50_00}],
    })
    assert spend.status_code == 201
    assert any("Emergency fund's money is in" in n and "Loan to Friend" in n for n in spend.json()["notes"])

    # repay: Friend -160, Chequing +165, Interest income +5; the principal goes back to the fund
    # (it never left, so "none"), the interest is income that arrives in ready to assign
    ready_before = ready_to_assign_cents(db_session, as_of=DAY)
    repay = client.post("/api/transactions", json={
        "date": DAY.isoformat(), "deposits": [],
        "account_lines": [{"account_id": friend.id, "cents": -160_00}, {"account_id": chequing.id, "cents": 165_00}],
        "category_lines": [{"category_id": interest.id, "cents": 5_00}],
    })
    assert repay.status_code == 201, repay.text
    assert account_balance_cents(db_session, friend.id, as_of=DAY) == 1840_00
    assert category_balance_cents(db_session, interest.id, as_of=DAY) == 5_00
    assert category_balance_cents(db_session, fund.id, as_of=DAY) == 1950_00
    assert ready_to_assign_cents(db_session, as_of=DAY) == ready_before  # interest is held by its category

    # the withdrawal prompt: the principal returns to ready to assign instead
    repay2 = client.post("/api/transactions", json={
        "date": DAY.isoformat(),
        "deposits": [{"category_id": fund.id, "cents": 40_00}],
        "account_lines": [{"account_id": friend.id, "cents": -40_00}, {"account_id": chequing.id, "cents": 40_00}],
        "category_lines": [],
    })
    assert repay2.status_code == 201, repay2.text
    assert account_balance_cents(db_session, friend.id, as_of=DAY) == 1800_00
    assert category_balance_cents(db_session, fund.id, as_of=DAY) == 1910_00
    assert ready_to_assign_cents(db_session, as_of=DAY) == ready_before + 40_00
