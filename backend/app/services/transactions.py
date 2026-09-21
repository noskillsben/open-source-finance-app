"""Transaction math and the write path shared by create and edit (DESIGN.md § Transactions).

The only thing the app refuses to record is money that doesn't exist: a transaction whose
category lines don't sum to its budget movement (DESIGN.md § General concepts, "The only
thing the app refuses"; § Transactions, "Invariant").
"""
from datetime import date

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import Account, AccountLine, Category, CategoryLine, EarmarkLine, Payee, Transaction
from app.services.accounts import backfill_opening_balance
from app.services.categories import category_balance_cents, pool_chain


class TransactionError(ValueError):
    """The transaction's lines don't add up — a 4xx, not a 500."""


def line_budget_cents(account: Account, cents: int) -> int:
    """How much of this line's movement lands on-budget: the line's own cents when the
    account is on-budget, 0 when it's tracking (DESIGN.md § Transactions → Invariant). A pure
    function of the line and the account's *current* setting — fixed at write time, never
    recomputed from a balance, and never dependent on write order.

    Reused read-only by the integrity check (app/services/integrity.py): calling it again
    against an account's *current* on-budget flag is exactly what "would this compute
    differently under today's settings" means — there is no second formula.
    """
    return cents if account.on_budget else 0


def backdate_created_on(entity, txn_date: date) -> None:
    """A row can't be invisible at the date of a ledger row that references it: if the entity
    was created after `txn_date`, move its `created_on` back to it (DESIGN.md § General
    concepts → Non-ledger rows are archived; the same silent move as an account's backfill,
    minus the opening valuation, which categories and payees don't have).
    """
    if entity.created_on > txn_date:
        entity.created_on = txn_date


def clear_pool_draws(session: Session, transaction_id: int) -> None:
    """Remove the pool-draw lines this transaction generated — before regenerating them on an
    edit, and before deleting the transaction. Only `pool_draw` lines: other earmark lines that
    carry a transaction id (pay batches, deposits) are not this rule's to touch.
    """
    session.execute(
        delete(EarmarkLine).where(EarmarkLine.transaction_id == transaction_id, EarmarkLine.source == "pool_draw")
    )
    session.flush()


def _write_pool_draws(session: Session, transaction: Transaction) -> None:
    """DESIGN.md § Pools: a category this transaction takes negative draws on its pool chain
    instead. For each such category, walk the chain writing a pair per hop (pool −X, category
    +X) dated with the transaction — X is what is still uncovered, capped by what that pool
    holds, so a pool never goes negative from a draw. Only the part of the shortfall this
    transaction added is drawn (a category already negative before it isn't this spend's to
    cover). What no pool can cover stays negative. The pair nets to zero, so ready to assign
    doesn't move. Computed here, at write time, from the pool links as they stand now.
    """
    spent: dict[int, int] = {}
    for line in transaction.category_lines:
        spent[line.category_id] = spent.get(line.category_id, 0) + line.cents
    for category_id, cents in spent.items():
        if cents >= 0:
            continue
        balance = category_balance_cents(session, category_id, as_of=transaction.date)
        uncovered = min(-balance, -cents)
        for pool in pool_chain(session, category_id):
            if uncovered <= 0:
                break
            if pool.archived_on is not None and pool.archived_on <= transaction.date:
                continue
            covered = min(uncovered, max(category_balance_cents(session, pool.id, as_of=transaction.date), 0))
            if covered == 0:
                continue
            backdate_created_on(pool, transaction.date)
            for target_id, signed in ((pool.id, -covered), (category_id, covered)):
                session.add(EarmarkLine(
                    date=transaction.date, category_id=target_id, cents=signed,
                    source="pool_draw", transaction_id=transaction.id,
                ))
            session.flush()
            uncovered -= covered


def write_transaction(
    session: Session,
    *,
    transaction: Transaction | None,
    txn_date: date,
    memo: str | None,
    payee_id: int | None,
    account_lines: list[dict],
    category_lines: list[dict],
    valuation_id: int | None = None,
) -> Transaction:
    """Create (transaction=None) or edit (transaction=existing row) a transaction: recompute
    every account line's budget_cents from scratch, check the invariant, and replace the
    lines outright (DESIGN.md § One write path — a rule-generated line would be regenerated
    here too, but none exist yet: #9 builds no rules).

    `valuation_id` is only ever set on a new transaction — it names the balance check that
    produced this adjustment (DESIGN.md § Balance checks) and is never reassigned on an edit.
    """
    if not account_lines:
        raise TransactionError("A transaction needs at least one account line.")

    payee = session.get(Payee, payee_id) if payee_id is not None else None
    if payee_id is not None and payee is None:
        raise TransactionError(f"Unknown payee id: {payee_id}")

    exclude_id = transaction.id if transaction is not None else None

    old_cents_by_account: dict[int, int] = {}
    old_netted_by_account: dict[int, bool] = {}
    if transaction is not None:
        for line in transaction.account_lines:
            old_cents_by_account[line.account_id] = old_cents_by_account.get(line.account_id, 0) + line.cents
            old_netted_by_account[line.account_id] = old_netted_by_account.get(line.account_id, False) or line.netted_into_opening

    if transaction is None:
        transaction = Transaction(date=txn_date, memo=memo, payee_id=payee_id, valuation_id=valuation_id)
        session.add(transaction)
    else:
        transaction.date = txn_date
        transaction.memo = memo
        transaction.payee_id = payee_id
        transaction.account_lines.clear()
        transaction.category_lines.clear()
        clear_pool_draws(session, transaction.id)

    account_ids = [line["account_id"] for line in account_lines]
    accounts = {a.id: a for a in session.query(Account).filter(Account.id.in_(account_ids)).all()}
    missing = set(account_ids) - accounts.keys()
    if missing:
        raise TransactionError(f"Unknown account id(s): {sorted(missing)}")

    cents_by_account: dict[int, int] = {}
    for line in account_lines:
        cents_by_account[line["account_id"]] = cents_by_account.get(line["account_id"], 0) + line["cents"]
    touched_account_ids = set(cents_by_account) | set(old_cents_by_account)
    netted_by_account: dict[int, bool] = {}
    for account_id in touched_account_ids:
        account = accounts.get(account_id) or session.get(Account, account_id)
        netted_by_account[account_id] = backfill_opening_balance(
            session, account, txn_date, cents_by_account.get(account_id, 0),
            old_line_cents=old_cents_by_account.get(account_id, 0),
            old_line_netted=old_netted_by_account.get(account_id, False),
            exclude_transaction_id=exclude_id,
        )
    session.flush()

    budget_movement = 0
    new_account_lines = []
    for line in account_lines:
        account = accounts[line["account_id"]]
        cents = line["cents"]
        budget_cents = line_budget_cents(account, cents)
        budget_movement += budget_cents
        new_account_lines.append(AccountLine(
            account_id=account.id, cents=cents, budget_cents=budget_cents,
            netted_into_opening=netted_by_account[account.id],
        ))

    if category_lines:
        category_ids = [line["category_id"] for line in category_lines]
        categories = {c.id: c for c in session.query(Category).filter(Category.id.in_(category_ids)).all()}
        missing_categories = set(category_ids) - categories.keys()
        if missing_categories:
            raise TransactionError(f"Unknown category id(s): {sorted(missing_categories)}")

        category_total = sum(line["cents"] for line in category_lines)
        if category_total != budget_movement:
            raise TransactionError(
                f"Category lines sum to {category_total} cents but the budget movement is "
                f"{budget_movement} cents. They must match."
            )
        for category in categories.values():
            backdate_created_on(category, txn_date)

    if payee is not None:
        backdate_created_on(payee, txn_date)

    new_category_lines = [
        CategoryLine(category_id=line["category_id"], cents=line["cents"], need_level=line.get("need_level"))
        for line in category_lines
    ]

    transaction.account_lines = new_account_lines
    transaction.category_lines = new_category_lines
    session.flush()
    _write_pool_draws(session, transaction)
    return transaction
