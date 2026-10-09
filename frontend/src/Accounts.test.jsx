import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'

const { checkBalance, createAccount, updateAccount } = vi.hoisted(() => ({
  checkBalance: vi.fn(), createAccount: vi.fn(), updateAccount: vi.fn(),
}))

const account = (overrides) => ({
  id: 1, name: 'Chequing', type: 'Chequing', on_budget: true, on_budget_floor_cents: 0,
  archived_on: null, created_on: '2026-01-01', balance_cents: 10000, checked_on: null,
  entries_added_since_check: 0, notes: [], linked_category_ids: [], terms: { credit_limit_cents: 0 },
  ...overrides,
})

let accounts = []
let payees = [{ id: 7, name: 'Starbucks' }, { id: 8, name: 'Walmart' }]
const archivedPayee = { id: 9, name: 'Old Shop' }

vi.mock('./api.js', () => ({
  api: {
    accounts: {
      list: () => Promise.resolve(accounts),
      checkBalance,
      create: createAccount,
      update: updateAccount,
      checkBalancePreview: () => Promise.resolve({ diff_cents: 0, category_lines: [] }),
    },
    categories: {
      list: () => Promise.resolve([
        { id: 11, name: 'Rent' },
        { id: 12, name: 'Debt payments', seeded_key: 'debt-payments' },
      ]),
    },
    payees: { list: (asOf, all) => Promise.resolve(all ? [...payees, archivedPayee] : payees) },
  },
}))

async function saveCheck(statedBalance) {
  fireEvent.click(await screen.findByRole('button', { name: 'Check balance' }))
  fireEvent.change(await screen.findByLabelText('Stated balance'), { target: { value: statedBalance } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('balance check on a tracking account', () => {
  beforeEach(() => {
    checkBalance.mockReset()
  })

  it('offers no category and says ready to assign did not change', async () => {
    accounts = [account({ id: 2, name: 'Friend loan', type: 'Loan', on_budget: false })]
    checkBalance.mockResolvedValue({ diff_cents: 1200, transaction: { category_lines: [] } })
    render(<Accounts pickerDate="2026-10-03" />)

    await saveCheck('112')

    expect(screen.queryByText(/Category for the difference/)).toBeNull()
    expect(await screen.findByText(
      "Adjustment of $12.00 recorded. This account is outside your budget, so ready to assign doesn't change."
    )).toBeTruthy()
    expect(checkBalance.mock.calls[0][1].category_id).toBeNull()
  })
})

describe('balance check that matches the ledger', () => {
  beforeEach(() => {
    checkBalance.mockReset()
  })

  it('says the check was recorded, with its date and no adjustment', async () => {
    accounts = [account()]
    checkBalance.mockResolvedValue({ diff_cents: 0, transaction: null })
    render(<Accounts pickerDate="2026-08-11" />)

    await saveCheck('100')

    expect(await screen.findByText(
      'That matches the ledger — balance checked Aug 11, 2026, no adjustment needed.'
    )).toBeTruthy()
  })
})

describe('balance check on an on-budget account', () => {
  beforeEach(() => {
    checkBalance.mockReset()
  })

  it('keeps the category select and the ready-to-assign message', async () => {
    accounts = [account()]
    checkBalance.mockResolvedValue({ diff_cents: 1200, transaction: { category_lines: [] } })
    render(<Accounts pickerDate="2026-10-03" />)

    await saveCheck('112')

    expect(screen.getByText(/Category for the difference/)).toBeTruthy()
    expect(await screen.findByText(/Adjustment of \$12\.00 recorded to ready to assign\./)).toBeTruthy()
  })

  it('still names the category the difference went to', async () => {
    accounts = [account()]
    checkBalance.mockResolvedValue({ diff_cents: 1200, transaction: { category_lines: [{ category_id: 11, cents: 1200 }] } })
    render(<Accounts pickerDate="2026-10-03" />)

    await saveCheck('112')

    await waitFor(() => expect(screen.getByText(/recorded to Rent \$12\.00\./)).toBeTruthy())
  })
})

describe('undo check link', () => {
  it('is hidden, and the badge reads opened, when the latest check is the opening balance', async () => {
    accounts = [
      account({ id: 1, name: 'Opening only', checked_on: '2026-01-01', checked_valuation_id: 5, checked_is_opening: true }),
      account({ id: 2, name: 'Later check', checked_on: '2026-02-01', checked_valuation_id: 6, checked_is_opening: false }),
    ]
    render(<Accounts pickerDate="2026-10-03" />)

    expect(await screen.findAllByText(/balance checked/)).toHaveLength(1)
    expect(screen.getAllByText(/opened Jan 1, 2026/)).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Undo check' })).toHaveLength(1)
  })
})

describe('add an account: opening balance', () => {
  beforeEach(() => {
    createAccount.mockReset()
    createAccount.mockResolvedValue({})
    accounts = []
  })

  async function fillAndSave(openingBalance) {
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Wallet' } })
    fireEvent.change(screen.getByLabelText('Opening balance'), { target: { value: openingBalance } })
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
  }

  it('saves a blank opening balance as 0 cents', async () => {
    await fillAndSave('')
    await waitFor(() => expect(createAccount).toHaveBeenCalledTimes(1))
    expect(createAccount.mock.calls[0][0].opening_balance_cents).toBe(0)
  })

  it('blocks a second submit while the first is saving', async () => {
    let finish
    createAccount.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    await fillAndSave('5')
    const button = screen.getByRole('button', { name: 'Add account' })

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByLabelText('Name')).toBeDisabled()
    fireEvent.submit(button.closest('form'))
    expect(createAccount).toHaveBeenCalledTimes(1)

    finish({})
    await waitFor(() => expect(screen.getByLabelText('Name')).not.toBeDisabled())
  })

  it('still refuses text that is not a number', async () => {
    await fillAndSave('abc')
    expect(await screen.findByText('Opening balance must be a number.')).toBeTruthy()
    expect(createAccount).not.toHaveBeenCalled()
  })
})

describe('payee-locked accounts', () => {
  beforeEach(() => {
    createAccount.mockReset()
  })

  it('groups accounts that share a locked payee onto one line with each balance', async () => {
    accounts = [
      account({ id: 1, name: 'Chequing', balance_cents: 50000 }),
      account({ id: 2, name: 'Starbucks app', balance_cents: 1500, locked_payee_id: 7 }),
      account({ id: 3, name: 'Starbucks card', balance_cents: 2000, locked_payee_id: 7 }),
      account({ id: 4, name: 'Walmart card', balance_cents: 900, locked_payee_id: 8 }),
    ]
    render(<Accounts pickerDate="2026-10-03" />)

    expect(await screen.findByText('Locked to Starbucks')).toBeTruthy()
    expect(screen.getByText('$15.00')).toBeTruthy()
    expect(screen.getByText('$20.00')).toBeTruthy()
    expect(screen.queryByText('Locked to Walmart')).toBeNull() // a lone locked account keeps its own row
    expect(screen.getByText('Walmart card')).toBeTruthy()
  })

  it('sends the chosen payee when an account is added', async () => {
    accounts = []
    createAccount.mockResolvedValue({})
    render(<Accounts pickerDate="2026-10-03" />)

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Starbucks card' } })
    fireEvent.focus(screen.getByPlaceholderText('Search payees…'))
    fireEvent.mouseDown(await screen.findByText('Starbucks'))
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].locked_payee_id).toBe(7)
  })
})

describe('an account locked to a payee archived since', () => {
  it('shows the payee as archived in the box and keeps the lock on save', async () => {
    updateAccount.mockReset()
    updateAccount.mockResolvedValue({})
    accounts = [account({ id: 5, name: 'Old shop card', locked_payee_id: 9 })]
    render(<Accounts pickerDate="2026-10-03" />)

    fireEvent.click(await screen.findByText('Old shop card'))
    await waitFor(() => expect(screen.getByPlaceholderText('Search payees…')).toHaveValue('Old Shop (archived)'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateAccount).toHaveBeenCalled())
    expect(updateAccount.mock.calls[0][1].locked_payee_id).toBe(9)
  })
})

describe("lender's terms", () => {
  beforeEach(() => {
    updateAccount.mockReset()
    createAccount.mockReset()
    updateAccount.mockResolvedValue({})
    createAccount.mockResolvedValue({})
  })

  it.each(['Credit card', 'Line of credit', 'Loan', 'Mortgage', 'Payment plan'])(
    'opens the section by default for %s',
    async (type) => {
      accounts = []
      render(<Accounts pickerDate="2026-10-03" />)
      fireEvent.change(await screen.findByLabelText('Type'), { target: { value: type } })

      expect(screen.getByLabelText('Annual rate (%)')).toBeTruthy()
      expect(screen.queryByRole('button', { name: "Add lender's terms" })).toBeNull()
    },
  )

  it.each(['Cash', 'Chequing', 'Savings', 'Investment', 'Asset'])('puts %s behind the toggle', async (type) => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: type } })

    expect(screen.queryByLabelText('Annual rate (%)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: "Add lender's terms" }))
    expect(screen.getByLabelText('Annual rate (%)')).toBeTruthy()
  })

  it('opens the toggle on its own when the account already has terms', async () => {
    accounts = [account({ id: 3, name: 'Nest egg', type: 'Savings', terms: { credit_limit_cents: 0, annual_rate: '2.5000' } })]
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.click(await screen.findByText('Nest egg', { selector: 'td' }))

    expect(screen.getByLabelText('Annual rate (%)').value).toBe('2.5000')
  })

  it('stays closed on an account with nothing beyond the 0 credit limit', async () => {
    accounts = [account({ id: 3, name: 'Wallet', type: 'Cash' })]
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.click(await screen.findByText('Wallet', { selector: 'td' }))

    expect(screen.queryByLabelText('Annual rate (%)')).toBeNull()
  })

  it('saves blank as null and a typed 0 as 0, with nothing pre-filled', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Credit card' } })
    expect(screen.getByLabelText('Grace days after the statement closes').value).toBe('')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Visa' } })
    fireEvent.change(screen.getByLabelText('Annual rate (%)'), { target: { value: '19.99' } })
    fireEvent.change(screen.getByLabelText('Grace days after the statement closes'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Compounds'), { target: { value: 'daily' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].terms).toEqual({
      credit_limit_cents: null, annual_rate: '19.99', compounding_rule: 'daily', statement_close_day: null,
      grace_days: 0, term_end: null, amortization_end: null, prepayment_model: null, promo_expiry_date: null,
      deferred_rate: null, minimum_payment_rule: null,
    })
  })

  it('refuses a statement close day outside 1-31 before it is sent', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Credit card' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Visa' } })
    fireEvent.change(screen.getByLabelText('Statement closes on day (1–31)'), { target: { value: '32' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    expect(await screen.findByText('Statement close day must be 1 to 31.')).toBeTruthy()
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('sends the whole terms block on an edit, merged with what the account already has', async () => {
    const existing = {
      credit_limit_cents: 500000, annual_rate: '5.9900', compounding_rule: 'semi-annual', statement_close_day: null,
      grace_days: null, term_end: '2030-01-01', amortization_end: null, prepayment_model: 'open',
      promo_expiry_date: null, deferred_rate: null, minimum_payment_rule: null,
    }
    accounts = [account({ id: 4, name: 'Home loan', type: 'Mortgage', on_budget: false, terms: existing })]
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.click(await screen.findByText('Home loan', { selector: 'td' }))
    fireEvent.change(screen.getByLabelText('Annual rate (%)'), { target: { value: '4.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateAccount).toHaveBeenCalled())
    expect(updateAccount.mock.calls[0][1].terms).toEqual({ ...existing, annual_rate: '4.5' })
  })

  it("shows the terms as one soft line under the account's name", async () => {
    accounts = [
      account({
        id: 5, name: 'Visa', type: 'Credit card',
        terms: { credit_limit_cents: null, annual_rate: '5.9900', compounding_rule: 'daily', statement_close_day: 15, grace_days: 21 },
      }),
    ]
    render(<Accounts pickerDate="2026-10-03" />)

    expect(await screen.findByText('5.99% · compounds daily · statement closes the 15th, 21 days grace')).toBeTruthy()
  })
})

describe('boundary category', () => {
  const picker = () => screen.findByLabelText(/Category money leaves the budget through/)

  beforeEach(() => {
    createAccount.mockReset()
    createAccount.mockResolvedValue({})
  })

  it('pre-fills Debt payments for a debt type, found by its seeded key, and sends it', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)

    expect(await picker()).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Car loan' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Loan' } })
    expect(await picker()).toHaveValue('Debt payments')
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].boundary_category_id).toBe(12)
  })

  it('stays blank for the other types, and an edit does not backfill', async () => {
    accounts = [account({ id: 6, name: 'Old loan', type: 'Loan', on_budget: false, boundary_category_id: null })]
    render(<Accounts pickerDate="2026-10-03" />)

    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Savings' } })
    expect(await picker()).toHaveValue('')
    fireEvent.click(screen.getByText('Old loan'))
    await waitFor(async () => expect(await picker()).toHaveValue(''))
  })
})
