import { parseCents } from '../utils/format.js'

export const emptyLine = { account_id: '', cents: '' }
export const emptyCategoryLine = { category_id: '', cents: '', receipt: '' }
// A new form starts on Spent, as Quick add does: the Amount holds just the sign until digits arrive.
// A bare sign is a blank Amount wherever it is read.
export const NEW_AMOUNT = '-'
export const readable = (text) => (parseCents(text) === null ? '' : text)
export const emptyDeposit = { category_id: '', cents: '', other_category_id: '' }

// One Amount is typed once (DESIGN.md § Transactions): what the transaction cost or brought in, or on
// a plain transfer what moved. A side with one line takes it; a transfer (two account lines, no
// category) takes it and its opposite; anything else shows a box per line.
export const negate = (text) => {
  const t = (text ?? '').trim()
  if (t === '') return ''
  return /^[-−]/.test(t) ? t.replace(/^[-−]\s*/, '') : `-${t}`
}
export const isTransfer = (accountCount, categoryCount) => accountCount === 2 && categoryCount === 0
export const accountSideDerived = (accountCount, categoryCount) => accountCount === 1 || isTransfer(accountCount, categoryCount)

// The lines a typed Amount fills in, on the sides that derive from it. A chosen split is worked out
// by the split's own arithmetic instead, so its lines are left alone.
export function deriveLines(typed, aLines, cLines) {
  const amount = readable(typed)
  const a = accountSideDerived(aLines.length, cLines.length)
    ? aLines.map((l, i) => ({ ...l, cents: i === 0 ? amount : negate(amount) }))
    : aLines
  const c = cLines.length === 1 ? cLines.map((l) => ({ ...l, cents: amount })) : cLines
  return { a, c }
}

// One function picks the shape from lines already worked out (a saved transaction, Settle up, Record,
// Quick add's More details): Amount is the category lines' sum, else the first account line; a side
// whose lines are not what the Amount would derive keeps its boxes.
export function readShape(aLines, cLines) {
  let amount = ''
  if (cLines.length === 1) amount = cLines[0].cents
  else if (cLines.length > 1) {
    const cents = cLines.map((l) => parseCents(l.cents))
    amount = cents.some((c) => c === null) ? '' : String(cents.reduce((x, y) => x + y, 0) / 100)
  } else if (aLines.length) amount = aLines[0].cents
  const want = parseCents(amount)
  const held = (l) => parseCents(l.cents)
  const forceA =
    accountSideDerived(aLines.length, cLines.length) &&
    aLines.some((l, i) => held(l) !== (i === 0 || want === null ? want : -want))
  const forceC = cLines.length === 1 && held(cLines[0]) !== want
  return { amount, forceA, forceC }
}

// +1 for a bill paid (Spent), -1 for a refund (Received); a blank or unsigned-zero Amount reads as paid.
export const splitSign = (text) => {
  const cents = parseCents(text)
  return cents === null || cents === 0 ? 1 : cents < 0 ? 1 : -1
}
