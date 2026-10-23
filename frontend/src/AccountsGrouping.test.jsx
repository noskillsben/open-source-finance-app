import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'

// #346: Accounts group by budget side or by type, archived last, each group collapsible with its total.
let accounts = []
let archivedAccounts = []

vi.mock('./api.js', () => ({
  api: {
    accounts: { list: (asOf, showArchived) => Promise.resolve(showArchived ? [...accounts, ...archivedAccounts] : accounts) },
    categories: { list: () => Promise.resolve([]) },
    payees: { list: () => Promise.resolve([{ id: 7, name: 'Starbucks' }]) },
  },
}))

const account = (id, name, type, on_budget, balance_cents = 0, extra = {}) => ({
  id, name, type, on_budget, on_budget_floor_cents: 0, archived_on: null, created_on: '2026-01-01',
  balance_cents, checked_on: null, entries_added_since_check: 0, notes: [], linked_category_ids: [],
  terms: { credit_limit_cents: 0 }, ...extra,
})

const headings = () => [...screen.getByRole('table').querySelectorAll('tbody button[aria-expanded]')].map((b) => b.textContent)
const order = (names) => {
  const text = screen.getByRole('table').querySelector('tbody').textContent
  return names.slice().sort((a, b) => text.indexOf(a) - text.indexOf(b))
}
const group = (name) => screen.getByRole('button', { name })
const groupRow = (name) => group(name).closest('tr')
const names = ['Everyday', 'Rainy day', 'Car loan', 'Brokerage']

async function load() {
  render(<Accounts pickerDate="2026-10-03" />)
  await screen.findByText('Everyday')
}

beforeEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
  accounts = [
    account(1, 'Everyday', 'Chequing', true, 500),
    account(2, 'Rainy day', 'Savings', true, 7000),
    account(3, 'Car loan', 'Loan', false, -9000),
    account(4, 'Brokerage', 'Investment', false, 20000),
  ]
  archivedAccounts = [account(5, 'Old card', 'Credit card', true, 0, { archived_on: '2026-02-01' })]
})

describe('Accounts grouping', () => {
  it('groups by budget side by default: On-budget, then Tracking, hiding the Side column', async () => {
    await load()
    expect(headings()).toEqual(['On-budget', 'Tracking'])
    expect(order(names)).toEqual(['Everyday', 'Rainy day', 'Brokerage', 'Car loan'])
    expect(screen.queryByRole('columnheader', { name: 'Side' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeTruthy()
  })

  it('switches to Type in the type list order and back, hiding the Type column instead', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'type' } })
    expect(headings()).toEqual(['Chequing', 'Savings', 'Investment', 'Loan'])
    expect(screen.queryByRole('columnheader', { name: 'Type' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Side' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'side' } })
    expect(headings()).toEqual(['On-budget', 'Tracking'])
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeTruthy()
  })

  it('puts an unknown type last among the type groups', async () => {
    accounts.push(account(6, 'Mystery', 'Strange', true, 1))
    await load()
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'type' } })
    expect(headings().at(-1)).toBe('Unknown type')
  })

  it('shows the Archived group last, only with Show archived, whatever the grouping', async () => {
    await load()
    expect(headings()).not.toContain('Archived')
    fireEvent.click(screen.getByLabelText('Show archived'))
    await screen.findByText('Old card')
    expect(headings().at(-1)).toBe('Archived')
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'type' } })
    expect(headings().at(-1)).toBe('Archived')
    expect(headings()).not.toContain('Credit card')
  })

  it('shows each group total in the Balance column', async () => {
    await load()
    expect(within(groupRow('On-budget')).getByText('$75.00')).toBeTruthy()
    expect(within(groupRow('Tracking')).getByText('$110.00')).toBeTruthy()
  })

  it('collapses a group, remembers it per device, and Expand all / Collapse all work', async () => {
    const first = render(<Accounts pickerDate="2026-10-03" />)
    await screen.findByText('Everyday')
    fireEvent.click(group('On-budget'))
    expect(screen.queryByText('Everyday')).toBeNull()
    expect(group('On-budget')).toHaveAttribute('aria-expanded', 'false')
    expect(within(groupRow('On-budget')).getByText('$75.00')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('accounts.collapsed'))).toEqual(['side:on'])

    first.unmount()
    render(<Accounts pickerDate="2026-10-03" />)
    await screen.findByText('Car loan')
    expect(screen.queryByText('Everyday')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('Everyday')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('Everyday')).toBeNull()
    expect(screen.queryByText('Car loan')).toBeNull()
  })

  it('remembers the Group by choice, and Clear filters puts it back to Budget side', async () => {
    const first = render(<Accounts pickerDate="2026-10-03" />)
    await screen.findByText('Everyday')
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'type' } })
    first.unmount()
    render(<Accounts pickerDate="2026-10-03" />)
    await screen.findByText('Everyday')
    expect(screen.getByLabelText('Group by').value).toBe('type')

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByLabelText('Group by').value).toBe('side')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('a search opens a collapsed group holding a match', async () => {
    localStorage.setItem('accounts.collapsed', JSON.stringify(['side:on', 'side:off']))
    render(<Accounts pickerDate="2026-10-03" />)
    await screen.findByText('On-budget')
    expect(screen.queryByText('Everyday')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'every' } })
    expect(screen.getByText('Everyday')).toBeTruthy()
    expect(headings()).toEqual(['On-budget'])
  })

  it('falls back to Name A to Z when the saved sort is on the column the grouping hides', async () => {
    sessionStorage.setItem('accounts.filters.sort', JSON.stringify({ key: 'side', dir: 'desc' }))
    await load()
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending'))
  })

  it('sorts inside each group and never across', async () => {
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Balance' }))
    fireEvent.click(screen.getByRole('button', { name: 'Balance' }))
    expect(order(names)).toEqual(['Rainy day', 'Everyday', 'Brokerage', 'Car loan'])
  })

  it('keeps accounts sharing a locked payee together inside their group, one cluster per group', async () => {
    accounts = [
      account(1, 'Zed card', 'Gift card / store credit', true, 1500, { locked_payee_id: 7 }),
      account(2, 'Alpha', 'Chequing', true, 100),
      account(3, 'Starbucks app', 'Gift card / store credit', true, 2000, { locked_payee_id: 7 }),
      account(4, 'Starbucks loan', 'Loan', false, 300, { locked_payee_id: 7 }),
    ]
    render(<Accounts pickerDate="2026-10-03" />)
    await screen.findByText('Alpha')
    expect(screen.getAllByText('Locked to Starbucks')).toHaveLength(2) // one cluster per group
    const onBudget = order(['Alpha', 'Starbucks app', 'Zed card'])
    expect(onBudget).toEqual(['Alpha', 'Starbucks app', 'Zed card'])
    expect(within(groupRow('On-budget')).getByText('$36.00')).toBeTruthy() // totals count each group's own
    expect(within(groupRow('Tracking')).getByText('$3.00')).toBeTruthy()
  })
})
