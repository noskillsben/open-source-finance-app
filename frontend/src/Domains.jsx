import { useEffect, useState } from 'react'
import { api } from './api.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import { ListRow } from './components/ListRow.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { RefusalNote, SaveNote, WarningNote } from './components/Notes.jsx'
import SidePanel, { PanelLayout } from './components/SidePanel.jsx'
import { formatDate } from './utils/format.js'

// The editable list of domains — a reporting label for categories, nothing more (DESIGN.md § Domains).
// Adding or editing opens the side panel; an add stays open for the next one, an edit closes on save.
export default function Domains({ pickerDate }) {
  const [domains, setDomains] = useState(null)
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [panel, setPanel] = useState(null) // null, 'add', or the domain being edited
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [formError, setFormError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [focusKey, setFocusKey] = useState(0)

  function refresh() {
    api.domains.list(pickerDate, showArchived).then(setDomains).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function open(next) {
    setPanel(next)
    setName(next === 'add' ? '' : next.name)
    setDescription(next === 'add' ? '' : (next.description ?? ''))
    setFormError(null)
    setSaved(null)
    setFocusKey((k) => k + 1)
  }

  function close() {
    setPanel(null)
    setFormError(null)
    setSaved(null)
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setFormError(null)
    if (!name.trim()) return setFormError('Name is required.')
    const body = { name: name.trim(), description: description.trim() || null }
    setSaving(true)
    try {
      if (panel === 'add') {
        await api.domains.create({ ...body, created_on: pickerDate })
        setSaved(`Added ${body.name}.`)
        setName('')
        setDescription('')
      } else {
        await api.domains.update(panel.id, body)
        close()
      }
      refresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
      setFocusKey((k) => k + 1)
    }
  }

  async function toggleArchive(domain) {
    setError(null)
    try {
      if (domain.archived_on) await api.domains.unarchive(domain.id)
      else await api.domains.archive(domain.id, pickerDate)
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const adding = panel === 'add'
  const editing = panel && !adding ? panel : null

  const form = panel && (
    <SidePanel title={editing ? `Edit · ${editing.name}` : 'Add a domain'} onClose={close} focusKey={focusKey}>
      <form onSubmit={submit} className="space-y-4">
        {formError && <RefusalNote>{formError}</RefusalNote>}
        {saved && <SaveNote>{saved}</SaveNote>}
        <label className="block space-y-1">
          <span className="field-label">{editing ? `Rename ${editing.name}` : 'Domain name'}</span>
          <input className="field w-full" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="field-label">Description (optional)</span>
          <input className="field w-full" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>{editing ? 'Save' : 'Add domain'}</Button>
          <Button variant="secondary" onClick={close}>{adding ? 'Done' : 'Cancel'}</Button>
        </div>
      </form>
    </SidePanel>
  )

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title hidden md:block">Domains</h2>
        <Button className="ml-auto" onClick={() => open('add')}>Add a domain</Button>
      </div>

      <PanelLayout panel={form}>
        <section className="card space-y-3">
          <p className="max-w-prose text-text-2">
            A domain is a label for grouping categories in reports — Food might hold Groceries and Dining out.
          </p>
          {error && <WarningNote>{error}</WarningNote>}
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {!error && !domains && <LoadingRows />}
          {domains && domains.length === 0 && (
            <EmptyState action={<Button variant="secondary" onClick={() => open('add')}>Add a domain</Button>}>
              No domains yet.
            </EmptyState>
          )}
          {domains && domains.length > 0 && (
            <ul>
              {domains.map((d) => (
                <ListRow
                  key={d.id}
                  selected={editing?.id === d.id}
                  actions={
                    <>
                      <Button variant="quiet" onClick={() => open(d)}>Edit</Button>
                      <Button variant="quiet" onClick={() => toggleArchive(d)}>
                        {d.archived_on ? 'Unarchive' : 'Archive'}
                      </Button>
                    </>
                  }
                >
                  {d.name}
                  {d.description && <span className="text-text-2"> — {d.description}</span>}
                  {d.archived_on && <span className="block text-sm text-text-3">archived {formatDate(d.archived_on)}</span>}
                </ListRow>
              ))}
            </ul>
          )}
        </section>
      </PanelLayout>
    </div>
  )
}
