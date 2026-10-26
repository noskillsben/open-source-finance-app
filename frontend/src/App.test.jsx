import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayIso } from './utils/format.js'
import App from './App.jsx'
import { titleFor } from './Nav.jsx'

// Every page fetches on mount; stub every api call so routing/render tests never hit the network.
vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      health: () => globalThis.__healthPromise ?? Promise.resolve({ status: 'ok' }),
      accounts: { list },
      categories: { list },
      goals: { list },
      readyToAssign: () => Promise.resolve({ ready_to_assign_cents: 0, overspent_cents: 0, categories: [] }),
      domains: { list },
      payees: { list, recent: list },
      splits: { list },
      incomeStreams: { list },
      transactions: { list },
      integrityCheck: { list },
      backups: { list: () => Promise.resolve([]), latest: () => Promise.resolve({ name: null, taken_at: null }) },
    },
  }
})

// The shell mounts only once health answers, so wait for the nav before a test looks at the page.
async function renderAt(path) {
  window.history.pushState({}, '', path)
  const result = render(<App />)
  await screen.findByRole('navigation', { name: 'Main' })
  return result
}

describe('nav menu', () => {
  it('renders the four tempo groups plus Settings, in order, with only built pages', async () => {
    await renderAt('/transactions')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const headings = within(nav).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Record', 'Assign', 'Plan', 'Review', 'Settings', 'Help'])

    expect(within(nav).getByRole('link', { name: 'Income' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Transactions' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Quick add' })).toHaveAttribute('href', '/quick-add')
    expect(within(nav).getByRole('link', { name: 'Categories' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Payees' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Due dates' })).toHaveAttribute('href', '/due-dates')
    expect(within(nav).getByRole('link', { name: 'Split expenses' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Domains' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Data check' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help')

    // No placeholder link for the still-unbuilt Home page.
    expect(within(nav).queryByText('Home')).not.toBeInTheDocument()
  })
})

describe('routing', () => {
  it.each([
    ['/income', 2, 'Income'],
    ['/transactions', 2, 'Transactions'],
    ['/categories', 2, 'Categories'],
    ['/accounts', 2, 'Accounts'],
    ['/payees', 2, 'Payees'],
    ['/split-expenses', 2, 'Split expenses'],
    ['/domains', 2, 'Domains'],
    ['/settings/data-check', 2, 'Data check'],
  ])('mounts the right page at %s', async (path, level, expectedHeading) => {
    await renderAt(path)
    expect(await screen.findByRole('heading', { level, name: expectedHeading })).toBeInTheDocument()
  })

  it('mounts Settings at /settings (its name is also the menu section header)', async () => {
    await renderAt('/settings')
    expect(await screen.findAllByRole('heading', { level: 2, name: 'Settings' })).toHaveLength(2)
  })

  it('redirects the root path to Transactions', async () => {
    await renderAt('/')
    expect(await screen.findByRole('heading', { level: 2, name: 'Transactions' })).toBeInTheDocument()
  })
})

describe('Show as of date', () => {
  const input = () => screen.getByLabelText('Show as of')

  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('starts on today in a fresh session, with no "not today" cue', async () => {
    await renderAt('/transactions')
    expect(input()).toHaveValue(todayIso())
    expect(screen.queryByText('not today')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('keeps a picked date across a remount', async () => {
    const first = await renderAt('/transactions')
    fireEvent.change(input(), { target: { value: '2026-03-15' } })
    first.unmount()
    await renderAt('/transactions')
    expect(input()).toHaveValue('2026-03-15')
  })

  it('ignores an invalid stored value', async () => {
    window.sessionStorage.setItem('pickerDate', '2026-13-45')
    await renderAt('/transactions')
    expect(input()).toHaveValue(todayIso())
  })

  it('falls back to today when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    await renderAt('/transactions')
    expect(input()).toHaveValue(todayIso())
    fireEvent.change(input(), { target: { value: '2026-03-15' } })
    expect(input()).toHaveValue('2026-03-15')
  })

  it('shows the cue off today, and Today resets the date', async () => {
    await renderAt('/transactions')
    fireEvent.change(input(), { target: { value: '2026-03-15' } })
    expect(screen.getByText('not today')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(input()).toHaveValue(todayIso())
    expect(screen.queryByText('not today')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem('pickerDate')).toBeNull()
  })

  it('treats a cleared input as today and stores nothing', async () => {
    await renderAt('/transactions')
    fireEvent.change(input(), { target: { value: '2026-03-15' } })
    fireEvent.change(input(), { target: { value: '' } })
    expect(input()).toHaveValue(todayIso())
    expect(window.sessionStorage.getItem('pickerDate')).toBeNull()
  })
})

describe("the phone's bottom bar", () => {
  it('opens Quick add from the +', async () => {
    await renderAt('/transactions')
    const bar = screen.getByRole('navigation', { name: 'Bottom bar' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Quick add' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Quick add' })).toBeInTheDocument()
  })

  it('has a live Due dates tab, marked current on that page', async () => {
    await renderAt('/due-dates')
    const bar = screen.getByRole('navigation', { name: 'Bottom bar' })
    const tab = within(bar).getByRole('link', { name: 'Due dates' })
    expect(tab).toHaveAttribute('href', '/due-dates')
    expect(tab).toHaveAttribute('aria-current', 'page')
    expect(within(bar).getByRole('link', { name: 'Categories' })).not.toHaveAttribute('aria-current')
  })
})

describe('+ Add transaction', () => {
  it('opens the form as a page of its own and hides the phone bottom bar while it is shown', async () => {
    await renderAt('/transactions')
    expect(screen.getByRole('navigation', { name: 'Bottom bar' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '+ Add transaction' }))
    expect(await screen.findByLabelText('Date')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Bottom bar' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))
    expect(await screen.findByRole('navigation', { name: 'Bottom bar' })).toBeInTheDocument()
  })
})

describe('held start', () => {
  afterEach(() => { delete globalThis.__healthPromise })

  it('mounts no nav before health resolves, then shows only the Backups section when held', async () => {
    let resolveHealth
    globalThis.__healthPromise = new Promise((resolve) => { resolveHealth = resolve })
    window.history.pushState({}, '', '/transactions')
    render(<App />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Add transaction' })).toBeNull()

    resolveHealth({ status: 'ok', held: true, latest_backup: 'nightly-20261019T030000Z.sql' })
    expect(await screen.findByText(/This database is empty but backups exist\. Restore one to carry on\./)).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Backup' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export data' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Add transaction' })).toBeNull()
  })
})

describe('help', () => {
  it('shows the user guide at /help', async () => {
    await renderAt('/help')
    const guide = screen.getByRole('article', { name: 'User guide' })
    expect(within(guide).getByRole('heading', { name: /Using the app/ })).toBeInTheDocument()
    expect(within(guide).getByRole('heading', { name: 'Getting started' })).toBeInTheDocument()
    expect(within(guide).getByText(/Run/)).toBeInTheDocument()
    expect(within(guide).getAllByRole('listitem').length).toBeGreaterThan(5)
  })

  it('titles the page Help', () => {
    expect(titleFor('/help')).toBe('Help')
  })
})
