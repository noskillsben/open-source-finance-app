"""Splits and their members (DESIGN.md § Splits). A split is a settings row: the members are the
*other* people, my share is whatever they leave, and the members may not add up to more than 100%
— a block, because this is a settings surface and nothing recorded here is a claim about money.

Percent rounding: a percent is stored at four decimal places (`Numeric(7, 4)`), rounded half-even
on the way in, and the 100% limit is checked on the stored (rounded) values, so what the page
shows is exactly what was compared.

One person, one balance: a member's account is created on their first membership and reused
while they are a member of any other live split, or it is one the user picks.
"""
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Account, AccountLine, Payee, Split, SplitMember, Transaction
from app.schemas import SplitMemberIn
from app.seed import is_me
from app.services.accounts import create_account_with_opening_valuation

HUNDRED = Decimal("100")
PERCENT_PLACES = Decimal("0.0001")
RECEIVABLE_TYPE = "Cash"  # an ordinary on-budget account; there is no special receivable type


class SplitError(ValueError):
    """A settings-surface rule refused the write; carries the HTTP status the router answers with."""

    def __init__(self, detail: str, status_code: int = 400):
        super().__init__(detail)
        self.status_code = status_code


def round_percent(value: Decimal) -> Decimal:
    return value.quantize(PERCENT_PLACES, rounding=ROUND_HALF_EVEN)


def my_share_percent(percents: list[Decimal]) -> Decimal:
    return HUNDRED - sum(percents, Decimal(0))


def live_account_of_payee(session: Session, payee_id: int, *, exclude_split_id: int | None = None) -> int | None:
    """The account this person already uses in another live split, if any."""
    query = (
        select(SplitMember.account_id)
        .join(Split, Split.id == SplitMember.split_id)
        .where(SplitMember.payee_id == payee_id, SplitMember.archived_on.is_(None), Split.archived_on.is_(None))
        .order_by(SplitMember.id)
        .limit(1)
    )
    if exclude_split_id is not None:
        query = query.where(Split.id != exclude_split_id)
    return session.scalar(query)


@dataclass
class _Resolved:
    payee: Payee
    percent: Decimal
    account_id: int | None  # None: create their account on persist


def _validate_members(
    session: Session, members: list[SplitMemberIn], *, split_id: int | None
) -> list[_Resolved]:
    """Everything that can be refused is refused here, before anything is written."""
    resolved: list[_Resolved] = []
    seen: set[int] = set()
    for member in members:
        if member.payee_id in seen:
            raise SplitError("A person can be in a split only once.")
        seen.add(member.payee_id)

        payee = session.get(Payee, member.payee_id)
        if payee is None or payee.archived_on is not None:
            raise SplitError(f"No payee with id {member.payee_id}.", 404)
        if is_me(payee):
            raise SplitError("You are never a member of a split: your share is what the members leave.")

        percent = round_percent(member.percent)
        if percent <= 0 or percent > HUNDRED:
            raise SplitError(f"{payee.name}'s percent must be more than 0 and at most 100.")

        existing = live_account_of_payee(session, payee.id, exclude_split_id=split_id)
        account_id = member.account_id
        if account_id is not None:
            account = session.get(Account, account_id)
            if account is None or account.archived_on is not None:
                raise SplitError(f"No account with id {account_id}.", 404)
            if existing is not None and existing != account_id:
                other = session.get(Account, existing)
                raise SplitError(
                    f"{payee.name} already has a balance in {other.name!r}: one person, one balance."
                )
        else:
            account_id = existing
        resolved.append(_Resolved(payee=payee, percent=percent, account_id=account_id))

    total = sum((r.percent for r in resolved), Decimal(0))
    if total > HUNDRED:
        raise SplitError(
            f"The members add up to {format(total, 'f')}%, which is more than 100%. "
            "Your share is whatever they leave."
        )
    return resolved


def _account_for(session: Session, payee: Payee, created_on: date) -> int:
    """The first membership creates their on-budget account through the one account-creation path."""
    taken = session.scalar(
        select(Account.id).where(Account.archived_on.is_(None), func.lower(Account.name) == payee.name.lower())
    )
    if taken is not None:
        raise SplitError(
            f"An account named {payee.name!r} already exists. Pick it as {payee.name}'s account "
            "to use it for their balance.",
            409,
        )
    account = create_account_with_opening_valuation(
        session, name=payee.name, created_on=created_on, type=RECEIVABLE_TYPE,
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=0,
    )
    return account.id


@contextmanager
def _name_must_be_free(session: Session, name: str):
    """Make the name-changing writes inside this block in a savepoint and flush them on the way out,
    so a live-name collision is refused with a 409 without poisoning the session. (Opening a
    savepoint flushes what is already pending, so the writes have to start inside it.)"""
    try:
        with session.begin_nested():
            yield
            session.flush()
    except IntegrityError:
        raise SplitError(f"A split named {name!r} already exists.", 409)


def create_split(
    session: Session, *, name: str, description: str | None, created_on: date, members: list[SplitMemberIn]
) -> Split:
    resolved = _validate_members(session, members, split_id=None)
    split = Split(name=name, description=description, created_on=created_on)
    with _name_must_be_free(session, name):
        session.add(split)
    _persist_members(session, split, resolved, created_on)
    return split


def update_split(
    session: Session, split: Split, *, name: str, description: str | None, as_of: date,
    members: list[SplitMemberIn],
) -> Split:
    if split.archived_on is not None:
        raise SplitError("This split is archived. Unarchive it to change it.")
    resolved = _validate_members(session, members, split_id=split.id)
    live_before = {m.payee_id: m for m in split.members if m.archived_on is None}
    for member in members:
        current = live_before.get(member.payee_id)
        if current is not None and member.account_id is not None and member.account_id != current.account_id:
            raise SplitError(
                "A person's account can't be changed once they're in a split. "
                "Remove them and add them again."
            )
    with _name_must_be_free(session, name):
        split.name = name
        split.description = description

    live = {m.payee_id: m for m in split.members if m.archived_on is None}
    wanted = {r.payee.id for r in resolved}
    for payee_id, member in live.items():
        if payee_id not in wanted:
            member.archived_on = as_of
    # An existing member keeps their row; a changed percent is the only edit that reaches them.
    for r in resolved:
        if r.payee.id in live:
            live[r.payee.id].percent = r.percent
    session.flush()
    _persist_members(session, split, [r for r in resolved if r.payee.id not in live], as_of)
    return split


def _persist_members(session: Session, split: Split, resolved: list[_Resolved], created_on: date) -> None:
    for r in resolved:
        account_id = r.account_id if r.account_id is not None else _account_for(session, r.payee, created_on)
        session.add(SplitMember(
            split_id=split.id, payee_id=r.payee.id, account_id=account_id,
            percent=r.percent, created_on=created_on,
        ))
        session.flush()
    session.refresh(split)


def unarchive_split_checked(session: Session, split: Split) -> None:
    """Unarchive, refused (409) when another live split now has the name."""
    with _name_must_be_free(session, split.name):
        unarchive_split(split)


def archive_split(split: Split, archived_on: date) -> None:
    """A split has no ledger rows pointing at it yet, so there is no date bound. Its live members
    go with it, dated the same, so unarchiving brings back the rule as it stood."""
    split.archived_on = archived_on
    for member in split.members:
        if member.archived_on is None:
            member.archived_on = archived_on


def unarchive_split(split: Split) -> None:
    archived_on = split.archived_on
    split.archived_on = None
    for member in split.members:
        if archived_on is not None and member.archived_on == archived_on:
            member.archived_on = None


def shown_members(split: Split, as_of: date | None) -> list[SplitMember]:
    """The members to show: live ones, plus any archived along with an archived split — a split
    viewed through "Show archived" still reads as the rule it was."""
    shown = []
    for m in split.members:
        went_with_split = split.archived_on is not None and m.archived_on is not None and m.archived_on >= split.archived_on
        live = m.archived_on is None or (as_of is not None and as_of < m.archived_on)
        if (live or went_with_split) and (as_of is None or m.created_on <= as_of):
            shown.append(m)
    return shown


def balance_since_zero(session: Session, account_id: int, as_of: date | None) -> tuple[int, list[Transaction]]:
    """A member account's balance at `as_of` and the transactions that built it: those since the
    balance last stood at zero (DESIGN.md § Splits → The Splits page). Read time only, nothing
    stored, nothing marks a settle-up. The balance is an end-of-day running sum of the account's
    lines, so lines on one day that net to zero are never a standing balance. A balance that has
    never stood at zero lists from the first line; one that is zero now lists nothing.
    """
    stmt = (
        select(Transaction.date, func.sum(AccountLine.cents))
        .join(AccountLine, AccountLine.transaction_id == Transaction.id)
        .where(AccountLine.account_id == account_id)
        .group_by(Transaction.date)
        .order_by(Transaction.date)
    )
    if as_of is not None:
        stmt = stmt.where(Transaction.date <= as_of)
    running = 0
    zero_on: date | None = None
    for day, cents in session.execute(stmt):
        running += cents
        if running == 0:
            zero_on = day
    if running == 0:
        return 0, []
    txn_stmt = (
        select(Transaction)
        .join(AccountLine, AccountLine.transaction_id == Transaction.id)
        .where(AccountLine.account_id == account_id)
        .distinct()
        .order_by(Transaction.date, Transaction.id)
    )
    if as_of is not None:
        txn_stmt = txn_stmt.where(Transaction.date <= as_of)
    if zero_on is not None:
        txn_stmt = txn_stmt.where(Transaction.date > zero_on)
    return running, list(session.scalars(txn_stmt))
