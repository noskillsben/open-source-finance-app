import { ArrowLeft } from 'lucide-react'
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
import LedgerTable, { groupByMonth, monthKey } from './LedgerTable.jsx'
import { useFilters } from './utils/useFilters.js'
import ListFilters from './components/ListFilters.jsx'
import FilterPicker from './components/FilterPicker.jsx'
import { NEED_LEVELS } from './utils/order.js'
import PayeePicker from './PayeePicker.jsx'
import { basisFromSplit, basisFromTransaction, linesFromBasis, receiptsForTotal, scaleBasis, spreadCents } from './sharedBill.js'

const emptyLine = { account_id: '', cents: '' }
const emptyCategoryLine = { category_id: '', cents: '', receipt: '' }
// A new form starts on Spent, as Quick add does: the Amount holds just the sign until digits arrive.
// A bare sign is a blank Amount wherever it is read.
const NEW_AMOUNT = '-'
const readable = (text) => (parseCents(text) === null ? '' : text)
const emptyDeposit = { category_id: '', cents: '', other_category_id: '' }

// One Amount is typed once (DESIGN.md § Transactions): what the transaction cost or brought in, or on
// a plain transfer what moved. A side with one line takes it; a transfer (two account lines, no
// category) takes it and its opposite; anything else shows a box per line.
const negate = (text) => {
  const t = (text ?? '').trim()
  if (t === '') return ''
  return /^[-−]/.test(t) ? t.replace(/^[-−]\s*/, '') : `-${t}`
}
const isTransfer = (accountCount, categoryCount) => accountCount === 2 && categoryCount === 0
const accountSideDerived = (accountCount, categoryCount) => accountCount === 1 || isTransfer(accountCount, categoryCount)

// The lines a typed Amount fills in, on the sides that derive from it. A chosen split is worked out
// by the split's own arithmetic instead, so its lines are left alone.
function deriveLines(typed, aLines, cLines) {
  const amount = readable(typed)
  const a = accountSideDerived(aLines.length, cLines.length)
    ? aLines.map((l, i) => ({ ...l, cents: i === 0 ? amount : negate(amount) }))
    : aLines
  const c = cLines.length === 1 ? cLines.map((l) => ({ ...l, cents: amount })) : cLines
  return { a, c }
}

// One function picks the shape from lines already worked out (a saved transaction, Settle up, Record,
// Quick add's More details): Amount is the category lines' sum, else the first account line; a side
// whose lines are not what the Amount would derive keeps its boxes.
function readShape(aLines, cLines) {
  let amount = ''
  if (cLines.length === 1) amount = cLines[0].cents
  else if (cLines.length > 1) {
    const cents = cLines.map((l) => parseCents(l.cents))
    amount = cents.some((c) => c === null) ? '' : String(cents.reduce((x, y) => x + y, 0) / 100)
  } else if (aLines.length) amount = aLines[0].cents
  const want = parseCents(amount)
  const held = (l) => parseCents(l.cents)
  const forceA =
    accountSideDerived(aLines.length, cLines.length) &&
    aLines.some((l, i) => held(l) !== (i === 0 || want === null ? want : -want))
  const forceC = cLines.length === 1 && held(cLines[0]) !== want
  return { amount, forceA, forceC }
}

// +1 for a bill paid (Spent), -1 for a refund (Received); a blank or unsigned-zero Amount reads as paid.
const splitSign = (text) => {
  const cents = parseCents(text)
  return cents === null || cents === 0 ? 1 : cents < 0 ? 1 : -1
}

const COLLAPSED_KEY = 'transactions.collapsed'
const DEFAULT_SORT = { key: 'date', dir: 'desc' }
const NO_FILTERS = { search: '', account: '', category: '', payee: '', domain: '', need: '' }

const marked = (list) => (list ?? []).map((e) => ({ id: e.id, name: e.archived_on ? `${e.name} (archived)` : e.name }))

// Every active facet must hold (DESIGN.md § UI conventions). Category is that exact category, never its
// descendants; domain and need level are the category's as it is now.
function matches(t, f, categoriesAll, payeesAll) {
  if (f.account && !t.account_lines.some((l) => String(l.account_id) === f.account)) return false
  if (f.category && !t.category_lines.some((l) => String(l.category_id) === f.category)) return false
  if (f.payee && String(t.payee_id) !== f.payee) return false
  if (f.domain || f.need) {
    const cats = t.category_lines.map((l) => categoriesAll?.find((c) => c.id === l.category_id))
    if (f.domain && !cats.some((c) => c && String(c.domain_id) === f.domain)) return false
    if (f.need && !cats.some((c) => c && c.need_level === f.need)) return false
  }
  const needle = f.search.trim().toLowerCase()
  if (needle) {
    const payee = t.payee_id == null ? '' : (payeesAll?.find((p) => p.id === t.payee_id)?.name ?? '')
    if (!`${t.memo ?? ''}\n${payee}`.toLowerCase().includes(needle)) return false
  }
  return true
}

// Which months are collapsed is a per-device convenience (DESIGN.md § Nested and grouped lists):
// localStorage, and the page works without it.
function loadCollapsed() {
  try {
    const keys = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return Array.isArray(keys) ? keys : []
  } catch {
    return []
  }
}

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
  const [domainsAll, setDomainsAll] = useState(null)

  const [date, setDate] = useState(pickerDate)
  const [memo, setMemo] = useState('')
  const [payeeId, setPayeeId] = useState(null)
  // Bumped on reset and on loading a transaction so the payee picker remounts with fresh text.
  const [formKey, setFormKey] = useState(0)
  const [accountLines, setAccountLines] = useState([{ ...emptyLine }])
  const [categoryLines, setCategoryLines] = useState([])
  const [deposits, setDeposits] = useState([])
  // Once the user has changed the envelope step it stops being re-filled from the balance.
  const depositsTouched = useRef(false)
  // Which recurring bill this payment paid and which due date: stated, never inferred.
  const [billLink, setBillLink] = useState(null)
  const [declinedBills, setDeclinedBills] = useState([])
  const [billDueDates, setBillDueDates] = useState(null)
  // A shared bill (DESIGN.md § Splits): the split chosen, who paid, the bill total, and the
  // unsigned breakdown the lines were last worked out from (null until there is a total).
  const [splitId, setSplitId] = useState('')
  const [paidById, setPaidById] = useState(null)
  // The one Amount, signed text as the box holds it. With a split chosen it is the Bill total.
  const [amount, setAmount] = useState(NEW_AMOUNT)
  // Boxes kept open on a side whose lines are not what the Amount derives (see readShape).
  const [forceAccountBoxes, setForceAccountBoxes] = useState(false)
  const [forceCategoryBoxes, setForceCategoryBoxes] = useState(false)
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
  // My paying account and the category, kept across Paid by changes.
  const ownPicks = useRef({ account_id: '', category_id: '' })
  const [newCategoryName, setNewCategoryName] = useState('')
  const [formError, setFormError] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  // The form is a page of its own (DESIGN.md § Visual design → Where forms open), shown in place of the
  // list while `formOpen`. It is component state on /transactions, not a sub-path: route state
  // pre-fills it and nothing else needs to link to it.
  const [formOpen, setFormOpen] = useState(false)
  // The row just saved, highlighted when the list comes back.
  const [highlightId, setHighlightId] = useState(null)
  const { filters, setFilter, clear: clearFilters, active: clearShows, filtered, sort, toggleSort } = useFilters('transactions.filters', NO_FILTERS, DEFAULT_SORT, 'transactions.sort')
  const [collapsed, setCollapsedState] = useState(loadCollapsed)
  function setCollapsed(keys) {
    setCollapsedState(keys)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(keys))
    } catch {
      // private window or blocked storage: the state just doesn't survive a reload
    }
  }
  const dateRef = useRef(null)
  const [editingId, setEditingId] = useState(null)
  const [predatesCheckNotes, setPredatesCheckNotes] = useState([])
  // Delete confirmation, opened in place of window.confirm (DESIGN.md § Earmarks): null when
  // closed, otherwise { hasBatchLines, removeBatch } for the transaction being deleted.
  const [deleteConfirm, setDeleteConfirm] = useState(null)

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
    api.domains.list(undefined, true).then(setDomainsAll).catch((e) => setError(e.message))
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

  // The shell's + Add transaction lands here: a blank form, even if the list's own form was open.
  const addTransaction = location.state?.addTransaction
  useEffect(() => {
    if (!addTransaction) return
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
    openAdd()
  }, [addTransaction])

  // "Record" on a bill's row on Categories lands here with the bill, its due date and its expected
  // amount in route state (DESIGN.md § Paying a bill): the form opens pre-filled and already linked,
  // with the payee and account of the bill's last linked payment. The user still saves it.
  const recordBill = location.state?.recordBill
  useEffect(() => {
    if (!recordBill) return
    setFormOpen(true)
    const cents = recordBill.amount_cents == null ? '' : centsToFieldText(-recordBill.amount_cents)
    setDate(pickerDate)
    showLines([{ account_id: '', cents }], [{ ...emptyCategoryLine, category_id: String(recordBill.category_id), cents }])
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
    setFormOpen(true)
    setDate(quickAdd.date)
    setMemo(quickAdd.memo || '')
    showLines(
      [{ account_id: quickAdd.account_id != null ? String(quickAdd.account_id) : '', cents: quickAdd.amount_text }],
      quickAdd.category_id != null ? [{ ...emptyCategoryLine, category_id: String(quickAdd.category_id), cents: quickAdd.amount_text }] : []
    )
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
    setFormOpen(true)
    const theirs = String(settleUp.cents / 100)
    const mine = String(-settleUp.cents / 100)
    setDate(pickerDate)
    showLines([{ account_id: String(settleUp.account_id), cents: theirs }, { account_id: '', cents: mine }], [])
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
  }, [accountLines, accounts, categories])

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
      const typed = plain ? readable(amount) : ''
      const emptyCategory = categoryLines.findIndex((l) => !l.category_id)
      setCategoryLines(
        emptyCategory === -1
          ? [{ category_id: categoryId, cents: typed }]
          : categoryLines.map((l, i) => (i === emptyCategory ? { ...l, category_id: categoryId, cents: l.cents || typed } : l))
      )
    }
    if (split) {
      // The split's own arithmetic takes my account and the category from the picks.
      if (accountId && emptyAccount !== -1) ownPicks.current.account_id = accountId
      if (categoryId && !hasCategory) ownPicks.current.category_id = categoryId
      chooseSplit(String(split.id))
    }
  }, [payeeFill])

  function updateDeposit(i, field, value) {
    depositsTouched.current = true
    setDeposits((rows) => rows.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  }

  const mePayeeId = payees?.find((p) => p.is_me)?.id ?? null
  const chosenSplit = splitId ? splitsAll?.find((s) => String(s.id) === splitId) : null

  // Work the lines out from a breakdown (DESIGN.md § Splits). Every amount stays editable. Each
  // category row carries the receipt amount typed for it; my share is spread across the rows by
  // them, and a total that no longer matches them rescales them all by the same ratio.
  function fillShared(split, basis, sign, payerId, rows = categoryLines) {
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
        cents: String(l.cents / 100),
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
    setTotalLocked(false)
    setShareBasis(null)
    setShareStart(null)
    if (!id) {
      // The lines stay as the split left them, now as boxes of their own.
      setPaidById(null)
      setForceAccountBoxes(true)
      setForceCategoryBoxes(true)
      return
    }
    setPaidById(mePayeeId)
    // The Amount already typed becomes the Bill total.
    const typed = parseCents(amount)
    if (typed == null || typed === 0) return
    const split = splitsAll.find((s) => String(s.id) === id)
    fillShared(split, basisFromSplit(Math.abs(typed), split), splitSign(amount), mePayeeId)
  }

  // A receipt amount typed on a category row: the Bill total becomes the sum of them and every
  // share is spread again. Sign follows the Bill total, as when it is typed by hand.
  function changeReceipt(i, text) {
    const rows = categoryLines.map((l, idx) => (idx === i ? { ...l, receipt: text } : l))
    const total = rows.reduce((sum, l) => sum + Math.abs(parseCents(l.receipt) ?? 0), 0)
    if (!chosenSplit || totalLocked || total === 0) return setCategoryLines(rows)
    const sign = splitSign(amount)
    setAmount(String((-sign * total) / 100))
    const basis = (shareStart && scaleBasis(shareStart, total)) || basisFromSplit(total, chosenSplit)
    fillShared(chosenSplit, basis, sign, paidById, rows)
  }

  // The whole bill, sent only when someone other than Me paid — otherwise it is my account line.
  function sharedTotalCents() {
    if (!splitId || paidById == null || paidById === mePayeeId) return null
    const cents = parseCents(amount)
    return cents === null ? null : Math.abs(cents)
  }

  function changePaidBy(payeeId) {
    setPaidById(payeeId)
    if (!chosenSplit || !shareBasis) return
    fillShared(chosenSplit, shareBasis, splitSign(amount), payeeId)
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
    if (editingId != null || depositsTouched.current || prefillCategoryId == null || !date) return
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

  const shown = (transactions ?? []).filter((t) => matches(t, filters, categoriesAll, payeesAll))

  if (!formOpen) {
    return (
      <div className="space-y-6 py-4">
        <h2 className="page-title hidden md:block">Transactions</h2>

        <section className="card space-y-3">
          {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
          {savedNote && <SaveNote>{savedNote}</SaveNote>}
          {predatesCheckNotes.map((note, i) => (
            <WarningNote key={i}>{note}</WarningNote>
          ))}
          {!error && !transactions && <LoadingRows />}
          {transactions && transactions.length === 0 && (
            <EmptyState action={<Button onClick={openAdd}>Record a transaction</Button>}>No transactions yet.</EmptyState>
          )}
          {transactions && transactions.length > 0 && (
            <ListFilters
              noun="transactions"
              search={filters.search}
              onSearch={(v) => setFilter('search', v)}
              facets={[{ name: 'need', label: 'Need level', value: filters.need, onChange: (v) => setFilter('need', v), options: NEED_LEVELS }]}
              active={clearShows}
              onClear={clearFilters}
            >
              <FilterPicker label="Account" items={marked(accountsAll)} value={filters.account} onChange={(v) => setFilter('account', v)} />
              <FilterPicker label="Category" items={marked(categoriesAll)} value={filters.category} onChange={(v) => setFilter('category', v)} />
              <FilterPicker label="Payee" items={marked(payeesAll)} value={filters.payee} onChange={(v) => setFilter('payee', v)} />
              <FilterPicker label="Domain" items={marked(domainsAll)} value={filters.domain} onChange={(v) => setFilter('domain', v)} />
            </ListFilters>
          )}
          {transactions && transactions.length > 0 && !filtered && (
            <div className="flex">
              <Button variant="quiet" onClick={() => setCollapsed([])}>Expand all</Button>
              <Button variant="quiet" onClick={() => setCollapsed(groupByMonth(transactions, DEFAULT_SORT, () => '').map((g) => g.key))}>
                Collapse all
              </Button>
            </div>
          )}
          {transactions && transactions.length > 0 && shown.length === 0 && (
            <EmptyState action={<Button onClick={clearFilters}>Clear filters</Button>}>No transactions match these filters.</EmptyState>
          )}
          {transactions && shown.length > 0 && (
            <div className="overflow-x-auto">
              <LedgerTable
                transactions={shown}
                names={{ accounts: accountsAll, categories: categoriesAll, payees: payeesAll, goals: goalsAll, splits: splitsAll }}
                onSelect={editTransaction}
                selectedId={highlightId}
                byMonth={{
                  sort,
                  onSort: toggleSort,
                  // While filtering, every month holding a match is open; the stored list is left alone.
                  collapsed: filtered ? [] : collapsed,
                  onToggle: (key) => {
                    if (filtered) return
                    setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])
                  },
                  accountId: filters.account ? Number(filters.account) : null,
                }}
              />
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-4">
      <button type="button" className="btn btn-quiet" onClick={closeForm}>
        <ArrowLeft aria-hidden="true" size={20} />
        Transactions
      </button>

      <section className="card space-y-4">
        <h2 className="text-section">{formTitle}</h2>
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

          <MoneyInput
            signed
            label="Amount"
            value={amount}
            readOnly={totalLocked}
            onChange={changeAmount}
          />

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
                {accountBoxes && (
                  <MoneyInput signed aria-label="Account amount" value={line.cents} onChange={(text) => updateAccountLine(i, 'cents', text)} />
                )}
                {accountLines.length > 1 && (
                  <button type="button" className="btn btn-quiet" aria-label="Remove account line" onClick={() => removeAccountLine(i)}>
                    remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-quiet" onClick={addAccountLine}>
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
                {categoryBoxes && (
                  <MoneyInput
                    signed
                    aria-label={chosenSplit && !totalLocked ? 'Your share' : 'Category amount'}
                    value={line.cents}
                    onChange={(text) => updateCategoryLine(i, 'cents', text)}
                  />
                )}
                <button type="button" className="btn btn-quiet" aria-label="Remove category line" onClick={() => removeCategoryLine(i)}>
                  remove
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-quiet" onClick={addCategoryLine}>
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
          )}

          {formError && <RefusalNote>{formError}</RefusalNote>}

          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Save changes' : 'Record transaction'}
            </button>
            {editingId && (
              <>
                <button type="button" className="btn btn-secondary" onClick={closeForm}>
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
