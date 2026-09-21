import { useEffect, useState } from 'react'
import { api } from './api.js'
import { formatDate } from './utils/format.js'

// The editable list of domains — a reporting label for categories, nothing more (DESIGN.md § Domains).
export default function Domains({ pickerDate, onChange }) {
  const [domains, setDomains] = useState(null)
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  function refresh() {
    api.domains.list(pickerDate, showArchived).then(setDomains).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function done() {
    setEditing(null)
    setName('')
    setDescription('')
    setError(null)
    refresh()
    onChange?.()
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Name is required.')
    const body = { name: name.trim(), description: description.trim() || null }
    try {
      if (editing) await api.domains.update(editing.id, body)
      else await api.domains.create({ ...body, created_on: pickerDate })
      done()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleArchive(domain) {
    setError(null)
    try {
      if (domain.archived_on) await api.domains.unarchive(domain.id)
      else await api.domains.archive(domain.id, pickerDate)
      done()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(domain) {
    setEditing(domain)
    setName(domain.name)
    setDescription(domain.description ?? '')
  }

  return (
    <section className="rounded-lg bg-ink-soft p-4 space-y-3">
      <h3 className="font-medium">Domains</h3>
      <p className="text-sm text-paper-soft">
        A domain is a label for grouping categories in reports — Food might hold Groceries and Dining out.
      </p>
      {error && <p className="text-bad">{error}</p>}
      <form onSubmit={submit} className="space-y-2">
        <label className="block text-sm">
          <span className="text-paper-soft">{editing ? `Rename ${editing.name}` : 'Domain name'}</span>
          <input className="mt-1 w-full rounded bg-ink px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-paper-soft">Description (optional)</span>
          <input
            className="mt-1 w-full rounded bg-ink px-2 py-1"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="flex gap-3">
          <button type="submit" className="rounded bg-accent px-3 py-1 text-ink">
            {editing ? 'Save' : 'Add domain'}
          </button>
          {editing && (
            <button type="button" className="text-sm text-accent" onClick={done}>Cancel</button>
          )}
        </div>
      </form>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived
      </label>
      {domains && domains.length === 0 && <p className="text-paper-soft">No domains yet.</p>}
      {domains && domains.length > 0 && (
        <ul className="text-sm space-y-1">
          {domains.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-3">
              <span>
                {d.name}
                {d.description && <span className="text-paper-soft"> — {d.description}</span>}
                {d.archived_on && <span className="block text-xs text-paper-soft">archived {formatDate(d.archived_on)}</span>}
              </span>
              <span className="space-x-3 whitespace-nowrap">
                <button type="button" className="text-xs text-accent" onClick={() => startEdit(d)}>Edit</button>
                <button type="button" className="text-xs text-accent" onClick={() => toggleArchive(d)}>
                  {d.archived_on ? 'Unarchive' : 'Archive'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
