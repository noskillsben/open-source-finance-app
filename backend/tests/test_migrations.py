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
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models import Category, Transaction
from conftest import migrate

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _assert_749e15077f93(session):
    # Deliberately empty: this is the root revision. Nothing existed before it, so there is no
    # older schema to populate and no pre-existing data whose survival could be asserted.
    # Its fixture is a comment-only file, and the harness still runs it so the root is covered.
    return None


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


def _assert_b91f3e7a2c45(session):
    from app.models import AccountLine

    opening, groceries = session.get(AccountLine, 1), session.get(AccountLine, 2)
    assert opening.netted_into_opening is False  # the column this revision adds, defaulting false
    assert groceries.netted_into_opening is False
    assert (opening.cents, groceries.cents) == (50000, -8000)


ASSERTIONS = {
    "749e15077f93": _assert_749e15077f93,
    "769d6a847874": _assert_769d6a847874,
    "208c0d25ef38": _assert_208c0d25ef38,
    "ffe95c16a43c": _assert_ffe95c16a43c,
    "cfce036f3c04": _assert_cfce036f3c04,
    "a82c4d9e1b70": _assert_a82c4d9e1b70,
    "b91f3e7a2c45": _assert_b91f3e7a2c45,
}


def _revisions_from_alembic() -> list[dict]:
    """Every revision Alembic knows about, base first, so a new revision is picked up
    automatically and cannot be forgotten. Missing fixtures or assertions are reported by the
    test itself, naming the revision, rather than dropping the case."""
    script_directory = ScriptDirectory.from_config(Config("alembic.ini"))
    return [
        {
            "revision": script.revision,
            "down_revision": script.down_revision,
            "assert_data": ASSERTIONS.get(script.revision),
        }
        for script in reversed(list(script_directory.walk_revisions()))
    ]


REVISIONS = _revisions_from_alembic()


def _load_fixture(connection, revision: str) -> None:
    sql = (FIXTURES_DIR / f"{revision}.sql").read_text()
    for statement in filter(None, (s.strip() for s in sql.split(";"))):
        connection.execute(text(statement))


@pytest.mark.parametrize("case", REVISIONS, ids=lambda c: c["revision"])
def test_revision_survives_a_populated_database(throwaway_database, case):
    revision = case["revision"]
    fixture = FIXTURES_DIR / f"{revision}.sql"
    if not fixture.is_file():
        pytest.fail(f"missing fixture for revision {revision}: expected {fixture}")
    if case["assert_data"] is None:
        pytest.fail(f"missing assertion function for revision {revision}: add it to ASSERTIONS")

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
