import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from './api.js'
import { formatCents, formatDate } from './utils/format.js'

// Ledger name lookups: resolve from the "all" (archived-included) lists so a row that names an
// archived entity still shows its name, marked "(archived)", instead of falling back to `#id`
// (DESIGN.md § General concepts).
function entityLabel(list, id, fallback) {
  if (id == null) return null
  const match = list?.find((e) => e.id === id)
  if (!match) return fallback
  return match.archived_on ? `${match.name} (archived)` : match.name
}

/** The archived-included lists the table names things from, for a page that does not already load them. */
export function useLedgerNames(pickerDate) {
  const [names, setNames] = useState({})
  useEffect(() => {
    const load = (key, request) => request.then((list) => setNames((n) => ({ ...n, [key]: list }))).catch(() => {})
    load('accounts', api.accounts.list(undefined, true))
    load('categories', api.categories.list(undefined, true))
    load('payees', api.payees.list(undefined, true))
    load('goals', api.goals.list(pickerDate, true, true))
    load('splits', api.splits.list(undefined, true))
  }, [pickerDate])
  return names
}

/** The Ledger's list of transactions (DESIGN.md § Transactions). Without `onSelect` it is read-only:
 * no row click, no pointer — the Splits page shows it this way. */
export default function LedgerTable({ transactions, names, onSelect }) {
  const { accounts, categories, payees, goals, splits } = names
  function splitLabel(id) {
    const match = splits?.find((s) => s.id === id)
    if (!match) return `split #${id}`
    return match.archived_on ? `${match.name} (archived)` : match.name
  }
  function billLabel(goalId) {
    const match = goals?.find((g) => g.goal.id === goalId)
    if (!match) return `bill #${goalId}`
    return match.goal.archived_on ? `${match.goal.name} (archived)` : match.goal.name
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-paper-soft">
          <th className="pb-1">Date</th>
          <th className="pb-1">Memo</th>
          <th className="pb-1">Payee</th>
          <th className="pb-1">Account lines</th>
          <th className="pb-1">Category lines</th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((t) => (
          <tr
            key={t.id}
            className={onSelect ? 'cursor-pointer hover:bg-ink' : undefined}
            onClick={onSelect ? () => onSelect(t) : undefined}
          >
            <td className="py-1 align-top">
              {formatDate(t.date)}
              {t.income_stream_id != null && (
                <div>
                  <Link
                    className="text-xs text-accent"
                    to={`/pay/${t.income_stream_id}/record?date=${t.date}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Re-open pay
                  </Link>
                </div>
              )}
            </td>
            <td className="py-1 align-top">{t.memo || '—'}</td>
            <td className="py-1 align-top">
              {t.payee_id != null ? entityLabel(payees, t.payee_id, `#${t.payee_id}`) : '—'}
            </td>
            <td className="py-1 align-top">
              {t.account_lines.map((l) => (
                <div key={l.id}>
                  {entityLabel(accounts, l.account_id, `#${l.account_id}`)}: {formatCents(l.cents)}
                </div>
              ))}
            </td>
            <td className="py-1 align-top">
              {t.category_lines.length === 0 && <span className="text-paper-soft">unassigned</span>}
              {t.category_lines.map((l) => (
                <div key={l.id}>
                  {entityLabel(categories, l.category_id, `#${l.category_id}`)}: {formatCents(l.cents)}
                </div>
              ))}
              {t.split_id != null && (
                <div className="text-xs text-paper-soft">Split: {splitLabel(t.split_id)}</div>
              )}
              {t.goal_id != null && (
                <div className="text-xs text-paper-soft">
                  pays {billLabel(t.goal_id)}, due {formatDate(t.goal_due_on)}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
