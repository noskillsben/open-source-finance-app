import { useId, useState } from 'react'

// A searchable picker (type-ahead) over `items` ({ id, name }): the user types a name and picks a
// suggestion, and `onChange` receives the matching id, or null when nothing matches (an empty box
// included). It seeds its text from `initialId` once; give the parent form a `key` to reseed it.
export default function NamePicker({ label, items, initialId = null, onChange, placeholder = 'None' }) {
  const listId = useId()
  const [text, setText] = useState(() => items.find((i) => i.id === initialId)?.name ?? '')
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))

  function handle(e) {
    const typed = e.target.value
    setText(typed)
    const match = items.find((i) => i.name.toLowerCase() === typed.trim().toLowerCase())
    onChange(match ? match.id : null, typed)
  }

  return (
    <label className="block text-sm">
      <span className="text-paper-soft">{label}</span>
      <input
        list={listId}
        className="mt-1 w-full rounded bg-ink px-2 py-1"
        placeholder={placeholder}
        value={text}
        onChange={handle}
      />
      <datalist id={listId}>
        {sorted.map((i) => (
          <option key={i.id} value={i.name} />
        ))}
      </datalist>
    </label>
  )
}
