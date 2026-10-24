import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { WarningNote } from './components/Notes.jsx'
import { formatDateTime } from './utils/format.js'

export const NO_BACKUP = 'No backup yet — the first one is taken at 03:00 UTC.'

export const HELD_LINE =
  'This database is empty but backups exist. Restore one to carry on. To start over with no data, move the nightly backups out of the backups folder and restart.'

// `held`: the app is on the restore screen (health says held). Same section, minus what the backend refuses while held.
export default function Settings({ held = false }) {
  const [latest, setLatest] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [files, setFiles] = useState([])
  const [confirming, setConfirming] = useState(null) // the file whose Restore was pressed
  const [restoring, setRestoring] = useState(false)
  const [adding, setAdding] = useState(false)
  const fileInput = useRef(null)

  function loadFiles() {
    return api.backups.list().then(setFiles).catch((e) => setError(e.message))
  }

  useEffect(() => {
    api.backups.latest().then(setLatest).catch((e) => setError(e.message))
    loadFiles()
  }, [])

  async function restore() {
    setRestoring(true)
    setError(null)
    try {
      await api.backups.restore(confirming.name)
      window.location.reload()
    } catch (err) {
      setError(err.message)
      setConfirming(null)
      setRestoring(false)
    }
  }

  async function addFile(event) {
    const file = event.target.files?.[0]
    event.target.value = '' // so the same file can be picked again
    if (!file) return
    setAdding(true)
    setError(null)
    try {
      await api.backups.upload(file)
      await loadFiles()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

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
      loadFiles()
    } catch (err) {
      setError(err.message)
    } finally {
      setBackingUp(false)
    }
  }

  const backUpButton = (
    <Button variant="secondary" disabled={backingUp || restoring} onClick={backUpNow}>
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

  const confirmBox = confirming && (
    <div role="alertdialog" aria-label="Restore backup" className="note note-warning space-y-3">
      <p>
        Restore the backup from {formatDateTime(confirming.taken_at)}? Everything you have recorded since then
        is replaced. A backup of your current data is taken first.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" disabled={restoring} onClick={restore}>
          {restoring ? 'Restoring…' : 'Replace my data'}
        </Button>
        <Button variant="quiet" disabled={restoring} onClick={() => setConfirming(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6 py-4">
      {restoring && <div className="fixed inset-0 z-50 cursor-wait" aria-hidden="true" />}
      <h2 className="page-title hidden md:block">Settings</h2>

      <section className="card space-y-3">
        <h3 className="text-lg font-medium">Backup</h3>
        {held && <p className="text-text-2">{HELD_LINE}</p>}
        {error && <WarningNote>{error}</WarningNote>}
        {!latest && !error && <LoadingRows />}
        {latest && !latest.name && (
          <div className="flex flex-col items-start gap-3">
            <EmptyState>{NO_BACKUP}</EmptyState>
            {!held && backUpButton}
          </div>
        )}
        {latest?.name && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-text-2">Last backup: {formatDateTime(latest.taken_at)}</p>
            <Button variant="secondary" disabled={downloading || restoring} onClick={download}>
              Download latest backup
            </Button>
            {!held && backUpButton}
          </div>
        )}
        <div className="flex flex-col items-start gap-3">
          <input ref={fileInput} type="file" accept=".sql" className="hidden" aria-label="Backup file" onChange={addFile} />
          <Button variant="secondary" disabled={adding || restoring} onClick={() => fileInput.current?.click()}>
            {adding ? 'Adding…' : 'Add a backup file'}
          </Button>
        </div>
        {files.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-label uppercase text-text-3">Restore a backup</h4>
            <ul className="divide-y divide-line">
              {files.map((file) => (
                <li key={file.name} className="space-y-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block">{formatDateTime(file.taken_at)}</span>
                      <span className="block break-all text-sm text-text-3">{file.name}</span>
                    </span>
                    <Button variant="secondary" disabled={restoring} onClick={() => setConfirming(file)}>
                      Restore
                    </Button>
                  </div>
                  {/* Under the row pressed, not after the list: a long list put it off screen. */}
                  {confirming?.name === file.name && confirmBox}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!held && <div className="flex flex-col items-start gap-3">
          <p className="text-text-2">Every table as a spreadsheet file, in one zip. You can't import it back.</p>
          <Button variant="secondary" disabled={exporting || restoring} onClick={exportData}>
            Export data
          </Button>
        </div>}
      </section>
    </div>
  )
}
