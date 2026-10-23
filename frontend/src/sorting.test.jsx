import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'
import Categories from './Categories.jsx'
import DueDates from './DueDates.jsx'
import Pay from './Pay.jsx'

// #345: a list sorts by tapping its column headers, and the arrow on the header says which order it is.
let accounts = []
let categories = []
let streams = []
let summary = []
let goals = []

vi.mock('./api.js', () => ({
  api: {
    accounts: { list: () => Promise.resolve(accounts) },
    categories: { list: () => Promise.resolve(categories) },
    domains: { list: () => Promise.resolve([]) },
    readyToAssign: () => Promise.resolve({ ready_to_assign_cents: 0, overspent_cents: 0, categories: summary }),
    goals: { list: () => Promise.resolve(goals) },
    incomeStreams: { list: () => Promise.resolve(streams) },
    payees: { list: () => Promise.resolve([]) },
  },
}))

const account = (id, name, type, on_budget, balance_cents = 0) => ({
  id, name, type, on_budget, on_budget_floor_cents: 0, archived_on: null, created_on: '2026-01-01',
  balance_cents, checked_on: null, entries_added_since_check: 0, notes: [], linked_category_ids: [],
  terms: { credit_limit_cents: 0 },
})
const category = (id, name, need_level = null, parent_id = null) => ({
  id, name, parent_id, archived_on: null, need_level, linked_accounts: [], pool_id: null, absorb_overspending: false,
})
const stream = (id, name, next_payday) => ({
  id, name, cadence: 'monthly', next_payday, next_payday_recorded: false, archived_on: null,
})
const bill = (id, name, due, amount_cents, balance_cents) => ({
  goal: { id, category_id: id, name, kind: 'recurring_bill', amount_cents, cadence: 'monthly', first_due_on: due, archived_on: null },
  balance_cents, target_cents: amount_cents, due_date: due, earliest_unpaid_due_on: due,
  bill_status: 'next_due', bill_status_text: 'next due', per_period_text: '$1.00 monthly',
})

// The given names, in the order they appear in the table body.
const order = (names) => {
  const text = screen.getByRole('table').querySelector('tbody').textContent
  return names.slice().sort((a, b) => text.indexOf(a) - text.indexOf(b))
}
const header = (name) => screen.getByRole('columnheader', { name })
const tap = (name) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('Accounts sort', () => {
  const names = ['Everyday', 'Car loan', 'Rainy day']
  const load = () => {
    accounts = [
      account(1, 'Everyday', 'Chequing', true, 500),
      account(2, 'Car loan', 'Loan', false, -9000),
      account(3, 'Rainy day', 'Savings', true, 7000),
    ]
    return render(<Accounts pickerDate="2026-10-03" />)
  }

  it('shows the default arrow on load, sorts on a tap and reverses on the next', async () => {
    load()
    await screen.findByText('Everyday')
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
    expect(header('Name').querySelector('svg')).not.toBeNull()
    expect(header('Balance')).toHaveAttribute('aria-sort', 'none')
    expect(header('Balance').querySelector('svg')).toBeNull()
    expect(order(names)).toEqual(['Car loan', 'Everyday', 'Rainy day'])

    tap('Name')
    expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
    expect(order(names)).toEqual(['Rainy day', 'Everyday', 'Car loan'])

    tap('Balance')
    expect(header('Balance')).toHaveAttribute('aria-sort', 'ascending')
    expect(header('Name')).toHaveAttribute('aria-sort', 'none')
    expect(order(names)).toEqual(['Car loan', 'Everyday', 'Rainy day'])
    tap('Balance')
    expect(header('Balance')).toHaveAttribute('aria-sort', 'descending')
    expect(order(names)).toEqual(['Rainy day', 'Everyday', 'Car loan'])
  })

  it('sorts Type in the type list order and Side on-budget first', async () => {
    load()
    await screen.findByText('Everyday')
    tap('Type')
    expect(order(names)).toEqual(['Everyday', 'Rainy day', 'Car loan'])
    tap('Side')
    expect(order(names)).toEqual(['Everyday', 'Rainy day', 'Car loan'])
    tap('Side')
    expect(order(names)).toEqual(['Car loan', 'Everyday', 'Rainy day'])
  })

  it('keeps an account with an unknown type last in both directions', async () => {
    load()
    accounts.push(account(4, 'Mystery', 'Unknown type', true, 1))
    cleanup()
    render(<Accounts pickerDate="2026-10-03" />)
    await screen.findByText('Mystery')
    const all = [...names, 'Mystery']
    tap('Type')
    expect(order(all).at(-1)).toBe('Mystery')
    tap('Type')
    expect(header('Type')).toHaveAttribute('aria-sort', 'descending')
    expect(order(all).at(-1)).toBe('Mystery')
  })

  it('Clear filters shows while the sort is not the default, and restores it', async () => {
    load()
    await screen.findByText('Everyday')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    tap('Balance')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('remembers the sort across a remount', async () => {
    const first = load()
    await screen.findByText('Everyday')
    tap('Balance')
    tap('Balance')
    first.unmount()
    load()
    await screen.findByText('Everyday')
    await waitFor(() => expect(header('Balance')).toHaveAttribute('aria-sort', 'descending'))
    expect(order(names)).toEqual(['Rainy day', 'Everyday', 'Car loan'])
  })
})

describe('Categories sort', () => {
  const all = ['Home', 'Rent', 'Cable', 'Fun', 'Food', 'Misc']
  const load = async () => {
    categories = [
      category(1, 'Home'), category(2, 'Rent', 'need', 1), category(3, 'Cable', 'want', 1),
      category(4, 'Fun', 'nice_to_have'), category(5, 'Food', 'should'), category(6, 'Misc'),
    ]
    summary = [
      { category_id: 2, available_cents: 100 }, { category_id: 3, available_cents: 200 },
      { category_id: 4, available_cents: 1000 }, { category_id: 5, available_cents: 50 }, { category_id: 6, available_cents: 5 },
    ]
    goals = []
    render(<MemoryRouter><Categories pickerDate="2026-10-03" /></MemoryRouter>)
    await screen.findByText('Rent')
  }

  it('defaults to Name A to Z with children under their parent', async () => {
    await load()
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
    expect(order(all)).toEqual(['Food', 'Fun', 'Home', 'Cable', 'Rent', 'Misc'])
  })

  it('sorts need level in its real order, nulls last either way, children under their parent', async () => {
    await load()
    tap('Need level')
    expect(order(all)).toEqual(['Food', 'Fun', 'Home', 'Rent', 'Cable', 'Misc'])
    tap('Need level')
    expect(order(all)).toEqual(['Fun', 'Food', 'Home', 'Cable', 'Rent', 'Misc'])
  })

  it('ranks a parent by its group total and keeps its children beneath it', async () => {
    await load()
    tap('Available')
    expect(order(all)).toEqual(['Misc', 'Food', 'Home', 'Rent', 'Cable', 'Fun'])
    tap('Available')
    expect(order(all)).toEqual(['Fun', 'Home', 'Cable', 'Rent', 'Food', 'Misc'])
  })

  it('Clear filters restores the default sort', async () => {
    await load()
    tap('Available')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
    expect(order(all)).toEqual(['Food', 'Fun', 'Home', 'Cable', 'Rent', 'Misc'])
  })
})

describe('Income sort', () => {
  it('defaults to next payday soonest first and reverses on a tap', async () => {
    streams = [stream(1, 'Alpha', '2026-11-01'), stream(2, 'Bravo', '2026-10-20'), stream(3, 'Charlie', '2026-10-25')]
    render(<MemoryRouter><Pay pickerDate="2026-10-03" /></MemoryRouter>)
    await screen.findByText('Alpha')
    const names = ['Alpha', 'Bravo', 'Charlie']
    expect(header('Next payday')).toHaveAttribute('aria-sort', 'ascending')
    expect(order(names)).toEqual(['Bravo', 'Charlie', 'Alpha'])
    tap('Next payday')
    expect(order(names)).toEqual(['Alpha', 'Charlie', 'Bravo'])
    tap('Name')
    expect(order(names)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
})

describe('Due dates sort', () => {
  const names = ['Soon', 'Later', 'Big']
  const load = () => {
    categories = []
    streams = []
    goals = [bill(1, 'Later', '2026-12-01', 5000, 100), bill(2, 'Soon', '2026-10-05', 1000, 900), bill(3, 'Big', '2027-01-01', 90000, 0)]
    return render(<MemoryRouter><DueDates pickerDate="2026-10-03" /></MemoryRouter>)
  }

  it('defaults to next due soonest first, and sorts by amount', async () => {
    load()
    await screen.findByText('Soon')
    expect(header('Status')).toHaveAttribute('aria-sort', 'ascending')
    expect(order(names)).toEqual(['Soon', 'Later', 'Big'])
    tap('Amount')
    tap('Amount')
    expect(order(names)).toEqual(['Big', 'Later', 'Soon'])
  })

  it('leads with an overdue bill in the default order', async () => {
    load()
    goals.push({ ...bill(4, 'Late', '2026-09-01', 700, 0), bill_status: 'overdue', bill_status_text: 'overdue since Sep 1' })
    cleanup()
    render(<MemoryRouter><DueDates pickerDate="2026-10-03" /></MemoryRouter>)
    await screen.findByText('Late')
    expect(order(['Late', ...names])).toEqual(['Late', 'Soon', 'Later', 'Big'])
  })

  it('keeps a bill with no next due date last in both directions', async () => {
    load()
    goals.push({ ...bill(4, 'Undated', '2026-09-01', 700, 0), earliest_unpaid_due_on: null, due_date: null })
    cleanup()
    render(<MemoryRouter><DueDates pickerDate="2026-10-03" /></MemoryRouter>)
    await screen.findByText('Undated')
    expect(order(['Undated', ...names]).at(-1)).toBe('Undated')
    tap('Status')
    expect(header('Status')).toHaveAttribute('aria-sort', 'descending')
    expect(order(['Undated', ...names]).at(-1)).toBe('Undated')
  })

  it('remembers its sort across a remount', async () => {
    const first = load()
    await screen.findByText('Soon')
    tap('Saved')
    first.unmount()
    load()
    await screen.findByText('Soon')
    await waitFor(() => expect(header('Saved')).toHaveAttribute('aria-sort', 'ascending'))
    expect(order(names)).toEqual(['Big', 'Later', 'Soon'])
  })
})
