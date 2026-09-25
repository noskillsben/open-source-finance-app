"""Pydantic models — the API shape. Never persisted."""
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, field_serializer, field_validator, model_validator

from app.account_types import ACCOUNT_TYPES
from app.need_levels import NEED_LEVELS


class Health(BaseModel):
    status: str
    database: str
    app_mode: str


class DebtTerms(BaseModel):
    """All fields nullable — null means unknown, never zero (DESIGN.md § Debt terms)."""

    credit_limit_cents: int | None = None
    annual_rate: Decimal | None = None
    compounding_rule: str | None = None
    statement_close_day: int | None = None
    grace_days: int | None = None
    term_end: date | None = None
    amortization_end: date | None = None
    prepayment_model: str | None = None
    promo_expiry_date: date | None = None
    deferred_rate: Decimal | None = None
    minimum_payment_rule: str | None = None

    @field_serializer("annual_rate", "deferred_rate")
    def _rate_as_string(self, value: Decimal | None) -> str | None:
        """Rates leave the API as exact strings at the column's four places (`"5.9900"`), never
        a float. Rounding: half-even at four decimal places, matching `Numeric(9, 4)`.
        """
        if value is None:
            return None
        return format(value.quantize(Decimal("0.0001")), "f")


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
    # Linked categories (DESIGN.md § Linked categories): who claims this account's money, and
    # the account minus what they hold — null with no links. A reminder, never enforced.
    linked_category_ids: list[int] = []
    drift_cents: int | None = None
    checked_on: date | None = None
    checked_valuation_id: int | None = None
    entries_added_since_check: int = 0
    notes: list[str] = []
    terms: DebtTerms = DebtTerms()

    model_config = {"from_attributes": True}


def _need_level_is_known(value: str | None) -> str | None:
    if value is not None and value not in NEED_LEVELS:
        raise ValueError(f"unknown need level {value!r}")
    return value


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    created_on: date
    parent_id: int | None = None
    pool_id: int | None = None
    domain_id: int | None = None
    need_level: str | None = None

    _need_level = field_validator("need_level")(_need_level_is_known)


class CategoryUpdate(BaseModel):
    """Editable category settings — no `created_on`, which archiving's ledger bound reads."""

    name: str = Field(min_length=1)
    parent_id: int | None = None
    pool_id: int | None = None
    domain_id: int | None = None
    need_level: str | None = None

    _need_level = field_validator("need_level")(_need_level_is_known)


class LinkedAccountOut(BaseModel):
    id: int
    name: str
    type: str

    model_config = {"from_attributes": True}


class CategoryOut(BaseModel):
    id: int
    name: str
    parent_id: int | None
    pool_id: int | None
    domain_id: int | None
    need_level: str | None
    created_on: date
    archived_on: date | None
    linked_accounts: list[LinkedAccountOut] = []

    model_config = {"from_attributes": True}


class CategoryLinksIn(BaseModel):
    """Replace a category's linked accounts. `on` is the picker date, used only to refuse an
    account archived by then."""

    on: date
    account_ids: list[int]


class DomainCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    created_on: date


class DomainUpdate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None


class DomainOut(BaseModel):
    id: int
    name: str
    description: str | None
    created_on: date
    archived_on: date | None

    model_config = {"from_attributes": True}


class ArchiveIn(BaseModel):
    """Archiving is the only "delete"; it defaults to the picker date in the UI, but the
    backend never reads the wall clock, so the caller always states the date explicitly.
    """

    archived_on: date


class EarmarkMoveIn(BaseModel):
    """One move of `cents` (positive) from one category to another; a null side is ready to
    assign. The caller states the date (the picker date) — the backend never reads the clock.
    `transaction_id` is accepted only to be refused: pay-batch lines are saved whole through
    `PUT /api/transactions/{id}/pay-batch`, never one move at a time (DESIGN.md § Earmarks).
    """

    date: date
    from_category_id: int | None = None
    to_category_id: int | None = None
    cents: int
    transaction_id: int | None = None


class PayBatchLineIn(BaseModel):
    """One signed pay-batch line; its date is the transaction's."""

    category_id: int
    cents: int


class PayBatchIn(BaseModel):
    """Every pay-batch line for one transaction — the whole batch, replacing whatever was there
    (DESIGN.md § Earmarks). An empty list removes the batch.
    """

    lines: list[PayBatchLineIn]


class EarmarkLineOut(BaseModel):
    id: int
    date: date
    category_id: int
    cents: int
    source: str
    transaction_id: int | None = None

    model_config = {"from_attributes": True}


class CategoryAvailableOut(BaseModel):
    category_id: int
    available_cents: int
    pool_available_cents: int = 0


class ReadyToAssignOut(BaseModel):
    """Both headline numbers at `as_of`, plus each category's available amount."""

    ready_to_assign_cents: int
    overspent_cents: int
    categories: list[CategoryAvailableOut]


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
    created_on: date
    archived_on: date | None

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


class DepositIn(BaseModel):
    """One envelope a transfer into (or out of) a linked account funds (or drains): `cents` is
    positive; `other_category_id` is where it comes from (or goes to), null for ready to assign.
    """

    category_id: int
    cents: int
    other_category_id: int | None = None


class TransactionCreate(BaseModel):
    date: date
    memo: str | None = None
    payee_id: int | None = None
    income_stream_id: int | None = None
    account_lines: list[AccountLineIn] = Field(min_length=1)
    category_lines: list[CategoryLineIn] = []
    # Omitted or empty: "already earmarked" — no deposit lines (DESIGN.md § Linked categories).
    deposits: list[DepositIn] = []


class TransactionOut(BaseModel):
    id: int
    date: date
    memo: str | None
    payee_id: int | None
    valuation_id: int | None
    income_stream_id: int | None
    account_lines: list[AccountLineOut]
    category_lines: list[CategoryLineOut]
    deposits: list[DepositIn] = []
    notes: list[str] = []

    model_config = {"from_attributes": True}


class BalanceCheckIn(BaseModel):
    """DESIGN.md § Balance checks — one table: a stated balance on a date, and where the
    difference goes if there is one. Unassigned by default (category_id omitted or null).
    """

    date: date
    stated_balance_cents: int
    category_id: int | None = None
    # The adjustment's category lines as edited (the linked-category split); wins over
    # `category_id` when present.
    category_lines: list[CategoryLineIn] | None = None


class BalanceCheckPreviewOut(BaseModel):
    """What a balance check would find, and the linked-category split it would suggest."""

    diff_cents: int
    category_lines: list[CategoryLineIn]


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


class GoalIn(BaseModel):
    """Set (create or replace) a category's goal. `on` is the picker date: it becomes
    `created_on` of a new goal and is never read otherwise. `income_stream_id` binds the goal to
    the named pay that funds it; a Commitment's "add" amount is `amount_cents` (fixed) or
    `percent_of_net` (resolved against that pay's net at read time), never both.
    """

    on: date
    name: str = Field(min_length=1)
    kind: str
    amount_cents: int | None = None
    cadence: str | None = None
    cadence_weeks: int | None = None
    target_date: date | None = None
    level_cents: int | None = None
    income_stream_id: int | None = None
    percent_of_net: Decimal | None = None

    @model_validator(mode="after")
    def _bill_needs_first_due_date(self):
        # A recurring bill's due dates are `target_date` stepped forward by cadence; no cycle
        # exists before it (#131). Structural validation, so a 422.
        if self.kind == "recurring_bill" and self.target_date is None:
            raise ValueError("A recurring bill needs a first due date.")
        return self


class GoalOut(BaseModel):
    id: int
    category_id: int
    name: str
    kind: str
    amount_cents: int | None
    cadence: str | None
    cadence_weeks: int | None
    target_date: date | None
    level_cents: int | None
    income_stream_id: int | None
    percent_of_net: Decimal | None
    created_on: date
    archived_on: date | None

    @field_serializer("percent_of_net")
    def _percent_as_string(self, value: Decimal | None) -> str | None:
        """Leaves the API as an exact string at the column's four places, never a float —
        the same convention as a debt account's rates (DebtTerms)."""
        if value is None:
            return None
        return format(value.quantize(Decimal("0.0001")), "f")

    model_config = {"from_attributes": True}


class IncomeStreamDeductionIn(BaseModel):
    category_id: int
    amount_cents: int


class IncomeStreamDeductionOut(BaseModel):
    id: int
    category_id: int
    amount_cents: int

    model_config = {"from_attributes": True}


class IncomeStreamIn(BaseModel):
    """Create (or replace the settings of) a named pay. `on` is the picker date: it becomes
    `created_on` of a new stream and is never read otherwise.
    """

    on: date
    name: str = Field(min_length=1)
    payee_id: int | None = None
    cadence: str
    cadence_weeks: int | None = None
    anchor_payday: date
    expected_gross_cents: int | None = None
    expected_net_low_cents: int
    expected_net_high_cents: int
    income_category_id: int
    destination_account_id: int
    deductions: list[IncomeStreamDeductionIn] = []


class IncomeStreamOut(BaseModel):
    id: int
    name: str
    payee_id: int | None
    cadence: str
    cadence_weeks: int | None
    anchor_payday: date
    expected_gross_cents: int | None
    expected_net_low_cents: int
    expected_net_high_cents: int
    income_category_id: int
    destination_account_id: int
    deductions: list[IncomeStreamDeductionOut] = []
    created_on: date
    archived_on: date | None
    next_payday: date

    model_config = {"from_attributes": True}


class GoalProgressOut(BaseModel):
    """A goal with its progress on `as_of`. `target_cents` is what the balance is compared to
    (null for an "add" commitment, which has no target); `owed_cents` is the shortfall to it.
    `due_by_next_payday_cents` is what the pay screen (#107) pre-fills — null for a goal with no
    bound pay, or with no due date (DESIGN.md § Goals).
    """

    goal: GoalOut
    balance_cents: int
    target_cents: int | None
    owed_cents: int | None
    due_date: date | None
    per_period_cents: int | None
    due_by_next_payday_cents: int | None
