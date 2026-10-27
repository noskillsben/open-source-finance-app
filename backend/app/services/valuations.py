"""Balance-check write path (DESIGN.md § Balance checks — one table).

A valuation is a fact the user states; if it disagrees with the sum of the account's lines,
the app books an adjustment transaction through the normal transaction write path — no
shortcut — with the valuation as its source (`valuation_id`). Nothing here locks anything:
the badge showing entries added since a check is derived from `created_at` at read time,
never stored (DESIGN.md § Two dates on every row).
"""
from datetime import date

from sqlalchemy import BigInteger, Date, DateTime, column, func, select, values
from sqlalchemy.orm import Session

from app.models import AccountLine, Transaction, Valuation
from app.services.accounts import _opening_valuation, account_balance_cents
from app.services.transactions import TransactionError, clear_generated_earmarks, write_transaction


def check_balance(
    session: Session,
    *,
    account_id: int,
    check_date: date,
    stated_balance_cents: int,
    category_id: int | None,
    category_lines: list[dict] | None = None,
) -> tuple[Valuation, Transaction | None, int]:
    """Write the valuation and, if it disagrees with the ledger, the adjustment that makes
    the ledger agree with it. Zero difference writes only the valuation — the valuation
    itself is never a line and changes no balance. `category_lines`, when given, are the
    adjustment's category lines as the user edited them (the linked-category split, DESIGN.md
    § Linked categories) and win over `category_id`; the invariant checks them like any other.
    Returns (valuation, adjustment or None,
    the difference in cents, stated minus ledger).
    """
    ledger_cents = account_balance_cents(session, account_id, as_of=check_date)
    diff_cents = stated_balance_cents - ledger_cents

    valuation = Valuation(account_id=account_id, date=check_date, balance_cents=stated_balance_cents)
    session.add(valuation)
    session.flush()  # assigns valuation.id for the transaction's FK

    if diff_cents == 0:
        return valuation, None, 0

    if category_lines is None:
        category_lines = [{"category_id": category_id, "cents": diff_cents}] if category_id is not None else []
    transaction = write_transaction(
        session,
        transaction=None,
        txn_date=check_date,
        memo=None,
        payee_id=None,
        account_lines=[{"account_id": account_id, "cents": diff_cents}],
        category_lines=category_lines,
        valuation_id=valuation.id,
    )
    return valuation, transaction, diff_cents


def latest_valuation(session: Session, account_id: int, as_of: date | None = None) -> Valuation | None:
    """The check shown on the account as "balance checked <date>" — the most recent one, or,
    when `as_of` is given, the most recent dated on or before it (DESIGN.md § Founding
    decisions, "Effective-date view"). Ties on date break by id, newest first.
    """
    query = select(Valuation).where(Valuation.account_id == account_id)
    if as_of is not None:
        query = query.where(Valuation.date <= as_of)
    return session.scalar(query.order_by(Valuation.date.desc(), Valuation.id.desc()).limit(1))


def entries_added_since_check(session: Session, account_id: int, valuation: Valuation) -> int:
    """How many transactions touching this account were recorded (by wall clock) after this
    check but dated on or before it — the badge's "N entries added since" (DESIGN.md §
    Balance checks: "derived from the wall-clock created_at, never a stored flag"). The
    adjustment the check itself produced is excluded — it isn't an entry added since. The
    opening valuation is not a check (DESIGN.md § Balance checks), so it counts nothing.
    """
    if valuation is _opening_valuation(session, valuation.account):
        return 0
    return session.scalar(
        select(func.count(func.distinct(Transaction.id)))
        .join(AccountLine, AccountLine.transaction_id == Transaction.id)
        .where(
            AccountLine.account_id == account_id,
            Transaction.date <= valuation.date,
            Transaction.created_at > valuation.created_at,
            Transaction.valuation_id.is_distinct_from(valuation.id),
        )
    )


def valuation_picture(
    session: Session, account_ids: list[int], *, as_of: date | None
) -> dict[int, tuple[Valuation | None, bool, int]]:
    """For each account, what its row shows about balance checks: (the latest check on `as_of`,
    whether that check is the opening valuation, entries added since it) — the three single-account
    answers (`latest_valuation`, `_opening_valuation`, `entries_added_since_check`) from two queries
    for all accounts: every valuation once, then one grouped count joined to a values list of
    (account, check) pairs. Equal to the single-account functions per account.
    """
    by_account: dict[int, list[Valuation]] = {account_id: [] for account_id in account_ids}
    if account_ids:
        for valuation in session.scalars(
            select(Valuation).where(Valuation.account_id.in_(account_ids)).order_by(Valuation.date, Valuation.id)
        ):
            by_account[valuation.account_id].append(valuation)
    picture: dict[int, tuple[Valuation | None, bool, int]] = {}
    checks: dict[int, Valuation] = {}
    for account_id, valuations in by_account.items():
        # Same picks as the single-account queries: the opening is the earliest by (date, id);
        # the latest on `as_of` is the newest by (date, id) dated on or before it.
        latest = next((v for v in reversed(valuations) if as_of is None or v.date <= as_of), None)
        is_opening = latest is not None and latest is valuations[0]
        picture[account_id] = (latest, is_opening, 0)
        if latest is not None and not is_opening:
            checks[account_id] = latest
    if checks:
        wanted = values(
            column("account_id", BigInteger), column("valuation_id", BigInteger),
            column("check_date", Date), column("checked_at", DateTime(timezone=True)), name="wanted",
        ).data([(a, v.id, v.date, v.created_at) for a, v in checks.items()])
        counts = dict(session.execute(
            select(wanted.c.account_id, func.count(func.distinct(Transaction.id)))
            .select_from(wanted)
            .join(AccountLine, AccountLine.account_id == wanted.c.account_id)
            .join(Transaction, AccountLine.transaction_id == Transaction.id)
            .where(
                Transaction.date <= wanted.c.check_date,
                Transaction.created_at > wanted.c.checked_at,
                Transaction.valuation_id.is_distinct_from(wanted.c.valuation_id),
            )
            .group_by(wanted.c.account_id)
        ).all())
        for account_id in checks:
            latest, is_opening, _ = picture[account_id]
            picture[account_id] = (latest, is_opening, int(counts.get(account_id, 0)))
    return picture


def delete_valuation(session: Session, valuation: Valuation) -> None:
    """DESIGN.md § Balance checks — "Nothing is locked": a valuation and its adjustment (if
    any) are deleted together, one write. The opening valuation is the one exception — it's
    what makes the account's start date true, and is corrected by backfilling instead.
    """
    account = valuation.account
    if valuation is _opening_valuation(session, account):
        raise TransactionError("this is the account's opening valuation; fix it by backfilling instead")
    adjustment = session.scalar(select(Transaction).where(Transaction.valuation_id == valuation.id))
    if adjustment is not None:
        clear_generated_earmarks(session, adjustment.id)
        session.delete(adjustment)
    session.delete(valuation)
    session.flush()
