// Mirrors backend/app/account_types.py — the account type enum (DESIGN.md § Account type).
// Grouped by budget side for the create-account dropdown, alphabetical within each group.
export const ON_BUDGET_TYPES = ['Cash', 'Chequing', 'Credit card', 'Savings']
export const TRACKING_TYPES = ['Asset', 'Investment', 'Line of credit', 'Loan', 'Mortgage', 'Payment plan']

// Default budget side pre-filled per type; the user can still change it.
export const DEFAULT_ON_BUDGET = Object.fromEntries([
  ...ON_BUDGET_TYPES.map((t) => [t, true]),
  ...TRACKING_TYPES.map((t) => [t, false]),
])
