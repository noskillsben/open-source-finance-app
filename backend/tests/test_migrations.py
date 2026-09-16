"""Proves `alembic upgrade head` is a clean no-op against a populated database, not an empty one
(issue #15) — both broken migrations in the old app passed every empty-database test.
"""
import datetime

from alembic import command
from alembic.config import Config

from app.models import Account, Category, Transaction
from app.services.accounts import create_account_with_opening_valuation
from app.services.transactions import write_transaction

TODAY = datetime.date(2026, 3, 1)


def test_upgrade_head_is_a_noop_against_a_populated_database(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=TODAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    category = Category(name="Groceries", created_on=TODAY)
    db_session.add(category)
    db_session.flush()

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[{"category_id": category.id, "cents": -80_00}],
    )
    db_session.flush()

    account_id, category_id, txn_id = account.id, category.id, txn.id
    account_line_cents = txn.account_lines[0].cents
    category_line_cents = txn.category_lines[0].cents

    command.upgrade(Config("alembic.ini"), "head")

    assert db_session.get(Account, account_id).name == "Chequing"
    assert db_session.get(Category, category_id).name == "Groceries"
    reloaded = db_session.get(Transaction, txn_id)
    assert reloaded.account_lines[0].cents == account_line_cents
    assert reloaded.category_lines[0].cents == category_line_cents
