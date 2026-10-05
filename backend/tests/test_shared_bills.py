"""DESIGN.md § Splits — a shared bill is an ordinary transaction. The form works out the lines;
the backend only checks the shape (the split exists, Paid by is Me or a member, no Paid by
without a split) and stores the lines as given, so only my share is ever a category line.
"""
import datetime

from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Category, Payee, Split, SplitMember, Transaction
from app.seed import ME_KEY
from app.services.accounts import account_balance_cents, create_account_with_opening_valuation
from app.services.categories import category_balance_cents

DAY = datetime.date(2026, 3, 1)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def _account(db_session, name):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=DAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    db_session.flush()
    return account


def _household(db_session):
    """Me, a Roommate at 50% with their own receivable, a Household split, and a category."""
    me = Payee(name="Me", created_on=DAY, seeded_key=ME_KEY)
    roommate = Payee(name="Roommate", created_on=DAY)
    stranger = Payee(name="Stranger", created_on=DAY)
    db_session.add_all([me, roommate, stranger])
    db_session.flush()
    chequing, owed = _account(db_session, "Chequing"), _account(db_session, "Roommate")
    split = Split(name="Household", created_on=DAY)
    db_session.add(split)
    db_session.flush()
    db_session.add(SplitMember(split_id=split.id, payee_id=roommate.id, account_id=owed.id, percent=50, created_on=DAY))
    meals = Category(name="Meals", created_on=DAY)
    db_session.add(meals)
    db_session.flush()
    return {"me": me, "roommate": roommate, "stranger": stranger, "chequing": chequing, "owed": owed,
            "split": split, "meals": meals}


def _body(account_lines, category_lines, **extra):
    return {"date": DAY.isoformat(), "account_lines": account_lines, "category_lines": category_lines, **extra}


def _shared_meal(h, **extra):
    return _body(
        [{"account_id": h["chequing"].id, "cents": -100_00}, {"account_id": h["owed"].id, "cents": 50_00}],
        [{"category_id": h["meals"].id, "cents": -50_00}],
        split_id=h["split"].id, paid_by_payee_id=h["me"].id, **extra,
    )


def test_a_100_dollar_meal_split_50_50_counts_50_in_category_spending(db_session):
    h = _household(db_session)
    client = _client(db_session)
    try:
        response = client.post("/api/transactions", json=_shared_meal(h))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert (body["split_id"], body["paid_by_payee_id"]) == (h["split"].id, h["me"].id)
    assert category_balance_cents(db_session, h["meals"].id, as_of=DAY) == -50_00  # not -100
    assert account_balance_cents(db_session, h["owed"].id) == 50_00


def test_paid_by_someone_else_writes_no_line_on_my_accounts_and_passes_the_invariant(db_session):
    h = _household(db_session)
    client = _client(db_session)
    try:
        response = client.post("/api/transactions", json=_body(
            [{"account_id": h["owed"].id, "cents": -50_00}],
            [{"category_id": h["meals"].id, "cents": -50_00}],
            split_id=h["split"].id, paid_by_payee_id=h["roommate"].id, shared_total_cents=100_00,
        ))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["shared_total_cents"] == 100_00
    assert [l["account_id"] for l in response.json()["account_lines"]] == [h["owed"].id]
    assert account_balance_cents(db_session, h["chequing"].id) == 0
    assert account_balance_cents(db_session, h["owed"].id) == -50_00  # I owe them
    assert category_balance_cents(db_session, h["meals"].id, as_of=DAY) == -50_00


def test_paid_by_without_a_split_is_refused(db_session):
    h = _household(db_session)
    client = _client(db_session)
    before = db_session.query(Transaction).count()
    try:
        response = client.post("/api/transactions", json=_body(
            [{"account_id": h["chequing"].id, "cents": -10_00}],
            [{"category_id": h["meals"].id, "cents": -10_00}],
            paid_by_payee_id=h["me"].id,
        ))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert "Paid by only applies to a shared bill" in response.json()["detail"]
    assert db_session.query(Transaction).count() == before


def test_paid_by_who_is_not_in_the_split_is_refused_and_so_is_an_unknown_split(db_session):
    h = _household(db_session)
    client = _client(db_session)
    lines = (
        [{"account_id": h["chequing"].id, "cents": -10_00}],
        [{"category_id": h["meals"].id, "cents": -10_00}],
    )
    before = db_session.query(Transaction).count()
    try:
        stranger = client.post("/api/transactions", json=_body(*lines, split_id=h["split"].id, paid_by_payee_id=h["stranger"].id))
        no_payer = client.post("/api/transactions", json=_body(*lines, split_id=h["split"].id))
        unknown = client.post("/api/transactions", json=_body(*lines, split_id=9999, paid_by_payee_id=h["me"].id))
    finally:
        app.dependency_overrides.clear()

    assert stranger.status_code == 400 and "not in that split" in stranger.json()["detail"]
    assert no_payer.status_code == 400 and "needs Paid by" in no_payer.json()["detail"]
    assert unknown.status_code == 400 and "Unknown split" in unknown.json()["detail"]
    assert db_session.query(Transaction).count() == before


def test_an_edit_stores_the_lines_as_sent_so_a_one_off_60_40_survives(db_session):
    h = _household(db_session)
    client = _client(db_session)
    try:
        created = client.post("/api/transactions", json=_body(
            [{"account_id": h["chequing"].id, "cents": -100_00}, {"account_id": h["owed"].id, "cents": 40_00}],
            [{"category_id": h["meals"].id, "cents": -60_00}],
            split_id=h["split"].id, paid_by_payee_id=h["me"].id,
        )).json()
        # The form rescaled by this bill's own 60/40, not the split's 50/50: $200 -> 120 / 80.
        edited = client.put(f"/api/transactions/{created['id']}", json=_body(
            [{"account_id": h["chequing"].id, "cents": -200_00}, {"account_id": h["owed"].id, "cents": 80_00}],
            [{"category_id": h["meals"].id, "cents": -120_00}],
            split_id=h["split"].id, paid_by_payee_id=h["me"].id,
        ))
    finally:
        app.dependency_overrides.clear()

    assert edited.status_code == 200
    assert [l["cents"] for l in edited.json()["category_lines"]] == [-120_00]
    assert sorted(l["cents"] for l in edited.json()["account_lines"]) == [-200_00, 80_00]
    assert edited.json()["split_id"] == h["split"].id


def test_changing_the_split_afterwards_does_not_touch_a_saved_bill_and_re_save_keeps_it(db_session):
    h = _household(db_session)
    client = _client(db_session)
    try:
        created = client.post("/api/transactions", json=_shared_meal(h)).json()
        db_session.query(SplitMember).update({"percent": 80})
        resaved = client.post(f"/api/transactions/{created['id']}/re-save")
    finally:
        app.dependency_overrides.clear()

    assert resaved.status_code == 200
    body = resaved.json()
    assert (body["split_id"], body["paid_by_payee_id"]) == (h["split"].id, h["me"].id)
    assert sorted(l["cents"] for l in body["account_lines"]) == [-100_00, 50_00]


def test_the_payee_list_marks_me(db_session):
    _household(db_session)
    client = _client(db_session)
    try:
        payees = client.get("/api/payees").json()
    finally:
        app.dependency_overrides.clear()

    assert {p["name"]: p["is_me"] for p in payees} == {"Me": True, "Roommate": False, "Stranger": False}


def _roommate_paid(h, total=90_00, share=30_00, **extra):
    return _body(
        [{"account_id": h["owed"].id, "cents": -share}],
        [{"category_id": h["meals"].id, "cents": -share}],
        split_id=h["split"].id, paid_by_payee_id=h["roommate"].id, shared_total_cents=total, **extra,
    )


def test_the_whole_bill_someone_else_paid_is_kept_and_edited_with_the_form_s_new_share(db_session):
    # Sam pays $90 at a third; the split later moves to 25/25; the form edits the total to $180
    # from the bill's own share ÷ total, so my share is $60 and the stored total follows.
    h = _household(db_session)
    client = _client(db_session)
    try:
        created = client.post("/api/transactions", json=_roommate_paid(h)).json()
        db_session.query(SplitMember).update({"percent": 25})
        edited = client.put(f"/api/transactions/{created['id']}", json=_roommate_paid(h, total=180_00, share=60_00))
    finally:
        app.dependency_overrides.clear()

    assert created["shared_total_cents"] == 90_00
    assert edited.status_code == 200
    body = edited.json()
    assert body["shared_total_cents"] == 180_00
    assert [l["cents"] for l in body["account_lines"]] == [-60_00]
    assert [l["cents"] for l in body["category_lines"]] == [-60_00]


def test_a_re_save_keeps_the_stored_total(db_session):
    h = _household(db_session)
    client = _client(db_session)
    try:
        created = client.post("/api/transactions", json=_roommate_paid(h)).json()
        resaved = client.post(f"/api/transactions/{created['id']}/re-save")
    finally:
        app.dependency_overrides.clear()

    assert resaved.status_code == 200
    assert resaved.json()["shared_total_cents"] == 90_00


def test_the_bill_total_is_refused_in_every_shape_it_does_not_belong_in(db_session):
    h = _household(db_session)
    client = _client(db_session)
    me_lines = [
        [{"account_id": h["chequing"].id, "cents": -100_00}, {"account_id": h["owed"].id, "cents": 50_00}],
        [{"category_id": h["meals"].id, "cents": -50_00}],
    ]
    try:
        with_me = client.post("/api/transactions", json=_shared_meal(h, shared_total_cents=100_00))
        no_split = client.post("/api/transactions", json=_body(*me_lines, shared_total_cents=100_00))
        missing = client.post("/api/transactions", json=_roommate_paid(h, total=None))
        negative = client.post("/api/transactions", json=_roommate_paid(h, total=-90_00))
    finally:
        app.dependency_overrides.clear()

    assert [r.status_code for r in (with_me, no_split, missing, negative)] == [400, 400, 400, 400]


def test_an_old_bill_with_no_total_still_edits_and_re_saves(db_session):
    h = _household(db_session)
    client = _client(db_session)
    try:
        old = client.post("/api/transactions", json=_roommate_paid(h)).json()
        db_session.get(Transaction, old["id"]).shared_total_cents = None  # recorded before the field existed
        db_session.flush()
        edited = client.put(f"/api/transactions/{old['id']}", json=_roommate_paid(h, total=None, share=40_00))
        resaved = client.post(f"/api/transactions/{old['id']}/re-save")
    finally:
        app.dependency_overrides.clear()

    assert (edited.status_code, resaved.status_code) == (200, 200)
    assert resaved.json()["shared_total_cents"] is None


def test_switching_paid_by_to_me_clears_the_total_and_back_sets_it(db_session):
    h = _household(db_session)
    client = _client(db_session)
    try:
        created = client.post("/api/transactions", json=_roommate_paid(h)).json()
        to_me = client.put(f"/api/transactions/{created['id']}", json=_shared_meal(h))
        back = client.put(f"/api/transactions/{created['id']}", json=_roommate_paid(h, total=120_00, share=40_00))
    finally:
        app.dependency_overrides.clear()

    assert to_me.json()["shared_total_cents"] is None
    assert back.json()["shared_total_cents"] == 120_00
