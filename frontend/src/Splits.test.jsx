import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Splits from './Splits.jsx'
import { formatPercent, parsePercent } from './utils/format.js'

const { createSplit, balances } = vi.hoisted(() => ({ createSplit: vi.fn(), balances: {} }))

vi.mock('./api.js', () => ({
  api: {
    splits: {
      list: () => Promise.resolve(balances.splits ?? []),
      create: createSplit,
      balance: (id) => Promise.resolve(balances[id] ?? { account_id: id, balance_cents: 0, transactions: [] }),
    },
    categories: { list: () => Promise.resolve([{ id: 1, name: 'Groceries' }]) },
    goals: { list: () => Promise.resolve([]) },
    payees: { list: () => Promise.resolve([{ id: 7, name: 'Sam' }, { id: 8, name: 'Kit' }]), create: vi.fn() },
    accounts: { list: () => Promise.resolve([{ id: 3, name: 'Roommate' }]) },
  },
}))

function renderSplits() {
  return render(
    <MemoryRouter initialEntries={['/splits']}>
      <Splits pickerDate="2026-10-05" />
      <Where />
    </MemoryRouter>,
  )
}

// Shows where Settle up navigated to, and the route state it carried.
function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname}|{JSON.stringify(location.state)}</output>
}

const SAM = { id: 1, payee_id: 7, payee_name: 'Sam', account_id: 3, account_name: 'Roommate', percent: '50.0000' }
function household() {
  return [
    { id: 5, name: 'Household', description: null, archived_on: null, my_share_percent: '50.0000', members: [SAM] },
    { id: 6, name: 'Trips', description: null, archived_on: null, my_share_percent: '50.0000', members: [{ ...SAM, id: 2 }] },
  ]
}
const HEAT = {
  id: 40, date: '2026-10-01', memo: 'Heating', payee_id: null, income_stream_id: null, goal_id: null, split_id: 5,
  account_lines: [{ id: 1, account_id: 3, cents: 5000 }], category_lines: [],
}

async function addMember(payeeName, percent, index) {
  fireEvent.click(screen.getByRole('button', { name: '+ Add a person' }))
  const picker = (await screen.findAllByPlaceholderText('Search payees…'))[index]
  fireEvent.focus(picker)
  fireEvent.change(picker, { target: { value: payeeName } })
  fireEvent.keyDown(picker, { key: 'Enter' })
  fireEvent.change(screen.getAllByLabelText('Percent')[index], { target: { value: percent } })
}

describe('percent parsing', () => {
  it('rounds half-even at four places, like the backend', () => {
    expect(parsePercent('50')).toBe(500000)
    expect(parsePercent('33.3333')).toBe(333333)
    expect(parsePercent('50.00005')).toBe(500000) // exactly half, even neighbour
    expect(parsePercent('50.00015')).toBe(500002)
    expect(parsePercent('12.34567')).toBe(123457)
    expect(parsePercent('40%')).toBe(400000)
    expect(parsePercent('')).toBeNull()
    expect(parsePercent('abc')).toBeNull()
    expect(formatPercent(500000)).toBe('50%')
  })
})

describe('the Splits page', () => {
  beforeEach(() => {
    createSplit.mockReset()
    for (const key of Object.keys(balances)) delete balances[key]
  })

  it('shows what a person owes, the transactions that built it, and the same balance under each split', async () => {
    balances.splits = household()
    balances[3] = { account_id: 3, balance_cents: 5000, transactions: [HEAT] }
    renderSplits()

    expect(await screen.findAllByText('Sam owes you $50.00')).toHaveLength(2)
    expect(screen.getAllByText('Heating')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Settle up' })).toHaveLength(2)
    // read-only: no row is clickable
    expect(screen.getAllByText('Heating')[0].closest('tr')).not.toHaveClass('cursor-pointer')
  })

  it('says so when I owe them, and shows no Settle up when nothing is owed', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: -2050, transactions: [HEAT] }
    renderSplits()
    expect(await screen.findByText('You owe Sam $20.50')).toBeInTheDocument()

    balances[3] = { account_id: 3, balance_cents: 0, transactions: [] }
    cleanup()
    renderSplits()
    expect(await screen.findByText('Settled up')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settle up' })).not.toBeInTheDocument()
  })

  it('Settle up opens the Ledger with their account taking the opposite of what they owe', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: 5000, transactions: [HEAT] }
    renderSplits()
    fireEvent.click(await screen.findByRole('button', { name: 'Settle up' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/ledger|{"settleUp":{"account_id":3,"cents":-5000}}')
  })

  it('Settle up when I owe them puts the money onto their account', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: -2050, transactions: [HEAT] }
    renderSplits()
    fireEvent.click(await screen.findByRole('button', { name: 'Settle up' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/ledger|{"settleUp":{"account_id":3,"cents":2050}}')
  })

  it('shows your share update as percentages are typed, and warns past 100%', async () => {
    renderSplits()
    expect(await screen.findByText('Your share: 100%')).toBeInTheDocument()

    await addMember('Sam', '30', 0)
    expect(await screen.findByText('Your share: 70%')).toBeInTheDocument()

    await addMember('Kit', '80', 1)
    expect(await screen.findByText(/add up to 110%, more than 100%/)).toBeInTheDocument()
  })

  it('shows the backend refusal detail when a save is refused', async () => {
    createSplit.mockRejectedValue(new Error('The members add up to 110%, which is more than 100%.'))
    renderSplits()
    fireEvent.change(await screen.findByLabelText('Split name'), { target: { value: 'Rent' } })
    await addMember('Sam', '50', 0)
    fireEvent.click(screen.getByRole('button', { name: 'Add split' }))

    expect(await screen.findByText('The members add up to 110%, which is more than 100%.')).toBeInTheDocument()
    expect(createSplit).toHaveBeenCalledWith({
      name: 'Rent', description: null, created_on: '2026-10-05',
      members: [{ payee_id: 7, account_id: null, percent: '50' }],
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add split' })).not.toBeDisabled())
  })
})
