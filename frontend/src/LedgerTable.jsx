import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from './api.js'
import SortHeader from './components/SortHeader.jsx'
import { formatCents, formatDate, formatMonth } from './utils/format.js'
import { compareValues } from './utils/useSort.js'

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

// Positive amounts are plain text; only a negative one is coloured, and it prints its minus sign.
function Amount({ cents }) {
  return <span className={`tabular ${cents < 0 ? 'text-negative' : ''}`}>{formatCents(cents)}</span>
}

/** "2026-10-03" -> "2026-10": the key of the month a transaction is grouped under. */
export const monthKey = (date) => date.slice(0, 7)

/** Transactions grouped by calendar month, newest month first (DESIGN.md § Sorting and grouping). Rows
 * inside a month follow `sort` ({ key: 'date' | 'payee', dir }); ties fall back to newest first. */
export function groupByMonth(transactions, sort, payeeName, accountId = null) {
  const byDate = (a, b) => b.date.localeCompare(a.date) || b.id - a.id
  const rank =
    sort.key === 'payee'
      ? (a, b) =>
          compareValues(
            a.payee_id == null ? null : payeeName(a.payee_id),
            b.payee_id == null ? null : payeeName(b.payee_id),
            sort.dir,
          ) || byDate(a, b)
      : (a, b) => (sort.dir === 'asc' ? -byDate(a, b) : byDate(a, b))
  const months = new Map()
  for (const t of transactions) {
    const key = monthKey(t.date)
    if (!months.has(key)) months.set(key, [])
    months.get(key).push(t)
  }
  return [...months.keys()]
    .sort()
    .reverse()
    .map((key) => {
      const rows = months.get(key).sort(rank)
      const total = rows.reduce((sum, t) => sum + t.account_lines.reduce((s, l) => (accountId == null || l.account_id === accountId ? s + l.cents : s), 0), 0)
      return { key, label: formatMonth(`${key}-01`), rows, total }
    })
}

/** The Ledger's list of transactions (DESIGN.md § Transactions). Without `onSelect` it is read-only:
 * no row click, no pointer — the Splits page shows it this way. */
export default function LedgerTable({ transactions, names, onSelect, selectedId, byMonth }) {
  // With an account filter on, the Account lines column and the month totals count only that account.
  const accountId = byMonth?.accountId ?? null
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

  const renderRow = (t) => (
          <tr
            key={t.id}
            className={`${onSelect ? 'cursor-pointer hover:bg-raised' : ''} ${selectedId === t.id ? 'bg-raised' : ''}`.trim() || undefined}
            onClick={onSelect ? () => onSelect(t) : undefined}
          >
            <td className="py-1 align-top">
              {formatDate(t.date)}
              {t.income_stream_id != null && (
                <div>
                  <Link
                    className="btn btn-quiet"
                    to={`/income/${t.income_stream_id}/record?date=${t.date}`}
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
              {t.account_lines.filter((l) => accountId == null || l.account_id === accountId).map((l) => (
                <div key={l.id}>
                  {entityLabel(accounts, l.account_id, `#${l.account_id}`)}: <Amount cents={l.cents} />
                </div>
              ))}
            </td>
            <td className="py-1 align-top">
              {t.category_lines.length === 0 && (
                <span className="text-text-2">
                  {t.account_lines.reduce((sum, l) => sum + (l.budget_cents ?? 0), 0) === 0 ? '—' : 'unassigned'}
                </span>
              )}
              {t.category_lines.map((l) => (
                <div key={l.id}>
                  {entityLabel(categories, l.category_id, `#${l.category_id}`)}: <Amount cents={l.cents} />
                </div>
              ))}
              {t.split_id != null && (
                <div className="text-sm text-text-3">Split: {splitLabel(t.split_id)}</div>
              )}
              {t.goal_id != null && (
                <div className="text-sm text-text-3">
                  pays {billLabel(t.goal_id)}, due {formatDate(t.goal_due_on)}
                </div>
              )}
            </td>
          </tr>
  )

  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-text-2">
          {byMonth ? (
            <>
              <SortHeader label="Date" sortKey="date" sort={byMonth.sort} onSort={byMonth.onSort} className="pb-1" />
              <th className="pb-1">Memo</th>
              <SortHeader label="Payee" sortKey="payee" sort={byMonth.sort} onSort={byMonth.onSort} className="pb-1" />
            </>
          ) : (
            <>
              <th className="pb-1">Date</th>
              <th className="pb-1">Memo</th>
              <th className="pb-1">Payee</th>
            </>
          )}
          <th className="pb-1">Account lines</th>
          <th className="pb-1">Category lines</th>
        </tr>
      </thead>
      <tbody>
        {byMonth
          ? groupByMonth(transactions, byMonth.sort, (id) => payees?.find((p) => p.id === id)?.name ?? '', accountId).map((g) => {
              const open = !byMonth.collapsed.includes(g.key)
              const Chevron = open ? ChevronDown : ChevronRight
              return (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={3} className="py-1">
                      <button
                        type="button"
                        aria-expanded={open}
                        className="inline-flex min-h-14 items-center gap-1 font-medium md:min-h-11"
                        onClick={() => byMonth.onToggle(g.key)}
                      >
                        <Chevron size={20} aria-hidden="true" />
                        {g.label}
                      </button>
                    </td>
                    <td className={`tabular py-1 font-medium ${g.total < 0 ? 'text-negative' : ''}`}>{formatCents(g.total)}</td>
                    <td></td>
                  </tr>
                  {open && g.rows.map(renderRow)}
                </Fragment>
              )
            })
          : transactions.map(renderRow)}
      </tbody>
    </table>
  )
}
