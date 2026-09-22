"""#23: named pays (DESIGN.md § Income streams) — cadence and anchor payday reused from goals,
next payday computed at read time and never stored, deductions replaced as a set on save.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, IncomeStream
from app.services.accounts import create_account_with_opening_valuation

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
    category = Category(name="Salary income", created_on=DAY)
    db_session.add(category)
    db_session.flush()
    return category


@pytest.fixture()
def deduction_category(db_session):
    category = Category(name="Income tax", created_on=DAY)
    db_session.add(category)
    db_session.flush()
    return category


@pytest.fixture()
def account(db_session):
    return create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )


def _body(category, account, **fields):
    return {
        "on": DAY.isoformat(),
        "name": "Salary",
        "payee_id": None,
        "cadence": "monthly",
        "cadence_weeks": None,
        "anchor_payday": "2026-03-15",
        "expected_gross_cents": 400000,
        "expected_net_low_cents": 250000,
        "expected_net_high_cents": 250000,
        "income_category_id": category.id,
        "destination_account_id": account.id,
        "deductions": [],
        **fields,
    }


def _create(client, category, account, **fields):
    return client.post("/api/income-streams", json=_body(category, account, **fields))


def _list(client, on=DAY, include_archived=False):
    return client.get(
        "/api/income-streams", params={"as_of": on.isoformat(), "include_archived": include_archived}
    ).json()


def test_create_and_list(client, category, account):
    response = _create(client, category, account)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Salary"
    assert body["next_payday"] == "2026-03-15"
    (row,) = _list(client)
    assert row["id"] == body["id"]


def test_name_unique_case_insensitively(client, category, account):
    assert _create(client, category, account, name="Salary").status_code == 201
    response = _create(client, category, account, name="salary")
    assert response.status_code == 409


def test_archive_then_recreate_same_name(client, category, account):
    created = _create(client, category, account).json()
    archived = client.post(f"/api/income-streams/{created['id']}/archive", json={"archived_on": "2026-03-10"})
    assert archived.status_code == 200

    response = _create(client, category, account)
    assert response.status_code == 201  # the partial unique index ignores the archived row


def test_archive_hides_from_a_later_picker_date_and_unarchive_restores(client, category, account):
    created = _create(client, category, account).json()
    client.post(f"/api/income-streams/{created['id']}/archive", json={"archived_on": "2026-03-10"})

    assert _list(client, on=datetime.date(2026, 3, 15)) == []
    assert len(_list(client, on=datetime.date(2026, 3, 5))) == 1  # still there on earlier dates

    unarchived = client.post(f"/api/income-streams/{created['id']}/unarchive")
    assert unarchived.status_code == 200
    assert len(_list(client, on=datetime.date(2026, 3, 15))) == 1


@pytest.mark.parametrize("fields, as_of, expected", [
    ({"cadence": "weeks", "cadence_weeks": 1, "anchor_payday": "2026-03-06"}, "2026-03-20", "2026-03-20"),
    ({"cadence": "weeks", "cadence_weeks": 2, "anchor_payday": "2026-02-20"}, "2026-03-01", "2026-03-06"),
    ({"cadence": "monthly", "anchor_payday": "2026-01-31"}, "2026-03-01", "2026-03-31"),
])
def test_next_payday_rolls_forward(client, category, account, fields, as_of, expected):
    created = _create(client, category, account, **fields).json()
    (row,) = _list(client, on=datetime.date.fromisoformat(as_of))
    assert row["id"] == created["id"]
    assert row["next_payday"] == expected


def test_recording_never_advances_the_anchor(client, category, account):
    # #23 builds no recording surface at all — the anchor is only ever what the form states, and
    # a later picker date keeps rolling forward from the same stated anchor, never a moved one.
    created = _create(client, category, account, anchor_payday="2026-01-31").json()
    (row,) = _list(client, on=datetime.date(2026, 4, 1))
    assert row["next_payday"] == "2026-04-30"
    (again,) = _list(client, on=datetime.date(2026, 4, 1))
    assert again["next_payday"] == row["next_payday"]  # reading twice changes nothing


def test_deductions_replaced_on_edit(client, db_session, category, account, deduction_category):
    created = _create(
        client, category, account,
        deductions=[{"category_id": deduction_category.id, "amount_cents": 50000}],
    ).json()
    assert [d["amount_cents"] for d in created["deductions"]] == [50000]

    other = Category(name="CPP/EI", created_on=DAY)
    db_session.add(other)
    db_session.flush()

    updated = client.put(
        f"/api/income-streams/{created['id']}",
        json=_body(category, account, deductions=[{"category_id": other.id, "amount_cents": 15000}]),
    ).json()
    assert [(d["category_id"], d["amount_cents"]) for d in updated["deductions"]] == [(other.id, 15000)]


@pytest.mark.parametrize("fields, message", [
    ({"cadence": "daily"}, "Unknown cadence"),
    ({"cadence": "weeks", "cadence_weeks": None}, "needs N"),
    ({"cadence_weeks": 2}, "only applies"),
    ({"expected_net_low_cents": 300000, "expected_net_high_cents": 250000}, "cannot be more than"),
    ({"expected_gross_cents": -1}, "cannot be negative"),
    ({"income_category_id": 999999}, "Unknown category id"),
    ({"destination_account_id": 999999}, "Unknown account id"),
])
def test_invalid_income_streams_are_refused_and_nothing_is_written(client, category, account, fields, message):
    fields.setdefault("cadence_weeks", None)
    response = _create(client, category, account, **fields)
    assert response.status_code == 400
    assert message in response.json()["detail"]
    assert _list(client) == []


def test_unknown_income_stream_id_is_404(client, category, account):
    assert client.put("/api/income-streams/999999", json=_body(category, account)).status_code == 404
    assert client.post("/api/income-streams/999999/archive", json={"archived_on": "2026-03-10"}).status_code == 404
    assert client.post("/api/income-streams/999999/unarchive").status_code == 404


def test_database_refuses_a_second_live_stream_with_the_same_name(db_session, category, account):
    from sqlalchemy.exc import IntegrityError

    for _ in range(2):
        db_session.add(IncomeStream(
            name="Salary", created_on=DAY, cadence="monthly", anchor_payday=DAY,
            expected_net_low_cents=1, expected_net_high_cents=1,
            income_category_id=category.id, destination_account_id=account.id,
        ))
    with pytest.raises(IntegrityError):
        db_session.flush()
