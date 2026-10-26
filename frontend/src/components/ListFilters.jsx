import { X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useIsDesktop } from '../utils/useMediaQuery.js'
import Button from './Button.jsx'
import GroupBy from './GroupBy.jsx'
import { useRegisterFormOpen } from './SidePanel.jsx'

// The one filter bar every list page uses (DESIGN.md § Lists on a phone). From 768 px up it is a row:
// a name search, a choice per facet, optional extra controls (e.g. "Show archived"), and a Clear button
// that appears once anything is narrowing the list. Narrower, it is the search box and one Filter button
// that opens a full-screen filter screen holding every control, the sort choice, Group by and
// Expand all / Collapse all. It is the same state either way; the screen only re-presents it.
//   facets: [{ name, label, value, onChange, options: [{ value, label }] }] — value '' means "all".
//   checks: [{ name, label, checked, onChange }]
//   extraCount: filters set among the `children` (e.g. searchable pickers), for the Filter · N label.
//   sortOptions: [{ key, label }] with sort ({ key, dir }) and onSort(key) (the useSort toggle: another
//     key sorts it ascending, the same key reverses it). Shown in the filter screen only; on a desktop
//     the column headers sort.
//   groupBy: { value, onChange, options } for a page with a Group by choice.
//   onExpandAll / onCollapseAll: for a page that nests or groups; omit them to hide the buttons.
//   onClear: puts filters (and the default order) back; the screen's Clear is always there.
export default function ListFilters({
  noun, search, onSearch, facets = [], checks = [], extraCount = 0, active, onClear,
  sortOptions, sort, onSort, groupBy, onExpandAll, onCollapseAll, barClassName = '', children,
}) {
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  useRegisterFormOpen(!desktop && open)
  // Widening the window past the phone breakpoint closes the screen: the bar shows everything.
  useEffect(() => {
    if (desktop) setOpen(false)
  }, [desktop])
  const sortId = useId()

  const count = facets.filter((f) => f.value !== '').length + checks.filter((c) => c.checked).length + extraCount
  const expandCollapse = (onExpandAll || onCollapseAll) && (
    <div className="flex">
      {onExpandAll && <Button variant="quiet" onClick={onExpandAll}>Expand all</Button>}
      {onCollapseAll && <Button variant="quiet" onClick={onCollapseAll}>Collapse all</Button>}
    </div>
  )
  const searchBox = onSearch && (
    <input
      className="field min-w-0 flex-1 md:flex-none"
      placeholder={`Search ${noun}`}
      aria-label={`Search ${noun}`}
      value={search}
      onChange={(e) => onSearch(e.target.value)}
    />
  )
  const controls = (
    <>
      {facets.map((f) => (
        <select
          key={f.name}
          className="field"
          aria-label={`Filter by ${f.label.toLowerCase()}`}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
        >
          <option value="">{f.label}: all</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
      {checks.map((c) => (
        <label key={c.name} className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={c.checked} onChange={(e) => c.onChange(e.target.checked)} />
          {c.label}
        </label>
      ))}
      {children}
      {groupBy && <GroupBy value={groupBy.value} onChange={groupBy.onChange} options={groupBy.options} />}
      {expandCollapse}
    </>
  )

  if (desktop) {
    return (
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${barClassName}`.trim()}>
        {searchBox}
        {controls}
        {active && <Button variant="quiet" onClick={onClear}>Clear filters</Button>}
      </div>
    )
  }

  const hasSort = sortOptions && sortOptions.length > 0 && sort && onSort
  const close = () => setOpen(false)
  return (
    <div className="flex items-center gap-2">
      {searchBox}
      <Button variant="secondary" className="shrink-0" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {count > 0 ? `Filter · ${count}` : 'Filter'}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Filter"
          className="fixed inset-0 z-40 flex flex-col bg-surface"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
        >
          <div className="flex items-center justify-between gap-3 p-4">
            <h3 className="text-section">Filter</h3>
            <button type="button" aria-label="Close filters" className="btn btn-quiet text-text-2" onClick={close}>
              <X aria-hidden="true" size={20} />
            </button>
          </div>
          <div className="flex flex-1 flex-col items-stretch gap-3 overflow-y-auto px-4 pb-4">
            {controls}
            {hasSort && (
              <fieldset className="space-y-1">
                <legend className="field-label">Sort by</legend>
                {sortOptions.map((o) => (
                  <label key={o.key} className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name={`${sortId}-key`}
                      checked={sort.key === o.key}
                      onChange={() => sort.key !== o.key && onSort(o.key)}
                    />
                    {o.label}
                  </label>
                ))}
                <div className="flex gap-4">
                  {[['asc', 'Ascending'], ['desc', 'Descending']].map(([dir, label]) => (
                    <label key={dir} className="flex min-h-11 items-center gap-2">
                      <input
                        type="radio"
                        name={`${sortId}-dir`}
                        checked={sort.dir === dir}
                        onChange={() => sort.dir !== dir && onSort(sort.key)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line p-4 pb-8">
            <Button variant="quiet" onClick={onClear}>Clear</Button>
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}
