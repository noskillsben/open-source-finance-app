"""#16: categories with a domain, a need level and a pool, arranged in a tree; domains as an
editable list. Enforcement lives in the service layer (CategoryError), not the database.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, Domain
from app.services.categories import CategoryError, apply_category_settings

EARLIER = datetime.date(2026, 1, 1)


@pytest.fixture()
def client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _make(db_session, name, **fields):
    category = Category(name=name, created_on=EARLIER, **fields)
    db_session.add(category)
    db_session.flush()
    return category


def _settings(category, **overrides):
    base = dict(name=category.name, parent_id=category.parent_id, pool_id=category.pool_id,
                domain_id=category.domain_id, need_level=category.need_level)
    return {**base, **overrides}


def test_create_with_domain_need_level_and_parent(client):
    domain = client.post("/api/domains", json={"name": "Food", "created_on": "2026-01-01"}).json()
    parent = client.post("/api/categories", json={"name": "Car", "created_on": "2026-01-01"}).json()

    resp = client.post("/api/categories", json={
        "name": "Car insurance", "created_on": "2026-01-01", "parent_id": parent["id"],
        "domain_id": domain["id"], "need_level": "should",
    })

    assert resp.status_code == 201
    body = resp.json()
    assert (body["parent_id"], body["domain_id"], body["need_level"], body["pool_id"]) == (
        parent["id"], domain["id"], "should", None)


def test_unknown_need_level_is_refused(client):
    resp = client.post("/api/categories", json={"name": "X", "created_on": "2026-01-01", "need_level": "urgent"})
    assert resp.status_code == 422


def test_unknown_domain_parent_and_pool_are_400(client):
    for field in ("domain_id", "parent_id", "pool_id"):
        resp = client.post("/api/categories", json={"name": f"X{field}", "created_on": "2026-01-01", field: 9999})
        assert resp.status_code == 400, field


def test_a_parent_category_is_postable_like_any_other(client, db_session):
    from app.services.accounts import create_account_with_opening_valuation

    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=100_00,
    )
    car = _make(db_session, "Car")
    _make(db_session, "Car insurance", parent_id=car.id)

    resp = client.post("/api/transactions", json={
        "date": "2026-01-10",
        "account_lines": [{"account_id": account.id, "cents": -40_00}],
        "category_lines": [{"category_id": car.id, "cents": -40_00}],
    })

    assert resp.status_code == 201


def test_a_category_cannot_be_its_own_pool(client, db_session):
    groceries = _make(db_session, "Groceries")

    resp = client.put(f"/api/categories/{groceries.id}", json=_settings(groceries, pool_id=groceries.id))

    assert resp.status_code == 400
    assert "own pool" in resp.json()["detail"]


def test_a_pool_chain_that_loops_back_is_refused(client, db_session):
    household = _make(db_session, "Household")
    food = _make(db_session, "Food", pool_id=household.id)
    snacks = _make(db_session, "Snacks", pool_id=food.id)

    resp = client.put(f"/api/categories/{household.id}", json=_settings(household, pool_id=snacks.id))

    assert resp.status_code == 400
    assert household.pool_id is None  # nothing persisted from the refused edit


def test_a_pool_chain_that_does_not_loop_is_accepted(client, db_session):
    household = _make(db_session, "Household")
    food = _make(db_session, "Food")
    snacks = _make(db_session, "Snacks")

    assert client.put(f"/api/categories/{food.id}", json=_settings(food, pool_id=household.id)).status_code == 200
    resp = client.put(f"/api/categories/{snacks.id}", json=_settings(snacks, pool_id=food.id))

    assert resp.status_code == 200
    assert resp.json()["pool_id"] == food.id


def test_a_category_cannot_be_placed_under_itself_or_its_own_descendant(db_session):
    car = _make(db_session, "Car")
    insurance = _make(db_session, "Car insurance", parent_id=car.id)

    for bad_parent in (insurance.id, car.id):
        with pytest.raises(CategoryError):
            apply_category_settings(
                db_session, car, name="Car", parent_id=bad_parent, pool_id=None, domain_id=None, need_level=None
            )


def test_edit_renames_and_a_taken_name_is_409(client, db_session):
    _make(db_session, "Rent")
    groceries = _make(db_session, "Groceries")

    assert client.put(f"/api/categories/{groceries.id}", json=_settings(groceries, name="Food shop")).status_code == 200
    assert client.put(f"/api/categories/{groceries.id}", json=_settings(groceries, name="rent")).status_code == 409


def test_update_missing_category_is_404(client):
    resp = client.put("/api/categories/9999", json={"name": "X"})
    assert resp.status_code == 404


def test_list_returns_the_new_fields(client, db_session):
    domain = Domain(name="Housing", created_on=EARLIER)
    db_session.add(domain)
    db_session.flush()
    _make(db_session, "Rent", domain_id=domain.id, need_level="need")

    rows = client.get("/api/categories").json()

    assert rows[0]["domain_id"] == domain.id and rows[0]["need_level"] == "need"


def test_domain_create_edit_list_and_archive(client):
    created = client.post("/api/domains", json={"name": "Food", "description": "Eating", "created_on": "2026-01-01"})
    assert created.status_code == 201
    did = created.json()["id"]

    edited = client.put(f"/api/domains/{did}", json={"name": "Food & drink", "description": None})
    assert edited.status_code == 200 and edited.json()["name"] == "Food & drink"

    archived = client.post(f"/api/domains/{did}/archive", json={"archived_on": "2026-02-01"})
    assert archived.status_code == 200
    assert client.get("/api/domains").json() == []
    assert len(client.get("/api/domains", params={"include_archived": "true"}).json()) == 1


def test_domain_names_are_unique_case_insensitively(client):
    client.post("/api/domains", json={"name": "Food", "created_on": "2026-01-01"})

    resp = client.post("/api/domains", json={"name": "food", "created_on": "2026-01-01"})

    assert resp.status_code == 409


def test_unarchiving_a_domain_into_a_taken_name_is_409(client):
    old = client.post("/api/domains", json={"name": "Food", "created_on": "2026-01-01"}).json()
    client.post(f"/api/domains/{old['id']}/archive", json={"archived_on": "2026-02-01"})
    client.post("/api/domains", json={"name": "Food", "created_on": "2026-01-01"})  # name is free while archived

    assert client.post(f"/api/domains/{old['id']}/unarchive").status_code == 409


def test_domain_missing_is_404(client):
    assert client.put("/api/domains/9999", json={"name": "X"}).status_code == 404
    assert client.post("/api/domains/9999/archive", json={"archived_on": "2026-02-01"}).status_code == 404
