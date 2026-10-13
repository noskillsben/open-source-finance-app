// A list row: 44 px on a desktop, 56 px on a phone, the row being edited highlighted, and the
// row's actions on the right. `onSelect` makes the whole row tappable.
export function ListRow({ selected = false, onSelect, children, actions }) {
  return (
    <li
      className={`flex min-h-14 items-center justify-between gap-3 border-t border-line px-2 md:min-h-11 ${
        selected ? 'bg-raised' : ''
      } ${onSelect ? 'cursor-pointer' : ''}`}
      onClick={onSelect}
    >
      <div className="min-w-0 py-1">{children}</div>
      {actions && <div className="flex shrink-0 items-center">{actions}</div>}
    </li>
  )
}

// The goal row sits under its category in the table: the goal's name and status line, and its one
// action on the right. `depth` indents it to its category.
export function GoalRow({ depth = 0, colSpan, name, status, action }) {
  return (
    <tr className="border-t-0 text-sm text-text-2">
      <td colSpan={colSpan} className="pb-2" style={{ paddingLeft: `${depth * 1.25 + 1}rem` }}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-text">{name}</span>
            {status}
          </div>
          {action}
        </div>
      </td>
    </tr>
  )
}
