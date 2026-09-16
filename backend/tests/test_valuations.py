"""DESIGN.md § Balance checks — one table."""
import datetime

from app.models import Transaction
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
