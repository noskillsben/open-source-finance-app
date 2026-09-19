"""SQLAlchemy models — the stored shape. Pydantic schemas (app/schemas.py) are the API shape; they never cross.

Tables arrive with the issues that build them, each as an Alembic revision.
Import this module wherever Base.metadata must know every table (alembic/env.py does).
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, Date, ForeignKey, Index, Integer, Numeric, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, NonLedger, Owned


class Account(Base, Owned, NonLedger):
    """Where money, debt or value is held (DESIGN.md § Accounts)."""

    __tablename__ = "account"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    on_budget: Mapped[bool] = mapped_column(nullable=False)
    on_budget_floor_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    # Debt terms (DESIGN.md § Debt terms) — all nullable, null means unknown, never zero.
    credit_limit_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    annual_rate: Mapped[Decimal | None] = mapped_column(Numeric(9, 4), nullable=True)
    compounding_rule: Mapped[str | None] = mapped_column(String, nullable=True)
    statement_close_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grace_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    term_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    amortization_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    prepayment_model: Mapped[str | None] = mapped_column(String, nullable=True)
    promo_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deferred_rate: Mapped[Decimal | None] = mapped_column(Numeric(9, 4), nullable=True)
    minimum_payment_rule: Mapped[str | None] = mapped_column(String, nullable=True)

    valuations: Mapped[list["Valuation"]] = relationship(back_populates="account", order_by="Valuation.date")

    __table_args__ = (
        Index(
            "ix_account_owner_lower_name", "owner_id", func.lower(name),
            unique=True, postgresql_where=text("archived_on IS NULL"),
        ),
    )


class Valuation(Base, Owned):
    """A balance-check fact: 'on this date the real balance was X' (DESIGN.md § Balance checks)."""

    __tablename__ = "valuation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    balance_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)

    account: Mapped["Account"] = relationship(back_populates="valuations")


class Category(Base, Owned, NonLedger):
    """Minimal category — just enough to file a transaction line under (DESIGN.md § Categories).
    Domains, need levels, pools and goals are #2's job.
    """

    __tablename__ = "category"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Grouping for the tree view only — a parent is still postable like any other category
    # (DESIGN.md § Categories). Self-referential, so archiving cascades to children in one pass.
    parent_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=True, index=True)

    __table_args__ = (
        Index(
            "ix_category_owner_lower_name", "owner_id", func.lower(name),
            unique=True, postgresql_where=text("archived_on IS NULL"),
        ),
    )


class Payee(Base, Owned, NonLedger):
    """Stores, companies and people the user sends money to or receives it from (DESIGN.md §
    Payees). "Me" and its protection land in #44; default category and aliases are #27.
    """

    __tablename__ = "payee"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        Index(
            "ix_payee_owner_lower_name", "owner_id", func.lower(name),
            unique=True, postgresql_where=text("archived_on IS NULL"),
        ),
    )


class Transaction(Base, Owned):
    """Money actually moving in or out of one or more accounts (DESIGN.md § Transactions).
    There are no special transaction types — a paycheque, a refund and a loan draw are told
    apart by their lines, not by a type.
    """

    __tablename__ = "transaction"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    memo: Mapped[str | None] = mapped_column(String, nullable=True)
    payee_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("payee.id"), nullable=True, index=True)
    # Set on the one transaction a valuation produced: the opening adjustment (DESIGN.md §
    # Opening balance and backfilling history), and later the balance-check adjustment (#12).
    valuation_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("valuation.id"), nullable=True, index=True)

    valuation: Mapped["Valuation | None"] = relationship()
    account_lines: Mapped[list["AccountLine"]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan"
    )
    category_lines: Mapped[list["CategoryLine"]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan"
    )


class AccountLine(Base, Owned):
    """One account touched by a transaction (DESIGN.md § Transactions → Account lines).
    `budget_cents` is how many of `cents` landed on-budget, computed from the account's floor
    at write time and never recomputed (DESIGN.md § Settings never rewrite history).
    """

    __tablename__ = "account_line"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    transaction_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("transaction.id"), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"), nullable=False, index=True)
    cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    budget_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)

    transaction: Mapped["Transaction"] = relationship(back_populates="account_lines")
    account: Mapped["Account"] = relationship()


class CategoryLine(Base, Owned):
    """One category a transaction's budget movement was for (DESIGN.md § Transactions →
    Category lines). Zero or more; none means the movement is unassigned.
    """

    __tablename__ = "category_line"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    transaction_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("transaction.id"), nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=False, index=True)
    cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    need_level: Mapped[str | None] = mapped_column(String, nullable=True)

    transaction: Mapped["Transaction"] = relationship(back_populates="category_lines")
    category: Mapped["Category"] = relationship()
