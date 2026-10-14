import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from './api.js'
import { centsToFieldText, formatCents, formatDate, parseCents } from './utils/format.js'
import Button from './components/Button.jsx'
import { useRegisterFormOpen } from './components/SidePanel.jsx'
import EmptyState from './components/EmptyState.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import ChoicePicker from './components/ChoicePicker.jsx'
import MoneyInput from './components/MoneyInput.jsx'
import { RefusalNote, SaveNote, WarningNote } from './components/Notes.jsx'
import LedgerTable from './LedgerTable.jsx'
import PayeePicker from './PayeePicker.jsx'
import { basisFromSplit, basisFromTransaction, linesFromBasis, receiptsForTotal, scaleBasis, spreadCents } from './sharedBill.js'

const emptyLine = { account_id: '', cents: '' }
const emptyCategoryLine = { category_id: '', cents: '', receipt: '' }
const emptyDeposit = { category_id: '', cents: '', other_category_id: '' }

export default function Transactions({ pickerDate }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState(null)
  const [categories, setCategories] = useState(null)
  const [payees, setPayees] = useState(null)
  const [transactions, setTransactions] = useState(null)
  const [goals, setGoals] = useState(null)
  const [error, setError] = useState(null)
  // Ledger rows can name an archived entity (DESIGN.md § General concepts): these "all" lists
  // include archived rows and feed only the ledger table's name lookups, never the form pickers.
  const [accountsAll, setAccountsAll] = useState(null)
  const [categoriesAll, setCategoriesAll] = useState(null)
  const [payeesAll, setPayeesAll] = useState(null)
  const [goalsAll, setGoalsAll] = useState(null)
  const [splitsAll, setSplitsAll] = useState(null)

  const [date, setDate] = useState(pickerDate)
  const [memo, setMemo] = useState('')
  const [payeeId, setPayeeId] = useState(null)
  // Bumped on reset and on loading a transaction so the payee picker remounts with fresh text.
  const [formKey, setFormKey] = useState(0)
  const [accountLines, setAccountLines] = useState([{ ...emptyLine }])
  const [categoryLines, setCategoryLines] = useState([])
  const [deposits, setDeposits] = useState([])
  // Which recurring bill this payment paid and which due date: stated, never inferred.
  const [billLink, setBillLink] = useState(null)
  const [declinedBills, setDeclinedBills] = useState([])
  const [billDueDates, setBillDueDates] = useState(null)
  // A shared bill (DESIGN.md § Splits): the split chosen, who paid, the bill total, and the
  // unsigned breakdown the lines were last worked out from (null until there is a total).
  const [splitId, setSplitId] = useState('')
  const [paidById, setPaidById] = useState(null)
  const [billTotal, setBillTotal] = useState('')
  const [shareBasis, setShareBasis] = useState(null)
  // The breakdown a saved bill was opened with: every new total is scaled from it, never from the
  // last result, so typing a total digit by digit lands where entering it whole would. Null for a
  // new bill, which works its shares out from the split's percentages each time.
  const [shareStart, setShareStart] = useState(null)
  // A saved shared bill whose proportions cannot be read back: its lines are left for hand
  // editing and the total is read-only. Never worked out again from the split's percentages.
  const [totalLocked, setTotalLocked] = useState(false)
  // Picking a payee fills the form from their last payment (DESIGN.md § Payees): the lookup's
  // answer waits here and is applied by an effect, so it sees the form as it is now.
  const [payeeFill, setPayeeFill] = useState(null)
  const pickedPayee = useRef(null)
  // True while the filled-in category line follows the amount typed on the account line (a
  // plain transaction); a hand edit of the category's own amount ends it.
  const [categoryFollows, setCategoryFollows] = useState(false)
  // True once a split is chosen and an amount typed on my own account line became the Bill total:
  // each further keystroke there re-derives the total, because filling the lines rewrites them.
  // A hand edit of Bill total, a member line or a category amount, or a new split, ends it.
  const [totalFollows, setTotalFollows] = useState(false)
  // My paying account and the category, kept across Paid by changes.
  const ownPicks = useRef({ account_id: '', category_id: '' })
  const [newCategoryName, setNewCategoryName] = useState('')
  const [formError, setFormError] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  const formRef = useRef(null)
  // The phone's bottom bar hides while this form is being edited or has focus (the keyboard is up).
  const [formFocused, setFormFocused] = useState(false)
  const dateRef = useRef(null)
  const [editingId, setEditingId] = useState(null)
  const [predatesCheckNotes, setPredatesCheckNotes] = useState([])
  // Delete confirmation, opened in place of window.confirm (DESIGN.md § Earmarks): null when
  // closed, otherwise { hasBatchLines, removeBatch } for the transaction being deleted.
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  function refresh() {
    api.accounts.list().then(setAccounts).catch((e) => setError(e.message))
    api.categories.list(pickerDate).then(setCategories).catch((e) => setError(e.message))
    api.payees.list(pickerDate).then(setPayees).catch((e) => setError(e.message))
    api.transactions.list().then(setTransactions).catch((e) => setError(e.message))
    api.goals.list(pickerDate).then(setGoals).catch((e) => setError(e.message))
    api.accounts.list(undefined, true).then(setAccountsAll).catch((e) => setError(e.message))
    api.categories.list(undefined, true).then(setCategoriesAll).catch((e) => setError(e.message))
    api.payees.list(undefined, true).then(setPayeesAll).catch((e) => setError(e.message))
    api.goals.list(pickerDate, true, true).then(setGoalsAll).catch((e) => setError(e.message))
    api.splits.list(undefined, true).then(setSplitsAll).catch((e) => setError(e.message))
  }

  async function addPayee(name) {
    const payee = await api.payees.create({ name, created_on: date })
    setPayees((current) => [...(current ?? []), payee].sort((a, b) => a.name.localeCompare(b.name)))
    return payee
  }

  useEffect(refresh, [pickerDate])

  // The picker pre-fills the Record form (DESIGN.md § One clock): moving it replaces the date, even one
  // typed by hand, but an open edit keeps the date of the transaction being edited.
  useEffect(() => {
    if (editingId == null) setDate(pickerDate)
  }, [pickerDate])

  // The shell's + Add transaction lands here: bring the form into view with the first field ready.
  const addTransaction = location.state?.addTransaction
  useEffect(() => {
    if (!addTransaction) return
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
    formRef.current?.scrollIntoView?.({ block: 'start' })
    dateRef.current?.focus()
  }, [addTransaction])

  // "Record" on a bill's row on Categories lands here with the bill, its due date and its expected
  // amount in route state (DESIGN.md § Paying a bill): the form opens pre-filled and already linked,
  // with the payee and account of the bill's last linked payment. The user still saves it.
  const recordBill = location.state?.recordBill
  useEffect(() => {
    if (!recordBill) return
    const cents = recordBill.amount_cents == null ? '' : centsToFieldText(-recordBill.amount_cents)
    setDate(pickerDate)
    setCategoryLines([{ category_id: String(recordBill.category_id), cents }])
    setAccountLines([{ account_id: '', cents }])
    setBillLink({ goal_id: recordBill.goal_id, goal_due_on: recordBill.goal_due_on })
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
    Promise.all([api.goals.lastPayment(recordBill.goal_id), api.accounts.list()])
      .then(([last, accountList]) => {
        if (last.payee_id != null) setPayeeId(last.payee_id)
        if (last.account_id != null && accountList.some((a) => a.id === last.account_id)) {
          setAccountLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, account_id: String(last.account_id) } : l)))
        }
      })
      .catch((e) => setFormError(e.message))
  }, [recordBill])

  // Quick add's "More details" lands here with everything typed (DESIGN.md § Quick add): the date,
  // payee, signed amount, account, category and any bill the person said yes to. A payee whose last
  // payment was a shared bill is picked the ordinary way, so the form fills the split itself.
  const quickAdd = location.state?.quickAdd
  useEffect(() => {
    if (!quickAdd) return
    setDate(quickAdd.date)
    setAccountLines([{ account_id: quickAdd.account_id != null ? String(quickAdd.account_id) : '', cents: quickAdd.amount_text }])
    setCategoryLines(
      quickAdd.category_id != null ? [{ ...emptyCategoryLine, category_id: String(quickAdd.category_id), cents: quickAdd.amount_text }] : []
    )
    setCategoryFollows(quickAdd.category_id != null)
    if (quickAdd.goal) setBillLink(quickAdd.goal)
    if (quickAdd.payee_id != null) {
      setPayeeId(quickAdd.payee_id)
      pickedPayee.current = quickAdd.payee_id
      if (quickAdd.refill) pickPayee(quickAdd.payee_id)
    }
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
  }, [quickAdd])

  // "Settle up" on the Split expenses page lands here with their account and the signed cents to put on it
  // (DESIGN.md § Splits): a plain transfer, no category, my account left for the user to pick. The
  // amount is editable and the user still saves it.
  const settleUp = location.state?.settleUp
  useEffect(() => {
    if (!settleUp) return
    const theirs = String(settleUp.cents / 100)
    const mine = String(-settleUp.cents / 100)
    setDate(pickerDate)
    setAccountLines([{ account_id: String(settleUp.account_id), cents: theirs }, { account_id: '', cents: mine }])
    setCategoryLines([])
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
  }, [settleUp])

  // Spending from an account locked to a payee pre-fills that payee (DESIGN.md § Payee-locked
  // accounts) — only while none is chosen, and once per account per form, so clearing it sticks.
  const prefilledFor = useRef(new Set())
  function prefillLockedPayee(line) {
    const account = accounts?.find((a) => String(a.id) === line.account_id)
    const cents = parseCents(line.cents)
    if (!account || account.locked_payee_id == null || cents === null || cents >= 0) return
    if (payeeId !== null || prefilledFor.current.has(account.id)) return
    if (!payees?.some((p) => p.id === account.locked_payee_id)) return // archived: not offered
    prefilledFor.current.add(account.id)
    setPayeeId(account.locked_payee_id)
  }

  // Money leaving the budget into a tracking account with a boundary category pre-fills the
  // principal: that category, minus what landed on the tracking account (DESIGN.md § Accounts →
  // Money crossing the budget boundary). If the budget movement is bigger, a second line carries
  // the difference with no category: nothing is guessed. Money coming in pre-fills nothing.
  // Filled once per form, then only follows the account lines while still untouched.
  const boundaryFill = useRef({ filled: false, lines: null })
  useEffect(() => {
    if (editingId != null || splitId || !accounts || !categories) return
    let movement = 0
    let landed = 0
    let boundaryId = null
    for (const line of accountLines) {
      const account = accounts.find((a) => String(a.id) === line.account_id)
      const cents = parseCents(line.cents)
      if (!account || cents === null) continue
      if (account.on_budget) movement += cents
      else if (account.boundary_category_id != null && (boundaryId === null || boundaryId === account.boundary_category_id)) {
        boundaryId = account.boundary_category_id
        landed += cents
      }
    }
    if (boundaryId === null || movement >= 0 || landed <= 0 || !categories.some((c) => c.id === boundaryId)) return
    const principal = Math.max(movement, -landed)
    const remainder = movement - principal
    const fill = [{ category_id: String(boundaryId), cents: String(principal / 100) }]
    if (remainder !== 0) fill.push({ category_id: '', cents: String(remainder / 100) })
    const same = (a, b) => a.length === b.length && a.every((l, i) => l.category_id === b[i].category_id && l.cents === b[i].cents)
    const last = boundaryFill.current.lines
    const untouched = last && same(categoryLines, last)
    const blank = !boundaryFill.current.filled && categoryLines.every((l) => !l.category_id && !l.cents)
    if (!untouched && !blank) return
    if (untouched && same(last, fill)) return
    boundaryFill.current = { filled: true, lines: fill }
    setCategoryLines(fill.map((f) => ({ ...emptyCategoryLine, ...f })))
    setCategoryFollows(false)
  }, [accountLines, accounts, categories])

  function updateAccountLine(i, field, value) {
    prefillLockedPayee({ ...accountLines[i], [field]: value })
    if (field === 'cents' && chosenSplit && editingId == null && !totalLocked) {
      const isMember = chosenSplit.members.some((m) => String(m.account_id) === accountLines[i].account_id)
      if (isMember) {
        setTotalFollows(false)
      } else if (paidById === mePayeeId && (totalFollows || billTotal.trim() === '')) {
        const cents = parseCents(value)
        if (cents !== null && cents !== 0) {
          setTotalFollows(true)
          setBillTotal(String(Math.abs(cents) / 100))
          // The typed text stays on my line as typed ("-12." must not become "-12").
          fillShared(chosenSplit, basisFromSplit(Math.abs(cents), chosenSplit), cents < 0 ? 1 : -1, mePayeeId, value)
          return
        }
      }
    }
    setAccountLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
    if (i === 0 && field === 'cents' && categoryFollows) {
      setCategoryLines((lines) => lines.map((l, idx) => (idx === 0 ? { ...l, cents: value } : l)))
    }
  }
  function updateCategoryLine(i, field, value) {
    if (field === 'cents') {
      setCategoryFollows(false)
      setTotalFollows(false)
    }
    setCategoryLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  // Only the person picking a payee fills the form — never Record now, the locked-payee
  // prefill, an edit load or settle up, which set the payee some other way — and never when a
  // bill link is set or a saved transaction is open.
  async function pickPayee(id) {
    setPayeeId(id)
    pickedPayee.current = id
    setPayeeFill(null)
    if (id == null || billLink || editingId != null) return
    try {
      const fill = await api.payees.fill(id, pickerDate)
      if (pickedPayee.current === id) setPayeeFill({ payeeId: id, ...fill })
    } catch (err) {
      setFormError(err.message)
    }
  }

  // Fill only what is still empty; everything filled stays changeable and clearable.
  useEffect(() => {
    if (!payeeFill) return
    setPayeeFill(null)
    if (billLink || editingId != null || payeeId !== payeeFill.payeeId) return
    const usable = (id, list) => id != null && list?.some((x) => x.id === id)
    // An account already on another line stays there only: settle up must not get the same
    // account on both sides of the transfer.
    const accountId =
      usable(payeeFill.account_id, accounts) && !accountLines.some((l) => String(l.account_id) === String(payeeFill.account_id))
        ? String(payeeFill.account_id)
        : ''
    const categoryId = usable(payeeFill.category_id, categories) ? String(payeeFill.category_id) : ''
    const split = splitId === '' && payeeFill.split_id != null ? splitsAll?.find((s) => s.id === payeeFill.split_id) : null

    const emptyAccount = accountLines.findIndex((l) => !l.account_id)
    if (accountId && emptyAccount !== -1) {
      setAccountLines((lines) => lines.map((l, i) => (i === emptyAccount ? { ...l, account_id: accountId } : l)))
    }
    const hasCategory = categoryLines.some((l) => l.category_id)
    if (categoryId && !hasCategory) {
      const plain = !split && splitId === ''
      const typed = plain ? accountLines[0]?.cents ?? '' : ''
      const emptyCategory = categoryLines.findIndex((l) => !l.category_id)
      setCategoryLines(
        emptyCategory === -1
          ? [{ category_id: categoryId, cents: typed }]
          : categoryLines.map((l, i) => (i === emptyCategory ? { ...l, category_id: categoryId, cents: l.cents || typed } : l))
      )
      if (plain && (emptyCategory === -1 || !categoryLines[emptyCategory].cents)) setCategoryFollows(true)
    }
    if (split) {
      // The split's own arithmetic takes my account and the category from the picks.
      if (accountId && emptyAccount !== -1) ownPicks.current.account_id = accountId
      if (categoryId && !hasCategory) ownPicks.current.category_id = categoryId
      chooseSplit(String(split.id))
    }
  }, [payeeFill])

  function updateDeposit(i, field, value) {
    setDeposits((rows) => rows.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  }

  const mePayeeId = payees?.find((p) => p.is_me)?.id ?? null
  const chosenSplit = splitId ? splitsAll?.find((s) => String(s.id) === splitId) : null

  // Work the lines out from a breakdown (DESIGN.md § Splits). Every amount stays editable. Each
  // category row carries the receipt amount typed for it; my share is spread across the rows by
  // them, and a total that no longer matches them rescales them all by the same ratio.
  function fillShared(split, basis, sign, payerId, ownText, rows = categoryLines) {
    const memberAccountIds = new Set(split.members.map((m) => m.account_id))
    const ownLine = accountLines.find((l) => l.account_id && !memberAccountIds.has(Number(l.account_id)))
    if (ownLine) ownPicks.current.account_id = ownLine.account_id
    const categoryLine = rows.find((l) => l.category_id)
    if (categoryLine) ownPicks.current.category_id = categoryLine.category_id
    const cents = (text) => Math.abs(parseCents(text ?? '') ?? 0)
    let typed = rows.map((r) => cents(r.receipt))
    // Rows with no receipt yet (a plain transaction that just became a shared bill) weigh by their amounts.
    if (typed.every((c) => c === 0)) typed = rows.map((r) => cents(r.cents))
    const receipts = receiptsForTotal(basis.total, typed)
    const sourceRows = rows.length ? rows : [{ category_id: ownPicks.current.category_id }]
    const payerMember = split.members.find((m) => m.payee_id === payerId)
    const { accountLines: lines, categoryLines: cats } = linesFromBasis(basis, {
      sign,
      payerIsMe: payerId === mePayeeId,
      payerAccountId: ownPicks.current.account_id,
      payerMemberAccountId: payerMember?.account_id,
      categories: sourceRows.map((r, i) => ({
        category_id: rows.length ? r.category_id : ownPicks.current.category_id,
        receipt: rows.length ? receipts[i] : basis.total,
      })),
    })
    setShareBasis(basis)
    setAccountLines(
      lines.map((l, i) => ({
        account_id: String(l.account_id ?? ''),
        cents: i === 0 && ownText !== undefined && payerId === mePayeeId ? ownText : String(l.cents / 100),
      }))
    )
    setCategoryLines(
      cats.map((l, i) => ({
        category_id: String(l.category_id ?? ''),
        // A share of 0 worked out from a typed receipt is a stated 0; only a row with no receipt stays blank.
        cents: l.cents === 0 && !(rows.length ? receipts[i] > 0 : basis.total > 0) ? '' : String(l.cents / 100),
        // The text typed in a receipt box stays as typed ("12." must not become "12").
        receipt:
          rows.length && receipts[i] === 0
            ? ''
            : rows.length && cents(rows[i].receipt) === receipts[i]
              ? rows[i].receipt
              : String((rows.length ? receipts[i] : basis.total) / 100),
      }))
    )
  }

  function chooseSplit(id) {
    setSplitId(id)
    setCategoryFollows(false)
    setTotalFollows(false)
    setTotalLocked(false)
    setShareBasis(null)
    setShareStart(null)
    if (!id) {
      setPaidById(null)
      setBillTotal('')
      return
    }
    setPaidById(mePayeeId)
    // A total already typed on an account line becomes the bill total.
    const typed = accountLines.map((l) => parseCents(l.cents)).find((c) => c !== null && c !== 0)
    setBillTotal(typed == null ? '' : String(Math.abs(typed) / 100))
    if (typed == null) return
    const split = splitsAll.find((s) => String(s.id) === id)
    fillShared(split, basisFromSplit(Math.abs(typed), split), typed < 0 ? 1 : -1, mePayeeId)
  }

  function changeBillTotal(text) {
    if (totalLocked) return
    setTotalFollows(false)
    setBillTotal(text)
    const cents = parseCents(text)
    if (totalLocked || !chosenSplit || cents === null || cents === 0) return
    const total = Math.abs(cents)
    const basis = (shareStart && scaleBasis(shareStart, total)) || basisFromSplit(total, chosenSplit)
    fillShared(chosenSplit, basis, cents < 0 ? -1 : 1, paidById)
  }

  // A receipt amount typed on a category row: the Bill total becomes the sum of them and every
  // share is spread again. Sign follows the Bill total, as when it is typed by hand.
  function changeReceipt(i, text) {
    setTotalFollows(false)
    setCategoryFollows(false)
    const rows = categoryLines.map((l, idx) => (idx === i ? { ...l, receipt: text } : l))
    const total = rows.reduce((sum, l) => sum + Math.abs(parseCents(l.receipt) ?? 0), 0)
    if (!chosenSplit || totalLocked || total === 0) return setCategoryLines(rows)
    const sign = (parseCents(billTotal) ?? 0) < 0 ? -1 : 1
    setBillTotal(String((sign * total) / 100))
    const basis = (shareStart && scaleBasis(shareStart, total)) || basisFromSplit(total, chosenSplit)
    fillShared(chosenSplit, basis, sign, paidById, undefined, rows)
  }

  // The whole bill, sent only when someone other than Me paid — otherwise it is my account line.
  function sharedTotalCents() {
    if (!splitId || paidById == null || paidById === mePayeeId) return null
    const cents = parseCents(billTotal)
    return cents === null ? null : Math.abs(cents)
  }

  function changePaidBy(payeeId) {
    setPaidById(payeeId)
    setTotalFollows(false)
    if (!chosenSplit || !shareBasis) return
    fillShared(chosenSplit, shareBasis, (parseCents(billTotal) ?? 0) < 0 ? -1 : 1, payeeId)
  }

  function resetForm() {
    setPayeeFill(null)
    pickedPayee.current = null
    setCategoryFollows(false)
    setTotalFollows(false)
    setSplitId('')
    setTotalLocked(false)
    setPaidById(null)
    setBillTotal('')
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
    setBillLink(null)
    setDeclinedBills([])
    setFormError(null)
    setDeleteConfirm(null)
  }

  function editTransaction(t) {
    setPayeeFill(null)
    pickedPayee.current = null
    setCategoryFollows(false)
    setTotalFollows(false)
    setPredatesCheckNotes([])
    setDeleteConfirm(null)
    setEditingId(t.id)
    setDate(t.date)
    setMemo(t.memo || '')
    setPayeeId(t.payee_id)
    prefilledFor.current = new Set(t.account_lines.map((l) => l.account_id)) // an edit never re-fills
    setFormKey((k) => k + 1)
    setAccountLines(
      t.account_lines.map((l) => ({ account_id: String(l.account_id), cents: String(l.cents / 100) }))
    )
    setCategoryLines(
      t.category_lines.map((l) => ({ category_id: String(l.category_id), cents: String(l.cents / 100), receipt: '' }))
    )
    setDeposits(
      (t.deposits ?? []).map((d) => ({
        category_id: String(d.category_id),
        cents: String(d.cents / 100),
        other_category_id: d.other_category_id ? String(d.other_category_id) : '',
      }))
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
    setBillTotal(saved ? String((saved.sign * saved.basis.total) / 100) : '')
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
      resetForm()
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
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
  const envelopes = (categories ?? []).filter((c) => linkedCategoryIds.has(c.id))
  const depositTotal = deposits.reduce((sum, d) => sum + (parseCents(d.cents) ?? 0), 0)

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
      deposits: parsedDeposits,
    }

    try {
      const saved = editingId
        ? await api.transactions.update(editingId, body)
        : await api.transactions.create(body)
      setPredatesCheckNotes(saved.notes || [])
      const wasAdd = !editingId
      resetForm()
      // After a save in an add form, focus returns to the first field, ready for the next entry.
      setSavedNote(wasAdd ? 'Recorded.' : null)
      if (wasAdd) dateRef.current?.focus()
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  useRegisterFormOpen(formFocused || editingId != null)

  // Names and dates, never ids: "Edit · Loblaws, Oct 3".
  const editedTx = editingId ? transactions?.find((t) => t.id === editingId) : null
  const editedWho = editedTx && ((editedTx.payee_id != null && payeesAll?.find((p) => p.id === editedTx.payee_id)?.name) || editedTx.memo)
  const editedLabel = [editedWho, editedTx && formatDate(editedTx.date)].filter(Boolean).join(', ')
  const formTitle = editingId ? (editedLabel ? `Edit · ${editedLabel}` : 'Edit transaction') : 'Record a transaction'

  return (
    <div className="space-y-6 py-4">
      <h2 className="page-title hidden md:block">Transactions</h2>

      <section className="card space-y-3">
        {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
        {!error && !transactions && <LoadingRows />}
        {transactions && transactions.length === 0 && (
          <EmptyState>No transactions yet. Record the first one below.</EmptyState>
        )}
        {transactions && transactions.length > 0 && (
          <div className="overflow-x-auto">
            <LedgerTable
              transactions={transactions}
              names={{ accounts: accountsAll, categories: categoriesAll, payees: payeesAll, goals: goalsAll, splits: splitsAll }}
              onSelect={editTransaction}
              selectedId={editingId}
            />
          </div>
        )}
      </section>

      <section
        ref={formRef}
        className="card space-y-4"
        onFocus={() => setFormFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFormFocused(false)
        }}
      >
        <h2 className="text-section">{formTitle}</h2>
        {savedNote && <SaveNote>{savedNote}</SaveNote>}
        {predatesCheckNotes.map((note, i) => (
          <WarningNote key={i}>{note}</WarningNote>
        ))}
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="field-label">Date</span>
            <input
              ref={dateRef}
              type="date"
              className="w-full field"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="field-label">Memo</span>
            <input
              className="w-full field"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="field-label">Payee (who it went to or came from — optional)</span>
            <PayeePicker
              key={formKey}
              payees={payees}
              payeeId={payeeId}
              onSelect={pickPayee}
              onAdd={addPayee}
              onError={setFormError}
            />
          </label>

          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="field-label">Split (a shared bill — optional)</span>
              <select
                className="w-full field"
                aria-label="Split"
                value={splitId}
                onChange={(e) => chooseSplit(e.target.value)}
              >
                <option value="">No split</option>
                {[...(splitsAll ?? [])]
                  .filter((s) => !s.archived_on || String(s.id) === splitId)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.archived_on ? ' (archived)' : ''}</option>
                  ))}
              </select>
            </label>
            {chosenSplit && (
              <div className="flex flex-wrap gap-2">
                <MoneyInput
                  label="Bill total"
                  value={billTotal}
                  readOnly={totalLocked}
                  onChange={(text) => changeBillTotal(text)}
                />
                <label className="space-y-1">
                  <span className="field-label">Paid by</span>
                  <select
                    className="block field"
                    aria-label="Paid by"
                    value={paidById ?? ''}
                    onChange={(e) => changePaidBy(Number(e.target.value))}
                  >
                    {mePayeeId != null && <option value={mePayeeId}>Me</option>}
                    {[...chosenSplit.members].sort((a, b) => a.payee_name.localeCompare(b.payee_name)).map((m) => (
                      <option key={m.payee_id} value={m.payee_id}>{m.payee_name}</option>
                    ))}
                  </select>
                </label>
                {totalLocked && (
                  <p className="basis-full text-sm text-text-3">
                    This bill no longer matches its split, so change the amounts below by hand.
                  </p>
                )}
                <p className="basis-full text-sm text-text-3">
                  Only your share is spending. Every amount below can still be changed before you save.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <span className="field-label">Account lines (which accounts this touched)</span>
            {accountLines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="min-w-40 flex-1">
                  <ChoicePicker
                    items={accounts ?? []}
                    value={line.account_id}
                    onChange={(id) => updateAccountLine(i, 'account_id', id)}
                    placeholder="Select account…"
                    ariaLabel="Account"
                  />
                </div>
                <MoneyInput signed value={line.cents} onChange={(text) => updateAccountLine(i, 'cents', text)} />
              </div>
            ))}
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setAccountLines((lines) => [...lines, { ...emptyLine }])}
            >
              + add account line
            </button>
          </div>

          <div className="space-y-2">
            <span className="field-label">Category lines (what it was for — leave empty for unassigned)</span>
            {categoryLines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="min-w-40 flex-1">
                  <ChoicePicker
                    items={categories ?? []}
                    value={line.category_id}
                    onChange={(id) => updateCategoryLine(i, 'category_id', id)}
                    placeholder="Select category…"
                    ariaLabel="Category"
                  />
                </div>
                {chosenSplit && !totalLocked && (
                  <MoneyInput
                    placeholder="Receipt"
                    aria-label="Receipt amount"
                    value={line.receipt ?? ''}
                    onChange={(text) => changeReceipt(i, text)}
                  />
                )}
                <MoneyInput
                  signed
                  aria-label={chosenSplit && !totalLocked ? 'Your share' : undefined}
                  value={line.cents}
                  onChange={(text) => updateCategoryLine(i, 'cents', text)}
                />
              </div>
            ))}
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setCategoryLines((lines) => [...lines, { ...emptyCategoryLine }])}
            >
              + add category line
            </button>
          </div>

          {(offeredBill || billLink) && (
            <div className="rounded-lg bg-raised p-3 space-y-2 text-sm">
              <p>
                {billLink ? 'Marked as paying ' : 'This pays '}
                <strong>{offeredBill?.goal.name ?? `bill #${billLink.goal_id}`}</strong>, due{' '}
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
          )}

          {linkedNet !== 0 && (
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
                    onClick={() => setDeposits((rows) => rows.filter((_, idx) => idx !== i))}
                  >
                    remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setDeposits((rows) => [...rows, { ...emptyDeposit }])}
              >
                + add envelope
              </button>
              {deposits.length > 0 && (
                <p className="text-sm text-text-2">
                  {formatCents(depositTotal)} of {formatCents(Math.abs(linkedNet))} directed.
                </p>
              )}
            </div>
          )}

          {formError && <RefusalNote>{formError}</RefusalNote>}

          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Save changes' : 'Record transaction'}
            </button>
            {editingId && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    resetForm()
                    setPredatesCheckNotes([])
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-destructive"
                  onClick={openDeleteConfirm}
                >
                  Delete
                </button>
              </>
            )}
          </div>
          {deleteConfirm && (
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
          )}
        </form>

        <form className="flex gap-2 pt-2" onSubmit={addCategory}>
          <input
            className="flex-1 field text-sm"
            placeholder="New category name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            Add category
          </button>
        </form>
      </section>
    </div>
  )
}
