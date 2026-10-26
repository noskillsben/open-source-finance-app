import Button from '../components/Button.jsx'
import ChoicePicker from '../components/ChoicePicker.jsx'
import MoneyInput from '../components/MoneyInput.jsx'
import { RefusalNote, SaveNote } from '../components/Notes.jsx'
import { formatCents, formatDate, parseCents } from '../utils/format.js'

// Check balance / Update value in the side panel.
export default function BalanceCheckForm({ categories, check, closePanel }) {
  const { checkForm, checkError, checkResult, splitLines, splitDiff, checkingIsTracking, updateSplitLine, updateCheckField, submitCheck } = check

  return (
    <form className="space-y-4" onSubmit={submitCheck}>
      <label className="block space-y-1">
        <span className="field-label">Date</span>
        <input
          type="date"
          className="w-full field"
          value={checkForm.date}
          onChange={(e) => updateCheckField('date', e.target.value)}
        />
      </label>

      <MoneyInput
        label="Stated balance"
        signed
        balance
        value={checkForm.stated_balance_cents}
        onChange={(text) => updateCheckField('stated_balance_cents', text)}
      />

      {splitLines.length > 0 && (
        <div className="space-y-2">
          <span className="field-label">
            Split of the difference across the linked categories, by their balances — edit before saving.
          </span>
          {splitLines.map((line, i) => (
            <div key={line.category_id} className="flex items-center gap-2">
              <span className="flex-1 px-2 py-1">
                {categories?.find((c) => c.id === line.category_id)?.name ?? `#${line.category_id}`}
              </span>
              <MoneyInput signed aria-label="Amount" value={line.cents} onChange={(text) => updateSplitLine(i, text)} />
            </div>
          ))}
          <p className="text-sm text-text-2">
            {formatCents(splitLines.reduce((sum, l) => sum + (parseCents(l.cents) ?? 0), 0))} split of a{' '}
            {formatCents(splitDiff)} difference. Clear every amount to pick one category instead.
          </p>
        </div>
      )}

      {!checkingIsTracking && (
        <label className="block space-y-1">
          <span className="field-label">Category for the difference (optional — otherwise ready to assign)</span>
          <ChoicePicker
            items={categories ?? []}
            value={checkForm.category_id}
            onChange={(id) => updateCheckField('category_id', id)}
            placeholder="Ready to assign"
            ariaLabel="Category for the difference"
            emptyLabel="Ready to assign"
          />
        </label>
      )}

      {checkError && <RefusalNote>{checkError}</RefusalNote>}
      {checkResult && checkResult.diff_cents === 0 && (
        <SaveNote>That matches the ledger — balance checked {formatDate(checkResult.date)}, no adjustment needed.</SaveNote>
      )}
      {checkResult && checkResult.diff_cents !== 0 && (
        <SaveNote>
          Adjustment of {formatCents(checkResult.diff_cents)} recorded
          {checkingIsTracking
            ? ". This account is outside your budget, so ready to assign doesn't change."
            : checkResult.transaction.category_lines.length === 0
              ? ' to ready to assign.'
              : ` to ${checkResult.transaction.category_lines
                  .map((l) => `${categories?.find((c) => c.id === l.category_id)?.name} ${formatCents(l.cents)}`)
                  .join(', ')}.`}
        </SaveNote>
      )}

      <div className="flex gap-3">
        <Button type="submit">Save</Button>
        <Button variant="secondary" onClick={closePanel}>Close</Button>
      </div>
    </form>
  )
}
