"""Pydantic models — the API shape. Never persisted."""
from datetime import date

from pydantic import BaseModel, Field, field_validator

from app.account_types import ACCOUNT_TYPES


class Health(BaseModel):
    status: str
    database: str
    app_mode: str


class DebtTerms(BaseModel):
    """All fields nullable — null means unknown, never zero (DESIGN.md § Debt terms)."""

    credit_limit_cents: int | None = None
    annual_rate: float | None = None
    compounding_rule: str | None = None
    statement_close_day: int | None = None
    grace_days: int | None = None
    term_end: date | None = None
    amortization_end: date | None = None
    prepayment_model: str | None = None
    promo_expiry_date: date | None = None
    deferred_rate: float | None = None
    minimum_payment_rule: str | None = None


class AccountCreate(BaseModel):
    name: str = Field(min_length=1)
    created_on: date
    type: str
    on_budget: bool
    on_budget_floor_cents: int = 0
    opening_balance_cents: int
    terms: DebtTerms = DebtTerms()

    @field_validator("type")
    @classmethod
    def type_is_known(cls, value: str) -> str:
        if value not in ACCOUNT_TYPES:
            raise ValueError(f"unknown account type {value!r}")
        return value


class AccountUpdate(BaseModel):
    """Editable account settings (DESIGN.md § Settings never rewrite history) — no
    `created_on`/`opening_balance_cents`, those belong to the account's opening valuation.
    """

    name: str = Field(min_length=1)
    type: str
    on_budget: bool
    on_budget_floor_cents: int = 0
    terms: DebtTerms = DebtTerms()

    @field_validator("type")
    @classmethod
    def type_is_known(cls, value: str) -> str:
        if value not in ACCOUNT_TYPES:
            raise ValueError(f"unknown account type {value!r}")
        return value


class AccountOut(BaseModel):
    id: int
    name: str
    created_on: date
    archived_on: date | None
    type: str
    on_budget: bool
    on_budget_floor_cents: int
    balance_cents: int
    checked_on: date | None = None
    checked_valuation_id: int | None = None
    entries_added_since_check: int = 0
    notes: list[str] = []

    model_config = {"from_attributes": True}


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    created_on: date
    parent_id: int | None = None


class CategoryOut(BaseModel):
    id: int
    name: str
    parent_id: int | None
    created_on: date
    archived_on: date | None

    model_config = {"from_attributes": True}


class ArchiveIn(BaseModel):
    """Archiving is the only "delete"; it defaults to the picker date in the UI, but the
    backend never reads the wall clock, so the caller always states the date explicitly.
    """

    archived_on: date


class ArchiveOut(BaseModel):
    id: int
    archived_on: date | None
    warnings: list[str] = []


class PayeeCreate(BaseModel):
    name: str = Field(min_length=1)
    created_on: date


class PayeeOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class AccountLineIn(BaseModel):
    account_id: int
    cents: int


class AccountLineOut(BaseModel):
    id: int
    account_id: int
    cents: int
    budget_cents: int

    model_config = {"from_attributes": True}


class CategoryLineIn(BaseModel):
    category_id: int
    cents: int
    need_level: str | None = None


class CategoryLineOut(BaseModel):
    id: int
    category_id: int
    cents: int
    need_level: str | None

    model_config = {"from_attributes": True}


class TransactionCreate(BaseModel):
    date: date
    memo: str | None = None
    payee_id: int | None = None
    account_lines: list[AccountLineIn] = Field(min_length=1)
    category_lines: list[CategoryLineIn] = []


class TransactionOut(BaseModel):
    id: int
    date: date
    memo: str | None
    payee_id: int | None
    valuation_id: int | None
    account_lines: list[AccountLineOut]
    category_lines: list[CategoryLineOut]
    notes: list[str] = []

    model_config = {"from_attributes": True}


class BalanceCheckIn(BaseModel):
    """DESIGN.md § Balance checks — one table: a stated balance on a date, and where the
    difference goes if there is one. Unassigned by default (category_id omitted or null).
    """

    date: date
    stated_balance_cents: int
    category_id: int | None = None


class BalanceCheckOut(BaseModel):
    valuation_id: int
    diff_cents: int
    transaction: TransactionOut | None
    account: AccountOut


class IntegrityFindingOut(BaseModel):
    """One replayed mismatch (DESIGN.md § Transactions → Invariant). `payee_id` is resolved
    to a name client-side, same as everywhere else a transaction is listed.
    """

    transaction_id: int
    date: date
    payee_id: int | None
    kind: str
    expected_cents: int
    stored_cents: int

    model_config = {"from_attributes": True}
