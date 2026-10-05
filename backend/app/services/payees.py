"""Payee queries the archive mechanism needs (DESIGN.md § Payees, § General concepts →
Non-ledger rows are archived), and the fill-in the Ledger form reads when a payee is picked.
"""
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, Category, CategoryLine, Split, SplitMember, Transaction
from app.services.accounts import most_spent_account_id
from app.services.archiving import visible_as_of


def payee_latest_ledger_date(session: Session, payee_id: int) -> date | None:
    """The most recent transaction date that still references this payee — the archive-date
    bound (DESIGN.md: `archived_on` must be strictly later than the latest ledger row still
    pointing at the entity). Unlike accounts and categories, a transaction names its payee
    directly, so no join table is involved.
    """
    return session.scalar(
        select(func.max(Transaction.date)).where(Transaction.payee_id == payee_id)
    )


@dataclass
class PayeeFill:
    category_id: int | None = None
    account_id: int | None = None
    split_id: int | None = None


def payee_fill(session: Session, payee_id: int, *, as_of: date) -> PayeeFill:
    """What picking this payee fills in, read from the latest transaction naming them (latest
    date, then highest id) and never stored (DESIGN.md § Payees). Each answer is None when it
    does not apply or when what it names is archived as of `as_of`:
    - category: the largest category line by absolute cents, the lowest line id on a tie;
    - account: the one the most money left, skipping the split's member accounts so a
      roommate-paid bill does not answer with their receivable;
    - split: the one the transaction used.
    """
    latest = session.scalars(
        select(Transaction).where(Transaction.payee_id == payee_id).order_by(Transaction.date.desc(), Transaction.id.desc())
    ).first()
    if latest is None:
        return PayeeFill()

    category_id = session.scalar(
        select(CategoryLine.category_id)
        .where(CategoryLine.transaction_id == latest.id)
        .order_by(func.abs(CategoryLine.cents).desc(), CategoryLine.id)
        .limit(1)
    )
    member_accounts = (
        frozenset(session.scalars(select(SplitMember.account_id).where(SplitMember.split_id == latest.split_id)))
        if latest.split_id is not None
        else frozenset()
    )
    account_id = most_spent_account_id(session, latest.id, excluding=member_accounts)

    def live(model, row_id: int | None) -> int | None:
        if row_id is None:
            return None
        return session.scalar(select(model.id).where(model.id == row_id, visible_as_of(model, as_of)))

    return PayeeFill(
        category_id=live(Category, category_id), account_id=live(Account, account_id), split_id=live(Split, latest.split_id)
    )
