import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Categories from './Categories.jsx'

let goals = []

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
    incomeStreams: { list: () => Promise.resolve([]) },
  },
}))

const rentRow = (overrides = {}) => ({
  goal: {
    id: 7, category_id: 11, name: 'Rent', kind: 'recurring_bill', amount_cents: 120000,
    cadence: 'monthly', archived_on: null,
  },
  balance_cents: 0, target_cents: 120000, owed_cents: 120000, due_date: '2026-10-01', per_period_cents: null,
  earliest_unpaid_due_on: '2026-10-01', bill_status: 'due', bill_status_text: 'due Oct 1 · not paid',
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

    fireEvent.click(await screen.findByRole('link', { name: 'Record Oct 1, 2026' }))

    expect(await screen.findByText(/^Ledger/)).toHaveTextContent(
      'Ledger {"recordBill":{"goal_id":7,"goal_due_on":"2026-10-01","category_id":11,"amount_cents":120000}}'
    )
  })

  it('advances to the next due date once the first is paid', async () => {
    goals = [rentRow({ earliest_unpaid_due_on: '2026-11-01' })]
    renderCategories()
    expect(await screen.findByRole('link', { name: 'Record Nov 1, 2026' })).toBeInTheDocument()
  })

  it('is offered on a recurring bill only', async () => {
    goals = [rentRow({ goal: { ...rentRow().goal, kind: 'target' }, earliest_unpaid_due_on: null })]
    renderCategories()
    await screen.findByText('Rent', { selector: 'span' })
    expect(screen.queryByRole('link', { name: /Record/ })).not.toBeInTheDocument()
  })
})
