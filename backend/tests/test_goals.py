"""#20: one goal per category — bill, target or commitment — and its progress against the
category's balance (DESIGN.md § Goals).
"""
import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.db import get_session
from app.main import app
from app.models import Category, Goal, IncomeStream
from app.services.earmarks import move_money
from app.services.accounts import create_account_with_opening_valuation
from app.services.goals import commitment_context, due_by_next_payday
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
def category(db_session):
    category = Category(name="Car insurance", created_on=DAY)
    db_session.add(category)
    db_session.flush()
    return category


@pytest.fixture()
def stream(db_session):
    from app.services.accounts import create_account_with_opening_valuation

    income_category = Category(name="Salary income", created_on=DAY)
    db_session.add(income_category)
    db_session.flush()
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    stream = IncomeStream(
        name="Salary", cadence="weeks", cadence_weeks=2, anchor_payday=datetime.date(2026, 3, 6),
        expected_net_low_cents=0, expected_net_high_cents=0, income_category_id=income_category.id,
        destination_account_id=account.id, created_on=DAY,
    )
    db_session.add(stream)
    db_session.flush()
    return stream


def _fund(db_session, category, cents, on=DAY):
    move_money(db_session, move_date=on, from_category_id=None, to_category_id=category.id, cents=cents)


def _set(client, category, **fields):
    body = {"on": DAY.isoformat(), "name": "My part", **fields}
    return client.put(f"/api/categories/{category.id}/goal", json=body)


def _progress(client, on=DAY):
    return client.get("/api/goals", params={"as_of": on.isoformat()}).json()


def test_recurring_bill_progress_and_owed_this_cycle(client, db_session, category):
    _fund(db_session, category, 13282)
    response = _set(client, category, kind="recurring_bill", amount_cents=104800, cadence="yearly",
                    target_date="2026-06-15")
    assert response.status_code == 200
    (row,) = _progress(client)
    assert (row["balance_cents"], row["target_cents"], row["owed_cents"]) == (13282, 104800, 91518)
    assert row["due_date"] == "2026-06-15"
    assert row["per_period_cents"] is None


def test_recurring_bill_due_date_does_not_roll_past_the_picker(client, category):
    _set(client, category, kind="recurring_bill", amount_cents=10000, cadence="monthly", target_date="2026-01-31")
    (row,) = _progress(client)
    assert row["due_date"] == "2026-01-31"  # unpaid, so it stays the due date; the picker moving on doesn't skip it
    (row,) = _progress(client, datetime.date(2026, 4, 1))
    assert row["due_date"] == "2026-01-31"


def test_recurring_bill_every_n_weeks(client, category):
    _set(client, category, kind="recurring_bill", amount_cents=5000, cadence="weeks", cadence_weeks=2,
         target_date="2026-02-20")
    (row,) = _progress(client)
    assert row["due_date"] == "2026-02-20"  # earliest unpaid, not rolled to the picker


def test_target_amount_only(client, db_session, category):
    _fund(db_session, category, 2500)
    _set(client, category, kind="target", amount_cents=10000)
    (row,) = _progress(client)
    assert (row["target_cents"], row["owed_cents"], row["due_date"], row["per_period_cents"]) == (
        10000, 7500, None, None)


def test_target_with_date_but_no_cadence_has_no_contribution(client, category):
    _set(client, category, kind="target", amount_cents=10000, target_date="2026-06-01")
    (row,) = _progress(client)
    assert (row["due_date"], row["per_period_cents"]) == ("2026-06-01", None)


@pytest.mark.parametrize("cadence, weeks, text", [
    ("monthly", None, "$87.00 monthly"),
    ("quarterly", None, "$87.00 quarterly"),
    ("semiannual", None, "$87.00 every 6 months"),
    ("yearly", None, "$87.00 yearly"),
    ("weeks", 2, "$87.00 every 2 weeks"),
    ("weeks", 1, "$87.00 every week"),
])
def test_recurring_bill_per_period_text(client, category, cadence, weeks, text):
    _set(client, category, kind="recurring_bill", amount_cents=8700, cadence=cadence, cadence_weeks=weeks,
         target_date="2026-06-15")
    (row,) = _progress(client)
    assert row["per_period_text"] == text


def test_target_with_a_cadence_has_per_period_text(client, db_session, category):
    _fund(db_session, category, 1000)
    _set(client, category, kind="target", amount_cents=10000, cadence="monthly", target_date="2026-06-01")
    (row,) = _progress(client)
    assert row["per_period_text"] == "$30.00 monthly"


def test_per_period_text_is_null_for_a_target_without_a_cadence_and_for_commitments(client, category):
    _set(client, category, kind="target", amount_cents=10000, target_date="2026-06-01")
    (row,) = _progress(client)
    assert row["per_period_text"] is None
    _set(client, category, kind="commitment", amount_cents=20000, cadence="monthly", first_due_on="2026-06-30")
    (row,) = _progress(client)
    assert row["per_period_text"] is None


def test_target_contribution_over_whole_periods(client, db_session, category):
    _fund(db_session, category, 1000)
    _set(client, category, kind="target", amount_cents=10000, cadence="monthly", target_date="2026-06-01")
    (row,) = _progress(client)
    assert row["per_period_cents"] == 3000  # $90.00 short over three whole months (Apr 1, May 1, Jun 1)


def test_target_contribution_rounds_up(client, db_session, category):
    _fund(db_session, category, 1000)
    _set(client, category, kind="target", amount_cents=10001, cadence="monthly", target_date="2026-06-01")
    (row,) = _progress(client)
    assert row["per_period_cents"] == 3001  # 9001 / 3 = 3000.33 -> up


def test_target_contribution_zero_when_reached_and_whole_shortfall_when_past(client, db_session, category):
    _fund(db_session, category, 10000)
    _set(client, category, kind="target", amount_cents=10000, cadence="monthly", target_date="2026-06-01")
    assert _progress(client)[0]["per_period_cents"] == 0
    _set(client, category, kind="target", amount_cents=12000, cadence="monthly", target_date="2026-03-15")
    assert _progress(client)[0]["per_period_cents"] == 2000  # no whole period left: all of it


def test_commitment_add_has_no_target(client, db_session, category):
    _fund(db_session, category, 3000)
    _set(client, category, kind="commitment", amount_cents=5000)
    (row,) = _progress(client)
    assert (row["balance_cents"], row["target_cents"], row["owed_cents"], row["per_period_cents"]) == (
        3000, None, None, 5000)


def test_commitment_refill_to_level(client, db_session, category):
    _fund(db_session, category, 45000)
    _set(client, category, kind="commitment", level_cents=60000)
    (row,) = _progress(client)
    assert (row["target_cents"], row["owed_cents"], row["per_period_cents"]) == (60000, 15000, None)


def test_progress_reads_the_picker_date(client, db_session, category):
    _fund(db_session, category, 4000, on=datetime.date(2026, 4, 1))
    _set(client, category, kind="target", amount_cents=10000)
    assert _progress(client)[0]["balance_cents"] == 0
    assert _progress(client, datetime.date(2026, 4, 1))[0]["balance_cents"] == 4000


@pytest.mark.parametrize("fields, message", [
    ({"kind": "wish", "amount_cents": 1}, "Unknown goal kind"),
    ({"kind": "recurring_bill", "amount_cents": 100, "target_date": "2026-06-15"}, "amount and a cadence"),
    ({"kind": "recurring_bill", "cadence": "monthly", "target_date": "2026-06-15"}, "amount and a cadence"),
    ({"kind": "target"}, "needs an amount"),
    ({"kind": "target", "amount_cents": 100, "cadence": "monthly"}, "needs a target date"),
    ({"kind": "target", "amount_cents": 100, "level_cents": 5}, "no level"),
    ({"kind": "target", "amount_cents": -1}, "negative"),
    ({"kind": "commitment", "cadence": "monthly", "first_due_on": "2026-10-31"}, "give exactly one"),
    ({"kind": "commitment", "amount_cents": 1, "level_cents": 2}, "give exactly one"),
    ({"kind": "commitment", "amount_cents": 1, "cadence": "monthly", "first_due_on": "2026-10-31", "target_date": "2026-05-01"}, "no target date"),
    ({"kind": "commitment", "amount_cents": 1, "cadence": "weeks", "cadence_weeks": 2}, "no every-N-weeks"),
    ({"kind": "commitment", "amount_cents": 1, "cadence": "weeks"}, "no every-N-weeks"),
    ({"kind": "commitment", "amount_cents": 1, "cadence_weeks": 2}, "no every-N-weeks"),
    ({"kind": "commitment", "amount_cents": 1, "cadence": "monthly"}, "needs its first due month"),
    ({"kind": "commitment", "amount_cents": 1, "first_due_on": "2026-10-31"}, "no cadence has no first due month"),
    ({"kind": "commitment", "amount_cents": 1, "cadence": "monthly", "first_due_on": "2026-10-15"}, "last day"),
    ({"kind": "commitment", "level_cents": 5, "cadence": "monthly", "first_due_on": "2026-10-31"}, "Only a fixed-amount"),
    ({"kind": "commitment", "level_cents": 5, "first_due_on": "2026-10-31"}, "no cadence has no first due month"),
    ({"kind": "commitment", "percent_of_net": "5", "cadence": "monthly", "first_due_on": "2026-10-31"}, "Only a fixed-amount"),
    ({"kind": "target", "amount_cents": 100, "first_due_on": "2026-10-31"}, "Only a commitment"),
    ({"kind": "recurring_bill", "amount_cents": 1, "cadence": "monthly", "target_date": "2026-06-15", "first_due_on": "2026-10-31"}, "Only a commitment"),
    ({"kind": "recurring_bill", "amount_cents": 1, "cadence": "weeks", "target_date": "2026-06-15"}, "needs N"),
    ({"kind": "recurring_bill", "amount_cents": 1, "cadence": "monthly", "cadence_weeks": 2, "target_date": "2026-06-15"}, "only applies"),
    ({"kind": "recurring_bill", "amount_cents": 1, "cadence": "daily", "target_date": "2026-06-15"}, "Unknown cadence"),
    ({"kind": "target", "amount_cents": 100, "percent_of_net": "5"}, "no percentage"),
    ({"kind": "recurring_bill", "amount_cents": 1, "cadence": "monthly", "percent_of_net": "5", "target_date": "2026-06-15"}, "no percentage"),
    ({"kind": "commitment", "percent_of_net": "5"}, "needs a bound pay"),
    ({"kind": "target", "amount_cents": 100, "income_stream_id": 999}, "Unknown income stream id"),
])
def test_invalid_goals_are_refused_and_nothing_is_written(client, category, fields, message):
    response = _set(client, category, **fields)
    assert response.status_code == 400
    assert message in response.json()["detail"]
    assert _progress(client) == []


@pytest.mark.parametrize("target_date", [None, "missing"])
def test_recurring_bill_without_a_first_due_date_is_a_422(client, category, target_date):
    fields = {"kind": "recurring_bill", "amount_cents": 10000, "cadence": "monthly"}
    if target_date is None:
        fields["target_date"] = None  # stated as null
    response = _set(client, category, **fields)  # or left out entirely
    assert response.status_code == 422
    assert "first due date" in response.text
    assert _progress(client) == []


def test_editing_a_bills_first_due_date_restarts_its_cycles(client, category):
    _set(client, category, kind="recurring_bill", amount_cents=10000, cadence="monthly", target_date="2026-01-15")
    assert _progress(client)[0]["due_date"] == "2026-01-15"
    _set(client, category, kind="recurring_bill", amount_cents=10000, cadence="monthly", target_date="2026-05-10")
    assert _progress(client)[0]["due_date"] == "2026-05-10"  # no cycle exists before the new first date


def test_zero_is_a_stated_amount(client, category):
    assert _set(client, category, kind="target", amount_cents=0).status_code == 200
    assert _progress(client)[0]["target_cents"] == 0


def test_one_goal_per_category_put_replaces_it(client, category):
    first = _set(client, category, kind="target", amount_cents=10000).json()
    second = _set(client, category, name="Renamed", kind="commitment", level_cents=500).json()
    assert second["id"] == first["id"]
    (row,) = _progress(client)
    assert (row["goal"]["name"], row["goal"]["kind"], row["goal"]["amount_cents"]) == ("Renamed", "commitment", None)


def test_unknown_category_is_404(client):
    body = {"on": DAY.isoformat(), "name": "x", "kind": "target", "amount_cents": 1}
    assert client.put("/api/categories/999/goal", json=body).status_code == 404


def test_archive_frees_the_category_for_a_new_goal(client, category):
    _set(client, category, kind="target", amount_cents=10000)
    archived = client.post(f"/api/categories/{category.id}/goal/archive", json={"archived_on": "2026-03-05"})
    assert archived.status_code == 200
    assert _progress(client, datetime.date(2026, 3, 10)) == []
    assert len(_progress(client, datetime.date(2026, 3, 2))) == 1  # still there on earlier dates
    _set(client, category, name="Second", kind="target", amount_cents=200)
    assert [r["goal"]["name"] for r in _progress(client, datetime.date(2026, 3, 10))] == ["Second"]


def test_include_archived_returns_an_archived_goal(client, category):
    # #142: the Ledger needs to label a transaction's bill "<name> (archived)" instead of
    # `bill #id`, so `/api/goals` needs an archived-included lookup like the other list routes.
    _set(client, category, kind="target", amount_cents=10000)
    archived = client.post(f"/api/categories/{category.id}/goal/archive", json={"archived_on": "2026-03-05"})
    assert archived.status_code == 200

    on = datetime.date(2026, 3, 10)
    assert _progress(client, on) == []  # the plain (live) lookup excludes it, as before

    response = client.get("/api/goals", params={"as_of": on.isoformat(), "include_archived": "true"})
    assert response.status_code == 200
    (row,) = response.json()
    assert row["goal"]["name"] == "My part"
    assert row["goal"]["archived_on"] == "2026-03-05"


def test_goal_binds_to_a_named_pay(client, category, stream):
    response = _set(client, category, kind="target", amount_cents=10000, income_stream_id=stream.id)
    assert response.status_code == 200
    assert response.json()["income_stream_id"] == stream.id
    (row,) = _progress(client)
    assert row["goal"]["income_stream_id"] == stream.id


def test_commitment_percent_of_net_bound_to_a_pay(client, category, stream):
    response = _set(
        client, category, kind="commitment",
        percent_of_net="5.5", income_stream_id=stream.id,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["percent_of_net"] == "5.5000"
    assert body["amount_cents"] is None
    (row,) = _progress(client)
    assert row["goal"]["percent_of_net"] == "5.5000"


def test_commitment_percent_and_fixed_amount_are_mutually_exclusive(client, category, stream):
    response = _set(
        client, category, kind="commitment",
        amount_cents=5000, percent_of_net="5", income_stream_id=stream.id,
    )
    assert response.status_code == 400
    assert "give exactly one" in response.json()["detail"]
    assert _progress(client) == []


def test_editing_a_goal_can_clear_its_binding(client, category, stream):
    _set(client, category, kind="target", amount_cents=10000, income_stream_id=stream.id)
    response = _set(client, category, kind="target", amount_cents=10000)
    assert response.status_code == 200
    assert response.json()["income_stream_id"] is None


def test_due_by_next_payday_worked_example(db_session, category, stream):
    # $1,200 quarterly bill, $400 saved, two Salary paydays (every 2 weeks) left before the
    # due date wants $400 now (DESIGN.md § Goals).
    _fund(db_session, category, 40000)
    goal = Goal(
        category_id=category.id, name="Insurance", kind="recurring_bill", amount_cents=120000,
        cadence="quarterly", target_date=datetime.date(2026, 3, 20), income_stream_id=stream.id,
        created_on=DAY,
    )
    db_session.add(goal)
    db_session.flush()
    assert due_by_next_payday(db_session, goal, stream, as_of=DAY) == 40000


def test_due_by_next_payday_none_without_a_due_date(db_session, category, stream):
    goal = Goal(
        category_id=category.id, name="Someday", kind="target", amount_cents=10000,
        income_stream_id=stream.id, created_on=DAY,
    )
    db_session.add(goal)
    db_session.flush()
    assert due_by_next_payday(db_session, goal, stream, as_of=DAY) is None


def test_due_by_next_payday_none_for_a_commitment(db_session, category, stream):
    goal = Goal(
        category_id=category.id, name="Fun money", kind="commitment", amount_cents=5000,
        income_stream_id=stream.id, created_on=DAY,
    )
    db_session.add(goal)
    db_session.flush()
    assert due_by_next_payday(db_session, goal, stream, as_of=DAY) is None


def test_due_by_next_payday_cents_on_the_goals_api(client, db_session, category, stream):
    # Same worked example as test_due_by_next_payday_worked_example, but through /api/goals
    # (#107: the pay screen's blocks 6 and 8 pre-fill from this field).
    _fund(db_session, category, 40000)
    response = _set(
        client, category, kind="recurring_bill", amount_cents=120000, cadence="quarterly",
        target_date="2026-03-20", income_stream_id=stream.id,
    )
    assert response.status_code == 200
    (row,) = _progress(client)
    assert row["due_by_next_payday_cents"] == 40000


def test_due_by_next_payday_cents_null_without_a_bound_pay(client, category):
    _set(client, category, kind="target", amount_cents=10000)
    (row,) = _progress(client)
    assert row["due_by_next_payday_cents"] is None


def test_database_refuses_a_second_live_goal_on_a_category(db_session, category):
    for name in ("a", "b"):
        db_session.add(Goal(category_id=category.id, name=name, kind="target", amount_cents=1, created_on=DAY))
    with pytest.raises(IntegrityError):
        db_session.flush()


@pytest.mark.parametrize("cadence", ["monthly", "quarterly", "semiannual", "yearly"])
def test_fixed_commitment_cadence_round_trips_with_its_first_due_month(client, category, cadence):
    response = _set(client, category, kind="commitment", amount_cents=20000, cadence=cadence, first_due_on="2026-10-31")
    assert response.status_code == 200
    body = response.json()
    assert (body["cadence"], body["cadence_weeks"], body["first_due_on"]) == (cadence, None, "2026-10-31")
    (row,) = _progress(client)
    assert (row["goal"]["cadence"], row["goal"]["first_due_on"]) == (cadence, "2026-10-31")
    assert row["due_date"] is None  # #156 stores the month; nothing here reads it as a due date yet


def test_each_payday_commitment_is_an_empty_cadence(client, category):
    body = _set(client, category, kind="commitment", amount_cents=5000).json()
    assert (body["cadence"], body["cadence_weeks"], body["first_due_on"]) == (None, None, None)


def test_editing_a_commitment_back_to_each_payday_clears_its_first_due_month(client, category):
    _set(client, category, kind="commitment", amount_cents=20000, cadence="monthly", first_due_on="2026-10-31")
    body = _set(client, category, kind="commitment", amount_cents=20000).json()
    assert (body["cadence"], body["first_due_on"]) == (None, None)


def test_a_commitment_first_due_month_may_be_a_leap_february_end(client, category):
    assert _set(client, category, kind="commitment", amount_cents=1, cadence="yearly", first_due_on="2028-02-29").status_code == 200


def test_bills_keep_every_n_weeks(client, category):
    response = _set(client, category, kind="recurring_bill", amount_cents=5000, cadence="weeks", cadence_weeks=2,
                    target_date="2026-02-20")
    assert response.status_code == 200
    assert (response.json()["cadence"], response.json()["cadence_weeks"], response.json()["first_due_on"]) == ("weeks", 2, None)


# --- #157: a fixed Commitment with a cadence spreads over the paydays left --------------------
# The stream pays every 2 weeks from Mar 6, so at DAY (Mar 1) the payday is Mar 6 and Mar 20 is the
# only other one before a Mar 31 due date.

def _commitment(db_session, category, stream, *, cadence="monthly", first_due_on=datetime.date(2026, 3, 31), amount=20000):
    goal = Goal(
        category_id=category.id, name="Vacation", kind="commitment", amount_cents=amount, cadence=cadence,
        first_due_on=first_due_on, income_stream_id=stream.id, created_on=DAY,
    )
    db_session.add(goal)
    db_session.flush()
    return goal


def _ask(db_session, goal, stream, as_of=DAY):
    return due_by_next_payday(db_session, goal, stream, as_of=as_of)


def test_commitment_spreads_the_amount_over_the_paydays_left(db_session, category, stream):
    goal = _commitment(db_session, category, stream)
    assert _ask(db_session, goal, stream) == 10000  # $200 over Mar 6 and Mar 20


def test_commitment_first_period_starts_the_day_after_the_previous_month_end(db_session, category, stream):
    goal = _commitment(db_session, category, stream)
    _fund(db_session, category, 20000, on=datetime.date(2026, 2, 28))  # all of February: not this period
    assert _ask(db_session, goal, stream) == 10000
    _fund(db_session, category, 5000, on=datetime.date(2026, 3, 1))  # first day of the period
    assert _ask(db_session, goal, stream) == 7500


def test_commitment_first_period_for_quarterly(db_session, category, stream):
    goal = _commitment(db_session, category, stream, cadence="quarterly")
    _fund(db_session, category, 4000, on=datetime.date(2025, 12, 31))  # before the period: ignored
    _fund(db_session, category, 4000, on=datetime.date(2026, 1, 1))
    assert _ask(db_session, goal, stream) == 8000  # $160 missing over 2 paydays


def test_commitment_first_period_for_yearly(db_session, category, stream):
    goal = _commitment(db_session, category, stream, cadence="yearly")
    _fund(db_session, category, 4000, on=datetime.date(2025, 3, 31))  # before the period: ignored
    _fund(db_session, category, 6000, on=datetime.date(2025, 4, 1))
    assert _ask(db_session, goal, stream) == 7000  # $140 missing over 2 paydays


def test_commitment_period_begins_the_day_after_the_previous_due_date(db_session, category, stream):
    # First due Jan 31 monthly: the third due date is Mar 31, so the period began Mar 1.
    goal = _commitment(db_session, category, stream, first_due_on=datetime.date(2026, 1, 31))
    _fund(db_session, category, 8000, on=datetime.date(2026, 2, 28))  # the previous period
    assert _ask(db_session, goal, stream) == 10000
    _fund(db_session, category, 4000, on=datetime.date(2026, 3, 2))
    assert _ask(db_session, goal, stream) == 8000


def test_commitment_due_date_in_february_is_the_month_end(db_session, category, stream):
    # 2027: paydays Feb 5 and Feb 19 fall before the Feb 28 due date (a month end, not "Jan 31 + 1 month").
    goal = _commitment(db_session, category, stream, first_due_on=datetime.date(2027, 1, 31))
    _fund(db_session, category, 4000, on=datetime.date(2027, 1, 31))  # the previous period
    _fund(db_session, category, 4000, on=datetime.date(2027, 2, 1))
    feb = datetime.date(2027, 2, 1)
    assert _ask(db_session, goal, stream, as_of=feb) == 8000  # $160 missing over 2 paydays
    assert commitment_context(db_session, goal, stream, as_of=feb) == "$40.00 of $200.00 due Feb 28"


def test_commitment_november_thirtieth_first_due_steps_to_december_thirty_first(db_session, category, stream):
    goal = _commitment(db_session, category, stream, first_due_on=datetime.date(2026, 11, 30))
    text = commitment_context(db_session, goal, stream, as_of=datetime.date(2026, 12, 1))
    assert text == "$0.00 of $200.00 due Dec 31"


def test_commitment_spending_never_raises_the_ask(db_session, category, stream):
    account = create_account_with_opening_valuation(
        db_session, name="Cash", created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=100000,
    )
    goal = _commitment(db_session, category, stream)
    _fund(db_session, category, 10000, on=datetime.date(2026, 3, 2))
    write_transaction(
        db_session, transaction=None, txn_date=datetime.date(2026, 3, 3), memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -9000}],
        category_lines=[{"category_id": category.id, "cents": -9000}],
    )
    assert _ask(db_session, goal, stream) == 5000  # $100 still missing over 2 paydays; the spend is ignored


def test_commitment_never_asks_for_more_than_the_amount(db_session, category, stream):
    goal = _commitment(db_session, category, stream)
    _fund(db_session, category, 3000, on=datetime.date(2026, 3, 2))
    move_money(db_session, move_date=datetime.date(2026, 3, 3), from_category_id=category.id, to_category_id=None, cents=9000)
    # Net assigned is -$60, so "missing" would be $260; it is capped at the $200 amount.
    assert _ask(db_session, goal, stream) == 10000


def test_commitment_asks_for_nothing_once_fully_assigned(db_session, category, stream):
    goal = _commitment(db_session, category, stream)
    _fund(db_session, category, 25000, on=datetime.date(2026, 3, 2))
    assert _ask(db_session, goal, stream) == 0


def test_commitment_asks_the_whole_missing_amount_on_the_last_payday_before_due(db_session, category, stream):
    goal = _commitment(db_session, category, stream)
    _fund(db_session, category, 5000, on=datetime.date(2026, 3, 2))
    # The Mar 20 payday is the last one on or before Mar 31.
    assert _ask(db_session, goal, stream, as_of=datetime.date(2026, 3, 7)) == 15000


def test_commitment_each_payday_stays_the_full_amount(client, category, stream):
    response = _set(client, category, kind="commitment", amount_cents=5000, income_stream_id=stream.id)
    assert response.status_code == 200
    (row,) = _progress(client)
    assert row["due_by_next_payday_cents"] is None  # the pay screen pre-fills the full amount
    assert row["commitment_context_text"] == "each payday"


def test_commitment_context_text_on_the_goals_api(client, db_session, category, stream):
    _set(client, category, kind="commitment", amount_cents=20000, cadence="monthly",
         first_due_on="2026-03-31", income_stream_id=stream.id)
    _fund(db_session, category, 10000, on=datetime.date(2026, 3, 2))
    (row,) = _progress(client)
    assert row["due_by_next_payday_cents"] == 5000
    assert row["commitment_context_text"] == "$100.00 of $200.00 due Mar 31"


def test_context_text_is_null_for_a_refill_commitment(client, category, stream):
    _set(client, category, kind="commitment", level_cents=60000, income_stream_id=stream.id)
    (row,) = _progress(client)
    assert row["commitment_context_text"] is None


# --- #158: a fixed Commitment's goal row wording -----------------------------------------------

def _row(db_session, goal, as_of=DAY):
    from app.services.goals import commitment_row_text
    return commitment_row_text(db_session, goal, as_of=as_of)


@pytest.mark.parametrize("cadence, first_due, label, period", [
    ("monthly", datetime.date(2026, 3, 31), "monthly", "this month"),
    ("quarterly", datetime.date(2026, 3, 31), "quarterly", "this quarter"),
    ("semiannual", datetime.date(2026, 3, 31), "every 6 months", "this 6-month period"),
    ("yearly", datetime.date(2026, 3, 31), "yearly", "this year"),
])
def test_commitment_row_wording_for_each_cadence(db_session, category, stream, cadence, first_due, label, period):
    goal = _commitment(db_session, category, stream, cadence=cadence, first_due_on=first_due)
    _fund(db_session, category, 14000, on=DAY)
    assert _row(db_session, goal) == {
        "commitment_cadence_text": f"$200.00 {label} · next due Mar 31",
        "commitment_progress_text": f"$140.00 of $200.00 {period}",
    }


def test_commitment_row_each_payday_has_no_period(db_session, category, stream):
    goal = _commitment(db_session, category, stream, cadence=None, first_due_on=None, amount=5000)
    assert _row(db_session, goal) == {
        "commitment_cadence_text": "$50.00 each payday", "commitment_progress_text": None,
    }


def test_commitment_row_needs_no_bound_pay(db_session, category):
    goal = Goal(
        category_id=category.id, name="Vacation", kind="commitment", amount_cents=20000, cadence="monthly",
        first_due_on=datetime.date(2026, 3, 31), created_on=DAY,
    )
    db_session.add(goal)
    db_session.flush()
    _fund(db_session, category, 5000, on=DAY)
    assert _row(db_session, goal)["commitment_progress_text"] == "$50.00 of $200.00 this month"


def test_commitment_row_steps_to_the_month_end(db_session, category, stream):
    goal = _commitment(db_session, category, stream, first_due_on=datetime.date(2026, 11, 30))
    text = _row(db_session, goal, as_of=datetime.date(2026, 12, 1))["commitment_cadence_text"]
    assert text == "$200.00 monthly · next due Dec 31"
    # The first period reaches back one step: Feb 28 is the period Jan 1 – Jan 31's successor.
    goal.first_due_on = datetime.date(2027, 1, 31)
    text = _row(db_session, goal, as_of=datetime.date(2027, 2, 1))["commitment_cadence_text"]
    assert text == "$200.00 monthly · next due Feb 28"


def test_commitment_row_progress_ignores_spending(db_session, category, stream):
    account = create_account_with_opening_valuation(
        db_session, name="Cash", created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=100000,
    )
    goal = _commitment(db_session, category, stream)
    _fund(db_session, category, 10000, on=datetime.date(2026, 3, 2))
    write_transaction(
        db_session, transaction=None, txn_date=datetime.date(2026, 3, 3), memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -9000}],
        category_lines=[{"category_id": category.id, "cents": -9000}],
    )
    assert _row(db_session, goal, as_of=datetime.date(2026, 3, 5))["commitment_progress_text"] == "$100.00 of $200.00 this month"


def test_commitment_row_progress_is_capped_at_the_amount_and_floored_at_zero(db_session, category, stream):
    goal = _commitment(db_session, category, stream)
    _fund(db_session, category, 25000, on=DAY)
    assert _row(db_session, goal)["commitment_progress_text"] == "$200.00 of $200.00 this month"
    move_money(db_session, move_date=datetime.date(2026, 3, 3), from_category_id=category.id, to_category_id=None, cents=40000)
    assert _row(db_session, goal, as_of=datetime.date(2026, 3, 4))["commitment_progress_text"] == "$0.00 of $200.00 this month"


def test_commitment_row_measures_from_the_period_start_at_the_picker_date(db_session, category, stream):
    goal = _commitment(db_session, category, stream)
    _fund(db_session, category, 8000, on=datetime.date(2026, 2, 28))  # the previous period
    _fund(db_session, category, 3000, on=datetime.date(2026, 3, 10))
    assert _row(db_session, goal, as_of=datetime.date(2026, 3, 5))["commitment_progress_text"] == "$0.00 of $200.00 this month"
    assert _row(db_session, goal, as_of=datetime.date(2026, 3, 10))["commitment_progress_text"] == "$30.00 of $200.00 this month"


def test_commitment_row_text_is_null_for_refill_and_percent_of_net(client, category, stream):
    _set(client, category, kind="commitment", level_cents=60000, income_stream_id=stream.id)
    (row,) = _progress(client)
    assert row["commitment_cadence_text"] is None and row["commitment_progress_text"] is None
    _set(client, category, kind="commitment", percent_of_net=5, income_stream_id=stream.id)
    (row,) = _progress(client)
    assert row["commitment_cadence_text"] is None and row["commitment_progress_text"] is None


def test_commitment_row_text_on_the_goals_api(client, db_session, category):
    _set(client, category, kind="commitment", amount_cents=20000, cadence="monthly", first_due_on="2026-03-31")
    _fund(db_session, category, 14000, on=DAY)
    (row,) = _progress(client)
    assert row["commitment_cadence_text"] == "$200.00 monthly · next due Mar 31"
    assert row["commitment_progress_text"] == "$140.00 of $200.00 this month"
    assert row["commitment_context_text"] is None  # no bound pay: the pay screen's line is unchanged


# #198: a Target with a date shows one pace — its named pay's or its own cadence, never both.
def test_target_with_a_pay_and_a_cadence_is_refused(client, category, stream):
    response = _set(client, category, kind="target", amount_cents=10000, cadence="monthly",
                    target_date="2026-06-01", income_stream_id=stream.id)
    assert response.status_code == 400
    assert "not both" in response.json()["detail"]


def test_bound_target_row_reads_per_payday_and_matches_what_pay_prefills(client, db_session, category, stream):
    _fund(db_session, category, 1000)
    _set(client, category, kind="target", amount_cents=10000, target_date="2026-06-01", income_stream_id=stream.id)
    (row,) = _progress(client)
    assert row["due_by_next_payday_cents"] is not None
    assert row["per_period_cents"] == row["due_by_next_payday_cents"]
    assert row["per_period_text"] == f"${row['due_by_next_payday_cents'] / 100:,.2f} per Salary payday"


def test_bound_target_with_no_date_shows_no_pace(client, category, stream):
    _set(client, category, kind="target", amount_cents=10000, income_stream_id=stream.id)
    (row,) = _progress(client)
    assert row["per_period_text"] is None and row["per_period_cents"] is None


def test_unbound_target_keeps_its_own_cadence_wording(client, db_session, category):
    _fund(db_session, category, 1000)
    _set(client, category, kind="target", amount_cents=10000, cadence="monthly", target_date="2026-06-01")
    (row,) = _progress(client)
    assert row["per_period_text"] == "$30.00 monthly"
