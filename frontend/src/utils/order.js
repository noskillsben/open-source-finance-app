// Drop-down orders, in one place (DESIGN.md § UI conventions): alphabetical unless the values have
// a real order. The real orders are the need levels and the account types grouped by budget side
// (see account_types.js).

// The fixed ordinal scale (DESIGN.md § Need levels): need -> should -> nice to have -> want.
export const NEED_LEVELS = [
  { value: 'need', label: 'Need' },
  { value: 'should', label: 'Should' },
  { value: 'nice_to_have', label: 'Nice to have' },
  { value: 'want', label: 'Want' },
]

export const byName = (a, b) => a.name.localeCompare(b.name)
export const byLabel = (a, b) => a.label.localeCompare(b.label)
export const alphabetical = (items) => [...items].sort(byName)
