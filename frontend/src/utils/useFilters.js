import { useEffect, useState } from 'react'
import { useSort } from './useSort.js'

// A list page's filter state: a per-viewer convenience (DESIGN.md § UI conventions), so it is React
// state, remembered in sessionStorage when that works and never sent to the API. With storage
// blocked or throwing, the page still works; the filters just don't survive a reload.
function load(key, defaults) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (saved && typeof saved === 'object') return { ...defaults, ...saved }
  } catch {
    // unavailable or corrupt: start from the defaults
  }
  return defaults
}

// With a defaultSort, the sort is remembered beside the filters, Clear restores it, and a sort other than
// the default counts as active (`filtered` is the filters alone).
export function useFilters(storageKey, defaults, defaultSort = { key: null, dir: 'asc' }, sortKey = `${storageKey}.sort`) {
  const sorting = useSort(sortKey, defaultSort)
  const [filters, setFilters] = useState(() => load(storageKey, defaults))
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(filters))
    } catch {
      // private window or blocked storage: the state just doesn't survive a reload
    }
  }, [storageKey, filters])
  const setFilter = (name, value) => setFilters((f) => ({ ...f, [name]: value }))
  const clear = () => {
    setFilters(defaults)
    sorting.reset()
  }
  const filtered = Object.keys(defaults).some((k) => filters[k] !== defaults[k])
  const active = filtered || !sorting.isDefault
  return { filters, setFilter, clear, active, filtered, sort: sorting.sort, toggleSort: sorting.toggle }
}
