"""#19: a category that overspends draws on its pool chain instead of going negative
(DESIGN.md § Categories → Pools). The draw is an ordinary earmark pair per hop written by
`write_transaction`, so ready to assign never moves.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, EarmarkLine
from app.services.accounts import create_account_with_opening_valuation
from app.services.categories import category_balance_cents, pool_available_cents
from app.services.earmarks import move_money, ready_to_assign_cents
from app.services.transactions import write_transaction

DAY = datetime.date(2026, 3, 1)


@pytest.fixture()
def client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def chequing(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=1000_00,
    )
    db_session.flush()
    return account


def _category(db_session, name, pool=None):
    category = Category(name=name, created_on=DAY, pool_id=pool.id if pool else None)
    db_session.add(category)
    db_session.flush()
    return category


def _fund(db_session, category, cents):
    move_money(db_session, move_date=DAY, from_category_id=None, to_category_id=category.id, cents=cents)


def _spend(db_session, account, category, cents, *, transaction=None, on=DAY):
    return write_transaction(
        db_session, transaction=transaction, txn_date=on, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -cents}],
        category_lines=[{"category_id": category.id, "cents": -cents}],
    )


def _balance(db_session, category):
    return category_balance_cents(db_session, category.id, as_of=DAY)


def _draws(db_session):
    return db_session.query(EarmarkLine).filter_by(source="pool_draw").order_by(EarmarkLine.id).all()


def test_a_single_hop_draw_covers_the_shortfall_from_the_pool(db_session, chequing):
    food = _category(db_session, "Food")
    snacks = _category(db_session, "Snacks", pool=food)
    _fund(db_session, food, 100_00)
    _fund(db_session, snacks, 10_00)

    txn = _spend(db_session, chequing, snacks, 50_00)  # 10.00 own + 40.00 from Food

    assert _balance(db_session, snacks) == 0
    assert _balance(db_session, food) == 60_00
    draws = _draws(db_session)
    assert [(d.category_id, d.cents, d.date, d.transaction_id) for d in draws] == [
        (food.id, -40_00, DAY, txn.id), (snacks.id, 40_00, DAY, txn.id),
    ]


def test_a_two_hop_chain_draws_from_each_pool_in_turn(db_session, chequing, client):
    household = _category(db_session, "Household")
    food = _category(db_session, "Food", pool=household)
    snacks = _category(db_session, "Snacks", pool=food)
    _fund(db_session, food, 40_00)
    _fund(db_session, household, 100_00)

    resp = client.post("/api/transactions", json={
        "date": DAY.isoformat(),
        "account_lines": [{"account_id": chequing.id, "cents": -60_00}],
        "category_lines": [{"category_id": snacks.id, "cents": -60_00}],
    })

    assert resp.status_code == 201
    assert (_balance(db_session, snacks), _balance(db_session, food), _balance(db_session, household)) == (0, 0, 80_00)
    assert len(_draws(db_session)) == 4  # a pair per hop
    assert "Snacks: covered $40.00 from Food, then $20.00 from Household." in resp.json()["notes"]


def test_a_chain_too_short_to_cover_leaves_the_remainder_negative(db_session, chequing):
    food = _category(db_session, "Food")
    snacks = _category(db_session, "Snacks", pool=food)
    _fund(db_session, food, 30_00)

    _spend(db_session, chequing, snacks, 50_00)

    assert _balance(db_session, food) == 0  # a draw never takes a pool below zero
    assert _balance(db_session, snacks) == -20_00


def test_no_draw_when_the_category_covers_itself_or_has_no_pool(db_session, chequing):
    food = _category(db_session, "Food")
    snacks = _category(db_session, "Snacks", pool=food)
    loner = _category(db_session, "Loner")
    _fund(db_session, food, 100_00)
    _fund(db_session, snacks, 50_00)

    _spend(db_session, chequing, snacks, 50_00)
    _spend(db_session, chequing, loner, 5_00)

    assert _draws(db_session) == []
    assert _balance(db_session, loner) == -5_00


def test_editing_regenerates_the_draws(db_session, chequing):
    food = _category(db_session, "Food")
    snacks = _category(db_session, "Snacks", pool=food)
    _fund(db_session, food, 100_00)
    txn = _spend(db_session, chequing, snacks, 40_00)
    assert _balance(db_session, food) == 60_00

    _spend(db_session, chequing, snacks, 25_00, transaction=txn)  # edit down

    assert _balance(db_session, food) == 75_00
    assert [d.cents for d in _draws(db_session)] == [-25_00, 25_00]

    _spend(db_session, chequing, snacks, 25_00, transaction=txn, on=DAY)
    assert len(_draws(db_session)) == 2  # regenerated, not stacked


def test_deleting_removes_the_draws(db_session, chequing, client):
    food = _category(db_session, "Food")
    snacks = _category(db_session, "Snacks", pool=food)
    _fund(db_session, food, 100_00)
    txn = _spend(db_session, chequing, snacks, 40_00)

    assert client.delete(f"/api/transactions/{txn.id}").status_code == 204

    assert _draws(db_session) == []
    assert _balance(db_session, food) == 100_00
    assert _balance(db_session, snacks) == 0


def test_draws_leave_ready_to_assign_untouched(db_session, chequing):
    food = _category(db_session, "Food")
    snacks = _category(db_session, "Snacks", pool=food)
    _fund(db_session, food, 100_00)
    _fund(db_session, snacks, 10_00)
    # Reference: the same spend with no pool, so nothing is drawn.
    plain = _category(db_session, "Plain")
    _fund(db_session, plain, 10_00)
    before = ready_to_assign_cents(db_session, as_of=DAY)
    assert before == 880_00

    _spend(db_session, chequing, snacks, 50_00)

    # Spending 50.00 categorised, all of it now sitting in categories: ready to assign is what
    # it was, the pair having netted to zero.
    assert ready_to_assign_cents(db_session, as_of=DAY) == before


def test_a_pool_cycle_already_in_the_data_cannot_hang_a_draw(db_session, chequing):
    a = _category(db_session, "A")
    b = _category(db_session, "B", pool=a)
    a.pool_id = b.id  # settings refuse this; the walk must survive it anyway
    db_session.flush()
    _fund(db_session, b, 30_00)

    _spend(db_session, chequing, a, 30_00)

    assert _balance(db_session, a) == 0
    assert _balance(db_session, b) == 0


def test_the_available_endpoint_reports_what_the_chain_could_cover(db_session, chequing, client):
    household = _category(db_session, "Household")
    food = _category(db_session, "Food", pool=household)
    snacks = _category(db_session, "Snacks", pool=food)
    _fund(db_session, food, 70_00)
    _fund(db_session, household, 100_00)
    _spend(db_session, chequing, household, 130_00)  # household ends −30.00: counts as nothing

    assert pool_available_cents(db_session, snacks.id, as_of=DAY) == 70_00
    body = client.get("/api/ready-to-assign", params={"as_of": DAY.isoformat()}).json()
    by_id = {c["category_id"]: c for c in body["categories"]}
    assert by_id[snacks.id]["pool_available_cents"] == 70_00
    assert by_id[household.id]["pool_available_cents"] == 0
