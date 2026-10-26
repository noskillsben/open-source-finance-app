import MoneyInput from '../components/MoneyInput.jsx'
import { formatCents, formatDate } from '../utils/format.js'
import { sortByNeedIfShort } from './payHelpers.js'

// Blocks 4, 6, 7 and 8: the goals bound to this named pay, each row sorted by need level once short.

export function RetainIncome({ pay }) {
  const { data, amounts, totals } = pay
  const { reopening } = data
  const { retainAmounts, setRetainAmounts, retainRemoved, setRetainRemoved } = amounts
  const { retainRows, categoriesById, leftover } = totals

  return (
    <fieldset className="card space-y-2">
      <legend className="px-1 text-section">Retain income</legend>
      {sortByNeedIfShort(retainRows, categoriesById, leftover).map((r) => (
        <div key={r.goalId} className="flex items-center justify-between gap-2 text-sm">
          <div>
            <span>{r.name}</span>
            <span className="text-text-2"> · {categoriesById.get(r.categoryId)?.name} · {r.percent}% of net</span>
          </div>
          <div className="flex items-center gap-2">
            {reopening ? (
              <MoneyInput aria-label={`${r.name} amount`} value={retainAmounts[r.goalId] ?? ''} onChange={(text) => setRetainAmounts({ ...retainAmounts, [r.goalId]: text })} />
            ) : (
              <span>{formatCents(r.cents)}</span>
            )}
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setRetainRemoved(new Set([...retainRemoved, r.goalId]))}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </fieldset>
  )
}

export function Bills({ pay }) {
  const { amounts, totals } = pay
  const { billAmounts, setBillAmounts } = amounts
  const { billRows, categoriesById, leftover } = totals

  return (
    <fieldset className="card space-y-2">
      <legend className="px-1 text-section">Bills</legend>
      {sortByNeedIfShort(billRows, categoriesById, leftover).map((r) => (
        <div key={r.goalId} className="flex items-end justify-between gap-2">
          <div className="text-sm">
            <div>{r.name}</div>
            <div className="text-text-2">
              {categoriesById.get(r.categoryId)?.name} · due {formatDate(r.dueDate)}
              {r.expectedCents != null && <> · expected {formatCents(r.expectedCents)}</>}
              {r.contextText && <> · {r.contextText}</>}
            </div>
          </div>
          <MoneyInput className="w-28" value={billAmounts[r.goalId] ?? ''} onChange={(text) => setBillAmounts({ ...billAmounts, [r.goalId]: text })} />
        </div>
      ))}
    </fieldset>
  )
}

export function FundingRules({ pay }) {
  const { data, amounts, totals } = pay
  const { fundingGoals } = data
  const { fundingAmounts, setFundingAmounts, fundingSkipped, setFundingSkipped } = amounts
  const { categoriesById, leftover } = totals

  return (
    <fieldset className="card space-y-2">
      <legend className="px-1 text-section">Funding rules</legend>
      {sortByNeedIfShort(
        fundingGoals.map((g) => ({
          goalId: g.goal.id,
          categoryId: g.goal.category_id,
          name: g.goal.name,
          level: g.goal.level_cents != null,
          shortfallCents: g.owed_cents,
          levelCents: g.goal.level_cents,
          contextText: g.context_text,
        })),
        categoriesById,
        leftover
      ).map((r) => (
        <div key={r.goalId} className="flex items-end justify-between gap-2">
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={fundingSkipped.has(r.goalId)}
              onChange={(e) => {
                const next = new Set(fundingSkipped)
                if (e.target.checked) next.add(r.goalId)
                else next.delete(r.goalId)
                setFundingSkipped(next)
              }}
            />
            <span>
              <div>{r.name}</div>
              <div className="text-text-2">
                {categoriesById.get(r.categoryId)?.name} ·{' '}
                {r.level
                  ? `${formatCents(r.shortfallCents)} short of ${formatCents(r.levelCents)} level`
                  : (r.contextText ?? 'fixed')}
              </div>
            </span>
          </label>
          <MoneyInput className="w-28" disabled={fundingSkipped.has(r.goalId)} value={fundingAmounts[r.goalId] ?? ''} onChange={(text) => setFundingAmounts({ ...fundingAmounts, [r.goalId]: text })} />
        </div>
      ))}
    </fieldset>
  )
}

export function GoalSetAsides({ pay }) {
  const { amounts, totals } = pay
  const { targetAmounts, setTargetAmounts } = amounts
  const { targetRows, categoriesById, leftover } = totals

  return (
    <fieldset className="card space-y-2">
      <legend className="px-1 text-section">Goal set-asides</legend>
      {sortByNeedIfShort(targetRows, categoriesById, leftover).map((r) => (
        <div key={r.goalId} className="flex items-end justify-between gap-2">
          <div className="text-sm">
            <div>{r.name}</div>
            <div className="text-text-2">
              {categoriesById.get(r.categoryId)?.name} ·{' '}
              {r.targetCents != null && <>{formatCents(r.balanceCents)} of {formatCents(r.targetCents)} saved · </>}
              due {formatDate(r.dueDate)}
            </div>
          </div>
          <MoneyInput className="w-28" value={targetAmounts[r.goalId] ?? ''} onChange={(text) => setTargetAmounts({ ...targetAmounts, [r.goalId]: text })} />
        </div>
      ))}
    </fieldset>
  )
}
