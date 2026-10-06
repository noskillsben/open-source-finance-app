// The Ledger form's split arithmetic (DESIGN.md § Splits → "The form does the arithmetic").
// The backend never generates these lines; it stores whatever the form sends.
//
// A "basis" is an unsigned breakdown of one shared bill, in integer cents:
//   { total, mine, members: [{ account_id, cents }] }   with  mine + Σ members = total
// `sign` (+1 for spending, −1 for a refund) is applied only when lines are built.
//
// Rounding: a member's share is total × percent, rounded to the nearest cent with halves
// going up; my share is whatever the members leave, so the parts always add to the total.
import { parsePercent } from './utils/format.js'

/** Spread `amount` cents across rows in proportion to their (unsigned) `weights`. Each part is
 * rounded toward zero; the leftover cents go to the row with the largest weight, the first row
 * when weights tie, so the parts always add to `amount`. With no weight at all (nothing typed
 * yet) the first row takes the lot. Used for my share across categories (by receipt amount) and
 * for rescaling the receipt amounts when the Bill total changes. */
export function spreadCents(amount, weights) {
  if (weights.length === 0) return []
  const sum = weights.reduce((a, w) => a + w, 0)
  if (sum === 0) return weights.map((_, i) => (i === 0 ? amount : 0))
  const parts = weights.map((w) => {
    const product = amount * w
    return (product - (product % sum)) / sum
  })
  let largest = 0
  weights.forEach((w, i) => {
    if (w > weights[largest]) largest = i
  })
  parts[largest] += amount - parts.reduce((a, c) => a + c, 0)
  return parts
}

/** A fresh bill: each member's share from the split's percentages, mine the remainder. */
export function basisFromSplit(total, split) {
  const members = split.members.map((m) => ({
    account_id: m.account_id,
    cents: Math.round((total * (parsePercent(m.percent) ?? 0)) / 1_000_000),
  }))
  return { total, mine: total - members.reduce((sum, m) => sum + m.cents, 0), members }
}

/** The same bill at a new total, keeping the proportions already on it — never the split's
 * current percentages. A one-off 60/40 stays 60/40. Same rounding as `basisFromSplit`. */
export function scaleBasis(basis, newTotal) {
  if (basis.total === 0) return null
  const members = basis.members.map((m) => ({
    ...m,
    cents: Math.round((m.cents * newTotal) / basis.total),
  }))
  return { total: newTotal, mine: newTotal - members.reduce((sum, m) => sum + m.cents, 0), members }
}

/** Receipt amounts (unsigned cents) for a bill of `total`: the typed ones when they already add
 * to it, otherwise rescaled by the same ratio, so a new Bill total moves every category together. */
export function receiptsForTotal(total, typed) {
  return typed.reduce((a, c) => a + c, 0) === total ? typed : spreadCents(total, typed)
}

/** The lines for a basis. `categories` is one `{ category_id, receipt }` per category row, the
 * receipt amounts (unsigned cents) adding to the total; my share is spread across them pro rata
 * (`spreadCents`). `categoryId` alone is one row carrying the whole bill. Paid by me: my account pays the whole bill, each member's receivable
 * takes their share, and only my share is a category line. Paid by a member: nothing touches
 * my accounts — their receivable goes down by my share, and my share is the category line. */
export function linesFromBasis(basis, { sign = 1, payerIsMe, payerAccountId, payerMemberAccountId, categoryId, categories }) {
  const accountLines = []
  if (payerIsMe) {
    accountLines.push({ account_id: payerAccountId, cents: -sign * basis.total })
    for (const m of basis.members) {
      if (m.cents !== 0) accountLines.push({ account_id: m.account_id, cents: sign * m.cents })
    }
  } else {
    accountLines.push({ account_id: payerMemberAccountId, cents: -sign * basis.mine })
  }
  const rows = categories ?? [{ category_id: categoryId, receipt: basis.total }]
  const shares = spreadCents(basis.mine, rows.map((r) => r.receipt))
  const categoryLines =
    basis.mine === 0
      ? []
      : rows.map((r, i) => ({ category_id: r.category_id, cents: shares[i] === 0 ? 0 : -sign * shares[i] }))
  return { accountLines, categoryLines }
}

/** Read a saved shared bill back into a basis, so an edit rescales by the proportions on that
 * transaction — my share ÷ the bill total (my account line when I paid, `shared_total_cents` when
 * someone else did). Returns null when the lines or the stored total don't have the shape the
 * form writes, and the bill stays hand-editable. */
export function basisFromTransaction(transaction, split, mePayeeId) {
  const memberByAccount = new Map(split.members.map((m) => [m.account_id, m]))
  const memberLines = transaction.account_lines.filter((l) => memberByAccount.has(l.account_id))
  const ownLines = transaction.account_lines.filter((l) => !memberByAccount.has(l.account_id))
  if (transaction.paid_by_payee_id === mePayeeId) {
    if (ownLines.length !== 1 || ownLines[0].cents === 0) return null
    const sign = ownLines[0].cents < 0 ? 1 : -1
    const total = Math.abs(ownLines[0].cents)
    const members = memberLines.map((l) => ({ account_id: l.account_id, cents: sign * l.cents }))
    return { sign, basis: { total, mine: total - members.reduce((sum, m) => sum + m.cents, 0), members } }
  }
  // Paid by a member: only my share is on the lines, and the whole bill is the stored
  // `shared_total_cents`. A bill saved without it has nothing to rescale by, so it stays locked.
  const total = transaction.shared_total_cents
  if (total == null || total <= 0) return null
  if (ownLines.length !== 0 || memberLines.length !== 1 || memberLines[0].cents === 0) return null
  const sign = memberLines[0].cents < 0 ? 1 : -1
  const mine = Math.abs(memberLines[0].cents)
  if (mine > total) return null
  // The others' side of the bill is only needed if Paid by is later switched to Me; it is spread
  // over the split's members in proportion to their percentages, the last taking the remainder.
  const others = total - mine
  const units = split.members.reduce((sum, m) => sum + (parsePercent(m.percent) ?? 0), 0)
  if (others > 0 && units === 0) return null
  let left = others
  const members = split.members.map((m, i) => {
    const cents = i === split.members.length - 1 ? left : Math.round((others * (parsePercent(m.percent) ?? 0)) / units)
    left -= cents
    return { account_id: m.account_id, cents }
  })
  return { sign, basis: { total, mine, members } }
}
