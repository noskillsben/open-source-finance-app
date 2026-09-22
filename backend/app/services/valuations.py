"""Balance-check write path (DESIGN.md § Balance checks — one table).

A valuation is a fact the user states; if it disagrees with the sum of the account's lines,
the app books an adjustment transaction through the normal transaction write path — no
shortcut — with the valuation as its source (`valuation_id`). Nothing here locks anything:
the badge showing entries added since a check is derived from `created_at` at read time,
never stored (DESIGN.md § Two dates on every row).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AccountLine, Transaction, Valuation
from app.services.accounts import account_balance_cents
from app.services.transactions import write_transaction


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


def latest_valuation(session: Session, account_id: int) -> Valuation | None:
    """The check shown on the account as "balance checked <date>" — the most recent one."""
    return session.scalar(
        select(Valuation)
        .where(Valuation.account_id == account_id)
        .order_by(Valuation.date.desc(), Valuation.id.desc())
        .limit(1)
    )


def entries_added_since_check(session: Session, account_id: int, valuation: Valuation) -> int:
    """How many transactions touching this account were recorded (by wall clock) after this
    check but dated on or before it — the badge's "N entries added since" (DESIGN.md §
    Balance checks: "derived from the wall-clock created_at, never a stored flag"). The
    adjustment the check itself produced is excluded — it isn't an entry added since.
    """
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
