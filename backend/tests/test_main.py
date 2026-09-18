"""Route-level wiring for `GET /api/accounts` (DESIGN.md § General concepts, One clock:
the date picker). `account_balance_cents` itself is covered in test_accounts.py; this
checks the `as_of` query param actually reaches it.
"""
import datetime

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_session
from app.main import app
from app.models import AccountLine, Category, Payee, Transaction, Valuation
from app.services.accounts import account_balance_cents, create_account_with_opening_valuation
from app.services.transactions import write_transaction
from app.services.valuations import check_balance

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
    groceries = Category(name="Groceries", created_on=EARLIER)
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


def test_put_account_floor_below_credit_limit_is_400(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Card", created_on=EARLIER, type="Credit card",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    account.credit_limit_cents = 500_00
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.put(
            f"/api/accounts/{account.id}",
            json={
                "name": "Card", "type": "Credit card", "on_budget": True,
                "on_budget_floor_cents": -600_00,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 400


def test_post_account_floor_below_credit_limit_is_400(db_session):
    client = _client(db_session)
    try:
        resp = client.post(
            "/api/accounts",
            json={
                "name": "Card", "created_on": EARLIER.isoformat(), "type": "Credit card",
                "on_budget": True, "on_budget_floor_cents": -600_00, "opening_balance_cents": 0,
                "terms": {"credit_limit_cents": 500_00},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 400


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


def test_balance_check_matching_writes_no_adjustment(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.post(
            f"/api/accounts/{account.id}/balance-check",
            json={"date": LATER.isoformat(), "stated_balance_cents": 500_00},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["diff_cents"] == 0
    assert body["transaction"] is None
    assert body["account"]["checked_on"] == LATER.isoformat()


def test_balance_check_mismatch_with_category_creates_adjustment(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    missed = Category(name="Missed transactions", created_on=EARLIER)
    db_session.add(missed)
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.post(
            f"/api/accounts/{account.id}/balance-check",
            json={"date": LATER.isoformat(), "stated_balance_cents": 480_00, "category_id": missed.id},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["diff_cents"] == -20_00
    assert body["transaction"]["category_lines"] == [
        {"id": body["transaction"]["category_lines"][0]["id"], "category_id": missed.id, "cents": -20_00, "need_level": None}
    ]
    assert body["transaction"]["valuation_id"] == body["valuation_id"]


def test_transaction_dated_on_or_before_a_check_gets_a_note(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        client.post(
            f"/api/accounts/{account.id}/balance-check",
            json={"date": LATER.isoformat(), "stated_balance_cents": 500_00},
        )
        resp = client.post(
            "/api/transactions",
            json={
                "date": EARLIER.isoformat(),
                "memo": None,
                "payee_id": None,
                "account_lines": [{"account_id": account.id, "cents": -10_00}],
                "category_lines": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 201
    assert len(resp.json()["notes"]) == 1
    assert "check on Chequing" in resp.json()["notes"][0]


def test_wallet_spending_past_its_credit_limit_warns_and_still_saves(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Wallet", created_on=EARLIER, type="Cash",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=100_00,
    )
    account.credit_limit_cents = 0
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.post(
            "/api/transactions",
            json={
                "date": LATER.isoformat(),
                "memo": None,
                "payee_id": None,
                "account_lines": [{"account_id": account.id, "cents": -200_00}],
                "category_lines": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 201  # a warning, never a block, on the recording surface
    assert any("credit limit" in note for note in resp.json()["notes"])
    assert account_balance_cents(db_session, account.id) == -100_00


def test_card_save_past_its_limit_warns(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Card", created_on=EARLIER, type="Credit card",
        on_budget=True, on_budget_floor_cents=-500_00, opening_balance_cents=-400_00,
    )
    account.credit_limit_cents = 500_00
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.post(
            "/api/transactions",
            json={
                "date": LATER.isoformat(),
                "memo": None,
                "payee_id": None,
                "account_lines": [{"account_id": account.id, "cents": -200_00}],
                "category_lines": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 201
    assert any("credit limit" in note for note in resp.json()["notes"])


def test_null_credit_limit_stays_silent(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Card", created_on=EARLIER, type="Credit card",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=-100_00,
    )
    db_session.flush()
    assert account.credit_limit_cents is None

    client = _client(db_session)
    try:
        resp = client.post(
            "/api/transactions",
            json={
                "date": LATER.isoformat(),
                "memo": None,
                "payee_id": None,
                "account_lines": [{"account_id": account.id, "cents": -900_00}],
                "category_lines": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 201
    assert resp.json()["notes"] == []


def test_backfilling_an_older_transaction_shows_a_breach_on_the_account_page_with_no_save_involved(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Card", created_on=EARLIER, type="Credit card",
        on_budget=True, on_budget_floor_cents=-100_00, opening_balance_cents=-50_00,
    )
    account.credit_limit_cents = 100_00
    db_session.flush()

    later_date = LATER
    client = _client(db_session)
    try:
        client.post(
            "/api/transactions",
            json={
                "date": later_date.isoformat(),
                "memo": None,
                "payee_id": None,
                "account_lines": [{"account_id": account.id, "cents": -40_00}],
                "category_lines": [],
            },
        )
        # Backfilled between the opening and the later transaction — on its own date the
        # balance doesn't breach, so the save itself carries no credit-limit note.
        backfill_date = datetime.date(2026, 3, 5)
        backfill_resp = client.post(
            "/api/transactions",
            json={
                "date": backfill_date.isoformat(),
                "memo": None,
                "payee_id": None,
                "account_lines": [{"account_id": account.id, "cents": -20_00}],
                "category_lines": [],
            },
        )
        listing = client.get("/api/accounts")
    finally:
        app.dependency_overrides.clear()

    assert backfill_resp.status_code == 201
    assert not any("credit limit" in note for note in backfill_resp.json()["notes"])

    card = next(a for a in listing.json() if a["id"] == account.id)
    assert card["balance_cents"] == -110_00  # -50 - 40 - 20, past the -100 limit
    assert any("credit limit" in note for note in card["notes"])


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
    groceries = Category(name="Groceries", created_on=EARLIER)
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


def test_delete_balance_checks_own_adjustment_via_transaction_route_now_succeeds(db_session):
    """The old guard refused any transaction with a `valuation_id`, so a balance-check
    adjustment (not the opening one) could never be deleted. Narrowed to the opening
    adjustment specifically (DESIGN.md § Balance checks — "Nothing is locked").
    """
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()
    _, adjustment, diff = check_balance(
        db_session, account_id=account.id, check_date=LATER,
        stated_balance_cents=520_00, category_id=None,
    )
    db_session.flush()
    assert diff == 20_00

    client = _client(db_session)
    try:
        resp = client.delete(f"/api/transactions/{adjustment.id}")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 204
    assert account_balance_cents(db_session, account.id, as_of=LATER) == 500_00


def test_delete_valuation_removes_it_and_its_adjustment_together(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()
    balance_before_check = account_balance_cents(db_session, account.id)

    valuation, adjustment, diff = check_balance(
        db_session, account_id=account.id, check_date=LATER,
        stated_balance_cents=520_00, category_id=None,
    )
    db_session.flush()
    assert diff == 20_00

    client = _client(db_session)
    try:
        resp = client.delete(f"/api/valuations/{valuation.id}")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 204
    assert db_session.get(Valuation, valuation.id) is None
    assert db_session.get(Transaction, adjustment.id) is None
    assert account_balance_cents(db_session, account.id) == balance_before_check


def test_delete_valuation_with_no_adjustment_deletes_cleanly(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()

    valuation, adjustment, diff = check_balance(
        db_session, account_id=account.id, check_date=LATER,
        stated_balance_cents=500_00, category_id=None,
    )
    db_session.flush()
    assert diff == 0
    assert adjustment is None

    client = _client(db_session)
    try:
        resp = client.delete(f"/api/valuations/{valuation.id}")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 204
    assert db_session.get(Valuation, valuation.id) is None
    assert account_balance_cents(db_session, account.id) == 500_00


def test_delete_opening_valuation_is_refused(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()
    opening_valuation = db_session.scalar(select(Valuation).where(Valuation.account_id == account.id))

    client = _client(db_session)
    try:
        resp = client.delete(f"/api/valuations/{opening_valuation.id}")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 400
    assert "opening valuation" in resp.json()["detail"]
    assert db_session.get(Valuation, opening_valuation.id) is not None
    assert account_balance_cents(db_session, account.id) == 500_00


def test_delete_missing_valuation_is_404(db_session):
    client = _client(db_session)
    try:
        resp = client.delete("/api/valuations/999999")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 404
