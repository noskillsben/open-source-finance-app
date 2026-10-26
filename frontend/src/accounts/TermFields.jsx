export function TermText({ form, field, label, onChange, decimal = false }) {
  return (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      <input
        inputMode={decimal ? 'decimal' : field === 'minimum_payment_rule' ? 'text' : 'numeric'}
        className="w-full field"
        value={form[field]}
        onChange={(e) => onChange(field, e.target.value)}
      />
    </label>
  )
}

export function TermDate({ form, field, label, onChange }) {
  return (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      <input type="date" className="w-full field" value={form[field]} onChange={(e) => onChange(field, e.target.value)} />
    </label>
  )
}

export function TermSelect({ form, field, label, options, onChange }) {
  return (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      <select className="w-full field" value={form[field]} onChange={(e) => onChange(field, e.target.value)}>
        <option value="">Unknown</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}
