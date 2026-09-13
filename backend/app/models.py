"""SQLAlchemy models — the stored shape. Pydantic schemas (app/schemas.py) are the API shape; they never cross.

Tables arrive with the issues that build them, each as an Alembic revision.
Import this module wherever Base.metadata must know every table (alembic/env.py does).
"""
from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, Index, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, Owned


class Account(Base, Owned):
    """Where money, debt or value is held (DESIGN.md § Accounts)."""

    __tablename__ = "account"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_on: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    on_budget: Mapped[bool] = mapped_column(nullable=False)
    on_budget_floor_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    # Debt terms (DESIGN.md § Debt terms) — all nullable, null means unknown, never zero.
    credit_limit_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    annual_rate: Mapped[float | None] = mapped_column(Numeric(9, 4), nullable=True)
    compounding_rule: Mapped[str | None] = mapped_column(String, nullable=True)
    statement_close_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grace_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    term_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    amortization_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    prepayment_model: Mapped[str | None] = mapped_column(String, nullable=True)
    promo_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deferred_rate: Mapped[float | None] = mapped_column(Numeric(9, 4), nullable=True)
    minimum_payment_rule: Mapped[str | None] = mapped_column(String, nullable=True)

    valuations: Mapped[list["Valuation"]] = relationship(back_populates="account", order_by="Valuation.date")

    __table_args__ = (
        Index("ix_account_owner_lower_name", "owner_id", func.lower(name), unique=True),
    )


class Valuation(Base, Owned):
    """A balance-check fact: 'on this date the real balance was X' (DESIGN.md § Balance checks)."""

    __tablename__ = "valuation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    balance_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)

    account: Mapped["Account"] = relationship(back_populates="valuations")
