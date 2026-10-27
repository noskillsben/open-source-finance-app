import { parseCents } from '../utils/format.js'
import { shareOut } from '../utils/shareOut.js'

const row = (linkedId, cents, sourceId) => ({
  category_id: String(linkedId),
  cents: String(cents / 100),
  other_category_id: sourceId == null ? '' : String(sourceId),
})

// Money into a linked account on a transaction with category lines (a shared bill I paid): the step
// comes from the bill's own categories, in proportion to their spending lines; none, ready to assign.
export function billSourceRows(directed, categoryLines, linkedId) {
  const weights = new Map()
  for (const line of categoryLines) {
    const cents = parseCents(line.cents)
    if (!line.category_id || cents === null || cents >= 0 || Number(line.category_id) === linkedId) continue
    const id = Number(line.category_id)
    weights.set(id, (weights.get(id) ?? 0) + -cents)
  }
  if (weights.size === 0) return [row(linkedId, directed, null)]
  const ids = [...weights.keys()]
  const shares = shareOut(directed, ids.map((id) => weights.get(id)))
  return ids.map((id, i) => row(linkedId, shares[i], id)).filter((r) => r.cents !== '0')
}

// Money out of a split member's account (a settle-up): what the bills fronted into the linked category
// since the balance last stood at zero, by where it came from, scaled to the amount leaving. Bills the
// member paid lower the balance without fronting, so the sources are scaled, not summed; whatever cannot
// be traced goes back to ready to assign.
export function settleUpRows(amount, linkedId, accountId, balanceTransactions) {
  const sources = new Map() // other_category_id (null: ready to assign) -> cents fronted
  for (const t of balanceTransactions ?? []) {
    const movedIn = t.account_lines.some((l) => l.account_id === accountId && l.cents > 0)
    if (!movedIn) continue
    for (const d of t.deposits ?? []) {
      if (d.category_id !== linkedId) continue
      const key = d.other_category_id ?? null
      sources.set(key, (sources.get(key) ?? 0) + d.cents)
    }
  }
  const keys = [...sources.keys()]
  const traced = Math.min(amount, keys.reduce((sum, k) => sum + sources.get(k), 0))
  const shares = shareOut(traced, keys.map((k) => sources.get(k)))
  const result = new Map()
  keys.forEach((k, i) => result.set(k, shares[i]))
  result.set(null, (result.get(null) ?? 0) + amount - traced)
  return [...result.entries()].filter(([, cents]) => cents > 0).map(([k, cents]) => row(linkedId, cents, k))
}
