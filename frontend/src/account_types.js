// Mirrors backend/app/account_types.py — the account type enum (DESIGN.md § Account type).
// Grouped by budget side for the create-account dropdown, alphabetical within each group.
export const ON_BUDGET_TYPES = ['Cash', 'Chequing', 'Credit card', 'Savings']
export const TRACKING_TYPES = ['Asset', 'Investment', 'Line of credit', 'Loan', 'Mortgage', 'Payment plan']

// Default budget side pre-filled per type; the user can still change it.
export const DEFAULT_ON_BUDGET = Object.fromEntries([
  ...ON_BUDGET_TYPES.map((t) => [t, true]),
  ...TRACKING_TYPES.map((t) => [t, false]),
])

// Credit limit pre-filled per type (DESIGN.md § Credit limit): 0 means "no credit" for the
// types that have none; null means unknown, and stays blank until the user states it.
export const DEFAULT_CREDIT_LIMIT_CENTS = Object.fromEntries([
  ...['Cash', 'Chequing', 'Savings'].map((t) => [t, 0]),
  ...['Asset', 'Credit card', 'Investment', 'Line of credit', 'Loan', 'Mortgage', 'Payment plan'].map((t) => [t, null]),
])

// Types whose form opens the lender's-terms section by default (a form default — account type's
// first sanctioned consumer). Other types reach it through the "Add lender's terms" toggle.
export const DEBT_TYPES = ['Credit card', 'Line of credit', 'Loan', 'Mortgage', 'Payment plan']

// Mirrors backend/app/term_options.py — the closed lists a lender's terms choose from.
export const COMPOUNDING_RULES = ['daily', 'monthly', 'semi-annual']
export const PREPAYMENT_MODELS = ['open', 'closed with privileges', 'penalty']

// Debt types whose form pre-fills the boundary category with the seeded "Debt payments" (DESIGN.md
// § Accounts → Money crossing the budget boundary — a form default, account type's sanctioned use).
export const BOUNDARY_DEFAULT_TYPES = ['Line of credit', 'Loan', 'Mortgage', 'Payment plan']
export const BOUNDARY_DEFAULT_SEEDED_KEY = 'debt-payments'
