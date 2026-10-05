import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Splits from './Splits.jsx'
import { formatPercent, parsePercent } from './utils/format.js'

const { createSplit } = vi.hoisted(() => ({ createSplit: vi.fn() }))

vi.mock('./api.js', () => ({
  api: {
    splits: { list: () => Promise.resolve([]), create: createSplit },
    payees: { list: () => Promise.resolve([{ id: 7, name: 'Sam' }, { id: 8, name: 'Kit' }]), create: vi.fn() },
    accounts: { list: () => Promise.resolve([]) },
  },
}))

async function addMember(payeeName, percent, index) {
  fireEvent.click(screen.getByRole('button', { name: '+ Add a person' }))
  const picker = (await screen.findAllByPlaceholderText('Search payees…'))[index]
  fireEvent.focus(picker)
  fireEvent.change(picker, { target: { value: payeeName } })
  fireEvent.keyDown(picker, { key: 'Enter' })
  fireEvent.change(screen.getAllByLabelText('Percent')[index], { target: { value: percent } })
}

describe('percent parsing', () => {
  it('rounds half-even at four places, like the backend', () => {
    expect(parsePercent('50')).toBe(500000)
    expect(parsePercent('33.3333')).toBe(333333)
    expect(parsePercent('50.00005')).toBe(500000) // exactly half, even neighbour
    expect(parsePercent('50.00015')).toBe(500002)
    expect(parsePercent('12.34567')).toBe(123457)
    expect(parsePercent('40%')).toBe(400000)
    expect(parsePercent('')).toBeNull()
    expect(parsePercent('abc')).toBeNull()
    expect(formatPercent(500000)).toBe('50%')
  })
})

describe('the Splits page', () => {
  beforeEach(() => {
    createSplit.mockReset()
  })

  it('shows your share update as percentages are typed, and warns past 100%', async () => {
    render(<Splits pickerDate="2026-10-05" />)
    expect(await screen.findByText('Your share: 100%')).toBeInTheDocument()

    await addMember('Sam', '30', 0)
    expect(await screen.findByText('Your share: 70%')).toBeInTheDocument()

    await addMember('Kit', '80', 1)
    expect(await screen.findByText(/add up to 110%, more than 100%/)).toBeInTheDocument()
  })

  it('shows the backend refusal detail when a save is refused', async () => {
    createSplit.mockRejectedValue(new Error('The members add up to 110%, which is more than 100%.'))
    render(<Splits pickerDate="2026-10-05" />)
    fireEvent.change(await screen.findByLabelText('Split name'), { target: { value: 'Rent' } })
    await addMember('Sam', '50', 0)
    fireEvent.click(screen.getByRole('button', { name: 'Add split' }))

    expect(await screen.findByText('The members add up to 110%, which is more than 100%.')).toBeInTheDocument()
    expect(createSplit).toHaveBeenCalledWith({
      name: 'Rent', description: null, created_on: '2026-10-05',
      members: [{ payee_id: 7, account_id: null, percent: '50' }],
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add split' })).not.toBeDisabled())
  })
})
