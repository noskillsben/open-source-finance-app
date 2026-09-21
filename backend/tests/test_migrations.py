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


def _assert_c4d8a1f65e92(session):
    from app.models import CategoryLine, Payee

    car, insurance = session.get(Category, 1), session.get(Category, 2)
    assert (car.name, car.parent_id) == ("Car", None)
    assert (insurance.name, insurance.parent_id) == ("Car insurance", 1)  # the tree survived in place
    for category in (car, insurance):  # the columns this revision adds, all left unset
        assert (category.pool_id, category.domain_id, category.need_level) == (None, None, None)
        assert category.seeded_key is None
    assert session.get(CategoryLine, 1).category_id == 2  # the line still points at its category
    assert session.get(CategoryLine, 1).cents == -8000

    me, walmart = session.get(Payee, 1), session.get(Payee, 2)
    assert me.seeded_key == "payee:me"  # backfilled from the created_on == date.min sentinel
    assert walmart.seeded_key is None


def _assert_d5e2b7c30f18(session):
    from datetime import date

    from app.models import AccountLine, CategoryLine, EarmarkLine
    from app.services.categories import category_balance_cents

    assert session.get(AccountLine, 2).cents == -8000  # the ledger survived untouched
    assert session.get(CategoryLine, 1).cents == -8000
    assert session.query(EarmarkLine).count() == 0  # the table this revision adds, empty
    # The helper now reads earmark lines too; with none, the balance is what it always was.
    assert category_balance_cents(session, 1, as_of=date(2026, 12, 31)) == -8000


def _assert_e6f3c8d41a29(session):
    from datetime import date

    from app.models import EarmarkLine
    from app.services.categories import category_balance_cents

    line = session.get(EarmarkLine, 1)
    assert (line.category_id, line.cents, line.source) == (1, 5000, "move")  # the move survived
    assert line.transaction_id is None  # the column this revision adds, left null
    assert category_balance_cents(session, 1, as_of=date(2026, 12, 31)) == -3000


ASSERTIONS = {
    "749e15077f93": _assert_749e15077f93,
    "769d6a847874": _assert_769d6a847874,
    "208c0d25ef38": _assert_208c0d25ef38,
    "ffe95c16a43c": _assert_ffe95c16a43c,
    "cfce036f3c04": _assert_cfce036f3c04,
    "a82c4d9e1b70": _assert_a82c4d9e1b70,
    "b91f3e7a2c45": _assert_b91f3e7a2c45,
    "c4d8a1f65e92": _assert_c4d8a1f65e92,
    "d5e2b7c30f18": _assert_d5e2b7c30f18,
    "e6f3c8d41a29": _assert_e6f3c8d41a29,
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
