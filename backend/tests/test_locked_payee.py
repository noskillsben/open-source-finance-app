"""DESIGN.md § Payee-locked accounts: an outflow from a locked account that names a different
payee gets a note — never a refusal. The list carries the lock, from which the Accounts page
groups accounts that share a payee.
"""
import datetime

from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Payee
from app.services.accounts import create_account_with_opening_valuation

DAY = datetime.date(2026, 3, 1)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def _account(db_session, name, locked_payee_id=None, **kwargs):
    return create_account_with_opening_valuation(
        db_session, name=name, created_on=DAY, type="Cash", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=kwargs.pop("opening_balance_cents", 100_00),
        locked_payee_id=locked_payee_id,
    )


def _post(client, account_id, cents, payee_id):
    return client.post(
        "/api/transactions",
        json={
            "date": (DAY + datetime.timedelta(days=1)).isoformat(), "memo": None, "payee_id": payee_id,
            "account_lines": [{"account_id": account_id, "cents": cents}], "category_lines": [],
        },
    )


def _payees(db_session):
    starbucks, walmart = Payee(name="Starbucks", created_on=DAY), Payee(name="Walmart", created_on=DAY)
    db_session.add_all([starbucks, walmart])
    db_session.flush()
    return starbucks, walmart


def test_outflow_naming_a_different_payee_gets_a_note_and_is_still_saved(db_session):
    starbucks, walmart = _payees(db_session)
    card = _account(db_session, "Starbucks card", starbucks.id)
    client = _client(db_session)
    try:
        response = _post(client, card.id, -5_00, walmart.id)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201  # a warning, never a refusal
    assert response.json()["notes"] == ["Starbucks card is locked to Starbucks, but this names Walmart."]


def test_no_note_for_the_matching_payee_an_inflow_or_no_payee(db_session):
    starbucks, walmart = _payees(db_session)
    card = _account(db_session, "Starbucks card", starbucks.id)
    client = _client(db_session)
    try:
        matching = _post(client, card.id, -5_00, starbucks.id)
        inflow = _post(client, card.id, 20_00, walmart.id)  # money arriving, e.g. a transfer in
        no_payee = _post(client, card.id, -5_00, None)
    finally:
        app.dependency_overrides.clear()

    assert matching.json()["notes"] == []
    assert inflow.json()["notes"] == []
    assert no_payee.json()["notes"] == []


def test_an_unlocked_account_never_notes(db_session):
    _, walmart = _payees(db_session)
    cash = _account(db_session, "Cash")
    client = _client(db_session)
    try:
        response = _post(client, cash.id, -5_00, walmart.id)
    finally:
        app.dependency_overrides.clear()

    assert response.json()["notes"] == []


def test_the_list_carries_the_lock_so_shared_payees_can_group(db_session):
    starbucks, _ = _payees(db_session)
    physical = _account(db_session, "Starbucks card", starbucks.id)
    app_balance = _account(db_session, "Starbucks app", starbucks.id)
    plain = _account(db_session, "Cash")
    client = _client(db_session)
    try:
        listed = {a["id"]: a for a in client.get("/api/accounts").json()}
    finally:
        app.dependency_overrides.clear()

    assert listed[physical.id]["locked_payee_id"] == listed[app_balance.id]["locked_payee_id"] == starbucks.id
    assert listed[plain.id]["locked_payee_id"] is None


def test_an_archived_locked_payee_still_reads_and_still_notes(db_session):
    starbucks, walmart = _payees(db_session)
    card = _account(db_session, "Starbucks card", starbucks.id)
    starbucks.archived_on = datetime.date(2026, 2, 1)  # no new rule on archiving a payee accounts are locked to
    db_session.flush()
    client = _client(db_session)
    try:
        listed = next(a for a in client.get("/api/accounts").json() if a["id"] == card.id)
        response = _post(client, card.id, -5_00, walmart.id)
    finally:
        app.dependency_overrides.clear()

    assert listed["locked_payee_id"] == starbucks.id
    assert response.status_code == 201
    assert response.json()["notes"] == ["Starbucks card is locked to Starbucks, but this names Walmart."]


def test_create_and_edit_set_clear_and_keep_the_lock(db_session):
    starbucks, _ = _payees(db_session)
    client = _client(db_session)
    body = {
        "name": "Gift card", "created_on": DAY.isoformat(), "type": "Cash", "on_budget": True,
        "opening_balance_cents": 25_00, "locked_payee_id": starbucks.id,
    }
    try:
        created = client.post("/api/accounts", json=body).json()
        edit = {"name": "Gift card", "type": "Cash", "on_budget": True}
        kept = client.put(f"/api/accounts/{created['id']}", json=edit).json()  # omitted: unchanged
        cleared = client.put(f"/api/accounts/{created['id']}", json={**edit, "locked_payee_id": None}).json()
        unknown = client.put(f"/api/accounts/{created['id']}", json={**edit, "locked_payee_id": 9999})
    finally:
        app.dependency_overrides.clear()

    assert created["locked_payee_id"] == starbucks.id
    assert kept["locked_payee_id"] == starbucks.id
    assert cleared["locked_payee_id"] is None
    assert unknown.status_code == 400
