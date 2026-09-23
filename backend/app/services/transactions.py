"""Transaction math and the write path shared by create and edit (DESIGN.md § Transactions).

The only thing the app refuses to record is money that doesn't exist: a transaction whose
category lines don't sum to its budget movement (DESIGN.md § General concepts, "The only
thing the app refuses"; § Transactions, "Invariant").
"""
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Account, AccountLine, Category, CategoryAccountLink, CategoryLine, EarmarkLine, Payee, Transaction
from app.services.accounts import backfill_opening_balance
from app.services.categories import category_balance_cents, pool_chain
from app.services.links import linked_category_ids


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


def clear_generated_earmarks(session: Session, transaction_id: int, *, keep_deposits: bool = False) -> None:
    """Remove the earmark lines this transaction generated — pool draws and deposits — before
    regenerating them on an edit, and before deleting the transaction. Other earmark lines that
    carry a transaction id (pay batches) are not a rule's to touch. `keep_deposits` leaves the
    deposit lines alone, for a re-write that carries no deposit input (the integrity re-save).
    """
    sources = ["pool_draw"] if keep_deposits else ["pool_draw", "deposit"]
    session.execute(
        delete(EarmarkLine).where(EarmarkLine.transaction_id == transaction_id, EarmarkLine.source.in_(sources))
    )
    session.flush()


def _linked_net_cents(session: Session, transaction: Transaction) -> int:
    """What this transaction moved into (positive) or out of (negative) accounts that have
    linked categories — the amount a deposit or withdrawal is directed against.
    """
    return sum(
        line.cents for line in transaction.account_lines if linked_category_ids(session, line.account_id)
    )


def _write_deposits(session: Session, transaction: Transaction, deposits: list[dict]) -> None:
    """DESIGN.md § Linked categories, point 2: a transfer into a linked account asks which
    linked envelope(s) it funds; the user's answer is written as an earmark move with source
    `deposit`. Each item is `{category_id, cents, other_category_id}` (cents positive): a
    deposit moves `cents` from `other` (null: ready to assign) into the linked category, a
    withdrawal (the transfer took money out of the linked account) moves it out of the linked
    category into `other`. The items may add up to less than the transfer — the rest is
    "already earmarked" — but never more. Validates everything, then writes.
    """
    if not deposits:
        return
    net = _linked_net_cents(session, transaction)
    if net == 0:
        raise TransactionError("This transaction doesn't move money into or out of an account with linked categories.")
    direction = 1 if net > 0 else -1
    linked = {
        category_id
        for line in transaction.account_lines
        for category_id in linked_category_ids(session, line.account_id)
    }
    total = 0
    for item in deposits:
        if item["cents"] <= 0:
            raise TransactionError("Enter an amount for each envelope.")
        if item["category_id"] not in linked:
            raise TransactionError("Pick an envelope linked to the account this moves money in or out of.")
        if item.get("other_category_id") == item["category_id"]:
            raise TransactionError("Pick two different categories.")
        for category_id in (item["category_id"], item.get("other_category_id")):
            if category_id is None:
                continue
            category = session.get(Category, category_id)
            if category is None:
                raise TransactionError(f"Unknown category id: {category_id}")
            if category.archived_on is not None and category.archived_on <= transaction.date:
                raise TransactionError(f"{category.name} was archived on {category.archived_on.isoformat()}.")
        total += item["cents"]
    if total > abs(net):
        raise TransactionError(
            f"The envelopes add up to {total} cents but the transfer moved {abs(net)} cents. They can't exceed it."
        )
    for item in deposits:
        sides = [(item["category_id"], direction * item["cents"])]
        if item.get("other_category_id") is not None:
            sides.append((item["other_category_id"], -direction * item["cents"]))
        if direction > 0:
            sides.reverse()  # deposit: (other −, linked +); withdrawal: (linked −, other +)
        for category_id, cents in sides:
            backdate_created_on(session.get(Category, category_id), transaction.date)
            session.add(EarmarkLine(
                date=transaction.date, category_id=category_id, cents=cents,
                source="deposit", transaction_id=transaction.id,
            ))
    session.flush()


def _items_from_lines(lines: list[EarmarkLine], net: int) -> list[dict]:
    """`_write_deposits` writes each item as (other −, linked +) on a deposit or (linked −,
    other +) on a withdrawal, the `other` line only when it isn't ready to assign, so the
    transaction's direction (`net`) and the line order are enough to read the items back.
    """
    items: list[dict] = []
    pending = None  # a deposit's `other` line, seen before the linked line that ends its item
    for line in lines:
        if net > 0:
            if line.cents > 0:
                items.append({"category_id": line.category_id, "cents": line.cents, "other_category_id": pending})
                pending = None
            else:
                pending = line.category_id
        elif line.cents < 0:
            items.append({"category_id": line.category_id, "cents": -line.cents, "other_category_id": None})
        elif items:
            items[-1]["other_category_id"] = line.category_id
    return items


def read_deposits(session: Session, transaction: Transaction) -> list[dict]:
    """The deposit items this transaction's stored deposit lines say — what the edit form
    pre-fills.
    """
    return read_deposits_for(session, [transaction]).get(transaction.id, [])


def read_deposits_for(session: Session, transactions: list[Transaction]) -> dict[int, list[dict]]:
    """Deposit items for many transactions in a fixed number of queries — the list endpoint's
    query count must not grow with the ledger. Only transactions with deposit lines appear.
    """
    lines = session.scalars(
        select(EarmarkLine)
        .where(
            EarmarkLine.source == "deposit",
            EarmarkLine.transaction_id.in_([t.id for t in transactions]),
        )
        .order_by(EarmarkLine.id)
    ).all()
    if not lines:
        return {}
    by_transaction: dict[int, list[EarmarkLine]] = {}
    for line in lines:
        by_transaction.setdefault(line.transaction_id, []).append(line)
    linked_accounts = set(session.scalars(select(CategoryAccountLink.account_id).distinct()))
    result = {}
    for transaction in transactions:
        if transaction.id in by_transaction:
            net = sum(l.cents for l in transaction.account_lines if l.account_id in linked_accounts)
            result[transaction.id] = _items_from_lines(by_transaction[transaction.id], net)
    return result


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
    income_stream_id: int | None = None,
    deposits: list[dict] | None = None,
) -> Transaction:
    """Create (transaction=None) or edit (transaction=existing row) a transaction: recompute
    every account line's budget_cents from scratch, check the invariant, and replace the
    lines outright, regenerating the earmark lines a rule generates — deposits, then pool
    draws (DESIGN.md § One write path).

    `deposits` is the user's answer to "which envelope does this fund?" (see `_write_deposits`).
    A list, empty included, replaces whatever deposit lines the transaction had; None leaves
    them as they are (the integrity re-save carries no such input).

    `valuation_id` and `income_stream_id` are only ever set on a new transaction — the balance
    check or named pay that produced it (DESIGN.md § Balance checks, § Income streams) — and are
    never reassigned on an edit.
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
        transaction = Transaction(
            date=txn_date, memo=memo, payee_id=payee_id,
            valuation_id=valuation_id, income_stream_id=income_stream_id,
        )
        session.add(transaction)
    else:
        transaction.date = txn_date
        transaction.memo = memo
        transaction.payee_id = payee_id
        transaction.account_lines.clear()
        transaction.category_lines.clear()
        clear_generated_earmarks(session, transaction.id, keep_deposits=deposits is None)

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
    _write_deposits(session, transaction, deposits or [])
    _write_pool_draws(session, transaction)
    return transaction
