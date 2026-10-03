"""#206: the pay screen's period, recorded pay and last period's actual come from the backend
(DESIGN.md § Record income, § Re-opening a recorded pay), stepped from the payday given.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, IncomeStream
from app.services.accounts import create_account_with_opening_valuation
from app.services.income_streams import recorded_pay_transaction
from app.services.transactions import write_transaction

DAY = datetime.date(2026, 3, 1)


def d(text):
    return datetime.date.fromisoformat(text)


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
def world(db_session):
    income = Category(name="Salary income", created_on=DAY)
    groceries = Category(name="Groceries", created_on=DAY)
    rent = Category(name="Rent", created_on=DAY)
    db_session.add_all([income, groceries, rent])
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()
    return {"income": income, "groceries": groceries, "rent": rent, "account": account}


def _stream(db_session, world, *, cadence="monthly", weeks=None, anchor="2026-03-15", name="Salary"):
    stream = IncomeStream(
        name=name, cadence=cadence, cadence_weeks=weeks, anchor_payday=d(anchor),
        expected_net_low_cents=0, expected_net_high_cents=0,
        income_category_id=world["income"].id, destination_account_id=world["account"].id,
        created_on=DAY,
    )
    db_session.add(stream)
    db_session.flush()
    return stream


def _txn(db_session, world, on, category_lines, *, stream=None):
    net = sum(cents for _, cents in category_lines)
    txn = write_transaction(
        db_session, transaction=None, txn_date=d(on), memo=None, payee_id=None,
        income_stream_id=stream.id if stream else None,
        account_lines=[{"account_id": world["account"].id, "cents": net}],
        category_lines=[{"category_id": c.id, "cents": cents} for c, cents in category_lines],
    )
    db_session.flush()
    return txn


def _get(client, payday, stream=None):
    params = {"payday": payday}
    if stream is not None:
        params["income_stream_id"] = stream.id
    return client.get("/api/pay-period", params=params)


def test_monthly_period_runs_to_the_day_before_the_next_payday(client, db_session, world):
    stream = _stream(db_session, world)
    body = _get(client, "2026-09-25", stream).json()
    assert body["period_end"] == "2026-10-24"
    assert body["previous_payday"] == "2026-08-25"
    assert body["recorded"] is None
    assert body["last_period_actuals"] == []


def test_weekly_period(client, db_session, world):
    stream = _stream(db_session, world, cadence="weeks", weeks=2)
    body = _get(client, "2026-09-25", stream).json()
    assert body["period_end"] == "2026-10-08"
    assert body["previous_payday"] == "2026-09-11"


def test_month_end_payday_steps_from_the_payday_given(client, db_session, world):
    stream = _stream(db_session, world, anchor="2026-01-31")
    # Jan 31 → Feb 28 → Mar 28 would drift; stepping from the payday given keeps 30th/31st honest.
    body = _get(client, "2026-03-31", stream).json()
    assert body["previous_payday"] == "2026-02-28"
    assert body["period_end"] == "2026-04-29"
    leap = _get(client, "2028-03-31", stream).json()
    assert leap["previous_payday"] == "2028-02-29"


def test_year_end_period_end(client, db_session, world):
    stream = _stream(db_session, world)
    assert _get(client, "2026-12-01", stream).json()["period_end"] == "2026-12-31"


def test_recorded_transaction_found_in_the_list_shape(client, db_session, world):
    stream = _stream(db_session, world)
    txn = _txn(db_session, world, "2026-09-25", [(world["income"], 400000)], stream=stream)
    body = _get(client, "2026-09-25", stream).json()
    listed = next(t for t in client.get("/api/transactions").json() if t["id"] == txn.id)
    assert body["recorded"] == listed


def test_recorded_not_found_for_other_day_other_pay_or_unlinked(client, db_session, world):
    stream = _stream(db_session, world)
    other = _stream(db_session, world, name="Gig")
    _txn(db_session, world, "2026-09-25", [(world["income"], 400000)], stream=other)
    _txn(db_session, world, "2026-09-25", [(world["income"], 400000)])
    _txn(db_session, world, "2026-09-26", [(world["income"], 400000)], stream=stream)
    assert _get(client, "2026-09-25", stream).json()["recorded"] is None
    assert recorded_pay_transaction(db_session, stream.id, d("2026-09-25")) is None
    assert recorded_pay_transaction(db_session, stream.id, d("2026-09-26")) is not None


def test_window_edges(client, db_session, world):
    stream = _stream(db_session, world)
    g = world["groceries"]
    _txn(db_session, world, "2026-08-24", [(g, -1000)])  # day before the window
    _txn(db_session, world, "2026-08-25", [(g, -2000)])  # previous payday: in
    _txn(db_session, world, "2026-09-24", [(g, -4000)])  # last day: in
    _txn(db_session, world, "2026-09-25", [(g, -8000)])  # the payday itself: out
    body = _get(client, "2026-09-25", stream).json()
    assert body["last_period_actuals"] == [{"category_id": g.id, "cents": 6000}]


def test_actuals_sum_per_category_and_ignore_refunds(client, db_session, world):
    stream = _stream(db_session, world)
    g, r = world["groceries"], world["rent"]
    _txn(db_session, world, "2026-09-01", [(g, -3000), (r, -5000)])
    _txn(db_session, world, "2026-09-02", [(g, -1500)])
    _txn(db_session, world, "2026-09-03", [(g, 2000)])  # a refund is not netted off
    body = _get(client, "2026-09-25", stream).json()
    assert body["last_period_actuals"] == sorted(
        [{"category_id": g.id, "cents": 4500}, {"category_id": r.id, "cents": 5000}],
        key=lambda row: row["category_id"],
    )


def test_one_off_uses_the_calendar_month_before_and_has_no_period_or_recorded(client, db_session, world):
    g = world["groceries"]
    _txn(db_session, world, "2026-08-31", [(g, -1000)])
    _txn(db_session, world, "2026-08-01", [(g, -2000)])
    _txn(db_session, world, "2026-07-31", [(g, -4000)])  # before the month
    _txn(db_session, world, "2026-09-01", [(g, -8000)])  # the payday's own month
    body = _get(client, "2026-09-15").json()
    assert body["period_end"] is None
    assert body["recorded"] is None
    assert body["previous_payday"] == "2026-08-01"
    assert body["last_period_actuals"] == [{"category_id": g.id, "cents": 3000}]


def test_one_off_in_january_looks_at_december(client, db_session, world):
    g = world["groceries"]
    _txn(db_session, world, "2025-12-20", [(g, -1000)])
    body = _get(client, "2026-01-10").json()
    assert body["previous_payday"] == "2025-12-01"
    assert body["last_period_actuals"] == [{"category_id": g.id, "cents": 1000}]


def test_unknown_named_pay_is_a_404(client):
    response = client.get("/api/pay-period", params={"payday": "2026-09-25", "income_stream_id": 999})
    assert response.status_code == 404
    assert "999" in response.json()["detail"]
