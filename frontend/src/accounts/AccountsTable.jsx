import { Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Button from '../components/Button.jsx'
import SortHeader from '../components/SortHeader.jsx'
import { formatCents, formatDate } from '../utils/format.js'
import { termsLine } from '../utils/terms.js'
import { VALUE_TYPES } from './accountForm.js'

// The accounts table: grouped rows, locked-to-payee clusters, and each row's notes and actions. This is
// the only place the table markup lives, so it can be swapped for the shared list on its own.
export default function AccountsTable({ list, payeesAll, selectedId, highlightId, editAccount, startCheck, startArchive, unarchiveAccount, undoCheck }) {
  const { groupedRows, groupBy, effectiveSort, toggleSort, isOpen, toggleGroup, colCount } = list

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
            {!a.checked_is_opening && (
              <>
                {' — '}
                <button type="button" className="btn btn-quiet underline" onClick={(e) => undoCheck(e, a)}>
                  Undo check
                </button>
              </>
            )}
          </div>
        )}
        {a.notes.map((note) => (
          <div key={note} className="text-sm text-warning">{note}</div>
        ))}
      </>
    )
  }

  function accountActions(a) {
    return (
      <>
        <Button
          variant="quiet"
          onClick={(e) => {
            e.stopPropagation()
            startCheck(a)
          }}
        >
          {VALUE_TYPES.includes(a.type) ? 'Update value' : 'Check balance'}
        </Button>
        {a.archived_on ? (
          <Button variant="quiet" onClick={(e) => unarchiveAccount(e, a)}>Unarchive</Button>
        ) : (
          <Button
            variant="quiet"
            onClick={(e) => {
              e.stopPropagation()
              startArchive(a)
            }}
          >
            Archive
          </Button>
        )}
      </>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <SortHeader label="Name" sortKey="name" sort={effectiveSort} onSort={toggleSort} />
            {groupBy !== 'type' && <SortHeader label="Type" sortKey="type" sort={effectiveSort} onSort={toggleSort} />}
            {groupBy !== 'side' && <SortHeader label="Side" sortKey="side" sort={effectiveSort} onSort={toggleSort} />}
            <SortHeader label="Balance" sortKey="balance" sort={effectiveSort} onSort={toggleSort} className="text-right" />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {groupedRows.map((g) => {
            const open = isOpen(g.key)
            const Chevron = open ? ChevronDown : ChevronRight
            return (
              <Fragment key={g.key}>
                <tr>
                  <td colSpan={colCount - 2} className="py-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      className="inline-flex min-h-14 items-center gap-1 font-medium md:min-h-11"
                      onClick={() => toggleGroup(g.key)}
                    >
                      <Chevron size={20} aria-hidden="true" />
                      {g.label}
                    </button>
                  </td>
                  <td className={`tabular py-1 text-right font-medium ${g.total < 0 ? 'text-negative' : ''}`}>{formatCents(g.total)}</td>
                  <td></td>
                </tr>
                {open && (
                  <>
                    {g.rows.map((row) =>
            row.group ? (
              <tr key={`payee-${row.payeeId}`}>
                <td colSpan={colCount} className="py-1">
                  <div className="text-sm text-text-3">
                    Locked to {payeesAll?.find((p) => p.id === row.payeeId)?.name ?? `#${row.payeeId}`}
                  </div>
                  {row.group.map((a) => (
                    <div
                      key={a.id}
                      className={`flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-2 hover:bg-raised md:min-h-11 ${selectedId === a.id || highlightId === a.id ? 'bg-raised' : ''}`}
                      onClick={() => editAccount(a)}
                    >
                      <div>
                        {a.name}
                        {accountNotes(a)}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`tabular ${a.balance_cents < 0 ? 'text-negative' : ''}`}>{formatCents(a.balance_cents)}</span>
                        <span>{accountActions(a)}</span>
                      </div>
                    </div>
                  ))}
                </td>
              </tr>
            ) : (
              <tr
                key={row.account.id}
                className={`cursor-pointer hover:bg-raised ${selectedId === row.account.id || highlightId === row.account.id ? 'bg-raised' : ''}`}
                onClick={() => editAccount(row.account)}
              >
                <td className="py-1">
                  {row.account.name}
                  {accountNotes(row.account)}
                </td>
                {groupBy !== 'type' && <td className="py-1">{row.account.type}</td>}
                {groupBy !== 'side' && <td className="py-1">{row.account.on_budget ? 'On-budget' : 'Tracking'}</td>}
                <td className={`tabular py-1 text-right ${row.account.balance_cents < 0 ? 'text-negative' : ''}`}>
                  {formatCents(row.account.balance_cents)}
                </td>
                <td className="py-1 text-right">{accountActions(row.account)}</td>
              </tr>
            ),
          )}
                  </>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
