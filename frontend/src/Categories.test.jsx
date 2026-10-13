import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// Tapping a row opens it in the side panel; there is no Edit button (DESIGN.md § Row actions).
async function openRent() {
  fireEvent.click(await screen.findByRole('row', { name: /Move money/ }))
}

function Ledger() {
  const { state } = useLocation()
  return <p>Ledger {JSON.stringify(state)}</p>
}

function renderCategories() {
  return render(
    <MemoryRouter initialEntries={['/categories']}>
      <Routes>
        <Route path="/categories" element={<Categories pickerDate="2026-10-03" />} />
        <Route path="/transactions" element={<Ledger />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('a recurring bill\'s row: Record', () => {
  it('names the earliest unpaid due date and opens Transactions with the bill to record', async () => {
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

// #205: the amount-and-cadence text on a bill or Target row is the server's wording, never the client's.
describe('the per-period text on a goal row (#205)', () => {
  it('shows the amount and cadence of a bill from the server', async () => {
    goals = [rentRow({ per_period_text: '$87.00 yearly' })]
    renderCategories()
    expect(await screen.findByText('$87.00 yearly')).toBeInTheDocument()
  })

  it('shows the per-period amount and cadence of a Target from the server', async () => {
    goals = [rentRow({
      goal: { ...rentRow().goal, kind: 'target', cadence: 'monthly' },
      earliest_unpaid_due_on: null, bill_status: null, bill_status_text: null,
      per_period_cents: 10000, per_period_text: '$100.00 monthly',
    })]
    renderCategories()
    expect(await screen.findByText('$100.00 monthly')).toBeInTheDocument()
  })

  it('words no cadence of its own when the server sends none', async () => {
    goals = [rentRow({ per_period_text: null })]
    renderCategories()
    await screen.findByText('Rent', { selector: 'span' })
    expect(screen.queryByText(/monthly|yearly/i)).not.toBeInTheDocument()
  })
})

// #198: a Target with a date has one pace, its named pay's or its own cadence, never both.
describe("a Target's one pace (#198)", () => {
  async function openTargetForm() {
    goals = []
    streams = [{ id: 3, name: 'Salary' }]
    setGoal.mockClear()
    renderCategories()
    await openRent()
    fireEvent.change(await screen.findByLabelText('Kind'), { target: { value: 'target' } })
    fireEvent.change(screen.getByLabelText('Goal name'), { target: { value: 'Vacation' } })
    fireEvent.change(screen.getByLabelText('Amount to reach'), { target: { value: '1000.00' } })
    fireEvent.change(screen.getByLabelText('Target date (optional)'), { target: { value: '2027-06-01' } })
  }

  it('hides "how often" once a named pay is picked, and sends no cadence', async () => {
    await openTargetForm()
    fireEvent.change(screen.getByLabelText('Set aside every (optional)'), { target: { value: 'monthly' } })
    fireEvent.change(screen.getByLabelText('Named pay this is paid by (optional)'), { target: { value: 'Salary' } })
    expect(screen.queryByLabelText('Set aside every (optional)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setGoal).toHaveBeenCalled())
    expect(setGoal.mock.calls[0][1]).toMatchObject({ income_stream_id: 3, cadence: null, cadence_weeks: null })
  })

  it('brings "how often" back when the named pay is cleared, and sends the cadence with no pay', async () => {
    await openTargetForm()
    fireEvent.change(screen.getByLabelText('Named pay this is paid by (optional)'), { target: { value: 'Salary' } })
    fireEvent.change(screen.getByLabelText('Named pay this is paid by (optional)'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Set aside every (optional)'), { target: { value: 'monthly' } })
    expect(screen.getByLabelText('Named pay this is paid by (optional)')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setGoal).toHaveBeenCalled())
    expect(setGoal.mock.calls[0][1]).toMatchObject({ income_stream_id: null, cadence: 'monthly' })
  })

  it('shows the server-worded per-payday pace on a bound Target row', async () => {
    goals = [rentRow({
      goal: { ...rentRow().goal, kind: 'target', cadence: null, income_stream_id: 3 },
      earliest_unpaid_due_on: null, bill_status: null, bill_status_text: null,
      per_period_cents: 9330, per_period_text: '$93.30 per Salary payday',
    })]
    renderCategories()
    expect(await screen.findByText('$93.30 per Salary payday')).toBeInTheDocument()
  })
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
    await openRent()
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
  it('opens in a side panel titled with the name, and brings it into view', async () => {
    goals = []
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      renderCategories()
      await openRent()
      await screen.findByText('Edit · Rent')
      expect(scrollIntoView).toHaveBeenCalled()
      expect(scrollIntoView.mock.contexts.at(-1).tagName).toBe('ASIDE')
    } finally {
      delete Element.prototype.scrollIntoView
    }
  })
})

describe('absorb overspending', () => {
  it('saves the switch from the category form', async () => {
    goals = []
    renderCategories()
    await openRent()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Add a category' }))
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
    expect(screen.getByLabelText('Name')).toHaveFocus() // #220: ready for the next entry
  })
})

describe('the visual pass (#252)', () => {
  it('reads an overdrawn goal as "$525.00 short" in negative, and lists no Domains on this page (#220)', async () => {
    goals = [rentRow({ balance_cents: -52500 })]
    renderCategories()
    const short = await screen.findByText('$525.00 short')
    expect(short).toHaveClass('text-negative')
    expect(screen.queryByText('Domains')).toBeNull()
    expect(screen.queryByLabelText('Domain name')).toBeNull()
  })
})

// #286: one control per row, collapsible groups with their totals.
describe('rows and groups (#286)', () => {
  const cat = (id, name, parent_id = null) => ({
    id, name, parent_id, archived_on: null, need_level: null, linked_accounts: [], pool_id: null, absorb_overspending: false,
  })
  const tree = [cat(1, 'Food'), cat(2, 'Groceries', 1), cat(3, 'Dining out', 1), cat(4, 'Rent')]

  async function renderTree(available) {
    goals = []
    const { api } = await import('./api.js')
    api.categories.list = () => Promise.resolve(tree)
    api.earmarkMoves = { create: vi.fn(() => Promise.resolve({})) }
    summaryRows = Object.entries(available).map(([id, cents]) => ({
      category_id: Number(id), available_cents: cents, pool_available_cents: 0, pool_absorber: null,
    }))
    localStorage.clear()
    renderCategories()
    await screen.findByText('Rent')
  }

  it('shows the group total on the parent, and no "itself" line when the parent holds nothing', async () => {
    await renderTree({ 1: 0, 2: 5000, 3: 2500, 4: 0 })
    const food = screen.getByText('Food', { selector: 'span' }).closest('tr')
    expect(food).toHaveTextContent('$75.00')
    expect(screen.queryByText('Food itself')).toBeNull()
  })

  it('adds a "Food itself" line first among the children when the parent holds money of its own', async () => {
    await renderTree({ 1: 1000, 2: 5000, 3: 2500, 4: 0 })
    expect(screen.getByText('Food', { selector: 'span' }).closest('tr')).toHaveTextContent('$85.00')
    expect(screen.getByText('Food itself').closest('tr')).toHaveTextContent('$10.00')
  })

  it('collapses and expands a group, remembers it on the device, and has Expand all / Collapse all', async () => {
    await renderTree({ 1: 0, 2: 5000, 3: 2500, 4: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Food' }))
    expect(screen.queryByText('Groceries')).toBeNull()
    expect(JSON.parse(localStorage.getItem('categories.collapsed'))).toEqual([1])
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('Dining out')).toBeNull()
  })

  it('a search expands a collapsed group holding a match', async () => {
    await renderTree({ 1: 0, 2: 5000, 3: 2500, 4: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Food' }))
    expect(screen.queryByText('Groceries')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'groc' } })
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.queryByText('Dining out')).toBeNull()
  })

  it('gives a category row one button, Move money, and Edit and Archive live in the panel', async () => {
    await renderTree({ 1: 0, 2: 0, 3: 0, 4: 0 })
    const rent = screen.getByText('Rent').closest('tr')
    expect(within(rent).getAllByRole('button').map((b) => b.textContent)).toEqual(['Move money'])
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
    fireEvent.click(within(rent).getByRole('button', { name: 'Move money' }))
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
  })

  it('Move money Add posts an earmark move into the category from the panel', async () => {
    await renderTree({ 1: 0, 2: 0, 3: 0, 4: 0 })
    const { api } = await import('./api.js')
    fireEvent.click(within(screen.getByText('Rent').closest('tr')).getByRole('button', { name: 'Move money' }))
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '25.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(api.earmarkMoves.create).toHaveBeenCalledWith({ date: '2026-10-03', cents: 2500, to_category_id: 4 }))
  })

  it('has no amount box on a goal row', async () => {
    await renderTree({ 1: 0, 2: 0, 3: 0, 4: 0 })
    goals = [rentRow({ goal: { ...rentRow().goal, category_id: 4 } })]
    const { api } = await import('./api.js')
    api.goals.list = () => Promise.resolve(goals)
    renderCategories()
    await screen.findAllByRole('link', { name: 'Record Oct 1' })
    expect(screen.queryByLabelText(/Amount to add to or withdraw from/)).toBeNull()
  })
})
