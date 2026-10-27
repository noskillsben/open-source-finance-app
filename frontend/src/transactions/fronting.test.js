import { describe, expect, it } from 'vitest'
import { billSourceRows, settleUpRows } from './fronting.js'
import { shareOut } from '../utils/shareOut.js'

const OWED = 9
const cents = (rows) => rows.map((r) => [r.other_category_id, r.cents])

describe('shareOut', () => {
  it('rounds toward zero and gives the leftover to the largest, first on a tie', () => {
    expect(shareOut(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(shareOut(7500, [5000, 2500])).toEqual([5000, 2500])
    expect(shareOut(10, [1, 3])).toEqual([2, 8])
    expect(shareOut(5, [])).toEqual([])
  })
})

describe('billSourceRows', () => {
  it('comes from the one category the bill spends from', () => {
    expect(cents(billSourceRows(5000, [{ category_id: '1', cents: '-50' }], OWED))).toEqual([['1', '50']])
  })
  it('is proportional across categories without losing a cent', () => {
    const rows = billSourceRows(7500, [{ category_id: '1', cents: '-50' }, { category_id: '2', cents: '-25' }], OWED)
    expect(cents(rows)).toEqual([['1', '50'], ['2', '25']])
    const odd = billSourceRows(1001, [{ category_id: '1', cents: '-1' }, { category_id: '2', cents: '-1' }, { category_id: '3', cents: '-1' }], OWED)
    expect(odd.reduce((s, r) => s + Number(r.cents) * 100, 0)).toBe(1001)
  })
  it('comes from ready to assign with no category lines', () => {
    expect(cents(billSourceRows(4000, [], OWED))).toEqual([['', '40']])
  })
})

describe('settleUpRows', () => {
  const member = 5
  const bill = (id, sign) => ({ id, account_lines: [{ account_id: member, cents: sign * 100 }] })
  const all = [
    { id: 1, deposits: [{ category_id: OWED, cents: 5000, other_category_id: 1 }] },
    { id: 2, deposits: [{ category_id: OWED, cents: 3000, other_category_id: null }] },
    { id: 3, deposits: [] },
  ]
  const txns = [bill(1, 1), bill(2, 1), bill(3, -1)]
  it('returns each source in full when the balance still equals what was fronted', () => {
    expect(cents(settleUpRows(8000, OWED, member, txns.slice(0, 2), all))).toEqual([['1', '50'], ['', '30']])
  })
  it('scales to the balance after a bill they paid, and to a part payment', () => {
    expect(cents(settleUpRows(6000, OWED, member, txns, all))).toEqual([['1', '37.5'], ['', '22.5']])
    const part = settleUpRows(2000, OWED, member, txns, all)
    expect(part.reduce((s, r) => s + Number(r.cents) * 100, 0)).toBe(2000)
  })
  it('sends what cannot be traced to ready to assign', () => {
    expect(cents(settleUpRows(4000, OWED, member, [bill(3, 1)], all))).toEqual([['', '40']])
    expect(cents(settleUpRows(10000, OWED, member, txns.slice(0, 1), all))).toEqual([['1', '50'], ['', '50']])
  })
})
