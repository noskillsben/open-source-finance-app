"""#44: the single idempotent seed step for first-run defaults (DESIGN.md § General concepts
→ "First-run defaults come from one seed step"). Currently one entry: the payee Me.
"""
import datetime

from sqlalchemy import func, select

from app.models import Payee
from app.seed import seed_defaults

EARLIER = datetime.date(2026, 1, 1)


def _me(session):
    return session.scalar(select(Payee).where(func.lower(Payee.name) == "me"))


def test_second_run_does_not_touch_an_existing_me(db_session):
    # docker-entrypoint.sh already ran seed_defaults() as a committed insert before pytest
    # started, so a real "Me" exists outside this test's transaction. This call must be a
    # no-op, not a second insert.
    seed_defaults(db_session)

    inserted = seed_defaults(db_session)

    assert inserted == 0
    all_payees = db_session.scalars(select(Payee)).all()
    assert len(all_payees) == 1
    me = all_payees[0]
    assert me.name.lower() == "me"
    assert me.archived_on is None


def test_second_run_leaves_a_renamed_me_alone(db_session):
    seed_defaults(db_session)
    me = _me(db_session)
    me.name = "Myself"
    db_session.flush()

    inserted = seed_defaults(db_session)
    db_session.flush()

    assert inserted == 0
    assert _me(db_session) is None  # "me" no longer matches any row by name
    renamed = db_session.scalar(select(Payee).where(func.lower(Payee.name) == "myself"))
    assert renamed is not None
    assert renamed.archived_on is None
    all_payees = db_session.scalars(select(Payee)).all()
    assert len(all_payees) == 1  # no second "Me" was inserted alongside the renamed row


def test_second_run_leaves_an_archived_me_alone(db_session):
    seed_defaults(db_session)
    me = _me(db_session)
    me.archived_on = EARLIER
    db_session.flush()

    inserted = seed_defaults(db_session)
    db_session.flush()

    assert inserted == 0
    rows = db_session.scalars(select(Payee).where(func.lower(Payee.name) == "me")).all()
    assert len(rows) == 1
    assert rows[0].archived_on == EARLIER  # archive survives; not re-created, not unarchived
