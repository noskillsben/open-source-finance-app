import { useState } from 'react'

// The searchable picker (DESIGN.md § Visual design → Components): a type-ahead box over a raised
// list, secondary detail on the right of each suggestion, and "Add '…' as a new …" last. It only
// draws; the parent owns the text and decides what picking, clearing and adding mean.
//   inline: the list takes its own room in the flow instead of floating over the fields below (a panel
//   whose scroll would clip it).
//   items: [{ id, name, detail? }], already filtered and ordered by the caller.
export default function Picker({
  text,
  onText,
  placeholder,
  id,
  ariaLabel,
  disabled,
  items,
  onPick,
  onClear,
  clearLabel,
  onAdd,
  addNoun,
  emptyText,
  onKeyDown,
  inline,
}) {
  const [open, setOpen] = useState(false)
  const trimmed = text.trim()
  const exact = items.some((i) => i.name.toLowerCase() === trimmed.toLowerCase())
  const row = 'flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface'

  return (
    <div className="relative">
      <input
        id={id}
        aria-label={ariaLabel}
        className="field w-full"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => {
          onText(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
            return
          }
          onKeyDown?.(e)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <div
          // Tapping a row must not blur the input: the list would close (or the parent unmount) before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className={`${inline ? '' : 'absolute z-20 '}mt-1 max-h-60 w-full overflow-auto rounded-lg bg-raised text-base shadow-lg`}>
          {trimmed === '' && onClear && (
            <button type="button" className={`${row} text-text-2`} onClick={() => { onClear(); setOpen(false) }}>
              {clearLabel}
            </button>
          )}
          {items.map((i) => (
            <button key={i.id} type="button" className={row} onClick={() => { onPick(i); setOpen(false) }}>
              <span>{i.name}</span>
              {i.detail && <span className="text-sm text-text-3">{i.detail}</span>}
            </button>
          ))}
          {items.length === 0 && trimmed === '' && emptyText && <p className="px-3 py-2 text-text-3">{emptyText}</p>}
          {onAdd && trimmed !== '' && !exact && (
            <button type="button" className={`${row} text-accent`} onClick={() => { onAdd(); setOpen(false) }}>
              Add “{trimmed}” as a new {addNoun}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
