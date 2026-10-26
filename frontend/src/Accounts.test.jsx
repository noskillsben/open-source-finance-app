import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'

const { checkBalance, createAccount, updateAccount, createPayee, removeValuation, archiveAccount } = vi.hoisted(() => ({
  checkBalance: vi.fn(), createAccount: vi.fn(), updateAccount: vi.fn(), createPayee: vi.fn(), removeValuation: vi.fn(), archiveAccount: vi.fn(),
}))

const account = (overrides) => ({
  id: 1, name: 'Chequing', type: 'Chequing', on_budget: true, on_budget_floor_cents: 0,
  archived_on: null, created_on: '2026-01-01', balance_cents: 10000, checked_on: null,
  entries_added_since_check: 0, notes: [], linked_category_ids: [], terms: { credit_limit_cents: 0 },
  ...overrides,
})

let accounts = []
let previewLines = []
let payees = [{ id: 7, name: 'Starbucks' }, { id: 8, name: 'Walmart' }]
const archivedPayee = { id: 9, name: 'Old Shop' }

vi.mock('./api.js', () => ({
  api: {
    accounts: {
      list: () => Promise.resolve(accounts),
      checkBalance,
      create: createAccount,
      update: updateAccount,
      archive: archiveAccount,
      checkBalancePreview: () => Promise.resolve({ diff_cents: 0, category_lines: previewLines }),
    },
    valuations: { remove: removeValuation },
    categories: {
      list: () => Promise.resolve([
        { id: 11, name: 'Rent' },
        { id: 12, name: 'Debt payments', seeded_key: 'category:debt-payments' },
        { id: 13, name: 'Owed to me', seeded_key: 'category:owed-to-me' },
      ]),
    },
    payees: { list: (asOf, all) => Promise.resolve(all ? [...payees, archivedPayee] : payees), create: createPayee },
  },
}))

// The add and edit forms open in the side panel; the loan terms start folded under a one-line summary.
async function openAdd() {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Add an account' }))[0])
}
const openTerms = () => fireEvent.click(screen.getByRole('button', { name: 'Loan terms' }))

const rowCell = (name) => screen.queryAllByText(name).find((el) => el.closest('tr'))

// A row opens its panel; Check balance, Undo check and Archive live in it, never on the row (#398).
async function openRow(name) {
  await waitFor(() => expect(rowCell(name)).toBeTruthy())
  fireEvent.click(rowCell(name))
}

async function saveCheck(statedBalance, name = 'Chequing') {
  await openRow(name)
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

    await saveCheck('112', 'Friend loan')

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
    // No control on any row; Undo check is in the panel of the account that has one.
    expect(screen.queryByRole('button', { name: 'Undo check' })).toBeNull()
    await openRow('Opening only')
    expect(screen.queryByRole('button', { name: 'Undo check' })).toBeNull()
    await openRow('Later check')
    expect(screen.getAllByRole('button', { name: 'Undo check' })).toHaveLength(1)
  })

  it('undoes the last check from the account panel', async () => {
    removeValuation.mockReset()
    removeValuation.mockResolvedValue({})
    accounts = [account({ id: 2, name: 'Later check', checked_on: '2026-02-01', checked_valuation_id: 6, checked_is_opening: false })]
    render(<Accounts pickerDate="2026-10-03" />)
    await openRow('Later check')
    fireEvent.click(await screen.findByRole('button', { name: 'Undo check' }))
    await waitFor(() => expect(removeValuation).toHaveBeenCalledWith(6))
  })
})

describe('a row opens the account panel, which holds Archive (#398)', () => {
  it('shows no controls on the row, opens on a tap or Enter, and archives from the panel', async () => {
    archiveAccount.mockReset()
    archiveAccount.mockResolvedValue({ warnings: [] })
    accounts = [account()]
    render(<Accounts pickerDate="2026-10-03" />)
    await waitFor(() => expect(rowCell('Chequing')).toBeTruthy())
    const row = rowCell('Chequing').closest('tr')
    expect(within(row).queryByRole('button')).toBeNull()
    expect(row).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(archiveAccount).toHaveBeenCalledWith(1, '2026-10-03'))
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
    await openAdd()
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
    // #321: a successful add closes the panel.
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
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

    await openAdd()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Starbucks card' } })
    fireEvent.focus(screen.getByPlaceholderText('Search payees…'))
    fireEvent.click(await screen.findByText('Starbucks'))
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].locked_payee_id).toBe(7)
  })

  it('Gift card / store credit starts on-budget, floor 0, credit limit 0, with the lock field first', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Gift card / store credit' } })

    expect(screen.getByLabelText(/On-budget \(money here/)).toBeChecked()
    expect(screen.getByLabelText('On-budget floor').value).toMatch(/^0(\.00)?$/)
    expect(screen.getByLabelText(/Credit limit/).value).toMatch(/^0(\.00)?$/)
    const lock = screen.getByText(/Locked to a payee/)
    const name = screen.getByText('Name', { selector: 'span' })
    expect(lock.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Cash' } })
    const lock2 = screen.getByText(/Locked to a payee/)
    const name2 = screen.getByText('Name', { selector: 'span' })
    expect(lock2.compareDocumentPosition(name2) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('adds a new payee from the lock box and saves the account locked to it', async () => {
    accounts = []
    createAccount.mockResolvedValue({})
    createPayee.mockReset()
    createPayee.mockResolvedValue({ id: 20, name: 'Corner Store', archived_on: null })
    render(<Accounts pickerDate="2026-10-03" />)

    await openAdd()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Corner card' } })
    const lock = screen.getByPlaceholderText('Search payees…')
    fireEvent.focus(lock)
    fireEvent.change(lock, { target: { value: 'Corner Store' } })
    fireEvent.click(await screen.findByText(/as a new payee/i))
    await waitFor(() => expect(createPayee).toHaveBeenCalledWith({ name: 'Corner Store', created_on: '2026-10-03' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Search payees…')).toHaveValue('Corner Store'))
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].locked_payee_id).toBe(20)
  })

  it('shows a failed payee add on the form and leaves the lock empty', async () => {
    accounts = []
    createPayee.mockReset()
    createPayee.mockRejectedValue(new Error('Payee name is taken'))
    render(<Accounts pickerDate="2026-10-03" />)

    await openAdd()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Corner card' } })
    const box = screen.getByPlaceholderText('Search payees…')
    fireEvent.change(box, { target: { value: 'Corner Store' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(await screen.findByText('Payee name is taken')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls.at(-1)[0].locked_payee_id).toBeNull()
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

  it.each(['Credit card', 'Line of credit', 'Loan', 'Money owed to me', 'Mortgage', 'Payment plan', 'Cash', 'Chequing', 'Savings', 'Investment', 'Asset'])(
    'folds the loan terms under a one-line summary for %s, and the toggle unfolds them',
    async (type) => {
      accounts = []
      render(<Accounts pickerDate="2026-10-03" />)
      await openAdd()
      fireEvent.change(await screen.findByLabelText('Type'), { target: { value: type } })

      expect(screen.queryByLabelText('Annual rate (%)')).toBeNull()
      expect(screen.getByText('Nothing entered')).toBeTruthy()
      openTerms()
      expect(screen.getByLabelText('Annual rate (%)')).toBeTruthy()
      expect(screen.queryByText(/lender/i)).toBeNull() // "Loan terms" everywhere
    },
  )

  it('shows what the account already states in the summary, and unfolds to the fields', async () => {
    accounts = [account({ id: 3, name: 'Nest egg', type: 'Savings', terms: { credit_limit_cents: 0, annual_rate: '2.5000' } })]
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.click(await screen.findByText('Nest egg', { selector: 'td' }))

    expect(screen.queryByLabelText('Annual rate (%)')).toBeNull()
    expect(screen.getAllByText('2.5%').length).toBeGreaterThan(0)
    openTerms()
    expect(screen.getByLabelText('Annual rate (%)').value).toBe('2.5000')
  })

  it('stays closed on an account with nothing beyond the 0 credit limit', async () => {
    accounts = [account({ id: 3, name: 'Wallet', type: 'Cash' })]
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.click(await screen.findByText('Wallet', { selector: 'td' }))

    expect(screen.queryByLabelText('Annual rate (%)')).toBeNull()
    expect(screen.getByText('Nothing entered')).toBeTruthy()
  })

  it('saves blank as null and a typed 0 as 0, with nothing pre-filled', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Credit card' } })
    openTerms()
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
    await openAdd()
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Credit card' } })
    openTerms()
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
    openTerms()
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
  const queryPicker = () => screen.queryByLabelText(/Category money leaves the budget through/)

  beforeEach(() => {
    createAccount.mockReset()
    createAccount.mockResolvedValue({})
  })

  it('shows only while the account is tracking, and pre-fills Debt payments for a debt type, found by its seeded key', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()

    await screen.findByLabelText('Name')
    expect(queryPicker()).toBeNull() // Chequing is on-budget: nothing reads the boundary category
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Car loan' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Loan' } })
    expect(await picker()).toHaveValue('Debt payments')
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].boundary_category_id).toBe(12)
  })

  it('is hidden again when the account is switched to on-budget', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Loan' } })
    expect(await picker()).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/On-budget \(money here/))
    expect(queryPicker()).toBeNull()
  })

  it('stays blank on an edit of a tracking account: an edit does not backfill', async () => {
    accounts = [account({ id: 6, name: 'Old loan', type: 'Loan', on_budget: false, boundary_category_id: null })]
    render(<Accounts pickerDate="2026-10-03" />)

    fireEvent.click(await screen.findByText('Old loan'))
    await waitFor(async () => expect(await picker()).toHaveValue(''))
  })
})

describe('linked category on create', () => {
  const picker = () => screen.findByLabelText(/^Linked to/)
  const queryPicker = () => screen.queryByLabelText(/^Linked to/)

  beforeEach(() => {
    createAccount.mockReset()
    createAccount.mockResolvedValue({})
  })

  it('pre-fills Owed to me for Money owed to me, found by its seeded key, and sends it', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    expect(await picker()).toHaveValue('') // Chequing starts empty

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Money owed to me' } })
    expect(await picker()).toHaveValue('Owed to me')
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].linked_category_id).toBe(13)
  })

  it('can be cleared, and a cleared pick is sent as null', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Money owed to me' } })
    fireEvent.change(await picker(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].linked_category_id).toBeNull()
  })

  it('is hidden when the account is switched to tracking, and not sent', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Money owed to me' } })
    expect(await picker()).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/On-budget \(money here/))
    expect(queryPicker()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(createAccount).toHaveBeenCalled())
    expect(createAccount.mock.calls[0][0].linked_category_id).toBeNull()
  })

  it('is not on the edit form', async () => {
    accounts = [account({ id: 6, name: 'Sam', type: 'Money owed to me', on_budget: true })]
    render(<Accounts pickerDate="2026-10-03" />)
    fireEvent.click(await screen.findByText('Sam'))
    await screen.findByLabelText('Name')
    expect(queryPicker()).toBeNull()
  })
})

describe('the on-budget floor and the credit limit', () => {
  it('shows the floor only while the account is on-budget', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    expect(await screen.findByLabelText('On-budget floor')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/On-budget \(money here/))
    expect(screen.queryByLabelText('On-budget floor')).toBeNull()
  })

  it('words an unknown credit limit as "unknown", never 0.00', async () => {
    accounts = []
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Credit card' } })
    const limit = screen.getByLabelText(/Credit limit/)
    expect(limit).toHaveValue('')
    expect(limit).toHaveAttribute('placeholder', 'unknown')
  })
})

// A balance you owe is entered by tapping the toggle, never by typing a minus (#316).
const tap = (field, name) => fireEvent.click(within(field.closest('div')).getByRole('button', { name }))

describe('Owed / Held toggle on balance fields', () => {
  beforeEach(() => {
    createAccount.mockReset()
    createAccount.mockResolvedValue({})
    checkBalance.mockReset()
    previewLines = []
    accounts = []
  })

  async function startAdd(type) {
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Visa' } })
    if (type) fireEvent.change(screen.getByLabelText('Type'), { target: { value: type } })
  }

  it('saves a credit card opening balance of 500 with Owed chosen as -50000', async () => {
    await startAdd('Credit card')
    const opening = screen.getByLabelText('Opening balance')
    fireEvent.change(opening, { target: { value: '500' } })
    tap(opening, '− Owed')
    expect(opening).toHaveValue('500')
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(createAccount).toHaveBeenCalledTimes(1))
    expect(createAccount.mock.calls[0][0].opening_balance_cents).toBe(-50000)
  })

  it('does not pick a side from the account type', async () => {
    await startAdd('Credit card')
    const opening = screen.getByLabelText('Opening balance')
    expect(within(opening.closest('div')).getByRole('button', { name: '− Owed' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(opening.closest('div')).getByRole('button', { name: '+ Held' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves Owed with nothing typed as 0, not a parse failure', async () => {
    await startAdd()
    tap(screen.getByLabelText('Opening balance'), '− Owed')
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(createAccount).toHaveBeenCalledTimes(1))
    expect(createAccount.mock.calls[0][0].opening_balance_cents).toBe(0)
  })

  it('reaches a negative on-budget floor with the toggle', async () => {
    await startAdd()
    const floor = screen.getByLabelText('On-budget floor')
    fireEvent.change(floor, { target: { value: '200' } })
    tap(floor, '− Owed')
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(createAccount).toHaveBeenCalledTimes(1))
    expect(createAccount.mock.calls[0][0].on_budget_floor_cents).toBe(-20000)
  })

  it('reaches a negative stated balance with the toggle', async () => {
    accounts = [account({ id: 1, name: 'Visa', type: 'Credit card' })]
    checkBalance.mockResolvedValue({ diff_cents: 0, transaction: { category_lines: [] } })
    render(<Accounts pickerDate="2026-10-03" />)
    await openRow('Visa')
    fireEvent.click(await screen.findByRole('button', { name: 'Check balance' }))
    const stated = await screen.findByLabelText('Stated balance')
    fireEvent.change(stated, { target: { value: '120' } })
    tap(stated, '− Owed')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(checkBalance).toHaveBeenCalledTimes(1))
    expect(checkBalance.mock.calls[0][1].stated_balance_cents).toBe(-12000)
  })

  it('lets the split-of-the-difference lines flip with Spent / Received', async () => {
    accounts = [account({ id: 1, name: 'Chequing', linked_category_ids: [11] })]
    previewLines = [{ category_id: 11, cents: 3000 }]
    checkBalance.mockResolvedValue({ diff_cents: 3000, transaction: { category_lines: [] } })
    render(<Accounts pickerDate="2026-10-03" />)
    await openRow('Chequing')
    fireEvent.click(await screen.findByRole('button', { name: 'Check balance' }))
    fireEvent.change(await screen.findByLabelText('Stated balance'), { target: { value: '130' } })
    const line = await screen.findByLabelText('Amount')
    expect(line).toHaveValue('30')
    tap(line, '− Spent')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(checkBalance).toHaveBeenCalledTimes(1))
    expect(checkBalance.mock.calls[0][1].category_lines).toEqual([{ category_id: 11, cents: -3000 }])
  })

  it('shows a card owing money as negative in the list', async () => {
    accounts = [account({ id: 1, name: 'Visa', type: 'Credit card', balance_cents: -50000 })]
    render(<Accounts pickerDate="2026-10-03" />)
    expect((await screen.findAllByText(/-\$500\.00|−\$500\.00/)).length).toBeGreaterThan(0)
  })
})

describe('Recorded and the highlight (#343)', () => {
  it('an add says Recorded and highlights the new row; an edit highlights with no note; opening a form clears both', async () => {
    createAccount.mockReset()
    createAccount.mockResolvedValue({ id: 2 })
    updateAccount.mockReset()
    updateAccount.mockResolvedValue({ id: 1 })
    accounts = [account({ id: 1, name: 'Chequing' }), account({ id: 2, name: 'Wallet', type: 'Cash' })]
    const rowOf = (name) => screen.getAllByText(name).map((el) => el.closest('tr')).find(Boolean)
    render(<Accounts pickerDate="2026-10-03" />)
    await openAdd()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Wallet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
    expect(screen.getByText('Recorded.')).toBeInTheDocument()
    expect(rowOf('Wallet')).toHaveClass('bg-raised')
    expect(rowOf('Chequing')).not.toHaveClass('bg-raised')

    fireEvent.click(rowOf('Chequing'))
    expect(screen.queryByText('Recorded.')).toBeNull()
    expect(rowOf('Wallet')).not.toHaveClass('bg-raised')
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
    expect(screen.queryByText('Recorded.')).toBeNull()
    expect(rowOf('Chequing')).toHaveClass('bg-raised')

    await openAdd()
    expect(rowOf('Chequing')).not.toHaveClass('bg-raised')
  })
})
