import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Pay from './Pay.jsx'

vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      incomeStreams: { list },
      categories: { list },
      accounts: { list },
      payees: { list },
    },
  }
})

describe('Pay', () => {
  it('offers One-off income beside the named pays', async () => {
    render(
      <MemoryRouter initialEntries={['/pay']}>
        <Pay pickerDate="2026-09-23" />
      </MemoryRouter>
    )
    const link = await screen.findByRole('link', { name: 'One-off income' })
    expect(link).toHaveAttribute('href', '/pay/one-off')
  })
})
