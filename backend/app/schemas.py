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


class AccountOut(BaseModel):
    id: int
    name: str
    created_on: date
    type: str
    on_budget: bool
    on_budget_floor_cents: int
    balance_cents: int

    model_config = {"from_attributes": True}
