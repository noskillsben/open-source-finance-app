import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PayeePicker from './PayeePicker.jsx'

describe('PayeePicker add', () => {
  it('adds a new payee once when Enter is pressed twice quickly', async () => {
    const onAdd = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ id: 7, name: 'Corner Store' }), 20)))
    const onSelect = vi.fn()
    const onError = vi.fn()
    render(<PayeePicker payees={[]} payeeId={null} onSelect={onSelect} onAdd={onAdd} onError={onError} />)

    const box = screen.getByPlaceholderText('Search payees…')
    fireEvent.change(box, { target: { value: 'Corner Store' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'Enter' })

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(7))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('releases the guard after a failed add so a retry works', async () => {
    const onAdd = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 8, name: 'Kiosk' })
    const onSelect = vi.fn()
    const onError = vi.fn()
    render(<PayeePicker payees={[]} payeeId={null} onSelect={onSelect} onAdd={onAdd} onError={onError} />)

    const box = screen.getByPlaceholderText('Search payees…')
    fireEvent.change(box, { target: { value: 'Kiosk' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(onError).toHaveBeenCalledWith('boom'))
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(8))
    expect(onAdd).toHaveBeenCalledTimes(2)
  })
})
