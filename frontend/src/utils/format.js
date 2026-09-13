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
