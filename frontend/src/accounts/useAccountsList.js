import { useEffect, useState } from 'react'
import { ON_BUDGET_TYPES, TRACKING_TYPES } from '../account_types.js'
import { useFilters } from '../utils/useFilters.js'
import { comparator } from '../utils/useSort.js'
import { COLLAPSED_KEY, DEFAULT_SORT, GROUP_BY_KEY, loadCollapsed, loadGroupBy, saveLocal } from './accountForm.js'

// The list's own state: filters, sort, how it is grouped, which groups are collapsed, and the grouped
// rows those leave (DESIGN.md § Nested and grouped lists).
export function useAccountsList(accounts) {
  const [groupBy, setGroupByState] = useState(loadGroupBy)
  const [collapsed, setCollapsedState] = useState(loadCollapsed) // group keys, per device
  // Accounts locked to the same payee read as one line with a balance each (DESIGN.md § Payee-locked
  // accounts). Derived here from the list, at read time: a lone locked account keeps its own row.
  const { filters, setFilter, clear: clearFilters, active: filtersActive, filtered, sort, toggleSort } = useFilters('accounts.filters', { search: '', type: '', side: '' }, DEFAULT_SORT)
  function setGroupBy(value) {
    setGroupByState(value)
    saveLocal(GROUP_BY_KEY, value)
  }
  function setCollapsed(keys) {
    setCollapsedState(keys)
    saveLocal(COLLAPSED_KEY, keys)
  }
  function toggleGroup(key) {
    setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])
  }
  // The column the list is grouped by is hidden, so a saved sort on it falls back to Name A→Z.
  const hiddenKey = groupBy === 'side' ? 'side' : 'type'
  useEffect(() => {
    if (sort.key === hiddenKey) toggleSort(DEFAULT_SORT.key)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the sort key or hidden key changes; toggleSort is recreated every render
  }, [sort.key, hiddenKey])
  const effectiveSort = sort.key === hiddenKey ? DEFAULT_SORT : sort
  const needle = filters.search.trim().toLowerCase()
  const visible = (accounts ?? []).filter(
    (a) =>
      a.name.toLowerCase().includes(needle) &&
      (filters.type === '' || a.type === filters.type) &&
      (filters.side === '' || a.on_budget === (filters.side === 'on')),
  )
  // Type ranks in the type list's order (on-budget types, then tracking); side is On-budget, then Tracking.
  const typeOrder = [...ON_BUDGET_TYPES, ...TRACKING_TYPES]
  const valueOf = (a, key) =>
    key === 'type' ? (typeOrder.includes(a.type) ? typeOrder.indexOf(a.type) : null) : key === 'side' ? (a.on_budget ? 0 : 1) : key === 'balance' ? a.balance_cents : a.name
  const sorted = [...visible].sort(comparator(effectiveSort, valueOf, (a) => a.name))

  // Groups: by side (On-budget, Tracking) or by type (the type list's order, an unknown type last);
  // archived accounts, shown only with Show archived, sit in one Archived group last. Empty groups vanish.
  const groupDefs =
    groupBy === 'side'
      ? [{ key: 'side:on', label: 'On-budget' }, { key: 'side:off', label: 'Tracking' }]
      : [...typeOrder.map((t) => ({ key: `type:${t}`, label: t })), { key: 'type:unknown', label: 'Unknown type' }]
  groupDefs.push({ key: 'archived', label: 'Archived' })
  const groupKeyOf = (a) =>
    a.archived_on
      ? 'archived'
      : groupBy === 'side'
        ? (a.on_budget ? 'side:on' : 'side:off')
        : (typeOrder.includes(a.type) ? `type:${a.type}` : 'type:unknown')
  const groupedRows = groupDefs
    .map((def) => {
      const members = sorted.filter((a) => groupKeyOf(a) === def.key)
      const rows = []
      const clusters = new Map()
      for (const a of members) {
        const shared = a.locked_payee_id != null && accounts.filter((o) => o.locked_payee_id === a.locked_payee_id).length > 1
        if (!shared) rows.push({ account: a })
        else if (!clusters.has(a.locked_payee_id)) {
          const row = { payeeId: a.locked_payee_id, group: [] }
          clusters.set(a.locked_payee_id, row)
          rows.push(row)
        }
        if (shared) clusters.get(a.locked_payee_id).group.push(a)
      }
      return { ...def, rows, total: members.reduce((sum, a) => sum + a.balance_cents, 0), count: members.length }
    })
    .filter((g) => g.count > 0)
  // A search or filter opens every group holding a match, so a collapsed group never hides a hit.
  const isOpen = (key) => filtered || !collapsed.includes(key)
  const hasRows = groupedRows.length > 0
  const colCount = 4

  return {
    filters, setFilter, clearFilters, filtersActive, filtered, toggleSort, effectiveSort, groupBy, setGroupBy,
    setCollapsed, toggleGroup, isOpen, groupedRows, hasRows, colCount,
  }
}
