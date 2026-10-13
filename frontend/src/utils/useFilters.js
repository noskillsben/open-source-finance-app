import { useEffect, useState } from 'react'

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

export function useFilters(storageKey, defaults) {
  const [filters, setFilters] = useState(() => load(storageKey, defaults))
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(filters))
    } catch {
      // private window or blocked storage: the state just doesn't survive a reload
    }
  }, [storageKey, filters])
  const setFilter = (name, value) => setFilters((f) => ({ ...f, [name]: value }))
  const clear = () => setFilters(defaults)
  const active = Object.keys(defaults).some((k) => filters[k] !== defaults[k])
  return { filters, setFilter, clear, active }
}
