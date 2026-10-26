import ChoicePicker from '../components/ChoicePicker.jsx'
import MoneyInput from '../components/MoneyInput.jsx'
import { formatCents, formatDate } from '../utils/format.js'
import { emptyDeposit } from './formShape.js'

// "This pays Rent, due Oct 1": the bill a payment is linked to, confirmed, re-dated or left unlinked.
export function BillLinkNote({ billLink, setBillLink, setDeclinedBills, offeredBill, offeredGoalId, offeredDue, dueOptions, dueOptionValues, goals, goalsFailed }) {
  return (
    <div className="rounded-lg bg-raised p-3 space-y-2 text-sm">
      <p>
        {billLink ? 'Marked as paying ' : 'This pays '}
        {offeredBill ? (
          <strong>{offeredBill.goal.name}</strong>
        ) : goals === null && !goalsFailed ? (
          <span aria-busy="true" className="inline-block h-4 w-28 animate-pulse rounded bg-raised align-middle" />
        ) : (
          <strong>this bill</strong>
        )}
        , due{' '}
        {offeredDue ? formatDate(offeredDue) : '…'}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {!billLink && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!offeredDue}
            onClick={() => setBillLink({ goal_id: offeredGoalId, goal_due_on: offeredDue })}
          >
            Confirm
          </button>
        )}
        <select
          className="field"
          aria-label="Which due date"
          value={offeredDue}
          onChange={(e) => setBillLink({ goal_id: offeredGoalId, goal_due_on: e.target.value })}
        >
          {offeredDue && !dueOptionValues.includes(offeredDue) && (
            <option value={offeredDue}>{formatDate(offeredDue)}</option>
          )}
          {dueOptions.map((d) => (
            <option key={d.due_on} value={d.due_on}>
              {formatDate(d.due_on)}
              {d.paid ? ' · already paid' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            if (billLink) setBillLink(null)
            setDeclinedBills((ids) => [...ids, offeredGoalId])
          }}
        >
          {billLink ? 'Remove link' : 'Leave unlinked'}
        </button>
      </div>
    </div>
  )
}

// Which envelopes a move into or out of a linked account funds.
export function EnvelopeRows({ linkedNet, deposits, setDeposits, depositsTouched, updateDeposit, envelopes, categories, depositTotal }) {
  return (
    <div className="space-y-2">
      <span className="field-label">
        {linkedNet > 0 ? 'Which envelope does this fund?' : 'Which envelope does this money leave?'}{' '}
        <span className="text-text-2">Leave empty if it is already earmarked.</span>
      </span>
      {deposits.map((row, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-32">
            <ChoicePicker
              items={envelopes}
              value={row.category_id}
              onChange={(id) => updateDeposit(i, 'category_id', id)}
              placeholder="Select envelope…"
              ariaLabel="Envelope"
            />
          </div>
          <MoneyInput aria-label="Amount" value={row.cents} onChange={(text) => updateDeposit(i, 'cents', text)} />
          <div className="flex-1 min-w-32">
            <ChoicePicker
              items={(categories ?? []).filter((c) => String(c.id) !== row.category_id)}
              value={row.other_category_id}
              onChange={(id) => updateDeposit(i, 'other_category_id', id)}
              placeholder={linkedNet > 0 ? 'From ready to assign' : 'To ready to assign'}
              ariaLabel={linkedNet > 0 ? 'Taken from' : 'Goes to'}
              emptyLabel={linkedNet > 0 ? 'From ready to assign' : 'To ready to assign'}
            />
          </div>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              depositsTouched.current = true
              setDeposits((rows) => rows.filter((_, idx) => idx !== i))
            }}
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          depositsTouched.current = true
          setDeposits((rows) => [...rows, { ...emptyDeposit }])
        }}
      >
        + add envelope
      </button>
      {deposits.length > 0 && (
        <p className="text-sm text-text-2">
          {formatCents(depositTotal)} of {formatCents(Math.abs(linkedNet))} directed.
        </p>
      )}
    </div>
  )
}

// Delete is confirmed in place of window.confirm (DESIGN.md § Earmarks).
export function DeleteConfirm({ deleteConfirm, setDeleteConfirm, confirmDelete }) {
  return (
    <div className="space-y-2 rounded-lg bg-raised p-3">
      <p>Delete this transaction? This cannot be undone.</p>
      {deleteConfirm.hasBatchLines && (
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={deleteConfirm.removeBatch}
            onChange={(e) =>
              setDeleteConfirm((c) => ({ ...c, removeBatch: e.target.checked }))
            }
          />
          Also remove the money moves this pay assigned
        </label>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-destructive"
          onClick={confirmDelete}
        >
          Confirm delete
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setDeleteConfirm(null)}
        >
          Never mind
        </button>
      </div>
    </div>
  )
}
