// One currency formatter and one date formatter for the whole app.
const currency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })
const date = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })

/** Integer cents → "$1,234.56". Money is cents everywhere until this line. */
export function formatCents(cents) {
  return currency.format((cents ?? 0) / 100)
}

/** ISO date "2026-09-12" → "Sep 12, 2026". Parsed at noon UTC so no timezone shifts the day. */
export function formatDate(iso) {
  if (!iso) return ''
  return date.format(new Date(`${iso}T12:00:00Z`))
}

/** "$1,234.56" or "-12.3" → integer cents. Money inputs are text, never type="number"
 * (phone keypads have no minus key), so every money field parses through this. */
export function parseCents(text) {
  const cleaned = (text ?? '').replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-') return null
  const dollars = Number(cleaned)
  if (Number.isNaN(dollars)) return null
  return Math.round(dollars * 100)
}

/** "33.5" or "40%" → a percent in ten-thousandths (335000), or null when it is not a number.
 * Rounds half-even at four decimal places, the same rule the backend stores with, so the share
 * shown as you type is the share that will be compared against 100%. */
export function parsePercent(text) {
  const match = /^(\d*)(?:\.(\d*))?$/.exec((text ?? '').replace(/[%\s]/g, ''))
  if (!match || (match[1] === '' && !match[2])) return null
  const whole = Number(match[1] || 0)
  const fraction = (match[2] ?? '').padEnd(5, '0')
  const units = whole * 10000 + Number(fraction.slice(0, 4))
  const rest = fraction.slice(4)
  const afterHalf = /^[6-9]/.test(rest) || /^5\d*[1-9]/.test(rest)
  const exactlyHalf = /^50*$/.test(rest)
  return units + (afterHalf || (exactlyHalf && units % 2 === 1) ? 1 : 0)
}

/** Ten-thousandths of a percent → "12.5%" (trailing zeros dropped). */
export function formatPercent(tenThousandths) {
  return `${Number((tenThousandths / 10000).toFixed(4))}%`
}

/** The browser's today as an ISO date, for seeding the header date picker. This is the one
 * place the wall clock is read for a date — the picker itself, per DESIGN.md's "one clock". */
export function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
