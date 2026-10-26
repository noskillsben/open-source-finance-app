import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LedgerTable from './LedgerTable.jsx'

const NAMES = {
  accounts: [{ id: 1, name: 'Chequing' }, { id: 2, name: 'Old card', archived_on: '2026-01-01' }],
  categories: [{ id: 10, name: 'Groceries' }],
  payees: [{ id: 4, name: 'Corner shop' }],
  goals: [{ goal: { id: 7, name: 'Rent' } }],
  splits: [{ id: 5, name: 'Household' }],
}
const T = {
  id: 1, date: '2026-10-01', memo: 'Weekly shop', payee_id: 4, income_stream_id: null, goal_id: 7, goal_due_on: '2026-10-01', split_id: 5,
  account_lines: [{ id: 1, account_id: 1, cents: -5000 }, { id: 2, account_id: 2, cents: 2500 }],
  category_lines: [{ id: 3, category_id: 10, cents: -2500 }],
}

function table(onSelect) {
  return render(<MemoryRouter><LedgerTable transactions={[T]} names={NAMES} onSelect={onSelect} /></MemoryRouter>)
}

describe('LedgerTable when names fail or are pending', () => {
  const render1 = (names) => render(<MemoryRouter><LedgerTable transactions={[T]} names={names} /></MemoryRouter>)

  it('reads in plain words, with no id and no placeholder, when the lists failed to load', () => {
    const { container } = render1({ failed: { accounts: true, categories: true, payees: true, goals: true, splits: true } })
    expect(screen.getByText('Split: a split')).toBeInTheDocument()
    expect(screen.getByText(/pays a bill, due/)).toBeInTheDocument()
    expect(screen.getByText('a payee')).toBeInTheDocument()
    expect(screen.getAllByText(/an account:/)).toHaveLength(2)
    expect(screen.getByText(/a category:/)).toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).toBeNull()
    expect(container.textContent).not.toMatch(/#\d/)
  })

  it('shows a placeholder for the split and bill while they are still pending', () => {
    const { container } = render1({})
    expect(container.querySelectorAll('[aria-busy]')).toHaveLength(2)
  })
})

describe('LedgerTable', () => {
  it('names every part of a row, marks archived entities, and notes the split and the bill', () => {
    table()
    expect(screen.getByText('Weekly shop')).toBeInTheDocument()
    expect(screen.getByText('Corner shop')).toBeInTheDocument()
    expect(screen.getByText(/Chequing:/)).toBeInTheDocument()
    expect(screen.getByText(/Old card \(archived\):/)).toBeInTheDocument()
    expect(screen.getByText(/Groceries:/)).toBeInTheDocument()
    // A negative amount prints a true minus and is the only thing coloured; a positive one is plain.
    const negatives = screen.getAllByText('−$50.00')
    expect(negatives[0]).toHaveClass('text-negative')
    expect(screen.getAllByText('$25.00')[0]).not.toHaveClass('text-negative')
    expect(screen.getByText('Split: Household')).toBeInTheDocument()
    expect(screen.getByText('pays Rent, due Oct 1, 2026')).toBeInTheDocument()
  })

  it('selects a row when given onSelect, and is read-only without it', () => {
    const onSelect = vi.fn()
    const { unmount } = table(onSelect)
    fireEvent.click(screen.getByText('Weekly shop'))
    expect(onSelect).toHaveBeenCalledWith(T)
    unmount()

    table()
    expect(screen.getByText('Weekly shop').closest('tr')).not.toHaveClass('cursor-pointer')
  })
  describe('category column with no category lines', () => {
    const bare = (id, lines) => ({
      id, date: '2026-10-01', memo: `m${id}`, payee_id: null, income_stream_id: null, goal_id: null, goal_due_on: null, split_id: null,
      account_lines: lines.map(([cents, budget_cents], i) => ({ id: id * 10 + i, account_id: 1, cents, budget_cents })),
      category_lines: [],
    })
    const label = (lines) => {
      const { unmount } = render(<MemoryRouter><LedgerTable transactions={[bare(1, lines)]} names={NAMES} /></MemoryRouter>)
      const cell = screen.getByText('m1').closest('tr').querySelectorAll('td')[4]
      const text = cell.textContent
      unmount()
      return text
    }

    it('shows a dash when the budget movement is 0 (card payment, tracking opening adjustment)', () => {
      expect(label([[-300, 0], [300, 0]])).toBe('—')
      expect(label([[-1500000, 0], [0, 0]])).toBe('—')
    })

    it('keeps "unassigned" when the budget movement is not 0 (credit draw, cash gift)', () => {
      expect(label([[0, 0], [2000, 2000]])).toBe('unassigned')
      expect(label([[5000, 5000]])).toBe('unassigned')
    })
  })
})

function setWidth(desktop) {
  window.matchMedia = (query) => ({
    matches: desktop, media: query, addEventListener: () => {}, removeEventListener: () => {},
  })
}

describe('LedgerTable adjustments and the phone list', () => {
  const adj = (id, valuation_id, accountId = 1) => ({
    id, date: '2026-10-0' + id, memo: null, payee_id: null, valuation_id, income_stream_id: null, goal_id: null, goal_due_on: null, split_id: null,
    account_lines: [{ id: id * 10, account_id: accountId, cents: 1000, budget_cents: 1000 }],
    category_lines: [],
  })
  const ledger = [adj(1, 11), adj(2, 12)]
  const renderLedger = (list = ledger) => render(<MemoryRouter><LedgerTable transactions={list} allTransactions={list} names={NAMES} /></MemoryRouter>)

  afterEach(() => { delete window.matchMedia })

  it('labels the earliest valuation Opening balance and a later one Balance check on a desktop', () => {
    setWidth(true)
    renderLedger()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Opening balance')).toBeInTheDocument()
    expect(screen.getByText('Balance check')).toBeInTheDocument()
  })

  it('reads a later check alone as Balance check when the opening is only in the full ledger', () => {
    setWidth(true)
    render(<MemoryRouter><LedgerTable transactions={[ledger[1]]} allTransactions={ledger} names={NAMES} /></MemoryRouter>)
    expect(screen.getByText('Balance check')).toBeInTheDocument()
    expect(screen.queryByText('Opening balance')).toBeNull()
  })

  it('never labels from a partial list: without the whole ledger an adjustment is a Balance adjustment', () => {
    setWidth(true)
    render(<MemoryRouter><LedgerTable transactions={[ledger[1]]} names={NAMES} /></MemoryRouter>)
    expect(screen.getByText('Balance adjustment')).toBeInTheDocument()
    expect(screen.queryByText('Opening balance')).toBeNull()
  })

  it('takes the earlier valuation date as the opening even with a higher id', () => {
    setWidth(true)
    renderLedger([{ ...adj(1, 20), date: '2026-09-01' }, adj(2, 12)])
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Opening balance')
  })

  it('draws no table on a phone: payee and date first, account lines, then category names', () => {
    setWidth(false)
    const { container } = render(<MemoryRouter><LedgerTable transactions={[T]} names={NAMES} /></MemoryRouter>)
    expect(container.querySelector('table')).toBeNull()
    const row = screen.getByText('Corner shop').closest('li')
    expect(row.firstChild.textContent).toBe('Corner shopOct 1, 2026')
    expect(row).toHaveTextContent('Weekly shop')
    expect(row).toHaveTextContent('Chequing−$50.00')
    expect(row).toHaveTextContent('Old card (archived)$25.00')
    expect(row).toHaveTextContent('Groceries')
    expect(screen.getAllByText('−$50.00')[0]).toHaveClass('whitespace-nowrap')
  })

  it('reads the adjustment labels on a phone too, and falls back to the memo before them', () => {
    setWidth(false)
    renderLedger([...ledger, { ...adj(3, null), memo: 'Cash' }])
    expect(screen.getByText('Opening balance')).toBeInTheDocument()
    expect(screen.getByText('Balance check')).toBeInTheDocument()
    expect(screen.getByText('Cash')).toBeInTheDocument()
  })

  it('keeps month headers on a phone, collapsible with the total', () => {
    setWidth(false)
    const onToggle = vi.fn()
    const byMonth = { sort: { key: 'date', dir: 'desc' }, onSort: () => {}, collapsed: [], onToggle }
    render(<MemoryRouter><LedgerTable transactions={[T]} names={NAMES} byMonth={byMonth} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'October 2026' }))
    expect(onToggle).toHaveBeenCalledWith('2026-10')
    expect(screen.getByText('−$25.00')).toBeInTheDocument()
  })
})
