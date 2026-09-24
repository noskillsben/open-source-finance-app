import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PayRecord from './PayRecord.jsx'

// What the mocked backend already holds; a test sets these before rendering.
let existingTransactions = []
let streams = []
let categories = []
let goals = []
let recordedBatch = []

const writes = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  replaceBatch: vi.fn(),
  removeTransaction: vi.fn(),
  createMove: vi.fn(),
}))

vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      incomeStreams: { list: () => Promise.resolve(streams) },
      categories: { list: () => Promise.resolve(categories) },
      accounts: { list },
      goals: { list: () => Promise.resolve(goals) },
      transactions: {
        list: () => Promise.resolve(existingTransactions),
        create: writes.createTransaction,
        update: writes.updateTransaction,
        remove: writes.removeTransaction,
      },
      payBatch: { get: () => Promise.resolve(recordedBatch), replace: writes.replaceBatch },
      earmarkMoves: { create: writes.createMove },
      readyToAssign: () => Promise.resolve({ ready_to_assign_cents: 0, overspent_cents: 0, categories: [] }),
    },
  }
})

const SALARY = {
  id: 3, name: 'Salary', cadence: 'monthly', cadence_weeks: null, next_payday: '2026-09-25',
  expected_gross_cents: 400000, deductions: [{ category_id: 2, amount_cents: 100000 }],
  income_category_id: 1, destination_account_id: 1,
}
const CATEGORIES = [
  { id: 1, name: 'Salary income', archived_on: null },
  { id: 2, name: 'Income tax', archived_on: null },
  { id: 4, name: 'Groceries', archived_on: null },
]

function renderSalary() {
  return render(
    <MemoryRouter initialEntries={['/pay/3']}>
      <Routes>
        <Route path="/pay/:id" element={<PayRecord pickerDate="2026-09-23" />} />
        <Route path="/pay" element={<p>Pay list</p>} />
      </Routes>
    </MemoryRouter>
  )
}

function renderOneOff() {
  return render(
    <MemoryRouter initialEntries={['/pay/one-off']}>
      <Routes>
        <Route path="/pay/one-off" element={<PayRecord pickerDate="2026-09-23" />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  existingTransactions = []
  streams = []
  categories = []
  goals = []
  recordedBatch = []
  for (const fn of Object.values(writes)) fn.mockReset()
})

describe('PayRecord with no named pay behind it', () => {

  it('opens with no named pay, hides the four goal blocks, and pre-fills nothing', async () => {
    renderOneOff()

    expect(await screen.findByRole('heading', { level: 2, name: 'One-off income' })).toBeInTheDocument()

    // Blocks 4, 6, 7, 8: nothing binds to a one-off, so none of them render.
    expect(screen.queryByText('Retain income')).not.toBeInTheDocument()
    expect(screen.queryByText('Bills')).not.toBeInTheDocument()
    expect(screen.queryByText('Funding rules')).not.toBeInTheDocument()
    expect(screen.queryByText('Goal set-asides')).not.toBeInTheDocument()

    // Gross, destination account and income category all start empty.
    expect(screen.getByLabelText(/Gross/)).toHaveValue('')
    expect(screen.getByLabelText('Income category')).toHaveValue('')
    expect(screen.getByLabelText('Destination account')).toHaveValue('')
  })

  it('never offers the duplicate guard, Set actual or Delete this pay, even on a date already recorded', async () => {
    // A one-off recorded earlier on the same date: unlinked, same shape the screen writes.
    existingTransactions = [
      {
        id: 7, date: '2026-09-23', income_stream_id: null,
        account_lines: [{ account_id: 1, cents: 50000 }],
        category_lines: [{ category_id: 1, cents: 50000 }],
      },
    ]

    // Opening the screen twice on the same date is a fresh one-shot form both times.
    for (let visit = 0; visit < 2; visit++) {
      const { unmount } = renderOneOff()
      expect(await screen.findByRole('heading', { level: 2, name: 'One-off income' })).toBeInTheDocument()

      expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument()
      expect(screen.queryByText(/already recorded/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/set actual/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/delete this pay/i)).not.toBeInTheDocument()
      expect(screen.queryByText('recorded')).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe('PayRecord saves the earmark batch whole', () => {
  beforeEach(() => {
    streams = [SALARY]
    categories = CATEGORIES
  })

  it('Record writes the transaction, then the whole batch in exactly one call', async () => {
    writes.createTransaction.mockResolvedValue({ id: 42 })
    writes.replaceBatch.mockResolvedValue([])
    renderSalary()

    const groceries = (await screen.findByText('Groceries')).closest('div').parentElement
    fireEvent.change(within(groceries).getByRole('textbox'), { target: { value: '500.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await screen.findByText('Pay list')
    expect(writes.createTransaction).toHaveBeenCalledTimes(1)
    expect(writes.replaceBatch).toHaveBeenCalledTimes(1)
    expect(writes.replaceBatch).toHaveBeenCalledWith(42, [
      { category_id: 1, cents: -100000 }, // income → Income tax
      { category_id: 2, cents: 100000 },
      { category_id: 1, cents: -300000 }, // income → ready to assign, the net
      { category_id: 4, cents: 50000 }, // ready to assign → Groceries
    ])
    expect(writes.createMove).not.toHaveBeenCalled()
  })

  it('Delete this pay saves the batch empty, then deletes the transaction', async () => {
    existingTransactions = [
      {
        id: 42, date: '2026-09-25', income_stream_id: 3,
        account_lines: [{ account_id: 1, cents: 300000 }],
        category_lines: [{ category_id: 1, cents: 400000 }, { category_id: 2, cents: -100000 }],
      },
    ]
    const order = []
    writes.replaceBatch.mockImplementation(async () => { order.push('batch') })
    writes.removeTransaction.mockImplementation(async () => { order.push('transaction') })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSalary()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete this pay' }))

    await waitFor(() => expect(order).toEqual(['batch', 'transaction']))
    expect(writes.replaceBatch).toHaveBeenCalledWith(42, [])
    expect(writes.removeTransaction).toHaveBeenCalledWith(42)
  })
})

describe('PayRecord re-opens a recorded pay', () => {
  const RECORDED = {
    id: 42, date: '2026-09-25', memo: 'Sept cheque', payee_id: 9, income_stream_id: 3, deposits: [],
    account_lines: [{ id: 1, account_id: 1, cents: 300000 }],
    category_lines: [
      { id: 1, category_id: 1, cents: 400000, need_level: null },
      { id: 2, category_id: 2, cents: -100000, need_level: null },
    ],
  }

  beforeEach(() => {
    streams = [SALARY]
    categories = [
      ...CATEGORIES,
      { id: 5, name: 'Rent', archived_on: null },
      { id: 6, name: 'Vacation', archived_on: '2026-09-30' },
      { id: 7, name: 'Savings', archived_on: null },
    ]
    // Rent is a bill bound to this pay, and its "due by next payday" is deliberately not what was recorded.
    goals = [
      {
        goal: { id: 11, kind: 'recurring_bill', category_id: 5, income_stream_id: 3, name: 'Rent', amount_cents: 150000, percent_of_net: null },
        due_date: '2026-10-01', due_by_next_payday_cents: 99999,
      },
    ]
    existingTransactions = [RECORDED]
    recordedBatch = [
      { category_id: 1, cents: -100000 }, // income → Income tax (bookkeeping)
      { category_id: 2, cents: 100000 },
      { category_id: 1, cents: -300000 }, // income → ready to assign (bookkeeping)
      { category_id: 5, cents: 120000 }, // Rent, a bill bound to this pay
      { category_id: 4, cents: 50000 }, // Groceries: no goal
      { category_id: 7, cents: -20000 }, // a cover from Savings
      { category_id: 6, cents: 10000 }, // Vacation, archived since
    ]
  })

  const leftOver = () => screen.getByText('Left over').nextSibling

  it('puts each recorded row in its block, and Left over is net minus the recorded distribution', async () => {
    renderSalary()

    const bills = (await screen.findByText('Bills')).closest('fieldset')
    await waitFor(() => expect(within(bills).getByRole('textbox')).toHaveValue('1200.00'))
    const groceries = screen.getByText('Groceries').closest('div').parentElement
    expect(within(groceries).getByRole('textbox')).toHaveValue('500.00')
    expect(screen.getByText('recorded')).toBeInTheDocument()

    const shortBy = screen.getByText('Short by').closest('fieldset')
    expect(within(shortBy).getByText('Savings')).toBeInTheDocument()
    expect(within(shortBy).getByLabelText('Savings covered')).toHaveValue('200.00')

    // The archived row shows its net and has nothing to type into.
    const archived = screen.getByText('Vacation (archived)').closest('div').parentElement
    expect(archived.querySelector('input')).toBeNull()

    // 3,000.00 net − 1,200.00 − 500.00 + 200.00 cover − 100.00 archived
    expect(leftOver()).toHaveTextContent('$1,400.00')
    expect(screen.queryByText(/set actual/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete this pay' })).toBeInTheDocument()
  })

  it('correcting the gross changes Left over', async () => {
    renderSalary()
    await screen.findByText('Vacation (archived)')

    fireEvent.change(screen.getByLabelText(/Gross/), { target: { value: '4100.00' } })

    expect(leftOver()).toHaveTextContent('$1,500.00')
  })

  it('Record edits the same transaction, then saves the batch with the bookkeeping recomputed', async () => {
    const order = []
    writes.updateTransaction.mockImplementation(async () => { order.push('transaction'); return { id: 42 } })
    writes.replaceBatch.mockImplementation(async () => { order.push('batch'); return [] })
    renderSalary()
    await screen.findByText('Vacation (archived)')

    fireEvent.change(screen.getByLabelText(/Gross/), { target: { value: '4100.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await screen.findByText('Pay list')
    expect(order).toEqual(['transaction', 'batch'])
    expect(writes.createTransaction).not.toHaveBeenCalled()
    expect(writes.updateTransaction).toHaveBeenCalledWith(42, {
      date: '2026-09-25', memo: 'Sept cheque', payee_id: 9, income_stream_id: 3, deposits: [],
      account_lines: [{ account_id: 1, cents: 310000 }],
      category_lines: [{ category_id: 1, cents: 410000 }, { category_id: 2, cents: -100000 }],
    })
    expect(writes.replaceBatch).toHaveBeenCalledWith(42, [
      { category_id: 1, cents: -100000 },
      { category_id: 2, cents: 100000 },
      { category_id: 1, cents: -310000 }, // the net, now 3,100.00
      { category_id: 5, cents: 120000 },
      { category_id: 4, cents: 50000 },
      { category_id: 7, cents: -20000 },
      { category_id: 6, cents: 10000 }, // the archived row goes back as it was
    ])
  })

  it('keeps a pay split across accounts: only the first account line takes the change in net', async () => {
    existingTransactions = [
      {
        ...RECORDED,
        account_lines: [
          { id: 1, account_id: 1, cents: 250000 },
          { id: 2, account_id: 8, cents: 50000 },
        ],
      },
    ]
    writes.updateTransaction.mockResolvedValue({ id: 42 })
    writes.replaceBatch.mockResolvedValue([])
    renderSalary()
    await screen.findByText('Vacation (archived)')

    fireEvent.change(screen.getByLabelText(/Gross/), { target: { value: '4100.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await screen.findByText('Pay list')
    expect(writes.updateTransaction.mock.calls[0][1].account_lines).toEqual([
      { account_id: 1, cents: 260000 },
      { account_id: 8, cents: 50000 },
    ])
  })

  it('shows the error when the batch call fails, and saving again writes no second transaction', async () => {
    writes.updateTransaction.mockResolvedValue({ id: 42 })
    writes.replaceBatch.mockRejectedValueOnce(new Error('Batch refused.')).mockResolvedValue([])
    renderSalary()
    await screen.findByText('Vacation (archived)')

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(await screen.findByText('Batch refused.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await screen.findByText('Pay list')
    expect(writes.createTransaction).not.toHaveBeenCalled()
    expect(writes.updateTransaction).toHaveBeenCalledTimes(2)
    expect(writes.replaceBatch).toHaveBeenCalledTimes(2)
  })
})
