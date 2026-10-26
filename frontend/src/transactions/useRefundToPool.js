import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { parseCents } from '../utils/format.js'

// DESIGN.md § Categories → Pools → A refund can go back to the pool: a positive category line on a
// category with a pool offers "send this back to <pool>?", through the envelope step. The answer is
// one row per refunded category: { from, category_id (the pool), cents }.
export function useRefundToPool({ categories, categoryLines, editingId, date, linkedNet = 0 }) {
  const [rows, setRows] = useState([])
  const touched = useRef(false)

  const byId = new Map((categories ?? []).map((c) => [c.id, c]))
  const chainOf = (id) => {
    const chain = []
    const seen = new Set([id])
    let pool = byId.get(byId.get(id)?.pool_id)
    while (pool && !seen.has(pool.id)) {
      seen.add(pool.id)
      if (!pool.archived_on || pool.archived_on > date) chain.push(pool)
      pool = byId.get(pool.pool_id)
    }
    return chain
  }

  // What each category is refunded on this transaction: its positive lines, in cents.
  const refundedCents = new Map()
  for (const line of categoryLines) {
    const cents = parseCents(line.cents)
    if (!line.category_id || cents === null || cents <= 0) continue
    const id = Number(line.category_id)
    refundedCents.set(id, (refundedCents.get(id) ?? 0) + cents)
  }
  // The backend refuses a refund going back to its pool on a transaction that takes money out of a
  // linked account (net < 0), so no offer is shown there.
  const offers = (linkedNet < 0 ? [] : [...refundedCents.entries()])
    .map(([id, cents]) => ({ from: id, cents, chain: chainOf(id) }))
    .filter((o) => o.chain.length > 0)
  const offerKey = offers.map((o) => `${o.from}:${o.cents}:${o.chain.map((p) => p.id)}`).join('|')

  // A new transaction pre-fills from where each chain stands on the transaction's date; an edit
  // shows what was stored and never re-fills.
  useEffect(() => {
    if (editingId != null || touched.current || !date) return
    if (offers.length === 0) return setRows([])
    let stale = false
    api
      .readyToAssign(date)
      .then(({ categories: available }) => {
        if (stale || touched.current) return
        const balance = new Map(available.map((a) => [a.category_id, a.available_cents]))
        setRows(
          offers.map((o) => {
            const below = o.chain.find((p) => (balance.get(p.id) ?? 0) < 0)
            return below
              ? { from: o.from, category_id: String(below.id), cents: String(Math.min(o.cents, -balance.get(below.id)) / 100) }
              : { from: o.from, category_id: String(o.chain[0].id), cents: '' }
          })
        )
      })
      .catch(() => {})
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, date, offerKey])

  // The row shown for each offer: what is stored or typed, else the category's own pool, empty.
  const shown = offers.map((o) => ({
    ...o,
    row: rows.find((r) => r.from === o.from) ?? { from: o.from, category_id: String(o.chain[0].id), cents: '' },
  }))

  function updateRefund(from, field, value) {
    touched.current = true
    const current = shown.find((o) => o.from === from).row
    setRows((all) => [...all.filter((r) => r.from !== from), { ...current, [field]: value }])
  }

  // The deposit items to send: the move runs from the refunded category up to the chosen pool.
  function refundItems() {
    const items = []
    for (const o of shown) {
      const cents = parseCents(o.row.cents)
      if (!o.row.category_id || cents === null || cents <= 0) continue
      if (cents > o.cents) return { error: 'No more than the refund can go back to its pool.' }
      items.push({ category_id: Number(o.row.category_id), cents, other_category_id: o.from })
    }
    return { items }
  }

  return { refundOffers: shown, updateRefund, refundRows: rows, setRefundRows: setRows, refundTouched: touched, refundItems }
}
