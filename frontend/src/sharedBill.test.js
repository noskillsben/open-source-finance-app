import { describe, expect, it } from 'vitest'
import { basisFromSplit, basisFromTransaction, linesFromBasis, scaleBasis } from './sharedBill.js'

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

  it('reads a bill someone else paid back at the percentages of the split', () => {
    const transaction = { paid_by_payee_id: 20, account_lines: [{ account_id: 3, cents: -5000 }] }
    const { basis } = basisFromTransaction(transaction, SPLIT, 1)
    expect(basis.total).toBe(10000)
    expect(basis.mine).toBe(5000)
  })
})
