"""DESIGN.md § Balance checks — one table."""
import datetime

from sqlalchemy import select

from app.models import Transaction, Valuation
from app.services.accounts import account_balance_cents, create_account_with_opening_valuation
from app.services.transactions import write_transaction
from app.services.valuations import check_balance, entries_added_since_check, latest_valuation

TODAY = datetime.date(2026, 3, 1)


def make_account(db_session, name, *, opening_balance=0, floor=0):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=TODAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=floor, opening_balance_cents=opening_balance,
    )
    db_session.flush()
    return account


def make_category(db_session, name):
    from app.models import Category

    category = Category(name=name, created_on=TODAY)
    db_session.add(category)
    db_session.flush()
    return category


def test_matching_balance_writes_no_adjustment(db_session):
    account = make_account(db_session, "Chequing", opening_balance=500_00)

    valuation, transaction, diff = check_balance(
        db_session, account_id=account.id, check_date=TODAY,
        stated_balance_cents=500_00, category_id=None,
    )

    assert diff == 0
    assert transaction is None
    assert valuation.balance_cents == 500_00
    assert account_balance_cents(db_session, account.id) == 500_00


def test_mismatch_no_category_lands_unassigned(db_session):
    account = make_account(db_session, "Chequing", opening_balance=500_00)

    valuation, transaction, diff = check_balance(
        db_session, account_id=account.id, check_date=TODAY,
        stated_balance_cents=520_00, category_id=None,
    )

    assert diff == 20_00
    assert transaction is not None
    assert transaction.category_lines == []
    assert transaction.account_lines[0].cents == 20_00
    assert transaction.account_lines[0].budget_cents == 20_00  # arrives unassigned, ready to assign
    assert account_balance_cents(db_session, account.id) == 520_00


def test_mismatch_with_category_gives_it_the_full_movement(db_session):
    account = make_account(db_session, "Chequing", opening_balance=500_00)
    missed = make_category(db_session, "Missed transactions")

    valuation, transaction, diff = check_balance(
        db_session, account_id=account.id, check_date=TODAY,
        stated_balance_cents=480_00, category_id=missed.id,
    )

    assert diff == -20_00
    assert len(transaction.category_lines) == 1
    assert transaction.category_lines[0].category_id == missed.id
    assert transaction.category_lines[0].cents == -20_00


def test_adjustments_valuation_id_is_set(db_session):
    account = make_account(db_session, "Chequing", opening_balance=500_00)

    valuation, transaction, diff = check_balance(
        db_session, account_id=account.id, check_date=TODAY,
        stated_balance_cents=600_00, category_id=None,
    )

    assert transaction.valuation_id == valuation.id


def test_entries_added_since_check(db_session):
    account = make_account(db_session, "Chequing", opening_balance=500_00)

    valuation, _, _ = check_balance(
        db_session, account_id=account.id, check_date=TODAY,
        stated_balance_cents=500_00, category_id=None,
    )
    db_session.flush()
    assert entries_added_since_check(db_session, account.id, valuation) == 0

    # A transaction dated on/before the check, but recorded (by wall clock) after it.
    later = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo="backdated entry", payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -10_00}],
        category_lines=[],
    )
    db_session.flush()
    later.created_at = valuation.created_at + datetime.timedelta(seconds=1)
    db_session.flush()

    assert entries_added_since_check(db_session, account.id, valuation) == 1
    assert latest_valuation(db_session, account.id).id == valuation.id


def test_balance_check_on_opening_date_survives_a_later_backfill(db_session):
    """A balance check dated on the account's created_on is a second valuation sharing that
    date with the true opening valuation. Backfilling an earlier transaction must move only
    the opening adjustment — the balance check's own valuation, adjustment and date stay put
    (DESIGN.md § Opening balance and backfilling history).
    """
    account = make_account(db_session, "Chequing", opening_balance=1_000_00)
    opening_valuation = db_session.scalar(select(Valuation).where(Valuation.account_id == account.id))
    opening_txn = db_session.scalar(select(Transaction).where(Transaction.valuation_id == opening_valuation.id))

    check_valuation, check_txn, diff = check_balance(
        db_session, account_id=account.id, check_date=TODAY,
        stated_balance_cents=1_020_00, category_id=None,
    )
    db_session.flush()
    assert diff == 20_00
    assert check_valuation.id != opening_valuation.id

    backfill_date = TODAY - datetime.timedelta(days=5)
    write_transaction(
        db_session, transaction=None, txn_date=backfill_date, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -30_00}],
        category_lines=[],
    )
    db_session.flush()

    db_session.refresh(account)
    db_session.refresh(opening_valuation)
    db_session.refresh(opening_txn)
    db_session.refresh(check_valuation)
    db_session.refresh(check_txn)

    assert account.created_on == backfill_date
    assert opening_valuation.date == backfill_date
    assert opening_txn.date == backfill_date
    opening_line = next(line for line in opening_txn.account_lines if line.account_id == account.id)
    assert opening_line.cents == 1_030_00  # 1,000 opening + 30 backfilled

    assert check_valuation.date == TODAY  # untouched
    assert check_valuation.balance_cents == 1_020_00  # untouched
    assert check_txn.date == TODAY  # untouched
    assert check_txn.account_lines[0].cents == 20_00  # untouched


# --- The badge at a "Show as of" date (DESIGN.md § Founding decisions, "Effective-date view") ---

def _listed(db_session, account_id, as_of):
    from fastapi.testclient import TestClient

    from app.db import get_session
    from app.main import app

    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        response = TestClient(app).get("/api/accounts", params={"as_of": as_of.isoformat()})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    return next(a for a in response.json() if a["id"] == account_id)


def _backdated_entry(db_session, account, txn_date, after):
    """A transaction dated `txn_date` but recorded (by wall clock) just after `after`."""
    txn = write_transaction(
        db_session, transaction=None, txn_date=txn_date, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -5_00}], category_lines=[],
    )
    db_session.flush()
    txn.created_at = after.created_at + datetime.timedelta(seconds=1)
    db_session.flush()
    return txn


def test_latest_valuation_as_of_hides_a_later_check_and_shows_it_on_its_date(db_session):
    account = make_account(db_session, "Chequing", opening_balance=100_00)
    check, _, _ = check_balance(
        db_session, account_id=account.id, check_date=datetime.date(2026, 8, 11),
        stated_balance_cents=120_00, category_id=None,
    )

    assert latest_valuation(db_session, account.id, as_of=datetime.date(2026, 8, 6)).date == TODAY  # opening only
    assert latest_valuation(db_session, account.id, as_of=datetime.date(2026, 8, 11)).id == check.id
    assert latest_valuation(db_session, account.id).id == check.id  # None behaves as before


def test_badge_hides_an_august_check_at_an_earlier_as_of(db_session):
    account = make_account(db_session, "Chequing", opening_balance=100_00)
    check, _, _ = check_balance(
        db_session, account_id=account.id, check_date=datetime.date(2026, 8, 11),
        stated_balance_cents=120_00, category_id=None,
    )
    db_session.flush()

    hidden = _listed(db_session, account.id, datetime.date(2026, 8, 6))
    shown = _listed(db_session, account.id, datetime.date(2026, 8, 11))

    # Every listed account has its opening check on or before the as-of, so that is what the
    # badge falls back to once the August check is hidden.
    assert hidden["checked_on"] == TODAY.isoformat()
    assert hidden["checked_valuation_id"] != check.id
    assert hidden["checked_is_opening"] is True
    assert shown["checked_on"] == "2026-08-11"
    assert shown["checked_valuation_id"] == check.id


def test_opening_balance_check_alone_shows_at_its_own_date(db_session):
    account = make_account(db_session, "Chequing", opening_balance=100_00)

    listed = _listed(db_session, account.id, TODAY)

    assert listed["checked_on"] == TODAY.isoformat()
    assert listed["checked_is_opening"] is True


def test_badge_follows_the_earlier_check_at_an_in_between_date(db_session):
    account = make_account(db_session, "Chequing", opening_balance=100_00)
    earlier, _, _ = check_balance(
        db_session, account_id=account.id, check_date=datetime.date(2026, 4, 1),
        stated_balance_cents=100_00, category_id=None,
    )
    later, _, _ = check_balance(
        db_session, account_id=account.id, check_date=datetime.date(2026, 6, 1),
        stated_balance_cents=90_00, category_id=None,
    )
    db_session.flush()
    # One entry dated before the earlier check, recorded after it: counts against the earlier
    # check. One dated between the checks: after the earlier check, so it doesn't.
    _backdated_entry(db_session, account, datetime.date(2026, 3, 15), after=later)
    _backdated_entry(db_session, account, datetime.date(2026, 5, 1), after=later)

    between = _listed(db_session, account.id, datetime.date(2026, 5, 1))
    latest = _listed(db_session, account.id, datetime.date(2026, 7, 1))

    assert between["checked_on"] == "2026-04-01"
    assert between["checked_valuation_id"] == earlier.id
    assert between["checked_is_opening"] is False
    assert between["entries_added_since_check"] == 1
    assert latest["checked_valuation_id"] == later.id
    assert latest["entries_added_since_check"] == 2


def test_predates_note_ignores_the_picker(db_session):
    from app.services.transaction_notes import transaction_notes

    account = make_account(db_session, "Chequing", opening_balance=100_00)
    check_balance(
        db_session, account_id=account.id, check_date=datetime.date(2026, 8, 11),
        stated_balance_cents=100_00, category_id=None,
    )
    txn = write_transaction(
        db_session, transaction=None, txn_date=datetime.date(2026, 8, 1), memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -5_00}], category_lines=[],
    )
    db_session.flush()

    # The picker at Aug 6 hides the Aug 11 check from the badge, not from the note.
    assert _listed(db_session, account.id, datetime.date(2026, 8, 6))["checked_on"] == TODAY.isoformat()
    assert "This predates your 2026-08-11 check on Chequing." in transaction_notes(db_session, txn)
