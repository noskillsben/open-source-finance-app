"""DESIGN.md § Transactions — Invariant; § General concepts → Settings never rewrite history.
The integrity check replays `write_transaction`'s own math read-only; these tests cover the
two kinds of drift it can find, and that an ordinary transaction is left alone.
"""
import datetime

from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import AccountLine, Category, CategoryLine, Transaction
from app.services.accounts import create_account_with_opening_valuation
from app.services.integrity import find_integrity_issues
from app.services.transactions import write_transaction

TODAY = datetime.date(2026, 3, 1)


def make_account(db_session, name, *, type="Chequing", on_budget=True, floor=0, opening_balance=0):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=TODAY, type=type,
        on_budget=on_budget, on_budget_floor_cents=floor, opening_balance_cents=opening_balance,
    )
    db_session.flush()
    return account


def make_category(db_session, name):
    category = Category(name=name, created_on=TODAY)
    db_session.add(category)
    db_session.flush()
    return category


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def test_normal_transaction_under_current_settings_is_not_flagged(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=500_00)
    groceries = make_category(db_session, "Groceries")
    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": -80_00}],
        category_lines=[{"category_id": groceries.id, "cents": -80_00}],
    )
    db_session.flush()

    findings = [f for f in find_integrity_issues(db_session) if f.transaction_id == txn.id]
    assert findings == []


def test_category_lines_that_dont_sum_to_the_budget_movement_are_flagged(db_session):
    """Inserted directly at the DB level — write_transaction itself refuses this, so the
    only way this row exists is if the invariant was bypassed.
    """
    chequing = make_account(db_session, "Chequing", opening_balance=500_00)
    groceries = make_category(db_session, "Groceries")

    txn = Transaction(date=TODAY, memo=None, payee_id=None)
    db_session.add(txn)
    db_session.flush()
    db_session.add(AccountLine(transaction_id=txn.id, account_id=chequing.id, cents=-80_00, budget_cents=-80_00))
    db_session.add(CategoryLine(transaction_id=txn.id, category_id=groceries.id, cents=-70_00))
    db_session.flush()

    findings = [f for f in find_integrity_issues(db_session) if f.transaction_id == txn.id]

    assert len(findings) == 1
    assert findings[0].kind == "invariant"
    assert findings[0].expected_cents == -80_00  # the stored budget movement
    assert findings[0].stored_cents == -70_00  # what the category lines actually sum to


def test_settings_drift_is_flagged_and_re_save_clears_it(db_session):
    """DESIGN.md § Settings never rewrite history: `budget_cents` no longer reads the floor
    at all, so only a real change to an account's budget side can produce drift.
    """
    card = make_account(db_session, "Card", type="Credit card", floor=-1_000_00, opening_balance=0)
    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": card.id, "cents": -100_00}],
        category_lines=[],
    )
    db_session.flush()
    assert txn.account_lines[0].budget_cents == -100_00  # fully on-budget while the card was on-budget
    findings_before = [f for f in find_integrity_issues(db_session) if f.transaction_id == txn.id]
    assert findings_before == []

    card.on_budget = False  # the card became tracking-only after the fact
    db_session.flush()

    findings = [f for f in find_integrity_issues(db_session) if f.transaction_id == txn.id]
    assert len(findings) == 1
    assert findings[0].kind == "settings_drift"
    assert findings[0].stored_cents == -100_00  # what's on the row
    assert findings[0].expected_cents == 0  # what today's budget side would compute

    client = _client(db_session)
    try:
        resp = client.post(f"/api/transactions/{txn.id}/re-save")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["account_lines"][0]["budget_cents"] == 0
    findings_after = [f for f in find_integrity_issues(db_session) if f.transaction_id == txn.id]
    assert findings_after == []


def test_inserting_an_earlier_transaction_on_a_floored_account_produces_no_settings_drift(db_session):
    """DESIGN.md § Settings never rewrite history: `budget_cents` is a pure function of the
    line and the account's on-budget flag, never of a running balance — so writing an earlier
    or same-day transaction on a floored account can't make a later, unrelated line's
    `budget_cents` look wrong.
    """
    card = make_account(db_session, "Card", type="Credit card", floor=-1_000_00, opening_balance=-900_00)
    later_txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": card.id, "cents": -200_00}],
        category_lines=[],
    )
    db_session.flush()
    assert later_txn.account_lines[0].budget_cents == -200_00

    earlier = TODAY - datetime.timedelta(days=1)
    write_transaction(
        db_session, transaction=None, txn_date=earlier, memo=None, payee_id=None,
        account_lines=[{"account_id": card.id, "cents": -50_00}],
        category_lines=[],
    )
    db_session.flush()

    findings = [f for f in find_integrity_issues(db_session) if f.transaction_id == later_txn.id]
    assert findings == []


def test_integrity_check_route_lists_findings(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=500_00)
    groceries = make_category(db_session, "Groceries")
    txn = Transaction(date=TODAY, memo=None, payee_id=None)
    db_session.add(txn)
    db_session.flush()
    db_session.add(AccountLine(transaction_id=txn.id, account_id=chequing.id, cents=-80_00, budget_cents=-80_00))
    db_session.add(CategoryLine(transaction_id=txn.id, category_id=groceries.id, cents=-70_00))
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.get("/api/integrity-check")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    matches = [f for f in resp.json() if f["transaction_id"] == txn.id]
    assert len(matches) == 1
    assert matches[0]["kind"] == "invariant"


def test_re_save_missing_transaction_is_404(db_session):
    client = _client(db_session)
    try:
        resp = client.post("/api/transactions/999999/re-save")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 404
