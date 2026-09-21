"""Idempotent seed step for first-run defaults (DESIGN.md § General concepts →
"First-run defaults come from one seed step"). Runs at container start, after migrations,
before the app serves requests: insert what is missing, never touch what exists, so a
default the user renamed or archived stays renamed or archived.

An issue that introduces a new default adds a line to SEED_DEFAULTS, not a new mechanism.
"""
from collections.abc import Callable
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import NonLedger
from app.models import Category, Domain, Payee
from app.services.archiving import ArchiveError

# Every default is valid on every picker date, including transactions backdated before the
# container's first boot — created_on cannot be date.today() (CLAUDE.md: never date.today()
# for a business date) or later than the earliest ledger row that will reference it.
# This is only the valid-from date. What a default *is* is its `seeded_key`: a rename or an
# archive must not cause a second copy to be seeded, so "does it exist" is never a name lookup.
_SINCE_ALWAYS = date.min

ME_KEY = "payee:me"


def _key_exists(session: Session, model: type[NonLedger], key: str) -> bool:
    return session.scalar(select(model.id).where(model.seeded_key == key)) is not None


def is_me(payee: Payee) -> bool:
    """Identify the seeded Me by its `seeded_key`, not by name, since Me can be renamed
    (DESIGN.md § Founding decisions → Minimal protected data).
    """
    return payee.seeded_key == ME_KEY


def guard_not_me(payee: Payee) -> None:
    """Refuse to archive or rename Me — the only protected record in the app (DESIGN.md §
    Founding decisions → Minimal protected data)."""
    if is_me(payee):
        raise ArchiveError("Me cannot be archived or renamed.")


def _default(
    model: type[NonLedger], key: str, *, name: str, **fields
) -> tuple[Callable[[Session], bool], Callable[[Session], None]]:
    """One SEED_DEFAULTS entry: insert a `model` row tagged `key` unless one carrying that key
    already exists. Also skipped when the user already has an active row of that name — the
    unique-name rule would refuse the insert, and their own row is what they meant. A field
    that is a callable is resolved against the session at insert time (for foreign keys to
    other defaults).
    """

    def exists(session: Session) -> bool:
        if _key_exists(session, model, key):
            return True
        taken = select(model.id).where(func.lower(model.name) == name.lower(), model.archived_on.is_(None))
        return session.scalar(taken) is not None

    def insert(session: Session) -> None:
        resolved = {k: v(session) if callable(v) else v for k, v in fields.items()}
        session.add(model(name=name, created_on=_SINCE_ALWAYS, seeded_key=key, **resolved))
        session.flush()

    return exists, insert


def _domain_id(key: str) -> Callable[[Session], int | None]:
    return lambda session: session.scalar(select(Domain.id).where(Domain.seeded_key == key))


# Domains and categories from DESIGN.md § Categories / § Domains. Domains come first so a
# category's domain exists when it is inserted. A new default is one line here.
DEFAULT_DOMAINS = [
    ("food", "Food", "Groceries and eating out"),
    ("housing", "Housing", "Where you live and what keeps it running"),
    ("transportation", "Transportation", "Getting around"),
    ("health", "Health", "Care for your body"),
    ("lifestyle", "Lifestyle", "Clothes, fun and everything discretionary"),
    ("financial", "Financial", "Debt and money set aside"),
]

# (key, name, domain key, default need level)
DEFAULT_CATEGORIES = [
    ("groceries", "Groceries", "food", "need"),
    ("dining-out", "Dining out", "food", "want"),
    ("rent", "Rent", "housing", "need"),
    ("utilities", "Utilities", "housing", "need"),
    ("transit", "Transit", "transportation", "need"),
    ("health-care", "Health care", "health", "need"),
    ("clothing", "Clothing", "lifestyle", "should"),
    ("entertainment", "Entertainment", "lifestyle", "want"),
    ("debt-payments", "Debt payments", "financial", "need"),
]

SEED_DEFAULTS: list[tuple[Callable[[Session], bool], Callable[[Session], None]]] = [
    _default(Payee, ME_KEY, name="Me"),
    *(_default(Domain, f"domain:{key}", name=name, description=description)
      for key, name, description in DEFAULT_DOMAINS),
    *(_default(Category, f"category:{key}", name=name,
               domain_id=_domain_id(f"domain:{domain}"), need_level=need_level)
      for key, name, domain, need_level in DEFAULT_CATEGORIES),
]


def seed_defaults(session: Session) -> int:
    inserted = 0
    for exists, insert in SEED_DEFAULTS:
        if not exists(session):
            insert(session)
            inserted += 1
    session.flush()
    return inserted


def main() -> None:
    from app.db import SessionLocal

    session = SessionLocal()
    try:
        inserted = seed_defaults(session)
        session.commit()
        print(f"seed: inserted {inserted} default(s)")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
