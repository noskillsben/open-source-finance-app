import { useId, useState } from 'react'
import Picker from './components/Picker.jsx'

// A searchable picker (type-ahead) over `items` ({ id, name }): the user types a name and picks a
// suggestion, and `onChange` receives the matching id, or null when nothing matches (an empty box
// included). It seeds its text from `initialId` once; give the parent form a `key` to reseed it.
export default function NamePicker({ label, items, initialId = null, onChange, placeholder = 'None' }) {
  const id = useId()
  const [text, setText] = useState(() => items.find((i) => i.id === initialId)?.name ?? '')
  const needle = text.trim().toLowerCase()
  const shown = [...items]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((i) => i.name.toLowerCase().includes(needle))

  function type(typed) {
    setText(typed)
    const match = items.find((i) => i.name.toLowerCase() === typed.trim().toLowerCase())
    onChange(match ? match.id : null, typed)
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="field-label block">{label}</label>
      <Picker
        id={id}
        text={text}
        onText={type}
        placeholder={placeholder}
        items={shown}
        onPick={(item) => {
          setText(item.name)
          onChange(item.id, item.name)
        }}
      />
    </div>
  )
}
