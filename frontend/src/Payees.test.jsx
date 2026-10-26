import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Payees from './Payees.jsx'

const { archivePayee, unarchivePayee } = vi.hoisted(() => ({ archivePayee: vi.fn(), unarchivePayee: vi.fn() }))
let payees = []

vi.mock('./api.js', () => ({
  api: { payees: { list: () => Promise.resolve(payees), archive: archivePayee, unarchive: unarchivePayee } },
}))

describe('Payees rows open a panel (#398)', () => {
  beforeEach(() => {
    archivePayee.mockReset()
    unarchivePayee.mockReset()
    archivePayee.mockResolvedValue({ warnings: [] })
    unarchivePayee.mockResolvedValue({})
  })

  it('shows no control on the row; a tap or Enter opens the panel, which archives', async () => {
    payees = [{ id: 1, name: 'Corner store', archived_on: null }]
    render(<Payees pickerDate="2026-10-03" />)
    const row = (await screen.findByText('Corner store')).closest('li')
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
    expect(row).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(archivePayee).toHaveBeenCalledWith(1, '2026-10-03'))
  })

  it('opens an archived payee on a tap and offers Unarchive', async () => {
    payees = [{ id: 2, name: 'Old shop', archived_on: '2026-09-01' }]
    render(<Payees pickerDate="2026-10-03" />)
    fireEvent.click(await screen.findByText('Old shop'))
    fireEvent.click(await screen.findByRole('button', { name: 'Unarchive' }))
    await waitFor(() => expect(unarchivePayee).toHaveBeenCalledWith(2))
  })
})
