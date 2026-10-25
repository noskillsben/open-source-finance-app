"""DESIGN.md § Transactions — Invariant; § General concepts → Settings never rewrite history.
The integrity check replays `write_transaction`'s own math read-only; these tests cover the
two kinds of drift it can find, and that an ordinary transaction is left alone.
"""
import datetime

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_session
from app.main import app
from app.models import AccountLine, Category, CategoryLine, EarmarkLine, Transaction, Valuation
from app.services.accounts import account_balance_cents, create_account_with_opening_valuation
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


def test_un_netted_line_before_the_stated_date_is_flagged_and_re_save_nets_it_once(db_session):
    """#331: a row saved before backfills netted in any order sits before opening_stated_on
    with netted_into_opening false. Re-save absorbs it into the opening exactly once."""
    chequing = make_account(db_session, "Chequing", opening_balance=1_000_00)
    groceries = make_category(db_session, "Groceries")
    before = TODAY - datetime.timedelta(days=5)
    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": -80_00}],
        category_lines=[{"category_id": groceries.id, "cents": -80_00}],
    )
    db_session.flush()
    txn.date = before  # hand-built legacy row: dated before D, never netted
    db_session.flush()

    findings = [f for f in find_integrity_issues(db_session) if f.kind == "not_netted"]
    assert [(f.transaction_id, f.expected_cents, f.stored_cents) for f in findings] == [(txn.id, -80_00, 0)]

    client = _client(db_session)
    try:
        for _ in range(2):
            assert client.post(f"/api/transactions/{txn.id}/re-save").status_code == 200
    finally:
        app.dependency_overrides.clear()

    assert [f for f in find_integrity_issues(db_session) if f.kind == "not_netted"] == []
    opening = db_session.scalar(select(Valuation).where(Valuation.account_id == chequing.id))
    opening_txn = db_session.scalar(select(Transaction).where(Transaction.valuation_id == opening.id))
    assert opening_txn.account_lines[0].cents == 1_080_00  # netted once, not twice
    assert account_balance_cents(db_session, chequing.id, as_of=TODAY) == 1_000_00


# --- #390: stale pool cover -------------------------------------------------------------

def _pool_setup(db_session):
    from app.services.earmarks import move_money

    chequing = make_account(db_session, "Chequing", opening_balance=1_000_00)
    pool = make_category(db_session, "Buffer")
    cat = Category(name="Fun", created_on=TODAY, pool_id=pool.id)
    db_session.add(cat)
    db_session.flush()
    move_money(db_session, move_date=TODAY - datetime.timedelta(days=30), from_category_id=None,
               to_category_id=pool.id, cents=100_00)
    move_money(db_session, move_date=TODAY - datetime.timedelta(days=30), from_category_id=None,
               to_category_id=cat.id, cents=30_00)
    return chequing, pool, cat


def _spend(db_session, account, category, cents, on, transaction=None):
    return write_transaction(
        db_session, transaction=transaction, txn_date=on, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -cents}],
        category_lines=[{"category_id": category.id, "cents": -cents}],
    )


def _stale(db_session):
    return [f for f in find_integrity_issues(db_session) if f.kind == "stale_cover"]


def test_backfill_before_a_covered_spend_makes_its_cover_stale_and_re_save_fixes_it(db_session):
    chequing, pool, cat = _pool_setup(db_session)
    oct20 = _spend(db_session, chequing, cat, 50_00, datetime.date(2026, 2, 20))
    assert _stale(db_session) == []  # category held 30, pool covered 20
    _spend(db_session, chequing, cat, 30_00, datetime.date(2026, 2, 10))  # backfill
    stale = _stale(db_session)
    assert [f.transaction_id for f in stale] == [oct20.id]
    assert (stale[0].category_name, stale[0].pool_name) == ("Fun", "Buffer")
    assert stale[0].expected_cents != stale[0].stored_cents

    backfill_draws = lambda: sorted(
        (l.id, l.cents) for l in db_session.query(EarmarkLine).filter(
            EarmarkLine.source == "pool_draw", EarmarkLine.transaction_id != oct20.id)
    )
    before = backfill_draws()
    _spend(db_session, chequing, cat, 50_00, datetime.date(2026, 2, 20), transaction=oct20)
    assert _stale(db_session) == []
    assert backfill_draws() == before  # no cascade


def test_same_rows_entered_oldest_first_are_not_reported(db_session):
    chequing, pool, cat = _pool_setup(db_session)
    _spend(db_session, chequing, cat, 30_00, datetime.date(2026, 2, 10))
    _spend(db_session, chequing, cat, 50_00, datetime.date(2026, 2, 20))
    assert _stale(db_session) == []


def test_no_pool_chain_and_a_correct_draw_are_never_reported(db_session):
    chequing, pool, cat = _pool_setup(db_session)
    plain = make_category(db_session, "Plain")
    _spend(db_session, chequing, plain, 10_00, datetime.date(2026, 2, 5))
    _spend(db_session, chequing, cat, 20_00, datetime.date(2026, 2, 6))
    assert _stale(db_session) == []
