import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { parseCents } from '../utils/format.js'
import { emptyCheckForm } from './accountForm.js'

// Check balance / Update value (DESIGN.md § Accounts): the stated balance, the linked-category split of
// a gain or loss, and the undo of the last check.
export function useBalanceCheck({ accounts, pickerDate, refresh }) {
  const [checkingId, setCheckingId] = useState(null)
  const [checkForm, setCheckForm] = useState(() => emptyCheckForm(pickerDate))
  const [checkError, setCheckError] = useState(null)
  const [checkResult, setCheckResult] = useState(null)
  // The linked-category split of a gain or loss (DESIGN.md § Linked categories): suggested by the
  // backend, edited here, sent as the adjustment's category lines.
  const [splitLines, setSplitLines] = useState([])
  const [splitDiff, setSplitDiff] = useState(0)
  const [undoError, setUndoError] = useState(null)

  const checkingAccount = accounts?.find((a) => a.id === checkingId)
  const checkingIsTracking = checkingAccount ? !checkingAccount.on_budget : false
  const checkingHasLinks = (checkingAccount?.linked_category_ids.length ?? 0) > 0

  useEffect(() => {
    const statedCents = parseCents(checkForm.stated_balance_cents)
    if (!checkingHasLinks || !checkForm.date || statedCents === null) {
      setSplitLines([])
      return
    }
    let stale = false
    api.accounts
      .checkBalancePreview(checkingId, checkForm.date, statedCents)
      .then((preview) => {
        if (!stale) setSplitDiff(preview.diff_cents)
        if (!stale) setSplitLines(preview.category_lines.map((l) => ({ category_id: l.category_id, cents: String(l.cents / 100) })))
      })
      .catch(() => { if (!stale) setSplitLines([]) })
    return () => { stale = true }
  }, [checkingId, checkingHasLinks, checkForm.date, checkForm.stated_balance_cents])

  function updateSplitLine(i, cents) {
    setSplitLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, cents } : l)))
  }

  function updateCheckField(field, value) {
    setCheckForm((f) => ({ ...f, [field]: value }))
  }

  async function submitCheck(e) {
    e.preventDefault()
    setCheckError(null)
    setCheckResult(null)

    if (!checkForm.date) return setCheckError('Date is required.')
    const statedCents = parseCents(checkForm.stated_balance_cents)
    if (statedCents === null) return setCheckError('Stated balance must be a number.')

    const split = []
    for (const line of splitLines) {
      if (line.cents.trim() === '') continue
      const cents = parseCents(line.cents)
      if (cents === null) return setCheckError('Every split amount must be a number.')
      split.push({ category_id: line.category_id, cents })
    }

    try {
      const result = await api.accounts.checkBalance(checkingId, {
        date: checkForm.date,
        stated_balance_cents: statedCents,
        category_id: !checkingIsTracking && checkForm.category_id ? Number(checkForm.category_id) : null,
        category_lines: split.length > 0 ? split : null,
      })
      setCheckResult({ ...result, date: checkForm.date }) // the date saved, not whatever the field says later
      refresh()
    } catch (err) {
      setCheckError(err.message)
    }
  }

  async function undoCheck(e, account) {
    e.stopPropagation()
    setUndoError(null)
    try {
      await api.valuations.remove(account.checked_valuation_id)
      refresh()
    } catch (err) {
      setUndoError(err.message)
    }
  }

  function resetCheck() {
    setSplitLines([])
    setCheckingId(null)
    setCheckForm(emptyCheckForm(pickerDate))
    setCheckError(null)
    setCheckResult(null)
  }

  // The check-balance state a fresh check starts from, for the account chosen.
  function beginCheck(account) {
    setCheckingId(account.id)
    setCheckForm(emptyCheckForm(pickerDate))
    setCheckError(null)
    setCheckResult(null)
    setSplitLines([])
  }

  return {
    checkingId, checkForm, checkError, checkResult, splitLines, splitDiff, undoError,
    checkingIsTracking, updateSplitLine, updateCheckField, submitCheck, undoCheck, resetCheck, beginCheck,
  }
}
