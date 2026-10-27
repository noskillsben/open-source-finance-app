import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { formatDate, parseCents } from '../utils/format.js'
import { useRegisterFormOpen } from '../components/SidePanel.jsx'
import { monthKey } from '../LedgerTable.jsx'
import { basisFromSplit, basisFromTransaction, scaleBasis, spreadCents } from '../sharedBill.js'
import { NEW_AMOUNT, accountSideDerived, deriveLines, emptyCategoryLine, emptyLine, readShape, readable, splitSign } from './formShape.js'
import { useBillLink } from './useBillLink.js'
import { useRefundToPool } from './useRefundToPool.js'
import { useBoundaryFill } from './useBoundaryFill.js'
import { usePayeeFill } from './usePayeeFill.js'
import { useSharedBill } from './useSharedBill.js'
import { useTransactionPrefill } from './useTransactionPrefill.js'

// The Record / Edit form: its fields, how the one Amount works out the lines, and the save, delete and
// close paths. The pieces that read the lines (bill link, shared bill, payee fill) are hooks of their own.
export function useTransactionForm({ pickerDate, data, collapsed, setCollapsed }) {
  const { accounts, categories, payees, setPayees, transactions, goals, splitsAll, payeesAll, refresh } = data

  const [date, setDate] = useState(pickerDate)
  const [memo, setMemo] = useState('')
  const [payeeId, setPayeeId] = useState(null)
  // Bumped on reset and on loading a transaction so the payee picker remounts with fresh text.
  const [formKey, setFormKey] = useState(0)
  const [accountLines, setAccountLines] = useState([{ ...emptyLine }])
  const [categoryLines, setCategoryLines] = useState([])
  // The one Amount, signed text as the box holds it. With a split chosen it is the Bill total.
  const [amount, setAmount] = useState(NEW_AMOUNT)
  // Boxes kept open on a side whose lines are not what the Amount derives (see readShape).
  const [forceAccountBoxes, setForceAccountBoxes] = useState(false)
  const [forceCategoryBoxes, setForceCategoryBoxes] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [formError, setFormError] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  // The form is a page of its own (DESIGN.md § Visual design → Where forms open), shown in place of the
  // list while `formOpen`. It is component state on /transactions, not a sub-path: route state
  // pre-fills it and nothing else needs to link to it.
  const [formOpen, setFormOpen] = useState(false)
  // The row just saved, highlighted when the list comes back.
  const [highlightId, setHighlightId] = useState(null)
  const dateRef = useRef(null)
  const [editingId, setEditingId] = useState(null)
  const [predatesCheckNotes, setPredatesCheckNotes] = useState([])
  // Delete confirmation, opened in place of window.confirm (DESIGN.md § Earmarks): null when
  // closed, otherwise { hasBatchLines, removeBatch } for the transaction being deleted.
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const { deposits, setDeposits, depositsTouched, updateDeposit, billLink, setBillLink, declinedBills, setDeclinedBills,
    linkedNet, offeredBill, offeredGoalId, offeredDue, dueOptions, dueOptionValues, envelopes, depositTotal } =
    useBillLink({ accounts, categories, goals, accountLines, categoryLines, editingId, date, splitsAll })
  const { refundOffers, updateRefund, setRefundRows, refundTouched, refundItems } =
    useRefundToPool({ categories, categoryLines, editingId, date, linkedNet })
  const { splitId, setSplitId, paidById, setPaidById, setShareBasis, shareStart, setShareStart, totalLocked, setTotalLocked,
    ownPicks, mePayeeId, chosenSplit, fillShared, chooseSplit, changeReceipt, sharedTotalCents, changePaidBy } =
    useSharedBill({ payees, splitsAll, accountLines, categoryLines, setAccountLines, setCategoryLines, amount, setAmount, setForceAccountBoxes, setForceCategoryBoxes })
  const { setPayeeFill, pickedPayee, prefilledFor, prefillLockedPayee, pickPayee } =
    usePayeeFill({ pickerDate, accounts, categories, payees, splitsAll, payeeId, setPayeeId, billLink, editingId, amount, accountLines, setAccountLines, categoryLines, setCategoryLines, splitId, ownPicks, chooseSplit, setFormError })
  const boundaryFill = useBoundaryFill({ editingId, splitId, accounts, categories, accountLines, categoryLines, setCategoryLines })

  // Lines worked out elsewhere (a saved transaction, a bill's Record link, Settle up, Quick add) go in
  // as they are; the Amount and which sides show boxes are read back from them.
  function showLines(aLines, cLines) {
    const shape = readShape(aLines, cLines)
    setAccountLines(aLines)
    setCategoryLines(cLines)
    setAmount(readable(shape.amount) || NEW_AMOUNT) // no amount to read back: start on Spent like a new form
    setForceAccountBoxes(shape.forceA)
    setForceCategoryBoxes(shape.forceC)
  }

  async function addPayee(name) {
    const payee = await api.payees.create({ name, created_on: date })
    setPayees((current) => [...(current ?? []), payee].sort((a, b) => a.name.localeCompare(b.name)))
    return payee
  }

  // The picker pre-fills the Record form (DESIGN.md § One clock): moving it replaces the date, even one
  // typed by hand, but an open edit keeps the date of the transaction being edited.
  useEffect(() => {
    if (editingId == null) setDate(pickerDate)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-apply only when the picker date moves, never on edit state
  }, [pickerDate])

  // The first field is ready whenever the form view opens.
  useEffect(() => {
    if (formOpen) dateRef.current?.focus()
  }, [formOpen])

  function openAdd() {
    setHighlightId(null)
    resetForm()
    setSavedNote(null)
    setPredatesCheckNotes([])
    setFormOpen(true)
  }

  useTransactionPrefill({ pickerDate, openAdd, setFormOpen, setDate, setMemo, showLines, setBillLink, setPayeeId, setAccountLines, setFormError, pickedPayee, pickPayee })

  // A box on an account line, shown only where the Amount does not derive the line (or its account).
  function updateAccountLine(i, field, value) {
    prefillLockedPayee({ ...accountLines[i], [field]: value })
    setAccountLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }
  function updateCategoryLine(i, field, value) {
    setCategoryLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  // Lines added or removed: the sides that derive from the Amount are worked out again, so going back
  // to one line hides that side's box. Boxes the user has are never rewritten.
  function reshape(aLines, cLines, { removed = false } = {}) {
    if (removed) {
      setForceAccountBoxes(false)
      setForceCategoryBoxes(false)
    }
    if (chosenSplit) {
      setAccountLines(aLines)
      setCategoryLines(cLines)
      return
    }
    const keepA = !removed && forceAccountBoxes
    const keepC = !removed && forceCategoryBoxes
    const d = deriveLines(amount, aLines, cLines)
    setAccountLines(keepA ? aLines : d.a)
    setCategoryLines(keepC ? cLines : d.c)
  }
  function addAccountLine() {
    reshape([...accountLines, { ...emptyLine }], categoryLines)
  }
  function addCategoryLine() {
    reshape(accountLines, [...categoryLines, { ...emptyCategoryLine }])
  }
  function removeAccountLine(i) {
    reshape(accountLines.filter((_, idx) => idx !== i), categoryLines, { removed: true })
  }
  function removeCategoryLine(i) {
    reshape(accountLines, categoryLines.filter((_, idx) => idx !== i), { removed: true })
  }

  // The Amount box. With a split it is the Bill total and the split's arithmetic works the lines out;
  // otherwise it fills whichever sides derive from it.
  function changeAmount(text) {
    if (totalLocked) return
    setAmount(text)
    if (chosenSplit) {
      const cents = parseCents(text)
      if (cents === null || cents === 0) return
      const total = Math.abs(cents)
      const basis = (shareStart && scaleBasis(shareStart, total)) || basisFromSplit(total, chosenSplit)
      fillShared(chosenSplit, basis, splitSign(text), paidById)
      return
    }
    const d = deriveLines(text, accountLines, categoryLines)
    const a = forceAccountBoxes ? accountLines : d.a
    const c = forceCategoryBoxes ? categoryLines : d.c
    setAccountLines(a)
    setCategoryLines(c)
    a.forEach(prefillLockedPayee)
  }

  function resetForm() {
    setPayeeFill(null)
    pickedPayee.current = null
    setAmount(NEW_AMOUNT)
    setForceAccountBoxes(false)
    setForceCategoryBoxes(false)
    setSplitId('')
    setTotalLocked(false)
    setPaidById(null)
    setShareBasis(null)
    setShareStart(null)
    ownPicks.current = { account_id: '', category_id: '' }
    setEditingId(null)
    setDate(pickerDate)
    setMemo('')
    setPayeeId(null)
    prefilledFor.current = new Set()
    boundaryFill.current = { filled: false, lines: null }
    setFormKey((k) => k + 1)
    setAccountLines([{ ...emptyLine }])
    setCategoryLines([])
    setDeposits([])
    depositsTouched.current = false
    setRefundRows([])
    refundTouched.current = false
    setBillLink(null)
    setDeclinedBills([])
    setFormError(null)
    setDeleteConfirm(null)
  }

  function editTransaction(t) {
    setHighlightId(null)
    setPayeeFill(null)
    pickedPayee.current = null
    setPredatesCheckNotes([])
    setSavedNote(null)
    setDeleteConfirm(null)
    setFormOpen(true)
    setEditingId(t.id)
    setDate(t.date)
    setMemo(t.memo || '')
    setPayeeId(t.payee_id)
    prefilledFor.current = new Set(t.account_lines.map((l) => l.account_id)) // an edit never re-fills
    setFormKey((k) => k + 1)
    showLines(
      t.account_lines.map((l) => ({ account_id: String(l.account_id), cents: String(l.cents / 100) })),
      t.category_lines.map((l) => ({ category_id: String(l.category_id), cents: String(l.cents / 100), receipt: '' }))
    )
    depositsTouched.current = true // an edit shows what was stored and never re-fills
    // Stored envelope-step rows split in two: those into a category the transaction's accounts are
    // linked to, and a refund going back up to a pool (DESIGN.md § Pools).
    const linkedIds = new Set(
      t.account_lines.flatMap((l) => accounts?.find((a) => a.id === l.account_id)?.linked_category_ids ?? [])
    )
    const stored = t.deposits ?? []
    setDeposits(
      stored
        .filter((d) => linkedIds.has(d.category_id))
        .map((d) => ({
          category_id: String(d.category_id),
          cents: String(d.cents / 100),
          other_category_id: d.other_category_id ? String(d.other_category_id) : '',
        }))
    )
    refundTouched.current = true
    setRefundRows(
      stored
        .filter((d) => !linkedIds.has(d.category_id))
        .map((d) => ({ from: d.other_category_id, category_id: String(d.category_id), cents: String(d.cents / 100) }))
    )
    setBillLink(t.goal_id != null ? { goal_id: t.goal_id, goal_due_on: t.goal_due_on } : null)
    setDeclinedBills([])
    setFormError(null)
    // A saved shared bill reads its own proportions back, so a new total rescales by them.
    const split = t.split_id != null ? splitsAll?.find((s) => s.id === t.split_id) : null
    const saved = split ? basisFromTransaction(t, split, mePayeeId) : null
    setSplitId(t.split_id != null ? String(t.split_id) : '')
    setPaidById(t.paid_by_payee_id)
    setShareBasis(saved?.basis ?? null)
    setShareStart(saved?.basis ?? null)
    setTotalLocked(t.split_id != null && !saved)
    if (split) {
      // On a split the Amount is the Bill total: negative for a bill paid, positive for a refund on one.
      setAmount(saved ? String((-saved.sign * saved.basis.total) / 100) : '')
      setForceAccountBoxes(false)
      setForceCategoryBoxes(false)
    }
    if (saved) {
      // Each category's receipt amount is its line × (total ÷ my share): my lines' proportions of the total.
      const receipts = spreadCents(saved.basis.total, t.category_lines.map((l) => Math.abs(l.cents)))
      setCategoryLines(
        t.category_lines.map((l, i) => ({ category_id: String(l.category_id), cents: String(l.cents / 100), receipt: String(receipts[i] / 100) }))
      )
    }
    const ownLine = split && t.account_lines.find((l) => !split.members.some((m) => m.account_id === l.account_id))
    ownPicks.current = {
      account_id: ownLine ? String(ownLine.account_id) : '',
      category_id: t.category_lines[0] ? String(t.category_lines[0].category_id) : '',
    }
  }

  async function openDeleteConfirm() {
    if (!editingId) return
    setFormError(null)
    try {
      const lines = await api.payBatch.get(editingId)
      setDeleteConfirm({ hasBatchLines: lines.length > 0, removeBatch: true })
    } catch (err) {
      setFormError(err.message)
    }
  }

  async function confirmDelete() {
    if (!editingId || !deleteConfirm) return
    try {
      if (deleteConfirm.hasBatchLines && deleteConfirm.removeBatch) {
        await api.payBatch.replace(editingId, [])
      }
      await api.transactions.remove(editingId)
      setHighlightId(null)
      resetForm()
      setFormOpen(false)
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  // The back link and Cancel leave without saving.
  function closeForm() {
    setHighlightId(null)
    resetForm()
    setPredatesCheckNotes([])
    setFormOpen(false)
  }

  async function addCategory(e) {
    e.preventDefault()
    if (!newCategoryName.trim()) return
    try {
      await api.categories.create({ name: newCategoryName.trim(), created_on: date })
      setNewCategoryName('')
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  // A side shows a box per line when the Amount cannot give every line its value: a split, a side with
  // several lines, a transfer that has gained a category, or lines opened that way (see readShape).
  const accountBoxes = !!chosenSplit || forceAccountBoxes || !accountSideDerived(accountLines.length, categoryLines.length)
  const categoryBoxes = !!chosenSplit || forceCategoryBoxes || categoryLines.length > 1

  async function submit(e) {
    e.preventDefault()
    setFormError(null)

    if (!date) return setFormError('Date is required.')

    const parsedAccountLines = []
    for (const line of accountLines) {
      if (!line.account_id) continue
      const cents = parseCents(line.cents)
      if (cents === null) return setFormError('Every account line needs an amount.')
      parsedAccountLines.push({ account_id: Number(line.account_id), cents })
    }
    if (parsedAccountLines.length === 0) return setFormError('At least one account line is required.')

    const parsedCategoryLines = []
    for (const line of categoryLines) {
      if (!line.category_id) continue
      const cents = parseCents(line.cents)
      if (cents === null) return setFormError('Every category line needs an amount.')
      parsedCategoryLines.push({ category_id: Number(line.category_id), cents })
    }

    const parsedDeposits = []
    if (linkedNet !== 0) {
      for (const row of deposits) {
        if (!row.category_id) continue
        const cents = parseCents(row.cents)
        if (cents === null || cents <= 0) return setFormError('Every envelope needs an amount.')
        parsedDeposits.push({
          category_id: Number(row.category_id),
          cents,
          other_category_id: row.other_category_id ? Number(row.other_category_id) : null,
        })
      }
    }

    const refund = refundItems()
    if (refund.error) return setFormError(refund.error)

    if (splitId && paidById == null) return setFormError('Choose who paid.')

    const body = {
      date,
      memo: memo.trim() || null,
      payee_id: payeeId,
      goal_id: billLink?.goal_id ?? null,
      goal_due_on: billLink?.goal_due_on ?? null,
      split_id: splitId ? Number(splitId) : null,
      paid_by_payee_id: splitId ? paidById : null,
      shared_total_cents: sharedTotalCents(),
      account_lines: parsedAccountLines,
      category_lines: parsedCategoryLines,
      deposits: [...parsedDeposits, ...refund.items],
    }

    try {
      const saved = editingId
        ? await api.transactions.update(editingId, body)
        : await api.transactions.create(body)
      setPredatesCheckNotes(saved.notes || [])
      const wasAdd = !editingId
      const savedId = saved.id ?? editingId
      resetForm()
      // Saving returns to the list with the saved row highlighted.
      setSavedNote(wasAdd ? 'Recorded.' : null)
      setHighlightId(savedId ?? null)
      // The saved row must be visible: open its month if it was collapsed.
      if (collapsed.includes(monthKey(body.date))) setCollapsed(collapsed.filter((k) => k !== monthKey(body.date)))
      setFormOpen(false)
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  useRegisterFormOpen(formOpen)

  // Names and dates, never ids: "Edit · Loblaws, Oct 3".
  const editedTx = editingId ? transactions?.find((t) => t.id === editingId) : null
  const editedWho = editedTx && ((editedTx.payee_id != null && payeesAll?.find((p) => p.id === editedTx.payee_id)?.name) || editedTx.memo)
  const editedLabel = [editedWho, editedTx && formatDate(editedTx.date)].filter(Boolean).join(', ')
  const formTitle = editingId ? (editedLabel ? `Edit · ${editedLabel}` : 'Edit transaction') : 'Record a transaction'

  return {
    accounts, categories, payees, goals, splitsAll, goalsFailed: data.goalsFailed,
    date, setDate, memo, setMemo, payeeId, formKey, accountLines, categoryLines, amount, deposits,
    billLink, setBillLink, declinedBills, setDeclinedBills, newCategoryName, setNewCategoryName,
    formError, setFormError, savedNote, formOpen, highlightId, dateRef, editingId, predatesCheckNotes, deleteConfirm, setDeleteConfirm,
    linkedNet, offeredBill, offeredGoalId, offeredDue, dueOptions, dueOptionValues, envelopes, depositTotal,
    splitId, paidById, totalLocked, mePayeeId, chosenSplit, accountBoxes, categoryBoxes, formTitle,
    openAdd, editTransaction, closeForm, submit, addCategory, openDeleteConfirm, confirmDelete,
    addPayee, pickPayee, changeAmount, chooseSplit, changePaidBy, changeReceipt,
    updateAccountLine, updateCategoryLine, updateDeposit, addAccountLine, addCategoryLine, removeAccountLine, removeCategoryLine,
    setDeposits, depositsTouched, refundOffers, updateRefund,
  }
}
