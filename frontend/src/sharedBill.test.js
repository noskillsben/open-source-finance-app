import { describe, expect, it } from 'vitest'
import { basisFromSplit, basisFromTransaction, linesFromBasis, scaleBasis, spreadCents } from './sharedBill.js'

const SPLIT = {
  id: 5,
  members: [{ payee_id: 20, account_id: 3, percent: '50.0000' }],
}
const THREE_WAY = {
  id: 6,
  members: [
    { payee_id: 20, account_id: 3, percent: '33.3333' },
    { payee_id: 21, account_id: 4, percent: '33.3333' },
  ],
}

describe('shared bill arithmetic', () => {
  it('a $100 bill at 50/50 puts $50 on the category and $50 on the roommate', () => {
    const basis = basisFromSplit(10000, SPLIT)
    expect(basis).toEqual({ total: 10000, mine: 5000, members: [{ account_id: 3, cents: 5000 }] })
    const { accountLines, categoryLines } = linesFromBasis(basis, {
      payerIsMe: true, payerAccountId: 1, categoryId: 10,
    })
    expect(accountLines).toEqual([{ account_id: 1, cents: -10000 }, { account_id: 3, cents: 5000 }])
    expect(categoryLines).toEqual([{ category_id: 10, cents: -5000 }])
  })

  it('my share is the remainder, so the parts always add up to the total', () => {
    const basis = basisFromSplit(10000, THREE_WAY)
    expect(basis.members.map((m) => m.cents)).toEqual([3333, 3333])
    expect(basis.mine).toBe(3334)
  })

  it('when someone else paid, only their account and my share are written', () => {
    const { accountLines, categoryLines } = linesFromBasis(basisFromSplit(10000, SPLIT), {
      payerIsMe: false, payerMemberAccountId: 3, categoryId: 10,
    })
    expect(accountLines).toEqual([{ account_id: 3, cents: -5000 }])
    expect(categoryLines).toEqual([{ category_id: 10, cents: -5000 }])
  })

  it('rescales by the proportions already on the bill, so a one-off 60/40 survives', () => {
    const transaction = {
      paid_by_payee_id: 1,
      account_lines: [{ account_id: 1, cents: -10000 }, { account_id: 3, cents: 4000 }],
    }
    const { basis, sign } = basisFromTransaction(transaction, SPLIT, 1)
    expect(sign).toBe(1)
    expect(basis).toEqual({ total: 10000, mine: 6000, members: [{ account_id: 3, cents: 4000 }] })
    expect(scaleBasis(basis, 20000)).toEqual({ total: 20000, mine: 12000, members: [{ account_id: 3, cents: 8000 }] })
  })

  it('reads a bill someone else paid from its stored total, whatever the split says now', () => {
    // $90 Sam paid, my share $30 — a third, though the split is 50% now.
    const transaction = { paid_by_payee_id: 20, shared_total_cents: 9000, account_lines: [{ account_id: 3, cents: -3000 }] }
    const { basis, sign } = basisFromTransaction(transaction, SPLIT, 1)
    expect(sign).toBe(1)
    expect(basis).toEqual({ total: 9000, mine: 3000, members: [{ account_id: 3, cents: 6000 }] })
    expect(scaleBasis(basis, 18000).mine).toBe(6000)
  })

  it('leaves a bill someone else paid locked when it has no stored total', () => {
    const transaction = { paid_by_payee_id: 20, shared_total_cents: null, account_lines: [{ account_id: 3, cents: -5000 }] }
    expect(basisFromTransaction(transaction, SPLIT, 1)).toBeNull()
  })
})

describe('one bill across several categories', () => {
  const cats = (...receipts) => receipts.map((receipt, i) => ({ category_id: 10 + i, receipt }))

  it('a $150 run as Groceries 100 and Household 50 at 50/50 is −50 and −25, with Sam +75', () => {
    const { accountLines, categoryLines } = linesFromBasis(basisFromSplit(15000, SPLIT), {
      payerIsMe: true, payerAccountId: 1, categories: cats(10000, 5000),
    })
    expect(accountLines).toEqual([{ account_id: 1, cents: -15000 }, { account_id: 3, cents: 7500 }])
    expect(categoryLines).toEqual([{ category_id: 10, cents: -5000 }, { category_id: 11, cents: -2500 }])
  })

  it('odd cents across three categories still add up exactly to my share', () => {
    const basis = basisFromSplit(333, SPLIT) // Sam 167 (half rounds up), me 166
    const { categoryLines } = linesFromBasis(basis, { payerIsMe: true, payerAccountId: 1, categories: cats(111, 111, 111) })
    expect(categoryLines.map((l) => l.cents)).toEqual([-56, -55, -55]) // leftover cent to the first of a tie
    expect(categoryLines.reduce((sum, l) => sum + l.cents, 0)).toBe(-basis.mine)
  })

  it('leftover cents go to the largest receipt amount', () => {
    expect(spreadCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(spreadCents(101, [1, 2, 1])).toEqual([25, 51, 25])
  })

  it('a bill someone else paid spreads my share the same way, off their account', () => {
    const { accountLines, categoryLines } = linesFromBasis(basisFromSplit(15000, SPLIT), {
      payerIsMe: false, payerMemberAccountId: 3, categories: cats(10000, 5000),
    })
    expect(accountLines).toEqual([{ account_id: 3, cents: -7500 }])
    expect(categoryLines.map((l) => l.cents)).toEqual([-5000, -2500])
  })

  it('a refund flips every line', () => {
    const { categoryLines } = linesFromBasis(basisFromSplit(15000, SPLIT), {
      sign: -1, payerIsMe: true, payerAccountId: 1, categories: cats(10000, 5000),
    })
    expect(categoryLines.map((l) => l.cents)).toEqual([5000, 2500])
  })
})
