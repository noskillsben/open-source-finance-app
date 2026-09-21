"""#22: link a category to the on-budget accounts its money lives in (DESIGN.md § Accounts →
Linked categories) — the pro-rata split of a gain, deposits and withdrawals directed by the
user, the warning on spending linked money, and the drift note.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, EarmarkLine
from app.services.accounts import create_account_with_opening_valuation
from app.services.categories import category_balance_cents
from app.services.earmarks import move_money, ready_to_assign_cents
from app.services.links import split_pro_rata
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


def _account(db_session, name, *, on_budget=True, opening=0, type="Savings"):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=DAY, type=type, on_budget=on_budget,
        on_budget_floor_cents=0, opening_balance_cents=opening,
    )
    db_session.flush()
    return account


def _category(db_session, name):
    category = Category(name=name, created_on=DAY)
    db_session.add(category)
    db_session.flush()
    return category


def _link(client, category, *accounts):
    return client.put(
        f"/api/categories/{category.id}/linked-accounts",
        json={"on": DAY.isoformat(), "account_ids": [a.id for a in accounts]},
    )


def _fund(db_session, category, cents):
    move_money(db_session, move_date=DAY, from_category_id=None, to_category_id=category.id, cents=cents)


def _transfer(db_session, source, target, cents, *, deposits=None, transaction=None):
    return write_transaction(
        db_session, transaction=transaction, txn_date=DAY, memo=None, payee_id=None,
        account_lines=[{"account_id": source.id, "cents": -cents}, {"account_id": target.id, "cents": cents}],
        category_lines=[], deposits=deposits,
    )


def _balance(db_session, category):
    return category_balance_cents(db_session, category.id, as_of=DAY)


@pytest.fixture()
def world(db_session):
    chequing = _account(db_session, "Chequing", type="Chequing", opening=2000_00)
    tfsa = _account(db_session, "TFSA")
    ebike = _category(db_session, "E-bike")
    vacation = _category(db_session, "Vacation")
    return chequing, tfsa, ebike, vacation


# --- split arithmetic ---------------------------------------------------------------------

def test_split_is_proportional_to_balances():
    assert split_pro_rata({1: 100_00, 2: 200_00}, 300_00) == [
        {"category_id": 1, "cents": 100_00}, {"category_id": 2, "cents": 200_00},
    ]


def test_split_remainder_goes_to_the_largest_balance_and_sums_exactly():
    lines = split_pro_rata({1: 1, 2: 1, 3: 1}, 100)  # 33 each, 1 left over: lowest id on the tie
    assert lines == [
        {"category_id": 1, "cents": 34}, {"category_id": 2, "cents": 33}, {"category_id": 3, "cents": 33},
    ]
    lines = split_pro_rata({1: 100, 2: 300}, 1)  # 0 / 0 by floor; the whole cent to the largest
    assert lines == [{"category_id": 2, "cents": 1}]


def test_split_of_a_loss_is_negative_and_still_sums_exactly():
    lines = split_pro_rata({1: 1, 2: 2}, -100)
    assert sum(line["cents"] for line in lines) == -100
    assert lines == [{"category_id": 1, "cents": -33}, {"category_id": 2, "cents": -67}]


def test_split_ignores_zero_and_negative_balances_and_returns_nothing_without_weight():
    assert split_pro_rata({1: 50_00, 2: 0, 3: -20_00}, 10_00) == [{"category_id": 1, "cents": 10_00}]
    assert split_pro_rata({1: 0, 2: -5}, 10_00) == []
    assert split_pro_rata({1: 5}, 0) == []


# --- link CRUD ----------------------------------------------------------------------------

def test_link_many_to_many_and_replace(client, world):
    _, tfsa, ebike, vacation = world
    assert _link(client, ebike, tfsa).status_code == 200
    _link(client, vacation, tfsa)
    listed = {c["name"]: c for c in client.get("/api/categories").json()}
    assert [a["name"] for a in listed["E-bike"]["linked_accounts"]] == ["TFSA"]
    assert [a["name"] for a in listed["Vacation"]["linked_accounts"]] == ["TFSA"]
    assert _link(client, ebike).json()["linked_accounts"] == []  # empty list unlinks


def test_a_tracking_account_cannot_be_linked(client, db_session, world):
    _, _, ebike, _ = world
    house = _account(db_session, "House", on_budget=False, type="Asset")
    response = _link(client, ebike, house)
    assert response.status_code == 400
    assert "tracking" in response.json()["detail"]


def test_link_to_an_unknown_account_is_a_400(client, world):
    _, _, ebike, _ = world
    response = client.put(
        f"/api/categories/{ebike.id}/linked-accounts", json={"on": DAY.isoformat(), "account_ids": [9999]}
    )
    assert response.status_code == 400


def test_archiving_either_side_removes_its_links(client, db_session, world):
    _, tfsa, ebike, vacation = world
    _link(client, ebike, tfsa)
    _link(client, vacation, tfsa)
    later = (DAY + datetime.timedelta(days=1)).isoformat()
    assert client.post(f"/api/categories/{ebike.id}/archive", json={"archived_on": later}).status_code == 200
    listed = {c["name"]: c for c in client.get("/api/categories", params={"include_archived": True}).json()}
    assert listed["E-bike"]["linked_accounts"] == []
    assert len(listed["Vacation"]["linked_accounts"]) == 1
    assert client.post(f"/api/accounts/{tfsa.id}/archive", json={"archived_on": later}).status_code == 200
    listed = {c["name"]: c for c in client.get("/api/categories", params={"include_archived": True}).json()}
    assert listed["Vacation"]["linked_accounts"] == []


# --- balance check split ------------------------------------------------------------------

def test_balance_check_preview_suggests_the_pro_rata_split(client, db_session, world):
    chequing, tfsa, ebike, vacation = world
    _link(client, ebike, tfsa)
    _link(client, vacation, tfsa)
    _fund(db_session, ebike, 100_00)
    _fund(db_session, vacation, 200_00)
    _transfer(db_session, chequing, tfsa, 300_00)
    response = client.get(
        f"/api/accounts/{tfsa.id}/balance-check-preview",
        params={"date": DAY.isoformat(), "stated_balance_cents": 600_00},
    )
    assert response.json() == {
        "diff_cents": 300_00,
        "category_lines": [
            {"category_id": ebike.id, "cents": 100_00, "need_level": None},
            {"category_id": vacation.id, "cents": 200_00, "need_level": None},
        ],
    }


def test_balance_check_saves_the_edited_split_on_the_adjustment(client, db_session, world):
    chequing, tfsa, ebike, vacation = world
    _link(client, ebike, tfsa)
    _link(client, vacation, tfsa)
    _fund(db_session, ebike, 100_00)
    _fund(db_session, vacation, 200_00)
    _transfer(db_session, chequing, tfsa, 300_00)
    response = client.post(f"/api/accounts/{tfsa.id}/balance-check", json={
        "date": DAY.isoformat(), "stated_balance_cents": 600_00,
        "category_lines": [{"category_id": ebike.id, "cents": 150_00}, {"category_id": vacation.id, "cents": 150_00}],
    })
    assert response.status_code == 200
    body = response.json()
    assert body["transaction"]["valuation_id"] == body["valuation_id"]
    assert _balance(db_session, ebike) == 250_00 and _balance(db_session, vacation) == 350_00


def test_balance_check_split_that_does_not_sum_is_a_400(client, db_session, world):
    chequing, tfsa, ebike, _ = world
    _link(client, ebike, tfsa)
    _transfer(db_session, chequing, tfsa, 300_00)
    response = client.post(f"/api/accounts/{tfsa.id}/balance-check", json={
        "date": DAY.isoformat(), "stated_balance_cents": 600_00,
        "category_lines": [{"category_id": ebike.id, "cents": 100_00}],
    })
    assert response.status_code == 400


# --- deposits and withdrawals -------------------------------------------------------------

def test_deposit_writes_the_directed_move_and_ready_to_assign_pays_for_it(client, db_session, world):
    chequing, tfsa, ebike, vacation = world
    _link(client, ebike, tfsa)
    _link(client, vacation, tfsa)
    before = ready_to_assign_cents(db_session, as_of=DAY)
    transaction = _transfer(db_session, chequing, tfsa, 500_00, deposits=[
        {"category_id": ebike.id, "cents": 50_00}, {"category_id": vacation.id, "cents": 450_00},
    ])
    lines = db_session.query(EarmarkLine).filter_by(source="deposit", transaction_id=transaction.id).all()
    assert sorted(l.cents for l in lines) == [50_00, 450_00]
    assert _balance(db_session, ebike) == 50_00 and _balance(db_session, vacation) == 450_00
    # a plain transfer changes no on-budget money, so the earmarks come out of ready to assign
    assert ready_to_assign_cents(db_session, as_of=DAY) == before - 500_00


def test_deposit_from_a_category_moves_out_of_it(db_session, client, world):
    chequing, tfsa, ebike, _ = world
    _link(client, ebike, tfsa)
    staging = _category(db_session, "Savings to deposit")
    _fund(db_session, staging, 500_00)
    _transfer(db_session, chequing, tfsa, 500_00, deposits=[
        {"category_id": ebike.id, "cents": 500_00, "other_category_id": staging.id},
    ])
    assert _balance(db_session, staging) == 0 and _balance(db_session, ebike) == 500_00


def test_already_earmarked_writes_no_line(db_session, client, world):
    chequing, tfsa, ebike, _ = world
    _link(client, ebike, tfsa)
    transaction = _transfer(db_session, chequing, tfsa, 500_00, deposits=[])
    assert db_session.query(EarmarkLine).filter_by(transaction_id=transaction.id).count() == 0


def test_deposits_cannot_exceed_the_transfer_or_name_an_unlinked_envelope(db_session, client, world):
    chequing, tfsa, ebike, vacation = world
    _link(client, ebike, tfsa)
    from app.services.transactions import TransactionError

    with pytest.raises(TransactionError, match="can't exceed"):
        _transfer(db_session, chequing, tfsa, 100_00, deposits=[{"category_id": ebike.id, "cents": 100_01}])
    with pytest.raises(TransactionError, match="linked"):
        _transfer(db_session, chequing, tfsa, 100_00, deposits=[{"category_id": vacation.id, "cents": 100_00}])


def test_withdrawal_is_the_mirror(db_session, client, world):
    chequing, tfsa, ebike, _ = world
    _link(client, ebike, tfsa)
    _transfer(db_session, chequing, tfsa, 500_00, deposits=[{"category_id": ebike.id, "cents": 500_00}])
    spending = _category(db_session, "Spending")
    _transfer(db_session, tfsa, chequing, 200_00, deposits=[
        {"category_id": ebike.id, "cents": 200_00, "other_category_id": spending.id},
    ])
    assert _balance(db_session, ebike) == 300_00 and _balance(db_session, spending) == 200_00
    _transfer(db_session, tfsa, chequing, 100_00, deposits=[{"category_id": ebike.id, "cents": 100_00}])
    assert _balance(db_session, ebike) == 200_00  # to ready to assign: one line


def test_editing_regenerates_and_a_list_less_edit_clears_deposits(db_session, client, world):
    chequing, tfsa, ebike, vacation = world
    _link(client, ebike, tfsa)
    _link(client, vacation, tfsa)
    transaction = _transfer(db_session, chequing, tfsa, 500_00, deposits=[{"category_id": ebike.id, "cents": 500_00}])
    _transfer(db_session, chequing, tfsa, 400_00, transaction=transaction, deposits=[
        {"category_id": vacation.id, "cents": 400_00},
    ])
    assert _balance(db_session, ebike) == 0 and _balance(db_session, vacation) == 400_00
    _transfer(db_session, chequing, tfsa, 400_00, transaction=transaction, deposits=None)  # re-save keeps them
    assert _balance(db_session, vacation) == 400_00
    _transfer(db_session, chequing, tfsa, 400_00, transaction=transaction, deposits=[])
    assert _balance(db_session, vacation) == 0


def test_the_api_reads_deposits_back_and_delete_removes_them(client, db_session, world):
    chequing, tfsa, ebike, vacation = world
    _link(client, ebike, tfsa)
    _link(client, vacation, tfsa)
    staging = _category(db_session, "Savings to deposit")
    _fund(db_session, staging, 100_00)
    body = {
        "date": DAY.isoformat(),
        "account_lines": [{"account_id": chequing.id, "cents": -500_00}, {"account_id": tfsa.id, "cents": 500_00}],
        "deposits": [
            {"category_id": ebike.id, "cents": 100_00, "other_category_id": staging.id},
            {"category_id": vacation.id, "cents": 400_00, "other_category_id": None},
        ],
    }
    created = client.post("/api/transactions", json=body)
    assert created.status_code == 201
    assert created.json()["deposits"] == body["deposits"]
    withdrawal = client.post("/api/transactions", json={
        "date": DAY.isoformat(),
        "account_lines": [{"account_id": tfsa.id, "cents": -50_00}, {"account_id": chequing.id, "cents": 50_00}],
        "deposits": [{"category_id": vacation.id, "cents": 50_00, "other_category_id": staging.id}],
    })
    assert withdrawal.json()["deposits"] == [{"category_id": vacation.id, "cents": 50_00, "other_category_id": staging.id}]
    listed = {t["id"]: t for t in client.get("/api/transactions").json()}  # what the edit form pre-fills from
    assert listed[created.json()["id"]]["deposits"] == body["deposits"]
    assert listed[withdrawal.json()["id"]]["deposits"] == withdrawal.json()["deposits"]
    assert client.delete(f"/api/transactions/{created.json()['id']}").status_code == 204
    assert _balance(db_session, ebike) == 0 and _balance(db_session, vacation) == -50_00


def test_a_deposit_on_a_transfer_that_touches_no_linked_account_is_a_400(client, db_session, world):
    chequing, _, ebike, _ = world
    other = _account(db_session, "Savings")
    response = client.post("/api/transactions", json={
        "date": DAY.isoformat(),
        "account_lines": [{"account_id": chequing.id, "cents": -10_00}, {"account_id": other.id, "cents": 10_00}],
        "deposits": [{"category_id": ebike.id, "cents": 10_00}],
    })
    assert response.status_code == 400


# --- warning, not block -------------------------------------------------------------------

def test_spending_a_linked_category_warns_naming_the_account_and_still_saves(client, db_session, world):
    chequing, tfsa, ebike, _ = world
    _link(client, ebike, tfsa)
    _fund(db_session, ebike, 500_00)
    response = client.post("/api/transactions", json={
        "date": DAY.isoformat(),
        "account_lines": [{"account_id": chequing.id, "cents": -80_00}],
        "category_lines": [{"category_id": ebike.id, "cents": -80_00}],
    })
    assert response.status_code == 201
    assert "E-bike's money is in TFSA." in response.json()["notes"]


def test_spending_straight_from_the_linked_account_does_not_warn(client, db_session, world):
    _, tfsa, ebike, _ = world
    _link(client, ebike, tfsa)
    _fund(db_session, ebike, 500_00)
    response = client.post("/api/transactions", json={
        "date": DAY.isoformat(),
        "account_lines": [{"account_id": tfsa.id, "cents": -80_00}],
        "category_lines": [{"category_id": ebike.id, "cents": -80_00}],
    })
    assert response.status_code == 201
    assert not any("money is in" in note for note in response.json()["notes"])


# --- drift note ---------------------------------------------------------------------------

def test_drift_note_when_envelopes_hold_more_than_the_account(client, db_session, world):
    chequing, tfsa, ebike, vacation = world
    _link(client, ebike, tfsa)
    _link(client, vacation, tfsa)
    _fund(db_session, ebike, 300_00)
    _fund(db_session, vacation, 200_00)
    _transfer(db_session, chequing, tfsa, 1)  # one cent in the account
    account = next(a for a in client.get("/api/accounts").json() if a["id"] == tfsa.id)
    assert account["drift_cents"] == 1 - 500_00
    assert any("E-bike and Vacation hold $499.99 more than TFSA does" in n for n in account["notes"])


def test_drift_note_when_the_account_holds_unclaimed_money(client, db_session, world):
    chequing, tfsa, ebike, _ = world
    _link(client, ebike, tfsa)
    _transfer(db_session, chequing, tfsa, 120_00)
    account = next(a for a in client.get("/api/accounts").json() if a["id"] == tfsa.id)
    assert account["drift_cents"] == 120_00
    assert any("not claimed by E-bike" in n for n in account["notes"])


def test_no_links_no_drift(client, world):
    _, tfsa, _, _ = world
    account = next(a for a in client.get("/api/accounts").json() if a["id"] == tfsa.id)
    assert account["drift_cents"] is None and account["linked_category_ids"] == []
