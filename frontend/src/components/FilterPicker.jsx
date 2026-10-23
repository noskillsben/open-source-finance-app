import { useEffect, useState } from 'react'
import Picker from './Picker.jsx'

// A facet for ListFilters that chooses one of a long list by typing: the shared searchable Picker, with
// "<label>: all" first to clear it. `items` are [{ id, name }] (archived ones already marked
// "(archived)"); `value` is the chosen id as a string, '' for all. Alphabetical, as every picker is.
export default function FilterPicker({ label, items, value, onChange }) {
  const labelOf = (v) => items.find((i) => String(i.id) === v)?.name ?? ''
  const [text, setText] = useState(() => labelOf(value))
  // The chosen id (or a Clear) rewrites the box; typing alone never does.
  useEffect(() => setText(labelOf(value)), [value, items]) // eslint-disable-line react-hooks/exhaustive-deps
  const needle = text.trim().toLowerCase()
  const shown = [...items]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((i) => i.name.toLowerCase().includes(needle))
  return (
    // Leaving the box with text that picked nothing puts the chosen name (or the placeholder) back.
    <div className="w-48" onBlur={() => setText(labelOf(value))}>
      <Picker
        ariaLabel={`Filter by ${label.toLowerCase()}`}
        placeholder={`${label}: all`}
        text={text}
        onText={(t) => {
          setText(t)
          if (t.trim() === '' && value !== '') onChange('')
        }}
        items={shown}
        onPick={(i) => onChange(String(i.id))}
        onClear={() => onChange('')}
        clearLabel={`${label}: all`}
      />
    </div>
  )
}
