"""The advisory notes a transaction save returns — warnings in words, never refusals
(DESIGN.md § Transactions). Read-only: nothing here writes.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, EarmarkLine, Goal, Payee, Transaction
from app.services.accounts import account_balance_cents, credit_limit_note, dollars
from app.services.categories import category_balance_cents
from app.services.links import linked_money_note
from app.services.valuations import latest_valuation


def linked_money_notes(session: Session, transaction: Transaction) -> list[str]:
    """DESIGN.md § Linked categories, point 3: spending out of a linked category warns that
    the money is in an account you didn't spend from. Skipped when the transaction itself
    touches that account (spending straight out of it). A warning, never a refusal.
    """
    touched = {line.account_id for line in transaction.account_lines}
    notes = []
    for category_id in dict.fromkeys(line.category_id for line in transaction.category_lines if line.cents < 0):
        note = linked_money_note(session, category_id, exclude_account_ids=touched)
        if note is not None:
            notes.append(note)
    return notes


def transaction_notes(session: Session, transaction: Transaction) -> list[str]:
    """Advisory notes for a save: "This predates your <date> check" (DESIGN.md § Balance
    checks) for each account whose latest check is on or after this transaction's date, and a
    credit-limit note (DESIGN.md § Credit limit — the floor of reality) when the balance on
    this transaction's own date, after this save, is past the account's credit limit. The
    check's own adjustment never notes itself. Also one note per archived payee, category or
    account the transaction references when it is dated on or after that entity's
    `archived_on` (DESIGN.md § General concepts) — advisory only, nothing is refused.
    """
    notes = []
    archived = []
    if transaction.payee_id is not None:
        archived.append(session.get(Payee, transaction.payee_id))
    archived.extend(line.category for line in transaction.category_lines)
    archived.extend(line.account for line in transaction.account_lines)
    seen = set()
    for entity in archived:
        key = (type(entity), entity.id)
        if key in seen:
            continue
        seen.add(key)
        if entity.archived_on is not None and transaction.date >= entity.archived_on:
            notes.append(
                f"{entity.name} was archived on {entity.archived_on}; "
                "this transaction is dated after that."
            )
    if transaction.goal_id is not None:
        bill = session.get(Goal, transaction.goal_id)
        if bill.category_id not in {line.category_id for line in transaction.category_lines}:
            notes.append(
                f"This is marked as paying {bill.name} (due {transaction.goal_due_on}), "
                f"but it has no line on {session.get(Category, bill.category_id).name}."
            )
    for line in transaction.account_lines:
        # No as_of: a transaction dated on or before any recorded check predates it, whatever the picker says.
        valuation = latest_valuation(session, line.account_id)
        if (
            valuation is not None
            and transaction.date <= valuation.date
            and transaction.valuation_id != valuation.id
        ):
            notes.append(f"This predates your {valuation.date} check on {line.account.name}.")
        balance_cents = account_balance_cents(session, line.account_id, as_of=transaction.date)
        limit_note = credit_limit_note(balance_cents, line.account.credit_limit_cents)
        if limit_note is not None:
            notes.append(f"{limit_note} on {line.account.name}.")
    notes.extend(pool_draw_notes(session, transaction))
    notes.extend(linked_money_notes(session, transaction))
    return notes


def pool_draw_notes(session: Session, transaction: Transaction) -> list[str]:
    """One note per category this transaction drew for: "Snacks: covered $40.00 from Food, then
    $20.00 from Household." (DESIGN.md § Pools). Read back from the stored draw lines, which
    are written pool-then-category per hop, so the words are exactly what the ledger holds.
    """
    lines = session.scalars(
        select(EarmarkLine)
        .where(EarmarkLine.transaction_id == transaction.id, EarmarkLine.source == "pool_draw")
        .order_by(EarmarkLine.id)
    ).all()
    # Replay the lines in the order they were written with a running balance per category,
    # starting from what each held before this transaction's draws. A hop that finds its pool at
    # zero or below was absorbed: a pool is never drawn from at <= 0 otherwise.
    running: dict[int, int] = {}
    for line in lines:
        if line.category_id not in running:
            drawn = sum(l.cents for l in lines if l.category_id == line.category_id)
            running[line.category_id] = category_balance_cents(session, line.category_id, as_of=transaction.date) - drawn
    taken: dict[int, list[tuple[str, int | None, int]]] = {}  # category -> (pool, balance after if absorbed, cents)
    for pool_line, category_line in zip(lines[0::2], lines[1::2]):
        absorbed = running[pool_line.category_id] <= 0
        running[pool_line.category_id] += pool_line.cents
        running[category_line.category_id] += category_line.cents
        pool_name = session.get(Category, pool_line.category_id).name
        taken.setdefault(category_line.category_id, []).append(
            (pool_name, running[pool_line.category_id] if absorbed else None, category_line.cents)
        )
    notes = []
    for category_id, hops in taken.items():
        name = session.get(Category, category_id).name
        covered = [f"{dollars(cents)} from {pool}" for pool, now, cents in hops if now is None]
        note = f"{name}: covered {', then '.join(covered)}" if covered else f"{name}: covered nothing from the pools"
        for pool, now, cents in hops:
            if now is not None:
                note += f"; {pool} absorbed {dollars(cents)} (now {dollars(now).replace('-', '−')})"
        notes.append(note + ".")
    return notes
