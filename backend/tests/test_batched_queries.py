"""#440: ready to assign, the goal list and the account list read their numbers from a fixed number
of grouped queries, not a few per category / goal / account, and the batched numbers are exactly the
single-row functions' (which stay the definition for writes and archive checks).
"""
import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import get_session
from app.main import app
from app.models import Category, Goal, IncomeStream
from app.services.accounts import (
    account_balance_cents, carried_statement_note, create_account_with_opening_valuation,
)
from app.services.categories import (
    category_balance_cents, category_balances, category_month_cents, category_month_map,
    pool_absorber_name, pool_available_cents,
)
from app.services.earmarks import move_money, overspent_cents, ready_to_assign_cents
from app.services.goals import (
    bill_status, commitment_context, due_by_next_payday, earliest_unpaid_due_date, goal_progress,
    last_paid_text, set_aside_context,
)
from app.services.links import add_category_link, drift_cents, drift_note, linked_category_ids
from app.services.transactions import write_transaction
from app.services.valuations import check_balance, entries_added_since_check, latest_valuation

DAY = datetime.date(2026, 3, 1)
AS_OF = datetime.date(2026, 10, 26)


@pytest.fixture()
def client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


class Statements:
    """Counts the SQL statements a block sends on the test session's connection."""

    def __init__(self, db_session):
        self.connection = db_session.get_bind()
        self.count = 0

    def _hit(self, *args):
        self.count += 1

    def __enter__(self):
        event.listen(self.connection, "before_cursor_execute", self._hit)
        return self

    def __exit__(self, *exc):
        event.remove(self.connection, "before_cursor_execute", self._hit)


def _spend(db_session, account, category, cents, on):
    write_transaction(
        db_session, transaction=None, txn_date=on, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -cents}],
        category_lines=[{"category_id": category.id, "cents": -cents}],
    )


def build_world(db_session, n):
    """`n` categories each with money, spending and a goal of every kind in turn, a nested pool
    chain with an absorber, an overspent category, an archived category still holding money, a
    credit card carrying a statement, and a linked category with a balance check."""
    chequing = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=DAY, type="Chequing", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=5_000_000,
    )
    card = create_account_with_opening_valuation(
        db_session, name="Card", created_on=DAY, type="Credit card", on_budget=True,
        on_budget_floor_cents=0, opening_balance_cents=0,
    )
    card.statement_close_day = 15
    card.grace_days = 10
    create_account_with_opening_valuation(
        db_session, name="Mortgage", created_on=DAY, type="Mortgage", on_budget=False,
        on_budget_floor_cents=0, opening_balance_cents=-9_000_000,
    )
    income = Category(name="Salary income", created_on=DAY)
    db_session.add(income)
    db_session.flush()
    stream = IncomeStream(
        name="Salary", cadence="weeks", cadence_weeks=2, anchor_payday=datetime.date(2026, 3, 6),
        expected_net_low_cents=0, expected_net_high_cents=0, income_category_id=income.id,
        destination_account_id=chequing.id, created_on=DAY,
    )
    db_session.add(stream)

    big_pool = Category(name="Big pool", created_on=DAY, absorb_overspending=True)
    db_session.add(big_pool)
    db_session.flush()
    mid_pool = Category(name="Mid pool", created_on=DAY, pool_id=big_pool.id)
    db_session.add(mid_pool)
    db_session.flush()
    categories = []
    for i in range(n):
        category = Category(name=f"Cat {i:03d}", created_on=DAY, pool_id=mid_pool.id if i % 4 == 0 else None)
        db_session.add(category)
        categories.append(category)
    overspent = Category(name="Overspent", created_on=DAY)
    archived = Category(name="Archived with money", created_on=DAY)
    db_session.add_all([overspent, archived])
    db_session.flush()

    move_money(db_session, move_date=DAY, from_category_id=None, to_category_id=big_pool.id, cents=50_000)
    move_money(db_session, move_date=DAY, from_category_id=None, to_category_id=mid_pool.id, cents=20_000)
    for i, category in enumerate(categories):
        move_money(
            db_session, move_date=datetime.date(2026, 10, 3 if i % 2 else 20), from_category_id=None,
            to_category_id=category.id, cents=10_000 + i,
        )
        _spend(db_session, chequing, category, 3_000 + i, datetime.date(2026, 10, 10))
    _spend(db_session, chequing, overspent, 7_000, datetime.date(2026, 10, 12))
    move_money(db_session, move_date=DAY, from_category_id=None, to_category_id=archived.id, cents=4_321)
    archived.archived_on = datetime.date(2026, 9, 1)

    kinds = ["recurring_bill", "target", "commitment", "commitment", "recurring_bill", "commitment"]
    for i, category in enumerate(categories):
        kind = kinds[i % len(kinds)]
        bound = stream.id if i % 3 else None
        if kind == "recurring_bill":
            goal = Goal(
                category_id=category.id, name=f"Bill {i}", kind=kind, amount_cents=12_000, cadence="monthly",
                first_due_on=datetime.date(2026, 9, 5), income_stream_id=bound, created_on=DAY,
                set_aside_whole=bound is not None and i % 2 == 0,
            )
        elif kind == "target":
            goal = Goal(
                category_id=category.id, name=f"Target {i}", kind=kind, amount_cents=90_000, cadence="monthly",
                target_date=datetime.date(2027, 3, 1), income_stream_id=bound, created_on=DAY,
            )
        elif i % 2:
            goal = Goal(
                category_id=category.id, name=f"Commit {i}", kind=kind, amount_cents=20_000, cadence="monthly",
                first_due_on=datetime.date(2026, 11, 30), income_stream_id=bound, created_on=DAY,
            )
        else:
            goal = Goal(
                category_id=category.id, name=f"Commit {i}", kind=kind, amount_cents=5_000,
                income_stream_id=bound, created_on=DAY,
            )
        db_session.add(goal)
        db_session.flush()
        if kind == "recurring_bill" and i % 4 == 0:  # one payment already linked
            write_transaction(
                db_session, transaction=None, txn_date=datetime.date(2026, 9, 6), memo=None, payee_id=None,
                account_lines=[{"account_id": chequing.id, "cents": -11_000}],
                category_lines=[{"category_id": category.id, "cents": -11_000}],
                goal_id=goal.id, goal_due_on=datetime.date(2026, 9, 5),
            )

    # The card owes money across a statement and has paid some since; two categories link to chequing.
    _spend(db_session, card, big_pool, 23_000, datetime.date(2026, 9, 1))
    write_transaction(
        db_session, transaction=None, txn_date=datetime.date(2026, 10, 1), memo=None, payee_id=None,
        account_lines=[{"account_id": card.id, "cents": 5_000}, {"account_id": chequing.id, "cents": -5_000}],
        category_lines=[],
    )
    add_category_link(db_session, categories[0].id, chequing.id)
    add_category_link(db_session, big_pool.id, chequing.id)
    check_balance(
        db_session, account_id=chequing.id, check_date=datetime.date(2026, 10, 20),
        stated_balance_cents=4_000_000, category_id=None,
    )
    db_session.flush()
    return chequing


def _statements(db_session, client, path, **params):
    with Statements(db_session) as counter:
        response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return counter.count, response.json()


@pytest.mark.parametrize("path", ["/api/ready-to-assign", "/api/goals", "/api/accounts"])
def test_statement_count_does_not_grow_with_rows(client, db_session, path):
    build_world(db_session, 5)
    few, _ = _statements(db_session, client, path, as_of=AS_OF.isoformat())
    for i in range(5, 50):
        db_session.add(Category(name=f"Cat {i:03d}", created_on=DAY))
    db_session.flush()
    # Grow every row source, not just categories: more goals and more accounts too.
    for i in range(45):
        category = db_session.query(Category).filter(Category.name == f"Cat {i + 5:03d}").one()
        db_session.add(Goal(
            category_id=category.id, name=f"G{i}", kind="commitment", amount_cents=1_000, cadence="monthly",
            first_due_on=datetime.date(2026, 11, 30), created_on=DAY,
        ))
        create_account_with_opening_valuation(
            db_session, name=f"Extra {i}", created_on=DAY, type="Savings", on_budget=True,
            on_budget_floor_cents=0, opening_balance_cents=1_000,
        )
    db_session.flush()
    many, _ = _statements(db_session, client, path, as_of=AS_OF.isoformat())
    assert many == few
    assert few < 40  # a fixed handful, not the per-row cost it replaced


def test_ready_to_assign_matches_the_per_category_functions(client, db_session):
    build_world(db_session, 12)
    _, body = _statements(db_session, client, "/api/ready-to-assign", as_of=AS_OF.isoformat())

    ids = [c.id for c in db_session.query(Category).order_by(Category.id)]
    assert [row["category_id"] for row in body["categories"]] == ids
    for row in body["categories"]:
        cid = row["category_id"]
        assigned, spent = category_month_cents(db_session, cid, as_of=AS_OF)
        assert row["available_cents"] == category_balance_cents(db_session, cid, as_of=AS_OF)
        assert (row["assigned_cents"], row["spent_cents"]) == (assigned, spent)
        assert row["pool_available_cents"] == pool_available_cents(db_session, cid, as_of=AS_OF)
        assert row["pool_absorber"] == pool_absorber_name(db_session, cid, as_of=AS_OF)
    assert body["ready_to_assign_cents"] == _reference_ready_to_assign(db_session)
    assert body["overspent_cents"] == sum(
        b for b in (category_balance_cents(db_session, c, as_of=AS_OF) for c in ids) if b < 0
    )
    assert body["overspent_cents"] == overspent_cents(db_session, as_of=AS_OF) < 0
    # The fixture really holds the awkward cases.
    absorbers = {row["pool_absorber"] for row in body["categories"]}
    assert "Big pool" in absorbers
    assert any(row["pool_available_cents"] > 0 for row in body["categories"])
    archived = db_session.query(Category).filter(Category.name == "Archived with money").one()
    assert next(r for r in body["categories"] if r["category_id"] == archived.id)["available_cents"] == 4_321


def _reference_ready_to_assign(db_session):
    from sqlalchemy import select
    from app.models import Account
    from app.services.accounts import on_budget_cents

    on_budget_total = sum(
        on_budget_cents(account_balance_cents(db_session, a.id, as_of=AS_OF), a.on_budget_floor_cents)
        for a in db_session.scalars(select(Account).where(Account.on_budget.is_(True)))
    )
    return on_budget_total - sum(
        category_balance_cents(db_session, c, as_of=AS_OF) for c in db_session.scalars(select(Category.id))
    )


def test_batched_balances_and_month_equal_the_single_category_definitions(db_session):
    build_world(db_session, 12)
    balances = category_balances(db_session, as_of=AS_OF)
    month = category_month_map(db_session, as_of=AS_OF)
    for category in db_session.query(Category):
        assert balances[category.id] == category_balance_cents(db_session, category.id, as_of=AS_OF)
        assert month[category.id] == category_month_cents(db_session, category.id, as_of=AS_OF)
    assert ready_to_assign_cents(db_session, as_of=AS_OF) == _reference_ready_to_assign(db_session)


def test_goal_rows_equal_the_single_goal_functions(client, db_session):
    build_world(db_session, 18)
    _, rows = _statements(db_session, client, "/api/goals", as_of=AS_OF.isoformat())
    assert len(rows) == 18

    from app.services.goals import unbound_bill_horizon
    horizon = unbound_bill_horizon(db_session, as_of=AS_OF)
    seen = set()
    for row in rows:
        goal = db_session.get(Goal, row["goal"]["id"])
        stream = db_session.get(IncomeStream, goal.income_stream_id) if goal.income_stream_id else None
        progress = goal_progress(db_session, goal, as_of=AS_OF, stream=stream)
        for field, value in vars(progress).items():
            expected = value.isoformat() if isinstance(value, datetime.date) else value
            assert row[field] == expected, (goal.name, field)
        if stream is not None:
            assert row["due_by_next_payday_cents"] == due_by_next_payday(db_session, goal, stream, as_of=AS_OF)
            expected_context = commitment_context(db_session, goal, stream, as_of=AS_OF) or set_aside_context(
                db_session, goal, stream, as_of=AS_OF
            )
            assert row["context_text"] == expected_context
        else:
            assert row["due_by_next_payday_cents"] is None and row["context_text"] is None
        status = bill_status(
            db_session, goal, as_of=AS_OF, stream=stream, horizon=horizon, balance_cents=progress.balance_cents
        )
        assert (row["bill_status"], row["bill_status_text"]) == (status if status else (None, None))
        earliest = earliest_unpaid_due_date(db_session, goal)
        assert row["earliest_unpaid_due_on"] == (earliest.isoformat() if earliest else None)
        last = last_paid_text(db_session, goal, as_of=AS_OF) if goal.kind == "recurring_bill" else None
        assert row["last_paid_text"] == (last[2] if last else None)
        assert row["last_paid_cents"] == (last[1] if last else None)
        seen.add((goal.kind, stream is not None, last is not None))
    # Bills with and without a payment, bound and unbound, and commitments were all exercised.
    assert ("recurring_bill", True, True) in seen and ("recurring_bill", False, False) in seen
    assert any(kind == "commitment" for kind, _, _ in seen)
    assert any(row["commitment_progress_text"] for row in rows)


def test_account_rows_equal_the_single_account_functions(client, db_session):
    build_world(db_session, 6)
    for as_of in (AS_OF, None):
        params = {"as_of": AS_OF.isoformat()} if as_of else {}
        _, rows = _statements(db_session, client, "/api/accounts", **params)
        from app.models import Account
        assert {r["name"] for r in rows} >= {"Chequing", "Card", "Mortgage"}
        for row in rows:
            account = db_session.get(Account, row["id"])
            balance = account_balance_cents(db_session, account.id, as_of=as_of)
            valuation = latest_valuation(db_session, account.id, as_of=as_of)
            assert row["balance_cents"] == balance
            assert row["checked_on"] == (valuation.date.isoformat() if valuation else None)
            assert row["checked_valuation_id"] == (valuation.id if valuation else None)
            assert row["entries_added_since_check"] == (
                entries_added_since_check(db_session, account.id, valuation) if valuation else 0
            )
            assert row["linked_category_ids"] == linked_category_ids(db_session, account.id)
            expected_notes = []
            carried = carried_statement_note(db_session, account, as_of)
            if account.credit_limit_cents is not None and balance < -account.credit_limit_cents:
                expected_notes.append("This balance is past the credit limit.")
            if carried:
                expected_notes.append(carried)
            drifting = drift_note(db_session, account, drift_cents(db_session, account.id, as_of=as_of))
            if drifting:
                expected_notes.append(drifting)
            assert row["notes"] == expected_notes, (account.name, as_of)
        if as_of is not None:
            notes = {r["name"]: r["notes"] for r in rows}
    assert any("Carrying" in n for n in notes["Card"])
    assert any("not claimed" in n or "more than" in n for n in notes["Chequing"])
