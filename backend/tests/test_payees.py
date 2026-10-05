"""DESIGN.md § Payees, § General concepts → Unique names, Non-ledger rows are archived."""
import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Payee
from app.services.transactions import TransactionError, write_transaction
from app.services.accounts import create_account_with_opening_valuation

EARLIER = datetime.date(2026, 1, 1)


def test_payee_names_are_unique_case_insensitively(db_session):
    db_session.add(Payee(name="Walmart", created_on=EARLIER))
    db_session.flush()

    with pytest.raises(IntegrityError):
        db_session.add(Payee(name="walmart", created_on=EARLIER))
        db_session.flush()


def test_archived_payee_frees_up_its_name(db_session):
    archived = Payee(name="Walmart", created_on=EARLIER, archived_on=datetime.date(2026, 1, 15))
    db_session.add(archived)
    db_session.flush()

    db_session.add(Payee(name="Walmart", created_on=EARLIER))
    db_session.flush()  # no IntegrityError: the partial unique index ignores archived rows


def test_transaction_saves_with_payee_id_set(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    payee = Payee(name="Walmart", created_on=EARLIER)
    db_session.add(payee)
    db_session.flush()

    txn = write_transaction(
        db_session, transaction=None, txn_date=EARLIER, memo=None, payee_id=payee.id,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[],
    )

    assert txn.payee_id == payee.id


def test_transaction_saves_with_payee_id_null(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )

    txn = write_transaction(
        db_session, transaction=None, txn_date=EARLIER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[],
    )

    assert txn.payee_id is None


def test_transaction_with_unknown_payee_id_is_refused(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )

    with pytest.raises(TransactionError):
        write_transaction(
            db_session, transaction=None, txn_date=EARLIER, memo=None, payee_id=999_999,
            account_lines=[{"account_id": account.id, "cents": -80_00}],
            category_lines=[],
        )


def _paid_bill(db_session, payee_id, paid_by_payee_id, on):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    txn = write_transaction(
        db_session, transaction=None, txn_date=on, memo=None, payee_id=payee_id,
        account_lines=[{"account_id": account.id, "cents": -80_00}], category_lines=[],
    )
    txn.paid_by_payee_id = paid_by_payee_id
    db_session.flush()
    return txn


def test_a_payee_who_paid_a_bill_cannot_be_archived_on_or_before_it(db_session):
    from fastapi.testclient import TestClient

    from app.db import get_session
    from app.main import app

    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    roommate = Payee(name="Sam", created_on=EARLIER)
    db_session.add(roommate)
    db_session.flush()
    _paid_bill(db_session, None, roommate.id, datetime.date(2026, 5, 10))
    client = TestClient(app)
    try:
        same_day = client.post(f"/api/payees/{roommate.id}/archive", json={"archived_on": "2026-05-10"})
        next_day = client.post(f"/api/payees/{roommate.id}/archive", json={"archived_on": "2026-05-11"})
    finally:
        app.dependency_overrides.clear()

    assert same_day.status_code == 400
    assert next_day.status_code == 200
