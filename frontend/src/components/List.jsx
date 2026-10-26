import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { formatCents } from '../utils/format.js'
import { useIsDesktop } from '../utils/useMediaQuery.js'
import SortHeader from './SortHeader.jsx'

// The one list every list page is drawn with (DESIGN.md § Lists on a phone): a table at 768 px and
// wider, a column of rows below it, switched on width in one place (useIsDesktop).
//   columns   [{ key, header, sortKey?, cell(row) }] - the desktop table; `sortKey` makes the header
//             a SortHeader driven by `sort` / `onSort`.
//   phoneRow  (row) => node - what a phone row holds inside its tappable box.
//   rows      a flat list, or
//   groups    [{ key, label, total, rows }] with `isOpen(key)` / `onToggle(key)`; `totalColumn` is
//             the desktop column index the group total sits in.
//   onSelect  makes rows tappable; without it the list is read-only.
//   column.className  extra classes for the column's header and cells (text-right for money).
//   rowProps  (row) => attributes for the row (tabIndex, onKeyDown), on both widths.
//   before / after  (row) => node drawn as its own full-width line above / below the row (a goal
//             under its category, a "Locked to" caption); null for none.
export default function List({
  columns, phoneRow, rows, groups, isOpen, onToggle, totalColumn = 0, rowId, onSelect, selectedId, sort, onSort,
  rowProps, before, after,
}) {
  const desktop = useIsDesktop()
  const rowClass = (row) =>
    `${onSelect ? 'cursor-pointer hover:bg-raised' : ''} ${selectedId === rowId(row) ? 'bg-raised' : ''}`.trim()

  if (!desktop) {
    const line = (node, key) => node && <li key={key} className="px-2 pb-1">{node}</li>
    const phone = (row) => (
      <Fragment key={rowId(row)}>
        {line(before?.(row), `${rowId(row)}-before`)}
        <li
          className={`border-t border-line px-2 py-2 ${rowClass(row)}`.trim()}
          onClick={onSelect ? () => onSelect(row) : undefined}
          {...rowProps?.(row)}
        >
          {phoneRow(row)}
        </li>
        {line(after?.(row), `${rowId(row)}-after`)}
      </Fragment>
    )
    return (
      <ul>
        {groups
          ? groups.map((g) => {
              const open = isOpen(g.key)
              const Chevron = open ? ChevronDown : ChevronRight
              return (
                <Fragment key={g.key}>
                  <li className="flex items-center justify-between gap-3 border-t border-line">
                    <button
                      type="button"
                      aria-expanded={open}
                      className="inline-flex min-h-14 items-center gap-1 font-medium"
                      onClick={() => onToggle(g.key)}
                    >
                      <Chevron size={20} aria-hidden="true" />
                      {g.label}
                    </button>
                    <span className={`tabular whitespace-nowrap font-medium ${g.total < 0 ? 'text-negative' : ''}`}>{formatCents(g.total)}</span>
                  </li>
                  {open && g.rows.map(phone)}
                </Fragment>
              )
            })
          : rows.map(phone)}
      </ul>
    )
  }

  const fullLine = (node, key) =>
    node && (
      <tr key={key}>
        <td colSpan={columns.length} className="pb-1">{node}</td>
      </tr>
    )
  const desktopRow = (row) => (
    <Fragment key={rowId(row)}>
      {fullLine(before?.(row), `${rowId(row)}-before`)}
      <tr className={rowClass(row) || undefined} onClick={onSelect ? () => onSelect(row) : undefined} {...rowProps?.(row)}>
        {columns.map((c) => (
          <td key={c.key} className={`py-1 align-top ${c.className ?? ''}`.trim()}>{c.cell(row)}</td>
        ))}
      </tr>
      {fullLine(after?.(row), `${rowId(row)}-after`)}
    </Fragment>
  )
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-text-2">
          {columns.map((c) =>
            c.sortKey && sort ? (
              <SortHeader key={c.key} label={c.header} sortKey={c.sortKey} sort={sort} onSort={onSort} className={`pb-1 ${c.className ?? ''}`.trim()} />
            ) : (
              <th key={c.key} className={`pb-1 ${c.className ?? ''}`.trim()}>{c.header}</th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {groups
          ? groups.map((g) => {
              const open = isOpen(g.key)
              const Chevron = open ? ChevronDown : ChevronRight
              return (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={totalColumn} className="py-1">
                      <button
                        type="button"
                        aria-expanded={open}
                        className="inline-flex min-h-11 items-center gap-1 font-medium"
                        onClick={() => onToggle(g.key)}
                      >
                        <Chevron size={20} aria-hidden="true" />
                        {g.label}
                      </button>
                    </td>
                    <td className={`tabular py-1 font-medium ${g.total < 0 ? 'text-negative' : ''}`}>{formatCents(g.total)}</td>
                    <td colSpan={Math.max(columns.length - totalColumn - 1, 1)}></td>
                  </tr>
                  {open && g.rows.map(desktopRow)}
                </Fragment>
              )
            })
          : rows.map(desktopRow)}
      </tbody>
    </table>
  )
}
