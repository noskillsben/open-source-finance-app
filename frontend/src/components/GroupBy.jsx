// The one "Group by" choice a grouped list page offers in its filter row (DESIGN.md § Sorting and
// grouping). options: [{ value, label }]; the first is the default the page starts from.
export default function GroupBy({ value, onChange, options }) {
  return (
    <label className="flex min-h-11 items-center gap-2">
      Group by
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
