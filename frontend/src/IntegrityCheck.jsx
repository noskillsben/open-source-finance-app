import { useEffect, useState } from 'react'
import { api } from './api.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { WarningNote } from './components/Notes.jsx'
import { formatCents, formatDate } from './utils/format.js'

const KIND_LABELS = {
  invariant: "Category lines don't add up",
  settings_drift: 'Would compute differently under today\'s settings',
  netting: "Opening balance netting is wrong: a row before the opening that was not absorbed, or absorbed into an opening nobody stated",
}

function issueLabel(f) {
  if (f.kind === 'stale_cover') {
    const category = f.category_name ? ` for ${f.category_name}` : ''
    const pool = f.pool_name ? ` (pool: ${f.pool_name})` : ''
    return `Pool cover is out of date${category}${pool}: an earlier spend was added after this one was saved, so saving it again would draw a different amount`
  }
  return KIND_LABELS[f.kind] ?? f.kind
}

export default function IntegrityCheck() {
  const [payees, setPayees] = useState(null)
  const [findings, setFindings] = useState(null)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)

  function refresh() {
    api.payees.list().then(setPayees).catch((e) => setError(e.message))
    api.integrityCheck.list().then(setFindings).catch((e) => setError(e.message))
  }

  useEffect(refresh, [])

  async function reSave(transactionId) {
    setSavingId(transactionId)
    setError(null)
    try {
      await api.transactions.reSave(transactionId)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-6 py-4">
      <h2 className="page-title hidden md:block">Data check</h2>

      <section className="card space-y-2">
        {error && <WarningNote>{error}</WarningNote>}
        {!error && !findings && <LoadingRows />}
        {findings && findings.length === 0 && (
          <EmptyState>No mismatches found.</EmptyState>
        )}
        {findings && findings.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-text-2">
                <th className="pb-1">Date</th>
                <th className="pb-1">Payee</th>
                <th className="pb-1">Issue</th>
                <th className="pb-1">Expected</th>
                <th className="pb-1">Stored</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f, i) => (
                <tr key={`${f.transaction_id}-${f.kind}-${i}`}>
                  <td className="py-1 align-top">{formatDate(f.date)}</td>
                  <td className="py-1 align-top">
                    {payees?.find((p) => p.id === f.payee_id)?.name ?? (f.payee_id ? `#${f.payee_id}` : '—')}
                  </td>
                  <td className="py-1 align-top">{issueLabel(f)}</td>
                  <td className="tabular py-1 align-top">{formatCents(f.expected_cents)}</td>
                  <td className="tabular py-1 align-top">{formatCents(f.stored_cents)}</td>
                  <td className="py-1 align-top">
                    <Button variant="secondary" disabled={savingId === f.transaction_id} onClick={() => reSave(f.transaction_id)}>
                      Re-save
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
