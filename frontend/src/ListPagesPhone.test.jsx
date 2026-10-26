import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'
import Categories from './Categories.jsx'
import Domains from './Domains.jsx'
import DueDates from './DueDates.jsx'
import Pay from './Pay.jsx'
import Payees from './Payees.jsx'
import Splits from './Splits.jsx'

// #396: every list page is rows on a phone (an li each, never a table), with the detail line under
// the name and amount; on a desktop it is still the table.
const data = vi.hoisted(() => ({
  accounts: [{
    id: 1, name: 'Everyday', type: 'Chequing', on_budget: true, on_budget_floor_cents: 0, archived_on: null, created_on: '2026-01-01',
    balance_cents: 123456, checked_on: null, entries_added_since_check: 0, notes: ['Below its floor'], linked_category_ids: [],
    terms: { credit_limit_cents: 0 },
  }],
  categories: [
    { id: 1, name: 'Food', parent_id: null, archived_on: null, need_level: 'need', domain_id: 1, linked_accounts: [], pool_id: null, absorb_overspending: false },
    { id: 2, name: 'Groceries', parent_id: 1, archived_on: null, need_level: 'need', domain_id: 1, linked_accounts: [], pool_id: null, absorb_overspending: false },
  ],
  domains: [{ id: 1, name: 'Household', archived_on: null }],
  streams: [{ id: 1, name: 'Acme pay', cadence: 'monthly', next_payday: '2026-10-31', next_payday_recorded: false, archived_on: null }],
  goals: [{
    goal: { id: 9, category_id: 2, name: 'Hydro', kind: 'recurring_bill', amount_cents: 10000, cadence: 'monthly', first_due_on: '2026-11-01', archived_on: null },
    balance_cents: 2500, target_cents: 10000, due_date: '2026-11-01', earliest_unpaid_due_on: '2026-11-01',
    bill_status: 'next_due', bill_status_text: 'next due', per_period_text: '$100.00 monthly',
  }],
  payees: [{ id: 1, name: 'Corner store', archived_on: null }],
  splits: [{ id: 5, name: 'Household', description: null, archived_on: null, my_share_percent: '50.0000', members: [] }],
}))

vi.mock('./api.js', () => ({
  api: {
    accounts: { list: () => Promise.resolve(data.accounts) },
    categories: { list: () => Promise.resolve(data.categories) },
    domains: { list: () => Promise.resolve(data.domains) },
    readyToAssign: () => Promise.resolve({ ready_to_assign_cents: 0, overspent_cents: 0, categories: [{ category_id: 2, available_cents: 4500 }] }),
    goals: { list: () => Promise.resolve(data.goals) },
    incomeStreams: { list: () => Promise.resolve(data.streams) },
    payees: { list: () => Promise.resolve(data.payees) },
    splits: { list: () => Promise.resolve(data.splits), balance: () => Promise.resolve({ account_id: 1, balance_cents: 0, touched: false, transactions: [] }) },
    transactions: { list: () => Promise.resolve([]) },
  },
}))

const setWidth = (desktop) => {
  window.matchMedia = (query) => ({ matches: desktop, media: query, addEventListener: () => {}, removeEventListener: () => {} })
}
afterEach(() => {
  cleanup()
  delete window.matchMedia
  sessionStorage.clear()
  localStorage.clear()
})

const pages = [
  ['Accounts', () => <Accounts pickerDate="2026-10-03" />, 'Everyday', ['Chequing', 'Below its floor', '$1,234.56']],
  ['Categories', () => <Categories pickerDate="2026-10-03" />, 'Groceries', ['Household · Need', '$45.00']],
  ['Due dates', () => <DueDates pickerDate="2026-10-03" />, 'Hydro', ['next due', '$100.00 monthly']],
  ['Income', () => <Pay pickerDate="2026-10-03" />, 'Acme pay', ['monthly']],
]

describe('list pages on a phone', () => {
  it.each(pages)('%s is a column of rows with its detail line', async (_name, page, rowName, detail) => {
    setWidth(false)
    render(<MemoryRouter>{page()}</MemoryRouter>)
    const item = (await screen.findAllByText(rowName))[0].closest('li')
    expect(item).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    for (const text of detail) expect(item.closest('ul').textContent).toContain(text)
  })

  it('keeps a goal on its own line under its category', async () => {
    setWidth(false)
    render(<MemoryRouter><Categories pickerDate="2026-10-03" /></MemoryRouter>)
    const rows = (await screen.findAllByText('Hydro')).map((el) => el.closest('li'))
    expect(rows[0]).not.toBeNull()
    expect(rows[0].textContent).not.toContain('Groceries')
  })

  it.each(pages)('%s is still a table on a desktop', async (_name, page, rowName) => {
    setWidth(true)
    render(<MemoryRouter>{page()}</MemoryRouter>)
    await screen.findAllByText(rowName)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it.each([
    ['Payees', () => <Payees pickerDate="2026-10-03" />, 'Corner store'],
    ['Domains', () => <Domains pickerDate="2026-10-03" />, 'Household'],
    ['Split expenses', () => <Splits pickerDate="2026-10-03" />, 'Household'],
  ])('%s is rows, not a table', async (_name, page, rowName) => {
    setWidth(false)
    render(<MemoryRouter>{page()}</MemoryRouter>)
    expect((await screen.findAllByText(rowName))[0].closest('li')).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
