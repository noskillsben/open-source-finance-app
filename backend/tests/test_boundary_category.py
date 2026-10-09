"""DESIGN.md § Accounts → Money crossing the budget boundary: a tracking account may name the
category money leaves the budget through. The invariant is untouched — the category lines of a
loan payment still sum to the budget movement — so the setting only rides on the account.
"""
import datetime

from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category

DAY = datetime.date(2026, 3, 1)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def _category(db_session, name, **kwargs):
    category = Category(name=name, created_on=DAY, **kwargs)
    db_session.add(category)
    db_session.flush()
    return category


def _body(name, type_, on_budget, **extra):
    return {
        "name": name, "created_on": DAY.isoformat(), "type": type_, "on_budget": on_budget,
        "opening_balance_cents": 0, **extra,
    }


def test_create_and_edit_set_clear_and_keep_the_boundary_category(db_session):
    debt = _category(db_session, "Debt payments", seeded_key="debt-payments")
    client = _client(db_session)
    try:
        created = client.post("/api/accounts", json=_body("Car loan", "Loan", False, boundary_category_id=debt.id)).json()
        edit = {"name": "Car loan", "type": "Loan", "on_budget": False}
        kept = client.put(f"/api/accounts/{created['id']}", json=edit).json()  # omitted: unchanged
        cleared = client.put(f"/api/accounts/{created['id']}", json={**edit, "boundary_category_id": None}).json()
        listed = client.get("/api/accounts").json()
    finally:
        app.dependency_overrides.clear()

    assert created["boundary_category_id"] == debt.id
    assert kept["boundary_category_id"] == debt.id
    assert cleared["boundary_category_id"] is None
    assert listed[0]["boundary_category_id"] is None


def test_an_unknown_or_archived_category_is_a_4xx(db_session):
    old = _category(db_session, "Old", archived_on=DAY)
    client = _client(db_session)
    try:
        unknown = client.post("/api/accounts", json=_body("Loan A", "Loan", False, boundary_category_id=9999))
        archived = client.post("/api/accounts", json=_body("Loan B", "Loan", False, boundary_category_id=old.id))
        plain = client.post("/api/accounts", json=_body("Loan C", "Loan", False)).json()
        edit_unknown = client.put(
            f"/api/accounts/{plain['id']}",
            json={"name": "Loan C", "type": "Loan", "on_budget": False, "boundary_category_id": 9999},
        )
    finally:
        app.dependency_overrides.clear()

    assert unknown.status_code == archived.status_code == edit_unknown.status_code == 400
    assert plain["boundary_category_id"] is None  # nothing is backfilled or defaulted by the API


def test_the_category_list_carries_the_seeded_key_for_the_form_default(db_session):
    _category(db_session, "Debt payments", seeded_key="debt-payments")
    client = _client(db_session)
    try:
        listed = client.get("/api/categories").json()
    finally:
        app.dependency_overrides.clear()

    assert [c["seeded_key"] for c in listed] == ["debt-payments"]


def test_a_loan_payment_saves_through_the_api_with_a_boundary_account(db_session):
    debt = _category(db_session, "Debt payments")
    interest = _category(db_session, "Interest")
    client = _client(db_session)
    try:
        chequing = client.post("/api/accounts", json=_body("Chequing", "Chequing", True)).json()
        loan = client.post("/api/accounts", json=_body("Car loan", "Loan", False, boundary_category_id=debt.id)).json()
        response = client.post("/api/transactions", json={
            "date": DAY.isoformat(), "memo": None, "payee_id": None,
            "account_lines": [{"account_id": chequing["id"], "cents": -450_00}, {"account_id": loan["id"], "cents": 380_00}],
            "category_lines": [{"category_id": debt.id, "cents": -380_00}, {"category_id": interest.id, "cents": -70_00}],
        })
        draw = client.post("/api/transactions", json={
            "date": DAY.isoformat(), "memo": None, "payee_id": None,
            "account_lines": [{"account_id": chequing["id"], "cents": 500_00}, {"account_id": loan["id"], "cents": -500_00}],
            "category_lines": [],
        })
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert draw.status_code == 201
