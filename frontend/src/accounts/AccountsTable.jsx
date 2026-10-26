import List from '../components/List.jsx'
import { formatCents, formatDate } from '../utils/format.js'
import { termsLine } from '../utils/terms.js'
import { VALUE_TYPES } from './accountForm.js'

// The accounts list: grouped rows, locked-to-payee clusters, and each row's notes and actions, drawn
// with the shared List (a table on a desktop, rows on a phone).
export default function AccountsTable({ list, payeesAll, selectedId, highlightId, editAccount }) {
  const { groupedRows, groupBy, effectiveSort, toggleSort, isOpen, toggleGroup } = list

  function accountNotes(a) {
    return (
      <>
        {termsLine(a.terms) && <div className="text-sm text-text-3">{termsLine(a.terms)}</div>}
        {a.archived_on && <div className="text-sm text-text-3">archived {formatDate(a.archived_on)}</div>}
        {a.checked_on && (
          <div className="text-sm text-text-3">
            {a.checked_is_opening ? 'opened' : VALUE_TYPES.includes(a.type) ? 'value updated' : 'balance checked'}{' '}
            {formatDate(a.checked_on)}
            {a.entries_added_since_check > 0 &&
              ` — ${a.entries_added_since_check} ${a.entries_added_since_check === 1 ? 'entry' : 'entries'} added since`}
          </div>
        )}
        {a.notes.map((note) => (
          <div key={note} className="text-sm text-warning">{note}</div>
        ))}
      </>
    )
  }

  // A locked-to-payee cluster is flattened to its accounts; the first carries the "Locked to" caption.
  const groups = groupedRows.map((g) => ({
    ...g,
    rows: g.rows.flatMap((row) =>
      row.group
        ? row.group.map((account, i) => ({
            account,
            lockedTo: i === 0 ? payeesAll?.find((p) => p.id === row.payeeId)?.name ?? `#${row.payeeId}` : null,
          }))
        : [{ account: row.account }],
    ),
  }))
  const balance = (a) => (
    <span className={`tabular ${a.balance_cents < 0 ? 'text-negative' : ''}`}>{formatCents(a.balance_cents)}</span>
  )
  const columns = [
    { key: 'name', header: 'Name', sortKey: 'name', cell: ({ account: a }) => <>{a.name}{accountNotes(a)}</> },
    ...(groupBy !== 'type' ? [{ key: 'type', header: 'Type', sortKey: 'type', cell: ({ account: a }) => a.type }] : []),
    ...(groupBy !== 'side' ? [{ key: 'side', header: 'Side', sortKey: 'side', cell: ({ account: a }) => (a.on_budget ? 'On-budget' : 'Tracking') }] : []),
    { key: 'balance', header: 'Balance', sortKey: 'balance', className: 'text-right', cell: ({ account: a }) => balance(a) },
  ]
  const phoneRow = ({ account: a }) => (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 break-words">{a.name}</span>
        <span className="shrink-0 whitespace-nowrap">{balance(a)}</span>
      </div>
      {groupBy !== 'type' && <div className="break-words text-sm text-text-2">{a.type}</div>}
      {accountNotes(a)}
    </>
  )

  return (
    <List
      groups={groups}
      isOpen={isOpen}
      onToggle={toggleGroup}
      totalColumn={columns.length - 1}
      columns={columns}
      phoneRow={phoneRow}
      rowId={({ account }) => account.id}
      onSelect={({ account }) => editAccount(account)}
      rowProps={({ account }) => ({
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.target === e.currentTarget && e.key === 'Enter') editAccount(account)
        },
      })}
      selectedId={selectedId ?? highlightId}
      before={({ lockedTo }) => lockedTo && <div className="text-sm text-text-3">Locked to {lockedTo}</div>}
      sort={effectiveSort}
      onSort={toggleSort}
    />
  )
}
