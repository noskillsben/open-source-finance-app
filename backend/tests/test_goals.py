"""#20: one goal per category — bill, target or commitment — and its progress against the
category's balance (DESIGN.md § Goals).
"""
import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.db import get_session
from app.main import app
from app.models import Category, Goal
from app.services.earmarks import move_money

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


def test_recurring_bill_due_date_rolls_forward(client, category):
    _set(client, category, kind="recurring_bill", amount_cents=10000, cadence="monthly", target_date="2026-01-31")
    (row,) = _progress(client)
    assert row["due_date"] == "2026-03-31"  # Jan 31 -> Feb 28 (clamped) -> Mar 31, first on/after Mar 1
    (row,) = _progress(client, datetime.date(2026, 4, 1))
    assert row["due_date"] == "2026-04-30"


def test_recurring_bill_every_n_weeks(client, category):
    _set(client, category, kind="recurring_bill", amount_cents=5000, cadence="weeks", cadence_weeks=2,
         target_date="2026-02-20")
    (row,) = _progress(client)
    assert row["due_date"] == "2026-03-06"  # Feb 20, Mar 6


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
    _set(client, category, kind="commitment", amount_cents=5000, cadence="weeks", cadence_weeks=2)
    (row,) = _progress(client)
    assert (row["balance_cents"], row["target_cents"], row["owed_cents"], row["per_period_cents"]) == (
        3000, None, None, 5000)


def test_commitment_refill_to_level(client, db_session, category):
    _fund(db_session, category, 45000)
    _set(client, category, kind="commitment", level_cents=60000, cadence="monthly")
    (row,) = _progress(client)
    assert (row["target_cents"], row["owed_cents"], row["per_period_cents"]) == (60000, 15000, None)


def test_progress_reads_the_picker_date(client, db_session, category):
    _fund(db_session, category, 4000, on=datetime.date(2026, 4, 1))
    _set(client, category, kind="target", amount_cents=10000)
    assert _progress(client)[0]["balance_cents"] == 0
    assert _progress(client, datetime.date(2026, 4, 1))[0]["balance_cents"] == 4000


@pytest.mark.parametrize("fields, message", [
    ({"kind": "wish", "amount_cents": 1}, "Unknown goal kind"),
    ({"kind": "recurring_bill", "amount_cents": 100}, "amount and a cadence"),
    ({"kind": "recurring_bill", "cadence": "monthly"}, "amount and a cadence"),
    ({"kind": "target"}, "needs an amount"),
    ({"kind": "target", "amount_cents": 100, "cadence": "monthly"}, "needs a target date"),
    ({"kind": "target", "amount_cents": 100, "level_cents": 5}, "no level"),
    ({"kind": "target", "amount_cents": -1}, "negative"),
    ({"kind": "commitment", "cadence": "monthly"}, "give one, not both"),
    ({"kind": "commitment", "amount_cents": 1, "level_cents": 2, "cadence": "monthly"}, "give one, not both"),
    ({"kind": "commitment", "amount_cents": 1}, "needs a cadence"),
    ({"kind": "commitment", "amount_cents": 1, "cadence": "monthly", "target_date": "2026-05-01"}, "no target date"),
    ({"kind": "recurring_bill", "amount_cents": 1, "cadence": "weeks"}, "needs N"),
    ({"kind": "recurring_bill", "amount_cents": 1, "cadence": "monthly", "cadence_weeks": 2}, "only applies"),
    ({"kind": "recurring_bill", "amount_cents": 1, "cadence": "daily"}, "Unknown cadence"),
])
def test_invalid_goals_are_refused_and_nothing_is_written(client, category, fields, message):
    response = _set(client, category, **fields)
    assert response.status_code == 400
    assert message in response.json()["detail"]
    assert _progress(client) == []


def test_zero_is_a_stated_amount(client, category):
    assert _set(client, category, kind="target", amount_cents=0).status_code == 200
    assert _progress(client)[0]["target_cents"] == 0


def test_one_goal_per_category_put_replaces_it(client, category):
    first = _set(client, category, kind="target", amount_cents=10000).json()
    second = _set(client, category, name="Renamed", kind="commitment", level_cents=500, cadence="monthly").json()
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


def test_database_refuses_a_second_live_goal_on_a_category(db_session, category):
    for name in ("a", "b"):
        db_session.add(Goal(category_id=category.id, name=name, kind="target", amount_cents=1, created_on=DAY))
    with pytest.raises(IntegrityError):
        db_session.flush()
