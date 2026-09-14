"""Idempotent data steps run at container start, after migrations (never a one-off script
someone has to remember to run — see CLAUDE.md § Repo hygiene).
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Transaction, Valuation
from app.services.accounts import opening_adjustment


def backfill_opening_adjustments(session: Session) -> int:
    """#42: every account's opening valuation should have its adjustment transaction. Accounts
    created before this issue landed have the valuation but not the transaction. For each
    account whose opening valuation has no transaction referencing it, write one. Writes
    nothing on a second run — the check is "does a transaction already point at this
    valuation", not a count or a flag.
    """
    written = 0
    accounts = session.scalars(select(Account)).all()
    for account in accounts:
        opening = session.scalars(
            select(Valuation).where(Valuation.account_id == account.id).order_by(Valuation.date, Valuation.id)
        ).first()
        if opening is None:
            continue

        already_adjusted = session.scalar(
            select(Transaction.id).where(Transaction.valuation_id == opening.id)
        )
        if already_adjusted is not None:
            continue

        session.add(opening_adjustment(account, opening))
        written += 1

    session.flush()
    return written


def main() -> None:
    from app.db import SessionLocal

    session = SessionLocal()
    try:
        written = backfill_opening_adjustments(session)
        session.commit()
        print(f"data_steps: wrote {written} opening adjustment(s)")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
