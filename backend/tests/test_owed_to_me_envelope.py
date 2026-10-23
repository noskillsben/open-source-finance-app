"""#328: money owed to you stops counting as ready to assign until it is paid back (DESIGN.md §
Accounts -> Linked categories, point 2 and Owed to me). The envelope step runs on any transaction
with a line on a linked account; the form pre-fills it from the account's balance before the line.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, EarmarkLine
from app.services.accounts import create_account_with_opening_valuation
from app.services.categories import category_balance_cents
from app.services.earmarks import ready_to_assign_cents
from app.services.links import add_category_link
from app.services.transactions import TransactionError, write_transaction

DAY = datetime.date(2026, 3, 1)
LATER = datetime.date(2026, 3, 10)


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


def _account(db_session, name, type, opening=0):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=DAY, type=type, on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=opening,
    )
    db_session.flush()
    return account


@pytest.fixture()
def world(db_session):
    chequing = _account(db_session, "Chequing", "Chequing", 1000_00)
    sam = _account(db_session, "Sam", "Money owed to me")
    owed = _category(db_session, "Owed to me")
    electricity = _category(db_session, "Electricity")
    add_category_link(db_session, owed.id, sam.id)
    return chequing, sam, owed, electricity


def _write(db_session, lines, categories=(), *, deposits=None, day=DAY):
    return write_transaction(
        db_session, transaction=None, txn_date=day, memo=None, payee_id=None,
        account_lines=[{"account_id": a.id, "cents": c} for a, c in lines],
        category_lines=[{"category_id": cat.id, "cents": c} for cat, c in categories],
        deposits=deposits,
    )


def _rta(db_session):
    return ready_to_assign_cents(db_session, as_of=LATER)


def _owed(db_session, owed):
    return category_balance_cents(db_session, owed.id, as_of=LATER)


def test_shared_bill_I_paid_then_settled_up(db_session, world):
    chequing, sam, owed, electricity = world
    start = _rta(db_session)
    # Chequing -100, Sam +50, Electricity -50: the bill alone changes nothing; the envelope takes $50.
    _write(db_session, [(chequing, -100_00), (sam, 50_00)], [(electricity, -50_00)],
           deposits=[{"category_id": owed.id, "cents": 50_00}])
    assert _rta(db_session) == start - 50_00
    assert _owed(db_session, owed) == 50_00
    # Sam settles: Sam -50, Chequing +50; the step moves it back to ready to assign.
    _write(db_session, [(sam, -50_00), (chequing, 50_00)], day=LATER,
           deposits=[{"category_id": owed.id, "cents": 50_00}])
    assert _rta(db_session) == start
    assert _owed(db_session, owed) == 0
    lines = db_session.query(EarmarkLine).filter_by(source="deposit").all()
    assert sorted(line.cents for line in lines) == [-50_00, 50_00]


def test_paid_by_sam_while_his_balance_is_zero_directs_nothing(db_session, world):
    chequing, sam, owed, electricity = world
    start = _rta(db_session)
    _write(db_session, [(sam, -50_00)], [(electricity, -50_00)], deposits=[])
    assert _rta(db_session) == start
    assert _owed(db_session, owed) == 0
    assert db_session.query(EarmarkLine).filter_by(source="deposit").count() == 0


def test_writing_a_debt_off_to_a_category_takes_it_out_of_the_envelope(db_session, world):
    chequing, sam, owed, electricity = world
    _write(db_session, [(chequing, -40_00), (sam, 40_00)], deposits=[{"category_id": owed.id, "cents": 40_00}])
    gifts = _category(db_session, "Gifts")
    _write(db_session, [(sam, -40_00)], [(gifts, -40_00)],
           deposits=[{"category_id": owed.id, "cents": 40_00}], day=LATER)
    assert _owed(db_session, owed) == 0


def test_the_directed_total_may_be_less_than_the_line_never_more(db_session, world):
    chequing, sam, owed, electricity = world
    _write(db_session, [(chequing, -100_00), (sam, 50_00)], [(electricity, -50_00)],
           deposits=[{"category_id": owed.id, "cents": 20_00}])
    with pytest.raises(TransactionError, match="can't exceed"):
        _write(db_session, [(chequing, -100_00), (sam, 50_00)], [(electricity, -50_00)],
               deposits=[{"category_id": owed.id, "cents": 50_01}])


def test_balance_read_excludes_one_transaction_and_respects_the_date(client, db_session, world):
    chequing, sam, owed, electricity = world
    first = _write(db_session, [(chequing, -30_00), (sam, 30_00)], deposits=[])
    second = _write(db_session, [(chequing, -20_00), (sam, 20_00)], day=LATER, deposits=[])
    db_session.flush()

    def read(**params):
        response = client.get(f"/api/accounts/{sam.id}/balance", params=params)
        assert response.status_code == 200
        return response.json()["balance_cents"]

    assert read(as_of=LATER.isoformat()) == 50_00
    assert read(as_of=DAY.isoformat()) == 30_00
    assert read(as_of=LATER.isoformat(), exclude_transaction_id=second.id) == 30_00
    assert read(as_of=LATER.isoformat(), exclude_transaction_id=first.id) == 20_00
    assert client.get("/api/accounts/9999/balance", params={"as_of": DAY.isoformat()}).status_code == 404


def test_a_line_that_crosses_zero_directs_only_the_part_above_zero(client, db_session, world):
    """The form's pre-fill is max(0, b+c) - max(0, b); the write stores what the form sends."""
    chequing, sam, owed, electricity = world
    _write(db_session, [(sam, -20_00)], [(electricity, -20_00)], deposits=[])
    b = client.get(f"/api/accounts/{sam.id}/balance", params={"as_of": LATER.isoformat()}).json()["balance_cents"]
    assert b == -20_00
    c = 50_00
    directed = max(0, b + c) - max(0, b)
    assert directed == 30_00
    start = _rta(db_session)
    _write(db_session, [(chequing, -c), (sam, c)], day=LATER, deposits=[{"category_id": owed.id, "cents": directed}])
    assert _owed(db_session, owed) == 30_00
    assert _rta(db_session) == start - 30_00


def test_drift_note_counts_an_account_below_zero_as_holding_nothing(client, db_session, world):
    chequing, sam, owed, electricity = world
    _write(db_session, [(sam, -50_00)], [(electricity, -50_00)], deposits=[])
    account = next(a for a in client.get("/api/accounts").json() if a["id"] == sam.id)
    assert not any("hold" in n or "claimed" in n for n in account["notes"])
    # once Sam holds money nobody has claimed, the note speaks
    _write(db_session, [(chequing, -80_00), (sam, 80_00)], day=LATER, deposits=[])
    accounts = client.get("/api/accounts", params={"as_of": LATER.isoformat()}).json()
    account = next(a for a in accounts if a["id"] == sam.id)
    assert any("$30.00 not claimed by Owed to me" in n for n in account["notes"])
