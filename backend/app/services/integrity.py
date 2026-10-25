"""A read-only replay of the write path's checks (DESIGN.md § Transactions → Invariant;
§ General concepts → Settings never rewrite history). Every number here comes from the same
helper the write path uses — this module reinvents nothing, it just runs it again and compares.
"""
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import AccountLine, Category, EarmarkLine, Transaction
from app.services.accounts import _opening_adjustment_transaction
from app.services.transactions import line_budget_cents, plan_pool_draws


@dataclass
class IntegrityFinding:
    transaction_id: int
    date: date
    payee_id: int | None
    kind: str  # "invariant", "settings_drift", "not_netted" or "stale_cover"
    expected_cents: int
    stored_cents: int
    category_name: str | None = None  # stale_cover only
    pool_name: str | None = None  # stale_cover only


def find_integrity_issues(session: Session) -> list[IntegrityFinding]:
    """Four independent findings per transaction (DESIGN.md § Transactions → Invariant):

    - "invariant": the category lines, as stored, don't sum to the budget movement, as
      stored. Enforced on every write — only reachable here through a row that bypassed it.
    - "settings_drift": recomputing each account line's on-budget cents against the
      account's *current* on-budget flag gives a different budget movement than what's
      stored — an old row written while the account's budget side was different (DESIGN.md
      § Settings never rewrite history). A floor change alone never produces this finding,
      since `budget_cents` no longer reads the floor at all. Re-saving applies today's
      settings; nothing here does that itself.
    - "not_netted": an account line dated before its account's `opening_stated_on` whose
      `netted_into_opening` is false — a row saved before backfills netted in any order
      (DESIGN.md § Opening balance and backfilling history), so today's balance carries it.
      The account's opening adjustment is excluded. `expected_cents` is the line's cents, the
      amount a Re-save would absorb into the opening; `stored_cents` is 0, what is netted now.
      Re-save fixes it through the normal write path.
    - "stale_cover": the pool draws a save would write today differ from the transaction's
      stored `pool_draw` lines — a backfill landed an older spend in the category after this
      one was saved (DESIGN.md § Categories → Pools). The draws come from the planner the
      write path uses (`plan_pool_draws`, which leaves the row's own draws out of the
      balances). `expected_cents` is the total a save would draw, `stored_cents` the total
      stored; `category_name` and `pool_name` say where they differ. Re-save fixes it and
      never touches another transaction's draws.
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
    opening_ids: dict[int, int | None] = {}
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

        for line in txn.account_lines:
            if line.netted_into_opening or txn.date >= line.account.opening_stated_on:
                continue
            if line.account_id not in opening_ids:
                opening = _opening_adjustment_transaction(session, line.account)
                opening_ids[line.account_id] = opening.id if opening else None
            if txn.id == opening_ids[line.account_id]:
                continue
            findings.append(
                IntegrityFinding(
                    transaction_id=txn.id, date=txn.date, payee_id=txn.payee_id,
                    kind="not_netted", expected_cents=line.cents, stored_cents=0,
                )
            )

        if txn.category_lines:
            stale = _stale_cover(session, txn)
            if stale is not None:
                findings.append(stale)

        recomputed_movement = sum(line_budget_cents(line.account, line.cents) for line in txn.account_lines)
        if recomputed_movement != stored_movement:
            findings.append(
                IntegrityFinding(
                    transaction_id=txn.id, date=txn.date, payee_id=txn.payee_id,
                    kind="settings_drift", expected_cents=recomputed_movement, stored_cents=stored_movement,
                )
            )

    return findings


def _stale_cover(session: Session, txn: Transaction) -> IntegrityFinding | None:
    """Compare the draws a save would write now with the stored ones, per category involved."""
    expected: dict[int, int] = {}
    expected_total = 0
    for pool, category_id, cents in plan_pool_draws(session, txn):
        expected[pool.id] = expected.get(pool.id, 0) - cents
        expected[category_id] = expected.get(category_id, 0) + cents
        expected_total += cents
    stored: dict[int, int] = {}
    stored_total = 0
    for line in session.scalars(
        select(EarmarkLine).where(EarmarkLine.transaction_id == txn.id, EarmarkLine.source == "pool_draw")
    ):
        stored[line.category_id] = stored.get(line.category_id, 0) + line.cents
        if line.cents > 0:
            stored_total += line.cents
    differing = {c for c in expected.keys() | stored.keys() if expected.get(c, 0) != stored.get(c, 0)}
    if not differing:
        return None
    spent_ids = {line.category_id for line in txn.category_lines}
    category_id = min(differing & spent_ids, default=None)
    pool_id = min(differing - spent_ids, default=None)
    wanted = [i for i in (category_id, pool_id) if i is not None]
    names = {c.id: c.name for c in session.scalars(select(Category).where(Category.id.in_(wanted)))}
    return IntegrityFinding(
        transaction_id=txn.id, date=txn.date, payee_id=txn.payee_id, kind="stale_cover",
        expected_cents=expected_total, stored_cents=stored_total,
        category_name=names.get(category_id), pool_name=names.get(pool_id),
    )
