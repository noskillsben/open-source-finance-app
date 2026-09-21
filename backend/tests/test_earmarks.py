"""#17: assigning ready to assign to categories. Ready to assign is one plain difference —
on-budget money minus every category balance — so an expense against a funded category leaves it
unchanged (the permanent regression test), and an overspent category reads back into it.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, EarmarkLine
from app.services.accounts import create_account_with_opening_valuation
from app.services.categories import category_balance_cents
from app.services.earmarks import EarmarkError, assign_to_category, move_money, overspent_cents, ready_to_assign_cents
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


def _account(db_session, name="Chequing", *, opening=1000_00, floor=0, on_budget=True):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=DAY, type="Chequing", on_budget=on_budget,
        on_budget_floor_cents=floor, opening_balance_cents=opening,
    )
    db_session.flush()
    return account


def _category(db_session, name="Groceries"):
    category = Category(name=name, created_on=DAY)
    db_session.add(category)
    db_session.flush()
    return category


def _spend(db_session, account, category, cents, on=DAY):
    return write_transaction(
        db_session, transaction=None, txn_date=on, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -cents}],
        category_lines=[{"category_id": category.id, "cents": -cents}],
    )


def test_an_opening_balance_arrives_as_ready_to_assign(db_session):
    _account(db_session, opening=1000_00)
    assert ready_to_assign_cents(db_session, as_of=DAY) == 1000_00


def test_assigning_lowers_ready_to_assign_and_raises_available(db_session):
    _account(db_session, opening=1000_00)
    groceries = _category(db_session)

    assign_to_category(db_session, move_date=DAY, category_id=groceries.id, cents=300_00)

    assert ready_to_assign_cents(db_session, as_of=DAY) == 700_00
    assert category_balance_cents(db_session, groceries.id, as_of=DAY) == 300_00


def test_an_expense_against_a_funded_category_leaves_ready_to_assign_unchanged(db_session):
    chequing = _account(db_session, opening=1000_00)
    groceries = _category(db_session)
    assign_to_category(db_session, move_date=DAY, category_id=groceries.id, cents=300_00)
    before = ready_to_assign_cents(db_session, as_of=DAY)

    _spend(db_session, chequing, groceries, 80_00)

    assert ready_to_assign_cents(db_session, as_of=DAY) == before == 700_00
    assert category_balance_cents(db_session, groceries.id, as_of=DAY) == 220_00


def test_an_overspent_category_raises_ready_to_assign_and_shows_in_the_parenthetical(db_session):
    chequing = _account(db_session, opening=1000_00)
    groceries = _category(db_session)
    assign_to_category(db_session, move_date=DAY, category_id=groceries.id, cents=100_00)

    _spend(db_session, chequing, groceries, 150_00)  # 50.00 past what was assigned

    assert category_balance_cents(db_session, groceries.id, as_of=DAY) == -50_00
    # The spend is categorised, so it moves on-budget money and the category together and ready
    # to assign stays at 900.00 — 50.00 more than the 850.00 it would read if the overspend were
    # covered (category back at zero): the arithmetic mirror the headline's parenthetical names.
    assert ready_to_assign_cents(db_session, as_of=DAY) == 900_00
    assign_to_category(db_session, move_date=DAY, category_id=groceries.id, cents=50_00)  # cover it
    assert ready_to_assign_cents(db_session, as_of=DAY) == 850_00
    assert overspent_cents(db_session, as_of=DAY) == 0
    assign_to_category(db_session, move_date=DAY, category_id=groceries.id, cents=-50_00)  # undo
    assert overspent_cents(db_session, as_of=DAY) == -50_00


def test_overspent_sums_only_negative_balances(db_session):
    chequing = _account(db_session, opening=1000_00)
    funded, short, also_short = _category(db_session, "A"), _category(db_session, "B"), _category(db_session, "C")
    assign_to_category(db_session, move_date=DAY, category_id=funded.id, cents=500_00)
    _spend(db_session, chequing, short, 30_00)
    _spend(db_session, chequing, also_short, 20_00)

    assert overspent_cents(db_session, as_of=DAY) == -50_00  # the funded 500.00 is not netted in


def test_a_balance_below_the_floor_is_negative_on_budget_money(db_session):
    _account(db_session, opening=-1500_00, floor=-1000_00)  # 500.00 below the floor
    assert ready_to_assign_cents(db_session, as_of=DAY) == -500_00


def test_tracking_accounts_do_not_count(db_session):
    _account(db_session, "Home", opening=300000_00, on_budget=False)
    assert ready_to_assign_cents(db_session, as_of=DAY) == 0


def test_lines_after_the_date_are_not_counted(db_session):
    _account(db_session, opening=1000_00)
    groceries = _category(db_session)
    assign_to_category(db_session, move_date=datetime.date(2026, 4, 1), category_id=groceries.id, cents=300_00)

    assert ready_to_assign_cents(db_session, as_of=DAY) == 1000_00
    assert ready_to_assign_cents(db_session, as_of=datetime.date(2026, 4, 1)) == 700_00


def test_a_zero_amount_and_an_unknown_category_are_refused(db_session):
    groceries = _category(db_session)
    with pytest.raises(EarmarkError):
        assign_to_category(db_session, move_date=DAY, category_id=groceries.id, cents=0)
    with pytest.raises(EarmarkError):
        assign_to_category(db_session, move_date=DAY, category_id=999999, cents=100)


def test_an_archived_category_cannot_be_assigned_to(db_session):
    groceries = _category(db_session)
    groceries.archived_on = datetime.date(2026, 2, 1)
    with pytest.raises(EarmarkError, match="archived"):
        assign_to_category(db_session, move_date=DAY, category_id=groceries.id, cents=100)


def test_an_assignment_dated_before_the_category_existed_backdates_it(db_session):
    groceries = _category(db_session)
    assign_to_category(db_session, move_date=datetime.date(2026, 1, 1), category_id=groceries.id, cents=100)
    assert groceries.created_on == datetime.date(2026, 1, 1)


def test_the_move_line_is_stored_with_source_move(db_session):
    groceries = _category(db_session)
    line = assign_to_category(db_session, move_date=DAY, category_id=groceries.id, cents=100_00)
    assert (line.date, line.cents, line.source) == (DAY, 100_00, "move")
    assert db_session.query(EarmarkLine).count() == 1


def test_the_endpoints_assign_and_report_both_numbers(client, db_session):
    chequing = _account(db_session, opening=1000_00)
    groceries = _category(db_session)

    resp = client.post(
        "/api/earmark-moves", json={"date": "2026-03-01", "to_category_id": groceries.id, "cents": 100_00}
    )
    assert resp.status_code == 201
    assert [line["source"] for line in resp.json()] == ["move"]
    _spend(db_session, chequing, groceries, 130_00)

    summary = client.get("/api/ready-to-assign", params={"as_of": "2026-03-01"}).json()
    assert summary["ready_to_assign_cents"] == 900_00
    assert summary["overspent_cents"] == -30_00
    assert {"category_id": groceries.id, "available_cents": -30_00} in summary["categories"]


def test_the_endpoint_refuses_a_bad_assignment_with_400(client, db_session):
    groceries = _category(db_session)
    resp = client.post("/api/earmark-moves", json={"date": "2026-03-01", "to_category_id": groceries.id, "cents": 0})
    assert resp.status_code == 400
    assert "amount" in resp.json()["detail"]


# --- #18: moving money between categories ---


def test_a_category_to_category_move_writes_two_lines_summing_to_zero(db_session):
    _account(db_session, opening=1000_00)
    rent, fun = _category(db_session, "Rent"), _category(db_session, "Fun")
    assign_to_category(db_session, move_date=DAY, category_id=rent.id, cents=400_00)
    before = ready_to_assign_cents(db_session, as_of=DAY)
    lines_before = db_session.query(EarmarkLine).count()

    lines = move_money(db_session, move_date=DAY, from_category_id=rent.id, to_category_id=fun.id, cents=150_00)

    assert db_session.query(EarmarkLine).count() == lines_before + 2
    assert sorted((l.category_id, l.cents) for l in lines) == sorted([(rent.id, -150_00), (fun.id, 150_00)])
    assert sum(l.cents for l in lines) == 0
    assert all(l.source == "move" for l in lines)
    assert category_balance_cents(db_session, rent.id, as_of=DAY) == 250_00
    assert category_balance_cents(db_session, fun.id, as_of=DAY) == 150_00
    assert ready_to_assign_cents(db_session, as_of=DAY) == before  # the world total does not move


def test_a_move_against_ready_to_assign_writes_exactly_one_line(db_session):
    _account(db_session, opening=1000_00)
    fun = _category(db_session, "Fun")

    (added,) = move_money(db_session, move_date=DAY, from_category_id=None, to_category_id=fun.id, cents=200_00)
    assert (added.category_id, added.cents) == (fun.id, 200_00)
    assert ready_to_assign_cents(db_session, as_of=DAY) == 800_00

    (withdrawn,) = move_money(db_session, move_date=DAY, from_category_id=fun.id, to_category_id=None, cents=50_00)
    assert (withdrawn.category_id, withdrawn.cents) == (fun.id, -50_00)
    assert db_session.query(EarmarkLine).count() == 2
    assert ready_to_assign_cents(db_session, as_of=DAY) == 850_00


def test_a_move_may_take_a_category_negative(db_session):
    _account(db_session, opening=1000_00)
    rent, fun = _category(db_session, "Rent"), _category(db_session, "Fun")

    move_money(db_session, move_date=DAY, from_category_id=rent.id, to_category_id=fun.id, cents=75_00)

    assert category_balance_cents(db_session, rent.id, as_of=DAY) == -75_00


def test_a_bad_move_is_refused_and_writes_nothing(db_session):
    rent = _category(db_session, "Rent")
    gone = _category(db_session, "Gone")
    gone.archived_on = datetime.date(2026, 2, 1)
    for kwargs in (
        dict(from_category_id=rent.id, to_category_id=None, cents=0),
        dict(from_category_id=rent.id, to_category_id=None, cents=-5),
        dict(from_category_id=None, to_category_id=None, cents=5),
        dict(from_category_id=rent.id, to_category_id=rent.id, cents=5),
        dict(from_category_id=rent.id, to_category_id=999999, cents=5),
        dict(from_category_id=rent.id, to_category_id=gone.id, cents=5),
    ):
        with pytest.raises(EarmarkError):
            move_money(db_session, move_date=DAY, **kwargs)
    assert db_session.query(EarmarkLine).count() == 0


def test_the_move_endpoint_returns_the_lines(client, db_session):
    rent, fun = _category(db_session, "Rent"), _category(db_session, "Fun")
    resp = client.post(
        "/api/earmark-moves",
        json={"date": "2026-03-01", "from_category_id": rent.id, "to_category_id": fun.id, "cents": 10_00},
    )
    assert resp.status_code == 201
    assert sorted(l["cents"] for l in resp.json()) == [-10_00, 10_00]
    bad = client.post("/api/earmark-moves", json={"date": "2026-03-01", "cents": 10_00})
    assert bad.status_code == 400
