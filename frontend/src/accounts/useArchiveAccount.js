import { useState } from 'react'
import { api } from '../api.js'

// Archiving an account on a date, and unarchiving one from its row. Warnings never block.
export function useArchiveAccount({ pickerDate, refresh }) {
  const [archivingId, setArchivingId] = useState(null)
  const [archiveDate, setArchiveDate] = useState(pickerDate)
  const [archiveError, setArchiveError] = useState(null)
  const [archiveWarnings, setArchiveWarnings] = useState([])
  const [archiveDone, setArchiveDone] = useState(false)
  const [rowError, setRowError] = useState(null)

  function resetArchive() {
    setArchivingId(null)
    setArchiveError(null)
    setArchiveWarnings([])
    setArchiveDone(false)
  }

  // Warnings never block: the archive has already happened by the time they are shown.
  async function submitArchive(e) {
    e.preventDefault()
    setArchiveError(null)
    if (!archiveDate) return setArchiveError('Date is required.')
    try {
      const result = await api.accounts.archive(archivingId, archiveDate)
      setArchiveWarnings(result.warnings)
      setArchiveDone(true)
      refresh()
    } catch (err) {
      setArchiveError(err.message)
    }
  }

  async function unarchiveAccount(e, account) {
    e.stopPropagation()
    setRowError(null)
    try {
      await api.accounts.unarchive(account.id)
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  function beginArchive(account) {
    setArchivingId(account.id)
    setArchiveDate(pickerDate)
    setArchiveError(null)
    setArchiveWarnings([])
    setArchiveDone(false)
  }

  return {
    archivingId, archiveDate, setArchiveDate, archiveError, archiveWarnings, archiveDone, rowError,
    resetArchive, submitArchive, unarchiveAccount, beginArchive,
  }
}
