import { describe, expect, it } from 'vitest'
import { emptyTermsText, hasLenderTerms, termsLine, termsToText, textToTerms } from './terms.js'

describe('termsLine', () => {
  it('reads the stated terms as one soft line', () => {
    expect(
      termsLine({ annual_rate: '5.9900', compounding_rule: 'daily', statement_close_day: 15, grace_days: 21 }),
    ).toBe('5.99% · compounds daily · statement closes the 15th, 21 days grace')
  })

  it('leaves blank terms out, and says nothing when none are stated', () => {
    expect(termsLine({ credit_limit_cents: 500000, annual_rate: null, grace_days: 1 })).toBe('1 day grace')
    expect(termsLine({ credit_limit_cents: 0 })).toBe('')
  })

  it('shows a stated 0 rather than dropping it', () => {
    expect(termsLine({ annual_rate: '0.0000', grace_days: 0 })).toBe('0% · 0 days grace')
  })

  it('names semi-annual compounding and orders the close day', () => {
    expect(termsLine({ compounding_rule: 'semi-annual', statement_close_day: 22 })).toBe(
      'compounds semi-annually · statement closes the 22nd',
    )
    expect(termsLine({ statement_close_day: 11 })).toBe('statement closes the 11th')
  })
})

describe('textToTerms', () => {
  it('maps blank to null and a typed 0 to 0', () => {
    const { terms } = textToTerms({ ...emptyTermsText(), grace_days: '0', annual_rate: '0' })
    expect(terms.grace_days).toBe(0)
    expect(terms.annual_rate).toBe('0')
    expect(terms.statement_close_day).toBeNull()
    expect(terms.deferred_rate).toBeNull()
    expect(terms.minimum_payment_rule).toBeNull()
  })

  it('refuses a close day outside 1-31, a negative rate and a non-number', () => {
    expect(textToTerms({ ...emptyTermsText(), statement_close_day: '32' }).error).toBeTruthy()
    expect(textToTerms({ ...emptyTermsText(), statement_close_day: '0' }).error).toBeTruthy()
    expect(textToTerms({ ...emptyTermsText(), annual_rate: '-1' }).error).toBeTruthy()
    expect(textToTerms({ ...emptyTermsText(), grace_days: 'x' }).error).toBeTruthy()
  })

  it('round-trips through the form text', () => {
    const terms = { annual_rate: '5.9900', grace_days: 0, term_end: '2030-01-01' }
    expect(textToTerms(termsToText(terms)).terms).toMatchObject({ annual_rate: '5.9900', grace_days: 0, term_end: '2030-01-01' })
  })
})

describe('hasLenderTerms', () => {
  it('ignores the credit limit, which has its own control', () => {
    expect(hasLenderTerms({ credit_limit_cents: 0 })).toBe(false)
    expect(hasLenderTerms({ credit_limit_cents: 0, grace_days: 0 })).toBe(true)
  })
})
