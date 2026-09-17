"""A read-only replay of the write path's checks (DESIGN.md § Transactions → Invariant;
§ General concepts → Settings never rewrite history). Every number here comes from the same
helper the write path uses — this module reinvents nothing, it just runs it again and compares.
"""
from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session, selectinload

from app.models import AccountLine, Transaction
from app.services.transactions import line_budget_cents


@dataclass
class IntegrityFinding:
    transaction_id: int
    date: date
    payee_id: int | None
    kind: str  # "invariant" or "settings_drift"
    expected_cents: int
    stored_cents: int


def find_integrity_issues(session: Session) -> list[IntegrityFinding]:
    """Two independent findings per transaction (DESIGN.md § Transactions → Invariant):

    - "invariant": the category lines, as stored, don't sum to the budget movement, as
      stored. Enforced on every write — only reachable here through a row that bypassed it.
    - "settings_drift": recomputing each account line's on-budget cents against the
      account's *current* on-budget flag gives a different budget movement than what's
      stored — an old row written while the account's budget side was different (DESIGN.md
      § Settings never rewrite history). A floor change alone never produces this finding,
      since `budget_cents` no longer reads the floor at all. Re-saving applies today's
      settings; nothing here does that itself.
    """
    transactions = (
        session.query(Transaction)
        .options(
            selectinload(Transaction.account_lines).selectinload(AccountLine.account),
            selectinload(Transaction.category_lines),
        )
        .order_by(Transaction.date, Transaction.id)
        .all()
    )

    findings: list[IntegrityFinding] = []
    for txn in transactions:
        stored_movement = sum(line.budget_cents for line in txn.account_lines)

        if txn.category_lines:
            category_total = sum(line.cents for line in txn.category_lines)
            if category_total != stored_movement:
                findings.append(
                    IntegrityFinding(
                        transaction_id=txn.id, date=txn.date, payee_id=txn.payee_id,
                        kind="invariant", expected_cents=stored_movement, stored_cents=category_total,
                    )
                )

        recomputed_movement = sum(line_budget_cents(line.account, line.cents) for line in txn.account_lines)
        if recomputed_movement != stored_movement:
            findings.append(
                IntegrityFinding(
                    transaction_id=txn.id, date=txn.date, payee_id=txn.payee_id,
                    kind="settings_drift", expected_cents=recomputed_movement, stored_cents=stored_movement,
                )
            )

    return findings
