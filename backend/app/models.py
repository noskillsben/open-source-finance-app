"""SQLAlchemy models — the stored shape. Pydantic schemas (app/schemas.py) are the API shape; they never cross.

Tables arrive with the issues that build them, each as an Alembic revision.
Import this module wherever Base.metadata must know every table (alembic/env.py does).
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, NonLedger, Owned


def _seeded_key_index(table: str) -> Index:
    """One seeded default per key per owner; user-made rows (null key) are unconstrained."""
    return Index(
        f"ix_{table}_owner_seeded_key", "owner_id", "seeded_key",
        unique=True, postgresql_where=text("seeded_key IS NOT NULL"),
    )


class Account(Base, Owned, NonLedger):
    """Where money, debt or value is held (DESIGN.md § Accounts)."""

    __tablename__ = "account"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    on_budget: Mapped[bool] = mapped_column(nullable=False)
    on_budget_floor_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # The date the opening balance was first stated (DESIGN.md § Opening balance and
    # backfilling history). Set once at creation and never moved: `created_on` and the opening
    # valuation's date slide back on a backfill, this doesn't. A line dated before it is netted
    # into the opening; a line on or after it is plain activity.
    opening_stated_on: Mapped[date] = mapped_column(
        Date, nullable=False, default=lambda ctx: ctx.get_current_parameters()["created_on"]
    )

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
        _seeded_key_index("account"),
    )


class Valuation(Base, Owned):
    """A balance-check fact: 'on this date the real balance was X' (DESIGN.md § Balance checks)."""

    __tablename__ = "valuation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    balance_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)

    account: Mapped["Account"] = relationship(back_populates="valuations")


class Domain(Base, Owned, NonLedger):
    """A reporting label bigger than a category — Food holds Groceries, Fast food, Snacks
    (DESIGN.md § Domains). No rules hang off it beyond group-by.
    """

    __tablename__ = "domain"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index(
            "ix_domain_owner_lower_name", "owner_id", func.lower(name),
            unique=True, postgresql_where=text("archived_on IS NULL"),
        ),
        _seeded_key_index("domain"),
    )


class Category(Base, Owned, NonLedger):
    """What money is spent on and saved for (DESIGN.md § Categories). Goals and linked
    accounts are later issues; a pool is recorded here but draws from it are #19.
    """

    __tablename__ = "category"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Grouping for the tree view only — a parent is still postable like any other category
    # (DESIGN.md § Categories). Self-referential, so archiving cascades to children in one pass.
    parent_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=True, index=True)
    # The category this one draws on when it overspends; never itself, directly or by chain.
    pool_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=True, index=True)
    domain_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("domain.id"), nullable=True, index=True)
    # need / should / nice_to_have / want — a fixed ordinal (app/need_levels.py), not a table.
    need_level: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index(
            "ix_category_owner_lower_name", "owner_id", func.lower(name),
            unique=True, postgresql_where=text("archived_on IS NULL"),
        ),
        _seeded_key_index("category"),
    )


class CategoryAccountLink(Base, Owned):
    """Where a category's money physically lives (DESIGN.md § Accounts → Linked categories).
    A pure join, so no `NonLedger` mixin: archiving either side just removes its rows. The
    linked account is on-budget (the service enforces it).
    """

    __tablename__ = "category_account_link"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"), nullable=False, index=True)

    __table_args__ = (UniqueConstraint("category_id", "account_id", name="uq_category_account_link"),)


class Goal(Base, Owned, NonLedger):
    """A rule about a category, not a place money goes (DESIGN.md § Goals). One live goal per
    category. Every amount and term is nullable — null means the kind doesn't use it, never
    zero. `cadence_weeks` is N for "every N weeks" and set only when `cadence` is "weeks".
    `income_stream_id` binds the goal to the named pay that funds it (#21); a commitment's
    "add" amount may be `amount_cents` (fixed) or `percent_of_net` (resolved against the bound
    pay's net, never gross), never both — app/services/goals.py enforces exactly one flavour.
    """

    __tablename__ = "goal"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # recurring_bill / target / commitment (app/services/goals.py).
    kind: Mapped[str] = mapped_column(String, nullable=False)
    amount_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cadence: Mapped[str | None] = mapped_column(String, nullable=True)
    cadence_weeks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    level_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    income_stream_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("income_stream.id"), nullable=True, index=True
    )
    percent_of_net: Mapped[Decimal | None] = mapped_column(Numeric(9, 4), nullable=True)

    __table_args__ = (
        Index("ix_goal_category_live", "category_id", unique=True, postgresql_where=text("archived_on IS NULL")),
        # `target_date` is a recurring bill's first due date (#131). The column is shared with
        # targets, which may be dateless, so the rule is a CHECK rather than a NOT NULL.
        CheckConstraint("kind <> 'recurring_bill' OR target_date IS NOT NULL", name="ck_goal_recurring_bill_first_due"),
    )


class IncomeStream(Base, Owned, NonLedger):
    """A named pay: a planned recurring money event the user states, that goals attach to
    (DESIGN.md § Income streams). Next payday is `anchor_payday` rolled forward by the cadence
    at read time, never stored (app/services/cadence.py) — the same mechanism a recurring
    bill's due date uses. `income_stream_id` lands on the transaction header with the pay screen (#24).
    Goals bind here via `Goal.income_stream_id` (#21).
    """

    __tablename__ = "income_stream"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    payee_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("payee.id"), nullable=True, index=True)
    # monthly / quarterly / yearly / weeks (app/services/cadence.py); cadence_weeks is N for
    # "every N weeks" and set only when cadence is "weeks" — the same shape goals use, not a copy.
    cadence: Mapped[str] = mapped_column(String, nullable=False)
    cadence_weeks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    anchor_payday: Mapped[date] = mapped_column(Date, nullable=False)
    # Null when the user enters net only (DESIGN.md: null means unknown, never zero).
    expected_gross_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    expected_net_low_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expected_net_high_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    income_category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=False, index=True)
    destination_account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("account.id"), nullable=False, index=True)

    deductions: Mapped[list["IncomeStreamDeduction"]] = relationship(
        back_populates="income_stream", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "ix_income_stream_owner_lower_name", "owner_id", func.lower(name),
            unique=True, postgresql_where=text("archived_on IS NULL"),
        ),
    )


class IncomeStreamDeduction(Base, Owned):
    """One expected deduction on a named pay — category and amount, replaced as a set on save
    through the income stream's one write path (DESIGN.md § Income streams).
    """

    __tablename__ = "income_stream_deduction"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    income_stream_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("income_stream.id"), nullable=False, index=True
    )
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=False, index=True)
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)

    income_stream: Mapped["IncomeStream"] = relationship(back_populates="deductions")
    category: Mapped["Category"] = relationship()


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
        _seeded_key_index("payee"),
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
    # Which named pay this fulfilled (DESIGN.md § Income streams) — set only when the pay
    # screen writes this transaction, never reassigned on an edit, same rule as valuation_id.
    income_stream_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("income_stream.id"), nullable=True, index=True
    )
    # Which recurring bill this paid and which of its due dates (DESIGN.md § Goals → Paying a
    # bill) — stated by the user, never inferred, and set together or not at all.
    goal_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("goal.id"), nullable=True, index=True)
    goal_due_on: Mapped[date | None] = mapped_column(Date, nullable=True)

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
    # True when this line's cents were netted into the account's opening adjustment at write
    # time (DESIGN.md § Opening balance and backfilling history). Fixed then, like
    # `budget_cents`: edit and delete read it back rather than re-deriving it from a date, which
    # can't tell a backfill from plain activity once the opening has moved again.
    netted_into_opening: Mapped[bool] = mapped_column(nullable=False, default=False, server_default=text("false"))

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


class EarmarkLine(Base, Owned):
    """One signed move of on-budget money into or out of a category (DESIGN.md § Earmarks). A
    category's balance is its earmark lines plus its transaction category lines. `source` says
    what wrote the line: "move", "pay_batch", "pool_draw" (written by the transaction that
    overspent), "deposit" (the move a transfer into or out of a linked account directed) or
    "archive_sweep"; pool draws and deposits carry the generating transaction's id in
    `transaction_id`. Pay-batch lines carry `transaction_id` too, but only for navigation back to
    the paycheque — the batch is the user's decisions, not a consequence the transaction
    regenerates, and it is saved whole by one call that replaces every pay-batch line for that
    transaction (#126). A plain "move" never carries a transaction id.
    """

    __tablename__ = "earmark_line"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("category.id"), nullable=False, index=True)
    cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    transaction_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("transaction.id"), nullable=True, index=True
    )

    category: Mapped["Category"] = relationship()
