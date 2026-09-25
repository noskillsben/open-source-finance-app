import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Transactions from './Transactions.jsx'

// What the mocked backend already holds; a test sets these before rendering.
let existingTransactions = []

const calls = vi.hoisted(() => ({ create: vi.fn(), dueDates: vi.fn(), lastPayment: vi.fn() }))

const ACCOUNTS = [{ id: 1, name: 'Chequing', linked_category_ids: [] }]
const CATEGORIES = [
  { id: 10, name: 'Groceries', archived_on: null },
  { id: 11, name: 'Rent', archived_on: null },
]
const RENT_GOAL = {
  goal: { id: 7, category_id: 11, name: 'Rent', kind: 'recurring_bill', archived_on: null },
  earliest_unpaid_due_on: '2026-10-01',
}
const DUE_DATES = [
  { due_on: '2026-09-01', paid: true, earliest_unpaid: false },
  { due_on: '2026-10-01', paid: false, earliest_unpaid: true },
  { due_on: '2026-11-01', paid: false, earliest_unpaid: false },
]

vi.mock('./api.js', () => ({
  api: {
    accounts: { list: () => Promise.resolve(ACCOUNTS) },
    categories: { list: () => Promise.resolve(CATEGORIES), create: vi.fn() },
    payees: { list: () => Promise.resolve([]), create: vi.fn() },
    transactions: {
      list: () => Promise.resolve(existingTransactions),
      create: calls.create,
      update: vi.fn(),
      remove: vi.fn(),
    },
    goals: {
      list: () => Promise.resolve([RENT_GOAL]),
      dueDates: calls.dueDates,
      lastPayment: calls.lastPayment,
    },
  },
}))

function renderLedger(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/ledger', state }]}>
      <Transactions pickerDate="2026-10-03" />
    </MemoryRouter>
  )
}

async function addCategoryLine(name) {
  fireEvent.click(await screen.findByText('+ add category line'))
  const select = (await screen.findByRole('option', { name })).closest('select')
  fireEvent.change(select, { target: { value: String(CATEGORIES.find((c) => c.name === name).id) } })
}

const dueSelect = () => screen.findByLabelText('Which due date')

beforeEach(() => {
  existingTransactions = []
  calls.create.mockReset()
  calls.create.mockResolvedValue({ notes: [] })
  calls.dueDates.mockReset()
  calls.dueDates.mockResolvedValue(DUE_DATES)
  calls.lastPayment.mockReset()
  calls.lastPayment.mockResolvedValue({ payee_id: null, account_id: null })
})

describe('Ledger form: which bill and due date a payment paid', () => {
  it('offers nothing for a category with no bill', async () => {
    renderLedger()
    await addCategoryLine('Groceries')
    expect(screen.queryByText(/This pays/)).not.toBeInTheDocument()
    expect(calls.dueDates).not.toHaveBeenCalled()
  })

  it('offers the bill with its earliest unpaid due date, and Confirm links that date', async () => {
    renderLedger()
    await addCategoryLine('Rent')

    expect(await screen.findByText(/This pays/)).toHaveTextContent('This pays Rent, due Oct 1, 2026.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(screen.getByText(/Marked as paying/)).toHaveTextContent('Marked as paying Rent, due Oct 1, 2026.')
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  it('links nothing until it is confirmed', async () => {
    renderLedger()
    await addCategoryLine('Rent')
    await screen.findByText(/This pays/)
    fillAccountLine('-1200')
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[1], { target: { value: '-1200' } })
    fireEvent.click(screen.getByRole('button', { name: /save|record/i }))

    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    expect(calls.create.mock.calls[0][0]).toMatchObject({ goal_id: null, goal_due_on: null })
  })

  it('sends the confirmed bill and due date when saved', async () => {
    renderLedger()
    await addCategoryLine('Rent')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    fillAccountLine('-1200')
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[1], { target: { value: '-1200' } })
    fireEvent.click(screen.getByRole('button', { name: /save|record/i }))

    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    expect(calls.create.mock.calls[0][0]).toMatchObject({ goal_id: 7, goal_due_on: '2026-10-01' })
  })

  it('picking a different date from the list links that date instead', async () => {
    renderLedger()
    await addCategoryLine('Rent')
    const select = await dueSelect()
    await waitFor(() => expect(select).toHaveTextContent('Nov 1, 2026'))

    fireEvent.change(select, { target: { value: '2026-11-01' } })

    expect(screen.getByText(/Marked as paying/)).toHaveTextContent('Marked as paying Rent, due Nov 1, 2026.')
    expect(select).toHaveValue('2026-11-01')
    expect(screen.getByRole('option', { name: /Sep 1, 2026 · already paid/ })).toBeInTheDocument()
  })

  it('"Leave unlinked" clears the offer, and it does not come back for the same line', async () => {
    renderLedger()
    await addCategoryLine('Rent')
    await screen.findByText(/This pays/)

    fireEvent.click(screen.getByRole('button', { name: 'Leave unlinked' }))
    expect(screen.queryByText(/This pays/)).not.toBeInTheDocument()

    // Another edit to the lines (a second line, an amount) doesn't re-offer the declined bill.
    fireEvent.click(screen.getByText('+ add category line'))
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[1], { target: { value: '-5' } })
    expect(screen.queryByText(/This pays/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Marked as paying/)).not.toBeInTheDocument()
  })

  it('"Remove link" unlinks the payment and does not re-offer the bill', async () => {
    renderLedger()
    await addCategoryLine('Rent')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))

    expect(screen.queryByText(/Marked as paying/)).not.toBeInTheDocument()
    expect(screen.queryByText(/This pays/)).not.toBeInTheDocument()
  })

  it('opening a linked transaction pre-fills the bill and due date, and keeps the link on save', async () => {
    existingTransactions = [{
      id: 5, date: '2026-10-03', memo: 'October rent', payee_id: null, valuation_id: null,
      income_stream_id: null, goal_id: 7, goal_due_on: '2026-10-01',
      account_lines: [{ id: 1, account_id: 1, cents: -120000, budget_cents: -120000 }],
      category_lines: [{ id: 1, category_id: 11, cents: -120000, need_level: null }],
      deposits: [],
    }]
    renderLedger()

    fireEvent.click(await screen.findByText('October rent'))

    expect(await screen.findByText(/Marked as paying/)).toHaveTextContent('Marked as paying Rent, due Oct 1, 2026.')
    expect(await dueSelect()).toHaveValue('2026-10-01')
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove link' })).toBeInTheDocument()
  })

  it('shows a marked payment in the list as paying its bill', async () => {
    existingTransactions = [{
      id: 5, date: '2026-10-03', memo: 'October rent', payee_id: null, valuation_id: null,
      income_stream_id: null, goal_id: 7, goal_due_on: '2026-10-01',
      account_lines: [{ id: 1, account_id: 1, cents: -120000, budget_cents: -120000 }],
      category_lines: [{ id: 1, category_id: 11, cents: -120000, need_level: null }],
      deposits: [],
    }]
    renderLedger()
    expect(await screen.findByText(/pays Rent, due/)).toHaveTextContent('pays Rent, due Oct 1, 2026')
  })
})

describe("Ledger form: 'Record' from a bill's row on Categories", () => {
  const RECORD_RENT = {
    recordBill: { goal_id: 7, goal_due_on: '2026-10-01', category_id: 11, amount_cents: 120000 },
  }

  it('opens pre-filled and already confirmed: category, expected amount, bill link and the picker date', async () => {
    renderLedger(RECORD_RENT)

    expect(await screen.findByText(/Marked as paying/)).toHaveTextContent('Marked as paying Rent, due Oct 1, 2026.')
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rent' }).closest('select')).toHaveValue('11')
    expect(screen.getAllByPlaceholderText('0.00').map((i) => i.value)).toEqual(['-1200', '-1200'])
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-03')
    expect(calls.create).not.toHaveBeenCalled() // the user saves it themselves
  })

  it('copies the payee and account of the last linked payment, and saves the link', async () => {
    calls.lastPayment.mockResolvedValue({ payee_id: 4, account_id: 1 })
    renderLedger(RECORD_RENT)

    await waitFor(() => expect(screen.getByRole('option', { name: 'Chequing' }).closest('select')).toHaveValue('1'))
    fireEvent.click(screen.getByRole('button', { name: /save|record/i }))

    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    expect(calls.create.mock.calls[0][0]).toMatchObject({
      date: '2026-10-03', payee_id: 4, goal_id: 7, goal_due_on: '2026-10-01',
      account_lines: [{ account_id: 1, cents: -120000 }],
      category_lines: [{ category_id: 11, cents: -120000 }],
    })
  })

  it('leaves payee and account empty on the first payment', async () => {
    renderLedger(RECORD_RENT)
    await screen.findByText(/Marked as paying/)
    await waitFor(() => expect(calls.lastPayment).toHaveBeenCalledWith(7))
    expect(screen.getByRole('option', { name: 'Chequing' }).closest('select')).toHaveValue('')
  })
})

function fillAccountLine(cents) {
  const select = screen.getByRole('option', { name: 'Chequing' }).closest('select')
  fireEvent.change(select, { target: { value: '1' } })
  fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: cents } })
}
