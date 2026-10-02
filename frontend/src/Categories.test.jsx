import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Categories from './Categories.jsx'

let goals = []
let streams = []
let summaryRows = [{ category_id: 11, available_cents: 0, pool_available_cents: 0, pool_absorber: null }]
const { setGoal, updateCategory, createCategory } = vi.hoisted(() => ({
  createCategory: vi.fn(),
  setGoal: vi.fn(() => Promise.resolve({})),
  updateCategory: vi.fn(() => Promise.resolve({})),
}))

vi.mock('./api.js', () => ({
  api: {
    categories: {
      list: () => Promise.resolve([{
        id: 11, name: 'Rent', parent_id: null, archived_on: null, need_level: null, linked_accounts: [], pool_id: null, absorb_overspending: false,
      }]),
      update: updateCategory,
      create: createCategory,
    },
    domains: { list: () => Promise.resolve([]) },
    readyToAssign: () => Promise.resolve({
      ready_to_assign_cents: 0, overspent_cents: 0,
      categories: summaryRows,
    }),
    goals: { list: () => Promise.resolve(goals), set: setGoal, archive: () => Promise.resolve({}) },
    accounts: { list: () => Promise.resolve([]) },
    incomeStreams: { list: () => Promise.resolve(streams) },
  },
}))

const rentRow = (overrides = {}) => ({
  goal: {
    id: 7, category_id: 11, name: 'Rent', kind: 'recurring_bill', amount_cents: 120000,
    cadence: 'monthly', archived_on: null, percent_of_net: null, income_stream_id: null,
  },
  balance_cents: 0, target_cents: 120000, owed_cents: 120000, due_date: '2026-10-01', per_period_cents: null,
  earliest_unpaid_due_on: '2026-10-01', earliest_unpaid_due_text: 'Oct 1',
  bill_status: 'due', bill_status_text: 'due Oct 1 · not paid',
  ...overrides,
})

function Ledger() {
  const { state } = useLocation()
  return <p>Ledger {JSON.stringify(state)}</p>
}

function renderCategories() {
  return render(
    <MemoryRouter initialEntries={['/categories']}>
      <Routes>
        <Route path="/categories" element={<Categories pickerDate="2026-10-03" />} />
        <Route path="/ledger" element={<Ledger />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('a recurring bill\'s row: Record', () => {
  it('names the earliest unpaid due date and opens the Ledger with the bill to record', async () => {
    goals = [rentRow()]
    renderCategories()

    fireEvent.click(await screen.findByRole('link', { name: 'Record Oct 1' }))

    expect(await screen.findByText(/^Ledger/)).toHaveTextContent(
      'Ledger {"recordBill":{"goal_id":7,"goal_due_on":"2026-10-01","category_id":11,"amount_cents":120000}}'
    )
  })

  it('advances to the next due date once the first is paid', async () => {
    goals = [rentRow({ earliest_unpaid_due_on: '2026-11-01', earliest_unpaid_due_text: 'Nov 1' })]
    renderCategories()
    expect(await screen.findByRole('link', { name: 'Record Nov 1' })).toBeInTheDocument()
  })

  it('is offered on a recurring bill only', async () => {
    goals = [rentRow({ goal: { ...rentRow().goal, kind: 'target' }, earliest_unpaid_due_on: null })]
    renderCategories()
    await screen.findByText('Rent', { selector: 'span' })
    expect(screen.queryByRole('link', { name: /Record/ })).not.toBeInTheDocument()
  })

  // #148: the link text uses the backend's `_short_date` wording (year only outside the picker's
  // own year) rather than reformatting the ISO date on the client.
  it('drops the year only when the due date falls outside the picker\'s year', async () => {
    goals = [rentRow({ earliest_unpaid_due_on: '2027-01-01', earliest_unpaid_due_text: 'Jan 1, 2027' })]
    renderCategories()
    expect(await screen.findByRole('link', { name: 'Record Jan 1, 2027' })).toBeInTheDocument()
  })
})

// #148: the design's goal row has no "still owed this cycle" line — it doesn't earn its place.
it('never shows a "still owed this cycle" line on a bill goal row', async () => {
  goals = [rentRow()]
  renderCategories()
  await screen.findByRole('link', { name: 'Record Oct 1' })
  expect(screen.queryByText(/still owed this cycle/i)).not.toBeInTheDocument()
})

// #148: a percent-of-net Commitment has no fixed per-period amount to show, so the row must
// name the rule instead of falling back to a bare, misleading "$0.00".
it('shows a percent-of-net Commitment\'s per-period text as a percentage, not $0.00', async () => {
  streams = [{ id: 3, name: 'GOC' }]
  goals = [rentRow({
    goal: {
      id: 9, category_id: 11, name: 'Savings top-up', kind: 'commitment', amount_cents: null,
      cadence: null, archived_on: null, percent_of_net: 5, income_stream_id: 3,
    },
    target_cents: null, owed_cents: null, due_date: null, per_period_cents: null,
    earliest_unpaid_due_on: null, earliest_unpaid_due_text: null,
    bill_status: null, bill_status_text: null,
  })]
  renderCategories()
  expect(await screen.findByText('5% of net · GOC pay')).toBeInTheDocument()
})

// #158: a fixed Commitment's goal row shows the wording the backend built, and no cadence of its own.
describe("a Commitment's goal row (#158)", () => {
  const commitmentRow = (goalFields, lines) => rentRow({
    goal: {
      id: 9, category_id: 11, name: 'Vacation', kind: 'commitment', amount_cents: 20000, cadence: 'monthly',
      archived_on: null, percent_of_net: null, income_stream_id: null, ...goalFields,
    },
    balance_cents: 90000, target_cents: null, owed_cents: null, due_date: null, per_period_cents: 20000,
    earliest_unpaid_due_on: null, earliest_unpaid_due_text: null, bill_status: null, bill_status_text: null,
    ...lines,
  })

  it('shows the cadence and progress lines as given', async () => {
    goals = [commitmentRow({}, {
      commitment_cadence_text: '$200.00 monthly · next due Oct 31',
      commitment_progress_text: '$140.00 of $200.00 this month',
    })]
    renderCategories()
    expect(await screen.findByText('$200.00 monthly · next due Oct 31')).toBeInTheDocument()
    expect(screen.getByText('$140.00 of $200.00 this month')).toBeInTheDocument()
    expect(screen.queryByText('$200.00 monthly')).not.toBeInTheDocument()
  })

  it('shows only "each payday" for a Commitment with no period, keeping the balance as before', async () => {
    goals = [commitmentRow({ amount_cents: 5000, cadence: null }, {
      commitment_cadence_text: '$50.00 each payday', commitment_progress_text: null, per_period_cents: 5000,
    })]
    renderCategories()
    expect(await screen.findByText('$50.00 each payday')).toBeInTheDocument()
    expect(screen.getByText('$900.00')).toBeInTheDocument()
  })

  it('shows no cadence for a refill Commitment', async () => {
    goals = [commitmentRow({ amount_cents: null, cadence: null, level_cents: 60000 }, {
      target_cents: 60000, owed_cents: 0, per_period_cents: null,
      commitment_cadence_text: null, commitment_progress_text: null,
    })]
    renderCategories()
    expect(await screen.findByText('$900.00 of $600.00')).toBeInTheDocument()
    expect(screen.queryByText(/payday|monthly/i)).not.toBeInTheDocument()
  })
})

describe("a Commitment's cadence (#156)", () => {
  async function openCommitmentForm() {
    goals = []
    setGoal.mockClear()
    renderCategories()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Kind'), { target: { value: 'commitment' } })
    fireEvent.change(screen.getByLabelText('Goal name'), { target: { value: 'Vacation fund' } })
  }

  it('offers Each payday, Monthly, Quarterly, Every 6 months, Yearly in that order and no weeks', async () => {
    await openCommitmentForm()
    const options = [...screen.getByLabelText('How often').querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(['Each payday', 'Monthly', 'Quarterly', 'Every 6 months', 'Yearly'])
    expect(screen.queryByLabelText('First month it is due')).not.toBeInTheDocument()
  })

  it('asks for the first due month once a cadence is chosen and sends the month end', async () => {
    await openCommitmentForm()
    fireEvent.change(screen.getByLabelText('Amount to add'), { target: { value: '200.00' } })
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: 'quarterly' } })
    fireEvent.change(screen.getByLabelText('First month it is due'), { target: { value: '2028-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setGoal).toHaveBeenCalled())
    expect(setGoal.mock.calls[0][1]).toMatchObject({
      kind: 'commitment', amount_cents: 20000, cadence: 'quarterly', cadence_weeks: null, first_due_on: '2028-02-29',
    })
  })

  it('sends an empty cadence and no month for Each payday', async () => {
    await openCommitmentForm()
    fireEvent.change(screen.getByLabelText('Amount to add'), { target: { value: '50.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setGoal).toHaveBeenCalled())
    expect(setGoal.mock.calls[0][1]).toMatchObject({ cadence: null, cadence_weeks: null, first_due_on: null })
  })

  it('never sends a cadence carried over from a bill on every N weeks', async () => {
    await openCommitmentForm()
    fireEvent.change(screen.getByLabelText('Amount to add'), { target: { value: '50.00' } })
    // The form state a bill on "every N weeks" leaves behind when the kind is switched.
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'recurring_bill' } })
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: 'weeks' } })
    fireEvent.change(screen.getByLabelText('Number of weeks'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'commitment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setGoal).toHaveBeenCalled())
    expect(setGoal.mock.calls[0][1]).toMatchObject({ kind: 'commitment', cadence: null, cadence_weeks: null, first_due_on: null })
  })

  it('does not ask a refill Commitment for a cadence', async () => {
    await openCommitmentForm()
    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'refill' } })
    expect(screen.queryByLabelText('How often')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Level to refill to'), { target: { value: '600.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setGoal).toHaveBeenCalled())
    expect(setGoal.mock.calls[0][1]).toMatchObject({ level_cents: 60000, cadence: null, first_due_on: null })
  })
})

describe('Edit (#168)', () => {
  it('scrolls the form into view', async () => {
    goals = []
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      renderCategories()
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
      await screen.findByText('Edit Rent')
      expect(scrollIntoView).toHaveBeenCalled()
      expect(scrollIntoView.mock.contexts.at(-1).tagName).toBe('FORM')
    } finally {
      delete Element.prototype.scrollIntoView
    }
  })
})

describe('absorb overspending', () => {
  it('saves the switch from the category form', async () => {
    goals = []
    renderCategories()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Absorb overspending/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith(11, expect.objectContaining({ absorb_overspending: true })))
  })

  it('adds "then Food absorbs the rest" to the pool pill only when an absorbing pool is in the chain', async () => {
    goals = []
    summaryRows = [{ category_id: 11, available_cents: 0, pool_available_cents: 17000, pool_absorber: 'Food' }]
    renderCategories()
    expect(await screen.findByText('+$170.00 available if overspent, then Food absorbs the rest')).toBeInTheDocument()
  })

  it('shows no absorb wording when nothing in the chain absorbs', async () => {
    goals = []
    summaryRows = [{ category_id: 11, available_cents: 0, pool_available_cents: 17000, pool_absorber: null }]
    renderCategories()
    expect(await screen.findByText('+$170.00 available if overspent')).toBeInTheDocument()
    expect(screen.queryByText(/absorbs the rest/)).not.toBeInTheDocument()
  })
})

describe('add a category', () => {
  it('blocks a second submit while the first is saving', async () => {
    let finish
    createCategory.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderCategories()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Groceries' } })
    const button = screen.getByRole('button', { name: 'Add category' })
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByLabelText('Name')).toBeDisabled()
    fireEvent.submit(button.closest('form'))
    expect(createCategory).toHaveBeenCalledTimes(1)

    finish({})
    await waitFor(() => expect(screen.getByLabelText('Name')).not.toBeDisabled())
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Add category' })).not.toBeDisabled()
  })
})
