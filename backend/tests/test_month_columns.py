"""#401: Assigned and Spent for the calendar month of Show as of, next to Available. Read-time
sums, never stored; the calendar month, never the pay period.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category
from app.services.accounts import create_account_with_opening_valuation
from app.services.categories import category_balance_cents, category_month_cents
from app.services.earmarks import move_money
from app.services.transactions import write_transaction

SEPT = datetime.date(2026, 9, 1)
OCT1 = datetime.date(2026, 10, 1)
OCT3 = datetime.date(2026, 10, 3)
OCT15 = datetime.date(2026, 10, 15)


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
def account(db_session):
    a = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=SEPT, type="Chequing", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=5000_00,
    )
    db_session.flush()
    return a


def _category(db_session, name="Groceries", parent_id=None):
    c = Category(name=name, created_on=SEPT, parent_id=parent_id)
    db_session.add(c)
    db_session.flush()
    return c


def _assign(session, on, category_id, cents):
    into, out_of = (category_id, None) if cents > 0 else (None, category_id)
    move_money(session, move_date=on, from_category_id=out_of, to_category_id=into, cents=abs(cents))


def _spend(session, account, category, cents, on):
    """Negative cents is spending; positive is a refund."""
    write_transaction(
        session, transaction=None, txn_date=on, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": cents}],
        category_lines=[{"category_id": category.id, "cents": cents}],
    )


def test_the_worked_example(db_session, account):
    c = _category(db_session)
    _assign(db_session, SEPT, c.id, 400_00)
    _assign(db_session, OCT1, c.id, 400_00)
    _spend(db_session, account, c, -312_00, OCT3)
    assert category_month_cents(db_session, c.id, as_of=OCT15) == (400_00, -312_00)
    assert category_balance_cents(db_session, c.id, as_of=OCT15) == 488_00


def test_a_refund_lowers_spent(db_session, account):
    c = _category(db_session)
    _spend(db_session, account, c, -100_00, OCT1)
    _spend(db_session, account, c, 30_00, OCT3)
    assert category_month_cents(db_session, c.id, as_of=OCT15)[1] == -70_00


def test_a_withdrawal_and_a_cover_lower_assigned(db_session):
    a, b = _category(db_session, "A"), _category(db_session, "B")
    _assign(db_session, OCT1, a.id, 500_00)
    _assign(db_session, OCT3, a.id, -50_00)
    move_money(db_session, move_date=OCT3, from_category_id=a.id, to_category_id=b.id, cents=100_00)
    assert category_month_cents(db_session, a.id, as_of=OCT15)[0] == 350_00
    assert category_month_cents(db_session, b.id, as_of=OCT15)[0] == 100_00


def test_lines_outside_the_month_through_the_picker_date_are_excluded(db_session, account):
    c = _category(db_session)
    _assign(db_session, datetime.date(2026, 9, 30), c.id, 100_00)
    _spend(db_session, account, c, -10_00, datetime.date(2026, 9, 30))
    _assign(db_session, OCT15, c.id, 200_00)
    _spend(db_session, account, c, -20_00, datetime.date(2026, 10, 20))
    assert category_month_cents(db_session, c.id, as_of=OCT3) == (0, 0)
    assert category_month_cents(db_session, c.id, as_of=OCT15) == (200_00, 0)
    assert category_month_cents(db_session, c.id, as_of=datetime.date(2026, 10, 31)) == (200_00, -20_00)


def test_the_endpoint_reports_each_category_own_figures(client, db_session, account):
    parent = _category(db_session, "Home")
    child = _category(db_session, "Rent", parent_id=parent.id)
    _assign(db_session, OCT1, child.id, 300_00)
    _spend(db_session, account, child, -120_00, OCT3)
    rows = {r["category_id"]: r for r in client.get("/api/ready-to-assign", params={"as_of": "2026-10-15"}).json()["categories"]}
    assert (rows[child.id]["assigned_cents"], rows[child.id]["spent_cents"]) == (300_00, -120_00)
    assert (rows[parent.id]["assigned_cents"], rows[parent.id]["spent_cents"]) == (0, 0)


def test_available_equals_last_months_end_plus_assigned_plus_spent(db_session, account):
    c = _category(db_session)
    _assign(db_session, SEPT, c.id, 400_00)
    _spend(db_session, account, c, -50_00, datetime.date(2026, 9, 12))
    _assign(db_session, OCT1, c.id, 250_00)
    _spend(db_session, account, c, -312_00, OCT3)
    _spend(db_session, account, c, 12_00, OCT15)
    assigned, spent = category_month_cents(db_session, c.id, as_of=OCT15)
    end_of_september = category_balance_cents(db_session, c.id, as_of=datetime.date(2026, 9, 30))
    assert category_balance_cents(db_session, c.id, as_of=OCT15) == end_of_september + assigned + spent
