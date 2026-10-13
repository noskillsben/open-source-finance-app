import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DueDates from './DueDates.jsx'

let goals = []
const { setGoal, createCategory } = vi.hoisted(() => ({
  setGoal: vi.fn(() => Promise.resolve({})),
  createCategory: vi.fn(() => Promise.resolve({ id: 99, name: 'Insurance' })),
}))

vi.mock('./api.js', () => ({
  api: {
    categories: {
      list: () => Promise.resolve([
        { id: 1, name: 'Rent' }, { id: 2, name: 'Phone' }, { id: 3, name: 'Car repairs' }, { id: 4, name: 'Holidays' },
      ]),
      create: createCategory,
    },
    goals: { list: () => Promise.resolve(goals), set: setGoal, archive: () => Promise.resolve({}) },
    incomeStreams: { list: () => Promise.resolve([]) },
  },
}))

const bill = (id, categoryId, name, due, over = {}) => ({
  goal: { id, category_id: categoryId, name, kind: 'recurring_bill', amount_cents: 12000, cadence: 'monthly', first_due_on: due, archived_on: null, percent_of_net: null, income_stream_id: null },
  balance_cents: 5000, target_cents: 12000, due_date: due,
  earliest_unpaid_due_on: due, earliest_unpaid_due_text: 'Nov 1',
  bill_status: 'next_due', bill_status_text: 'next due Nov 1', per_period_text: '$120.00 monthly',
  ...over,
})

const setAside = (id, categoryId, name, due, over = {}) => ({
  goal: { id, category_id: categoryId, name, kind: 'commitment', amount_cents: 20000, cadence: 'quarterly', first_due_on: due, archived_on: null, percent_of_net: null, income_stream_id: null },
  balance_cents: 0, target_cents: null, due_date: null,
  commitment_next_due_on: due,
  commitment_cadence_text: '$200.00 quarterly · next due Mar 31',
  commitment_progress_text: '$140.00 of $200.00 this quarter',
  ...over,
})

const target = { goal: { id: 50, category_id: 4, name: 'Holiday fund', kind: 'target', amount_cents: 100000, cadence: null, archived_on: null }, balance_cents: 0, target_cents: 100000, due_date: '2026-12-01' }
const eachPayday = { goal: { id: 51, category_id: 4, name: 'Pocket', kind: 'commitment', amount_cents: 5000, cadence: null, archived_on: null }, balance_cents: 0, target_cents: null, due_date: null, commitment_next_due_on: null, commitment_cadence_text: '$50.00 each payday', commitment_progress_text: null }

function Ledger() {
  const { state } = useLocation()
  return <p>Ledger {JSON.stringify(state)}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/due-dates']}>
      <Routes>
        <Route path="/due-dates" element={<DueDates pickerDate="2026-10-03" />} />
        <Route path="/transactions" element={<Ledger />} />
      </Routes>
    </MemoryRouter>,
  )
}

const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)

beforeEach(() => {
  setGoal.mockClear()
  createCategory.mockClear()
  goals = [
    bill(1, 1, 'Rent', '2026-11-01'),
    bill(2, 2, 'Phone', '2026-09-15', { bill_status: 'overdue', bill_status_text: 'overdue since Sep 15', earliest_unpaid_due_text: 'Sep 15' }),
    setAside(3, 3, 'Car insurance', '2026-12-31'),
    setAside(4, 4, 'Roof', '2026-10-31', { goal: { ...setAside(4, 4, 'Roof', '2026-10-31').goal, cadence: 'yearly' } }),
    target,
    eachPayday,
  ]
})

describe('the Due dates page', () => {
  it('lists overdue first, then soonest next due, and leaves out Targets and undated Commitments', async () => {
    renderPage()
    await screen.findByText('Car insurance')
    expect(names()).toEqual(['PhonePhone', 'RoofHolidays', 'RentRent', 'Car insuranceCar repairs'])
    expect(screen.queryByText('Holiday fund')).not.toBeInTheDocument()
    expect(screen.queryByText('Pocket')).not.toBeInTheDocument()
  })

  it('shows amount and how often, the status line and what is saved, from the same numbers as Categories', async () => {
    renderPage()
    const rent = (await screen.findByText('Rent', { selector: 'td' })).closest('tr')
    expect(within(rent).getByText('$120.00 monthly')).toBeInTheDocument()
    expect(within(rent).getByText('next due Nov 1')).toBeInTheDocument()
    expect(within(rent).getByText('$50.00 of $120.00')).toBeInTheDocument()
    const car = screen.getByText('Car insurance', { selector: 'td' }).closest('tr')
    expect(within(car).getByText('$200.00 quarterly')).toBeInTheDocument()
    expect(within(car).getByText('next due Mar 31')).toBeInTheDocument()
    expect(within(car).getByText('$140.00 of $200.00 this quarter')).toBeInTheDocument()
  })

  it('offers Record on bills only, with the same link state as the Categories goal row', async () => {
    renderPage()
    await screen.findByText('Car insurance')
    expect(screen.getAllByRole('link', { name: /^Record/ })).toHaveLength(2)
    const car = screen.getByText('Car insurance', { selector: 'td' }).closest('tr')
    expect(within(car).queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByText('Rent', { selector: 'td' }).closest('tr')).getByRole('link', { name: 'Record Nov 1' }))
    expect(await screen.findByText(/^Ledger/)).toHaveTextContent(
      'Ledger {"recordBill":{"goal_id":1,"goal_due_on":"2026-11-01","category_id":1,"amount_cents":12000}}',
    )
  })

  it('filters by kind, how often and category', async () => {
    renderPage()
    await screen.findByText('Car insurance')
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'set_aside' } })
    expect(names()).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'bill' } })
    expect(names()).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: 'quarterly' } })
    expect(names()).toEqual(['Car insuranceCar repairs'])
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Rent' } })
    expect(names()).toEqual(['RentRent'])
  })

  it('shows an empty state when nothing qualifies', async () => {
    goals = [target, eachPayday]
    renderPage()
    expect(await screen.findByText(/No bills or set-asides with a due date yet/)).toBeInTheDocument()
  })

  it('opens the goal form when a row is clicked', async () => {
    renderPage()
    fireEvent.click((await screen.findByText('Rent', { selector: 'td' })).closest('tr'))
    expect(screen.getByRole('complementary', { name: 'Edit · Rent' })).toBeInTheDocument()
    expect(screen.getByLabelText('Amount per bill')).toHaveValue('120.00')
  })

  it('Add asks bill or set-aside, then opens the goal form with a category picker that can create the category', async () => {
    renderPage()
    await screen.findByText('Car insurance')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'A bill' }))
    expect(screen.getByLabelText('Amount per bill')).toBeInTheDocument()

    fireEvent.change(within(screen.getByRole('complementary')).getByLabelText('Category'), { target: { value: 'Insurance' } })
    fireEvent.mouseDown(await screen.findByRole('button', { name: /Add “Insurance” as a new category/ }))
    expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Insurance', created_on: '2026-10-03' }))
    await act(async () => {})

    fireEvent.change(screen.getByLabelText('Amount per bill'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('First due date'), { target: { value: '2026-11-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Car insurance')
    await waitFor(() => expect(setGoal).toHaveBeenCalledWith(99, expect.objectContaining({ kind: 'recurring_bill', amount_cents: 9000, first_due_on: '2026-11-15', name: 'Insurance' })))
  })

  it('Add a set-aside opens the form on a Commitment', async () => {
    renderPage()
    await screen.findByText('Car insurance')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'A set-aside' }))
    expect(screen.getByLabelText('First month it is due')).toBeInTheDocument()
    expect(screen.getByLabelText('Kind')).toHaveValue('commitment')
  })
})
