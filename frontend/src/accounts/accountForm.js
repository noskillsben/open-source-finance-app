import { DEFAULT_CREDIT_LIMIT_CENTS, DEFAULT_ON_BUDGET, ON_BUDGET_TYPES } from '../account_types.js'
import { emptyTermsText } from '../utils/terms.js'

export const VALUE_TYPES = ['Asset', 'Investment']

export const GROUP_BY_KEY = 'accounts.groupBy'
export const COLLAPSED_KEY = 'accounts.collapsed'
export const GROUP_OPTIONS = [{ value: 'side', label: 'Budget side' }, { value: 'type', label: 'Type' }]
export const DEFAULT_SORT = { key: 'name', dir: 'asc' }

// Group by and which groups are collapsed are per-device conveniences (DESIGN.md § Nested and grouped
// lists): localStorage, and the page works without it.
export function loadGroupBy() {
  try {
    const saved = localStorage.getItem(GROUP_BY_KEY)
    return GROUP_OPTIONS.some((o) => o.value === saved) ? saved : 'side'
  } catch {
    return 'side'
  }
}

export function loadCollapsed() {
  try {
    const keys = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return Array.isArray(keys) ? keys : []
  } catch {
    return []
  }
}

export function saveLocal(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // private window or blocked storage: the state just doesn't survive a reload
  }
}

// Blank string is null (unknown); "0.00" is 0 (no credit) — the form never collapses them.
export function creditLimitText(cents) {
  return cents === null || cents === undefined ? '' : String(cents / 100)
}

export function emptyForm(pickerDate) {
  return {
    name: '',
    type: ON_BUDGET_TYPES[0],
    on_budget: DEFAULT_ON_BUDGET[ON_BUDGET_TYPES[0]],
    on_budget_floor_cents: '0',
    credit_limit_cents: creditLimitText(DEFAULT_CREDIT_LIMIT_CENTS[ON_BUDGET_TYPES[0]]),
    locked_payee_id: null,
    boundary_category_id: null,
    linked_category_id: null, // create only: the one category a new account starts linked to
    opening_balance_cents: '',
    created_on: pickerDate,
    ...emptyTermsText(),
  }
}

export function emptyCheckForm(pickerDate) {
  return { date: pickerDate, stated_balance_cents: '', category_id: '' }
}
