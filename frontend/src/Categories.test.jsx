import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Categories from './Categories.jsx'

let goals = []
let streams = []

vi.mock('./api.js', () => ({
  api: {
    categories: { list: () => Promise.resolve([{
      id: 11, name: 'Rent', parent_id: null, archived_on: null, need_level: null, linked_accounts: [], pool_id: null,
    }]) },
    domains: { list: () => Promise.resolve([]) },
    readyToAssign: () => Promise.resolve({
      ready_to_assign_cents: 0, overspent_cents: 0,
      categories: [{ category_id: 11, available_cents: 0, pool_available_cents: 0 }],
    }),
    goals: { list: () => Promise.resolve(goals) },
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
