"""DESIGN.md § Splits: a split's members are the other people; the members may not exceed 100%
(a settings-surface block); a person's account is created on their first membership and reused
after that; splits and members are archived, never deleted.
"""
import datetime

from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.models import Account, Payee, Split, SplitMember
from app.services.accounts import create_account_with_opening_valuation

DAY = datetime.date(2026, 3, 1)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def _payee(db_session, name):
    payee = Payee(name=name, created_on=DAY)
    db_session.add(payee)
    db_session.flush()
    return payee


def _create(client, name, members, **extra):
    return client.post(
        "/api/splits",
        json={"name": name, "created_on": DAY.isoformat(), "members": members, **extra},
    )


def _live_accounts(db_session, name):
    return db_session.query(Account).filter(Account.name == name, Account.archived_on.is_(None)).all()


def test_exactly_100_percent_is_accepted_and_over_100_is_refused(db_session):
    sam, kit = _payee(db_session, "Sam"), _payee(db_session, "Kit")
    client = _client(db_session)
    try:
        ok = _create(client, "Everything", [{"payee_id": sam.id, "percent": "60"}, {"payee_id": kit.id, "percent": "40"}])
        over = _create(client, "Too much", [{"payee_id": sam.id, "percent": "60.0001"}, {"payee_id": kit.id, "percent": "40"}])
    finally:
        app.dependency_overrides.clear()

    assert ok.status_code == 201
    assert ok.json()["my_share_percent"] == "0.0000"
    assert over.status_code == 400
    assert "more than 100%" in over.json()["detail"]
    assert db_session.query(Split).filter(Split.name == "Too much").count() == 0


def test_percent_is_stored_half_even_at_four_places_and_the_limit_uses_the_stored_value(db_session):
    sam = _payee(db_session, "Sam")
    kit = _payee(db_session, "Kit")
    client = _client(db_session)
    try:
        # 50.00005 rounds half-even to 50.0000, so 50.00005 + 50 is exactly 100, not over.
        ok = _create(client, "Edge", [{"payee_id": sam.id, "percent": "50.00005"}, {"payee_id": kit.id, "percent": "50"}])
    finally:
        app.dependency_overrides.clear()

    assert ok.status_code == 201
    assert [m["percent"] for m in ok.json()["members"]] == ["50.0000", "50.0000"]


def test_a_percent_of_zero_or_less_is_refused(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        zero = _create(client, "Nothing", [{"payee_id": sam.id, "percent": "0"}])
        negative = _create(client, "Negative", [{"payee_id": sam.id, "percent": "-5"}])
    finally:
        app.dependency_overrides.clear()

    assert zero.status_code == 400 and negative.status_code == 400


def test_my_share_is_what_the_members_leave(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        response = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}])
    finally:
        app.dependency_overrides.clear()

    assert response.json()["my_share_percent"] == "50.0000"


def test_first_membership_creates_an_on_budget_account_and_the_second_split_reuses_it(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        rent = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        groceries = _create(client, "Groceries", [{"payee_id": sam.id, "percent": "30"}]).json()
    finally:
        app.dependency_overrides.clear()

    accounts = _live_accounts(db_session, "Sam")
    assert len(accounts) == 1  # one person, one balance
    assert accounts[0].on_budget is True and accounts[0].created_on == DAY
    assert rent["members"][0]["account_id"] == groceries["members"][0]["account_id"] == accounts[0].id
    assert rent["members"][0]["account_name"] == "Sam"


def test_an_existing_account_can_be_picked_for_a_member(db_session):
    sam = _payee(db_session, "Sam")
    owed = create_account_with_opening_valuation(
        db_session, name="Owed by Sam", created_on=DAY, type="Cash", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=12_00,
    )
    client = _client(db_session)
    try:
        response = _create(client, "Rent", [{"payee_id": sam.id, "account_id": owed.id, "percent": "50"}])
        other = _create(client, "Groceries", [{"payee_id": sam.id, "percent": "30"}])
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["members"][0]["account_id"] == owed.id
    assert _live_accounts(db_session, "Sam") == []  # no second account was made
    assert other.json()["members"][0]["account_id"] == owed.id  # and the next split reuses the one picked


def test_a_person_with_a_balance_cannot_be_given_a_different_account(db_session):
    sam = _payee(db_session, "Sam")
    other = create_account_with_opening_valuation(
        db_session, name="Another", created_on=DAY, type="Cash", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=0,
    )
    client = _client(db_session)
    try:
        _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}])
        refused = _create(client, "Groceries", [{"payee_id": sam.id, "account_id": other.id, "percent": "30"}])
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400
    assert "one person, one balance" in refused.json()["detail"]


def test_a_taken_account_name_asks_you_to_pick_it_instead_of_creating_a_second(db_session):
    sam = _payee(db_session, "Sam")
    create_account_with_opening_valuation(
        db_session, name="sam", created_on=DAY, type="Cash", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=0,
    )
    client = _client(db_session)
    try:
        refused = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}])
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 409
    assert "Pick it" in refused.json()["detail"]


def test_me_cannot_be_a_member(db_session):
    me = _payee(db_session, "Me")
    me.seeded_key = "payee:me"
    db_session.flush()
    client = _client(db_session)
    try:
        refused = _create(client, "Self", [{"payee_id": me.id, "percent": "50"}])
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400


def test_the_same_person_twice_in_one_split_is_refused(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        refused = _create(client, "Twice", [{"payee_id": sam.id, "percent": "10"}, {"payee_id": sam.id, "percent": "10"}])
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400


def test_a_duplicate_live_name_is_refused_case_insensitively_and_an_archived_name_is_reusable(db_session):
    client = _client(db_session)
    try:
        first = _create(client, "Rent", []).json()
        duplicate = _create(client, "rent", [])
        archived = client.post(f"/api/splits/{first['id']}/archive", json={"archived_on": "2026-04-01"})
        reused = _create(client, "RENT", [])
        unarchive = client.post(f"/api/splits/{first['id']}/unarchive")
    finally:
        app.dependency_overrides.clear()

    assert duplicate.status_code == 409
    assert archived.status_code == 200
    assert reused.status_code == 201
    assert unarchive.status_code == 409  # the name is taken now


def test_archiving_a_split_archives_its_members_and_unarchiving_brings_them_back(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        client.post(f"/api/splits/{split['id']}/archive", json={"archived_on": "2026-04-01"})
        live = client.get("/api/splits").json()
        archived = client.get("/api/splits", params={"include_archived": "true"}).json()
        client.post(f"/api/splits/{split['id']}/unarchive")
        after = client.get("/api/splits").json()
    finally:
        app.dependency_overrides.clear()

    assert live == []
    assert archived[0]["archived_on"] == "2026-04-01" and len(archived[0]["members"]) == 1
    assert [m["payee_name"] for m in after[0]["members"]] == ["Sam"]
    assert db_session.query(SplitMember).count() == 1  # archived, never deleted


def test_editing_changes_percents_and_archives_a_removed_member(db_session):
    sam, kit = _payee(db_session, "Sam"), _payee(db_session, "Kit")
    client = _client(db_session)
    try:
        split = _create(
            client, "Rent", [{"payee_id": sam.id, "percent": "50"}, {"payee_id": kit.id, "percent": "20"}]
        ).json()
        edited = client.put(
            f"/api/splits/{split['id']}",
            json={"name": "Rent", "as_of": "2026-05-01", "members": [{"payee_id": sam.id, "percent": "40"}]},
        )
    finally:
        app.dependency_overrides.clear()

    assert edited.status_code == 200
    assert [(m["payee_name"], m["percent"]) for m in edited.json()["members"]] == [("Sam", "40.0000")]
    assert edited.json()["my_share_percent"] == "60.0000"
    kit_member = db_session.query(SplitMember).filter(SplitMember.payee_id == kit.id).one()
    assert kit_member.archived_on == datetime.date(2026, 5, 1)  # archived, not deleted; the account stays
    assert db_session.get(Account, kit_member.account_id).archived_on is None


def test_editing_over_100_is_refused_and_leaves_the_split_as_it_was(db_session):
    sam, kit = _payee(db_session, "Sam"), _payee(db_session, "Kit")
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        refused = client.put(
            f"/api/splits/{split['id']}",
            json={"name": "Rent", "as_of": "2026-05-01", "members": [
                {"payee_id": sam.id, "percent": "70"}, {"payee_id": kit.id, "percent": "40"}]},
        )
        listed = client.get("/api/splits").json()
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400
    assert [m["percent"] for m in listed[0]["members"]] == ["50.0000"]
    assert db_session.query(Account).filter(Account.name == "Kit").count() == 0


def test_editing_refuses_a_different_account_for_an_existing_member(db_session):
    sam = _payee(db_session, "Sam")
    other = create_account_with_opening_valuation(
        db_session, name="Another", created_on=DAY, type="Cash", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=0,
    )
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        refused = client.put(
            f"/api/splits/{split['id']}",
            json={"name": "Rent", "as_of": "2026-05-01",
                  "members": [{"payee_id": sam.id, "account_id": other.id, "percent": "40"}]},
        )
        listed = client.get("/api/splits").json()
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400
    assert "can't be changed" in refused.json()["detail"]
    assert listed[0]["members"][0]["account_id"] == split["members"][0]["account_id"]
    assert listed[0]["members"][0]["percent"] == "50.0000"  # nothing was written


def test_editing_with_the_members_unchanged_account_succeeds(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        account_id = split["members"][0]["account_id"]
        edited = client.put(
            f"/api/splits/{split['id']}",
            json={"name": "Rent", "as_of": "2026-05-01",
                  "members": [{"payee_id": sam.id, "account_id": account_id, "percent": "40"}]},
        )
    finally:
        app.dependency_overrides.clear()

    assert edited.status_code == 200
    assert edited.json()["members"][0]["percent"] == "40.0000"
    assert edited.json()["members"][0]["account_id"] == account_id
