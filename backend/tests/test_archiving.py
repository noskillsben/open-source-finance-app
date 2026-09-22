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
from app.models import Account, Category, Payee
from app.seed import ME_KEY, guard_not_me
from app.services.accounts import (
    account_balance_cents,
    account_latest_ledger_date,
    create_account_with_opening_valuation,
)
from app.services.archiving import Archivable, ArchiveError, archive, unarchive
from app.services.categories import build_category_archivable
from app.services.payees import payee_latest_ledger_date
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
        category_lines=[{"category_id": groceries.id, "cents": -80_00}],
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


BEFORE_CREATED = EARLIER - datetime.timedelta(days=1)


def test_account_dated_after_as_of_is_excluded(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.get(f"/api/accounts?as_of={BEFORE_CREATED.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert all(a["id"] != account.id for a in resp.json())


def test_account_dated_exactly_on_as_of_is_included(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.get(f"/api/accounts?as_of={EARLIER.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert any(a["id"] == account.id for a in resp.json())


def test_account_excluded_once_as_of_reaches_its_archived_on(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    target = Archivable(entity=account, latest_ledger_date=account_latest_ledger_date(db_session, account.id))
    archive(target, LATER)
    db_session.flush()

    client = _client(db_session)
    try:
        before_archive = client.get(f"/api/accounts?as_of={(LATER - datetime.timedelta(days=1)).isoformat()}")
        on_archive = client.get(f"/api/accounts?as_of={LATER.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert any(a["id"] == account.id for a in before_archive.json())
    assert all(a["id"] != account.id for a in on_archive.json())


def test_unarchived_account_reappears_at_every_date_since_created_on(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    target = Archivable(entity=account, latest_ledger_date=account_latest_ledger_date(db_session, account.id))
    archive(target, LATER)
    db_session.flush()
    unarchive(account)
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.get(f"/api/accounts?as_of={EARLIER.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert any(a["id"] == account.id for a in resp.json())


def test_accounts_with_no_as_of_only_excludes_archived_rows(db_session):
    future_account = create_account_with_opening_valuation(
        db_session, name="Future", created_on=LATER + datetime.timedelta(days=365),
        type="Chequing", on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.get("/api/accounts")
    finally:
        app.dependency_overrides.clear()

    assert any(a["id"] == future_account.id for a in resp.json())


def test_category_dated_after_as_of_is_excluded(db_session):
    category = make_category(db_session, "Groceries", created_on=EARLIER)

    client = _client(db_session)
    try:
        resp = client.get(f"/api/categories?as_of={BEFORE_CREATED.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert all(c["id"] != category.id for c in resp.json())


def test_category_dated_exactly_on_as_of_is_included(db_session):
    category = make_category(db_session, "Groceries", created_on=EARLIER)

    client = _client(db_session)
    try:
        resp = client.get(f"/api/categories?as_of={EARLIER.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert any(c["id"] == category.id for c in resp.json())


def test_category_excluded_once_as_of_reaches_its_archived_on(db_session):
    category = make_category(db_session, "Groceries", created_on=EARLIER)
    target = build_category_archivable(db_session, category, as_of=LATER)
    archive(target, LATER)
    db_session.flush()

    client = _client(db_session)
    try:
        before_archive = client.get(f"/api/categories?as_of={(LATER - datetime.timedelta(days=1)).isoformat()}")
        on_archive = client.get(f"/api/categories?as_of={LATER.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert any(c["id"] == category.id for c in before_archive.json())
    assert all(c["id"] != category.id for c in on_archive.json())


def test_unarchived_category_reappears_at_every_date_since_created_on(db_session):
    category = make_category(db_session, "Groceries", created_on=EARLIER)
    target = build_category_archivable(db_session, category, as_of=LATER)
    archive(target, LATER)
    db_session.flush()
    unarchive(category)
    db_session.flush()

    client = _client(db_session)
    try:
        resp = client.get(f"/api/categories?as_of={EARLIER.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert any(c["id"] == category.id for c in resp.json())


def test_categories_with_no_as_of_only_excludes_archived_rows(db_session):
    future_category = make_category(db_session, "Future", created_on=LATER + datetime.timedelta(days=365))

    client = _client(db_session)
    try:
        resp = client.get("/api/categories")
    finally:
        app.dependency_overrides.clear()

    assert any(c["id"] == future_category.id for c in resp.json())


def make_payee(db_session, name, *, created_on=EARLIER, seeded_key=None):
    payee = Payee(name=name, created_on=created_on, seeded_key=seeded_key)
    db_session.add(payee)
    db_session.flush()
    return payee


def test_post_archive_and_unarchive_payee_round_trip(db_session):
    payee = make_payee(db_session, "Walmart")

    client = _client(db_session)
    try:
        archived = client.post(f"/api/payees/{payee.id}/archive", json={"archived_on": LATER.isoformat()})
        listed_after_archive = client.get("/api/payees")
        unarchived = client.post(f"/api/payees/{payee.id}/unarchive")
        listed_after_unarchive = client.get("/api/payees")
    finally:
        app.dependency_overrides.clear()

    assert archived.status_code == 200
    assert archived.json()["archived_on"] == LATER.isoformat()
    assert all(p["id"] != payee.id for p in listed_after_archive.json())

    assert unarchived.status_code == 200
    assert unarchived.json()["archived_on"] is None
    assert any(p["id"] == payee.id for p in listed_after_unarchive.json())


def test_payee_dated_after_as_of_is_excluded(db_session):
    payee = make_payee(db_session, "Walmart", created_on=EARLIER)

    client = _client(db_session)
    try:
        resp = client.get(f"/api/payees?as_of={BEFORE_CREATED.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert all(p["id"] != payee.id for p in resp.json())


def test_archive_refused_on_or_before_a_ledger_row_referencing_the_payee(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    payee = make_payee(db_session, "Walmart")
    write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=payee.id,
        account_lines=[{"account_id": account.id, "cents": -80_00}],
        category_lines=[],
    )
    db_session.flush()

    target = Archivable(entity=payee, latest_ledger_date=payee_latest_ledger_date(db_session, payee.id))
    with pytest.raises(ArchiveError):
        archive(target, LATER)


def test_post_archive_me_is_400(db_session):
    me = make_payee(db_session, "Me", seeded_key=ME_KEY)

    client = _client(db_session)
    try:
        resp = client.post(f"/api/payees/{me.id}/archive", json={"archived_on": LATER.isoformat()})
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 400


def test_guard_not_me_raises_for_me_and_not_for_an_ordinary_payee(db_session):
    me = make_payee(db_session, "Me", seeded_key=ME_KEY)
    ordinary = make_payee(db_session, "Walmart")

    with pytest.raises(ArchiveError):
        guard_not_me(me)

    guard_not_me(ordinary)  # does not raise


def test_accounts_list_include_archived_returns_archived_rows(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        client.post(f"/api/accounts/{account.id}/archive", json={"archived_on": LATER.isoformat()})
        plain = client.get("/api/accounts")
        with_archived = client.get("/api/accounts?include_archived=true")
    finally:
        app.dependency_overrides.clear()

    assert all(a["id"] != account.id for a in plain.json())
    row = next(a for a in with_archived.json() if a["id"] == account.id)
    assert row["archived_on"] == LATER.isoformat()


def test_categories_list_include_archived_returns_archived_rows(db_session):
    category = make_category(db_session, "Groceries")

    client = _client(db_session)
    try:
        client.post(f"/api/categories/{category.id}/archive", json={"archived_on": LATER.isoformat()})
        plain = client.get("/api/categories")
        with_archived = client.get("/api/categories?include_archived=true")
    finally:
        app.dependency_overrides.clear()

    assert all(c["id"] != category.id for c in plain.json())
    row = next(c for c in with_archived.json() if c["id"] == category.id)
    assert row["archived_on"] == LATER.isoformat()


def test_payees_list_include_archived_returns_archived_rows(db_session):
    payee = make_payee(db_session, "Walmart")

    client = _client(db_session)
    try:
        client.post(f"/api/payees/{payee.id}/archive", json={"archived_on": LATER.isoformat()})
        plain = client.get("/api/payees")
        with_archived = client.get("/api/payees?include_archived=true")
    finally:
        app.dependency_overrides.clear()

    assert all(p["id"] != payee.id for p in plain.json())
    row = next(p for p in with_archived.json() if p["id"] == payee.id)
    assert row["archived_on"] == LATER.isoformat()


def test_post_unarchive_account_into_a_taken_name_is_409(db_session):
    archived = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()

    client = _client(db_session)
    try:
        client.post(f"/api/accounts/{archived.id}/archive", json={"archived_on": LATER.isoformat()})
        create_account_with_opening_valuation(
            db_session, name="Chequing", created_on=LATER, type="Chequing",
            on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
        )
        db_session.flush()
        resp = client.post(f"/api/accounts/{archived.id}/unarchive")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 409
    assert "Chequing" in resp.json()["detail"]


def test_post_unarchive_category_into_a_taken_name_is_409(db_session):
    archived = make_category(db_session, "Groceries")
    db_session.flush()

    client = _client(db_session)
    try:
        client.post(f"/api/categories/{archived.id}/archive", json={"archived_on": LATER.isoformat()})
        make_category(db_session, "Groceries", created_on=LATER)
        db_session.flush()
        resp = client.post(f"/api/categories/{archived.id}/unarchive")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 409
    assert "Groceries" in resp.json()["detail"]


def test_post_unarchive_payee_into_a_taken_name_is_409(db_session):
    archived = make_payee(db_session, "Walmart")
    db_session.flush()

    client = _client(db_session)
    try:
        client.post(f"/api/payees/{archived.id}/archive", json={"archived_on": LATER.isoformat()})
        make_payee(db_session, "Walmart", created_on=LATER)
        db_session.flush()
        resp = client.post(f"/api/payees/{archived.id}/unarchive")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 409
    assert "Walmart" in resp.json()["detail"]
