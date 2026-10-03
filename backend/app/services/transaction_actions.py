"""Transaction actions that are more than one write: the integrity check's re-save and the
delete's unwind. Routes call these; the rules live here.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Transaction
from app.services.accounts import _opening_adjustment_transaction, backfill_opening_balance
from app.services.earmarks import pay_batch_lines
from app.services.transactions import TransactionError, clear_generated_earmarks, write_transaction


def re_save_transaction(session: Session, transaction: Transaction) -> Transaction:
    """The integrity check's fix: run a transaction back through the normal write path with
    its own stored lines, so its `budget_cents` reflect current settings (DESIGN.md § General
    concepts → Settings never rewrite history). No separate fix logic — same write as any edit.
    """
    account_lines = [{"account_id": l.account_id, "cents": l.cents} for l in transaction.account_lines]
    category_lines = [
        {"category_id": l.category_id, "cents": l.cents, "need_level": l.need_level}
        for l in transaction.category_lines
    ]
    return write_transaction(
        session,
        transaction=transaction,
        txn_date=transaction.date,
        memo=transaction.memo,
        payee_id=transaction.payee_id,
        goal_id=transaction.goal_id,
        goal_due_on=transaction.goal_due_on,
        account_lines=account_lines,
        category_lines=category_lines,
    )


def delete_transaction(session: Session, transaction: Transaction) -> None:
    if transaction.valuation_id is not None:
        account = transaction.valuation.account
        if transaction is _opening_adjustment_transaction(session, account):
            raise TransactionError(
                "this is the account's opening-balance adjustment; fix it with a balance check or backfill, not by hand"
            )
    # Undo any backfill this transaction caused: the same unwind the edit path runs, with the
    # new line at 0 cents. Restores the opening amount; created_on and the opening date stay.
    for line in transaction.account_lines:
        backfill_opening_balance(
            session, line.account, transaction.date, 0,
            old_line_cents=line.cents, old_line_netted=line.netted_into_opening,
            exclude_transaction_id=transaction.id,
        )
    clear_generated_earmarks(session, transaction.id)
    # Any pay-batch lines still pointing here are the user's decisions, not this transaction's
    # to remove (DESIGN.md § Pay screen layout, block 11: removing the batch is a separate,
    # offered action — saving it empty) — unlink them so deleting the transaction never fails on
    # their reference; the lines and their money are untouched.
    for line in pay_batch_lines(session, transaction.id):
        line.transaction_id = None
    session.delete(transaction)
    session.flush()
