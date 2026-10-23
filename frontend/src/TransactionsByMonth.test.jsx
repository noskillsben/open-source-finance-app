import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LedgerTable from './LedgerTable.jsx'
import Transactions from './Transactions.jsx'

// #347: Transactions grouped by calendar month, newest first, each month collapsible with its total.
let transactions = []

vi.mock('./api.js', () => ({
  api: {
    accounts: { list: () => Promise.resolve([{ id: 1, name: 'Chequing', linked_category_ids: [], on_budget: true }]) },
    splits: { list: () => Promise.resolve([]) },
    domains: { list: () => Promise.resolve([]) },
    categories: { list: () => Promise.resolve([]) },
    payees: { list: () => Promise.resolve([{ id: 1, name: 'Zed' }, { id: 2, name: 'Amy' }]) },
    transactions: { list: () => Promise.resolve(transactions) },
    goals: { list: () => Promise.resolve([]) },
  },
}))

const tx = (id, date, memo, cents, payee_id = null) => ({
  id, date, memo, payee_id, income_stream_id: null, goal_id: null, goal_due_on: null, split_id: null,
  account_lines: [{ id: id * 10, account_id: 1, cents }],
  category_lines: [],
})

beforeEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
  transactions = [
    tx(1, '2025-12-30', 'dec-old', 1000, 1),
    tx(2, '2026-10-02', 'oct-a', -500, 1),
    tx(3, '2026-10-20', 'oct-b', -700, 2),
    tx(4, '2026-10-20', 'oct-c', 100),
    tx(5, '2026-01-05', 'jan', 4000, 2),
  ]
})

async function load() {
  render(<MemoryRouter><Transactions pickerDate="2026-10-23" /></MemoryRouter>)
  await screen.findByText('oct-a')
}

const heads = () => [...screen.getByRole('table').querySelectorAll('tbody button[aria-expanded]')].map((b) => b.textContent)
const memos = () => [...screen.getByRole('table').querySelectorAll('tbody tr')].map((r) => r.textContent).join('|')
const order = (names) => {
  const text = memos()
  return names.slice().sort((a, b) => text.indexOf(a) - text.indexOf(b))
}
const monthRow = (name) => screen.getByRole('button', { name }).closest('tr')

describe('Transactions by month', () => {
  it('groups by month across years, newest month first, newest first inside, with the arrow shown', async () => {
    await load()
    expect(heads()).toEqual(['October 2026', 'January 2026', 'December 2025'])
    expect(order(['oct-a', 'oct-b', 'oct-c'])).toEqual(['oct-c', 'oct-b', 'oct-a'])
    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('shows each month total, negative in colour with its minus', async () => {
    await load()
    expect(within(monthRow('October 2026')).getByText('−$11.00')).toHaveClass('text-negative')
    expect(within(monthRow('January 2026')).getByText('$40.00')).not.toHaveClass('text-negative')
    expect(within(monthRow('December 2025')).getByText('$10.00')).toBeTruthy()
  })

  it('Date and Payee sorts reorder inside a month, never across', async () => {
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Date' }))
    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'ascending')
    expect(order(['oct-a', 'oct-b', 'oct-c'])).toEqual(['oct-a', 'oct-b', 'oct-c'])
    expect(heads()).toEqual(['October 2026', 'January 2026', 'December 2025'])
    fireEvent.click(screen.getByRole('button', { name: 'Payee' }))
    // Amy, Zed, then no payee last.
    expect(order(['oct-a', 'oct-b', 'oct-c'])).toEqual(['oct-b', 'oct-a', 'oct-c'])
    fireEvent.click(screen.getByRole('button', { name: 'Payee' }))
    expect(order(['oct-a', 'oct-b', 'oct-c'])).toEqual(['oct-a', 'oct-b', 'oct-c'])
    expect(heads()).toEqual(['October 2026', 'January 2026', 'December 2025'])
  })

  it('Memo, Account lines and Category lines are not sortable', async () => {
    await load()
    for (const name of ['Memo', 'Account lines', 'Category lines']) {
      expect(screen.getByRole('columnheader', { name })).not.toHaveAttribute('aria-sort')
    }
  })

  it('collapsing hides a month, survives a remount, and Expand all / Collapse all work', async () => {
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'October 2026' }))
    expect(screen.queryByText('oct-a')).toBeNull()
    expect(screen.getByText('jan')).toBeTruthy()
    cleanup()
    await (async () => {
      render(<MemoryRouter><Transactions pickerDate="2026-10-23" /></MemoryRouter>)
      await screen.findByText('jan')
    })()
    expect(screen.queryByText('oct-a')).toBeNull()
    expect(screen.getByRole('button', { name: 'October 2026' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('jan')).toBeNull()
    expect(screen.queryByText('dec-old')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    await waitFor(() => expect(screen.getByText('oct-a')).toBeTruthy())
    expect(screen.getByText('dec-old')).toBeTruthy()
  })

  it('the Splits LedgerTable stays flat', () => {
    render(<MemoryRouter><LedgerTable transactions={transactions} names={{}} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Date' })).toBeNull()
    expect(screen.queryByRole('button', { name: /2026/ })).toBeNull()
    expect(screen.getAllByRole('row')).toHaveLength(6)
  })
})
