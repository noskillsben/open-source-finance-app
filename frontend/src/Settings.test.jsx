import { render, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { formatDateTime } from './utils/format.js'

const { latest, list, restore, downloadLatest, takeNow, exportDownload, upload } = vi.hoisted(() => ({
  upload: vi.fn(), latest: vi.fn(), list: vi.fn(), restore: vi.fn(), downloadLatest: vi.fn(), takeNow: vi.fn(), exportDownload: vi.fn(),
}))

vi.mock('./api.js', () => ({ api: { backups: { latest, list, restore, downloadLatest, takeNow, upload }, exportData: { download: exportDownload } } }))

beforeEach(() => {
  latest.mockReset()
  list.mockReset()
  list.mockResolvedValue([])
  restore.mockReset()
  downloadLatest.mockReset()
  takeNow.mockReset()
  upload.mockReset()
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

describe('Restore', () => {
  const files = [
    { name: 'pre-restore-20261022T100000Z.sql', taken_at: '2026-10-22T10:00:00Z' },
    { name: 'nightly-20261019T030000Z.sql', taken_at: '2026-10-19T03:00:00Z' },
  ]
  beforeEach(() => {
    latest.mockResolvedValue({ name: 'nightly-20261019T030000Z.sql', taken_at: '2026-10-19T03:00:00Z' })
    list.mockResolvedValue(files)
  })

  it('lists every backup with its date and a Restore button', async () => {
    render(<Settings />)
    expect(await screen.findAllByRole('button', { name: 'Restore' })).toHaveLength(2)
    expect(screen.getByText('pre-restore-20261022T100000Z.sql')).toBeInTheDocument()
  })

  it('asks once, naming the date, with Replace my data and Cancel', async () => {
    render(<Settings />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Restore' }))[1])
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(formatDateTime(files[1].taken_at))
    expect(dialog).toHaveTextContent(/Everything you have recorded since then is replaced/)
    expect(dialog).toHaveTextContent(/backup of your current data is taken first/)
    expect(screen.getByRole('button', { name: 'Replace my data' })).toBeEnabled()
    expect(restore).not.toHaveBeenCalled()
  })

  it('opens the confirmation inside the list item of the file pressed', async () => {
    list.mockResolvedValue([
      ...files,
      { name: 'nightly-20261018T030000Z.sql', taken_at: '2026-10-18T03:00:00Z' },
    ])
    render(<Settings />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Restore' }))[0])
    const item = screen.getByText('pre-restore-20261022T100000Z.sql').closest('li')
    expect(within(item).getByRole('alertdialog')).toBeInTheDocument()
    const other = screen.getByText('nightly-20261018T030000Z.sql').closest('li')
    expect(within(other).queryByRole('alertdialog')).toBeNull()
  })

  it('does nothing on Cancel', async () => {
    render(<Settings />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Restore' }))[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(restore).not.toHaveBeenCalled()
  })

  it('reads Restoring… with the page disabled, then reloads on success', async () => {
    let resolve
    restore.mockReturnValue(new Promise((r) => { resolve = r }))
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
    render(<Settings />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Restore' }))[1])
    fireEvent.click(screen.getByRole('button', { name: 'Replace my data' }))
    const busy = await screen.findByRole('button', { name: 'Restoring…' })
    expect(busy).toBeDisabled()
    for (const name of ['Back up now', 'Download latest backup', 'Export data', 'Cancel']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    screen.getAllByRole('button', { name: 'Restore' }).forEach((b) => expect(b).toBeDisabled())
    expect(restore).toHaveBeenCalledWith('nightly-20261019T030000Z.sql')
    resolve({ restored: 'x', undo: 'y' })
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('shows the message and re-enables the page when the restore fails', async () => {
    restore.mockRejectedValue(new Error('Refusing: x holds a newer schema'))
    render(<Settings />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Restore' }))[0])
    fireEvent.click(screen.getByRole('button', { name: 'Replace my data' }))
    expect(await screen.findByText('Refusing: x holds a newer schema')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Restore' })[0]).toBeEnabled()
  })
})

describe('Add a backup file', () => {
  const file = new File(['-- dump'], 'mine.sql', { type: 'application/sql' })
  beforeEach(() => {
    latest.mockResolvedValue({ name: 'nightly-20261019T030000Z.sql', taken_at: '2026-10-19T03:00:00Z' })
  })

  it('uploads the picked file, reads Adding… meanwhile, then refreshes the list', async () => {
    let resolve
    upload.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<Settings />)
    await screen.findByRole('button', { name: 'Add a backup file' })
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } })
    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeDisabled()
    expect(upload).toHaveBeenCalledWith(file)
    list.mockResolvedValue([{ name: 'uploaded-20261024T120000Z.sql', taken_at: '2026-10-24T12:00:00Z' }])
    resolve({ name: 'uploaded-20261024T120000Z.sql', taken_at: '2026-10-24T12:00:00Z' })
    expect(await screen.findByText('uploaded-20261024T120000Z.sql')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a backup file' })).toBeEnabled()
  })

  it('shows the backend message when the file is refused', async () => {
    upload.mockRejectedValue(new Error('That file was not added: it looks cut short.'))
    render(<Settings />)
    await screen.findByRole('button', { name: 'Add a backup file' })
    fireEvent.change(screen.getByLabelText('Backup file'), { target: { files: [file] } })
    expect(await screen.findByText('That file was not added: it looks cut short.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a backup file' })).toBeEnabled()
  })
})
