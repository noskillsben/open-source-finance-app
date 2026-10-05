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
    expect(screen.getByText(/Chequing: -\$50\.00/)).toBeInTheDocument()
    expect(screen.getByText(/Old card \(archived\): \$25\.00/)).toBeInTheDocument()
    expect(screen.getByText(/Groceries: -\$25\.00/)).toBeInTheDocument()
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
})
