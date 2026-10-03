import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Pay from './Pay.jsx'

let streams = []
const { createStream } = vi.hoisted(() => ({ createStream: vi.fn() }))

vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      incomeStreams: { list: () => Promise.resolve(streams), create: createStream },
      categories: { list: () => Promise.resolve([{ id: 5, name: 'Salary income' }]) },
      accounts: { list: () => Promise.resolve([{ id: 6, name: 'Chequing' }]) },
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
      { id: 3, name: 'Salary', cadence: 'monthly', next_payday: '2026-09-25', next_payday_recorded: true, archived_on: null },
      { id: 4, name: 'Gig', cadence: 'monthly', next_payday: '2026-09-28', next_payday_recorded: false, archived_on: null },
    ]
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

describe('add a named pay', () => {
  it('blocks a second submit while the first is saving', async () => {
    streams = []
    let finish
    createStream.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(
      <MemoryRouter initialEntries={['/pay']}>
        <Pay pickerDate="2026-09-23" />
      </MemoryRouter>
    )
    const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
    type('Name', 'Salary')
    type('How often', 'monthly')
    type('Next payday you know about', '2026-09-30')
    type('Expected net, low', '2000')
    type('Expected net, high', '2000')
    await waitFor(() => expect(screen.getByLabelText('Income category (where this pay lands)')).toBeInTheDocument())
    type('Income category (where this pay lands)', 'Salary income')
    type('Destination account', 'Chequing')
    const button = screen.getByRole('button', { name: 'Add named pay' })
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByLabelText('Name')).toBeDisabled()
    fireEvent.submit(button.closest('form'))
    expect(createStream).toHaveBeenCalledTimes(1)

    finish({})
    await waitFor(() => expect(screen.getByLabelText('Name')).not.toBeDisabled())
    expect(screen.getByRole('button', { name: 'Add named pay' })).not.toBeDisabled()
  })
})
