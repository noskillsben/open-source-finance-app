import { useEffect, useState } from 'react'
import { api } from './api.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import { ListRow } from './components/ListRow.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { WarningNote } from './components/Notes.jsx'
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
    <div className="space-y-6 py-4">
      <h2 className="page-title hidden md:block">Payees</h2>

      <section className="card space-y-3">
        {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
        {rowError && <WarningNote>{rowError}</WarningNote>}
        {warnings.map((w) => (
          <WarningNote key={w}>{w}</WarningNote>
        ))}
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {!error && !payees && <LoadingRows />}
        {payees && payees.length === 0 && (
          <EmptyState>No payees yet. A payee is added by name from any transaction.</EmptyState>
        )}
        {payees && payees.length > 0 && (
          <ul>
            {payees.map((p) => (
              <ListRow
                key={p.id}
                actions={
                  <Button variant="quiet" onClick={() => (p.archived_on ? unarchivePayee(p) : archivePayee(p))}>
                    {p.archived_on ? 'Unarchive' : 'Archive'}
                  </Button>
                }
              >
                {p.name}
                {p.archived_on && <div className="text-sm text-text-3">archived {formatDate(p.archived_on)}</div>}
              </ListRow>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
