import { useEffect, useRef, useState } from 'react'
import Picker from './components/Picker.jsx'

/** Searchable, alphabetical payee picker with an inline "add new" option (DESIGN.md §
 * Payees — picked the same way categories are added by name today, but searchable: every
 * picker that could hold more than five items is searchable, per CLAUDE.md). Without `onAdd`
 * it only picks: the account form's payee lock never creates a payee on the side.
 */
export default function PayeePicker({ payees, payeeId, onSelect, onAdd, onError, inline }) {
  const [query, setQuery] = useState('')
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
  }

  function clear() {
    onSelect(null)
    setQuery('')
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
    // Empty box or a payee already chosen: Enter keeps its normal form-submit behaviour.
    if (e.key !== 'Enter' || trimmed === '' || payeeId !== null) return
    e.preventDefault()
    const target = exactMatch ?? matches[0]
    if (target) choose(target)
    else if (onAdd) addNew()
  }

  return (
    <Picker
      text={query}
      onText={(typed) => {
        setQuery(typed)
        if (payeeId !== null) onSelect(null)
      }}
      placeholder="Search payees…"
      items={matches}
      onPick={choose}
      onClear={clear}
      clearLabel="No payee"
      onAdd={onAdd ? addNew : undefined}
      addNoun="payee"
      emptyText="No payees yet."
      onKeyDown={onKeyDown}
      inline={inline}
    />
  )
}
