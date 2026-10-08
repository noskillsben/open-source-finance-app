// The lender's terms (DESIGN.md § Debt terms) as the form edits them and the account row shows them.
import { formatDate } from './format.js'

// Every term the form edits as text, besides the credit limit (which has its own control).
// Blank is null (unknown); "0" is 0 — the form never collapses them.
export const TERM_TEXT_FIELDS = [
  'annual_rate', 'compounding_rule', 'statement_close_day', 'grace_days', 'term_end',
  'amortization_end', 'prepayment_model', 'promo_expiry_date', 'deferred_rate', 'minimum_payment_rule',
]

export function emptyTermsText() {
  return Object.fromEntries(TERM_TEXT_FIELDS.map((f) => [f, '']))
}

export function termsToText(terms) {
  return Object.fromEntries(TERM_TEXT_FIELDS.map((f) => [f, terms?.[f] == null ? '' : String(terms[f])]))
}

/** True when the account states any term besides the credit limit. */
export function hasLenderTerms(terms) {
  return TERM_TEXT_FIELDS.some((f) => terms?.[f] != null)
}

const WHOLE_NUMBER = /^\d+$/
const RATE = /^(\d+\.?\d*|\.\d+)$/

/** The form's text → the `terms` block fields, or `{ error }`. Rates go as the typed text (the
 * backend rounds half-even to four places); a blank is null, never 0. */
export function textToTerms(text) {
  const out = {}
  for (const field of TERM_TEXT_FIELDS) {
    const value = (text[field] ?? '').trim()
    if (value === '') out[field] = null
    else if (field === 'annual_rate' || field === 'deferred_rate') {
      if (!RATE.test(value.replace(/%$/, '').trim())) return { error: 'A rate must be a number, 0 or more.' }
      out[field] = value.replace(/%$/, '').trim()
    } else if (field === 'statement_close_day' || field === 'grace_days') {
      if (!WHOLE_NUMBER.test(value)) return { error: 'Statement close day and grace days must be whole numbers.' }
      out[field] = Number(value)
    } else out[field] = value
  }
  if (out.statement_close_day !== null && (out.statement_close_day < 1 || out.statement_close_day > 31)) {
    return { error: 'Statement close day must be 1 to 31.' }
  }
  return { terms: out }
}

function ordinal(n) {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`
}

function percent(text) {
  return `${Number(text)}%` // "5.9900" → "5.99%"
}

const PREPAYMENT_TEXT = {
  open: 'open prepayment',
  'closed with privileges': 'closed prepayment with privileges',
  penalty: 'prepayment penalty',
}

/** One soft line for the account's row: "5.99% · compounds daily · statement closes the 15th,
 * 21 days grace". Blank terms are left out; empty string when none are stated. */
export function termsLine(terms) {
  if (!terms) return ''
  const parts = []
  if (terms.annual_rate != null) parts.push(percent(terms.annual_rate))
  if (terms.compounding_rule != null) {
    parts.push(`compounds ${terms.compounding_rule === 'semi-annual' ? 'semi-annually' : terms.compounding_rule}`)
  }
  const statement = []
  if (terms.statement_close_day != null) statement.push(`statement closes the ${ordinal(terms.statement_close_day)}`)
  if (terms.grace_days != null) statement.push(`${terms.grace_days} ${terms.grace_days === 1 ? 'day' : 'days'} grace`)
  if (statement.length > 0) parts.push(statement.join(', '))
  if (terms.term_end != null) parts.push(`term ends ${formatDate(terms.term_end)}`)
  if (terms.amortization_end != null) parts.push(`amortized to ${formatDate(terms.amortization_end)}`)
  if (terms.prepayment_model != null) parts.push(PREPAYMENT_TEXT[terms.prepayment_model] ?? terms.prepayment_model)
  if (terms.promo_expiry_date != null) parts.push(`promo ends ${formatDate(terms.promo_expiry_date)}`)
  if (terms.deferred_rate != null) parts.push(`deferred rate ${percent(terms.deferred_rate)}`)
  if (terms.minimum_payment_rule != null) parts.push(`minimum payment: ${terms.minimum_payment_rule}`)
  return parts.join(' · ')
}
