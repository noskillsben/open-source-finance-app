import { useEffect, useRef, useState } from 'react'

/** Searchable, alphabetical payee picker with an inline "add new" option (DESIGN.md §
 * Payees — picked the same way categories are added by name today, but searchable: every
 * picker that could hold more than five items is searchable, per CLAUDE.md).
 */
export default function PayeePicker({ payees, payeeId, onSelect, onAdd, onError }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // A ref, not state: state isn't updated until the next render, so a second press in the same
  // instant would still see "not adding".
  const adding = useRef(false)

  const selected = payees?.find((p) => p.id === payeeId) ?? null

  // Show a payee selected elsewhere (e.g. a bill's last payee). Never clears: deselecting happens
  // while typing, and the form remounts this picker (key) when it resets or loads a transaction.
  useEffect(() => {
    if (selected) setQuery(selected.name)
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
    if (adding.current) return
    adding.current = true
    try {
      const payee = await onAdd(trimmed)
      choose(payee)
    } catch (err) {
      onError(err.message)
    } finally {
      adding.current = false
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    // Empty box or a payee already chosen: Enter keeps its normal form-submit behaviour.
    if (e.key !== 'Enter' || trimmed === '' || payeeId !== null) return
    e.preventDefault()
    const target = exactMatch ?? matches[0]
    if (target) choose(target)
    else addNew()
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
        onKeyDown={onKeyDown}
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
