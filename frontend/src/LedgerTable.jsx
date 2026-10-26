import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from './api.js'
import List from './components/List.jsx'
import { formatCents, formatDate, formatMonth } from './utils/format.js'
import { compareValues } from './utils/useSort.js'

// Ledger name lookups: resolve from the "all" (archived-included) lists so a row that names an
// archived entity still shows its name, marked "(archived)", instead of falling back to `#id`
// (DESIGN.md § General concepts).
// A list that failed to load is flagged in `names.failed` (by key); its labels then read in plain
// words (`plain`, e.g. "an account") instead of a placeholder or an id.
function entityLabel(list, id, fallback, failed, plain) {
  if (id == null) return null
  const match = list?.find((e) => e.id === id)
  if (!match) return failed ? plain : fallback
  return match.archived_on ? `${match.name} (archived)` : match.name
}

/** The archived-included lists the table names things from, for a page that does not already load them. */
export function useLedgerNames(pickerDate) {
  const [names, setNames] = useState({})
  useEffect(() => {
    const load = (key, request) =>
      request
        .then((list) => setNames((n) => ({ ...n, [key]: list })))
        .catch(() => setNames((n) => ({ ...n, failed: { ...n.failed, [key]: true } })))
    load('accounts', api.accounts.list(undefined, true))
    load('categories', api.categories.list(undefined, true))
    load('payees', api.payees.list(undefined, true))
    load('goals', api.goals.list(pickerDate, true, true))
    load('splits', api.splits.list(undefined, true))
  }, [pickerDate])
  return names
}

// A name that has not arrived yet: a placeholder shape, never an id.
function Pending() {
  return <span aria-busy="true" className="inline-block h-4 w-24 animate-pulse rounded bg-raised align-middle" />
}

// Positive amounts are plain text; only a negative one is coloured, and it prints its minus sign.
function Amount({ cents }) {
  return <span className={`tabular whitespace-nowrap ${cents < 0 ? 'text-negative' : ''}`}>{formatCents(cents)}</span>
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

/** The transactions a balance check or an opening balance produced, by id: `valuation_id` marks both, and
 * the opening is the account's earliest valuation by date, then id (as the backend picks it; DESIGN.md § Opening balance and backfilling history). Judged over
 * the list it is given, so the Transactions and Splits pages pass the whole ledger. */
export function adjustmentLabels(transactions) {
  // The backend's definition of the opening: the account's earliest valuation by date, then id. An
  // adjustment is dated its valuation's date, so the transaction's date stands in for the valuation's.
  const first = new Map()
  const before = (a, b) => a.date < b.date || (a.date === b.date && a.valuation_id < b.valuation_id)
  for (const t of transactions) {
    if (t.valuation_id == null || t.account_lines.length === 0) continue
    const account = t.account_lines[0].account_id
    if (!first.has(account) || before(t, first.get(account))) first.set(account, t)
  }
  const labels = new Map()
  for (const t of transactions) {
    if (t.valuation_id == null || t.account_lines.length === 0) continue
    labels.set(t.id, first.get(t.account_lines[0].account_id).valuation_id === t.valuation_id ? 'Opening balance' : 'Balance check')
  }
  return labels
}

/** The Ledger's list of transactions (DESIGN.md § Transactions): a table on a desktop, two-line rows on a
 * phone (DESIGN.md § Lists on a phone). Without `onSelect` it is read-only: no row click, no pointer -
 * the Splits page shows it this way. `allTransactions` is the whole ledger, for telling an opening
 * balance from a balance check when `transactions` is a filtered part of it. */
export default function LedgerTable({ transactions, allTransactions, names, onSelect, selectedId, byMonth }) {
  // With an account filter on, the Account lines column and the month totals count only that account.
  const accountId = byMonth?.accountId ?? null
  const { accounts, categories, payees, goals, splits, failed = {} } = names
  const adjustments = adjustmentLabels(allTransactions ?? transactions)
  function splitLabel(id) {
    const match = splits?.find((s) => s.id === id)
    if (!match) return splits || failed.splits ? 'a split' : <Pending />
    return match.archived_on ? `${match.name} (archived)` : match.name
  }
  function billLabel(goalId) {
    const match = goals?.find((g) => g.goal.id === goalId)
    if (!match) return goals || failed.goals ? 'a bill' : <Pending />
    return match.goal.archived_on ? `${match.goal.name} (archived)` : match.goal.name
  }
  const payeeLabel = (t) => (t.payee_id != null ? entityLabel(payees, t.payee_id, `#${t.payee_id}`, failed.payees, 'a payee') : null)
  const accountLines = (t) => t.account_lines.filter((l) => accountId == null || l.account_id === accountId)
  const accountName = (l) => entityLabel(accounts, l.account_id, `#${l.account_id}`, failed.accounts, 'an account')
  const categoryName = (l) => entityLabel(categories, l.category_id, `#${l.category_id}`, failed.categories, 'a category')
  const unassigned = (t) => (t.account_lines.reduce((sum, l) => sum + (l.budget_cents ?? 0), 0) === 0 ? '—' : 'unassigned')
  const notes = (t) => (
    <>
      {t.split_id != null && <div className="text-sm text-text-3">Split: {splitLabel(t.split_id)}</div>}
      {t.goal_id != null && (
        <div className="text-sm text-text-3">
          pays {billLabel(t.goal_id)}, due {formatDate(t.goal_due_on)}
        </div>
      )}
    </>
  )
  const reopenPay = (t) =>
    t.income_stream_id != null && (
      <div>
        <Link className="btn btn-quiet" to={`/income/${t.income_stream_id}/record?date=${t.date}`} onClick={(e) => e.stopPropagation()}>
          Re-open pay
        </Link>
      </div>
    )

  const columns = [
    { key: 'date', header: 'Date', sortKey: byMonth ? 'date' : undefined, cell: (t) => <>{formatDate(t.date)}{reopenPay(t)}</> },
    { key: 'memo', header: 'Memo', cell: (t) => t.memo || '—' },
    { key: 'payee', header: 'Payee', sortKey: byMonth ? 'payee' : undefined, cell: (t) => payeeLabel(t) ?? adjustments.get(t.id) ?? '—' },
    {
      key: 'accounts',
      header: 'Account lines',
      cell: (t) =>
        accountLines(t).map((l) => (
          <div key={l.id}>
            {accountName(l)}: <Amount cents={l.cents} />
          </div>
        )),
    },
    {
      key: 'categories',
      header: 'Category lines',
      cell: (t) => (
        <>
          {t.category_lines.length === 0 && <span className="text-text-2">{unassigned(t)}</span>}
          {t.category_lines.map((l) => (
            <div key={l.id}>
              {categoryName(l)}: <Amount cents={l.cents} />
            </div>
          ))}
          {notes(t)}
        </>
      ),
    },
  ]

  // A phone row: payee (else memo, else the adjustment label) and the date on the first line; each
  // account line as "Account -$64.12" under it, then the category names.
  const phoneRow = (t) => {
    const payee = payeeLabel(t)
    const title = payee ?? (t.memo || adjustments.get(t.id)) ?? '—'
    const cats = t.category_lines.map(categoryName)
    return (
      <>
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words font-medium">{title}</span>
          <span className="shrink-0 whitespace-nowrap text-sm text-text-2">{formatDate(t.date)}</span>
        </div>
        {payee && t.memo && <div className="break-words text-sm text-text-2">{t.memo}</div>}
        {accountLines(t).map((l) => (
          <div key={l.id} className="flex items-baseline justify-between gap-3 text-sm text-text-2">
            <span className="min-w-0 break-words">{accountName(l)}</span>
            <span className="shrink-0 whitespace-nowrap"><Amount cents={l.cents} /></span>
          </div>
        ))}
        <div className="break-words text-sm text-text-2">{cats.length > 0 ? cats.join(', ') : unassigned(t)}</div>
        {notes(t)}
        {reopenPay(t)}
      </>
    )
  }

  const common = { columns, phoneRow, rowId: (t) => t.id, onSelect, selectedId, totalColumn: 3 }
  if (!byMonth) return <List {...common} rows={transactions} />
  const groups = groupByMonth(transactions, byMonth.sort, (id) => payees?.find((p) => p.id === id)?.name ?? '', accountId)
  return (
    <List
      {...common}
      groups={groups}
      isOpen={(key) => !byMonth.collapsed.includes(key)}
      onToggle={byMonth.onToggle}
      sort={byMonth.sort}
      onSort={byMonth.onSort}
    />
  )
}
