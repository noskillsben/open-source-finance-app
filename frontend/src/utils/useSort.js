import { useEffect, useState } from 'react'

// A list's sort: { key, dir } with dir 'asc' | 'desc'. Like filters it is a per-viewer convenience
// (DESIGN.md § Sorting and grouping): React state remembered in sessionStorage when that works, never
// sent to the API. There is no unsorted state: tapping the sorted column reverses it, tapping another
// column sorts by that one, ascending.
function load(storageKey, defaultSort) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
    if (saved && typeof saved.key === 'string' && (saved.dir === 'asc' || saved.dir === 'desc')) return saved
  } catch {
    // unavailable or corrupt: start from the default
  }
  return defaultSort
}

export function useSort(storageKey, defaultSort) {
  const [sort, setSort] = useState(() => load(storageKey, defaultSort))
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(sort))
    } catch {
      // private window or blocked storage: the state just doesn't survive a reload
    }
  }, [storageKey, sort])
  const toggle = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const reset = () => setSort(defaultSort)
  const isDefault = sort.key === defaultSort.key && sort.dir === defaultSort.dir
  return { sort, toggle, reset, isDefault }
}

// Nulls sort last whichever way the column runs; direction flips only real values.
export function compareValues(a, b, dir) {
  const aNull = a == null
  const bNull = b == null
  if (aNull || bNull) return aNull && bNull ? 0 : aNull ? 1 : -1
  const r = typeof a === 'string' ? a.localeCompare(b) : a - b
  return dir === 'desc' ? -r : r
}

/** A comparator for `sort`: `valueOf(item, key)` gives the value to rank by; ties fall back to name A→Z. */
export function comparator(sort, valueOf, nameOf) {
  return (a, b) =>
    compareValues(valueOf(a, sort.key), valueOf(b, sort.key), sort.dir) || nameOf(a).localeCompare(nameOf(b))
}
