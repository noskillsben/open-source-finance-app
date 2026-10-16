"""#44, extended by #16: the single idempotent seed step for first-run defaults (DESIGN.md §
General concepts → "First-run defaults come from one seed step"). Every default is identified
by its `seeded_key`, never by name or by a sentinel date, so a rename or archive is never
undone and one existing default never masks another.
"""
import datetime

from sqlalchemy import func, select

from app.models import Category, Domain, Payee
from app.seed import ME_KEY, is_me, seed_defaults

EARLIER = datetime.date(2026, 1, 1)
ALL_DEFAULTS = 2  # Me and Debt payments


def _me(session):
    return session.scalar(select(Payee).where(Payee.seeded_key == ME_KEY))


def _count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def test_first_run_seeds_only_me_and_debt_payments(db_session):
    inserted = seed_defaults(db_session)

    assert inserted == ALL_DEFAULTS
    assert is_me(_me(db_session))
    assert _count(db_session, Payee) == 1
    assert _count(db_session, Domain) == 0
    cats = db_session.scalars(select(Category)).all()
    assert [c.name for c in cats] == ["Debt payments"]
    debt = cats[0]
    assert debt.need_level == "need"
    assert debt.domain_id is None
    assert debt.created_on == datetime.date.min  # valid on every picker date


def test_second_run_touches_nothing(db_session):
    seed_defaults(db_session)
    before = (_count(db_session, Payee), _count(db_session, Domain), _count(db_session, Category))

    inserted = seed_defaults(db_session)

    assert inserted == 0
    assert (_count(db_session, Payee), _count(db_session, Domain), _count(db_session, Category)) == before
    assert _me(db_session).archived_on is None


def test_second_run_leaves_a_renamed_me_alone(db_session):
    seed_defaults(db_session)
    _me(db_session).name = "Myself"
    db_session.flush()

    assert seed_defaults(db_session) == 0

    assert _me(db_session).name == "Myself"
    assert _count(db_session, Payee) == 1  # no second "Me" alongside the renamed row


def test_second_run_leaves_an_archived_me_alone(db_session):
    seed_defaults(db_session)
    _me(db_session).archived_on = EARLIER
    db_session.flush()

    assert seed_defaults(db_session) == 0

    rows = db_session.scalars(select(Payee)).all()
    assert len(rows) == 1
    assert rows[0].archived_on == EARLIER  # archive survives; not re-created, not unarchived


def test_a_renamed_or_archived_debt_payments_is_not_reseeded(db_session):
    seed_defaults(db_session)
    debt = db_session.scalar(select(Category).where(Category.seeded_key == "category:debt-payments"))
    debt.name = "Loan payments"
    db_session.flush()
    assert seed_defaults(db_session) == 0
    debt.archived_on = EARLIER
    db_session.flush()

    assert seed_defaults(db_session) == 0

    assert _count(db_session, Category) == 1
    assert debt.name == "Loan payments" and debt.archived_on == EARLIER


def test_a_default_is_skipped_when_the_user_already_has_an_active_row_of_that_name(db_session):
    db_session.add(Category(name="debt payments", created_on=EARLIER))
    db_session.flush()

    inserted = seed_defaults(db_session)

    assert inserted == ALL_DEFAULTS - 1
    rows = db_session.scalars(select(Category).where(func.lower(Category.name) == "debt payments")).all()
    assert len(rows) == 1 and rows[0].seeded_key is None  # theirs, untouched


def test_debt_payments_is_stored_under_the_key_the_frontend_pre_selects(db_session):
    # frontend/src/account_types.js BOUNDARY_DEFAULT_SEEDED_KEY must equal this string.
    seed_defaults(db_session)
    row = db_session.scalar(select(Category).where(Category.name == "Debt payments"))
    assert row.seeded_key == "category:debt-payments"
