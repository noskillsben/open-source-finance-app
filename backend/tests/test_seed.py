"""#44, extended by #16: the single idempotent seed step for first-run defaults (DESIGN.md §
General concepts → "First-run defaults come from one seed step"). Every default is identified
by its `seeded_key`, never by name or by a sentinel date, so a rename or archive is never
undone and one existing default never masks another.
"""
import datetime

from sqlalchemy import func, select

from app.models import Category, Domain, Payee
from app.seed import DEFAULT_CATEGORIES, DEFAULT_DOMAINS, ME_KEY, is_me, seed_defaults

EARLIER = datetime.date(2026, 1, 1)
ALL_DEFAULTS = 1 + len(DEFAULT_DOMAINS) + len(DEFAULT_CATEGORIES)


def _me(session):
    return session.scalar(select(Payee).where(Payee.seeded_key == ME_KEY))


def _count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def test_first_run_seeds_me_the_domains_and_the_categories(db_session):
    inserted = seed_defaults(db_session)

    assert inserted == ALL_DEFAULTS
    assert is_me(_me(db_session))
    assert _count(db_session, Domain) == len(DEFAULT_DOMAINS)
    groceries = db_session.scalar(select(Category).where(Category.seeded_key == "category:groceries"))
    assert groceries.need_level == "need"
    assert db_session.get(Domain, groceries.domain_id).seeded_key == "domain:food"
    assert groceries.created_on == datetime.date.min  # valid on every picker date


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


def test_a_renamed_default_category_and_domain_stay_renamed_and_the_rest_untouched(db_session):
    seed_defaults(db_session)
    groceries = db_session.scalar(select(Category).where(Category.seeded_key == "category:groceries"))
    food = db_session.scalar(select(Domain).where(Domain.seeded_key == "domain:food"))
    rent = db_session.scalar(select(Category).where(Category.seeded_key == "category:rent"))
    groceries.name = "Food shop"
    food.archived_on = EARLIER
    rent.need_level = "should"
    db_session.flush()

    assert seed_defaults(db_session) == 0

    assert _count(db_session, Category) == len(DEFAULT_CATEGORIES)  # no second Groceries
    assert _count(db_session, Domain) == len(DEFAULT_DOMAINS)
    assert groceries.name == "Food shop"
    assert food.archived_on == EARLIER
    assert rent.need_level == "should"  # an edit to one default is not undone


def test_a_default_is_skipped_when_the_user_already_has_an_active_row_of_that_name(db_session):
    db_session.add(Category(name="groceries", created_on=EARLIER))
    db_session.flush()

    inserted = seed_defaults(db_session)

    assert inserted == ALL_DEFAULTS - 1
    groceries = db_session.scalars(select(Category).where(func.lower(Category.name) == "groceries")).all()
    assert len(groceries) == 1 and groceries[0].seeded_key is None  # theirs, untouched
