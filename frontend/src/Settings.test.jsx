import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

const { latest, downloadLatest, takeNow, exportDownload } = vi.hoisted(() => ({
  latest: vi.fn(), downloadLatest: vi.fn(), takeNow: vi.fn(), exportDownload: vi.fn(),
}))

vi.mock('./api.js', () => ({ api: { backups: { latest, downloadLatest, takeNow }, exportData: { download: exportDownload } } }))

beforeEach(() => {
  latest.mockReset()
  downloadLatest.mockReset()
  takeNow.mockReset()
  exportDownload.mockReset()
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

describe('Export data', () => {
  it('is offered even when there is no backup yet, and fetches the export', async () => {
    latest.mockResolvedValue({ name: null, taken_at: null })
    exportDownload.mockResolvedValue({ blob: new Blob(['zip']), filename: 'export-20261023.zip' })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Export data' }))
    await waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1))
  })

  async function savedName(response) {
    latest.mockResolvedValue({ name: null, taken_at: null })
    exportDownload.mockResolvedValue(response)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    let name
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { name = this.download })
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Export data' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()
    return name
  }

  it('saves the export under the name the backend gave it', async () => {
    expect(await savedName({ blob: new Blob(['zip']), filename: 'export-20261023.zip' })).toBe('export-20261023.zip')
  })

  it('falls back to export.zip when the response has no name', async () => {
    expect(await savedName({ blob: new Blob(['zip']), filename: null })).toBe('export.zip')
  })

  it('shows the backend detail when the export fails', async () => {
    latest.mockResolvedValue({ name: null, taken_at: null })
    exportDownload.mockRejectedValue(new Error('Export failed'))
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Export data' }))
    await waitFor(() => expect(screen.getByText('Export failed')).toBeInTheDocument())
  })
})

describe('Back up now', () => {
  it('is offered in the no-backup state and updates Last backup on success', async () => {
    latest.mockResolvedValue({ name: null, taken_at: null })
    let resolve
    takeNow.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }))
    const busy = await screen.findByRole('button', { name: 'Taking backup…' })
    expect(busy).toBeDisabled()
    resolve({ name: 'nightly-20261023T120000Z.sql', taken_at: '2026-10-23T12:00:00Z' })
    expect(await screen.findByText(/Last backup: .*2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download latest backup' })).toBeInTheDocument()
  })

  it('shows the error detail when it fails', async () => {
    latest.mockResolvedValue({ name: 'nightly-20261019T030000Z.sql', taken_at: '2026-10-19T03:00:00Z' })
    takeNow.mockRejectedValue(new Error('A backup is already being taken'))
    render(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }))
    expect(await screen.findByText('A backup is already being taken')).toBeInTheDocument()
  })
})
