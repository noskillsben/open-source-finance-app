import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'
import Categories from './Categories.jsx'
import ChoicePicker from './components/ChoicePicker.jsx'
import { GOAL_KINDS } from './GoalFields.jsx'
import Pay from './Pay.jsx'
import { ON_BUDGET_TYPES, TRACKING_TYPES } from './account_types.js'
import { NEED_LEVELS } from './utils/order.js'

// #36: every list page narrows by a name search and a facet, big pickers are type-ahead, and drop-downs
// come in a sensible order. Data is mutable so each test sets its own.
let accounts = []
let categories = []
let goals = []
let streams = []

vi.mock('./api.js', () => ({
  api: {
    accounts: {
      list: () => Promise.resolve(accounts),
      checkBalancePreview: () => Promise.resolve({ diff_cents: 0, category_lines: [] }),
    },
    categories: { list: () => Promise.resolve(categories) },
    domains: { list: () => Promise.resolve([]) },
    readyToAssign: () => Promise.resolve({ ready_to_assign_cents: 0, overspent_cents: 0, categories: [] }),
    goals: { list: () => Promise.resolve(goals) },
    incomeStreams: { list: () => Promise.resolve(streams) },
    payees: { list: () => Promise.resolve([]) },
  },
}))

const account = (id, name, type, on_budget) => ({
  id, name, type, on_budget, on_budget_floor_cents: 0, archived_on: null, created_on: '2026-01-01',
  balance_cents: 0, checked_on: null, entries_added_since_check: 0, notes: [], linked_category_ids: [],
  terms: { credit_limit_cents: 0 },
})
const category = (id, name, need_level = null) => ({
  id, name, parent_id: null, archived_on: null, need_level, linked_accounts: [], pool_id: null, absorb_overspending: false,
})
const stream = (id, name, cadence) => ({
  id, name, cadence, next_payday: '2026-10-20', next_payday_recorded: false, archived_on: null,
})
const goalRow = (category_id, kind) => ({
  goal: { id: category_id, category_id, name: kind, kind, amount_cents: 1000, cadence: 'monthly', archived_on: null },
  balance_cents: 0, target_cents: 1000, owed_cents: 0, due_date: null, per_period_cents: null,
  earliest_unpaid_due_on: null, earliest_unpaid_due_text: null, bill_status: null, bill_status_text: null,
})

afterEach(() => vi.restoreAllMocks())

const has = (text) => screen.queryByText(text) !== null

describe('Accounts filters', () => {
  const load = async () => {
    accounts = [
      account(1, 'Everyday', 'Chequing', true),
      account(2, 'Rainy day', 'Savings', true),
      account(3, 'Car loan', 'Loan', false),
    ]
    render(<Accounts pickerDate="2026-10-03" />)
    await screen.findByText('Everyday')
  }

  it('narrows by name, type and budget side, and clears', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'rain' } })
    expect(has('Rainy day')).toBe(true)
    expect(has('Everyday')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(has('Everyday')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'Loan' } })
    expect(has('Car loan')).toBe(true)
    expect(has('Everyday')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByLabelText('Filter by side'), { target: { value: 'on' } })
    expect(has('Everyday')).toBe(true)
    expect(has('Car loan')).toBe(false)
  })

  it('says so when nothing matches', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'zzz' } })
    expect(screen.getByText('No accounts match these filters.')).toBeInTheDocument()
  })

  it('offers the types grouped by budget side: on-budget first, each alphabetical', async () => {
    await load()
    const options = [...screen.getByLabelText('Filter by type').querySelectorAll('option')].map((o) => o.textContent).slice(1)
    expect(options).toEqual([...ON_BUDGET_TYPES, ...TRACKING_TYPES])
    for (const group of [ON_BUDGET_TYPES, TRACKING_TYPES]) expect(group).toEqual([...group].sort((a, b) => a.localeCompare(b)))
  })

  it('works with storage blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    await load()
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'car' } })
    expect(has('Car loan')).toBe(true)
    expect(has('Everyday')).toBe(false)
  })

  it('remembers the filter for the session', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'car' } })
    await waitFor(() => expect(sessionStorage.getItem('accounts.filters')).toContain('car'))
  })

  it('picks the balance-check difference category by typing, not from a drop-down', async () => {
    categories = [category(11, 'Rent'), category(12, 'Groceries')]
    await load()
    fireEvent.click(screen.getAllByRole('button', { name: 'Check balance' })[0])
    const box = await screen.findByLabelText('Category for the difference')
    expect(box.tagName).toBe('INPUT')
    fireEvent.change(box, { target: { value: 'gro' } })
    expect(screen.getByRole('button', { name: 'Groceries' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rent' })).toBeNull()
  })
})

describe('Categories filters', () => {
  const load = async () => {
    categories = [category(1, 'Rent', 'need'), category(2, 'Eating out', 'want'), category(3, 'Phone', 'need'), category(4, 'Misc')]
    goals = [goalRow(1, 'recurring_bill'), goalRow(3, 'target')]
    render(
      <MemoryRouter><Categories pickerDate="2026-10-03" /></MemoryRouter>,
    )
    await screen.findByText('Rent')
  }

  it('narrows by need level and by goal kind, then clears', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Filter by need level'), { target: { value: 'want' } })
    expect(screen.getByText('Eating out')).toBeInTheDocument()
    expect(screen.queryByText('Rent')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByLabelText('Filter by goal'), { target: { value: 'target' } })
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.queryByText('Rent')).toBeNull()

    fireEvent.change(screen.getByLabelText('Filter by goal'), { target: { value: 'none' } })
    expect(screen.getByText('Eating out')).toBeInTheDocument()
    expect(screen.queryByText('Phone')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Phone')).toBeInTheDocument()
  })

  it('combines the name search with a facet', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Filter by need level'), { target: { value: 'need' } })
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'pho' } })
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.queryByText('Rent')).toBeNull()
  })

  it('says so when nothing matches, and works with storage blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    await load()
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'zzz' } })
    expect(screen.getByText('No categories match these filters.')).toBeInTheDocument()
  })

  it('lists need levels in their real order and goal kinds alphabetically', async () => {
    await load()
    const labels = [...screen.getByLabelText('Filter by need level').querySelectorAll('option')].map((o) => o.textContent)
    expect(labels.slice(1, 5)).toEqual(['Need', 'Should', 'Nice to have', 'Want'])
    expect(NEED_LEVELS.map((n) => n.value)).toEqual(['need', 'should', 'nice_to_have', 'want'])
    const kinds = GOAL_KINDS.map((k) => k.label)
    expect(kinds).toEqual([...kinds].sort((a, b) => a.localeCompare(b)))
  })
})

describe('Income filters', () => {
  it('narrows named pays by name and how often, and clears', async () => {
    streams = [stream(1, 'Salary', 'monthly'), { ...stream(2, 'Side gig', 'weeks'), cadence_weeks: 2 }, stream(3, 'Bonus', 'yearly')]
    render(<MemoryRouter><Pay pickerDate="2026-10-03" /></MemoryRouter>)
    await screen.findByText('Salary')

    fireEvent.change(screen.getByLabelText('Filter by how often'), { target: { value: 'yearly' } })
    expect(screen.getByText('Bonus')).toBeInTheDocument()
    expect(screen.queryByText('Salary')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    fireEvent.change(screen.getByLabelText('Search named pays'), { target: { value: 'side' } })
    expect(screen.getByText('Side gig')).toBeInTheDocument()
    expect(screen.queryByText('Bonus')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Salary')).toBeInTheDocument()
  })
})

describe('ChoicePicker', () => {
  const fruit = ['Zoo', 'Apple', 'Mango', 'Banana', 'Cherry', 'Date', 'Fig']
  const items = fruit.map((name, i) => ({ id: i + 1, name }))
  function Harness() {
    const [value, setValue] = useState('')
    return (
      <>
        <ChoicePicker items={items} value={value} onChange={setValue} ariaLabel="Fruit" placeholder="Pick" emptyLabel="None" />
        <output>{value}</output>
      </>
    )
  }

  it('is type-ahead over more than five items, alphabetical, and reports the id', () => {
    render(<Harness />)
    const box = screen.getByLabelText('Fruit')
    fireEvent.focus(box)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['None', 'Apple', 'Banana', 'Cherry', 'Date', 'Fig', 'Mango', 'Zoo'])
    fireEvent.change(box, { target: { value: 'an' } })
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Banana', 'Mango'])
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Mango' }))
    expect(box).toHaveValue('Mango')
    expect(screen.getByRole('status')).toHaveTextContent('3')
  })

  it('clears the id when the text stops matching a name', () => {
    render(<Harness />)
    const box = screen.getByLabelText('Fruit')
    fireEvent.change(box, { target: { value: 'Fig' } })
    expect(screen.getByRole('status')).toHaveTextContent('7')
    fireEvent.change(box, { target: { value: 'Fi' } })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
