import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'

const { checkBalance, createAccount } = vi.hoisted(() => ({ checkBalance: vi.fn(), createAccount: vi.fn() }))

const account = (overrides) => ({
  id: 1, name: 'Chequing', type: 'Chequing', on_budget: true, on_budget_floor_cents: 0,
  archived_on: null, created_on: '2026-01-01', balance_cents: 10000, checked_on: null,
  entries_added_since_check: 0, notes: [], linked_category_ids: [], terms: { credit_limit_cents: 0 },
  ...overrides,
})

let accounts = []

vi.mock('./api.js', () => ({
  api: {
    accounts: {
      list: () => Promise.resolve(accounts),
      checkBalance,
      create: createAccount,
      checkBalancePreview: () => Promise.resolve({ diff_cents: 0, category_lines: [] }),
    },
    categories: { list: () => Promise.resolve([{ id: 11, name: 'Rent' }]) },
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
  it('is hidden when the latest check is the opening balance, shown otherwise', async () => {
    accounts = [
      account({ id: 1, name: 'Opening only', checked_on: '2026-01-01', checked_valuation_id: 5, checked_is_opening: true }),
      account({ id: 2, name: 'Later check', checked_on: '2026-02-01', checked_valuation_id: 6, checked_is_opening: false }),
    ]
    render(<Accounts pickerDate="2026-10-03" />)

    expect(await screen.findAllByText(/balance checked/)).toHaveLength(2)
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
