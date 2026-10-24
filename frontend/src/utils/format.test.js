import { describe, expect, it } from 'vitest'
import { formatDate, formatMonth } from './format'

// Run the suite under TZ=Pacific/Kiritimati (UTC+14) or TZ=Pacific/Pago_Pago (UTC-11) to see
// the zones that used to shift a plain date by a day.
describe('formatDate', () => {
  it('shows the stored day in every time zone', () => {
    expect(formatDate('2026-09-12')).toBe('Sep 12, 2026')
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatDate('2026-12-31')).toBe('Dec 31, 2026')
  })

  it('returns empty text for no date', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate(null)).toBe('')
  })
})

describe('formatMonth', () => {
  it('shows the stored month in every time zone', () => {
    expect(formatMonth('2026-10-01')).toBe('October 2026')
    expect(formatMonth('2026-09-30')).toBe('September 2026')
  })
})
