import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { centsToFieldText, optionalCentsToFieldText } from '../utils/format.js'

// The amounts typed on the pay screen, one state per block, seeded from the named pay once, or from the
// recorded pay when it is re-opened (DESIGN.md § Re-opening a recorded pay).
export function usePayAmounts({ data, setFormError }) {
  const { stream, categories, categoriesAll, goalsLoaded, streamGoals, billGoals, targetGoals, fundingGoals, existingTransaction, reopening } = data
  const [seeded, setSeeded] = useState(false)
  const [deductionsOn, setDeductionsOn] = useState(true)
  const [gross, setGross] = useState('')
  const [deductions, setDeductions] = useState([])
  const [netOnly, setNetOnly] = useState('')
  const [oneOff, setOneOff] = useState([])
  const [oneOffIncomeCategory, setOneOffIncomeCategory] = useState({})
  const [oneOffDestinationAccount, setOneOffDestinationAccount] = useState({})
  const [everythingElse, setEverythingElse] = useState({}) // category_id -> amount text
  const [removeBatchOnDelete, setRemoveBatchOnDelete] = useState(true)
  const [retainRemoved, setRetainRemoved] = useState(new Set()) // block 4: goal ids taken out
  const [billAmounts, setBillAmounts] = useState({}) // block 6: goal id -> amount text
  const [fundingAmounts, setFundingAmounts] = useState({}) // block 7: goal id -> amount text
  const [fundingSkipped, setFundingSkipped] = useState(new Set()) // block 7: goal ids skipped
  const [targetAmounts, setTargetAmounts] = useState({}) // block 8: goal id -> amount text
  // Re-opening a recorded pay (DESIGN.md § Re-opening a recorded pay): the recorded batch, and the
  // rows the screen laid out from it, once.
  const [batch, setBatch] = useState(null) // { transactionId, lines }
  const [reopenSeededFor, setReopenSeededFor] = useState(null) // transaction id the rows were built from
  const [retainAmounts, setRetainAmounts] = useState({}) // block 4 on a recorded pay: goal id -> amount text
  const [shortCovers, setShortCovers] = useState({}) // block 10: category_id -> amount covered (text, positive)
  const [archivedRows, setArchivedRows] = useState([]) // read-only rows: { categoryId, cents, lines }
  const [reopenExtraIds, setReopenExtraIds] = useState(new Set()) // recorded Everything else rows

  // Prefill gross/deductions/goal blocks from the named pay once its categories and goals have
  // loaded, so each row can seed its text along with its id (once only).
  useEffect(() => {
    // A recorded pay shows what was recorded, never what the named pay would suggest now.
    if (!stream || seeded || reopening || categories.length === 0 || !goalsLoaded) return
    setSeeded(true)
    setGross(optionalCentsToFieldText(stream.expected_gross_cents))
    setDeductionsOn(stream.deductions.length > 0 || stream.expected_gross_cents != null)
    setDeductions(
      stream.deductions.map((d) => ({
        category: { id: d.category_id, text: categories.find((c) => c.id === d.category_id)?.name ?? '' },
        amount: centsToFieldText(d.amount_cents),
      }))
    )
    setBillAmounts(
      Object.fromEntries(
        billGoals.map((g) => [g.goal.id, optionalCentsToFieldText(g.due_by_next_payday_cents)])
      )
    )
    setTargetAmounts(
      Object.fromEntries(
        targetGoals.map((g) => [g.goal.id, optionalCentsToFieldText(g.due_by_next_payday_cents)])
      )
    )
    setFundingAmounts(
      Object.fromEntries(
        fundingGoals.map((g) => [
          g.goal.id,
          centsToFieldText(g.due_by_next_payday_cents ?? g.goal.amount_cents ?? g.owed_cents ?? 0),
        ])
      )
    )
  }, [stream, categories, seeded, reopening, goalsLoaded, billGoals, targetGoals, fundingGoals])

  const reopenReady = reopening && reopenSeededFor === existingTransaction.id

  // The income category the recorded pay landed in: the named pay's, unless the transaction was
  // since edited so it has no line there.
  const recordedIncomeCategoryId = useMemo(() => {
    if (!existingTransaction) return null
    const lines = existingTransaction.category_lines
    if (stream && lines.some((l) => l.category_id === stream.income_category_id)) return stream.income_category_id
    const biggest = [...lines].filter((l) => l.cents > 0).sort((a, b) => b.cents - a.cents)[0]
    return biggest?.category_id ?? stream?.income_category_id ?? null
  }, [existingTransaction, stream])

  const existingTransactionId = existingTransaction?.id ?? null
  useEffect(() => {
    if (existingTransactionId == null) {
      // The payday moved off a recorded pay: let the named pay's own pre-fill run again.
      if (reopenSeededFor != null) {
        setReopenSeededFor(null)
        setBatch(null)
        setSeeded(false)
      }
      return
    }
    if (batch?.transactionId === existingTransactionId) return
    api.payBatch
      .get(existingTransactionId)
      .then((lines) => setBatch({ transactionId: existingTransactionId, lines }))
      .catch((e) => setFormError(e.message))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load the recorded pay only when its id changes; batch and reopenSeededFor must not retrigger the fetch or reset
  }, [existingTransactionId])

  // Lay the recorded pay out once: block 3 from the transaction, every other row from the batch's
  // per-category net, minus the bookkeeping lines the save recomputes. Goals are the context line
  // only, never the value (DESIGN.md § Re-opening a recorded pay).
  useEffect(() => {
    if (!existingTransaction || !stream || !goalsLoaded || categoriesAll.length === 0) return
    if (batch?.transactionId !== existingTransaction.id || reopenSeededFor === existingTransaction.id) return
    const incomeId = recordedIncomeCategoryId
    const lines = existingTransaction.category_lines
    const recordedDeductions = lines.filter((l) => l.category_id !== incomeId && l.cents < 0)
    const recordedNet = existingTransaction.account_lines.reduce((sum, l) => sum + l.cents, 0)

    setDeductionsOn(recordedDeductions.length > 0)
    setGross(centsToFieldText(lines.filter((l) => l.category_id === incomeId).reduce((sum, l) => sum + l.cents, 0)))
    setNetOnly(centsToFieldText(recordedNet))
    setDeductions(
      recordedDeductions.map((l) => ({
        category: { id: l.category_id, text: categoriesAll.find((c) => c.id === l.category_id)?.name ?? '' },
        amount: centsToFieldText(-l.cents),
      }))
    )

    const net = new Map()
    for (const l of batch.lines) {
      if (l.category_id === incomeId) continue
      net.set(l.category_id, (net.get(l.category_id) ?? 0) + l.cents)
    }
    const deductionCategoryIds = new Set(recordedDeductions.map((l) => l.category_id))
    for (const l of recordedDeductions) net.set(l.category_id, (net.get(l.category_id) ?? 0) + l.cents)

    const retain = {}
    const bills = {}
    const funding = {}
    const targets = {}
    const elsewhere = {}
    const covers = {}
    const archived = []
    for (const [categoryId, cents] of net) {
      if (cents === 0) continue
      const category = categoriesAll.find((c) => c.id === categoryId)
      if (!category || category.archived_on) {
        // Saved as recorded: the backend lets an archived category's line through only when it is
        // unchanged, so send back its own lines (one net line where a deduction shares it).
        archived.push({
          categoryId,
          cents,
          lines: deductionCategoryIds.has(categoryId)
            ? [{ category_id: categoryId, cents }]
            : batch.lines.filter((l) => l.category_id === categoryId).map((l) => ({ category_id: categoryId, cents: l.cents })),
        })
        continue
      }
      if (cents < 0) {
        covers[categoryId] = centsToFieldText(-cents)
        continue
      }
      const goal = streamGoals.find((g) => g.goal.category_id === categoryId)?.goal
      if (goal?.kind === 'commitment' && goal.percent_of_net != null) retain[goal.id] = centsToFieldText(cents)
      else if (goal?.kind === 'recurring_bill') bills[goal.id] = centsToFieldText(cents)
      else if (goal?.kind === 'commitment') funding[goal.id] = centsToFieldText(cents)
      else if (goal?.kind === 'target') targets[goal.id] = centsToFieldText(cents)
      else elsewhere[categoryId] = centsToFieldText(cents)
    }
    setRetainAmounts(retain)
    setBillAmounts(bills)
    setFundingAmounts(funding)
    setTargetAmounts(targets)
    setEverythingElse(elsewhere)
    setReopenExtraIds(new Set(Object.keys(elsewhere).map(Number)))
    setShortCovers(covers)
    setArchivedRows(archived)
    setOneOff([])
    setRetainRemoved(new Set())
    setFundingSkipped(new Set())
    setReopenSeededFor(existingTransaction.id)
  }, [existingTransaction, stream, goalsLoaded, categoriesAll, batch, reopenSeededFor, recordedIncomeCategoryId, streamGoals])

  return {
    deductionsOn, setDeductionsOn, gross, setGross, deductions, setDeductions, netOnly, setNetOnly, oneOff, setOneOff,
    oneOffIncomeCategory, setOneOffIncomeCategory, oneOffDestinationAccount, setOneOffDestinationAccount,
    everythingElse, setEverythingElse, removeBatchOnDelete, setRemoveBatchOnDelete, retainRemoved, setRetainRemoved,
    billAmounts, setBillAmounts, fundingAmounts, setFundingAmounts, fundingSkipped, setFundingSkipped,
    targetAmounts, setTargetAmounts, retainAmounts, setRetainAmounts, shortCovers, setShortCovers,
    archivedRows, reopenExtraIds, reopenReady, recordedIncomeCategoryId,
  }
}
