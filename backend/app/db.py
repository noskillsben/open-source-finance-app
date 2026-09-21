"""Engine, per-request session, and the declarative base every table inherits from.

Every table carries owner_id (single-user mode: always 1), created_at and updated_at.
Business dates are separate columns on the tables that need them; these three are provenance.
"""
from collections.abc import Generator
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, String, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Owned:
    """Mixin: multi-user readiness from day one. v1 never sets owner_id to anything but 1."""

    owner_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now(), nullable=False)


class NonLedger:
    """Mixin: non-ledger rows are archived, never deleted (DESIGN.md § General concepts,
    "Non-ledger rows are archived"). Every non-ledger table carries these two dates from the
    revision that creates it — never as a later retrofit.
    """

    created_on: Mapped[date] = mapped_column(Date, nullable=False)
    archived_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Provenance of a seeded default (DESIGN.md § General concepts → "First-run defaults come
    # from one seed step"): set by app/seed.py on the rows it inserts, unique per owner, and
    # never read for anything else. It is how the seed step tells "this default already exists"
    # from a name lookup, which a user's rename would defeat. Null on every user-made row.
    seeded_key: Mapped[str | None] = mapped_column(String, nullable=True)


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency: one session per request; commit on normal return, roll back on any exception."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
