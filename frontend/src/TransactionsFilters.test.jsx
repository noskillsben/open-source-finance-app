import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LedgerTable from './LedgerTable.jsx'
import Transactions from './Transactions.jsx'

// #352: filter and search Transactions by account, category, payee, domain and need level.
let transactions = []

vi.mock('./api.js', () => ({
  api: {
    accounts: {
      list: (_a, all) =>
        Promise.resolve([
          { id: 1, name: 'Chequing', linked_category_ids: [], on_budget: true },
          { id: 2, name: 'Visa', linked_category_ids: [], on_budget: true },
          ...(all ? [{ id: 3, name: 'Old card', archived_on: '2026-01-01', linked_category_ids: [], on_budget: true }] : []),
        ]),
    },
    splits: { list: () => Promise.resolve([]) },
    categories: {
      list: () =>
        Promise.resolve([
          { id: 10, name: 'Food', domain_id: 100, need_level: 'need', parent_id: null },
          { id: 11, name: 'Snacks', domain_id: 101, need_level: 'want', parent_id: 10 },
          { id: 12, name: 'Rent', domain_id: 100, need_level: null, parent_id: null },
        ]),
    },
    payees: {
      list: (_a, all) =>
        Promise.resolve([
          { id: 1, name: 'Corner Shop' },
          { id: 2, name: 'Landlord' },
          ...(all ? [{ id: 3, name: 'Gone Co', archived_on: '2026-01-01' }] : []),
        ]),
    },
    transactions: { list: () => Promise.resolve(transactions) },
    goals: { list: () => Promise.resolve([]) },
    domains: { list: () => Promise.resolve([{ id: 100, name: 'Home' }, { id: 101, name: 'Fun' }]) },
  },
}))

const tx = (id, date, memo, payee_id, accountLines, categoryLines = []) => ({
  id, date, memo, payee_id, income_stream_id: null, goal_id: null, goal_due_on: null, split_id: null,
  account_lines: accountLines.map(([account_id, cents], i) => ({ id: id * 10 + i, account_id, cents })),
  category_lines: categoryLines.map(([category_id, cents], i) => ({ id: id * 10 + 5 + i, category_id, cents })),
})

beforeEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
  transactions = [
    tx(1, '2026-10-02', 'Weekly shop', 1, [[1, -1000]], [[10, -1000]]),
    tx(2, '2026-10-03', 'Chocolate', 1, [[2, -200]], [[11, -200]]),
    tx(3, '2026-10-04', 'October rent', 2, [[1, -5000]], [[12, -5000]]),
    tx(4, '2026-09-10', 'Pay card', null, [[1, -300], [2, 300]]),
    tx(5, '2026-08-01', 'Old thing', 3, [[3, -100]], [[10, -100]]),
  ]
})

async function load() {
  render(<MemoryRouter><Transactions pickerDate="2026-10-23" /></MemoryRouter>)
  await screen.findByText('Weekly shop')
}
const rows = () => [...screen.getByRole('table').querySelectorAll('tbody tr')].map((r) => r.textContent).join('|')
const pick = (label, text, option = text) => {
  const box = screen.getByLabelText(`Filter by ${label}`)
  fireEvent.focus(box)
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: option }))
}
const clear = () => fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

describe('Transactions filters', () => {
  it('Account keeps transactions with a line on it, and shows only that account lines and total', async () => {
    await load()
    pick('account', 'Chequing')
    expect(rows()).toContain('Weekly shop')
    expect(rows()).not.toContain('Chocolate')
    expect(rows()).toContain('Pay card')
    const sep = screen.getByRole('button', { name: 'September 2026' }).closest('tr')
    expect(within(sep).getByText('−$3.00')).toBeTruthy()
    const row = screen.getByText('Pay card').closest('tr')
    expect(row.textContent).not.toContain('Visa')
    expect(row.textContent).toContain('Chequing: −$3.00')
  })

  it('Category is exact: a child transaction is not matched by its parent', async () => {
    await load()
    pick('category', 'Food')
    expect(rows()).toContain('Weekly shop')
    expect(rows()).not.toContain('Chocolate')
  })

  it('Payee, Domain and Need level narrow', async () => {
    await load()
    pick('payee', 'Land', 'Landlord')
    expect(rows()).toContain('October rent')
    expect(rows()).not.toContain('Weekly shop')
    clear()
    pick('domain', 'Fun')
    expect(rows()).toContain('Chocolate')
    expect(rows()).not.toContain('Weekly shop')
    clear()
    fireEvent.change(screen.getByLabelText('Filter by need level'), { target: { value: 'need' } })
    expect(rows()).toContain('Weekly shop')
    expect(rows()).not.toContain('Chocolate')
  })

  it('search matches memo or payee name, case-insensitively', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'CHOCO' } })
    expect(rows()).toContain('Chocolate')
    expect(rows()).not.toContain('Weekly shop')
    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'landlord' } })
    expect(rows()).toContain('October rent')
    expect(rows()).not.toContain('Chocolate')
  })

  it('opens a collapsed month holding a match while filtered, and collapses it again after Clear', async () => {
    localStorage.setItem('transactions.collapsed', JSON.stringify(['2026-09']))
    await load()
    expect(rows()).not.toContain('Pay card')
    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'pay card' } })
    expect(rows()).toContain('Pay card')
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull()
    clear()
    expect(rows()).not.toContain('Pay card')
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeTruthy()
  })

  it('hides months with no match and shows the empty state, which clears', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'chocolate' } })
    expect(screen.queryByRole('button', { name: 'September 2026' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Search transactions'), { target: { value: 'zzz' } })
    expect(screen.getByText('No transactions match these filters.')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[1])
    expect(rows()).toContain('Weekly shop')
  })

  it('Clear resets the filters and the sort', async () => {
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Date' }))
    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'ascending')
    clear()
    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('offers archived entities marked "(archived)"', async () => {
    await load()
    fireEvent.focus(screen.getByLabelText('Filter by account'))
    fireEvent.click(await screen.findByRole('button', { name: 'Old card (archived)' }))
    expect(rows()).toContain('Old thing')
  })

  it('an empty ledger keeps its own empty state', async () => {
    transactions = []
    render(<MemoryRouter><Transactions pickerDate="2026-10-23" /></MemoryRouter>)
    expect(await screen.findByText('No transactions yet.')).toBeTruthy()
  })
})

describe('LedgerTable without filters', () => {
  it('shows every account line', () => {
    const t = tx(1, '2026-10-02', 'Move', null, [[1, -300], [2, 300]])
    render(
      <MemoryRouter>
        <LedgerTable transactions={[t]} names={{ accounts: [{ id: 1, name: 'Chequing' }, { id: 2, name: 'Visa' }] }} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Chequing:/)).toBeTruthy()
    expect(screen.getByText(/Visa:/)).toBeTruthy()
  })
})
