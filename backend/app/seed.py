"""Idempotent seed step for first-run defaults (DESIGN.md § General concepts →
"First-run defaults come from one seed step"). Runs at container start, after migrations,
before the app serves requests: insert what is missing, never touch what exists, so a
default the user renamed or archived stays renamed or archived.

An issue that introduces a new default adds a line to SEED_DEFAULTS, not a new mechanism.
"""
from collections.abc import Callable
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Payee

# Me must be valid on every picker date, including transactions backdated before the
# container's first boot — created_on cannot be date.today() (CLAUDE.md: never date.today()
# for a business date) or later than the earliest ledger row that will reference it.
#
# _SINCE_ALWAYS also doubles as the marker that identifies the seeded row itself: a rename
# must not cause a second Me to be seeded, so "does Me exist" cannot be a name lookup — it
# has to find the row this step already inserted, however it has since been renamed.
_SINCE_ALWAYS = date.min


def _me_exists(session: Session) -> bool:
    return session.scalar(select(Payee.id).where(Payee.created_on == _SINCE_ALWAYS)) is not None


def _insert_me(session: Session) -> None:
    session.add(Payee(name="Me", created_on=_SINCE_ALWAYS))


SEED_DEFAULTS: list[tuple[Callable[[Session], bool], Callable[[Session], None]]] = [
    (_me_exists, _insert_me),
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
