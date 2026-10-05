import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayIso } from './utils/format.js'
import App from './App.jsx'

// Every page fetches on mount; stub every api call so routing/render tests never hit the network.
vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      health: () => Promise.resolve({ status: 'ok' }),
      accounts: { list },
      categories: { list },
      goals: { list },
      readyToAssign: () => Promise.resolve({ ready_to_assign_cents: 0, overspent_cents: 0, categories: [] }),
      domains: { list },
      payees: { list },
      splits: { list },
      incomeStreams: { list },
      transactions: { list },
      integrityCheck: { list },
    },
  }
})

function renderAt(path) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('nav menu', () => {
  it('renders the four tempo groups plus Settings, in order, with only built pages', () => {
    renderAt('/ledger')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const headings = within(nav).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Record', 'Assign', 'Plan', 'Review', 'Settings'])

    expect(within(nav).getByRole('link', { name: 'Pay' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Ledger' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Categories' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Payees' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Splits' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Domains' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Data check' })).toBeInTheDocument()

    // No placeholder link for the still-unbuilt Home page.
    expect(within(nav).queryByText('Home')).not.toBeInTheDocument()
  })
})

describe('routing', () => {
  it.each([
    ['/pay', 2, 'Pay'],
    ['/ledger', 2, 'Transactions'],
    ['/categories', 2, 'Categories'],
    ['/accounts', 2, 'Accounts'],
    ['/payees', 2, 'Payees'],
    ['/splits', 2, 'Splits'],
    ['/domains', 3, 'Domains'],
    ['/settings/data-check', 2, 'Integrity check'],
  ])('mounts the right page at %s', async (path, level, expectedHeading) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level, name: expectedHeading })).toBeInTheDocument()
  })

  it('redirects the root path to the ledger', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 2, name: 'Transactions' })).toBeInTheDocument()
  })
})

describe('Show as of date', () => {
  const input = () => screen.getByLabelText('Show as of')

  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('starts on today in a fresh session, with no "not today" cue', () => {
    renderAt('/ledger')
    expect(input()).toHaveValue(todayIso())
    expect(screen.queryByText('not today')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('keeps a picked date across a remount', () => {
    const first = renderAt('/ledger')
    fireEvent.change(input(), { target: { value: '2026-03-15' } })
    first.unmount()
    renderAt('/ledger')
    expect(input()).toHaveValue('2026-03-15')
  })

  it('ignores an invalid stored value', () => {
    window.sessionStorage.setItem('pickerDate', '2026-13-45')
    renderAt('/ledger')
    expect(input()).toHaveValue(todayIso())
  })

  it('falls back to today when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderAt('/ledger')
    expect(input()).toHaveValue(todayIso())
    fireEvent.change(input(), { target: { value: '2026-03-15' } })
    expect(input()).toHaveValue('2026-03-15')
  })

  it('shows the cue off today, and Today resets the date', () => {
    renderAt('/ledger')
    fireEvent.change(input(), { target: { value: '2026-03-15' } })
    expect(screen.getByText('not today')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(input()).toHaveValue(todayIso())
    expect(screen.queryByText('not today')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem('pickerDate')).toBeNull()
  })

  it('treats a cleared input as today and stores nothing', () => {
    renderAt('/ledger')
    fireEvent.change(input(), { target: { value: '2026-03-15' } })
    fireEvent.change(input(), { target: { value: '' } })
    expect(input()).toHaveValue(todayIso())
    expect(window.sessionStorage.getItem('pickerDate')).toBeNull()
  })
})
