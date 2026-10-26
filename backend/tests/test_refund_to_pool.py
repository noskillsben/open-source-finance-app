"""#436: a refund on a category with a pool may go back up to the pool, through the envelope
step (DESIGN.md § Categories -> Pools, A refund can go back to the pool). The move is an
earmark from the refunded category to a pool in its chain, source `deposit`.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, EarmarkLine
from app.services.accounts import create_account_with_opening_valuation
from app.services.categories import category_balance_cents
from app.services.earmarks import move_money, ready_to_assign_cents
from app.services.transaction_actions import delete_transaction as remove_transaction
from app.services.transactions import TransactionError, read_deposits, write_transaction

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


def _category(db_session, name, pool=None):
    category = Category(name=name, created_on=DAY, pool_id=pool.id if pool else None)
    db_session.add(category)
    db_session.flush()
    return category


@pytest.fixture()
def world(db_session):
    chequing = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=1000_00,
    )
    db_session.flush()
    parent = _category(db_session, "Health and personal care")
    therapy = _category(db_session, "Therapy", pool=parent)
    return chequing, parent, therapy


def _refund(db_session, chequing, therapy, cents, *, deposits, transaction=None):
    return write_transaction(
        db_session, transaction=transaction, txn_date=DAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": cents}],
        category_lines=[{"category_id": therapy.id, "cents": cents}],
        deposits=deposits,
    )


def _bal(db_session, category):
    return category_balance_cents(db_session, category.id, as_of=DAY)


def test_the_done_looks_like_example(db_session, world):
    chequing, parent, therapy = world
    # Health and personal care sits at -$140; a $160 Therapy refund sends $140 up, leaving $20.
    move_money(db_session, move_date=DAY, from_category_id=parent.id, to_category_id=None, cents=140_00)
    assert _bal(db_session, parent) == -140_00
    rta = ready_to_assign_cents(db_session, as_of=DAY)
    _refund(db_session, chequing, therapy, 160_00,
            deposits=[{"category_id": parent.id, "cents": 140_00, "other_category_id": therapy.id}])
    assert _bal(db_session, parent) == 0
    assert _bal(db_session, therapy) == 20_00
    assert ready_to_assign_cents(db_session, as_of=DAY) == rta
    assert {l.source for l in db_session.query(EarmarkLine).filter_by(category_id=parent.id)} >= {"deposit"}


def test_accepted_on_a_pool_category_with_no_linked_account(db_session, world):
    chequing, parent, therapy = world
    t = _refund(db_session, chequing, therapy, 50_00,
                deposits=[{"category_id": parent.id, "cents": 30_00, "other_category_id": therapy.id}])
    assert _bal(db_session, parent) == 30_00
    assert _bal(db_session, therapy) == 20_00
    assert read_deposits(db_session, t) == [
        {"category_id": parent.id, "cents": 30_00, "other_category_id": therapy.id}
    ]


def test_rejected_over_the_positive_lines_on_that_category(db_session, world):
    chequing, parent, therapy = world
    with pytest.raises(TransactionError, match="no more than that"):
        _refund(db_session, chequing, therapy, 50_00,
                deposits=[{"category_id": parent.id, "cents": 50_01, "other_category_id": therapy.id}])
    with pytest.raises(TransactionError, match="no more than that"):
        _refund(db_session, chequing, therapy, 50_00, deposits=[
            {"category_id": parent.id, "cents": 30_00, "other_category_id": therapy.id},
            {"category_id": parent.id, "cents": 20_01, "other_category_id": therapy.id},
        ])


def test_a_category_outside_the_chain_is_refused(db_session, world):
    chequing, parent, therapy = world
    other = _category(db_session, "Gifts")
    with pytest.raises(TransactionError, match="linked categories"):
        _refund(db_session, chequing, therapy, 50_00,
                deposits=[{"category_id": other.id, "cents": 10_00, "other_category_id": therapy.id}])


def test_regenerated_on_edit_and_removed_on_delete(db_session, world):
    chequing, parent, therapy = world
    t = _refund(db_session, chequing, therapy, 50_00,
                deposits=[{"category_id": parent.id, "cents": 30_00, "other_category_id": therapy.id}])
    _refund(db_session, chequing, therapy, 50_00, transaction=t,
            deposits=[{"category_id": parent.id, "cents": 10_00, "other_category_id": therapy.id}])
    assert _bal(db_session, parent) == 10_00
    assert db_session.query(EarmarkLine).filter_by(source="deposit").count() == 2
    _refund(db_session, chequing, therapy, 50_00, transaction=t, deposits=[])
    assert _bal(db_session, parent) == 0
    assert db_session.query(EarmarkLine).filter_by(source="deposit").count() == 0
    _refund(db_session, chequing, therapy, 50_00, transaction=t,
            deposits=[{"category_id": parent.id, "cents": 10_00, "other_category_id": therapy.id}])
    remove_transaction(db_session, t)
    assert _bal(db_session, parent) == 0
    assert db_session.query(EarmarkLine).filter_by(source="deposit").count() == 0


def test_over_the_api(client, db_session, world):
    chequing, parent, therapy = world
    body = {
        "date": DAY.isoformat(),
        "account_lines": [{"account_id": chequing.id, "cents": 40_00}],
        "category_lines": [{"category_id": therapy.id, "cents": 40_00}],
        "deposits": [{"category_id": parent.id, "cents": 40_01, "other_category_id": therapy.id}],
    }
    assert client.post("/api/transactions", json=body).status_code == 400
    body["deposits"][0]["cents"] = 40_00
    response = client.post("/api/transactions", json=body)
    assert response.status_code == 201
    assert response.json()["deposits"] == [
        {"category_id": parent.id, "cents": 40_00, "other_category_id": therapy.id}
    ]
