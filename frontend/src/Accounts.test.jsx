import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'

const { checkBalance } = vi.hoisted(() => ({ checkBalance: vi.fn() }))

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
