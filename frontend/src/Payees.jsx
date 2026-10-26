import { useEffect, useState } from 'react'
import { api } from './api.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import { ListRow } from './components/ListRow.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { WarningNote } from './components/Notes.jsx'
import SidePanel, { PanelLayout } from './components/SidePanel.jsx'
import { formatDate } from './utils/format.js'

export default function Payees({ pickerDate }) {
  const [payees, setPayees] = useState(null)
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [rowError, setRowError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [openId, setOpenId] = useState(null) // the payee whose panel is open
  const [focusKey, setFocusKey] = useState(0)

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

  function openPayee(p) {
    setOpenId(p.id)
    setFocusKey((k) => k + 1)
  }

  const open = payees?.find((p) => p.id === openId)
  const panel = open && (
    <SidePanel title={open.name} onClose={() => setOpenId(null)} focusKey={focusKey}>
      <p className="text-text-2">
        {open.archived_on
          ? `Archived ${formatDate(open.archived_on)}. It no longer appears in pickers; what was recorded with it stays.`
          : 'A payee is added by name from any transaction.'}
      </p>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-3">
        {/* Archive, quiet negative, at the panel's foot (DESIGN.md § Row actions). */}
        <Button variant="destructive" onClick={() => (open.archived_on ? unarchivePayee(open) : archivePayee(open))}>
          {open.archived_on ? 'Unarchive' : 'Archive'}
        </Button>
        <Button variant="secondary" onClick={() => setOpenId(null)}>Close</Button>
      </div>
    </SidePanel>
  )

  return (
    <div className="space-y-6 py-4">
      <h2 className="page-title hidden md:block">Payees</h2>

      <PanelLayout panel={panel}>
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
                selected={openId === p.id}
                onSelect={() => openPayee(p)}
                rowProps={{
                  tabIndex: 0,
                  onKeyDown: (e) => {
                    if (e.target === e.currentTarget && e.key === 'Enter') openPayee(p)
                  },
                }}
              >
                {p.name}
                {p.archived_on && <div className="text-sm text-text-3">archived {formatDate(p.archived_on)}</div>}
              </ListRow>
            ))}
          </ul>
        )}
      </section>
      </PanelLayout>
    </div>
  )
}
