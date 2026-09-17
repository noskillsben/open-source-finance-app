"""Proves `alembic upgrade head` is a clean no-op against a populated database, not an empty one
(issue #15) — both broken migrations in the old app passed every empty-database test.

Uses `app.db.SessionLocal` directly, with a real commit, rather than the rollback-wrapped
`db_session` fixture: `alembic/env.py`'s `run_migrations_online()` opens its own connection
(`engine_from_config(..., poolclass=NullPool)`), which under READ COMMITTED cannot see rows still
sitting in another connection's uncommitted transaction. Only a real commit makes the inserted
rows part of the populated database alembic's own connection sees — the fixture would leave
`command.upgrade` running against what looks, from its side, like an empty database. Because the
commit escapes the fixture's rollback-on-teardown, this test deletes what it created itself.
"""
import datetime

from alembic import command
from alembic.config import Config
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Account, Category, Transaction, Valuation
from app.services.accounts import create_account_with_opening_valuation
from app.services.transactions import write_transaction

TODAY = datetime.date(2026, 3, 1)


def test_upgrade_head_is_a_noop_against_a_populated_database():
    session = SessionLocal()
    ids = {"account": None, "category": None, "valuation": None, "opening_txn": None, "txn": None}
    try:
        account = create_account_with_opening_valuation(
            session, name="Chequing", created_on=TODAY, type="Chequing",
            on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
        )
        ids["account"] = account.id
        valuation = account.valuations[0]
        ids["valuation"] = valuation.id
        ids["opening_txn"] = session.execute(
            select(Transaction.id).where(Transaction.valuation_id == valuation.id)
        ).scalar_one()

        category = Category(name="Groceries", created_on=TODAY)
        session.add(category)
        session.flush()
        ids["category"] = category.id

        txn = write_transaction(
            session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
            account_lines=[{"account_id": account.id, "cents": -80_00}],
            category_lines=[{"category_id": category.id, "cents": -80_00}],
        )
        ids["txn"] = txn.id
        account_line_cents = txn.account_lines[0].cents
        category_line_cents = txn.category_lines[0].cents
        session.commit()

        command.upgrade(Config("alembic.ini"), "head")

        session.expire_all()
        assert session.get(Account, ids["account"]).name == "Chequing"
        assert session.get(Category, ids["category"]).name == "Groceries"
        reloaded = session.get(Transaction, ids["txn"])
        assert reloaded.account_lines[0].cents == account_line_cents
        assert reloaded.category_lines[0].cents == category_line_cents
    finally:
        session.rollback()
        for key in ("txn", "opening_txn"):
            if ids[key] is not None:
                row = session.get(Transaction, ids[key])
                if row is not None:
                    session.delete(row)
        if ids["valuation"] is not None:
            row = session.get(Valuation, ids["valuation"])
            if row is not None:
                session.delete(row)
        if ids["account"] is not None:
            row = session.get(Account, ids["account"])
            if row is not None:
                session.delete(row)
        if ids["category"] is not None:
            row = session.get(Category, ids["category"])
            if row is not None:
                session.delete(row)
        session.commit()
        session.close()
