import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Splits from './Splits.jsx'
import { formatPercent, parsePercent } from './utils/format.js'

const { createSplit, updateSplit, archiveSplit, transactionsList, balances } = vi.hoisted(() => ({
  createSplit: vi.fn(), updateSplit: vi.fn(), archiveSplit: vi.fn(), transactionsList: vi.fn(), balances: {},
}))

vi.mock('./api.js', () => ({
  api: {
    splits: {
      list: () => Promise.resolve(balances.splits ?? []),
      create: createSplit,
      update: updateSplit,
      archive: archiveSplit,
      balance: (id) => Promise.resolve(balances[id] ?? { account_id: id, balance_cents: 0, touched: false, transactions: [] }),
    },
    transactions: { list: transactionsList },
    categories: { list: () => Promise.resolve([{ id: 1, name: 'Groceries' }, { id: 2, name: 'Fuel' }]) },
    goals: { list: () => Promise.resolve([]) },
    payees: { list: () => Promise.resolve([{ id: 7, name: 'Sam' }, { id: 8, name: 'Kit' }]), create: vi.fn() },
    accounts: { list: () => Promise.resolve([{ id: 3, name: 'Roommate' }]) },
  },
}))

function renderSplits() {
  return render(
    <MemoryRouter initialEntries={['/split-expenses']}>
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

async function openAddForm() {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Add a split' }))[0])
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

describe('the Split expenses page', () => {
  beforeEach(() => {
    createSplit.mockReset()
    updateSplit.mockReset()
    archiveSplit.mockReset()
    transactionsList.mockReset()
    transactionsList.mockResolvedValue([]) // the whole ledger, loaded only to label opening balances
    for (const key of Object.keys(balances)) delete balances[key]
  })

  const CHECK = {
    id: 41, date: '2026-10-02', memo: null, payee_id: null, valuation_id: 12, income_stream_id: null, goal_id: null, split_id: null,
    account_lines: [{ id: 2, account_id: 3, cents: 700 }], category_lines: [],
  }

  it('names an adjustment only as a Balance adjustment while the ledger is still loading', async () => {
    balances.splits = household()
    balances[3] = { account_id: 3, balance_cents: 700, transactions: [CHECK] }
    transactionsList.mockReturnValue(new Promise(() => {}))
    renderSplits()
    expect((await screen.findAllByText('Balance adjustment')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Opening balance')).toBeNull()
  })

  it('says so in plain words when the ledger will not load, and never reads Opening balance', async () => {
    balances.splits = household()
    balances[3] = { account_id: 3, balance_cents: 700, transactions: [CHECK] }
    transactionsList.mockRejectedValue(new Error('down'))
    renderSplits()
    expect(await screen.findByText(/Could not load the ledger.*down/)).toBeInTheDocument()
    expect(screen.getAllByText('Balance adjustment').length).toBeGreaterThan(0)
    expect(screen.queryByText('Opening balance')).toBeNull()
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

  it('says a balance nobody holds is counted in Ready to assign, with a link to Owed to me', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: 8021, unheld: true, owed_to_me_category_id: 9, transactions: [] }
    renderSplits()

    const note = await screen.findByText(/isn't held in an envelope/)
    expect(note).toHaveTextContent("Sam's $80.21 isn't held in an envelope, so Ready to assign still counts it — link their account to Owed to me")
    expect(screen.getByRole('link', { name: 'Owed to me' })).toHaveAttribute('href', '/categories')
  })

  it('says the note without a link when Owed to me is not live, and not at all when held', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: 8021, unheld: true, owed_to_me_category_id: null, transactions: [] }
    renderSplits()
    expect(await screen.findByText(/isn't held in an envelope/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Owed to me' })).toBeNull()
    cleanup()

    balances[3] = { account_id: 3, balance_cents: 8021, unheld: false, transactions: [] }
    renderSplits()
    expect(await screen.findByText('Sam owes you $80.21')).toBeInTheDocument()
    expect(screen.queryByText(/isn't held in an envelope/)).toBeNull()
  })

  it('says so when I owe them, and shows no Settle up when nothing is owed', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: -2050, transactions: [HEAT] }
    renderSplits()
    expect(await screen.findByText('You owe Sam $20.50')).toBeInTheDocument()

    // something was settled: a line touched the account, and it is back at zero
    balances[3] = { account_id: 3, balance_cents: 0, touched: true, transactions: [] }
    cleanup()
    renderSplits()
    expect(await screen.findByText('Settled up')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settle up' })).not.toBeInTheDocument()
  })

  it('says "Nothing owed" for a member who has never owed anything (#220)', async () => {
    balances.splits = household().slice(0, 1)
    renderSplits()
    expect(await screen.findByText('Nothing owed')).toBeInTheDocument()
    expect(screen.queryByText('Settled up')).not.toBeInTheDocument()
  })

  describe('Print', () => {
    const base = { memo: null, payee_id: null, income_stream_id: null, goal_id: null, category_lines: [], shared_total_cents: null, paid_by_payee_id: null }
    const BILLS = [
      // Out of order on purpose: the statement is oldest first.
      { ...base, id: 4, date: '2026-10-04', memo: 'Part payment', split_id: null, account_lines: [{ id: 9, account_id: 3, cents: -200 }] },
      { ...base, id: 2, date: '2026-10-02', split_id: 5, paid_by_payee_id: 7, account_lines: [{ id: 5, account_id: 3, cents: -1000 }] },
      { ...base, id: 3, date: '2026-10-03', split_id: 5, paid_by_payee_id: 7, shared_total_cents: 6000, payee_id: 8, category_lines: [{ id: 1, category_id: 1, cents: 1500 }, { id: 2, category_id: 2, cents: 1500 }], account_lines: [{ id: 6, account_id: 3, cents: -3000 }] },
      { ...base, id: 1, date: '2026-10-01', split_id: 5, payee_id: 8, category_lines: [{ id: 3, category_id: 1, cents: 5000 }], account_lines: [{ id: 7, account_id: 20, cents: -10000 }, { id: 8, account_id: 3, cents: 5000 }] },
    ]

    beforeEach(() => {
      window.print = vi.fn()
    })

    async function openStatement(balanceCents, transactions) {
      balances.splits = household().slice(0, 1)
      balances[3] = { account_id: 3, balance_cents: balanceCents, transactions }
      renderSplits()
      fireEvent.click(await screen.findByRole('button', { name: 'Print' }))
      await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
      return within(document.getElementById('print-statement'))
    }

    it('prints each bill with the right whole bill, payer, share and running total', async () => {
      const statement = await openStatement(800, BILLS)
      expect(statement.getByRole('heading', { name: 'Sam' })).toBeInTheDocument()
      expect(statement.getByText('Oct 5, 2026')).toBeInTheDocument()
      const rows = statement.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
      expect(rows).toEqual([
        ['Oct 1, 2026', 'Kit', 'Groceries', '$100.00', 'You', '$50.00', '$50.00'],
        ['Oct 2, 2026', '', '', '', 'Sam', '−$10.00', '$40.00'],
        ['Oct 3, 2026', 'Kit', 'Groceries, Fuel', '$60.00', 'Sam', '−$30.00', '$10.00'],
        ['Oct 4, 2026', 'Part payment', '', '', '', '−$2.00', '$8.00'],
      ])
      expect(statement.getByText('Sam owes you $8.00')).toBeInTheDocument()
    })

    it('prints a refund on a bill I paid with the whole bill, and ignores other members receivables', async () => {
      balances.splits = [{ ...household()[0], members: [SAM, { ...SAM, id: 3, payee_id: 8, payee_name: 'Kit', account_id: 4 }] }]
      balances[3] = {
        account_id: 3,
        balance_cents: 1500,
        transactions: [
          // I paid $100 with two members: Sam 30, Kit 20 (their receivables are positive lines).
          { ...base, id: 1, date: '2026-10-01', split_id: 5, account_lines: [{ id: 1, account_id: 20, cents: -10000 }, { id: 2, account_id: 3, cents: 3000 }, { id: 3, account_id: 4, cents: 2000 }] },
          // A $50 refund of it: money back to me, their receivables shrink.
          { ...base, id: 2, date: '2026-10-02', split_id: 5, account_lines: [{ id: 4, account_id: 20, cents: 5000 }, { id: 5, account_id: 3, cents: -1500 }, { id: 6, account_id: 4, cents: -1000 }] },
        ],
      }
      balances[4] = { account_id: 4, balance_cents: 1000, transactions: [] }
      renderSplits()
      fireEvent.click((await screen.findAllByRole('button', { name: 'Print' }))[0])
      await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
      const rows = within(document.getElementById('print-statement')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
      expect(rows.map((r) => [r[3], r[4], r[5], r[6]])).toEqual([
        ['$100.00', 'You', '$30.00', '$30.00'],
        ['$50.00', 'You', '−$15.00', '$15.00'],
      ])
    })

    it('says so when I owe them', async () => {
      const statement = await openStatement(-2050, [BILLS[2]].map((t) => ({ ...t, account_lines: [{ id: 6, account_id: 3, cents: -2050 }] })))
      expect(statement.getByText('You owe Sam $20.50')).toBeInTheDocument()
    })

    it('has no Print button when nothing is owed', async () => {
      balances.splits = household().slice(0, 1)
      balances[3] = { account_id: 3, balance_cents: 0, touched: true, transactions: [] }
      renderSplits()
      expect(await screen.findByText('Settled up')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument()
    })
  })

  it('Settle up opens the Ledger with their account taking the opposite of what they owe', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: 5000, transactions: [HEAT] }
    renderSplits()
    fireEvent.click(await screen.findByRole('button', { name: 'Settle up' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/transactions|{"settleUp":{"account_id":3,"cents":-5000}}')
  })

  it('Settle up when I owe them puts the money onto their account', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: -2050, transactions: [HEAT] }
    renderSplits()
    fireEvent.click(await screen.findByRole('button', { name: 'Settle up' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/transactions|{"settleUp":{"account_id":3,"cents":2050}}')
  })

  it('shows your share update as percentages are typed, and warns past 100%', async () => {
    renderSplits()
    await openAddForm()
    expect(await screen.findByText('Your share: 100%')).toBeInTheDocument()

    await addMember('Sam', '30', 0)
    expect(await screen.findByText('Your share: 70%')).toBeInTheDocument()

    await addMember('Kit', '80', 1)
    expect(await screen.findByText(/add up to 110%, more than 100%/)).toBeInTheDocument()
  })

  it('closes the add panel on a successful save, and Cancel closes it too (#321)', async () => {
    createSplit.mockReset()
    createSplit.mockResolvedValue({})
    renderSplits()
    await openAddForm()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    fireEvent.change(await screen.findByLabelText('Split name'), { target: { value: 'Rent' } })
    await addMember('Sam', '50', 0)
    fireEvent.click(screen.getByRole('button', { name: 'Add split' }))
    await waitFor(() => expect(screen.queryByLabelText('Split name')).toBeNull())

    await openAddForm()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Split name')).toBeNull()
  })

  it('shows the backend refusal detail when a save is refused', async () => {
    createSplit.mockRejectedValue(new Error('The members add up to 110%, which is more than 100%.'))
    renderSplits()
    await openAddForm()
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

  it('keeps the note about someone leaving after Save, and clears it on the next edit', async () => {
    balances.splits = household().slice(0, 1)
    updateSplit.mockResolvedValue({ ...household()[0], members: [], warnings: ['Sam still owes you $60.00; their balance stays on Accounts.'] })
    renderSplits()
    fireEvent.click(await screen.findByText('Household'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Sam still owes you $60.00; their balance stays on Accounts.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument() // the panel closed, the note stayed

    fireEvent.click(await screen.findByText('Household'))
    expect(screen.queryByText(/still owes you/)).not.toBeInTheDocument()
  })

  it('opens on a tap or Enter, and Settle up does not also open the row (#398)', async () => {
    balances.splits = household().slice(0, 1)
    balances[3] = { account_id: 3, balance_cents: 5000, transactions: [] }
    renderSplits()
    const row = (await screen.findByText('Household')).closest('li.rounded-lg')
    expect(row).toHaveAttribute('tabindex', '0')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Settle up' }))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })

  it('shows the notes the archive returns', async () => {
    balances.splits = household().slice(0, 1)
    archiveSplit.mockResolvedValue({ id: 5, archived_on: '2026-10-05', warnings: ['You still owe Sam $5.00; their balance stays on Accounts.'] })
    renderSplits()
    fireEvent.click(await screen.findByText('Household'))
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))

    expect(await screen.findByText('You still owe Sam $5.00; their balance stays on Accounts.')).toBeInTheDocument()
  })

  it('an add says Recorded and highlights the new split; an edit highlights with no note; opening a form clears both (#343)', async () => {
    balances.splits = household()
    createSplit.mockReset()
    createSplit.mockResolvedValue({ id: 6 })
    updateSplit.mockReset()
    updateSplit.mockResolvedValue({ ...household()[0], warnings: [] })
    const rowOf = (name) => screen.getByText(name).closest('li.rounded-lg')
    renderSplits()
    await openAddForm()
    fireEvent.change(await screen.findByLabelText('Split name'), { target: { value: 'Trips' } })
    await addMember('Sam', '50', 0)
    fireEvent.click(screen.getByRole('button', { name: 'Add split' }))

    await waitFor(() => expect(screen.queryByLabelText('Split name')).toBeNull())
    expect(screen.getByText('Recorded.')).toBeInTheDocument()
    expect(rowOf('Trips')).toHaveClass('bg-raised')
    expect(rowOf('Household')).not.toHaveClass('bg-raised')

    fireEvent.click(within(rowOf('Household')).getByText('Household'))
    expect(screen.queryByText('Recorded.')).toBeNull()
    expect(rowOf('Trips')).not.toHaveClass('bg-raised')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByLabelText('Split name')).toBeNull())
    expect(screen.queryByText('Recorded.')).toBeNull()
    expect(rowOf('Household')).toHaveClass('bg-raised')

    await openAddForm()
    expect(rowOf('Household')).not.toHaveClass('bg-raised')
  })
})
