"""Route-level wiring for `GET /api/accounts` (DESIGN.md § General concepts, One clock:
the date picker). `account_balance_cents` itself is covered in test_accounts.py; this
checks the `as_of` query param actually reaches it.
"""
import datetime

from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import AccountLine, Category, Payee, Transaction
from app.services.accounts import account_balance_cents, create_account_with_opening_valuation
from app.services.transactions import write_transaction

EARLIER = datetime.date(2026, 3, 1)
LATER = datetime.date(2026, 3, 15)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def test_accounts_as_of_reflects_balance_on_that_date_not_today(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -100_00}],
        category_lines=[],
    )
    db_session.flush()

    client = _client(db_session)
    try:
        as_of_earlier = client.get(f"/api/accounts?as_of={EARLIER.isoformat()}")
        as_of_later = client.get(f"/api/accounts?as_of={LATER.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert as_of_earlier.status_code == 200
    earlier_balance = next(a for a in as_of_earlier.json() if a["id"] == account.id)["balance_cents"]
    later_balance = next(a for a in as_of_later.json() if a["id"] == account.id)["balance_cents"]

    assert earlier_balance == 500_00  # the -100 line, dated after EARLIER, isn't counted yet
    assert later_balance == 400_00


def test_edit_transaction_via_put_changes_balance_on_every_relevant_date(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    groceries = Category(name="Groceries")
    db_session.add(groceries)
    db_session.flush()
    txn = write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[{"category_id": groceries.id, "cents": -80_00}],
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.put(
            f"/api/transactions/{txn.id}",
            json={
                "date": LATER.isoformat(),
                "memo": "corrected",
                "payee_id": None,
                "account_lines": [{"account_id": account.id, "cents": -50_00}],
                "category_lines": [{"category_id": groceries.id, "cents": -50_00}],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert account_balance_cents(db_session, account.id, as_of=LATER) == 450_00


def test_delete_transaction_removes_its_lines_from_the_balance(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    txn = write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[],
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.delete(f"/api/transactions/{txn.id}")
        follow_up = client.get("/api/transactions")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 204
    assert all(t["id"] != txn.id for t in follow_up.json())
    assert account_balance_cents(db_session, account.id, as_of=LATER) == 500_00


def test_put_account_updates_settings_and_leaves_existing_lines_alone(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Card", created_on=EARLIER, type="Credit card",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=-200_00,
    )
    db_session.flush()
    original_budget_cents = account_balance_cents(db_session, account.id)

    client = _client(db_session)
    try:
        # No "terms" key at all — matches what the edit form actually sends.
        resp = client.put(
            f"/api/accounts/{account.id}",
            json={
                "name": "Card",
                "type": "Credit card",
                "on_budget": True,
                "on_budget_floor_cents": -1_000_00,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["on_budget_floor_cents"] == -1_000_00
    assert account_balance_cents(db_session, account.id) == original_budget_cents  # lines untouched


def test_put_account_without_terms_key_leaves_existing_terms_alone(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Card", created_on=EARLIER, type="Credit card",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=-200_00,
    )
    account.annual_rate = 19.99
    account.credit_limit_cents = 5_000_00
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.put(
            f"/api/accounts/{account.id}",
            json={"name": "Card", "type": "Credit card", "on_budget": True, "on_budget_floor_cents": 0},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    db_session.refresh(account)
    assert float(account.annual_rate) == 19.99
    assert account.credit_limit_cents == 5_000_00


def test_put_account_with_terms_key_overwrites_existing_terms(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Card", created_on=EARLIER, type="Credit card",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=-200_00,
    )
    account.annual_rate = 19.99
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.put(
            f"/api/accounts/{account.id}",
            json={
                "name": "Card", "type": "Credit card", "on_budget": True, "on_budget_floor_cents": 0,
                "terms": {"annual_rate": 24.99},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    db_session.refresh(account)
    assert float(account.annual_rate) == 24.99


def test_put_account_renaming_to_taken_name_is_409(db_session):
    create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    savings = create_account_with_opening_valuation(
        db_session, name="Savings", created_on=EARLIER, type="Savings",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.put(
            f"/api/accounts/{savings.id}",
            json={"name": "chequing", "type": "Savings", "on_budget": True, "on_budget_floor_cents": 0, "terms": {}},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 409


def test_put_account_missing_is_404(db_session):
    client = _client(db_session)
    try:
        resp = client.put(
            "/api/accounts/999999",
            json={"name": "Nope", "type": "Cash", "on_budget": True, "on_budget_floor_cents": 0, "terms": {}},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 404


def test_delete_missing_transaction_is_404(db_session):
    client = _client(db_session)
    try:
        resp = client.delete("/api/transactions/999999")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 404


def test_delete_opening_adjustment_is_refused_and_leaves_it_in_place(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()
    adjustment = (
        db_session.query(Transaction)
        .join(AccountLine, AccountLine.transaction_id == Transaction.id)
        .filter(AccountLine.account_id == account.id, Transaction.valuation_id.isnot(None))
        .one()
    )

    client = _client(db_session)
    try:
        resp = client.delete(f"/api/transactions/{adjustment.id}")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 400
    assert "opening-balance adjustment" in resp.json()["detail"]
    assert account_balance_cents(db_session, account.id) == 500_00


def test_post_payee_creates_it_and_rejects_duplicate_name(db_session):
    client = _client(db_session)
    try:
        first = client.post("/api/payees", json={"name": "Walmart", "created_on": EARLIER.isoformat()})
        listed = client.get("/api/payees")
        dup = client.post("/api/payees", json={"name": "walmart", "created_on": EARLIER.isoformat()})
    finally:
        app.dependency_overrides.clear()

    assert first.status_code == 201
    assert dup.status_code == 409
    assert any(p["name"] == "Walmart" for p in listed.json())


def test_post_transaction_with_payee_id_round_trips(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    payee = Payee(name="Walmart", created_on=EARLIER)
    db_session.add(payee)
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.post(
            "/api/transactions",
            json={
                "date": LATER.isoformat(),
                "memo": None,
                "payee_id": payee.id,
                "account_lines": [{"account_id": account.id, "cents": -80_00}],
                "category_lines": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 201
    assert resp.json()["payee_id"] == payee.id


def test_edit_still_enforces_category_lines_must_sum_to_budget_movement(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    groceries = Category(name="Groceries")
    db_session.add(groceries)
    db_session.flush()
    txn = write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[{"category_id": groceries.id, "cents": -80_00}],
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.put(
            f"/api/transactions/{txn.id}",
            json={
                "date": LATER.isoformat(),
                "memo": None,
                "payee_id": None,
                "account_lines": [{"account_id": account.id, "cents": -80_00}],
                "category_lines": [{"category_id": groceries.id, "cents": -70_00}],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 400
