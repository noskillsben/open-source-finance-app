"""The populated-database migration harness issue #15 promised and never delivered, and issue
#66 built for real: for each revision, a fresh throwaway database is taken to that revision's
`down_revision`, loaded with `fixtures/<revision>.sql` (raw SQL — the ORM models describe head
and can't populate an older schema), upgraded to head, and checked that the data survived, that
any backfill landed the values the revision promised, and that a second `upgrade head` is a
no-op. `test_upgrade_head_is_a_noop_against_a_populated_database` (the old harness) is deleted:
it ran `alembic upgrade head` against a database already at head, which is a no-op by
definition and proved nothing.
"""
import datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models import Category, Transaction
from conftest import migrate

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _assert_749e15077f93(session):
    pass  # nothing existed before this revision; nothing to populate or check


def _assert_769d6a847874(session):
    from app.models import Account, Valuation

    account = session.get(Account, 1)
    assert account.name == "Chequing"
    valuation = session.get(Valuation, 1)
    assert valuation.balance_cents == 50000


def _assert_208c0d25ef38(session):
    txn = session.get(Transaction, 1)
    assert txn.valuation_id is None  # the column this revision adds; nullable, untouched
    assert txn.account_lines[0].cents == -8000
    assert txn.category_lines[0].cents == -8000


def _assert_ffe95c16a43c(session):
    txn = session.get(Transaction, 1)
    assert txn.payee_id is None  # the column this revision adds; nullable, untouched
    assert txn.account_lines[0].cents == -8000


def _assert_cfce036f3c04(session):
    backfilled = session.get(Category, 1)
    assert backfilled.created_on == datetime.date(2026, 1, 5)  # its category_line's transaction date
    assert backfilled.archived_on is None

    fallback = session.get(Category, 2)
    assert fallback.created_on == fallback.created_at.date()  # no category_line -> created_at::date


def _assert_a82c4d9e1b70(session):
    from app.models import Account, AccountLine

    assert session.get(Account, 1).opening_stated_on == datetime.date(2026, 1, 1)  # backfilled from created_on
    assert session.get(Account, 2).opening_stated_on == datetime.date(2026, 3, 10)
    assert session.get(AccountLine, 1).cents == -8000  # existing ledger untouched


REVISIONS = [
    {"revision": "749e15077f93", "down_revision": None, "assert_data": _assert_749e15077f93},
    {"revision": "769d6a847874", "down_revision": "749e15077f93", "assert_data": _assert_769d6a847874},
    {"revision": "208c0d25ef38", "down_revision": "769d6a847874", "assert_data": _assert_208c0d25ef38},
    {"revision": "ffe95c16a43c", "down_revision": "208c0d25ef38", "assert_data": _assert_ffe95c16a43c},
    {"revision": "cfce036f3c04", "down_revision": "ffe95c16a43c", "assert_data": _assert_cfce036f3c04},
    {"revision": "a82c4d9e1b70", "down_revision": "cfce036f3c04", "assert_data": _assert_a82c4d9e1b70},
]


def _load_fixture(connection, revision: str) -> None:
    sql = (FIXTURES_DIR / f"{revision}.sql").read_text()
    for statement in filter(None, (s.strip() for s in sql.split(";"))):
        connection.execute(text(statement))


@pytest.mark.parametrize("case", REVISIONS, ids=lambda c: c["revision"])
def test_revision_survives_a_populated_database(throwaway_database, case):
    url = throwaway_database
    migrate(url, case["down_revision"] or "base")

    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            _load_fixture(connection, case["revision"])

        migrate(url, "head")
        Session = sessionmaker(bind=engine)
        with Session() as session:
            case["assert_data"](session)

        migrate(url, "head")  # second upgrade must be a no-op
        with Session() as session:
            case["assert_data"](session)
    finally:
        engine.dispose()
