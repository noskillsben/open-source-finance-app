import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PayRecord from './PayRecord.jsx'

// What the mocked backend already holds; a test sets these before rendering.
let existingTransactions = []
let streams = []
let categories = []

const writes = vi.hoisted(() => ({
  createTransaction: vi.fn(),
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
      goals: { list },
      transactions: {
        list: () => Promise.resolve(existingTransactions),
        create: writes.createTransaction,
        remove: writes.removeTransaction,
      },
      payBatch: { replace: writes.replaceBatch },
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
