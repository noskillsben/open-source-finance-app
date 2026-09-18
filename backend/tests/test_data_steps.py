"""#42: backfilling the opening adjustment for accounts created before it existed, on a
populated database, idempotent on a second run (DESIGN.md § Opening balance and backfilling
history).
"""
import datetime

from sqlalchemy import select

from app.models import Account, AccountLine, Transaction, Valuation
from app.data_steps import backfill_opening_adjustments
from app.services.accounts import (
    _opening_adjustment_transaction,
    account_balance_cents,
    create_account_with_opening_valuation,
)

TODAY = datetime.date(2026, 3, 1)


def _account_with_only_a_valuation(session, name, *, balance_cents):
    """Simulate an account written before this issue: account + opening valuation, no
    adjustment transaction — the shape every pre-existing row is in.
    """
    account = Account(name=name, created_on=TODAY, type="Chequing", on_budget=True, on_budget_floor_cents=0)
    session.add(account)
    session.flush()
    session.add(Valuation(account_id=account.id, date=TODAY, balance_cents=balance_cents))
    session.flush()
    return account


def test_backfill_writes_the_missing_adjustment_on_a_populated_database(db_session):
    # The fixture runs against the real, already-populated database (CLAUDE.md: tests hit
    # real Postgres) — other accounts predating this issue may already need backfilling, so
    # this asserts on the two accounts under test, not on a global "exactly one" count.
    stale = _account_with_only_a_valuation(db_session, "Old Chequing", balance_cents=1_000_00)
    # An account created after this issue already has its adjustment — must be left alone.
    current = create_account_with_opening_valuation(
        db_session, name="New Savings", created_on=TODAY, type="Savings",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=250_00,
    )
    db_session.flush()

    written = backfill_opening_adjustments(db_session)
    db_session.flush()

    assert written >= 1
    stale_valuation = stale.valuations[0]
    txn = db_session.scalar(select(Transaction).where(Transaction.valuation_id == stale_valuation.id))
    assert txn is not None
    assert txn.date == TODAY
    assert txn.account_lines[0].cents == 1_000_00
    assert txn.category_lines == []
    assert account_balance_cents(db_session, stale.id) == 1_000_00

    current_lines = db_session.scalars(select(AccountLine).where(AccountLine.account_id == current.id)).all()
    assert len(current_lines) == 1  # already had its adjustment — backfill must not duplicate it
    assert account_balance_cents(db_session, current.id) == 250_00


def test_backfill_is_a_no_op_on_a_second_run(db_session):
    stale = _account_with_only_a_valuation(db_session, "Old Chequing", balance_cents=1_000_00)
    db_session.flush()

    first_run = backfill_opening_adjustments(db_session)
    db_session.flush()
    stale_written_by_first_run = db_session.scalar(
        select(Transaction.id).where(Transaction.valuation_id == stale.valuations[0].id)
    )
    second_run = backfill_opening_adjustments(db_session)
    db_session.flush()

    assert stale_written_by_first_run is not None
    assert second_run == 0  # every account already had its adjustment the second time around
    all_lines = db_session.scalars(select(AccountLine).where(AccountLine.account_id == stale.id)).all()
    assert len(all_lines) == 1  # writing it twice would double the balance
    assert account_balance_cents(db_session, stale.id) == 1_000_00


def test_backfill_step_and_opening_adjustment_transaction_agree_on_the_opening_valuation(db_session):
    """Two valuations share `created_on` — a balance check dated the account's start, run
    before this backfill step catches up. Both call sites must land on the same one: the
    earliest by (date, id), not whichever the row happens to be dated `created_on` (issue #67).
    """
    stale = _account_with_only_a_valuation(db_session, "Old Chequing", balance_cents=1_000_00)
    db_session.add(Valuation(account_id=stale.id, date=TODAY, balance_cents=1_000_00))
    db_session.flush()

    written = backfill_opening_adjustments(db_session)
    db_session.flush()

    assert written == 1  # only the true opening valuation gets an adjustment
    opening_valuation = min(stale.valuations, key=lambda v: v.id)
    txn = db_session.scalar(select(Transaction).where(Transaction.valuation_id == opening_valuation.id))
    assert txn is not None

    db_session.refresh(stale)
    assert _opening_adjustment_transaction(db_session, stale).id == txn.id
