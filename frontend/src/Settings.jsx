import { useEffect, useState } from 'react'
import { api } from './api.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { WarningNote } from './components/Notes.jsx'
import { formatDateTime } from './utils/format.js'

export const NO_BACKUP = 'No backup yet — the first one is taken at 03:00 UTC.'

export default function Settings() {
  const [latest, setLatest] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    api.backups.latest().then(setLatest).catch((e) => setError(e.message))
  }, [])

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function exportData() {
    setExporting(true)
    setError(null)
    try {
      const { blob, filename } = await api.exportData.download()
      saveBlob(blob, filename || 'export.zip')
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  async function backUpNow() {
    setBackingUp(true)
    setError(null)
    try {
      setLatest(await api.backups.takeNow())
    } catch (err) {
      setError(err.message)
    } finally {
      setBackingUp(false)
    }
  }

  const backUpButton = (
    <Button variant="secondary" disabled={backingUp} onClick={backUpNow}>
      {backingUp ? 'Taking backup…' : 'Back up now'}
    </Button>
  )

  async function download() {
    setDownloading(true)
    setError(null)
    try {
      saveBlob(await api.backups.downloadLatest(), latest.name)
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6 py-4">
      <h2 className="page-title hidden md:block">Settings</h2>

      <section className="card space-y-3">
        <h3 className="text-lg font-medium">Backup</h3>
        {error && <WarningNote>{error}</WarningNote>}
        {!latest && !error && <LoadingRows />}
        {latest && !latest.name && (
          <div className="flex flex-col items-start gap-3">
            <EmptyState>{NO_BACKUP}</EmptyState>
            {backUpButton}
          </div>
        )}
        {latest?.name && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-text-2">Last backup: {formatDateTime(latest.taken_at)}</p>
            <Button variant="secondary" disabled={downloading} onClick={download}>
              Download latest backup
            </Button>
            {backUpButton}
          </div>
        )}
        <div className="flex flex-col items-start gap-3">
          <p className="text-text-2">Every table as a spreadsheet file, in one zip. You can't import it back.</p>
          <Button variant="secondary" disabled={exporting} onClick={exportData}>
            Export data
          </Button>
        </div>
      </section>
    </div>
  )
}
