"""#132 — a payment says which recurring bill it paid and which of its due dates (DESIGN.md §
Goals → Paying a bill). The link is stated, validated as a shape, and never inferred.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, Goal
from app.services.accounts import create_account_with_opening_valuation

DAY = datetime.date(2026, 9, 1)
OCT_1 = datetime.date(2026, 10, 1)


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
def rent(db_session):
    category = Category(name="Rent", created_on=DAY)
    db_session.add(category)
    db_session.flush()
    goal = Goal(
        category_id=category.id, name="Rent", kind="recurring_bill", amount_cents=120_000,
        cadence="monthly", target_date=OCT_1, created_on=DAY,
    )
    db_session.add(goal)
    db_session.flush()
    return category, goal


def _pay(client, chequing, category, *, day="2026-10-03", cents=-120_000, **link):
    body = {
        "date": day,
        "account_lines": [{"account_id": chequing.id, "cents": cents}],
        "category_lines": [{"category_id": category.id, "cents": cents}],
        **link,
    }
    return client.post("/api/transactions", json=body)


def test_a_payment_links_to_a_bill_and_its_due_date(client, chequing, rent):
    category, goal = rent
    response = _pay(client, chequing, category, goal_id=goal.id, goal_due_on="2026-10-01")
    assert response.status_code == 201
    body = response.json()
    assert (body["goal_id"], body["goal_due_on"]) == (goal.id, "2026-10-01")
    assert body["notes"] == []


def test_an_unlinked_payment_carries_two_nulls(client, chequing, rent):
    body = _pay(client, chequing, rent[0]).json()
    assert (body["goal_id"], body["goal_due_on"]) == (None, None)


def test_the_bill_without_its_due_date_is_refused(client, chequing, rent):
    assert _pay(client, chequing, rent[0], goal_id=rent[1].id).status_code == 422
    assert len(client.get("/api/transactions").json()) == 1  # only the opening balance


def test_the_due_date_without_its_bill_is_refused(client, chequing, rent):
    assert _pay(client, chequing, rent[0], goal_due_on="2026-10-01").status_code == 422
    assert len(client.get("/api/transactions").json()) == 1  # only the opening balance


def test_the_pairing_is_also_enforced_in_the_service(db_session, chequing, rent):
    from app.services.transactions import TransactionError, write_transaction

    with pytest.raises(TransactionError, match="both the bill and its due date"):
        write_transaction(
            db_session, transaction=None, txn_date=DAY, memo=None, payee_id=None,
            account_lines=[{"account_id": chequing.id, "cents": -100}], category_lines=[],
            goal_id=rent[1].id, goal_due_on=None,
        )


@pytest.mark.parametrize("due_on", ["2026-10-02", "2026-09-01", "2026-10-31"])
def test_the_due_date_must_be_one_of_the_bills(client, chequing, rent, due_on):
    response = _pay(client, chequing, rent[0], goal_id=rent[1].id, goal_due_on=due_on)
    assert response.status_code == 400
    assert "not one of" in response.json()["detail"]
    assert len(client.get("/api/transactions").json()) == 1  # only the opening balance


def test_a_later_due_date_of_the_bill_is_accepted(client, chequing, rent):
    assert _pay(client, chequing, rent[0], goal_id=rent[1].id, goal_due_on="2027-03-01").status_code == 201


def test_only_a_recurring_bill_can_be_linked(client, db_session, chequing):
    other = Category(name="Vacation", created_on=DAY)
    db_session.add(other)
    db_session.flush()
    target = Goal(category_id=other.id, name="Trip", kind="target", amount_cents=1, created_on=DAY)
    db_session.add(target)
    db_session.flush()
    response = _pay(client, chequing, other, goal_id=target.id, goal_due_on="2026-10-01")
    assert response.status_code == 400
    assert "not a recurring bill" in response.json()["detail"]


def test_an_unknown_bill_is_refused(client, chequing, rent):
    assert _pay(client, chequing, rent[0], goal_id=9999, goal_due_on="2026-10-01").status_code == 400


def test_two_payments_link_to_the_same_due_date(client, chequing, rent):
    category, goal = rent
    first = _pay(client, chequing, category, cents=-70_000, goal_id=goal.id, goal_due_on="2026-10-01")
    second = _pay(
        client, chequing, category, day="2026-10-05", cents=-50_000, goal_id=goal.id, goal_due_on="2026-10-01"
    )
    assert (first.status_code, second.status_code) == (201, 201)
    # Both count for the one date; the next unpaid date is November's.
    dates = client.get(f"/api/goals/{goal.id}/due-dates").json()
    assert [d["due_on"] for d in dates if d["earliest_unpaid"]] == ["2026-11-01"]
    assert [d["paid"] for d in dates[:2]] == [True, False]


def test_a_link_to_a_category_the_payment_has_no_line_on_is_a_warning_not_a_refusal(
    client, db_session, chequing, rent
):
    _, goal = rent
    groceries = Category(name="Groceries", created_on=DAY)
    db_session.add(groceries)
    db_session.flush()
    response = _pay(client, chequing, groceries, goal_id=goal.id, goal_due_on="2026-10-01")
    assert response.status_code == 201
    assert any("no line on Rent" in note for note in response.json()["notes"])
    assert response.json()["goal_id"] == goal.id


def test_a_bill_link_can_be_changed_or_cleared_on_edit(client, chequing, rent):
    category, goal = rent
    saved = _pay(client, chequing, category, goal_id=goal.id, goal_due_on="2026-10-01").json()
    body = {
        "date": saved["date"],
        "account_lines": [{"account_id": chequing.id, "cents": -120_000}],
        "category_lines": [{"category_id": category.id, "cents": -120_000}],
    }
    moved = client.put(
        f"/api/transactions/{saved['id']}", json={**body, "goal_id": goal.id, "goal_due_on": "2026-11-01"}
    )
    assert moved.json()["goal_due_on"] == "2026-11-01"
    cleared = client.put(f"/api/transactions/{saved['id']}", json=body)
    assert (cleared.json()["goal_id"], cleared.json()["goal_due_on"]) == (None, None)


def test_the_integrity_re_save_keeps_the_link(client, chequing, rent):
    category, goal = rent
    saved = _pay(client, chequing, category, goal_id=goal.id, goal_due_on="2026-10-01").json()
    again = client.post(f"/api/transactions/{saved['id']}/re-save").json()
    assert (again["goal_id"], again["goal_due_on"]) == (goal.id, "2026-10-01")


def test_spending_on_the_category_without_a_link_never_marks_a_bill_paid(client, chequing, rent):
    _pay(client, chequing, rent[0])
    progress = client.get("/api/goals", params={"as_of": "2026-10-10"}).json()
    assert progress[0]["earliest_unpaid_due_on"] == "2026-10-01"


def test_the_earliest_unpaid_due_date_moves_on_once_linked(client, chequing, rent):
    category, goal = rent
    _pay(client, chequing, category, goal_id=goal.id, goal_due_on="2026-10-01")
    progress = client.get("/api/goals", params={"as_of": "2026-10-10"}).json()
    assert progress[0]["earliest_unpaid_due_on"] == "2026-11-01"


def test_a_target_has_no_earliest_unpaid_due_date(client, db_session):
    category = Category(name="Vacation", created_on=DAY)
    db_session.add(category)
    db_session.flush()
    db_session.add(Goal(category_id=category.id, name="Trip", kind="target", amount_cents=1, created_on=DAY))
    db_session.flush()
    assert client.get("/api/goals", params={"as_of": "2026-10-10"}).json()[0]["earliest_unpaid_due_on"] is None


def test_due_dates_step_from_the_first_so_a_month_end_does_not_drift(rent):
    from app.services.goals import is_bill_due_date

    _, goal = rent
    goal.target_date = datetime.date(2026, 1, 31)
    assert is_bill_due_date(goal, datetime.date(2026, 2, 28))
    assert is_bill_due_date(goal, datetime.date(2026, 3, 31))  # not the 28th, which drift would give
    assert not is_bill_due_date(goal, datetime.date(2026, 3, 28))


def test_editing_the_first_due_date_leaves_old_links_marking_nothing_paid(client, chequing, rent):
    category, goal = rent
    _pay(client, chequing, category, goal_id=goal.id, goal_due_on="2026-10-01")
    response = client.put(f"/api/categories/{category.id}/goal", json={
        "on": "2026-10-05", "name": "Rent", "kind": "recurring_bill", "amount_cents": 120_000,
        "cadence": "monthly", "target_date": "2026-12-15",
    })
    assert response.status_code == 200
    progress = client.get("/api/goals", params={"as_of": "2026-10-10"}).json()
    assert progress[0]["earliest_unpaid_due_on"] == "2026-12-15"


# The extended archive guard: a bill can't be archived on or before its latest *linked* payment.

def test_a_bill_cannot_be_archived_on_or_before_its_latest_linked_payment(client, chequing, rent):
    category, goal = rent
    _pay(client, chequing, category, day="2026-10-03", goal_id=goal.id, goal_due_on="2026-10-01")
    for day in ("2026-10-03", "2026-10-02"):
        response = client.post(f"/api/categories/{category.id}/goal/archive", json={"archived_on": day})
        assert response.status_code == 400
    ok = client.post(f"/api/categories/{category.id}/goal/archive", json={"archived_on": "2026-10-04"})
    assert ok.status_code == 200
    assert ok.json()["archived_on"] == "2026-10-04"


def test_an_unlinked_payment_does_not_hold_the_bill_back(client, chequing, rent):
    category, _ = rent
    _pay(client, chequing, category, day="2026-10-03")  # spending on the category, no link
    response = client.post(f"/api/categories/{category.id}/goal/archive", json={"archived_on": "2026-10-01"})
    assert response.status_code == 200
