import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

    expect(within(nav).getByRole('link', { name: 'Ledger' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Categories' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Payees' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Domains' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Data check' })).toBeInTheDocument()

    // No placeholder links for unbuilt pages.
    expect(within(nav).queryByText('Pay')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Home')).not.toBeInTheDocument()
  })
})

describe('routing', () => {
  it.each([
    ['/ledger', 2, 'Transactions'],
    ['/categories', 2, 'Categories'],
    ['/accounts', 2, 'Accounts'],
    ['/payees', 2, 'Payees'],
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
