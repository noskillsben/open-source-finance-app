import { useId } from 'react'

// The money input (DESIGN.md § Visual design → Components): a text field with the decimal keypad,
// never type="number" (phone keypads have no minus key). With `signed`, a − Spent / + Received
// toggle sets the direction: the value stays one signed string ("-12.50"), and the toggle adds or
// removes its leading minus, so the parent keeps parsing it with parseCents.
export default function MoneyInput({ label, value, onChange, signed = false, placeholder = '0.00', className = '', ...rest }) {
  const id = useId()
  const spent = value.trim().startsWith('-')
  const received = value.trim() !== '' && !spent

  function setSpent(next) {
    const bare = value.trim().replace(/^-/, '')
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
              − Spent
            </button>
            <button type="button" aria-pressed={received} className={toggleClass(received)} onClick={() => setSpent(false)}>
              + Received
            </button>
          </div>
        )}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className="field w-28 flex-1 tabular text-right"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
      </div>
    </div>
  )
}
