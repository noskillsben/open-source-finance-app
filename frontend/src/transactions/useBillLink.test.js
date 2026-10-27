import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api.js'
import { useBillLink } from './useBillLink.js'

const accounts = [{ id: 7, linked_category_ids: [13] }]
const base = { accounts, categories: [], goals: [], editingId: null, date: '2026-10-05' }

afterEach(() => vi.restoreAllMocks())

describe('useBillLink: follow the money (#443)', () => {
  it('a shared bill I paid is held back from its own categories', async () => {
    vi.spyOn(api.accounts, 'balance').mockResolvedValue({ balance_cents: 0 })
    const { result } = renderHook(() =>
      useBillLink({
        ...base,
        accountLines: [{ account_id: '7', cents: '75' }],
        categoryLines: [{ category_id: '1', cents: '-50' }, { category_id: '2', cents: '-25' }],
      })
    )
    await waitFor(() => expect(result.current.deposits).toHaveLength(2))
    expect(result.current.deposits.map((d) => [d.other_category_id, d.cents])).toEqual([['1', '50'], ['2', '25']])
  })

  it('a settle-up goes back to the categories that fronted it', async () => {
    vi.spyOn(api.accounts, 'balance').mockResolvedValue({ balance_cents: 8000 })
    vi.spyOn(api.splits, 'balance').mockResolvedValue({
      transactions: [{ id: 1, account_lines: [{ account_id: 7, cents: 5000 }] }, { id: 2, account_lines: [{ account_id: 7, cents: 3000 }] }],
    })
    vi.spyOn(api.transactions, 'list').mockResolvedValue([
      { id: 1, deposits: [{ category_id: 13, cents: 5000, other_category_id: 1 }] },
      { id: 2, deposits: [{ category_id: 13, cents: 3000, other_category_id: null }] },
    ])
    const { result } = renderHook(() =>
      useBillLink({
        ...base,
        splitsAll: [{ members: [{ account_id: 7 }] }],
        accountLines: [{ account_id: '7', cents: '-80' }],
        categoryLines: [],
      })
    )
    await waitFor(() => expect(result.current.deposits).toHaveLength(2))
    expect(result.current.deposits.map((d) => [d.other_category_id, d.cents])).toEqual([['1', '50'], ['', '30']])
  })
})
