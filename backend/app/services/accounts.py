"""Account math and the write path shared by create and edit (DESIGN.md § On-budget floor,
§ Balance checks — one table).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, AccountLine, Transaction, Valuation


def _opening_valuation(session: Session, account: Account) -> Valuation | None:
    """The account's opening valuation — its *earliest* (DESIGN.md § Opening balance and
    backfilling history), not the one matching `created_on`: that date itself moves when a
    transaction is backfilled, so matching on it can't tell the opening apart from a later
    balance check dated the same day. `order_by(date, id)` is the one definition of "the
    opening valuation," shared by every caller.
    """
    return session.scalar(
        select(Valuation).where(Valuation.account_id == account.id).order_by(Valuation.date, Valuation.id)
    )


def _opening_adjustment_transaction(session: Session, account: Account) -> Transaction | None:
    """The transaction that made the ledger agree with this account's opening valuation
    (DESIGN.md § Opening balance and backfilling history) — not any later balance check.
    """
    valuation = _opening_valuation(session, account)
    if valuation is None:
        return None
    return session.scalar(select(Transaction).where(Transaction.valuation_id == valuation.id))


def on_budget_cents(balance_cents: int, floor_cents: int) -> int:
    """How far above the floor the balance sits — this account's on-budget money. Unclamped:
    it goes negative below the floor instead of being held at zero (DESIGN.md § On-budget
    floor, "the floor does not clamp").
    """
    return balance_cents - floor_cents


def credit_limit_note(balance_cents: int, credit_limit_cents: int | None) -> str | None:
    """DESIGN.md § Credit limit — the floor of reality: a balance may not physically go below
    `-credit_limit_cents` — a wallet holding $100 cannot dispense $200, a card at its limit is
    declined at the till. Null means unknown and nothing is said; 0 means no credit, so it
    warns below zero. Read-time only, and it warns rather than blocks — an impossible balance
    is a sign the record is wrong, not a reason to lose it.
    """
    if credit_limit_cents is None:
        return None
    if balance_cents < -credit_limit_cents:
        return "This balance is past the credit limit"
    return None


def opening_adjustment(account: Account, valuation: Valuation) -> Transaction:
    """The one line the app maintains for the user (DESIGN.md § Opening balance and
    backfilling history): an unassigned account line for the valuation's stated balance,
    dated the valuation's date, referencing it. Not a rule the write path runs — this is
    the single exception to "nothing posts itself" (DESIGN.md § General concepts).
    """
    budget_cents = valuation.balance_cents if account.on_budget else 0
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
    old_line_cents: int = 0,
    old_line_netted: bool = False,
    exclude_transaction_id: int | None = None,
) -> bool:
    """A transaction dated before an account's current start moves the opening back to it
    (DESIGN.md § Opening balance and backfilling history): the account's `created_on` and its
    opening valuation's date both move to `txn_date`, and the opening adjustment's line is
    reduced by exactly the delta the new line introduces — not a full resum — so the balance
    the user originally stated stays true on the date they stated it. A second, earlier
    backfill just runs this again against whatever the adjustment currently is.

    Whether a line is *netted* into the opening is decided once, when it is written, and
    stored on the line (`AccountLine.netted_into_opening`); this returns that answer for the
    new line so the caller can store it. A fresh or plain line nets iff it is dated before the
    opening's current date. A line that was already netted (`old_line_netted`, read back from
    its stored flag) stays netted while it is dated before `account.opening_stated_on` — the
    date the balance was first stated, which never moves — and is given back once it moves
    out past it. A plain line dated between the current opening and the stated date is
    ordinary activity and never touches the opening.

    `old_line_cents`/`old_line_netted` are this account's previous lines' cents and stored
    flag, for the edit and delete paths — the caller must capture them before clearing the
    transaction's old lines (delete passes new cents 0). The opening line moves by the delta
    only: `netted(new) − netted(old)`. Its date only ever moves earlier, to the earliest
    netted line; it is never recomputed after a delete or a move out of range.
    """
    opening_transaction = _opening_adjustment_transaction(session, account)
    if opening_transaction is None or opening_transaction.id == exclude_transaction_id:
        return False

    if old_line_netted:
        new_netted = txn_date < account.opening_stated_on
    else:
        new_netted = txn_date < opening_transaction.date
    delta = (new_line_cents if new_netted else 0) - (old_line_cents if old_line_netted else 0)

    if new_netted and txn_date < opening_transaction.date:
        account.created_on = txn_date
        opening_transaction.date = txn_date
        opening_transaction.valuation.date = txn_date

    if delta:
        opening_line = next(line for line in opening_transaction.account_lines if line.account_id == account.id)
        opening_line.cents -= delta
        opening_line.budget_cents = opening_line.cents if account.on_budget else 0
    return new_netted


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
) -> int:
    """No stored balances (DESIGN.md § General concepts): sum every account line dated on or
    before `as_of` (all of them when `as_of` is None). A valuation is never summed — it is a
    stated fact, not a ledger line; the opening valuation's own adjustment line (see
    `create_account_with_opening_valuation`) is what makes the balance agree with it.
    """
    line_stmt = (
        select(func.coalesce(func.sum(AccountLine.cents), 0))
        .join(Transaction, AccountLine.transaction_id == Transaction.id)
        .where(AccountLine.account_id == account_id)
    )
    if as_of is not None:
        line_stmt = line_stmt.where(Transaction.date <= as_of)

    return session.scalar(line_stmt)
