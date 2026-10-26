import Button from '../components/Button.jsx'
import { VALUE_TYPES } from './accountForm.js'

// What an account's panel offers besides its form (DESIGN.md § Row actions): Check balance / Update
// value and Undo check as ordinary controls, Archive at the foot in quiet negative. The write paths
// are the existing ones; rows carry no controls of their own.
export default function AccountPanelActions({ account, startCheck, undoCheck, startArchive, unarchiveAccount }) {
  const canUndo = account.checked_on && !account.checked_is_opening && account.checked_valuation_id != null
  return (
    <div className="mt-6 space-y-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => startCheck(account)}>
          {VALUE_TYPES.includes(account.type) ? 'Update value' : 'Check balance'}
        </Button>
        {canUndo && <Button variant="quiet" onClick={() => undoCheck(account)}>Undo check</Button>}
      </div>
      {account.archived_on ? (
        <Button variant="destructive" onClick={() => unarchiveAccount(account)}>Unarchive</Button>
      ) : (
        <Button variant="destructive" onClick={() => startArchive(account)}>Archive</Button>
      )}
    </div>
  )
}
