import { useEffect, useRef, useState } from 'react'
import Picker from './Picker.jsx'
import { alphabetical } from '../utils/order.js'

// The searchable replacement for a drop-down over a list that could hold more than five items
// (categories, accounts, ...). Controlled like a <select>: `value` is an id as a string, '' for none,
// and `onChange` receives the id as a string. Suggestions are alphabetical.
export default function ChoicePicker({ items, value, onChange, placeholder, ariaLabel, emptyLabel }) {
  const selected = items.find((i) => String(i.id) === String(value))
  const [text, setText] = useState(selected?.name ?? '')
  const previous = useRef(value)

  // Follow a value set from outside (a payee's default category, a loaded transaction); a value
  // cleared from outside empties the box. Typing a partial name leaves '' alone.
  useEffect(() => {
    if (value !== '' && selected) setText(selected.name)
    else if (value === '' && previous.current !== '' && previous.current !== undefined) setText('')
    previous.current = value
  }, [value, selected?.name])

  const needle = text.trim().toLowerCase()
  const shown = alphabetical(items).filter((i) => i.name.toLowerCase().includes(needle))

  function type(typed) {
    setText(typed)
    const match = items.find((i) => i.name.toLowerCase() === typed.trim().toLowerCase())
    onChange(match ? String(match.id) : '')
  }

  return (
    <Picker
      text={text}
      onText={type}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      items={shown}
      onPick={(item) => {
        setText(item.name)
        onChange(String(item.id))
      }}
      onClear={emptyLabel ? () => { setText(''); onChange('') } : undefined}
      clearLabel={emptyLabel}
      onKeyDown={(e) => {
        // Enter picks the first suggestion instead of submitting the form half-filled.
        if (e.key !== 'Enter' || needle === '' || value !== '') return
        e.preventDefault()
        if (shown[0]) {
          setText(shown[0].name)
          onChange(String(shown[0].id))
        }
      }}
    />
  )
}
