import { createPortal } from 'react-dom'
import { formatCents, formatDate } from './utils/format.js'

// One member's balance laid out for paper (DESIGN.md § Splits → "A member's balance prints as a
// statement to settle up with"). Nothing is generated or stored: it is the page's own list. It is
// mounted on <body> and shown only by the print stylesheet in index.css, which hides the app.

/** The rows of the statement, oldest first. Cents are integers; a running total is the plain sum of
 * the member account's lines, so the last one is the balance the page shows. */
export function statementRows(transactions, accountId, names = {}) {
  const sorted = [...transactions].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
  let running = 0
  return sorted.map((t) => {
    const share = t.account_lines.filter((l) => l.account_id === accountId).reduce((sum, l) => sum + l.cents, 0)
    running += share
    const isBill = t.split_id != null
    const iPaid = isBill && t.paid_by_payee_id == null
    let bill = null
    if (iPaid) {
      // My paying account line: what left my accounts, never another member's receivable.
      const paid = t.account_lines.filter((l) => l.account_id !== accountId && l.cents < 0).reduce((sum, l) => sum - l.cents, 0)
      bill = paid > 0 ? paid : null
    } else if (isBill) {
      bill = t.shared_total_cents ?? null // a bill saved before the field existed prints its share only
    }
    const payer = !isBill ? '' : iPaid ? 'You' : names.payees?.find((p) => p.id === t.paid_by_payee_id)?.name ?? ''
    const categories = t.category_lines
      .map((l) => names.categories?.find((c) => c.id === l.category_id)?.name)
      .filter(Boolean)
      .filter((n, i, all) => all.indexOf(n) === i)
      .join(', ')
    const payee = names.payees?.find((p) => p.id === t.payee_id)?.name ?? ''
    return { id: t.id, date: t.date, payee: payee || t.memo || '', categories, bill, payer, share, running }
  })
}

export default function MemberStatement({ memberName, balance, names, pickerDate }) {
  const cents = balance.balance_cents
  const rows = statementRows(balance.transactions, balance.account_id, names)
  const total = cents > 0 ? `${memberName} owes you ${formatCents(cents)}` : cents < 0 ? `You owe ${memberName} ${formatCents(-cents)}` : 'Settled up'
  return createPortal(
    <div id="print-statement" aria-label={`Statement for ${memberName}`}>
      <h1 className="text-title">{memberName}</h1>
      <p>{formatDate(pickerDate)}</p>
      <table className="mt-4 w-full">
        <thead>
          <tr>
            <th>Date</th>
            <th>Payee</th>
            <th>Category</th>
            <th className="text-right">Whole bill</th>
            <th>Paid by</th>
            <th className="text-right">Their share</th>
            <th className="text-right">Running total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.date)}</td>
              <td>{r.payee}</td>
              <td>{r.categories}</td>
              <td className="text-right">{r.bill != null ? formatCents(r.bill) : ''}</td>
              <td>{r.payer}</td>
              <td className="text-right">{formatCents(r.share)}</td>
              <td className="text-right">{formatCents(r.running)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-section">{total}</p>
    </div>,
    document.body,
  )
}
