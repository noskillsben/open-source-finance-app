import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Domains from './Domains.jsx'

const { createDomain } = vi.hoisted(() => ({ createDomain: vi.fn() }))

vi.mock('./api.js', () => ({
  api: { domains: { list: () => Promise.resolve([]), create: createDomain } },
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
