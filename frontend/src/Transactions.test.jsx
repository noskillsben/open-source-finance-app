import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Transactions from './Transactions.jsx'

// What the mocked backend already holds; a test sets these before rendering.
let existingTransactions = []
let existingPayees = []

const calls = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  payeeCreate: vi.fn(),
  dueDates: vi.fn(),
  lastPayment: vi.fn(),
  remove: vi.fn(),
  payBatchGet: vi.fn(),
  payBatchReplace: vi.fn(),
}))

const ACCOUNTS = [
  { id: 1, name: 'Chequing', linked_category_ids: [] },
  { id: 2, name: 'Starbucks card', linked_category_ids: [], locked_payee_id: 7 },
  { id: 3, name: 'Roommate', linked_category_ids: [] },
]
const SPLITS = [
  {
    id: 5, name: 'Household', archived_on: null, my_share_percent: '50.0000',
    members: [{ id: 1, payee_id: 20, payee_name: 'Roommate', account_id: 3, account_name: 'Roommate', percent: '50.0000' }],
  },
]
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
    splits: { list: () => Promise.resolve(SPLITS) },
    categories: { list: () => Promise.resolve(CATEGORIES), create: vi.fn() },
    payees: { list: () => Promise.resolve(existingPayees), create: calls.payeeCreate },
    transactions: {
      list: () => Promise.resolve(existingTransactions),
      create: calls.create,
      update: calls.update,
      remove: calls.remove,
    },
    goals: {
      list: () => Promise.resolve([RENT_GOAL]),
      dueDates: calls.dueDates,
      lastPayment: calls.lastPayment,
    },
    payBatch: {
      get: calls.payBatchGet,
      replace: calls.payBatchReplace,
    },
  },
}))

function renderLedger(state, pickerDate = '2026-10-03') {
  const page = (date) => (
    <MemoryRouter initialEntries={[{ pathname: '/ledger', state }]}>
      <Transactions pickerDate={date} />
    </MemoryRouter>
  )
  const view = render(page(pickerDate))
  return { ...view, setPickerDate: (date) => view.rerender(page(date)) }
}

async function addCategoryLine(name) {
  fireEvent.click(await screen.findByText('+ add category line'))
  const select = (await screen.findByRole('option', { name })).closest('select')
  fireEvent.change(select, { target: { value: String(CATEGORIES.find((c) => c.name === name).id) } })
}

const dueSelect = () => screen.findByLabelText('Which due date')

beforeEach(() => {
  existingTransactions = []
  existingPayees = []
  calls.payeeCreate.mockReset()
  calls.create.mockReset()
  calls.update.mockReset()
  calls.update.mockResolvedValue({ notes: [] })
  calls.create.mockResolvedValue({ notes: [] })
  calls.dueDates.mockReset()
  calls.dueDates.mockResolvedValue(DUE_DATES)
  calls.lastPayment.mockReset()
  calls.lastPayment.mockResolvedValue({ payee_id: null, account_id: null })
  calls.remove.mockReset()
  calls.remove.mockResolvedValue({})
  calls.payBatchGet.mockReset()
  calls.payBatchGet.mockResolvedValue([])
  calls.payBatchReplace.mockReset()
  calls.payBatchReplace.mockResolvedValue({})
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

describe('Ledger form: deleting a transaction', () => {
  const EXISTING = {
    id: 5, date: '2026-10-03', memo: 'October rent', payee_id: null, valuation_id: null,
    income_stream_id: null, goal_id: null, goal_due_on: null,
    account_lines: [{ id: 1, account_id: 1, cents: -120000, budget_cents: -120000 }],
    category_lines: [{ id: 1, category_id: 11, cents: -120000, need_level: null }],
    deposits: [],
  }

  beforeEach(() => {
    existingTransactions = [EXISTING]
  })

  it('shows a checked checkbox when the batch has lines', async () => {
    calls.payBatchGet.mockResolvedValue([{ category_id: 10, cents: -500 }])
    renderLedger()
    fireEvent.click(await screen.findByText('October rent'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(calls.payBatchGet).toHaveBeenCalledWith(5)
    const checkbox = await screen.findByRole('checkbox', { name: /Also remove the money moves/ })
    expect(checkbox).toBeChecked()
  })

  it('hides the checkbox when the batch is empty', async () => {
    calls.payBatchGet.mockResolvedValue([])
    renderLedger()
    fireEvent.click(await screen.findByText('October rent'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await screen.findByText('Delete this transaction? This cannot be undone.')
    expect(screen.queryByRole('checkbox', { name: /Also remove the money moves/ })).not.toBeInTheDocument()
  })

  it('checked confirm replaces the batch empty before removing the transaction', async () => {
    calls.payBatchGet.mockResolvedValue([{ category_id: 10, cents: -500 }])
    renderLedger()
    fireEvent.click(await screen.findByText('October rent'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await screen.findByRole('checkbox', { name: /Also remove the money moves/ })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(calls.remove).toHaveBeenCalledWith(5))
    expect(calls.payBatchReplace).toHaveBeenCalledWith(5, [])
    const replaceOrder = calls.payBatchReplace.mock.invocationCallOrder[0]
    const removeOrder = calls.remove.mock.invocationCallOrder[0]
    expect(replaceOrder).toBeLessThan(removeOrder)
  })

  it('unchecked confirm only removes the transaction', async () => {
    calls.payBatchGet.mockResolvedValue([{ category_id: 10, cents: -500 }])
    renderLedger()
    fireEvent.click(await screen.findByText('October rent'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const checkbox = await screen.findByRole('checkbox', { name: /Also remove the money moves/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(calls.remove).toHaveBeenCalledWith(5))
    expect(calls.payBatchReplace).not.toHaveBeenCalled()
  })

  it('cancel deletes nothing', async () => {
    calls.payBatchGet.mockResolvedValue([{ category_id: 10, cents: -500 }])
    renderLedger()
    fireEvent.click(await screen.findByText('October rent'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await screen.findByRole('checkbox', { name: /Also remove the money moves/ })
    fireEvent.click(screen.getByRole('button', { name: 'Never mind' }))

    expect(screen.queryByText('Delete this transaction? This cannot be undone.')).not.toBeInTheDocument()
    expect(calls.remove).not.toHaveBeenCalled()
    expect(calls.payBatchReplace).not.toHaveBeenCalled()
  })

  it('replace failing shows the error and does not remove the transaction', async () => {
    calls.payBatchGet.mockResolvedValue([{ category_id: 10, cents: -500 }])
    calls.payBatchReplace.mockRejectedValue(new Error('boom'))
    renderLedger()
    fireEvent.click(await screen.findByText('October rent'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await screen.findByRole('checkbox', { name: /Also remove the money moves/ })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(calls.remove).not.toHaveBeenCalled()
  })
})

describe('Ledger form: the date follows the Show as of picker', () => {
  it('replaces the form date when the picker changes, even one typed by hand', async () => {
    const { setPickerDate } = renderLedger()
    const dateInput = await screen.findByLabelText('Date')
    expect(dateInput).toHaveValue('2026-10-03')

    fireEvent.change(dateInput, { target: { value: '2026-09-15' } })
    setPickerDate('2026-10-20')

    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-10-20'))
  })

  it('keeps the date of a transaction being edited when the picker changes', async () => {
    existingTransactions = [{
      id: 5, date: '2026-09-01', memo: 'September rent', payee_id: null, valuation_id: null,
      income_stream_id: null, goal_id: null, goal_due_on: null,
      account_lines: [{ id: 1, account_id: 1, cents: -120000, budget_cents: -120000 }],
      category_lines: [{ id: 1, category_id: 11, cents: -120000, need_level: null }],
      deposits: [],
    }]
    const { setPickerDate } = renderLedger()
    fireEvent.click(await screen.findByText('September rent'))
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-09-01'))

    setPickerDate('2026-10-20')

    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-09-01'))
  })
})

function fillAccountLine(cents) {
  const select = screen.getByRole('option', { name: 'Chequing' }).closest('select')
  fireEvent.change(select, { target: { value: '1' } })
  fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: cents } })
}

describe('Ledger form: choosing a payee with the keyboard', () => {
  const payeeBox = () => screen.findByPlaceholderText('Search payees…')

  beforeEach(() => {
    existingPayees = [
      { id: 3, name: 'Walmart', archived_on: null },
      { id: 4, name: 'Walk-in Clinic', archived_on: null },
    ]
  })

  it('Enter picks the exact-name match, else the top suggestion, without submitting', async () => {
    renderLedger()
    const box = await payeeBox()
    fireEvent.change(box, { target: { value: 'walk' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box).toHaveValue('Walk-in Clinic')

    fireEvent.change(box, { target: { value: 'walmart' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box).toHaveValue('Walmart')
    expect(calls.create).not.toHaveBeenCalled()
  })

  it('Enter adds a new payee when nothing matches', async () => {
    calls.payeeCreate.mockResolvedValue({ id: 9, name: 'Corner Store', archived_on: null })
    renderLedger()
    const box = await payeeBox()
    fireEvent.change(box, { target: { value: 'Corner Store' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    await waitFor(() => expect(box).toHaveValue('Corner Store'))
    expect(calls.payeeCreate).toHaveBeenCalledWith({ name: 'Corner Store', created_on: '2026-10-03' })
  })

  it('Enter with a failed add shows the error and does not submit', async () => {
    calls.payeeCreate.mockRejectedValue(new Error('Payee name is taken'))
    renderLedger()
    const box = await payeeBox()
    fireEvent.change(box, { target: { value: 'Corner Store' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(await screen.findByText('Payee name is taken')).toBeInTheDocument()
    expect(calls.create).not.toHaveBeenCalled()
  })

  it('leaves the form clean after a save, including unpicked payee text and the memo', async () => {
    renderLedger()
    const box = await payeeBox()
    fireEvent.change(box, { target: { value: 'half typed' } })
    fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'groceries' } })
    fillAccountLine('-20')
    fireEvent.click(screen.getByRole('button', { name: /save|record/i }))

    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByPlaceholderText('Search payees…')).toHaveValue(''))
    expect(screen.getByLabelText('Memo')).toHaveValue('')
  })
})

describe('Ledger form: an outflow from a payee-locked account', () => {
  const payeeBox = () => screen.findByPlaceholderText('Search payees…')
  function fillLockedLine(cents) {
    const select = screen.getByRole('option', { name: 'Starbucks card' }).closest('select')
    fireEvent.change(select, { target: { value: '2' } })
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: cents } })
  }

  beforeEach(() => {
    existingPayees = [{ id: 7, name: 'Starbucks' }, { id: 8, name: 'Walmart' }]
  })

  it('pre-fills the locked payee', async () => {
    renderLedger()
    const box = await payeeBox()
    fillLockedLine('-5')

    await waitFor(() => expect(box).toHaveValue('Starbucks'))
  })

  it('does not replace a payee already chosen', async () => {
    renderLedger()
    const box = await payeeBox()
    fireEvent.focus(box)
    fireEvent.mouseDown(await screen.findByText('Walmart'))
    fillLockedLine('-5')

    expect(box).toHaveValue('Walmart')
  })

  it('does not pre-fill for an inflow', async () => {
    renderLedger()
    const box = await payeeBox()
    fillLockedLine('20')

    expect(box).toHaveValue('')
  })

  it('does not pre-fill a payee archived since', async () => {
    existingPayees = [{ id: 8, name: 'Walmart' }]
    renderLedger()
    const box = await payeeBox()
    fillLockedLine('-5')

    expect(box).toHaveValue('')
  })
})

describe('Ledger form: a shared bill on a split', () => {
  const ME = { id: 1, name: 'Me', is_me: true }
  const ROOMMATE = { id: 20, name: 'Roommate', is_me: false }
  const SAVED = {
    id: 9, date: '2026-10-03', memo: 'Hydro', payee_id: null, valuation_id: null, income_stream_id: null,
    goal_id: null, goal_due_on: null, split_id: 5, paid_by_payee_id: 1, deposits: [],
    account_lines: [
      { id: 1, account_id: 1, cents: -10000, budget_cents: -10000 },
      { id: 2, account_id: 3, cents: 4000, budget_cents: 4000 }, // a one-off 60/40
    ],
    category_lines: [{ id: 1, category_id: 10, cents: -6000, need_level: null }],
  }
  const pickSplit = async () => {
    const select = await screen.findByLabelText('Split')
    await screen.findByRole('option', { name: 'Household' })
    fireEvent.change(select, { target: { value: '5' } })
  }
  const amounts = () => screen.getAllByPlaceholderText('0.00').map((i) => i.value)
  const save = () => fireEvent.click(screen.getByRole('button', { name: /save|record/i }))

  beforeEach(() => {
    existingPayees = [ME, ROOMMATE]
  })

  it('hides Paid by with no split, and fills the lines from the percentages when one is chosen', async () => {
    renderLedger()
    await screen.findByLabelText('Split')
    expect(screen.queryByLabelText('Paid by')).not.toBeInTheDocument()

    await addCategoryLine('Groceries')
    fillAccountLine('-100')
    await pickSplit()
    expect(screen.getByLabelText('Bill total')).toHaveValue('100') // taken from the account line

    expect(screen.getByLabelText('Paid by')).toHaveValue('1') // Me
    expect(amounts().slice(1, 4)).toEqual(['-100', '50', '-50']) // I pay, Roommate owes, my share is the category
  })

  it('always sends Paid by with a split, Me included', async () => {
    renderLedger()
    await pickSplit()
    await addCategoryLine('Groceries')
    fireEvent.change(screen.getByLabelText('Bill total'), { target: { value: '100' } })
    save()

    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    expect(calls.create.mock.calls[0][0]).toMatchObject({ split_id: 5, paid_by_payee_id: 1 })
  })

  it('sends no split and no Paid by on an ordinary transaction', async () => {
    renderLedger()
    await addCategoryLine('Groceries')
    fillAccountLine('-10')
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[1], { target: { value: '-10' } })
    save()

    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    expect(calls.create.mock.calls[0][0]).toMatchObject({ split_id: null, paid_by_payee_id: null })
  })

  it('writes no line on my accounts when someone else paid', async () => {
    renderLedger()
    await pickSplit()
    await addCategoryLine('Groceries')
    fireEvent.change(screen.getByLabelText('Bill total'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: '20' } })

    expect(amounts().slice(1, 3)).toEqual(['-50', '-50'])
    const accountValues = screen.getAllByRole('combobox').map((s) => s.value)
    expect(accountValues).toContain('3') // the roommate's receivable
    expect(accountValues).not.toContain('1') // never Chequing
  })

  it('editing the total rescales by the proportions on the saved bill, not by the split', async () => {
    existingTransactions = [SAVED]
    renderLedger()
    fireEvent.click(await screen.findByText('Hydro'))
    await waitFor(() => expect(screen.getByLabelText('Bill total')).toHaveValue('100'))

    fireEvent.change(screen.getByLabelText('Bill total'), { target: { value: '200' } })

    expect(amounts().slice(1, 4)).toEqual(['-200', '80', '-120'])
  })

  it('leaves a saved bill alone when its proportions cannot be read, such as a member since removed', async () => {
    existingTransactions = [{
      ...SAVED,
      // Sam has been taken out of the split since: their receivable (account 4) is no longer a member account.
      account_lines: [
        { id: 1, account_id: 1, cents: -10000, budget_cents: -10000 },
        { id: 2, account_id: 3, cents: 4000, budget_cents: 4000 },
        { id: 3, account_id: 4, cents: 2000, budget_cents: 2000 },
      ],
      category_lines: [{ id: 1, category_id: 10, cents: -4000, need_level: null }],
    }]
    renderLedger()
    fireEvent.click(await screen.findByText('Hydro'))
    const total = await screen.findByLabelText('Bill total')
    expect(total).toHaveAttribute('readonly')
    expect(screen.getByText(/no longer matches its split/)).toBeInTheDocument()
    const before = amounts()

    fireEvent.change(total, { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: '20' } })

    expect(amounts()).toEqual(before) // the lines, Sam's balance line included, are untouched
    save()
    await waitFor(() => expect(calls.update).toHaveBeenCalled())
    expect(calls.update.mock.calls[0][1].account_lines).toHaveLength(3)
  })

  it('shows the split on the ledger row', async () => {
    existingTransactions = [SAVED]
    renderLedger()

    expect(await screen.findByText('Split: Household')).toBeInTheDocument()
  })
})

describe("Ledger form: 'Settle up' from the Splits page", () => {
  it('pre-fills a plain transfer for the full balance when they owe me: their account down, mine up', async () => {
    renderLedger({ settleUp: { account_id: 3, cents: -3000 } })

    await waitFor(() => expect(screen.getAllByPlaceholderText('0.00').map((i) => i.value)).toEqual(['-30', '30']))
    expect(screen.getAllByRole('option', { name: 'Roommate' })[0].closest('select')).toHaveValue('3')
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-03')
    expect(screen.queryByRole('option', { name: 'Groceries' })).not.toBeInTheDocument() // no category line
    expect(calls.create).not.toHaveBeenCalled() // the user saves it themselves
  })

  it('reverses the signs when I owe them, and leaves my account for the user to pick', async () => {
    renderLedger({ settleUp: { account_id: 3, cents: 2050 } })

    await waitFor(() => expect(screen.getAllByPlaceholderText('0.00').map((i) => i.value)).toEqual(['20.5', '-20.5']))
    const accountSelects = screen.getAllByRole('option', { name: 'Chequing' }).map((o) => o.closest('select'))
    expect(accountSelects[1]).toHaveValue('')
  })
})
