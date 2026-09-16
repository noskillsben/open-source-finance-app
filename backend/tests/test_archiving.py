"""DESIGN.md § General concepts → Non-ledger rows are archived, never deleted — the one
mechanism built against the shared `NonLedger` mixin, exercised here for accounts and
categories (payees already carry the mixin from #43/#44, but no archive endpoint yet).
"""
import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.db import get_session
from app.main import app
from app.models import Account, Category
from app.services.accounts import (
    account_balance_cents,
    account_latest_ledger_date,
    create_account_with_opening_valuation,
)
from app.services.archiving import Archivable, ArchiveError, archive, unarchive
from app.services.categories import build_category_archivable
from app.services.transactions import write_transaction

EARLIER = datetime.date(2026, 1, 1)
LATER = datetime.date(2026, 1, 15)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def make_category(db_session, name, *, created_on=EARLIER, parent_id=None):
    category = Category(name=name, created_on=created_on, parent_id=parent_id)
    db_session.add(category)
    db_session.flush()
    return category


def test_archived_account_frees_up_its_name(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    target = Archivable(entity=account, latest_ledger_date=account_latest_ledger_date(db_session, account.id))
    archive(target, LATER)
    db_session.flush()

    db_session.add(Account(
        name="Chequing", created_on=EARLIER, archived_on=None, type="Chequing",
        on_budget=True, on_budget_floor_cents=0,
    ))
    db_session.flush()  # no IntegrityError: the partial unique index ignores archived rows


def test_archived_category_frees_up_its_name(db_session):
    category = make_category(db_session, "Groceries")
    target = build_category_archivable(db_session, category, as_of=LATER)
    archive(target, LATER)
    db_session.flush()

    db_session.add(Category(name="Groceries", created_on=EARLIER))
    db_session.flush()  # no IntegrityError: the partial unique index ignores archived rows


def test_archive_refused_on_or_before_a_ledger_row_referencing_the_account(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[],
    )
    db_session.flush()

    target = Archivable(entity=account, latest_ledger_date=account_latest_ledger_date(db_session, account.id))
    with pytest.raises(ArchiveError):
        archive(target, LATER)
    with pytest.raises(ArchiveError):
        archive(target, datetime.date(2026, 1, 10))

    # The day after the latest ledger row is fine.
    warnings = archive(target, LATER + datetime.timedelta(days=1))
    assert account.archived_on == LATER + datetime.timedelta(days=1)
    assert warnings == []


def test_archive_refused_on_or_before_a_ledger_row_referencing_the_category(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    groceries = make_category(db_session, "Groceries")
    write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[{"category_id": groceries.id, "cents": 0}],
    )
    db_session.flush()

    target = build_category_archivable(db_session, groceries, as_of=LATER)
    with pytest.raises(ArchiveError):
        archive(target, LATER)


def test_archiving_a_category_with_children_archives_them_on_the_same_date(db_session):
    parent = make_category(db_session, "Car")
    insurance = make_category(db_session, "Car insurance", parent_id=parent.id)
    repairs = make_category(db_session, "Car repairs", parent_id=parent.id)

    target = build_category_archivable(db_session, parent, as_of=LATER)
    archive(target, LATER)
    db_session.flush()

    db_session.refresh(insurance)
    db_session.refresh(repairs)
    assert parent.archived_on == LATER
    assert insurance.archived_on == LATER
    assert repairs.archived_on == LATER


def test_unarchiving_a_parent_never_unarchives_its_children(db_session):
    parent = make_category(db_session, "Car", created_on=EARLIER)
    child = make_category(db_session, "Car insurance", created_on=EARLIER, parent_id=parent.id)
    target = build_category_archivable(db_session, parent, as_of=LATER)
    archive(target, LATER)
    db_session.flush()

    unarchive(parent)
    db_session.flush()

    db_session.refresh(child)
    assert parent.archived_on is None
    assert child.archived_on == LATER


def test_unarchive_blocked_by_a_name_now_taken(db_session):
    archived = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    target = Archivable(entity=archived, latest_ledger_date=account_latest_ledger_date(db_session, archived.id))
    archive(target, LATER)
    db_session.flush()

    create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=LATER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()

    unarchive(archived)
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_archiving_with_a_non_zero_balance_warns_but_does_not_block(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    target = Archivable(
        entity=account,
        latest_ledger_date=account_latest_ledger_date(db_session, account.id),
        balance_cents=account_balance_cents(db_session, account.id, as_of=LATER),
    )
    warnings = archive(target, LATER)
    db_session.flush()

    assert account.archived_on == LATER
    assert len(warnings) == 1
    assert "50000" in warnings[0]


def test_archiving_with_a_zero_balance_has_no_warning(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    target = Archivable(
        entity=account,
        latest_ledger_date=account_latest_ledger_date(db_session, account.id),
        balance_cents=account_balance_cents(db_session, account.id, as_of=LATER),
    )
    warnings = archive(target, LATER)

    assert warnings == []


def test_post_archive_and_unarchive_account_round_trip(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        archived = client.post(f"/api/accounts/{account.id}/archive", json={"archived_on": LATER.isoformat()})
        listed_after_archive = client.get("/api/accounts")
        unarchived = client.post(f"/api/accounts/{account.id}/unarchive")
        listed_after_unarchive = client.get("/api/accounts")
    finally:
        app.dependency_overrides.clear()

    assert archived.status_code == 200
    assert archived.json()["archived_on"] == LATER.isoformat()
    assert len(archived.json()["warnings"]) == 1
    assert all(a["id"] != account.id for a in listed_after_archive.json())

    assert unarchived.status_code == 200
    assert unarchived.json()["archived_on"] is None
    assert any(a["id"] == account.id for a in listed_after_unarchive.json())


def test_post_archive_account_on_ledger_date_is_400(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[],
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.post(f"/api/accounts/{account.id}/archive", json={"archived_on": LATER.isoformat()})
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 400


def test_post_archive_missing_account_is_404(db_session):
    client = _client(db_session)
    try:
        resp = client.post("/api/accounts/999999/archive", json={"archived_on": LATER.isoformat()})
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 404


def test_post_archive_category_cascades_to_children(db_session):
    parent = make_category(db_session, "Car")
    child = make_category(db_session, "Car insurance", parent_id=parent.id)
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.post(f"/api/categories/{parent.id}/archive", json={"archived_on": LATER.isoformat()})
        listed = client.get("/api/categories")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    db_session.refresh(child)
    assert child.archived_on == LATER
    assert all(c["id"] not in (parent.id, child.id) for c in listed.json())
