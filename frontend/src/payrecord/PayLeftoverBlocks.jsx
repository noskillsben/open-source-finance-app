import Button from '../components/Button.jsx'
import MoneyInput from '../components/MoneyInput.jsx'
import { RefusalNote } from '../components/Notes.jsx'
import { centsToFieldText, formatCents, formatDate } from '../utils/format.js'

// Blocks 9, 10 and 11: every other category, what covers a shortfall, and what is left over.

export function EverythingElse({ pay }) {
  const { isOneOff, data, amounts, totals } = pay
  const { goalsLoaded } = data
  const { archivedRows, everythingElse, setEverythingElse } = amounts
  const { everythingElseList, lastPeriodActuals, goalByCategoryId, categoriesAllById } = totals

  return (
    <fieldset className="card space-y-2">
      <legend className="px-1 text-section">Everything else</legend>
      {goalsLoaded && everythingElseList.length === 0 && archivedRows.length === 0 && (
        <p className="text-sm text-text-2">No other categories.</p>
      )}
      {everythingElseList.map((c) => (
        <div key={c.id} className="flex items-end gap-2">
          <div className="flex-1 text-sm">
            <span>{c.name}</span>
            {lastPeriodActuals[c.id] > 0 && (
              <span className="text-text-2">
                {' '}· {isOneOff ? 'last month' : 'last period'} {formatCents(lastPeriodActuals[c.id])}
              </span>
            )}
            {goalByCategoryId.has(c.id) && (
              <span className="text-text-2">
                {' '}· {goalByCategoryId.get(c.id).goal.name}
                {goalByCategoryId.get(c.id).due_date && <> · due {formatDate(goalByCategoryId.get(c.id).due_date)}</>}
              </span>
            )}
          </div>
          <MoneyInput className="w-28" placeholder={lastPeriodActuals[c.id] > 0 ? centsToFieldText(lastPeriodActuals[c.id]) : ''} value={everythingElse[c.id] ?? ''} onChange={(text) => setEverythingElse({ ...everythingElse, [c.id]: text })} />
        </div>
      ))}
      {archivedRows.map((r) => (
        <div key={r.categoryId} className="flex items-end gap-2 text-sm">
          <div className="flex-1">
            <span>{categoriesAllById.get(r.categoryId)?.name ?? `#${r.categoryId}`} (archived)</span>
          </div>
          <span className="w-28 px-2 py-1 text-text-2">{formatCents(r.cents)}</span>
        </div>
      ))}
    </fieldset>
  )
}

export function ShortBy({ pay }) {
  const { amounts, totals, coverFrom } = pay
  const { shortCovers, setShortCovers } = amounts
  const { coverRows, categoriesById, leftover, shortByRows } = totals

  return (
    <fieldset className="card space-y-2">
      <legend className="px-1 text-section">Short by</legend>
      {coverRows.map((r) => (
        <div key={r.categoryId} className="flex items-end gap-2 text-sm">
          <div className="flex-1">
            <span>{categoriesById.get(r.categoryId)?.name}</span>
            <span className="text-text-2"> · covered from this</span>
          </div>
          <MoneyInput aria-label={`${categoriesById.get(r.categoryId)?.name} covered`} value={shortCovers[r.categoryId] ?? ''} onChange={(text) => setShortCovers({ ...shortCovers, [r.categoryId]: text })} />
        </div>
      ))}
      {leftover < 0 && (shortByRows.length === 0 ? (
        <p className="text-sm text-text-2">No other category has money to cover this from.</p>
      ) : (
        shortByRows.map((r) => (
          <div key={r.categoryId} className="flex items-center justify-between gap-2 text-sm">
            <div>
              <span>{r.name}</span>
              <span className="text-text-2"> · {formatCents(r.availableCents)} available</span>
            </div>
            <button type="button" className="btn btn-quiet" onClick={() => coverFrom(r)}>
              Cover from this
            </button>
          </div>
        ))
      ))}
    </fieldset>
  )
}

export function LeftOver({ pay }) {
  const { data, amounts, totals, saving, deleteThisPay } = pay
  const { periodLoaded, reopening, existingTransaction } = data
  const { reopenReady, removeBatchOnDelete, setRemoveBatchOnDelete } = amounts
  const { leftover } = totals

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-text-2">Left over</span>
        <span className={`tabular text-section ${leftover < 0 ? 'text-negative' : ''}`}>{formatCents(leftover)}</span>
      </div>
      {leftover < 0 && <RefusalNote>Assigned more than this paycheque brings in.</RefusalNote>}
      <Button type="submit" disabled={saving || !periodLoaded || (reopening && !reopenReady)}>
        Record
      </Button>
      {existingTransaction && (
        <div className="pt-3 border-t border-line space-y-2">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={removeBatchOnDelete}
              onChange={(e) => setRemoveBatchOnDelete(e.target.checked)}
            />
            Also remove the money moves this pay assigned
          </label>
          <Button variant="destructive" onClick={deleteThisPay}>Delete this pay</Button>
        </div>
      )}
    </div>
  )
}
