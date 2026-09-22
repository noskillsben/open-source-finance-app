"""Linked categories (DESIGN.md § Accounts → Linked categories): which on-budget accounts a
category's money physically lives in, the pro-rata split of a gain or loss across the
categories linked to an account, and the drift between an account and the categories on it.
The link records *where money sits*; it never decides how much is whose.
"""
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Account, Category, CategoryAccountLink
from app.services.accounts import account_balance_cents, dollars
from app.services.categories import category_balance_cents


class LinkError(ValueError):
    """A link the service refuses — a settings surface, so a block is allowed."""


def set_category_links(session: Session, category: Category, account_ids: list[int], *, as_of: date) -> None:
    """Replace `category`'s links with exactly `account_ids`. Every account must exist, be
    on-budget and be active on `as_of`; validates everything, then writes.
    """
    if category.archived_on is not None:
        raise LinkError(f"{category.name} is archived.")
    wanted = list(dict.fromkeys(account_ids))
    for account_id in wanted:
        account = session.get(Account, account_id)
        if account is None:
            raise LinkError(f"Unknown account id: {account_id}")
        if not account.on_budget:
            raise LinkError(f"{account.name} is a tracking account; only on-budget accounts can be linked.")
        if account.archived_on is not None and account.archived_on <= as_of:
            raise LinkError(f"{account.name} was archived on {account.archived_on.isoformat()}.")
    session.execute(delete(CategoryAccountLink).where(CategoryAccountLink.category_id == category.id))
    session.add_all(CategoryAccountLink(category_id=category.id, account_id=a) for a in wanted)
    session.flush()


def prune_archived_links(session: Session) -> None:
    """Archiving either side removes its link rows (DESIGN.md: a link is a pure join). Run
    after an archive; idempotent, and unarchiving does not bring links back.
    """
    session.execute(delete(CategoryAccountLink).where(
        CategoryAccountLink.category_id.in_(select(Category.id).where(Category.archived_on.is_not(None)))
        | CategoryAccountLink.account_id.in_(select(Account.id).where(Account.archived_on.is_not(None)))
    ))
    session.flush()


def linked_account_ids(session: Session, category_id: int) -> list[int]:
    return list(session.scalars(
        select(CategoryAccountLink.account_id).where(CategoryAccountLink.category_id == category_id)
        .order_by(CategoryAccountLink.account_id)
    ))


def linked_category_ids(session: Session, account_id: int) -> list[int]:
    return list(session.scalars(
        select(CategoryAccountLink.category_id).where(CategoryAccountLink.account_id == account_id)
        .order_by(CategoryAccountLink.category_id)
    ))


def linked_accounts_by_category(session: Session) -> dict[int, list[Account]]:
    """Every category's linked accounts in one query, for the category list."""
    rows = session.execute(
        select(CategoryAccountLink.category_id, Account)
        .join(Account, Account.id == CategoryAccountLink.account_id)
        .order_by(Account.name)
    )
    result: dict[int, list[Account]] = {}
    for category_id, account in rows:
        result.setdefault(category_id, []).append(account)
    return result


def linked_money_note(session: Session, category_id: int, *, exclude_account_ids: set[int] = frozenset()) -> str | None:
    """The warning for spending or moving money out of a linked category: it is in an account
    you can't spend from directly (DESIGN.md § Linked categories, point 3). A warning, never a
    refusal. `exclude_account_ids` are accounts the spend itself comes from — spending straight
    out of the linked account is not the case the warning is about.
    """
    accounts = [
        session.get(Account, a) for a in linked_account_ids(session, category_id) if a not in exclude_account_ids
    ]
    if not accounts:
        return None
    names = " and ".join(a.name for a in accounts)
    return f"{session.get(Category, category_id).name}'s money is in {names}."


def split_pro_rata(balances: dict[int, int], diff_cents: int) -> list[dict]:
    """Split `diff_cents` (a gain or a loss) across categories in proportion to their
    balances. Only positive balances carry weight — a category holding nothing has no share
    of the growth. Each share is `diff * balance / total` rounded toward zero; the leftover
    cents go to the largest balance (lowest id on a tie), so the lines always sum to the
    difference exactly. Returns [] when nothing has a positive balance.
    """
    weights = {category_id: cents for category_id, cents in balances.items() if cents > 0}
    total = sum(weights.values())
    if diff_cents == 0 or total == 0:
        return []
    sign = 1 if diff_cents > 0 else -1
    shares = {c: sign * (abs(diff_cents) * w // total) for c, w in weights.items()}
    largest = min(weights, key=lambda c: (-weights[c], c))
    shares[largest] += diff_cents - sum(shares.values())
    return [{"category_id": c, "cents": cents} for c, cents in sorted(shares.items()) if cents != 0]


def suggest_split(session: Session, account_id: int, *, as_of: date, diff_cents: int) -> list[dict]:
    """The balance check's suggested category lines: the difference split across the account's
    linked categories by their *total* balances (there is no per-account share, DESIGN.md).
    """
    balances = {
        category_id: category_balance_cents(session, category_id, as_of=as_of)
        for category_id in linked_category_ids(session, account_id)
    }
    return split_pro_rata(balances, diff_cents)


def drift_cents(session: Session, account_id: int, *, as_of: date | None) -> int | None:
    """The account's balance minus its linked categories' balances, or None with no links.
    Positive: money nobody has claimed. Negative: the envelopes hold more than the account.
    A reminder only — nothing reads it to block or correct anything.
    """
    category_ids = linked_category_ids(session, account_id)
    if not category_ids:
        return None
    on = as_of or date.max
    envelopes = sum(category_balance_cents(session, c, as_of=on) for c in category_ids)
    return account_balance_cents(session, account_id, as_of=as_of) - envelopes


def drift_note(session: Session, account: Account, drift: int | None) -> str | None:
    if not drift:
        return None
    names = " and ".join(
        session.get(Category, c).name for c in linked_category_ids(session, account.id)
    )
    if drift > 0:
        return f"{account.name} holds {dollars(drift)} not claimed by {names}."
    return f"{names} hold {dollars(-drift)} more than {account.name} does."
