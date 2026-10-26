import { useState } from 'react'
import { useFilters } from '../utils/useFilters.js'
import { DEFAULT_SORT, NO_FILTERS, COLLAPSED_KEY, loadCollapsed, matches } from './listHelpers.js'

// The list view's own state: the filters and sort, which months are collapsed, and what they leave shown.
export function useTransactionList({ transactions, categoriesAll, payeesAll }) {
  const { filters, setFilter, clear: clearFilters, active: clearShows, filtered, sort, toggleSort } = useFilters('transactions.filters', NO_FILTERS, DEFAULT_SORT, 'transactions.sort')
  const [collapsed, setCollapsedState] = useState(loadCollapsed)
  function setCollapsed(keys) {
    setCollapsedState(keys)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(keys))
    } catch {
      // private window or blocked storage: the state just doesn't survive a reload
    }
  }

  const shown = (transactions ?? []).filter((t) => matches(t, filters, categoriesAll, payeesAll))

  return { filters, setFilter, clearFilters, clearShows, filtered, sort, toggleSort, collapsed, setCollapsed, shown }
}
