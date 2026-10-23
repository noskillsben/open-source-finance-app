import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Pay from './Pay.jsx'

let streams = []
const { createStream, updateStream } = vi.hoisted(() => ({ createStream: vi.fn(), updateStream: vi.fn() }))

vi.mock('./api.js', () => {
  const list = () => Promise.resolve([])
  return {
    api: {
      incomeStreams: { list: () => Promise.resolve(streams), create: createStream, update: updateStream },
      categories: { list: () => Promise.resolve([{ id: 5, name: 'Salary income' }]) },
      accounts: { list: () => Promise.resolve([{ id: 6, name: 'Chequing' }]) },
      payees: { list },
    },
  }
})

describe('Pay', () => {
  it('offers One-off income beside the named pays', async () => {
    render(
      <MemoryRouter initialEntries={['/income']}>
        <Pay pickerDate="2026-09-23" />
      </MemoryRouter>
    )
    const link = await screen.findByRole('link', { name: 'One-off income' })
    expect(link).toHaveAttribute('href', '/income/one-off')
  })

  it('offers Re-open instead of Record on a pay already recorded for its next payday', async () => {
    streams = [
      { id: 3, name: 'Salary', cadence: 'monthly', next_payday: '2026-09-25', next_payday_recorded: true, archived_on: null },
      { id: 4, name: 'Gig', cadence: 'monthly', next_payday: '2026-09-28', next_payday_recorded: false, archived_on: null },
    ]
    render(
      <MemoryRouter initialEntries={['/income']}>
        <Pay pickerDate="2026-09-23" />
      </MemoryRouter>
    )
    const salary = (await screen.findByText('Salary')).closest('tr')
    expect(within(salary).getByRole('link', { name: 'Re-open' })).toHaveAttribute('href', '/income/3/record')
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
      <MemoryRouter initialEntries={['/income']}>
        <Pay pickerDate="2026-09-23" />
      </MemoryRouter>
    )
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add a named pay' }))[0])
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
    // #321: a successful add closes the panel.
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
  })
})

describe('Recorded and the highlight (#343)', () => {
  const full = (id, name) => ({
    id, name, payee_id: null, cadence: 'monthly', cadence_weeks: null, anchor_payday: '2026-09-30', next_payday: '2026-09-30',
    next_payday_recorded: false, archived_on: null, expected_gross_cents: null, expected_net_low_cents: 200000,
    expected_net_high_cents: 200000, income_category_id: 5, destination_account_id: 6, deductions: [],
  })

  it('an add says Recorded and highlights the new row; an edit highlights with no note; opening a form clears both', async () => {
    streams = [full(3, 'Salary'), full(4, 'Gig')]
    createStream.mockResolvedValue({ id: 4 })
    updateStream.mockResolvedValue({ id: 3 })
    const rowOf = (name) => screen.getByText(name).closest('tr')
    render(
      <MemoryRouter initialEntries={['/income']}>
        <Pay pickerDate="2026-09-23" />
      </MemoryRouter>
    )
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add a named pay' }))[0])
    const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
    type('Name', 'Gig')
    type('How often', 'monthly')
    type('Next payday you know about', '2026-09-30')
    type('Expected net, low', '2000')
    type('Expected net, high', '2000')
    await waitFor(() => expect(screen.getByLabelText('Income category (where this pay lands)')).toBeInTheDocument())
    type('Income category (where this pay lands)', 'Salary income')
    type('Destination account', 'Chequing')
    fireEvent.click(screen.getByRole('button', { name: 'Add named pay' }))

    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
    expect(screen.getByText('Recorded.')).toBeInTheDocument()
    expect(rowOf('Gig')).toHaveClass('bg-raised')
    expect(rowOf('Salary')).not.toHaveClass('bg-raised')

    fireEvent.click(within(rowOf('Salary')).getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText('Recorded.')).toBeNull()
    expect(rowOf('Gig')).not.toHaveClass('bg-raised')
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
    expect(screen.queryByText('Recorded.')).toBeNull()
    expect(rowOf('Salary')).toHaveClass('bg-raised')

    fireEvent.click(screen.getAllByRole('button', { name: 'Add a named pay' })[0])
    expect(rowOf('Salary')).not.toHaveClass('bg-raised')
  })
})
