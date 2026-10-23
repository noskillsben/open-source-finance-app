"""#327: an account can be created linked to one category (DESIGN.md § Linked categories), and a
split's new member account is linked to the seeded Owed to me.
"""
import datetime

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import get_session
from app.main import app
from app.models import Account, Category, CategoryAccountLink, Payee
from app.seed import OWED_TO_ME_KEY, seed_defaults
from app.services.accounts import create_account_with_opening_valuation

DAY = datetime.date(2026, 3, 1)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def _category(db_session, name, **kwargs):
    category = Category(name=name, created_on=DAY, **kwargs)
    db_session.add(category)
    db_session.flush()
    return category


def _body(name, on_budget=True, **extra):
    return {
        "name": name, "created_on": DAY.isoformat(), "type": "Money owed to me", "on_budget": on_budget,
        "opening_balance_cents": 0, **extra,
    }


def _links(db_session):
    return db_session.execute(select(CategoryAccountLink.category_id, CategoryAccountLink.account_id)).all()


def _account_count(db_session):
    return db_session.scalar(select(func.count()).select_from(Account))


def test_create_writes_exactly_one_link_and_keeps_the_categorys_other_links(db_session):
    owed = _category(db_session, "Owed to me")
    other = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.add(CategoryAccountLink(category_id=owed.id, account_id=other.id))
    db_session.flush()
    client = _client(db_session)
    try:
        response = client.post("/api/accounts", json=_body("Sam", linked_category_id=owed.id))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["linked_category_ids"] == [owed.id]
    assert sorted(_links(db_session)) == sorted([(owed.id, other.id), (owed.id, response.json()["id"])])


def test_create_without_a_link_writes_none(db_session):
    client = _client(db_session)
    try:
        response = client.post("/api/accounts", json=_body("Sam"))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201 and _links(db_session) == []


def test_a_tracking_account_an_archived_category_or_an_unknown_id_is_refused_and_nothing_is_written(db_session):
    live = _category(db_session, "Owed to me")
    old = _category(db_session, "Old", archived_on=DAY)
    before = _account_count(db_session)
    client = _client(db_session)
    try:
        tracking = client.post("/api/accounts", json=_body("A", on_budget=False, linked_category_id=live.id))
        archived = client.post("/api/accounts", json=_body("B", linked_category_id=old.id))
        unknown = client.post("/api/accounts", json=_body("C", linked_category_id=9999))
    finally:
        app.dependency_overrides.clear()

    for response in (tracking, archived, unknown):
        assert response.status_code == 400 and response.json()["detail"]
    assert _account_count(db_session) == before
    assert _links(db_session) == []


def test_a_category_archived_after_the_accounts_date_is_still_live_on_it(db_session):
    later = _category(db_session, "Later", archived_on=DAY + datetime.timedelta(days=5))
    client = _client(db_session)
    try:
        response = client.post("/api/accounts", json=_body("Sam", linked_category_id=later.id))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201


def _split(client, payee_id):
    return client.post("/api/splits", json={
        "name": "Rent", "created_on": DAY.isoformat(), "members": [{"payee_id": payee_id, "percent": "50"}],
    })


def _payee(db_session, name):
    payee = Payee(name=name, created_on=DAY)
    db_session.add(payee)
    db_session.flush()
    return payee


def test_a_split_links_the_account_it_creates_to_the_seeded_owed_to_me(db_session):
    seed_defaults(db_session)
    owed = db_session.scalar(select(Category).where(Category.seeded_key == OWED_TO_ME_KEY))
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        response = _split(client, sam.id)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert _links(db_session) == [(owed.id, response.json()["members"][0]["account_id"])]


def test_a_reused_or_picked_account_gets_no_new_link(db_session):
    seed_defaults(db_session)
    sam = _payee(db_session, "Sam")
    picked = create_account_with_opening_valuation(
        db_session, name="Owed by Sam", created_on=DAY, type="Cash", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=0,
    )
    client = _client(db_session)
    try:
        response = client.post("/api/splits", json={
            "name": "Rent", "created_on": DAY.isoformat(),
            "members": [{"payee_id": sam.id, "account_id": picked.id, "percent": "50"}],
        })
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert _links(db_session) == []


def test_no_seeded_owed_to_me_means_no_link_and_no_error(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        response = _split(client, sam.id)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201 and _links(db_session) == []


def test_an_archived_seeded_owed_to_me_is_not_linked(db_session):
    seed_defaults(db_session)
    owed = db_session.scalar(select(Category).where(Category.seeded_key == OWED_TO_ME_KEY))
    owed.archived_on = datetime.date(2026, 1, 1)
    db_session.flush()
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        response = _split(client, sam.id)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201 and _links(db_session) == []
