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


def _bill(db_session, on, split_id=None, payee_id=None, paid_by_payee_id=None):
    from app.services.transactions import write_transaction

    account = db_session.query(Account).filter(Account.name == "Chequing").first()
    if account is None:
        account = create_account_with_opening_valuation(
            db_session, name="Chequing", created_on=DAY, type="Chequing",
            on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
        )
    txn = write_transaction(
        db_session, transaction=None, txn_date=on, memo=None, payee_id=payee_id,
        account_lines=[{"account_id": account.id, "cents": -10_00}], category_lines=[],
    )
    txn.split_id, txn.paid_by_payee_id = split_id, paid_by_payee_id
    db_session.flush()


def test_a_split_cannot_be_archived_on_or_before_the_date_of_a_bill_that_used_it(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        _bill(db_session, datetime.date(2026, 5, 10), split_id=split["id"])
        same_day = client.post(f"/api/splits/{split['id']}/archive", json={"archived_on": "2026-05-10"})
        before = client.post(f"/api/splits/{split['id']}/archive", json={"archived_on": "2026-05-01"})
        next_day = client.post(f"/api/splits/{split['id']}/archive", json={"archived_on": "2026-05-11"})
    finally:
        app.dependency_overrides.clear()

    assert same_day.status_code == 400 and "2026-05-10" in same_day.json()["detail"]
    assert before.status_code == 400
    assert next_day.status_code == 200
    assert next_day.json()["archived_on"] == "2026-05-11"


def test_a_split_with_no_bills_archives_with_its_members(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        response = client.post(f"/api/splits/{split['id']}/archive", json={"archived_on": "2026-03-01"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    member = db_session.query(SplitMember).one()
    assert member.archived_on == datetime.date(2026, 3, 1)


def test_a_member_archived_earlier_keeps_its_own_date_through_archive_and_unarchive(db_session):
    sam, kit = _payee(db_session, "Sam"), _payee(db_session, "Kit")
    client = _client(db_session)
    try:
        split = _create(
            client, "Rent", [{"payee_id": sam.id, "percent": "50"}, {"payee_id": kit.id, "percent": "20"}]
        ).json()
        client.put(
            f"/api/splits/{split['id']}",
            json={"name": "Rent", "as_of": "2026-05-01", "members": [{"payee_id": sam.id, "percent": "50"}]},
        )
        client.post(f"/api/splits/{split['id']}/archive", json={"archived_on": "2026-06-01"})
        kit_member = db_session.query(SplitMember).filter(SplitMember.payee_id == kit.id).one()
        sam_member = db_session.query(SplitMember).filter(SplitMember.payee_id == sam.id).one()
        archived_dates = (kit_member.archived_on, sam_member.archived_on)
        client.post(f"/api/splits/{split['id']}/unarchive")
        db_session.refresh(kit_member)
        db_session.refresh(sam_member)
    finally:
        app.dependency_overrides.clear()

    assert archived_dates == (datetime.date(2026, 5, 1), datetime.date(2026, 6, 1))
    assert kit_member.archived_on == datetime.date(2026, 5, 1)
    assert sam_member.archived_on is None


def _member_account_id(db_session, payee_id):
    return db_session.query(SplitMember).filter(SplitMember.payee_id == payee_id).first().account_id


def test_a_payee_in_a_live_split_cannot_be_archived_until_taken_out(db_session):
    sam, kit = _payee(db_session, "Sam"), _payee(db_session, "Kit")
    client = _client(db_session)
    try:
        split = _create(
            client, "Household", [{"payee_id": sam.id, "percent": "50"}, {"payee_id": kit.id, "percent": "20"}]
        ).json()
        refused = client.post(f"/api/payees/{sam.id}/archive", json={"archived_on": "2026-06-01"})
        client.put(
            f"/api/splits/{split['id']}",
            json={"name": "Household", "as_of": "2026-05-01", "members": [{"payee_id": kit.id, "percent": "20"}]},
        )
        allowed = client.post(f"/api/payees/{sam.id}/archive", json={"archived_on": "2026-06-01"})
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400
    assert refused.json()["detail"] == "Sam is in Household. Take them out of the split first."
    assert allowed.status_code == 200


def test_an_account_holding_a_members_balance_cannot_be_archived_until_taken_out(db_session):
    sam, kit = _payee(db_session, "Sam"), _payee(db_session, "Kit")
    client = _client(db_session)
    try:
        split = _create(
            client, "Household", [{"payee_id": sam.id, "percent": "50"}, {"payee_id": kit.id, "percent": "20"}]
        ).json()
        account_id = _member_account_id(db_session, sam.id)
        refused = client.post(f"/api/accounts/{account_id}/archive", json={"archived_on": "2026-06-01"})
        client.put(
            f"/api/splits/{split['id']}",
            json={"name": "Household", "as_of": "2026-05-01", "members": [{"payee_id": kit.id, "percent": "20"}]},
        )
        allowed = client.post(f"/api/accounts/{account_id}/archive", json={"archived_on": "2026-06-01"})
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400
    assert refused.json()["detail"] == "Sam is in Household. Take them out of the split first."
    assert allowed.status_code == 200


def test_an_archived_split_no_longer_holds_its_members(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        split = _create(client, "Household", [{"payee_id": sam.id, "percent": "50"}]).json()
        account_id = _member_account_id(db_session, sam.id)
        client.post(f"/api/splits/{split['id']}/archive", json={"archived_on": "2026-06-01"})
        payee = client.post(f"/api/payees/{sam.id}/archive", json={"archived_on": "2026-06-01"})
        account = client.post(f"/api/accounts/{account_id}/archive", json={"archived_on": "2026-06-01"})
    finally:
        app.dependency_overrides.clear()

    assert payee.status_code == 200 and account.status_code == 200


def test_two_live_splits_are_both_named(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}])
        _create(client, "Groceries", [{"payee_id": sam.id, "percent": "50"}])
        account_id = _member_account_id(db_session, sam.id)
        payee = client.post(f"/api/payees/{sam.id}/archive", json={"archived_on": "2026-06-01"})
        account = client.post(f"/api/accounts/{account_id}/archive", json={"archived_on": "2026-06-01"})
    finally:
        app.dependency_overrides.clear()

    expected = "Sam is in Groceries and Rent. Take them out of the splits first."
    assert payee.status_code == account.status_code == 400
    assert payee.json()["detail"] == account.json()["detail"] == expected


# --- Notes for people leaving a split (DESIGN.md § Splits → The Splits page) ---------------------


def _owed(db_session, name, cents):
    return create_account_with_opening_valuation(
        db_session, name=name, created_on=DAY, type="Cash", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=cents,
    )


def _edit(client, split, members, as_of="2026-05-01"):
    return client.put(
        f"/api/splits/{split['id']}", json={"name": split["name"], "as_of": as_of, "members": members}
    )


def test_removing_a_member_who_owes_you_and_is_in_no_other_split_says_so(db_session):
    sam = _payee(db_session, "Sam")
    owed = _owed(db_session, "Sam", 60_00)
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "account_id": owed.id, "percent": "50"}]).json()
        edited = _edit(client, split, [])
    finally:
        app.dependency_overrides.clear()

    assert edited.status_code == 200
    assert edited.json()["warnings"] == ["Sam still owes you $60.00; their balance stays on Accounts."]
    assert db_session.query(SplitMember).one().archived_on == datetime.date(2026, 5, 1)  # saved all the same


def test_a_negative_balance_is_worded_from_the_other_side(db_session):
    sam = _payee(db_session, "Sam")
    owed = _owed(db_session, "Sam", -60_00)
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "account_id": owed.id, "percent": "50"}]).json()
        edited = _edit(client, split, [])
    finally:
        app.dependency_overrides.clear()

    assert edited.json()["warnings"] == ["You still owe Sam $60.00; their balance stays on Accounts."]


def test_no_note_when_the_member_is_still_in_another_live_split_or_owes_nothing(db_session):
    sam, kit = _payee(db_session, "Sam"), _payee(db_session, "Kit")
    sam_account, kit_account = _owed(db_session, "Sam", 60_00), _owed(db_session, "Kit", 0)
    client = _client(db_session)
    try:
        rent = _create(client, "Rent", [
            {"payee_id": sam.id, "account_id": sam_account.id, "percent": "30"},
            {"payee_id": kit.id, "account_id": kit_account.id, "percent": "30"},
        ]).json()
        _create(client, "Trips", [{"payee_id": sam.id, "percent": "40"}])
        edited = _edit(client, rent, [])
    finally:
        app.dependency_overrides.clear()

    assert edited.status_code == 200
    assert edited.json()["warnings"] == []  # Sam is in Trips; Kit owes nothing


def test_a_refused_edit_returns_no_notes(db_session):
    sam, kit = _payee(db_session, "Sam"), _payee(db_session, "Kit")
    owed = _owed(db_session, "Sam", 60_00)
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "account_id": owed.id, "percent": "50"}]).json()
        refused = _edit(client, split, [{"payee_id": kit.id, "percent": "101"}])
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400
    assert "warnings" not in refused.json()


def test_archiving_a_split_gives_one_note_per_member_who_leaves_with_a_balance(db_session):
    sam, kit, lee = _payee(db_session, "Sam"), _payee(db_session, "Kit"), _payee(db_session, "Lee")
    accounts = {"Sam": _owed(db_session, "Sam", 60_00), "Kit": _owed(db_session, "Kit", -5_00), "Lee": _owed(db_session, "Lee", 0)}
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [
            {"payee_id": p.id, "account_id": accounts[p.name].id, "percent": "20"} for p in (sam, kit, lee)
        ]).json()
        archived = client.post(f"/api/splits/{split['id']}/archive", json={"archived_on": "2026-05-01"})
    finally:
        app.dependency_overrides.clear()

    assert archived.status_code == 200
    assert archived.json()["warnings"] == [
        "You still owe Kit $5.00; their balance stays on Accounts.",
        "Sam still owes you $60.00; their balance stays on Accounts.",
    ]


# --- Someone added back keeps their old account (DESIGN.md § Splits → One person, one balance) -----


def test_someone_taken_out_of_every_split_and_added_back_keeps_their_account(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        old_account = split["members"][0]["account_id"]
        _edit(client, split, [])
        back = _edit(client, split, [{"payee_id": sam.id, "percent": "40"}])
    finally:
        app.dependency_overrides.clear()

    assert back.status_code == 200
    live = [m for m in back.json()["members"] if m["payee_id"] == sam.id and m.get("archived_on") is None]
    assert [m["account_id"] for m in live] == [old_account]
    assert len(_live_accounts(db_session, "Sam")) == 1


def test_an_archived_old_account_is_not_brought_back(db_session):
    sam = _payee(db_session, "Sam")
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        old_id = split["members"][0]["account_id"]
        _edit(client, split, [])
        db_session.get(Account, old_id).archived_on = datetime.date(2026, 5, 2)
        db_session.flush()
        _owed(db_session, "Sam", 0)
        # The name is taken by a live account, so today's 409 stands.
        taken = _edit(client, split, [{"payee_id": sam.id, "percent": "40"}])
        db_session.query(Account).filter(Account.archived_on.is_(None), Account.name == "Sam").one().name = "Elsewhere"
        db_session.flush()
        back = _edit(client, split, [{"payee_id": sam.id, "percent": "40"}])
    finally:
        app.dependency_overrides.clear()

    assert back.status_code == 200
    assert back.json()["members"][0]["account_id"] != old_id  # a new account, as before
    assert taken.status_code == 409


def test_a_live_membership_elsewhere_beats_a_past_one(db_session):
    sam = _payee(db_session, "Sam")
    past, current = _owed(db_session, "Sam past", 0), _owed(db_session, "Sam now", 0)
    rent = Split(name="Rent", created_on=DAY)
    trips = Split(name="Trips", created_on=DAY)
    db_session.add_all([rent, trips])
    db_session.flush()
    # Older data can hold two accounts for one person; the live one is the one that counts.
    db_session.add_all([
        SplitMember(split_id=rent.id, payee_id=sam.id, account_id=past.id, percent=50, created_on=DAY,
                    archived_on=datetime.date(2026, 4, 1)),
        SplitMember(split_id=trips.id, payee_id=sam.id, account_id=current.id, percent=40,
                    created_on=datetime.date(2026, 3, 15)),
    ])
    db_session.flush()
    client = _client(db_session)
    try:
        back = _edit(client, {"id": rent.id, "name": "Rent"}, [{"payee_id": sam.id, "percent": "30"}])
        refused = _edit(client, {"id": rent.id, "name": "Rent"},
                        [{"payee_id": sam.id, "account_id": past.id, "percent": "30"}])
    finally:
        app.dependency_overrides.clear()

    assert back.status_code == 200
    assert {m["account_id"] for m in back.json()["members"]} == {current.id}
    assert refused.status_code == 400


def test_a_different_account_for_a_returning_member_is_refused(db_session):
    sam = _payee(db_session, "Sam")
    other = _owed(db_session, "Another", 0)
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "percent": "50"}]).json()
        _edit(client, split, [])
        refused = _edit(client, split, [{"payee_id": sam.id, "account_id": other.id, "percent": "50"}])
    finally:
        app.dependency_overrides.clear()

    assert refused.status_code == 400
    assert "one person, one balance" in refused.json()["detail"]


def test_the_leaving_note_still_appears_for_someone_with_a_past_membership(db_session):
    sam = _payee(db_session, "Sam")
    owed = _owed(db_session, "Sam", 60_00)
    client = _client(db_session)
    try:
        split = _create(client, "Rent", [{"payee_id": sam.id, "account_id": owed.id, "percent": "50"}]).json()
        _edit(client, split, [])
        _edit(client, split, [{"payee_id": sam.id, "percent": "50"}])
        leaving = _edit(client, split, [])
    finally:
        app.dependency_overrides.clear()

    assert leaving.json()["warnings"] == ["Sam still owes you $60.00; their balance stays on Accounts."]
