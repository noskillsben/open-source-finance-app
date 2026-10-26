import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { parseCents } from '../utils/format.js'

// The bill this payment paid (DESIGN.md § Goals → Paying a bill) and the envelopes a move into or out of
// a linked account funds (DESIGN.md § Linked categories): both are read off the account and category lines.
export function useBillLink({ accounts, categories, goals, accountLines, categoryLines, editingId, date }) {
  const [deposits, setDeposits] = useState([])
  // Once the user has changed the envelope step it stops being re-filled from the balance.
  const depositsTouched = useRef(false)
  // Which recurring bill this payment paid and which due date: stated, never inferred.
  const [billLink, setBillLink] = useState(null)
  const [declinedBills, setDeclinedBills] = useState([])
  const [billDueDates, setBillDueDates] = useState(null)

  function updateDeposit(i, field, value) {
    depositsTouched.current = true
    setDeposits((rows) => rows.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  }

  // DESIGN.md § Linked categories: money moved into (or out of) an account with linked
  // categories asks which of those envelopes it funds (or leaves).
  const linkedCategoryIds = new Set()
  let linkedNet = 0
  for (const line of accountLines) {
    const account = accounts?.find((a) => String(a.id) === line.account_id)
    const cents = parseCents(line.cents)
    if (!account || account.linked_category_ids.length === 0 || cents === null) continue
    linkedNet += cents
    account.linked_category_ids.forEach((id) => linkedCategoryIds.add(id))
  }
  // DESIGN.md § Goals → Paying a bill: a category line on a category with a live recurring bill
  // offers "this pays Rent, due Oct 1"; the user confirms, picks another due date, or leaves it.
  const billsByCategory = new Map(
    (goals ?? []).filter((g) => g.goal.kind === 'recurring_bill').map((g) => [g.goal.category_id, g])
  )
  const linkedBill = billLink ? goals?.find((g) => g.goal.id === billLink.goal_id) : null
  const lineBill = categoryLines
    .map((l) => billsByCategory.get(Number(l.category_id)))
    .find((b) => b && !declinedBills.includes(b.goal.id))
  const offeredBill = billLink ? linkedBill : lineBill
  const offeredGoalId = billLink ? billLink.goal_id : lineBill?.goal.id

  useEffect(() => {
    setBillDueDates(null)
    if (offeredGoalId == null) return
    api.goals.dueDates(offeredGoalId).then((dates) => setBillDueDates({ goalId: offeredGoalId, dates })).catch(() => {})
  }, [offeredGoalId])

  const dueOptions = billDueDates && billDueDates.goalId === offeredGoalId ? billDueDates.dates : []
  const dueOptionValues = dueOptions.map((d) => d.due_on)
  const offeredDue = billLink?.goal_due_on ?? dueOptions.find((d) => d.earliest_unpaid)?.due_on ?? ''
  // DESIGN.md § Linked categories, point 2: exactly one line on a linked account whose account has
  // exactly one linked category pre-fills the step from the balance before that line.
  const linkedLines = accountLines.filter((l) => {
    const account = accounts?.find((a) => String(a.id) === l.account_id)
    return account && account.linked_category_ids.length > 0 && parseCents(l.cents) !== null
  })
  const prefillAccount = linkedLines.length === 1 ? accounts.find((a) => String(a.id) === linkedLines[0].account_id) : null
  const prefillCategoryId = prefillAccount?.linked_category_ids.length === 1 ? prefillAccount.linked_category_ids[0] : null
  const prefillCents = prefillCategoryId != null ? parseCents(linkedLines[0].cents) : null
  useEffect(() => {
    if (editingId != null || depositsTouched.current || !date) return
    if (prefillCategoryId == null) return setDeposits([]) // no longer qualifies: drop the pre-filled row
    if (!prefillCents) return setDeposits([])
    let stale = false
    api.accounts
      .balance(prefillAccount.id, date)
      .then(({ balance_cents: b }) => {
        if (stale || depositsTouched.current) return
        const directed = Math.max(0, b + prefillCents) - Math.max(0, b)
        setDeposits(
          directed === 0
            ? []
            : [{ category_id: String(prefillCategoryId), cents: String(Math.abs(directed) / 100), other_category_id: '' }]
        )
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [editingId, prefillAccount?.id, prefillCategoryId, prefillCents, date])

  const envelopes = (categories ?? []).filter((c) => linkedCategoryIds.has(c.id))
  const depositTotal = deposits.reduce((sum, d) => sum + (parseCents(d.cents) ?? 0), 0)

  return {
    deposits, setDeposits, depositsTouched, updateDeposit, billLink, setBillLink, declinedBills, setDeclinedBills,
    linkedNet, offeredBill, offeredGoalId, offeredDue, dueOptions, dueOptionValues, envelopes, depositTotal,
  }
}
