import { ArrowDown, ArrowUp } from 'lucide-react'

// A column header that sorts its list (DESIGN.md § Sorting and grouping): a button inside the <th>,
// with aria-sort on the <th>, and the arrow always shown on the sorted column.
//   sort: { key, dir } from useSort; onSort(key) toggles.
export default function SortHeader({ label, sortKey, sort, onSort, className = '' }) {
  const sorted = sort.key === sortKey
  const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown
  const right = className.includes('text-right')
  return (
    <th className={className} aria-sort={sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`inline-flex min-h-14 items-center gap-1 uppercase md:min-h-11 ${right ? 'flex-row-reverse' : ''}`}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {sorted && <Arrow size={20} aria-hidden="true" />}
      </button>
    </th>
  )
}
