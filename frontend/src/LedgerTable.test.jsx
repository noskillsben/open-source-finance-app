import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
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
