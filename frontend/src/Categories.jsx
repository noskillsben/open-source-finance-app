import { useEffect, useState } from 'react'
import { api } from './api.js'
import { formatDate } from './utils/format.js'

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

export default function Categories({ pickerDate }) {
  const [categories, setCategories] = useState(null)
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [rowError, setRowError] = useState(null)
  const [warnings, setWarnings] = useState([])

  function refresh() {
    api.categories.list(pickerDate, showArchived).then(setCategories).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

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

  return (
    <div className="py-6 space-y-6">
      <h2 className="text-xl font-semibold">Categories</h2>

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
        {!error && !categories && <p>Loading…</p>}
        {categories && categories.length === 0 && <p className="text-paper-soft">No categories yet.</p>}
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-paper-soft">
                <th className="pb-1">Name</th>
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
                  <td className="py-1 text-right">
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
    </div>
  )
}
