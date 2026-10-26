import Button from '../components/Button.jsx'
import { RefusalNote, SaveNote, WarningNote } from '../components/Notes.jsx'
import { formatDate } from '../utils/format.js'

// Archive an account on a date, in the side panel.
export default function ArchiveForm({ archive, closePanel }) {
  const { archiveDate, setArchiveDate, archiveError, archiveWarnings, archiveDone, submitArchive } = archive

  return (
    <form className="space-y-4" onSubmit={submitArchive}>
      <label className="block space-y-1">
        <span className="field-label">Archive on</span>
        <input
          type="date"
          className="w-full field"
          value={archiveDate}
          disabled={archiveDone}
          onChange={(e) => setArchiveDate(e.target.value)}
        />
      </label>
      {archiveError && <RefusalNote>{archiveError}</RefusalNote>}
      {archiveDone && (
        <>
          <SaveNote>Archived on {formatDate(archiveDate)}.</SaveNote>
          {archiveWarnings.map((w) => (
            <WarningNote key={w}>{w}</WarningNote>
          ))}
        </>
      )}
      <div className="flex gap-3">
        {!archiveDone && <Button type="submit">Archive</Button>}
        <Button variant="secondary" onClick={closePanel}>Close</Button>
      </div>
    </form>
  )
}
