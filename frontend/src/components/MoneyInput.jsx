import { useId } from 'react'

// The money input (DESIGN.md § Visual design → Components): a text field with the decimal keypad,
// never type="number" (phone keypads have no minus key). With `signed`, a − Spent / + {posWord}
// toggle sets the direction: the value stays one signed string ("-12.50"), and the toggle adds or
// removes its leading minus, so the parent keeps parsing it with parseCents.
const SIGNS = /[-−+]/g

export default function MoneyInput({ label, value, onChange, signed = false, balance = false, placeholder = '0.00', className = '', inputClassName = '', ...rest }) {
  const id = useId()
  // Same toggle, second wording: a balance you state is Owed / Held, an amount that moves is Spent / Received.
  const [negWord, posWord] = balance ? ['Owed', 'Held'] : ['Spent', 'Received']
  const spent = value.trim().startsWith('-')
  const bare = value.replace(SIGNS, '').trim()
  const received = value.trim() !== '' && !spent

  // Typing or pasting never sets the direction: signs are stripped and the toggle's state kept.
  function typed(text) {
    const digits = text.replace(SIGNS, '')
    onChange(signed && spent ? `-${digits}` : digits)
  }

  function setSpent(next) {
    onChange(next ? `-${bare}` : bare)
  }

  const toggleClass = (on) =>
    `btn min-w-0 px-3 ${on ? 'bg-raised text-text ring-1 ring-accent' : 'text-text-2'}`

  return (
    <div className={`space-y-1 ${className}`}>
      {label && <label htmlFor={id} className="field-label block">{label}</label>}
      <div className="flex flex-wrap items-center gap-2">
        {signed && (
          <div role="group" aria-label="Direction" className="flex gap-1">
            <button type="button" aria-pressed={spent} className={toggleClass(spent)} onClick={() => setSpent(true)}>
              − {negWord}
            </button>
            <button type="button" aria-pressed={received} className={toggleClass(received)} onClick={() => setSpent(false)}>
              + {posWord}
            </button>
          </div>
        )}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className={`field w-28 flex-1 tabular text-right ${inputClassName}`.trim()}
          placeholder={placeholder}
          value={signed ? bare : value}
          onChange={(e) => (signed ? typed(e.target.value) : onChange(e.target.value))}
          {...rest}
        />
      </div>
    </div>
  )
}
