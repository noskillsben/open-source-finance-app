import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Pay from './Pay.jsx'

let streams = []
let transactions = []

vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      incomeStreams: { list: () => Promise.resolve(streams) },
      transactions: { list: () => Promise.resolve(transactions) },
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

  it('offers Re-open instead of Record on a pay already recorded for its next payday', async () => {
    streams = [
      { id: 3, name: 'Salary', cadence: 'monthly', next_payday: '2026-09-25', archived_on: null },
      { id: 4, name: 'Gig', cadence: 'monthly', next_payday: '2026-09-28', archived_on: null },
    ]
    transactions = [{ id: 42, date: '2026-09-25', income_stream_id: 3 }]
    render(
      <MemoryRouter initialEntries={['/pay']}>
        <Pay pickerDate="2026-09-23" />
      </MemoryRouter>
    )
    const salary = (await screen.findByText('Salary')).closest('tr')
    expect(within(salary).getByRole('link', { name: 'Re-open' })).toHaveAttribute('href', '/pay/3/record')
    const gig = screen.getByText('Gig').closest('tr')
    expect(within(gig).getByRole('link', { name: 'Record' })).toBeInTheDocument()
  })
})
