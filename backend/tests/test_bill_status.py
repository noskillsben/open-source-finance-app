"""#133 — a recurring bill reads overdue / due / next due, and shows what was paid against its
last paid due date (DESIGN.md § Goals → Paying a bill). One definition of "due": the earliest
unpaid due date, which no longer rolls forward past the picker.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, Goal, IncomeStream
from app.services.accounts import create_account_with_opening_valuation

DAY = datetime.date(2026, 9, 1)


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
        db_session, name="Chequing", created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_000,
    )
    db_session.flush()
    return account


@pytest.fixture()
def salary(db_session, chequing):
    income = Category(name="Salary income", created_on=DAY)
    db_session.add(income)
    db_session.flush()
    stream = IncomeStream(  # paydays Sep 4, Sep 18, Oct 2, ...
        name="Salary", cadence="weeks", cadence_weeks=2, anchor_payday=datetime.date(2026, 9, 4),
        expected_net_low_cents=0, expected_net_high_cents=0, income_category_id=income.id,
        destination_account_id=chequing.id, created_on=DAY,
    )
    db_session.add(stream)
    db_session.flush()
    return stream


def _bill(db_session, first_due, *, stream=None, name="Rent", amount=120_000):
    category = Category(name=name, created_on=DAY)
    db_session.add(category)
    db_session.flush()
    goal = Goal(
        category_id=category.id, name=name, kind="recurring_bill", amount_cents=amount, cadence="monthly",
        target_date=first_due, income_stream_id=None if stream is None else stream.id, created_on=DAY,
    )
    db_session.add(goal)
    db_session.flush()
    return category, goal


def _row(client, goal, on):
    rows = client.get("/api/goals", params={"as_of": on.isoformat()}).json()
    return next(r for r in rows if r["goal"]["id"] == goal.id)


def _pay(client, chequing, category, goal, due_on, *, cents, day="2026-10-03"):
    response = client.post("/api/transactions", json={
        "date": day,
        "account_lines": [{"account_id": chequing.id, "cents": -cents}],
        "category_lines": [{"category_id": category.id, "cents": -cents}],
        "goal_id": goal.id, "goal_due_on": due_on,
    })
    assert response.status_code == 201, response.text


@pytest.mark.parametrize(
    "first_due, as_of, status, text",
    [
        (datetime.date(2026, 9, 1), datetime.date(2026, 9, 2), "overdue", "overdue since Sep 1"),
        (datetime.date(2026, 9, 1), datetime.date(2026, 9, 1), "due", "due Sep 1 · not paid"),
        (datetime.date(2026, 9, 2), datetime.date(2026, 9, 1), "next_due", "next due Sep 2"),
    ],
)
def test_status_without_a_bound_pay_compares_to_the_picker_date(db_session, client, first_due, as_of, status, text):
    _, goal = _bill(db_session, first_due)
    row = _row(client, goal, as_of)
    assert (row["bill_status"], row["bill_status_text"]) == (status, text)


@pytest.mark.parametrize(
    "first_due, status",
    [
        (datetime.date(2026, 8, 30), "overdue"),
        (datetime.date(2026, 9, 1), "due"),       # the picker date itself, before the next payday
        (datetime.date(2026, 9, 4), "due"),       # on the next payday
        (datetime.date(2026, 9, 5), "next_due"),  # the day after it
    ],
)
def test_status_with_a_bound_pay_compares_to_its_next_payday(db_session, client, salary, first_due, status):
    _, goal = _bill(db_session, first_due, stream=salary)
    assert _row(client, goal, DAY)["bill_status"] == status


def test_an_overdue_bill_keeps_its_due_date_on_both_surfaces(db_session, client, salary):
    _, goal = _bill(db_session, datetime.date(2026, 8, 1), stream=salary)
    row = _row(client, goal, DAY)
    assert row["due_date"] == row["earliest_unpaid_due_on"] == "2026-08-01"
    assert row["bill_status_text"] == "overdue since Aug 1"
    assert row["due_by_next_payday_cents"] == 120_000  # overdue: the whole shortfall, no instalments


def test_bills_sort_by_the_due_date_the_pay_screen_reads(db_session, client, salary):
    _bill(db_session, datetime.date(2026, 9, 20), stream=salary, name="Insurance")
    _bill(db_session, datetime.date(2026, 8, 15), stream=salary, name="Rent")
    _bill(db_session, datetime.date(2026, 9, 3), stream=salary, name="Phone")
    rows = client.get("/api/goals", params={"as_of": DAY.isoformat()}).json()
    ordered = sorted(rows, key=lambda r: r["due_date"])
    assert [r["goal"]["name"] for r in ordered] == ["Rent", "Phone", "Insurance"]
    assert [r["bill_status"] for r in ordered] == ["overdue", "due", "next_due"]


def test_a_half_payment_shows_paid_against_expected_and_the_bill_moves_on(db_session, client, chequing):
    category, goal = _bill(db_session, datetime.date(2026, 10, 1))
    _pay(client, chequing, category, goal, "2026-10-01", cents=60_000)
    row = _row(client, goal, datetime.date(2026, 10, 3))
    assert row["last_paid_due_on"] == "2026-10-01"
    assert row["last_paid_cents"] == 60_000
    assert row["last_paid_text"] == "Oct 1 paid · $600.00 of $1,200.00"  # a genuine half-payment stays visible
    assert row["due_date"] == "2026-11-01"  # one linked payment marks the date paid
    assert row["bill_status_text"] == "next due Nov 1"


def test_several_payments_against_one_due_date_add_up(db_session, client, chequing):
    category, goal = _bill(db_session, datetime.date(2026, 10, 1))
    _pay(client, chequing, category, goal, "2026-10-01", cents=70_000)
    _pay(client, chequing, category, goal, "2026-10-01", cents=42_040, day="2026-10-05")
    assert _row(client, goal, datetime.date(2026, 10, 6))["last_paid_text"] == "Oct 1 paid · $1,120.40 of $1,200.00"


def test_the_last_paid_date_is_the_latest_one_paid(db_session, client, chequing):
    category, goal = _bill(db_session, datetime.date(2026, 9, 1))
    _pay(client, chequing, category, goal, "2026-09-01", cents=120_000, day="2026-09-02")
    _pay(client, chequing, category, goal, "2026-10-01", cents=110_000)
    row = _row(client, goal, datetime.date(2026, 10, 4))
    assert row["last_paid_text"] == "Oct 1 paid · $1,100.00 of $1,200.00"


def test_a_bill_never_paid_has_no_paid_line_and_a_target_has_no_status(db_session, client):
    _, goal = _bill(db_session, datetime.date(2026, 10, 1))
    row = _row(client, goal, DAY)
    assert (row["last_paid_due_on"], row["last_paid_cents"], row["last_paid_text"]) == (None, None, None)
    category = Category(name="Trip", created_on=DAY)
    db_session.add(category)
    db_session.flush()
    target = Goal(category_id=category.id, name="Trip", kind="target", amount_cents=1000, created_on=DAY)
    db_session.add(target)
    db_session.flush()
    row = _row(client, target, DAY)
    assert (row["bill_status"], row["bill_status_text"], row["last_paid_text"]) == (None, None, None)


def test_a_split_payment_counts_only_the_bills_own_category(db_session, client, chequing):
    category, goal = _bill(db_session, datetime.date(2026, 10, 1))
    other = Category(name="Groceries", created_on=DAY)
    db_session.add(other)
    db_session.flush()
    response = client.post("/api/transactions", json={
        "date": "2026-10-01",
        "account_lines": [{"account_id": chequing.id, "cents": -150_000}],
        "category_lines": [
            {"category_id": category.id, "cents": -120_000}, {"category_id": other.id, "cents": -30_000},
        ],
        "goal_id": goal.id, "goal_due_on": "2026-10-01",
    })
    assert response.status_code == 201, response.text
    assert _row(client, goal, datetime.date(2026, 10, 2))["last_paid_cents"] == 120_000
