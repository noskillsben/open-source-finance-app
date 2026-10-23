import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Domains from './Domains.jsx'

const { createDomain, updateDomain, rows } = vi.hoisted(() => ({ createDomain: vi.fn(), updateDomain: vi.fn(), rows: { list: [] } }))

vi.mock('./api.js', () => ({
  api: { domains: { list: () => Promise.resolve(rows.list), create: createDomain, update: updateDomain } },
}))

describe('add a domain', () => {
  it('blocks a second submit while the first is saving', async () => {
    let finish
    createDomain.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<Domains pickerDate="2026-10-03" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add a domain' }))[0])
    fireEvent.change(await screen.findByLabelText('Domain name'), { target: { value: 'Food' } })
    const button = screen.getByRole('button', { name: 'Add domain' })
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByLabelText('Domain name')).toBeDisabled()
    fireEvent.submit(button.closest('form'))
    expect(createDomain).toHaveBeenCalledTimes(1)

    finish({})
    // #321: a successful add closes the panel.
    await waitFor(() => expect(screen.queryByLabelText('Domain name')).toBeNull())
  })

  it('Cancel closes the add panel, with no Done button', async () => {
    render(<Domains pickerDate="2026-10-03" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add a domain' }))[0])
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Domain name')).toBeNull()
  })
})

describe('Recorded and the highlight (#343)', () => {
  const rowOf = (name) => screen.getByText(name).closest('li')

  it('an add says Recorded and highlights the new row; an edit highlights with no note; opening a form clears both', async () => {
    rows.list = [{ id: 1, name: 'Food', description: null, archived_on: null }, { id: 2, name: 'Travel', description: null, archived_on: null }]
    createDomain.mockResolvedValue({ id: 2 })
    updateDomain.mockResolvedValue({ id: 1 })
    render(<Domains pickerDate="2026-10-03" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add a domain' }))[0])
    fireEvent.change(await screen.findByLabelText('Domain name'), { target: { value: 'Travel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }))

    await waitFor(() => expect(screen.queryByLabelText('Domain name')).toBeNull())
    expect(screen.getByText('Recorded.')).toBeInTheDocument()
    await waitFor(() => expect(rowOf('Travel')).toHaveClass('bg-raised'))
    expect(rowOf('Food')).not.toHaveClass('bg-raised')

    fireEvent.click(within(rowOf('Food')).getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText('Recorded.')).toBeNull()
    expect(rowOf('Travel')).not.toHaveClass('bg-raised')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByLabelText('Rename Food')).toBeNull())
    expect(screen.queryByText('Recorded.')).toBeNull()
    expect(rowOf('Food')).toHaveClass('bg-raised')

    fireEvent.click((screen.getAllByRole('button', { name: 'Add a domain' }))[0])
    expect(rowOf('Food')).not.toHaveClass('bg-raised')
  })
})
