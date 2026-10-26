import { useMemo } from 'react'
import { parseCents } from '../utils/format.js'
import { rowsToMoves } from './payHelpers.js'

// Everything the pay screen works out from what is typed: net, each block's rows and total, the
// running Left over, and what Short by can offer. Computed live, never stored.
export function usePayTotals({ isOneOff, data, amounts }) {
  const { categories, categoriesAll, goals, goalsLoaded, period, periodLoaded, stream, existingTransaction, reopening, streamGoals, retainGoals, billGoals, fundingGoals, targetGoals, readyToAssign } = data
  const {
    deductionsOn, gross, deductions, netOnly, oneOff, oneOffIncomeCategory, oneOffDestinationAccount, everythingElse,
    retainRemoved, billAmounts, fundingAmounts, fundingSkipped, targetAmounts, retainAmounts, shortCovers,
    archivedRows, reopenExtraIds, recordedIncomeCategoryId,
  } = amounts

  const grossCents = parseCents(gross) ?? 0
  const deductionTotal = deductions.reduce((sum, d) => sum + (parseCents(d.amount) ?? 0), 0)
  const net = deductionsOn ? grossCents - deductionTotal : (parseCents(netOnly) ?? 0)

  const oneOffTotal = rowsToMoves(oneOff).reduce((sum, m) => sum + m.cents, 0)

  // Where this pay lands: read off the named pay, or, with no named pay behind this screen,
  // whatever the user picked (DESIGN.md § Record income — the pay screen: "A one-off on the pay
  // screen" — nothing pre-filled).
  // A recorded pay keeps the category and account it landed in, whatever the named pay says now.
  const incomeCategoryId = isOneOff
    ? (oneOffIncomeCategory.id ?? null)
    : (recordedIncomeCategoryId ?? stream?.income_category_id ?? null)
  const destinationAccountId = isOneOff
    ? (oneOffDestinationAccount.id ?? null)
    : (existingTransaction?.account_lines[0]?.account_id ?? stream?.destination_account_id ?? null)

  // Only goals bound to this pay have a block of their own; a goal bound elsewhere, or to none,
  // lists under Everything else (on a one-off streamGoals is empty, so every goal category does).
  const streamGoalCategoryIds = useMemo(() => new Set(streamGoals.map((g) => g.goal.category_id)), [streamGoals])
  const goalByCategoryId = useMemo(() => {
    const byCategory = new Map()
    for (const g of goals) if (!byCategory.has(g.goal.category_id)) byCategory.set(g.goal.category_id, g)
    return byCategory
  }, [goals])
  const deductionCategoryIds = useMemo(
    () => new Set(deductions.map((d) => d.category.id).filter((id) => id != null)),
    [deductions]
  )
  const everythingElseCategories = useMemo(() => {
    // Wait for the goals so a goal bound here doesn't flash in and out of this block.
    if (!goalsLoaded) return []
    return categories
      .filter((c) => !c.archived_on)
      .filter((c) => !streamGoalCategoryIds.has(c.id))
      .filter((c) => c.id !== incomeCategoryId && !deductionCategoryIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [categories, goalsLoaded, streamGoalCategoryIds, deductionCategoryIds, incomeCategoryId])

  // Last period's actual for a named pay, last calendar month's for a one-off — the backend works
  // out the window (DESIGN.md § "A one-off on the pay screen"); outflow lines only.
  const lastPeriodActuals = useMemo(() => {
    const totals = {}
    if (periodLoaded) for (const a of period.last_period_actuals) totals[a.category_id] = a.cents
    return totals
  }, [period, periodLoaded])

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const categoriesAllById = useMemo(() => new Map(categoriesAll.map((c) => [c.id, c])), [categoriesAll])

  // Everything else on a recorded pay also holds the rows the batch put in categories this list
  // leaves out (a deduction's category).
  const everythingElseList = useMemo(() => {
    if (reopenExtraIds.size === 0) return everythingElseCategories
    const have = new Set(everythingElseCategories.map((c) => c.id))
    return [...everythingElseCategories, ...categoriesAll.filter((c) => reopenExtraIds.has(c.id) && !have.has(c.id))]
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [everythingElseCategories, categoriesAll, reopenExtraIds])

  // Block 4: computed live from net, rounded to the cent — never stored, so nothing to seed.
  const retainRows = useMemo(
    () =>
      retainGoals
        .filter((g) => !retainRemoved.has(g.goal.id))
        .map((g) => ({
          goalId: g.goal.id,
          categoryId: g.goal.category_id,
          name: g.goal.name,
          // GoalOut serializes percent_of_net at a fixed 4 places ("5.0000"); trim it for display.
          percent: parseFloat(g.goal.percent_of_net),
          // On a recorded pay the amount is what was recorded, so correcting net moves Left over
          // rather than the row; otherwise it is computed live off net.
          cents: reopening
            ? (parseCents(retainAmounts[g.goal.id]) ?? 0)
            : Math.round((parseFloat(g.goal.percent_of_net) / 100) * net),
        })),
    [retainGoals, retainRemoved, net, reopening, retainAmounts]
  )
  const retainTotal = retainRows.reduce((sum, r) => sum + r.cents, 0)

  const billRows = billGoals.map((g) => ({
    goalId: g.goal.id,
    categoryId: g.goal.category_id,
    name: g.goal.name,
    dueDate: g.due_date,
    expectedCents: g.goal.amount_cents,
    contextText: g.context_text,
    cents: parseCents(billAmounts[g.goal.id]) ?? 0,
  }))
  const billTotal = billRows.reduce((sum, r) => sum + r.cents, 0)

  const fundingRows = fundingGoals
    .filter((g) => !fundingSkipped.has(g.goal.id))
    .map((g) => ({
      goalId: g.goal.id,
      categoryId: g.goal.category_id,
      name: g.goal.name,
      level: g.goal.level_cents != null,
      shortfallCents: g.owed_cents,
      cents: parseCents(fundingAmounts[g.goal.id]) ?? 0,
    }))
  const fundingTotal = fundingRows.reduce((sum, r) => sum + r.cents, 0)

  const targetRows = targetGoals.map((g) => ({
    goalId: g.goal.id,
    categoryId: g.goal.category_id,
    name: g.goal.name,
    dueDate: g.due_date,
    balanceCents: g.balance_cents,
    targetCents: g.target_cents,
    cents: parseCents(targetAmounts[g.goal.id]) ?? 0,
  }))
  const targetTotal = targetRows.reduce((sum, r) => sum + r.cents, 0)

  const everythingElseTotal = Object.values(everythingElse).reduce((sum, text) => sum + (parseCents(text) ?? 0), 0)
  // A recorded cover is a negative line in the batch: money taken back from that category.
  const coverRows = Object.entries(shortCovers).map(([categoryId, text]) => ({
    categoryId: Number(categoryId),
    cents: parseCents(text) ?? 0,
  }))
  const coverTotal = coverRows.reduce((sum, r) => sum + r.cents, 0)
  const archivedTotal = archivedRows.reduce((sum, r) => sum + r.cents, 0)
  const leftover =
    net - retainTotal - oneOffTotal - billTotal - fundingTotal - targetTotal - everythingElseTotal
    + coverTotal - archivedTotal

  // Block 10: categories currently receiving money on this screen, recomputed live as the user
  // types, so Short by never offers to cover a goal from itself.
  const fundedThisScreenCategoryIds = useMemo(() => {
    const ids = new Set()
    for (const r of [...retainRows, ...billRows, ...fundingRows, ...targetRows]) {
      if (r.cents > 0) ids.add(r.categoryId)
    }
    for (const m of [...rowsToMoves(oneOff), ...everythingElseMoves()]) ids.add(m.category_id)
    return ids
  // eslint-disable-next-line react-hooks/exhaustive-deps -- everythingElseMoves is recreated every render; everythingElse is its real input
  }, [retainRows, billRows, fundingRows, targetRows, oneOff, everythingElse])

  const shortByRows = useMemo(() => {
    if (!readyToAssign) return []
    // What a category still offers is its balance less what this screen already covers from it.
    return readyToAssign.categories
      .map((c) => ({
        categoryId: c.category_id,
        name: categoriesById.get(c.category_id)?.name ?? '',
        availableCents: c.available_cents - (parseCents(shortCovers[c.category_id]) ?? 0),
      }))
      .filter((r) => r.availableCents > 0 && !fundedThisScreenCategoryIds.has(r.categoryId))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [readyToAssign, fundedThisScreenCategoryIds, categoriesById, shortCovers])

  function everythingElseMoves() {
    return Object.entries(everythingElse)
      .map(([categoryId, text]) => ({ category_id: Number(categoryId), cents: parseCents(text) ?? 0 }))
      .filter((m) => m.cents > 0)
  }

  return {
    grossCents, net, incomeCategoryId, destinationAccountId, goalByCategoryId, everythingElseList, lastPeriodActuals,
    categoriesById, categoriesAllById, retainRows, billRows, fundingRows, targetRows, coverRows, leftover,
    shortByRows, everythingElseMoves,
  }
}
