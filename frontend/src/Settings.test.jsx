import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

const { latest, downloadLatest } = vi.hoisted(() => ({ latest: vi.fn(), downloadLatest: vi.fn() }))

vi.mock('./api.js', () => ({ api: { backups: { latest, downloadLatest } } }))

beforeEach(() => {
  latest.mockReset()
  downloadLatest.mockReset()
})

describe('Download latest backup', () => {
  it('shows when the last backup was taken, with the button', async () => {
    latest.mockResolvedValue({ name: 'nightly-20261019T030000Z.sql', taken_at: '2026-10-19T03:00:00Z' })
    render(<Settings />)
    expect(await screen.findByText(/Last backup: .*2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download latest backup' })).toBeEnabled()
  })

  it('says so plainly when there is no backup yet, and offers no button', async () => {
    latest.mockResolvedValue({ name: null, taken_at: null })
    render(<Settings />)
    expect(await screen.findByText('No backup yet — the first one is taken at 03:00 UTC.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download latest backup' })).toBeNull()
  })

  it('shows the backend detail when the download fails', async () => {
    latest.mockResolvedValue({ name: 'nightly-20261019T030000Z.sql', taken_at: '2026-10-19T03:00:00Z' })
    downloadLatest.mockRejectedValue(new Error('No backup yet — the first one is taken at 03:00 UTC.'))
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download latest backup' }))
    await waitFor(() => expect(screen.getByText(/No backup yet/)).toBeInTheDocument())
  })
})
