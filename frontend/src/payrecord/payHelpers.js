import { parseCents } from '../utils/format.js'

export const emptyRow = () => ({ category: {}, amount: '' })

// A pay split across accounts in the Ledger keeps its split: every line after the first stays as
// recorded, and the first takes the whole change in net.
export function correctedAccountLines(transaction, net) {
  const [primary, ...rest] = transaction.account_lines
  const recordedNet = transaction.account_lines.reduce((sum, l) => sum + l.cents, 0)
  return [
    { account_id: primary.account_id, cents: primary.cents + (net - recordedNet) },
    ...rest.map((l) => ({ account_id: l.account_id, cents: l.cents })),
  ]
}
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// The fixed ordinal scale (DESIGN.md § Need levels), in trim order: wants go first once the
// leftover is negative, so the rows most worth cutting are the ones on top. A category with no
// need level sorts after every leveled one, alongside the rest.
export const NEED_TRIM_ORDER = { want: 0, nice_to_have: 1, should: 2, need: 3 }

export function sortByNeedIfShort(rows, categoriesById, leftover) {
  if (leftover >= 0) return rows
  return [...rows].sort((a, b) => {
    const na = NEED_TRIM_ORDER[categoriesById.get(a.categoryId)?.need_level] ?? 4
    const nb = NEED_TRIM_ORDER[categoriesById.get(b.categoryId)?.need_level] ?? 4
    return na - nb
  })
}

export function rowsToMoves(rows) {
  const moves = []
  for (const r of rows) {
    const cents = parseCents(r.amount)
    if (r.category.id == null || !cents) continue
    if (cents > 0) moves.push({ category_id: r.category.id, cents })
  }
  return moves
}
