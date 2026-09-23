import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from './api.js'
import NamePicker from './NamePicker.jsx'
import { formatCents, formatDate, parseCents } from './utils/format.js'

// The same roll-forward DESIGN.md § Income streams describes for "next payday" (app/services/
// cadence.py), reused here only for display and for the last-period window — never written back.
function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = total - year * 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

function stepDate(cadence, cadenceWeeks, iso, n) {
  if (cadence === 'weeks') {
    const dt = new Date(`${iso}T00:00:00Z`)
    dt.setUTCDate(dt.getUTCDate() + cadenceWeeks * 7 * n)
    return dt.toISOString().slice(0, 10)
  }
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[cadence] ?? 1
  return addMonths(iso, months * n)
}

const emptyRow = () => ({ category: {}, amount: '' })

// The fixed ordinal scale (DESIGN.md § Need levels), in trim order: wants go first once the
// leftover is negative, so the rows most worth cutting are the ones on top. A category with no
// need level sorts after every leveled one, alongside the rest.
const NEED_TRIM_ORDER = { want: 0, nice_to_have: 1, should: 2, need: 3 }

function sortByNeedIfShort(rows, categoriesById, leftover) {
  if (leftover >= 0) return rows
  return [...rows].sort((a, b) => {
    const na = NEED_TRIM_ORDER[categoriesById.get(a.categoryId)?.need_level] ?? 4
    const nb = NEED_TRIM_ORDER[categoriesById.get(b.categoryId)?.need_level] ?? 4
    return na - nb
  })
}

// Category + amount rows, added and removed freely — the shape blocks 3, 5 and 9 all share.
function AmountRows({ rows, categories, onChange, addLabel }) {
  const set = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i))
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <NamePicker
              label="Category"
              items={categories}
              initialId={r.category.id}
              onChange={(id, text) => set(i, { category: { id, text } })}
            />
          </div>
          <label className="block text-sm w-28">
            <span className="text-paper-soft">Amount</span>
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
              value={r.amount}
              onChange={(e) => set(i, { amount: e.target.value })}
            />
          </label>
          <button type="button" className="text-xs text-accent pb-2" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="text-xs text-accent" onClick={() => onChange([...rows, emptyRow()])}>
        {addLabel}
      </button>
    </div>
  )
}

function rowsToMoves(rows) {
  const moves = []
  for (const r of rows) {
    const cents = parseCents(r.amount)
    if (r.category.id == null || !cents) continue
    if (cents > 0) moves.push({ category_id: r.category.id, cents })
  }
  return moves
}

export default function PayRecord({ pickerDate }) {
  const { id } = useParams()
  const isOneOff = id === undefined
  const streamId = Number(id)
  const navigate = useNavigate()

  const [streams, setStreams] = useState(null)
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [goals, setGoals] = useState([])
  const [transactions, setTransactions] = useState(null)
  const [error, setError] = useState(null)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  const [payday, setPayday] = useState(null)
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
  const [goalsLoaded, setGoalsLoaded] = useState(false)
  const [retainRemoved, setRetainRemoved] = useState(new Set()) // block 4: goal ids taken out
  const [billAmounts, setBillAmounts] = useState({}) // block 6: goal id -> amount text
  const [fundingAmounts, setFundingAmounts] = useState({}) // block 7: goal id -> amount text
  const [fundingSkipped, setFundingSkipped] = useState(new Set()) // block 7: goal ids skipped
  const [targetAmounts, setTargetAmounts] = useState({}) // block 8: goal id -> amount text
  const [readyToAssign, setReadyToAssign] = useState(null) // block 10: /api/ready-to-assign summary

  const stream = streams?.find((s) => s.id === streamId) ?? null

  function refreshTransactions() {
    return api.transactions.list().then(setTransactions).catch((e) => setError(e.message))
  }

  function refresh() {
    api.incomeStreams.list(pickerDate, true).then(setStreams).catch((e) => setError(e.message))
    refreshTransactions()
  }

  useEffect(refresh, [pickerDate])

  // Seed the payday once the stream is known — or, with no named pay behind this screen, from
  // the app-wide picker date, since there is no next payday to anchor on.
  useEffect(() => {
    if (payday !== null) return
    if (isOneOff) return setPayday(pickerDate)
    if (!stream) return
    setPayday(stream.next_payday)
  }, [stream, payday, isOneOff, pickerDate])

  useEffect(() => {
    if (!payday) return
    api.categories.list(payday).then(setCategories).catch((e) => setError(e.message))
    api.accounts.list(payday).then(setAccounts).catch((e) => setError(e.message))
    setGoalsLoaded(false)
    api.goals.list(payday)
      .then((g) => { setGoals(g); setGoalsLoaded(true) })
      .catch((e) => setError(e.message))
  }, [payday])

  function refreshReadyToAssign() {
    if (!payday) return
    return api.readyToAssign(payday).then(setReadyToAssign).catch((e) => setError(e.message))
  }

  useEffect(() => { refreshReadyToAssign() }, [payday])

  // Every goal bound to this named pay (DESIGN.md § Goals are paid by a named pay).
  const streamGoals = useMemo(
    () => (stream ? goals.filter((g) => g.goal.income_stream_id === stream.id) : []),
    [goals, stream]
  )
  const retainGoals = useMemo(
    () => streamGoals.filter((g) => g.goal.kind === 'commitment' && g.goal.percent_of_net != null),
    [streamGoals]
  )
  const billGoals = useMemo(
    () =>
      streamGoals
        .filter((g) => g.goal.kind === 'recurring_bill')
        .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')),
    [streamGoals]
  )
  const fundingGoals = useMemo(
    () =>
      streamGoals.filter(
        (g) => g.goal.kind === 'commitment' && (g.goal.amount_cents != null || g.goal.level_cents != null)
      ),
    [streamGoals]
  )
  const targetGoals = useMemo(() => streamGoals.filter((g) => g.goal.kind === 'target'), [streamGoals])

  // Prefill gross/deductions/goal blocks from the named pay once its categories and goals have
  // loaded, so each row can seed its text along with its id (once only).
  useEffect(() => {
    if (!stream || seeded || categories.length === 0 || !goalsLoaded) return
    setSeeded(true)
    setGross(stream.expected_gross_cents == null ? '' : (stream.expected_gross_cents / 100).toFixed(2))
    setDeductionsOn(stream.deductions.length > 0 || stream.expected_gross_cents != null)
    setDeductions(
      stream.deductions.map((d) => ({
        category: { id: d.category_id, text: categories.find((c) => c.id === d.category_id)?.name ?? '' },
        amount: (d.amount_cents / 100).toFixed(2),
      }))
    )
    setBillAmounts(
      Object.fromEntries(
        billGoals.map((g) => [g.goal.id, g.due_by_next_payday_cents != null ? (g.due_by_next_payday_cents / 100).toFixed(2) : ''])
      )
    )
    setTargetAmounts(
      Object.fromEntries(
        targetGoals.map((g) => [g.goal.id, g.due_by_next_payday_cents != null ? (g.due_by_next_payday_cents / 100).toFixed(2) : ''])
      )
    )
    setFundingAmounts(
      Object.fromEntries(
        fundingGoals.map((g) => [g.goal.id, ((g.goal.amount_cents ?? g.owed_cents ?? 0) / 100).toFixed(2)])
      )
    )
  }, [stream, categories, seeded, goalsLoaded, billGoals, targetGoals, fundingGoals])

  // Never matches on the one-off route: streamId is Number(undefined) === NaN there, and a
  // one-off transaction is written with income_stream_id: null, so NaN === null is always false.
  // That's deliberate, not an oversight — nothing in the schema distinguishes a transaction this
  // screen wrote from any other unlinked one dated the same day, so matching on
  // `income_stream_id == null` would misfire on an unrelated same-day transaction and block a
  // real recording. Revisiting an already-recorded one-off to redo or delete it is out of scope
  // here; tracked as a follow-up (#116 PR review).
  const existingTransaction = useMemo(
    () => transactions?.find((t) => t.income_stream_id === streamId && t.date === payday) ?? null,
    [transactions, streamId, payday]
  )

  const grossCents = parseCents(gross) ?? 0
  const deductionTotal = deductions.reduce((sum, d) => sum + (parseCents(d.amount) ?? 0), 0)
  const net = deductionsOn ? grossCents - deductionTotal : (parseCents(netOnly) ?? 0)

  const oneOffTotal = rowsToMoves(oneOff).reduce((sum, m) => sum + m.cents, 0)

  // Where this pay lands: read off the named pay, or, with no named pay behind this screen,
  // whatever the user picked (DESIGN.md § Record income — the pay screen: "A one-off on the pay
  // screen" — nothing pre-filled).
  const incomeCategoryId = isOneOff ? (oneOffIncomeCategory.id ?? null) : (stream?.income_category_id ?? null)
  const destinationAccountId = isOneOff
    ? (oneOffDestinationAccount.id ?? null)
    : (stream?.destination_account_id ?? null)

  const liveGoalCategoryIds = useMemo(() => new Set(goals.map((g) => g.goal.category_id)), [goals])
  const deductionCategoryIds = useMemo(
    () => new Set(deductions.map((d) => d.category.id).filter((id) => id != null)),
    [deductions]
  )
  const everythingElseCategories = useMemo(() => {
    return categories
      .filter((c) => !c.archived_on)
      .filter((c) => !liveGoalCategoryIds.has(c.id))
      .filter((c) => c.id !== incomeCategoryId && !deductionCategoryIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [categories, liveGoalCategoryIds, deductionCategoryIds, incomeCategoryId])

  // Last period's actual for a named pay, last calendar month's for a one-off — there is no pay
  // period to compare a one-off against (DESIGN.md § "A one-off on the pay screen").
  const lastPeriodActuals = useMemo(() => {
    if (!payday || !transactions) return {}
    let start
    let end
    if (isOneOff) {
      end = `${payday.slice(0, 7)}-01`
      start = addMonths(end, -1)
    } else if (stream) {
      start = stepDate(stream.cadence, stream.cadence_weeks, payday, -1)
      end = payday
    } else {
      return {}
    }
    const totals = {}
    for (const t of transactions) {
      if (t.date < start || t.date >= end) continue
      for (const line of t.category_lines) {
        if (line.cents >= 0) continue
        totals[line.category_id] = (totals[line.category_id] ?? 0) - line.cents
      }
    }
    return totals
  }, [transactions, payday, stream, isOneOff])

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

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
          cents: Math.round((parseFloat(g.goal.percent_of_net) / 100) * net),
        })),
    [retainGoals, retainRemoved, net]
  )
  const retainTotal = retainRows.reduce((sum, r) => sum + r.cents, 0)

  const billRows = billGoals.map((g) => ({
    goalId: g.goal.id,
    categoryId: g.goal.category_id,
    name: g.goal.name,
    dueDate: g.due_date,
    expectedCents: g.goal.amount_cents,
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
  const leftover = net - retainTotal - oneOffTotal - billTotal - fundingTotal - targetTotal - everythingElseTotal

  // Block 10: categories currently receiving money on this screen, recomputed live as the user
  // types, so Short by never offers to cover a goal from itself.
  const fundedThisScreenCategoryIds = useMemo(() => {
    const ids = new Set()
    for (const r of [...retainRows, ...billRows, ...fundingRows, ...targetRows]) {
      if (r.cents > 0) ids.add(r.categoryId)
    }
    for (const m of [...rowsToMoves(oneOff), ...everythingElseMoves()]) ids.add(m.category_id)
    return ids
  }, [retainRows, billRows, fundingRows, targetRows, oneOff, everythingElse])

  const shortByRows = useMemo(() => {
    if (!readyToAssign) return []
    return readyToAssign.categories
      .filter((c) => c.available_cents > 0 && !fundedThisScreenCategoryIds.has(c.category_id))
      .map((c) => ({
        categoryId: c.category_id,
        name: categoriesById.get(c.category_id)?.name ?? '',
        availableCents: c.available_cents,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [readyToAssign, fundedThisScreenCategoryIds, categoriesById])

  async function coverFrom(row) {
    setFormError(null)
    try {
      await api.earmarkMoves.create({
        date: payday,
        cents: Math.min(-leftover, row.availableCents),
        from_category_id: row.categoryId,
      })
      await refreshReadyToAssign()
    } catch (err) {
      setFormError(err.message)
    }
  }

  if (error) return <p className="text-bad py-6">Could not reach the backend: {error}</p>
  if (!streams || !payday) return <p className="py-6">Loading…</p>
  if (!isOneOff && !stream) return <p className="text-bad py-6">No named pay with id {streamId}.</p>

  const periodEnd = isOneOff ? null : stepDate(stream.cadence, stream.cadence_weeks, payday, 1)

  async function record(e) {
    e.preventDefault()
    setFormError(null)
    if (existingTransaction) {
      return setFormError('This pay is already recorded. Delete it first if you need to redo it.')
    }
    if (isOneOff) {
      if (incomeCategoryId == null) return setFormError('Pick the category this income lands in.')
      if (destinationAccountId == null) return setFormError('Pick the account this income lands in.')
    }
    if (deductionsOn) {
      if (!gross.trim()) return setFormError('Enter the gross amount.')
      for (const d of deductions) {
        const amountEmpty = String(d.amount).trim() === ''
        if (!d.category.text?.trim() && amountEmpty) continue
        if (d.category.id == null) return setFormError('Pick a category for each deduction.')
        if (amountEmpty) return setFormError(`Enter an amount for the ${d.category.text} deduction.`)
      }
    } else if (!netOnly.trim()) {
      return setFormError('Enter the net amount.')
    }
    setSaving(true)
    try {
      const categoryLines = deductionsOn
        ? [
            { category_id: incomeCategoryId, cents: grossCents },
            ...deductions
              .filter((d) => d.category.id != null && String(d.amount).trim() !== '')
              .map((d) => ({ category_id: d.category.id, cents: -parseCents(d.amount) })),
          ]
        : [{ category_id: incomeCategoryId, cents: net }]

      const txn = await api.transactions.create({
        date: payday,
        income_stream_id: isOneOff ? null : stream.id,
        account_lines: [{ account_id: destinationAccountId, cents: net }],
        category_lines: categoryLines,
      })

      if (deductionsOn) {
        for (const d of deductions) {
          const cents = parseCents(d.amount)
          if (d.category.id == null || !cents) continue
          await api.earmarkMoves.create({
            date: payday, from_category_id: incomeCategoryId, to_category_id: d.category.id,
            cents, transaction_id: txn.id,
          })
        }
      }
      if (net > 0) {
        await api.earmarkMoves.create({
          date: payday, from_category_id: incomeCategoryId, to_category_id: null,
          cents: net, transaction_id: txn.id,
        })
      }
      const goalMoves = [...retainRows, ...billRows, ...fundingRows, ...targetRows]
        .filter((r) => r.cents > 0)
        .map((r) => ({ category_id: r.categoryId, cents: r.cents }))
      for (const move of [...goalMoves, ...rowsToMoves(oneOff), ...everythingElseMoves()]) {
        await api.earmarkMoves.create({
          date: payday, from_category_id: null, to_category_id: move.category_id,
          cents: move.cents, transaction_id: txn.id,
        })
      }

      navigate('/pay')
    } catch (err) {
      setFormError(err.message)
      // A partial write (the transaction saved but a move 400'd) must be recognized as
      // `existingTransaction` before the form is usable again, so Record can't be resubmitted
      // blindly into a second transaction for the same payday.
      await refreshTransactions()
    } finally {
      setSaving(false)
    }
  }

  function everythingElseMoves() {
    return Object.entries(everythingElse)
      .map(([categoryId, text]) => ({ category_id: Number(categoryId), cents: parseCents(text) ?? 0 }))
      .filter((m) => m.cents > 0)
  }

  async function deleteThisPay() {
    if (!existingTransaction) return
    if (!window.confirm('Delete this pay? This cannot be undone.')) return
    setFormError(null)
    try {
      if (removeBatchOnDelete) await api.earmarkMoves.removeForTransaction(existingTransaction.id)
      await api.transactions.remove(existingTransaction.id)
      navigate('/pay')
    } catch (err) {
      setFormError(err.message)
    }
  }

  return (
    <form onSubmit={record} className="py-6 space-y-6">
      {/* 1. Header */}
      <div className="rounded-lg bg-ink-soft p-4 space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{isOneOff ? 'One-off income' : stream.name}</h2>
          <span className="rounded bg-ink px-2 py-0.5 text-xs uppercase text-paper-soft">
            {existingTransaction ? 'recorded' : 'upcoming'}
          </span>
        </div>
        <label className="block text-sm">
          <span className="text-paper-soft">{isOneOff ? 'Date' : 'Payday'}</span>
          <input
            type="date"
            className="mt-1 rounded bg-ink px-2 py-1"
            value={payday}
            onChange={(e) => setPayday(e.target.value)}
          />
        </label>
        {isOneOff ? (
          <p className="text-sm text-paper-soft">{formatDate(payday)}</p>
        ) : (
          <p className="text-sm text-paper-soft">{formatDate(payday)} – {formatDate(periodEnd)}</p>
        )}
        {isOneOff && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <NamePicker
              label="Income category"
              items={categories}
              initialId={oneOffIncomeCategory.id}
              onChange={(catId, text) => setOneOffIncomeCategory({ id: catId, text })}
            />
            <NamePicker
              label="Destination account"
              items={accounts}
              initialId={oneOffDestinationAccount.id}
              onChange={(acctId, text) => setOneOffDestinationAccount({ id: acctId, text })}
            />
          </div>
        )}
      </div>

      {formError && <p className="text-bad">{formError}</p>}

      {/* 2. Income this period */}
      <div className="rounded-lg bg-ink-soft p-4">
        <p className="text-sm text-paper-soft">Income this period</p>
        <p className="text-3xl font-semibold">{formatCents(net)}</p>
      </div>

      {/* 3. Gross to net */}
      <fieldset className="rounded-lg bg-ink-soft p-4 space-y-3">
        <legend className="px-1 font-medium">Gross to net</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={deductionsOn} onChange={(e) => setDeductionsOn(e.target.checked)} />
          This paycheque has deductions
        </label>
        {deductionsOn ? (
          <>
            <label className="block text-sm">
              <span className="text-paper-soft">Gross — what the employer pays before deductions</span>
              <input
                type="text"
                inputMode="decimal"
                className="mt-1 w-full rounded bg-ink px-2 py-1"
                value={gross}
                onChange={(e) => setGross(e.target.value)}
              />
            </label>
            <AmountRows rows={deductions} categories={categories} onChange={setDeductions} addLabel="+ Add deduction" />
          </>
        ) : (
          <label className="block text-sm">
            <span className="text-paper-soft">Net</span>
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 w-full rounded bg-ink px-2 py-1"
              value={netOnly}
              onChange={(e) => setNetOnly(e.target.value)}
            />
          </label>
        )}
        <p className="text-sm text-paper-soft">Net: {formatCents(net)}</p>
      </fieldset>

      {/* 4. Retain income */}
      {retainGoals.length > 0 && (
        <fieldset className="rounded-lg bg-ink-soft p-4 space-y-2">
          <legend className="px-1 font-medium">Retain income</legend>
          {sortByNeedIfShort(retainRows, categoriesById, leftover).map((r) => (
            <div key={r.goalId} className="flex items-center justify-between gap-2 text-sm">
              <div>
                <span>{r.name}</span>
                <span className="text-paper-soft"> · {categoriesById.get(r.categoryId)?.name} · {r.percent}% of net</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{formatCents(r.cents)}</span>
                <button
                  type="button"
                  className="text-xs text-accent"
                  onClick={() => setRetainRemoved(new Set([...retainRemoved, r.goalId]))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </fieldset>
      )}

      {/* 5. One-off this period */}
      <fieldset className="rounded-lg bg-ink-soft p-4 space-y-3">
        <legend className="px-1 font-medium">One-off this period</legend>
        <p className="text-sm text-paper-soft">Add anything that only applies this period.</p>
        <AmountRows rows={oneOff} categories={categories} onChange={setOneOff} addLabel="+ Add a one-off" />
      </fieldset>

      {/* 6. Bills */}
      {billGoals.length > 0 && (
        <fieldset className="rounded-lg bg-ink-soft p-4 space-y-2">
          <legend className="px-1 font-medium">Bills</legend>
          {sortByNeedIfShort(billRows, categoriesById, leftover).map((r) => (
            <div key={r.goalId} className="flex items-end justify-between gap-2">
              <div className="text-sm">
                <div>{r.name}</div>
                <div className="text-paper-soft">
                  {categoriesById.get(r.categoryId)?.name} · due {formatDate(r.dueDate)}
                  {r.expectedCents != null && <> · expected {formatCents(r.expectedCents)}</>}
                </div>
              </div>
              <label className="block text-sm w-28">
                <input
                  type="text"
                  inputMode="decimal"
                  className="mt-1 w-full rounded bg-ink px-2 py-1"
                  value={billAmounts[r.goalId] ?? ''}
                  onChange={(e) => setBillAmounts({ ...billAmounts, [r.goalId]: e.target.value })}
                />
              </label>
            </div>
          ))}
        </fieldset>
      )}

      {/* 7. Funding rules */}
      {fundingGoals.length > 0 && (
        <fieldset className="rounded-lg bg-ink-soft p-4 space-y-2">
          <legend className="px-1 font-medium">Funding rules</legend>
          {sortByNeedIfShort(
            fundingGoals.map((g) => ({
              goalId: g.goal.id,
              categoryId: g.goal.category_id,
              name: g.goal.name,
              level: g.goal.level_cents != null,
              shortfallCents: g.owed_cents,
              levelCents: g.goal.level_cents,
            })),
            categoriesById,
            leftover
          ).map((r) => (
            <div key={r.goalId} className="flex items-end justify-between gap-2">
              <label className="flex items-start gap-2 text-sm">
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
                  <div className="text-paper-soft">
                    {categoriesById.get(r.categoryId)?.name} ·{' '}
                    {r.level
                      ? `${formatCents(r.shortfallCents)} short of ${formatCents(r.levelCents)} level`
                      : 'fixed'}
                  </div>
                </span>
              </label>
              <label className="block text-sm w-28">
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={fundingSkipped.has(r.goalId)}
                  className="mt-1 w-full rounded bg-ink px-2 py-1 disabled:opacity-50"
                  value={fundingAmounts[r.goalId] ?? ''}
                  onChange={(e) => setFundingAmounts({ ...fundingAmounts, [r.goalId]: e.target.value })}
                />
              </label>
            </div>
          ))}
        </fieldset>
      )}

      {/* 8. Goal set-asides */}
      {targetGoals.length > 0 && (
        <fieldset className="rounded-lg bg-ink-soft p-4 space-y-2">
          <legend className="px-1 font-medium">Goal set-asides</legend>
          {sortByNeedIfShort(targetRows, categoriesById, leftover).map((r) => (
            <div key={r.goalId} className="flex items-end justify-between gap-2">
              <div className="text-sm">
                <div>{r.name}</div>
                <div className="text-paper-soft">
                  {categoriesById.get(r.categoryId)?.name} ·{' '}
                  {r.targetCents != null && <>{formatCents(r.balanceCents)} of {formatCents(r.targetCents)} saved · </>}
                  due {formatDate(r.dueDate)}
                </div>
              </div>
              <label className="block text-sm w-28">
                <input
                  type="text"
                  inputMode="decimal"
                  className="mt-1 w-full rounded bg-ink px-2 py-1"
                  value={targetAmounts[r.goalId] ?? ''}
                  onChange={(e) => setTargetAmounts({ ...targetAmounts, [r.goalId]: e.target.value })}
                />
              </label>
            </div>
          ))}
        </fieldset>
      )}

      {/* 9. Everything else */}
      <fieldset className="rounded-lg bg-ink-soft p-4 space-y-2">
        <legend className="px-1 font-medium">Everything else</legend>
        {everythingElseCategories.length === 0 && (
          <p className="text-sm text-paper-soft">Nothing left without a goal.</p>
        )}
        {everythingElseCategories.map((c) => (
          <div key={c.id} className="flex items-end gap-2">
            <div className="flex-1 text-sm">
              <span>{c.name}</span>
              {lastPeriodActuals[c.id] > 0 && (
                <span className="text-paper-soft">
                  {' '}· {isOneOff ? 'last month' : 'last period'} {formatCents(lastPeriodActuals[c.id])}
                </span>
              )}
            </div>
            <label className="block text-sm w-28">
              <input
                type="text"
                inputMode="decimal"
                placeholder={lastPeriodActuals[c.id] > 0 ? (lastPeriodActuals[c.id] / 100).toFixed(2) : ''}
                className="mt-1 w-full rounded bg-ink px-2 py-1"
                value={everythingElse[c.id] ?? ''}
                onChange={(e) => setEverythingElse({ ...everythingElse, [c.id]: e.target.value })}
              />
            </label>
          </div>
        ))}
      </fieldset>

      {/* 10. Short by */}
      {leftover < 0 && (
        <fieldset className="rounded-lg bg-ink-soft p-4 space-y-2">
          <legend className="px-1 font-medium">Short by</legend>
          {shortByRows.length === 0 ? (
            <p className="text-sm text-paper-soft">No other category has money to cover this from.</p>
          ) : (
            shortByRows.map((r) => (
              <div key={r.categoryId} className="flex items-center justify-between gap-2 text-sm">
                <div>
                  <span>{r.name}</span>
                  <span className="text-paper-soft"> · {formatCents(r.availableCents)} available</span>
                </div>
                <button type="button" className="text-xs text-accent" onClick={() => coverFrom(r)}>
                  Cover from this
                </button>
              </div>
            ))
          )}
        </fieldset>
      )}

      {/* 11. Left over */}
      <div className="rounded-lg bg-ink-soft p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-paper-soft">Left over</span>
          <span className={`text-2xl font-semibold ${leftover < 0 ? 'text-bad' : ''}`}>{formatCents(leftover)}</span>
        </div>
        {leftover < 0 && <p className="text-sm text-bad">Assigned more than this paycheque brings in.</p>}
        {existingTransaction ? (
          <p className="text-sm text-paper-soft">
            Already recorded. Delete this pay first if you need to redo it.
          </p>
        ) : (
          <button type="submit" disabled={saving} className="rounded bg-accent px-3 py-1 text-ink">
            Record
          </button>
        )}
        {existingTransaction && (
          <div className="pt-3 border-t border-ink space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={removeBatchOnDelete}
                onChange={(e) => setRemoveBatchOnDelete(e.target.checked)}
              />
              Also remove the money moves this pay assigned
            </label>
            <button type="button" className="text-sm text-bad" onClick={deleteThisPay}>
              Delete this pay
            </button>
          </div>
        )}
      </div>
    </form>
  )
}
