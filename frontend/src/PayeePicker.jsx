import { useEffect, useState } from 'react'

/** Searchable, alphabetical payee picker with an inline "add new" option (DESIGN.md §
 * Payees — picked the same way categories are added by name today, but searchable: every
 * picker that could hold more than five items is searchable, per CLAUDE.md).
 */
export default function PayeePicker({ payees, payeeId, onSelect, onAdd, onError }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const selected = payees?.find((p) => p.id === payeeId) ?? null

  // Keep the text box in sync with the selection made elsewhere (e.g. loading a transaction to edit).
  useEffect(() => {
    setQuery(selected ? selected.name : '')
  }, [selected?.id])

  const trimmed = query.trim()
  const matches =
    payees?.filter((p) => p.name.toLowerCase().includes(trimmed.toLowerCase())) ?? []
  const exactMatch = payees?.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())

  function choose(payee) {
    onSelect(payee.id)
    setQuery(payee.name)
    setOpen(false)
  }

  function clear() {
    onSelect(null)
    setQuery('')
    setOpen(false)
  }

  async function addNew() {
    try {
      const payee = await onAdd(trimmed)
      choose(payee)
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <div className="relative">
      <input
        className="w-full rounded bg-ink px-2 py-1"
        placeholder="Search payees…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          if (payeeId !== null) onSelect(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded bg-ink-soft shadow-lg max-h-48 overflow-auto text-sm">
          {trimmed === '' && (
            <button type="button" className="block w-full text-left px-2 py-1 text-paper-soft hover:bg-ink" onMouseDown={clear}>
              No payee
            </button>
          )}
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              className="block w-full text-left px-2 py-1 hover:bg-ink"
              onMouseDown={() => choose(p)}
            >
              {p.name}
            </button>
          ))}
          {matches.length === 0 && trimmed === '' && (
            <p className="px-2 py-1 text-paper-soft">No payees yet.</p>
          )}
          {trimmed !== '' && !exactMatch && (
            <button
              type="button"
              className="block w-full text-left px-2 py-1 text-accent hover:bg-ink"
              onMouseDown={addNew}
            >
              + add payee "{trimmed}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}
