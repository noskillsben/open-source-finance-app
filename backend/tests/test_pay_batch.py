"""#126: a pay's earmark batch is saved whole. One call states every pay-batch line for a
transaction and replaces whatever was there, in one database transaction, so a failure leaves the
old batch rather than half a new one (DESIGN.md § Earmarks). The general move path refuses to
write pay-batch lines.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, EarmarkLine
from app.services.accounts import create_account_with_opening_valuation
from app.services.categories import category_balance_cents
from app.services.earmarks import EarmarkError, move_money, pay_batch_lines, replace_pay_batch
from app.services.transactions import write_transaction

DAY = datetime.date(2026, 3, 1)
PAYDAY = datetime.date(2026, 3, 15)


@pytest.fixture()
def client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _category(db_session, name):
    category = Category(name=name, created_on=DAY)
    db_session.add(category)
    db_session.flush()
    return category


@pytest.fixture()
def pay(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    salary = _category(db_session, "Salary income")
    groceries = _category(db_session, "Groceries")
    rent = _category(db_session, "Rent")
    txn = write_transaction(
        db_session, transaction=None, txn_date=PAYDAY, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": 2_400_00}],
        category_lines=[{"category_id": salary.id, "cents": 2_400_00}],
    )
    db_session.flush()
    return txn, salary, groceries, rent


def _batch(session, txn):
    return [(line.category_id, line.cents) for line in pay_batch_lines(session, txn.id)]


def test_replace_then_replace_again_then_empty(db_session, pay):
    txn, salary, groceries, rent = pay

    first = replace_pay_batch(db_session, txn, [
        {"category_id": salary.id, "cents": -2_400_00},
        {"category_id": groceries.id, "cents": 500_00},
    ])
    assert all((l.source, l.transaction_id, l.date) == ("pay_batch", txn.id, PAYDAY) for l in first)
    assert _batch(db_session, txn) == [(salary.id, -2_400_00), (groceries.id, 500_00)]

    replace_pay_batch(db_session, txn, [
        {"category_id": salary.id, "cents": -2_400_00},
        {"category_id": rent.id, "cents": 1_200_00},
    ])
    assert _batch(db_session, txn) == [(salary.id, -2_400_00), (rent.id, 1_200_00)]
    assert category_balance_cents(db_session, groceries.id, as_of=PAYDAY) == 0  # the old line is gone
    assert category_balance_cents(db_session, rent.id, as_of=PAYDAY) == 1_200_00

    replace_pay_batch(db_session, txn, [])
    assert _batch(db_session, txn) == []
    assert db_session.query(EarmarkLine).count() == 0


def test_one_invalid_line_leaves_the_old_batch_intact(client, db_session, pay):
    txn, salary, groceries, rent = pay
    old = [{"category_id": salary.id, "cents": -2_400_00}, {"category_id": groceries.id, "cents": 500_00}]
    assert client.put(f"/api/transactions/{txn.id}/pay-batch", json={"lines": old}).status_code == 200

    resp = client.put(f"/api/transactions/{txn.id}/pay-batch", json={"lines": [
        {"category_id": salary.id, "cents": -2_400_00},
        {"category_id": rent.id, "cents": 1_200_00},
        {"category_id": 999999, "cents": 100_00},
    ]})

    assert resp.status_code == 400
    assert _batch(db_session, txn) == [(salary.id, -2_400_00), (groceries.id, 500_00)]
    assert category_balance_cents(db_session, rent.id, as_of=PAYDAY) == 0


def test_the_endpoints_read_and_replace(client, db_session, pay):
    txn, salary, groceries, _ = pay
    lines = [{"category_id": salary.id, "cents": -2_400_00}, {"category_id": groceries.id, "cents": 500_00}]

    put = client.put(f"/api/transactions/{txn.id}/pay-batch", json={"lines": lines})
    got = client.get(f"/api/transactions/{txn.id}/pay-batch")

    assert put.status_code == 200
    assert [(l["category_id"], l["cents"], l["source"]) for l in got.json()] == [
        (salary.id, -2_400_00, "pay_batch"), (groceries.id, 500_00, "pay_batch"),
    ]
    assert client.get("/api/transactions/999999/pay-batch").status_code == 404
    assert client.put("/api/transactions/999999/pay-batch", json={"lines": []}).status_code == 404


def test_the_batch_leaves_plain_moves_and_generated_lines_alone(db_session, pay):
    txn, salary, groceries, rent = pay
    move_money(db_session, move_date=PAYDAY, from_category_id=None, to_category_id=rent.id, cents=50_00)
    db_session.add(
        EarmarkLine(date=PAYDAY, category_id=rent.id, cents=-10_00, source="pool_draw", transaction_id=txn.id)
    )
    db_session.flush()

    replace_pay_batch(db_session, txn, [{"category_id": groceries.id, "cents": 500_00}])
    replace_pay_batch(db_session, txn, [])

    assert sorted(l.source for l in db_session.query(EarmarkLine)) == ["move", "pool_draw"]


def test_an_archived_category_saves_unchanged_but_takes_nothing_new(db_session, pay):
    """DESIGN.md § Re-opening a recorded pay: a row on a category archived since is read-only —
    it saves unchanged, and nothing else may land on an archived category."""
    txn, salary, groceries, rent = pay
    replace_pay_batch(db_session, txn, [
        {"category_id": salary.id, "cents": -2_400_00},
        {"category_id": groceries.id, "cents": 500_00},
    ])
    groceries.archived_on = datetime.date(2026, 4, 1)
    rent.archived_on = datetime.date(2026, 4, 1)
    db_session.flush()

    # The same category and cents saves.
    replace_pay_batch(db_session, txn, [
        {"category_id": salary.id, "cents": -2_400_00},
        {"category_id": groceries.id, "cents": 500_00},
    ])
    # A different amount, a second copy, or a category the old batch never held is refused.
    for lines in (
        [{"category_id": groceries.id, "cents": 600_00}],
        [{"category_id": groceries.id, "cents": 500_00}, {"category_id": groceries.id, "cents": 500_00}],
        [{"category_id": rent.id, "cents": 100_00}],
    ):
        with pytest.raises(EarmarkError, match="archived"):
            replace_pay_batch(db_session, txn, lines)
    assert _batch(db_session, txn) == [(salary.id, -2_400_00), (groceries.id, 500_00)]

    # Dropping the archived line is allowed.
    replace_pay_batch(db_session, txn, [{"category_id": salary.id, "cents": -2_400_00}])
    assert _batch(db_session, txn) == [(salary.id, -2_400_00)]


def test_the_move_endpoint_refuses_a_transaction_id(client, db_session, pay):
    txn, _, groceries, _ = pay
    resp = client.post("/api/earmark-moves", json={
        "date": "2026-03-15", "to_category_id": groceries.id, "cents": 100_00, "transaction_id": txn.id,
    })
    assert resp.status_code == 400
    assert "pay-batch" in resp.json()["detail"]
    assert db_session.query(EarmarkLine).count() == 0


def test_the_old_batch_endpoints_are_gone(client, db_session, pay):
    txn = pay[0]
    assert client.get("/api/earmark-moves", params={"transaction_id": txn.id}).status_code == 405
    assert client.delete("/api/earmark-moves", params={"transaction_id": txn.id}).status_code == 405
