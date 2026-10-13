import Button from './Button.jsx'

// The one filter bar every list page uses: a name search, a choice per facet, optional extra controls
// (e.g. "Show archived"), and a Clear button that appears once anything is narrowing the list.
//   facets: [{ name, label, value, onChange, options: [{ value, label }] }] — value '' means "all".
export default function ListFilters({ noun, search, onSearch, facets = [], active, onClear, children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <input
        className="field"
        placeholder={`Search ${noun}`}
        aria-label={`Search ${noun}`}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      {facets.map((f) => (
        <select
          key={f.name}
          className="field"
          aria-label={`Filter by ${f.label.toLowerCase()}`}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
        >
          <option value="">{f.label}: all</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
      {children}
      {active && <Button variant="quiet" onClick={onClear}>Clear filters</Button>}
    </div>
  )
}
