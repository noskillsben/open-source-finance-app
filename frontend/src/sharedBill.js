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

/** The lines for a basis. Paid by me: my account pays the whole bill, each member's receivable
 * takes their share, and only my share is a category line. Paid by a member: nothing touches
 * my accounts — their receivable goes down by my share, and my share is the category line. */
export function linesFromBasis(basis, { sign = 1, payerIsMe, payerAccountId, payerMemberAccountId, categoryId }) {
  const accountLines = []
  if (payerIsMe) {
    accountLines.push({ account_id: payerAccountId, cents: -sign * basis.total })
    for (const m of basis.members) {
      if (m.cents !== 0) accountLines.push({ account_id: m.account_id, cents: sign * m.cents })
    }
  } else {
    accountLines.push({ account_id: payerMemberAccountId, cents: -sign * basis.mine })
  }
  const categoryLines = basis.mine === 0 ? [] : [{ category_id: categoryId, cents: -sign * basis.mine }]
  return { accountLines, categoryLines }
}

/** Read a saved shared bill back into a basis, so an edit rescales by the proportions on that
 * transaction. Returns null when the lines don't have the shape the form writes. */
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
  // Paid by a member: only my share is on the lines, so the total is read back at the split's
  // percentages. That only labels the "Bill total" box; every line still scales by its own ratio.
  if (ownLines.length !== 0 || memberLines.length !== 1 || memberLines[0].cents === 0) return null
  const sign = memberLines[0].cents < 0 ? 1 : -1
  const mine = Math.abs(memberLines[0].cents)
  const myUnits = 1_000_000 - split.members.reduce((sum, m) => sum + (parsePercent(m.percent) ?? 0), 0)
  const total = myUnits > 0 ? Math.round((mine * 1_000_000) / myUnits) : mine
  const fresh = basisFromSplit(total, split)
  return { sign, basis: { total, mine, members: fresh.members } }
}
