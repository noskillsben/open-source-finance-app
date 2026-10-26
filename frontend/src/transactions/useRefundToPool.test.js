import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../api.js'
import { useRefundToPool } from './useRefundToPool.js'

const categories = [
  { id: 1, name: 'Pool', pool_id: null, archived_on: null },
  { id: 2, name: 'Fuel', pool_id: 1, archived_on: null },
]
const lines = [{ category_id: '2', cents: '10' }]

describe('useRefundToPool', () => {
  it('offers the pool back when the linked net is not negative', async () => {
    vi.spyOn(api, 'readyToAssign').mockResolvedValue({ categories: [] })
    const { result } = renderHook(() =>
      useRefundToPool({ categories, categoryLines: lines, editingId: null, date: '2026-10-01', linkedNet: 0 })
    )
    expect(result.current.refundOffers).toHaveLength(1)
    await waitFor(() => expect(result.current.refundRows).toHaveLength(1))
  })

  it('shows no offer and sends nothing when the linked net is below zero', async () => {
    vi.spyOn(api, 'readyToAssign').mockResolvedValue({ categories: [{ category_id: 1, available_cents: -500 }] })
    const { result, rerender } = renderHook(
      ({ linkedNet }) =>
        useRefundToPool({ categories, categoryLines: lines, editingId: null, date: '2026-10-01', linkedNet }),
      { initialProps: { linkedNet: 0 } }
    )
    await waitFor(() => expect(result.current.refundRows).toHaveLength(1))
    rerender({ linkedNet: -1000 })
    expect(result.current.refundOffers).toHaveLength(0)
    await waitFor(() => expect(result.current.refundRows).toHaveLength(0))
    expect(result.current.refundItems()).toEqual({ items: [] })
  })
})
