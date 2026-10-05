"""DESIGN.md § Splits → The Splits page: a member's balance at the picker date and the
transactions since it last stood at zero. Worked out from the ledger at read time; nothing
marks a settle-up.
"""
import datetime

from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.services.accounts import create_account_with_opening_valuation

DAY = datetime.date(2026, 3, 1)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def _account(db_session, name):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()
    return account


def _move(client, chequing, owed, day, cents, memo):
    """A transfer: `cents` on the member's account, the opposite on mine."""
    response = client.post("/api/transactions", json={
        "date": day, "memo": memo, "category_lines": [],
        "account_lines": [{"account_id": owed.id, "cents": cents}, {"account_id": chequing.id, "cents": -cents}],
    })
    assert response.status_code == 201, response.text


def _balance(client, owed, as_of=None):
    params = {"as_of": as_of} if as_of else {}
    response = client.get(f"/api/splits/accounts/{owed.id}/balance", params=params)
    assert response.status_code == 200, response.text
    body = response.json()
    return body["balance_cents"], [t["memo"] for t in body["transactions"]]


def _setup(db_session):
    return _client(db_session), _account(db_session, "Chequing"), _account(db_session, "Roommate")


def test_never_at_zero_lists_from_the_first_line(db_session):
    client, chequing, owed = _setup(db_session)
    try:
        _move(client, chequing, owed, "2026-03-02", 5000, "heat")
        _move(client, chequing, owed, "2026-03-05", 2500, "power")
        assert _balance(client, owed) == (7500, ["heat", "power"])
    finally:
        app.dependency_overrides.clear()


def test_a_partial_payment_keeps_the_list_running(db_session):
    client, chequing, owed = _setup(db_session)
    try:
        _move(client, chequing, owed, "2026-03-02", 5000, "heat")
        _move(client, chequing, owed, "2026-03-05", -2000, "part payment")
        assert _balance(client, owed) == (3000, ["heat", "part payment"])
    finally:
        app.dependency_overrides.clear()


def test_a_cleared_balance_gives_an_empty_list(db_session):
    client, chequing, owed = _setup(db_session)
    try:
        _move(client, chequing, owed, "2026-03-02", 5000, "heat")
        _move(client, chequing, owed, "2026-03-05", -5000, "settled")
        assert _balance(client, owed) == (0, [])
    finally:
        app.dependency_overrides.clear()


def test_the_list_starts_after_the_last_time_the_balance_stood_at_zero(db_session):
    client, chequing, owed = _setup(db_session)
    try:
        _move(client, chequing, owed, "2026-03-02", 5000, "old heat")
        _move(client, chequing, owed, "2026-03-05", -5000, "settled")
        _move(client, chequing, owed, "2026-03-09", 1200, "new power")
        assert _balance(client, owed) == (1200, ["new power"])
    finally:
        app.dependency_overrides.clear()


def test_a_balance_that_flips_sign_through_zero_is_not_a_standing_zero(db_session):
    client, chequing, owed = _setup(db_session)
    try:
        _move(client, chequing, owed, "2026-03-02", 5000, "heat")
        _move(client, chequing, owed, "2026-03-05", -7000, "overpaid")  # I now owe them 20.00
        assert _balance(client, owed) == (-2000, ["heat", "overpaid"])
    finally:
        app.dependency_overrides.clear()


def test_lines_netting_to_zero_within_one_day_are_not_a_standing_balance(db_session):
    client, chequing, owed = _setup(db_session)
    try:
        _move(client, chequing, owed, "2026-03-02", 5000, "heat")
        _move(client, chequing, owed, "2026-03-05", -5000, "paid in the morning")
        _move(client, chequing, owed, "2026-03-05", 3000, "billed again that evening")
        # End of day 3-05 the balance is 30.00, not zero, so the day's earlier clearing is no boundary.
        assert _balance(client, owed) == (3000, ["heat", "paid in the morning", "billed again that evening"])
    finally:
        app.dependency_overrides.clear()


def test_future_dated_rows_are_excluded_by_the_picker_date(db_session):
    client, chequing, owed = _setup(db_session)
    try:
        _move(client, chequing, owed, "2026-03-02", 5000, "heat")
        _move(client, chequing, owed, "2026-04-01", -5000, "settled later")
        assert _balance(client, owed, "2026-03-20") == (5000, ["heat"])
        assert _balance(client, owed, "2026-04-01") == (0, [])
    finally:
        app.dependency_overrides.clear()


def test_an_unknown_account_is_a_404(db_session):
    client = _client(db_session)
    try:
        assert client.get("/api/splits/accounts/999999/balance").status_code == 404
    finally:
        app.dependency_overrides.clear()
