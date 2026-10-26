import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Accounts from './Accounts.jsx'
import Categories from './Categories.jsx'
import ListFilters from './components/ListFilters.jsx'

// #397: on a phone the filter bar is a search box and one Filter button; everything else is in a
// full-screen filter screen over the same state. Desktop is unchanged.
const data = vi.hoisted(() => {
  const acct = (id, name, balance) => ({
    id, name, type: 'Chequing', on_budget: true, on_budget_floor_cents: 0, archived_on: null, created_on: '2026-01-01',
    balance_cents: balance, checked_on: null, entries_added_since_check: 0, notes: [], linked_category_ids: [], terms: { credit_limit_cents: 0 },
  })
  return {
    accounts: [acct(1, 'Alpha', 100), acct(2, 'Bravo', 900)],
    categories: [
      { id: 1, name: 'Food', parent_id: null, archived_on: null, need_level: 'need', domain_id: null, linked_accounts: [], pool_id: null, absorb_overspending: false },
      { id: 2, name: 'Groceries', parent_id: 1, archived_on: null, need_level: 'need', domain_id: null, linked_accounts: [], pool_id: null, absorb_overspending: false },
    ],
  }
})

vi.mock('./api.js', () => ({
  api: {
    accounts: { list: () => Promise.resolve(data.accounts) },
    categories: { list: () => Promise.resolve(data.categories) },
    domains: { list: () => Promise.resolve([]) },
    payees: { list: () => Promise.resolve([]) },
    goals: { list: () => Promise.resolve([]) },
    incomeStreams: { list: () => Promise.resolve([]) },
    readyToAssign: () => Promise.resolve({ ready_to_assign_cents: 0, overspent_cents: 0, categories: [] }),
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

function Harness() {
  const [search, setSearch] = useState('')
  const [need, setNeed] = useState('')
  const [mine, setMine] = useState(false)
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const clear = () => {
    setSearch('')
    setNeed('')
    setMine(false)
    setSort({ key: 'name', dir: 'asc' })
  }
  return (
    <>
      <ListFilters
        noun="things"
        search={search}
        onSearch={setSearch}
        facets={[{ name: 'need', label: 'Need level', value: need, onChange: setNeed, options: [{ value: 'need', label: 'Need' }] }]}
        checks={[{ name: 'mine', label: 'Mine', checked: mine, onChange: setMine }]}
        sort={sort}
        onSort={toggle}
        sortOptions={[{ key: 'name', label: 'Name' }, { key: 'amount', label: 'Amount' }]}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
        active={need !== ''}
        onClear={clear}
      />
      <output data-testid="sort">{sort.key}:{sort.dir}</output>
    </>
  )
}

describe('the filter screen on a phone', () => {
  it('shows only search and a Filter button, counting filters set but not search or sort', () => {
    setWidth(false)
    render(<Harness />)
    expect(screen.getByLabelText('Search things')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter by need level')).toBeNull()
    expect(screen.queryByText('Expand all')).toBeNull()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search things'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByLabelText('Descending'))
    fireEvent.change(screen.getByLabelText('Filter by need level'), { target: { value: 'need' } })
    fireEvent.click(screen.getByLabelText('Mine'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Filter · 2' })).toBeInTheDocument()
  })

  it('opens full screen with every control, and closes with x or Done', () => {
    setWidth(false)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const screenEl = screen.getByRole('dialog', { name: 'Filter' })
    expect(within(screenEl).getByLabelText('Filter by need level')).toBeInTheDocument()
    expect(within(screenEl).getByLabelText('Mine')).toBeInTheDocument()
    expect(within(screenEl).getByLabelText('Name')).toBeChecked()
    expect(within(screenEl).getByLabelText('Ascending')).toBeChecked()
    expect(within(screenEl).getByText('Expand all')).toBeInTheDocument()
    expect(within(screenEl).getByText('Collapse all')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close filters' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('chooses the sort column and direction, and Clear puts filters and default order back', () => {
    setWidth(false)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByLabelText('Amount'))
    expect(screen.getByTestId('sort')).toHaveTextContent('amount:asc')
    fireEvent.click(screen.getByLabelText('Descending'))
    expect(screen.getByTestId('sort')).toHaveTextContent('amount:desc')
    fireEvent.change(screen.getByLabelText('Filter by need level'), { target: { value: 'need' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('sort')).toHaveTextContent('name:asc')
    expect(screen.getByLabelText('Filter by need level')).toHaveValue('')
    expect(screen.getByLabelText('Name')).toBeChecked()
  })

  it('leaves the desktop bar as it was', () => {
    setWidth(true)
    render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
    expect(screen.getByLabelText('Filter by need level')).toBeInTheDocument()
    expect(screen.getByText('Expand all')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter by need level'), { target: { value: 'need' } })
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })
})

describe('the filter screen on the pages', () => {
  it('Accounts: the sort choice reorders the list', async () => {
    setWidth(false)
    render(<MemoryRouter><Accounts pickerDate="2026-10-03" /></MemoryRouter>)
    await screen.findAllByText('Alpha')
    const order = () =>
      screen.getAllByRole('listitem').map((li) => li.textContent).filter((t) => /Alpha|Bravo/.test(t)).map((t) => (t.includes('Alpha') ? 'Alpha' : 'Bravo'))
    expect(order()).toEqual(['Alpha', 'Bravo'])
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByLabelText('Descending'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(order()).toEqual(['Bravo', 'Alpha'])
  })

  it('Categories: Collapse all and Expand all are inside the screen', async () => {
    setWidth(false)
    render(<MemoryRouter><Categories pickerDate="2026-10-03" /></MemoryRouter>)
    await screen.findAllByText('Groceries')
    expect(screen.queryByText('Collapse all')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByText('Collapse all'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Groceries')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByText('Expand all'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0)
  })
})
