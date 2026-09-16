"""Account math and the write path shared by create and edit (DESIGN.md § On-budget floor,
§ Balance checks — one table).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, AccountLine, Transaction, Valuation


def _opening_adjustment_transaction(session: Session, account: Account) -> Transaction | None:
    """The transaction that made the ledger agree with this account's opening valuation
    (DESIGN.md § Opening balance and backfilling history), found by the valuation dated on
    the account's `created_on` — not any later balance check.
    """
    valuation = session.scalar(
        select(Valuation).where(Valuation.account_id == account.id, Valuation.date == account.created_on)
    )
    if valuation is None:
        return None
    return session.scalar(select(Transaction).where(Transaction.valuation_id == valuation.id))


def on_budget_cents(balance_cents: int, floor_cents: int) -> int:
    """How far above the floor the balance sits — this account's on-budget money."""
    return max(balance_cents, floor_cents) - floor_cents


def tracked_debt_cents(balance_cents: int, floor_cents: int) -> int:
    """How far below the floor the balance sits — debt the app tracks but doesn't budget with."""
    return min(balance_cents - floor_cents, 0)


def opening_adjustment(account: Account, valuation: Valuation) -> Transaction:
    """The one line the app maintains for the user (DESIGN.md § Opening balance and
    backfilling history): an unassigned account line for the valuation's stated balance,
    dated the valuation's date, referencing it. Not a rule the write path runs — this is
    the single exception to "nothing posts itself" (DESIGN.md § General concepts).
    """
    budget_cents = (
        on_budget_cents(valuation.balance_cents, account.on_budget_floor_cents)
        - on_budget_cents(0, account.on_budget_floor_cents)
        if account.on_budget
        else 0
    )
    return Transaction(
        date=valuation.date,
        memo=None,
        payee_id=None,
        valuation_id=valuation.id,
        account_lines=[AccountLine(account_id=account.id, cents=valuation.balance_cents, budget_cents=budget_cents)],
        category_lines=[],
    )


def backfill_opening_balance(
    session: Session,
    account: Account,
    txn_date: date,
    new_line_cents: int,
    *,
    exclude_transaction_id: int | None = None,
) -> None:
    """A transaction dated on or before an account's opening moves the opening back to it
    (DESIGN.md § Opening balance and backfilling history): the account's `created_on` and its
    opening valuation's date both move to `txn_date`, and the opening adjustment's line is
    reduced by exactly the delta the new line introduces — not a full resum — so the balance
    the user originally stated stays true on the date they stated it. A second, earlier
    backfill just runs this again against whatever the adjustment currently is.

    No-op when `txn_date` isn't strictly earlier than the account's current opening (a
    transaction dated on or after the start is ordinary activity — the stated opening balance
    already stays true under plain summation), or when the opening adjustment *is* the
    transaction being written (editing it directly).
    """
    opening_transaction = _opening_adjustment_transaction(session, account)
    if opening_transaction is None or opening_transaction.date <= txn_date:
        return
    if opening_transaction.id == exclude_transaction_id:
        return

    opening_line = next(line for line in opening_transaction.account_lines if line.account_id == account.id)
    new_amount = opening_line.cents - new_line_cents

    account.created_on = txn_date
    opening_transaction.date = txn_date
    opening_transaction.valuation.date = txn_date
    opening_line.cents = new_amount
    opening_line.budget_cents = (
        on_budget_cents(new_amount, account.on_budget_floor_cents) - on_budget_cents(0, account.on_budget_floor_cents)
        if account.on_budget
        else 0
    )


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
    """Write the account, its opening valuation and the opening adjustment transaction
    together — the opening balance is the account's first valuation, dated its created_on
    (DESIGN.md § Opening balance and backfilling history); the adjustment is what makes the
    ledger agree with it, and arrives unassigned like any inflow with no category.
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

    valuation = Valuation(account_id=account.id, date=created_on, balance_cents=opening_balance_cents)
    session.add(valuation)
    session.flush()  # assigns valuation.id for the transaction's FK

    session.add(opening_adjustment(account, valuation))
    session.flush()
    return account


def update_account(
    account: Account,
    *,
    name: str,
    type: str,
    on_budget: bool,
    on_budget_floor_cents: int,
    **terms: object,
) -> Account:
    """Apply edited settings in place (DESIGN.md § Settings never rewrite history): every
    account line already written keeps the `budget_cents` it was computed with — only a
    transaction written after this call sees the new floor or type.
    """
    account.name = name
    account.type = type
    account.on_budget = on_budget
    account.on_budget_floor_cents = on_budget_floor_cents
    for field, value in terms.items():
        setattr(account, field, value)
    return account


def account_latest_ledger_date(session: Session, account_id: int) -> date | None:
    """The most recent transaction date that still references this account — the archive-date
    bound (DESIGN.md § General concepts → Non-ledger rows are archived: `archived_on` must be
    strictly later than the latest ledger row still pointing at the entity).
    """
    return session.scalar(
        select(func.max(Transaction.date))
        .join(AccountLine, AccountLine.transaction_id == Transaction.id)
        .where(AccountLine.account_id == account_id)
    )


def account_balance_cents(
    session: Session,
    account_id: int,
    *,
    as_of: date | None = None,
    exclude_transaction_id: int | None = None,
) -> int:
    """No stored balances (DESIGN.md § General concepts): sum every account line dated on or
    before `as_of` (all of them when `as_of` is None). A valuation is never summed — it is a
    stated fact, not a ledger line; the opening valuation's own adjustment line (see
    `create_account_with_opening_valuation`) is what makes the balance agree with it.
    `exclude_transaction_id` leaves one transaction's own lines out, for computing the
    balance a transaction is being written or edited against.
    """
    line_stmt = (
        select(func.coalesce(func.sum(AccountLine.cents), 0))
        .join(Transaction, AccountLine.transaction_id == Transaction.id)
        .where(AccountLine.account_id == account_id)
    )
    if as_of is not None:
        line_stmt = line_stmt.where(Transaction.date <= as_of)
    if exclude_transaction_id is not None:
        line_stmt = line_stmt.where(AccountLine.transaction_id != exclude_transaction_id)

    return session.scalar(line_stmt)
