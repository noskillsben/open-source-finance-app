// The one cadence list goals and named pays share (DESIGN.md § Income streams: "the goals' cadence
// representation, reused — not a copy"); the values are the backend's app/services/cadence.py CADENCES.
export const CADENCES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: 'Every 6 months' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'weeks', label: 'Every N weeks' },
]
