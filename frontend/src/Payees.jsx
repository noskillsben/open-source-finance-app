import { useEffect, useState } from 'react'
import { api } from './api.js'
import { formatDate } from './utils/format.js'

export default function Payees({ pickerDate }) {
  const [payees, setPayees] = useState(null)
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [rowError, setRowError] = useState(null)
  const [warnings, setWarnings] = useState([])

  function refresh() {
    api.payees.list(pickerDate, showArchived).then(setPayees).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  // Archives on the "Show as of" date. Warnings never block: the archive has already happened when shown.
  async function archivePayee(payee) {
    setRowError(null)
    setWarnings([])
    try {
      const result = await api.payees.archive(payee.id, pickerDate)
      setWarnings(result.warnings.map((w) => `${payee.name}: ${w}`))
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  async function unarchivePayee(payee) {
    setRowError(null)
    setWarnings([])
    try {
      await api.payees.unarchive(payee.id)
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  return (
    <div className="py-6 space-y-6">
      <h2 className="text-xl font-semibold">Payees</h2>

      <section className="rounded-lg bg-ink-soft p-4 space-y-2">
        {error && <p className="text-bad">Could not reach the backend: {error}</p>}
        {rowError && <p className="text-bad">{rowError}</p>}
        {warnings.map((w) => (
          <p key={w} className="text-sm text-bad">{w}</p>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {!error && !payees && <p>Loading…</p>}
        {payees && payees.length === 0 && <p className="text-paper-soft">No payees yet.</p>}
        {payees && payees.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-paper-soft">
                <th className="pb-1">Name</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {payees.map((p) => (
                <tr key={p.id}>
                  <td className="py-1">
                    {p.name}
                    {p.archived_on && (
                      <div className="text-xs text-paper-soft">archived {formatDate(p.archived_on)}</div>
                    )}
                  </td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={() => (p.archived_on ? unarchivePayee(p) : archivePayee(p))}
                    >
                      {p.archived_on ? 'Unarchive' : 'Archive'}
                    </button>
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
