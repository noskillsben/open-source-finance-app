"""Account math and the write path shared by create and edit (DESIGN.md § On-budget floor,
§ Balance checks — one table).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, AccountLine, Transaction, Valuation


def on_budget_cents(balance_cents: int, floor_cents: int) -> int:
    """How far above the floor the balance sits — this account's on-budget money."""
    return max(balance_cents, floor_cents) - floor_cents


def tracked_debt_cents(balance_cents: int, floor_cents: int) -> int:
    """How far below the floor the balance sits — debt the app tracks but doesn't budget with."""
    return min(balance_cents - floor_cents, 0)


def create_account_with_opening_valuation(
    session: Session,
    *,
    name: str,
    created_on: date,
    type: str,
    on_budget: bool,
    on_budget_floor_cents: int,
    opening_balance_cents: int,
    **terms: object,
) -> Account:
    """Write the account and its opening valuation together — the opening balance is the
    account's first valuation, dated its created_on (DESIGN.md § Opening balance and
    backfilling history). The adjustment transaction that makes the ledger agree with it
    is not written here: transactions don't exist yet (#9); wiring it in is a fast-follow.
    """
    account = Account(
        name=name,
        created_on=created_on,
        type=type,
        on_budget=on_budget,
        on_budget_floor_cents=on_budget_floor_cents,
        **terms,
    )
    session.add(account)
    session.flush()  # assigns account.id for the valuation's FK

    session.add(Valuation(account_id=account.id, date=created_on, balance_cents=opening_balance_cents))
    session.flush()
    return account


def account_balance_cents(
    session: Session,
    account_id: int,
    *,
    as_of: date | None = None,
    exclude_transaction_id: int | None = None,
) -> int:
    """No stored balances (DESIGN.md § General concepts): sum the opening valuation and every
    ledger line dated on or before `as_of` (all of them when `as_of` is None). Only one
    valuation exists per account until balance checks are built (see
    `create_account_with_opening_valuation`); summing them will need revisiting then.
    `exclude_transaction_id` leaves one transaction's own lines out, for computing the
    balance a transaction is being written or edited against.
    """
    valuation_stmt = select(func.coalesce(func.sum(Valuation.balance_cents), 0)).where(
        Valuation.account_id == account_id
    )
    if as_of is not None:
        valuation_stmt = valuation_stmt.where(Valuation.date <= as_of)

    line_stmt = (
        select(func.coalesce(func.sum(AccountLine.cents), 0))
        .join(Transaction, AccountLine.transaction_id == Transaction.id)
        .where(AccountLine.account_id == account_id)
    )
    if as_of is not None:
        line_stmt = line_stmt.where(Transaction.date <= as_of)
    if exclude_transaction_id is not None:
        line_stmt = line_stmt.where(AccountLine.transaction_id != exclude_transaction_id)

    return session.scalar(valuation_stmt) + session.scalar(line_stmt)
