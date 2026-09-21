import { useEffect, useState } from 'react'
import { api } from './api.js'
import Domains from './Domains.jsx'
import NamePicker from './NamePicker.jsx'
import { formatCents, formatDate, parseCents } from './utils/format.js'

// The fixed ordinal scale (DESIGN.md § Need levels) — shown in its real order, not alphabetically.
const NEED_LEVELS = [
  { value: 'need', label: 'Need' },
  { value: 'should', label: 'Should' },
  { value: 'nice_to_have', label: 'Nice to have' },
  { value: 'want', label: 'Want' },
]
const needLabel = (value) => NEED_LEVELS.find((n) => n.value === value)?.label

// Children follow their parent (alphabetical within each level). A child whose parent isn't in the
// list — archived and hidden, say — is shown at the top level rather than dropped.
function orderTree(categories) {
  const ids = new Set(categories.map((c) => c.id))
  const byParent = new Map()
  for (const c of categories) {
    const key = c.parent_id !== null && ids.has(c.parent_id) ? c.parent_id : null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(c)
  }
  const rows = []
  function walk(parentId, depth) {
    for (const c of byParent.get(parentId) ?? []) {
      rows.push({ category: c, depth })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

const EMPTY_FORM = { name: '', needLevel: '', parent: {}, pool: {}, domain: {} }

// A picker's state is { id, text }: `text` is what was typed, so a name that matches nothing can be
// refused rather than silently saved as "none".
function unmatched(pick) {
  return pick.text && pick.id == null
}

export default function Categories({ pickerDate }) {
  const [categories, setCategories] = useState(null)
  const [domains, setDomains] = useState([])
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [rowError, setRowError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [editing, setEditing] = useState(null) // the category being edited, or null when adding
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState(null)
  const [formKey, setFormKey] = useState(0) // remounts the form so its pickers reseed their text
  const [summary, setSummary] = useState(null) // ready to assign, overspent and each category's available
  const [amounts, setAmounts] = useState({}) // the assign box's text per category id
  const [assignError, setAssignError] = useState(null)

  function refresh() {
    api.categories.list(pickerDate, showArchived).then(setCategories).catch((e) => setError(e.message))
    api.domains.list(pickerDate).then(setDomains).catch((e) => setError(e.message))
    api.readyToAssign(pickerDate).then(setSummary).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function startEdit(category) {
    setFormKey((k) => k + 1)
    setEditing(category)
    setForm({
      name: category.name,
      needLevel: category.need_level ?? '',
      parent: { id: category.parent_id },
      pool: { id: category.pool_id },
      domain: { id: category.domain_id },
    })
    setFormError(null)
  }

  function resetForm() {
    setFormKey((k) => k + 1)
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function submit(e) {
    e.preventDefault()
    setFormError(null)
    const name = form.name.trim()
    if (!name) return setFormError('Name is required.')
    for (const [label, pick] of [['parent', form.parent], ['pool', form.pool], ['domain', form.domain]]) {
      if (unmatched(pick)) return setFormError(`"${pick.text}" is not an existing ${label}. Pick one from the list or clear the box.`)
    }
    const settings = {
      name,
      parent_id: form.parent.id ?? null,
      pool_id: form.pool.id ?? null,
      domain_id: form.domain.id ?? null,
      need_level: form.needLevel || null,
    }
    try {
      if (editing) await api.categories.update(editing.id, settings)
      else await api.categories.create({ ...settings, created_on: pickerDate })
      resetForm()
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  // One earmark move line, dated the "Show as of" date, from ready to assign into the category.
  async function assign(category) {
    setAssignError(null)
    const cents = parseCents(amounts[category.id])
    if (cents === null || cents === 0) return setAssignError(`Enter an amount to assign to ${category.name}.`)
    try {
      await api.earmarkLines.create({ date: pickerDate, category_id: category.id, cents })
      setAmounts({ ...amounts, [category.id]: '' })
      refresh()
    } catch (err) {
      setAssignError(err.message)
    }
  }

  // Archives on the "Show as of" date. Warnings never block: the archive has already happened when shown.
  async function archiveCategory(category) {
    setRowError(null)
    setWarnings([])
    try {
      const result = await api.categories.archive(category.id, pickerDate)
      setWarnings(result.warnings.map((w) => `${category.name}: ${w}`))
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  async function unarchiveCategory(category) {
    setRowError(null)
    setWarnings([])
    try {
      await api.categories.unarchive(category.id)
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  const rows = categories ? orderTree(categories) : []
  const domainName = (id) => domains.find((d) => d.id === id)?.name
  const active = (categories ?? []).filter((c) => !c.archived_on)
  const available = (id) => summary?.categories.find((c) => c.category_id === id)?.available_cents ?? 0

  return (
    <div className="py-6 space-y-6">
      <h2 className="text-xl font-semibold">Categories</h2>

      {summary && (
        <p className="text-lg">
          Ready to assign {formatCents(summary.ready_to_assign_cents)}
          {summary.overspent_cents !== 0 && (
            <span className="text-sm text-paper-soft">
              {' '}(includes {formatCents(summary.overspent_cents)} in overspent categories)
            </span>
          )}
        </p>
      )}

      <form
        key={formKey}
        onSubmit={submit}
        className="rounded-lg bg-ink-soft p-4 space-y-3"
      >
        <h3 className="font-medium">{editing ? `Edit ${editing.name}` : 'Add a category'}</h3>
        {formError && <p className="text-bad">{formError}</p>}
        <label className="block text-sm">
          <span className="text-paper-soft">Name</span>
          <input
            className="mt-1 w-full rounded bg-ink px-2 py-1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <NamePicker
          label="Sits under (optional)"
          items={active.filter((c) => !editing || c.id !== editing.id)}
          initialId={form.parent.id}
          onChange={(id, text) => setForm({ ...form, parent: { id, text } })}
        />
        <NamePicker
          label="Domain (optional)"
          items={domains}
          initialId={form.domain.id}
          onChange={(id, text) => setForm({ ...form, domain: { id, text } })}
        />
        <label className="block text-sm">
          <span className="text-paper-soft">Default need level</span>
          <select
            className="mt-1 w-full rounded bg-ink px-2 py-1"
            value={form.needLevel}
            onChange={(e) => setForm({ ...form, needLevel: e.target.value })}
          >
            <option value="">Not set</option>
            {NEED_LEVELS.map((n) => (
              <option key={n.value} value={n.value}>{n.label}</option>
            ))}
          </select>
        </label>
        <NamePicker
          label="Draws on when overspent (its pool, optional)"
          items={active.filter((c) => !editing || c.id !== editing.id)}
          initialId={form.pool.id}
          onChange={(id, text) => setForm({ ...form, pool: { id, text } })}
        />
        <div className="flex gap-3">
          <button type="submit" className="rounded bg-accent px-3 py-1 text-ink">
            {editing ? 'Save' : 'Add category'}
          </button>
          {editing && (
            <button type="button" className="text-sm text-accent" onClick={resetForm}>Cancel</button>
          )}
        </div>
      </form>

      <section className="rounded-lg bg-ink-soft p-4 space-y-2">
        {error && <p className="text-bad">Could not reach the backend: {error}</p>}
        {rowError && <p className="text-bad">{rowError}</p>}
        {assignError && <p className="text-bad">{assignError}</p>}
        {warnings.map((w) => (
          <p key={w} className="text-sm text-bad">{w}</p>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {!error && !categories && <p>Loading…</p>}
        {categories && categories.length === 0 && <p className="text-paper-soft">No categories yet.</p>}
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-paper-soft">
                <th className="pb-1">Name</th>
                <th className="pb-1">Domain</th>
                <th className="pb-1">Need level</th>
                <th className="pb-1 text-right">Available</th>
                <th className="pb-1">Assign</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ category: c, depth }) => (
                <tr key={c.id}>
                  <td className="py-1" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                    {c.name}
                    {c.archived_on && (
                      <div className="text-xs text-paper-soft">archived {formatDate(c.archived_on)}</div>
                    )}
                  </td>
                  <td className="py-1">{domainName(c.domain_id) ?? ''}</td>
                  <td className="py-1">{needLabel(c.need_level) ?? ''}</td>
                  <td className={`py-1 text-right ${available(c.id) < 0 ? 'text-bad' : ''}`}>
                    {formatCents(available(c.id))}
                  </td>
                  <td className="py-1 whitespace-nowrap">
                    {!c.archived_on && (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault()
                          assign(c)
                        }}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Amount to assign to ${c.name}`}
                          className="w-24 rounded bg-ink px-2 py-1"
                          value={amounts[c.id] ?? ''}
                          onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                        />
                        <button type="submit" className="text-xs text-accent">Assign</button>
                      </form>
                    )}
                  </td>
                  <td className="py-1 text-right space-x-3 whitespace-nowrap">
                    <button type="button" className="text-xs text-accent" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={() => (c.archived_on ? unarchiveCategory(c) : archiveCategory(c))}
                    >
                      {c.archived_on ? 'Unarchive' : 'Archive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Domains pickerDate={pickerDate} onChange={refresh} />
    </div>
  )
}
