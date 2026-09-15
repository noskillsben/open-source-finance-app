"""Transaction math and the write path shared by create and edit (DESIGN.md § Transactions).

The only thing the app refuses to record is money that doesn't exist: a transaction whose
category lines don't sum to its budget movement (DESIGN.md § General concepts, "The only
thing the app refuses"; § Transactions, "Invariant").
"""
from datetime import date

from sqlalchemy.orm import Session

from app.models import Account, AccountLine, Category, CategoryLine, Payee, Transaction
from app.services.accounts import account_balance_cents, on_budget_cents


class TransactionError(ValueError):
    """The transaction's lines don't add up — a 4xx, not a 500."""


def _line_budget_cents(session: Session, account: Account, txn_date: date, cents: int, exclude_transaction_id: int | None) -> int:
    """How much of this line's movement lands on-budget: the change in on-budget money the
    line causes, computed from the account's balance immediately before it (DESIGN.md §
    Settings never rewrite history — this is fixed at write time and never recomputed).
    Tracking accounts never land on-budget.
    """
    if not account.on_budget:
        return 0
    balance_before = account_balance_cents(
        session, account.id, as_of=txn_date, exclude_transaction_id=exclude_transaction_id
    )
    balance_after = balance_before + cents
    return on_budget_cents(balance_after, account.on_budget_floor_cents) - on_budget_cents(
        balance_before, account.on_budget_floor_cents
    )


def write_transaction(
    session: Session,
    *,
    transaction: Transaction | None,
    txn_date: date,
    memo: str | None,
    payee_id: int | None,
    account_lines: list[dict],
    category_lines: list[dict],
) -> Transaction:
    """Create (transaction=None) or edit (transaction=existing row) a transaction: recompute
    every account line's budget_cents from scratch, check the invariant, and replace the
    lines outright (DESIGN.md § One write path — a rule-generated line would be regenerated
    here too, but none exist yet: #9 builds no rules).
    """
    if not account_lines:
        raise TransactionError("A transaction needs at least one account line.")

    if payee_id is not None and session.get(Payee, payee_id) is None:
        raise TransactionError(f"Unknown payee id: {payee_id}")

    exclude_id = transaction.id if transaction is not None else None

    if transaction is None:
        transaction = Transaction(date=txn_date, memo=memo, payee_id=payee_id)
        session.add(transaction)
    else:
        transaction.date = txn_date
        transaction.memo = memo
        transaction.payee_id = payee_id
        transaction.account_lines.clear()
        transaction.category_lines.clear()
        session.flush()

    account_ids = [line["account_id"] for line in account_lines]
    accounts = {a.id: a for a in session.query(Account).filter(Account.id.in_(account_ids)).all()}
    missing = set(account_ids) - accounts.keys()
    if missing:
        raise TransactionError(f"Unknown account id(s): {sorted(missing)}")

    budget_movement = 0
    new_account_lines = []
    for line in account_lines:
        account = accounts[line["account_id"]]
        cents = line["cents"]
        budget_cents = _line_budget_cents(session, account, txn_date, cents, exclude_id)
        budget_movement += budget_cents
        new_account_lines.append(AccountLine(account_id=account.id, cents=cents, budget_cents=budget_cents))

    if category_lines:
        category_ids = [line["category_id"] for line in category_lines]
        categories = {c.id for c in session.query(Category).filter(Category.id.in_(category_ids)).all()}
        missing_categories = set(category_ids) - categories
        if missing_categories:
            raise TransactionError(f"Unknown category id(s): {sorted(missing_categories)}")

        category_total = sum(line["cents"] for line in category_lines)
        if category_total != budget_movement:
            raise TransactionError(
                f"Category lines sum to {category_total} cents but the budget movement is "
                f"{budget_movement} cents. They must match."
            )

    new_category_lines = [
        CategoryLine(category_id=line["category_id"], cents=line["cents"], need_level=line.get("need_level"))
        for line in category_lines
    ]

    transaction.account_lines = new_account_lines
    transaction.category_lines = new_category_lines
    session.flush()
    return transaction
