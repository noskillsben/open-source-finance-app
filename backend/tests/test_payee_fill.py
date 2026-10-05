"""DESIGN.md § Payees: picking a payee fills in the category, account and split from the last
transaction naming them — read from the ledger, never stored.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, Payee, Split, SplitMember
from app.seed import ME_KEY
from app.services.accounts import create_account_with_opening_valuation

DAY = datetime.date(2026, 3, 1)
LATER = datetime.date(2026, 6, 1)


@pytest.fixture()
def client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _account(db_session, name):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()
    return account


def _category(db_session, name):
    category = Category(name=name, created_on=DAY)
    db_session.add(category)
    db_session.flush()
    return category


def _payee(db_session, name, **extra):
    payee = Payee(name=name, created_on=DAY, **extra)
    db_session.add(payee)
    db_session.flush()
    return payee


def _post(client, payee, account_lines, category_lines, day=DAY, **extra):
    response = client.post("/api/transactions", json={
        "date": day.isoformat(), "payee_id": payee.id,
        "account_lines": [{"account_id": a, "cents": c} for a, c in account_lines],
        "category_lines": [{"category_id": a, "cents": c} for a, c in category_lines], **extra,
    })
    assert response.status_code == 201, response.text


def _fill(client, payee, as_of=LATER):
    response = client.get(f"/api/payees/{payee.id}/fill", params={"as_of": as_of.isoformat()})
    assert response.status_code == 200, response.text
    return response.json()


NOTHING = {"category_id": None, "account_id": None, "split_id": None}


def test_a_payee_never_paid_fills_in_nothing_and_an_unknown_payee_is_a_404(db_session, client):
    hydro = _payee(db_session, "Hydro")
    assert _fill(client, hydro) == NOTHING
    assert client.get("/api/payees/9999/fill", params={"as_of": "2026-06-01"}).status_code == 404


def test_the_latest_transaction_wins_and_its_largest_category_line_is_the_category(db_session, client):
    store, cheque, visa = _payee(db_session, "Store"), _account(db_session, "Chequing"), _account(db_session, "Visa")
    food, home, fun = (_category(db_session, n) for n in ("Food", "Home", "Fun"))
    _post(client, store, [(cheque.id, -10_00)], [(fun.id, -10_00)], day=DAY)
    # Latest by date: three lines, the biggest by absolute cents is Home; Food and Fun are smaller.
    _post(client, store, [(visa.id, -70_00)], [(food.id, -20_00), (home.id, -45_00), (fun.id, -5_00)],
          day=DAY + datetime.timedelta(days=5))

    assert _fill(client, store) == {"category_id": home.id, "account_id": visa.id, "split_id": None}


def test_a_tie_on_the_category_takes_the_lowest_line_id_and_same_day_takes_the_later_transaction(db_session, client):
    store, cheque = _payee(db_session, "Store"), _account(db_session, "Chequing")
    first, second = _category(db_session, "First"), _category(db_session, "Second")
    _post(client, store, [(cheque.id, -9_00)], [(first.id, -9_00)])
    _post(client, store, [(cheque.id, -20_00)], [(second.id, -10_00), (first.id, -10_00)])

    assert _fill(client, store)["category_id"] == second.id  # same-day: the later transaction; line tie: lowest id


def test_the_account_is_the_one_the_most_money_left(db_session, client):
    store = _payee(db_session, "Store")
    cheque, visa = _account(db_session, "Chequing"), _account(db_session, "Visa")
    _post(client, store, [(cheque.id, -5_00), (visa.id, -15_00)], [])
    assert _fill(client, store) == {"category_id": None, "account_id": visa.id, "split_id": None}


def _household(db_session):
    me = _payee(db_session, "Me", seeded_key=ME_KEY)
    roommate = _payee(db_session, "Roommate")
    cheque, owed = _account(db_session, "Chequing"), _account(db_session, "Roommate")
    split = Split(name="Household", created_on=DAY)
    db_session.add(split)
    db_session.flush()
    db_session.add(SplitMember(split_id=split.id, payee_id=roommate.id, account_id=owed.id, percent=50, created_on=DAY))
    db_session.flush()
    return me, roommate, cheque, owed, split


def test_a_shared_bill_fills_in_the_split_and_my_account(db_session, client):
    me, _roommate, cheque, owed, split = _household(db_session)
    hydro, utilities = _payee(db_session, "Hydro"), _category(db_session, "Utilities")
    _post(client, hydro, [(cheque.id, -100_00), (owed.id, 50_00)], [(utilities.id, -50_00)],
          split_id=split.id, paid_by_payee_id=me.id)

    assert _fill(client, hydro) == {"category_id": utilities.id, "account_id": cheque.id, "split_id": split.id}


def test_a_bill_the_roommate_paid_returns_no_account(db_session, client):
    _me, roommate, _cheque, owed, split = _household(db_session)
    heat, utilities = _payee(db_session, "Heat"), _category(db_session, "Utilities")
    _post(client, heat, [(owed.id, -50_00)], [(utilities.id, -50_00)], split_id=split.id, paid_by_payee_id=roommate.id)

    assert _fill(client, heat) == {"category_id": utilities.id, "account_id": None, "split_id": split.id}


def test_anything_archived_as_of_the_picker_date_comes_back_null(db_session, client):
    me, _roommate, cheque, owed, split = _household(db_session)
    hydro, utilities = _payee(db_session, "Hydro"), _category(db_session, "Utilities")
    _post(client, hydro, [(cheque.id, -100_00), (owed.id, 50_00)], [(utilities.id, -50_00)],
          split_id=split.id, paid_by_payee_id=me.id)
    cheque.archived_on, utilities.archived_on, split.archived_on = (datetime.date(2026, 5, 1),) * 3
    db_session.flush()

    assert _fill(client, hydro, as_of=datetime.date(2026, 5, 1)) == NOTHING
    # Before the archive date they are still live.
    assert _fill(client, hydro, as_of=datetime.date(2026, 4, 30)) == {
        "category_id": utilities.id, "account_id": cheque.id, "split_id": split.id,
    }
