"""Account math and the write path shared by create and edit (DESIGN.md § On-budget floor,
§ Balance checks — one table).
"""
import calendar
from datetime import date, timedelta

from sqlalchemy import BigInteger, Date, case, column, func, null, select, values
from sqlalchemy.orm import Session

from app.models import Account, AccountLine, Transaction, Valuation


def most_spent_account_id(
    session: Session, transaction_id: int, *, excluding: frozenset[int] = frozenset()
) -> int | None:
    """The account the most money left on a transaction: its most negative account line, the
    lowest line id on a tie. `excluding` skips accounts that are never the answer (a split's
    member receivables). None when no line qualifies. The one copy of this pick: a bill's
    "record now" and a payee's fill-in both read it.
    """
    return session.scalar(
        select(AccountLine.account_id)
        .where(AccountLine.transaction_id == transaction_id, AccountLine.account_id.not_in(excluding))
        .order_by(AccountLine.cents, AccountLine.id)
        .limit(1)
    )


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


def _statement_close_on_or_before(close_day: int, year: int, month: int) -> date:
    """The close date in a month; a close day past a short month's end means its last day."""
    return date(year, month, min(close_day, calendar.monthrange(year, month)[1]))


def statement_dates(account: Account, as_of: date | None) -> tuple[date, date] | None:
    """(close, due) of the latest statement whose due date has passed on `as_of`, or None when
    the terms are unknown, no statement has closed since the account began, or `as_of` is None.
    Pure date arithmetic — the half of `carried_statement_note` that needs no ledger.
    """
    close_day, grace_days = account.statement_close_day, account.grace_days
    if close_day is None or grace_days is None or as_of is None:
        return None
    year, month = as_of.year, as_of.month
    while True:
        close = _statement_close_on_or_before(close_day, year, month)
        if close < account.created_on:
            return None
        due = close + timedelta(days=grace_days)
        if due <= as_of:
            return close, due
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)


def carried_note_text(statement_cents: int, paid_cents: int, close: date, due: date) -> str | None:
    """The wording half of `carried_statement_note`: silent when the statement was not owing or
    was paid off since it closed."""
    if statement_cents >= 0:
        return None
    carried_cents = -statement_cents - paid_cents
    if carried_cents <= 0:
        return None
    return (
        f"Carrying {dollars(carried_cents)} from the {close:%b} {close.day} statement "
        f"(due {due:%b} {due.day})."
    )


def carried_statement_note(session: Session, account: Account, as_of: date | None) -> str | None:
    """DESIGN.md § Carrying a balance: part of the latest statement whose due date has passed
    is still unpaid. Statement balance = balance at the end of the close day; due = close +
    grace days; carried = what that balance owed, less every positive line dated after the
    close up to `as_of`. Read-time only, from the terms block (never the account type). Silent
    when either term is null, no statement has closed since the account began, the statement
    was not owing, or its due date has not passed — never a reminder of what is coming due.
    `as_of` None is silent: only the picker date says what day it is.
    """
    dates = statement_dates(account, as_of)
    if dates is None:
        return None
    close, due = dates
    statement_cents = account_balance_cents(session, account.id, as_of=close)
    if statement_cents >= 0:
        return None
    paid_cents = session.scalar(
        select(func.coalesce(func.sum(AccountLine.cents), 0))
        .join(Transaction, AccountLine.transaction_id == Transaction.id)
        .where(
            AccountLine.account_id == account.id,
            AccountLine.cents > 0,
            Transaction.date > close,
            Transaction.date <= as_of,
        )
    )
    return carried_note_text(statement_cents, paid_cents, close, due)


def carried_statement_notes(session: Session, accounts: list[Account], as_of: date | None) -> dict[int, str | None]:
    """`carried_statement_note` for many accounts in one grouped query: each account's statement
    balance (at its own close date) and positive lines since, joined to a values list of
    (account, close). Equal to the single-account function per account.
    """
    dates = {a.id: d for a in accounts if (d := statement_dates(a, as_of)) is not None}
    notes: dict[int, str | None] = {a.id: None for a in accounts}
    if not dates:
        return notes
    wanted = values(
        column("account_id", BigInteger), column("close", Date), name="wanted"
    ).data([(account_id, close) for account_id, (close, _due) in dates.items()])
    rows = session.execute(
        select(
            wanted.c.account_id,
            func.sum(case((Transaction.date <= wanted.c.close, AccountLine.cents), else_=0)),
            func.sum(case(
                ((Transaction.date > wanted.c.close) & (AccountLine.cents > 0), AccountLine.cents), else_=0
            )),
        )
        .select_from(wanted)
        .join(AccountLine, AccountLine.account_id == wanted.c.account_id)
        .join(Transaction, AccountLine.transaction_id == Transaction.id)
        .where(Transaction.date <= as_of)
        .group_by(wanted.c.account_id)
    )
    sums = {account_id: (int(statement), int(paid)) for account_id, statement, paid in rows}
    for account_id, (close, due) in dates.items():
        statement_cents, paid_cents = sums.get(account_id, (0, 0))
        notes[account_id] = carried_note_text(statement_cents, paid_cents, close, due)
    return notes


def dollars(cents: int) -> str:
    """Integer cents → "$1,234.56" for the notes the backend words itself (display layer only)."""
    sign = "-" if cents < 0 else ""
    whole, part = divmod(abs(int(cents)), 100)
    return sign + "$" + format(whole, ",") + "." + format(part, "02d")


def long_date(day: date) -> str:
    """A date as "Oct 5, 2026" for the notes the backend words itself (display layer only)."""
    return f"{day:%b} {day.day}, {day.year}"


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
    new line so the caller can store it. A line nets iff it is dated before
    `account.opening_stated_on` — the date the balance was first stated, which never moves —
    whether it is fresh or was already netted, so backfilled transactions can be entered in any
    order and today's balance never changes. A line dated on or after that date is ordinary
    activity and never touches the opening. An account with no stated day never nets: a line
    dated before its start only moves the start and the opening back.

    `old_line_cents`/`old_line_netted` are this account's previous lines' cents and stored
    flag, for the edit and delete paths — the caller must capture them before clearing the
    transaction's old lines (delete passes new cents 0). The opening line moves by the delta
    only: `netted(new) − netted(old)`. Its date only ever moves earlier, to the earliest
    netted line; it is never recomputed after a delete or a move out of range.
    """
    opening_transaction = _opening_adjustment_transaction(session, account)
    if opening_transaction is None or opening_transaction.id == exclude_transaction_id:
        return False

    # No stated day (an opening the app made up): nothing is ever netted, but an earlier row
    # still moves the start and the $0 opening back to its date and counts as ordinary activity.
    stated_on = account.opening_stated_on
    new_netted = stated_on is not None and txn_date < stated_on
    delta = (new_line_cents if new_netted else 0) - (old_line_cents if old_line_netted else 0)

    if (new_netted or stated_on is None) and txn_date < opening_transaction.date:
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
    opening_stated: bool = True,
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
    if not opening_stated:
        account.opening_stated_on = null()  # SQL NULL, not the column default; see backfill_opening_balance
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
    before `as_of` (all of them when `as_of` is None), leaving out one transaction when asked
    (the envelope step's "balance before this line"). A valuation is never summed — it is a
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
    if exclude_transaction_id is not None:
        line_stmt = line_stmt.where(Transaction.id != exclude_transaction_id)

    return session.scalar(line_stmt)


def account_balances(session: Session, *, as_of: date | None = None) -> dict[int, int]:
    """Every account's balance on `as_of` (all lines when None) in one grouped query; equal to
    `account_balance_cents` per account. An account with no lines is absent — read it as 0.
    """
    stmt = (
        select(AccountLine.account_id, func.sum(AccountLine.cents))
        .join(Transaction, AccountLine.transaction_id == Transaction.id)
        .group_by(AccountLine.account_id)
    )
    if as_of is not None:
        stmt = stmt.where(Transaction.date <= as_of)
    return {account_id: int(cents) for account_id, cents in session.execute(stmt)}


class AccountError(ValueError):
    """A settings-surface rule refused an account change — a block, not a ledger validation."""


def reject_floor_below_credit_limit(floor_cents: int, credit_limit_cents: int | None) -> None:
    """DESIGN.md § On-budget floor: the floor may not be set below `-credit_limit_cents` where
    that limit is known — you cannot budget with credit the lender has not extended. A settings
    surface, so this one is a block, unlike the credit-limit warnings above.
    """
    if credit_limit_cents is not None and floor_cents < -credit_limit_cents:
        raise AccountError(f"The on-budget floor can't be set below the credit limit of -{dollars(credit_limit_cents)}.")
