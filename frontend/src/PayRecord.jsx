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
  const streamId = Number(id)
  const navigate = useNavigate()

  const [streams, setStreams] = useState(null)
  const [categories, setCategories] = useState([])
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
  const [everythingElse, setEverythingElse] = useState({}) // category_id -> amount text
  const [removeBatchOnDelete, setRemoveBatchOnDelete] = useState(true)

  const stream = streams?.find((s) => s.id === streamId) ?? null

  function refreshTransactions() {
    return api.transactions.list().then(setTransactions).catch((e) => setError(e.message))
  }

  function refresh() {
    api.incomeStreams.list(pickerDate, true).then(setStreams).catch((e) => setError(e.message))
    refreshTransactions()
  }

  useEffect(refresh, [pickerDate])

  // Seed the payday once the stream is known.
  useEffect(() => {
    if (!stream || payday !== null) return
    setPayday(stream.next_payday)
  }, [stream, payday])

  useEffect(() => {
    if (!payday) return
    api.categories.list(payday).then(setCategories).catch((e) => setError(e.message))
    api.goals.list(payday).then(setGoals).catch((e) => setError(e.message))
  }, [payday])

  // Prefill gross/deductions from the named pay once its categories have loaded, so each
  // deduction row's NamePicker can seed its text along with its id (once only).
  useEffect(() => {
    if (!stream || seeded || categories.length === 0) return
    setSeeded(true)
    setGross(stream.expected_gross_cents == null ? '' : (stream.expected_gross_cents / 100).toFixed(2))
    setDeductionsOn(stream.deductions.length > 0 || stream.expected_gross_cents != null)
    setDeductions(
      stream.deductions.map((d) => ({
        category: { id: d.category_id, text: categories.find((c) => c.id === d.category_id)?.name ?? '' },
        amount: (d.amount_cents / 100).toFixed(2),
      }))
    )
  }, [stream, categories, seeded])

  const existingTransaction = useMemo(
    () => transactions?.find((t) => t.income_stream_id === streamId && t.date === payday) ?? null,
    [transactions, streamId, payday]
  )

  const grossCents = parseCents(gross) ?? 0
  const deductionTotal = deductions.reduce((sum, d) => sum + (parseCents(d.amount) ?? 0), 0)
  const net = deductionsOn ? grossCents - deductionTotal : (parseCents(netOnly) ?? 0)

  const oneOffTotal = rowsToMoves(oneOff).reduce((sum, m) => sum + m.cents, 0)

  const liveGoalCategoryIds = useMemo(() => new Set(goals.map((g) => g.goal.category_id)), [goals])
  const deductionCategoryIds = useMemo(
    () => new Set(deductions.map((d) => d.category.id).filter((id) => id != null)),
    [deductions]
  )
  const everythingElseCategories = useMemo(() => {
    if (!stream) return []
    return categories
      .filter((c) => !c.archived_on)
      .filter((c) => !liveGoalCategoryIds.has(c.id))
      .filter((c) => c.id !== stream.income_category_id && !deductionCategoryIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [categories, liveGoalCategoryIds, deductionCategoryIds, stream])

  const lastPeriodActuals = useMemo(() => {
    if (!payday || !stream || !transactions) return {}
    const start = stepDate(stream.cadence, stream.cadence_weeks, payday, -1)
    const totals = {}
    for (const t of transactions) {
      if (t.date < start || t.date >= payday) continue
      for (const line of t.category_lines) {
        if (line.cents >= 0) continue
        totals[line.category_id] = (totals[line.category_id] ?? 0) - line.cents
      }
    }
    return totals
  }, [transactions, payday, stream])

  const everythingElseTotal = Object.values(everythingElse).reduce((sum, text) => sum + (parseCents(text) ?? 0), 0)
  const leftover = net - oneOffTotal - everythingElseTotal

  if (error) return <p className="text-bad py-6">Could not reach the backend: {error}</p>
  if (!streams || !payday) return <p className="py-6">Loading…</p>
  if (!stream) return <p className="text-bad py-6">No named pay with id {streamId}.</p>

  const periodEnd = stepDate(stream.cadence, stream.cadence_weeks, payday, 1)

  async function record(e) {
    e.preventDefault()
    setFormError(null)
    if (existingTransaction) {
      return setFormError('This pay is already recorded. Delete it first if you need to redo it.')
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
            { category_id: stream.income_category_id, cents: grossCents },
            ...deductions
              .filter((d) => d.category.id != null && String(d.amount).trim() !== '')
              .map((d) => ({ category_id: d.category.id, cents: -parseCents(d.amount) })),
          ]
        : [{ category_id: stream.income_category_id, cents: net }]

      const txn = await api.transactions.create({
        date: payday,
        income_stream_id: stream.id,
        account_lines: [{ account_id: stream.destination_account_id, cents: net }],
        category_lines: categoryLines,
      })

      if (deductionsOn) {
        for (const d of deductions) {
          const cents = parseCents(d.amount)
          if (d.category.id == null || !cents) continue
          await api.earmarkMoves.create({
            date: payday, from_category_id: stream.income_category_id, to_category_id: d.category.id,
            cents, transaction_id: txn.id,
          })
        }
      }
      if (net > 0) {
        await api.earmarkMoves.create({
          date: payday, from_category_id: stream.income_category_id, to_category_id: null,
          cents: net, transaction_id: txn.id,
        })
      }
      for (const move of [...rowsToMoves(oneOff), ...everythingElseMoves()]) {
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
          <h2 className="text-xl font-semibold">{stream.name}</h2>
          <span className="rounded bg-ink px-2 py-0.5 text-xs uppercase text-paper-soft">
            {existingTransaction ? 'recorded' : 'upcoming'}
          </span>
        </div>
        <label className="block text-sm">
          <span className="text-paper-soft">Payday</span>
          <input
            type="date"
            className="mt-1 rounded bg-ink px-2 py-1"
            value={payday}
            onChange={(e) => setPayday(e.target.value)}
          />
        </label>
        <p className="text-sm text-paper-soft">{formatDate(payday)} – {formatDate(periodEnd)}</p>
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

      {/* 5. One-off this period */}
      <fieldset className="rounded-lg bg-ink-soft p-4 space-y-3">
        <legend className="px-1 font-medium">One-off this period</legend>
        <p className="text-sm text-paper-soft">Add anything that only applies this period.</p>
        <AmountRows rows={oneOff} categories={categories} onChange={setOneOff} addLabel="+ Add a one-off" />
      </fieldset>

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
                <span className="text-paper-soft"> · last period {formatCents(lastPeriodActuals[c.id])}</span>
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
