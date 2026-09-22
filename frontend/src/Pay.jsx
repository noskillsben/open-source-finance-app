import { useEffect, useState } from 'react'
import { api } from './api.js'
import NamePicker from './NamePicker.jsx'
import PayeePicker from './PayeePicker.jsx'
import { formatDate, parseCents } from './utils/format.js'

// The cadence shape goals use, reused here (DESIGN.md § Income streams: "the goals' cadence
// representation, reused — not a copy" — same field names and semantics on the wire).
const CADENCES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'weeks', label: 'Every N weeks' },
]
const cadenceText = (stream) => (stream.cadence === 'weeks' ? `every ${stream.cadence_weeks} weeks` : stream.cadence)

const centsText = (cents) => (cents == null ? '' : (cents / 100).toFixed(2))

const EMPTY_FORM = {
  name: '', payee: {}, cadence: '', weeks: '', anchorPayday: '',
  gross: '', netLow: '', netHigh: '', incomeCategory: {}, destinationAccount: {},
  deductions: [],
}

function streamToForm(stream, categories, accounts, payees) {
  return {
    name: stream.name,
    payee: { id: stream.payee_id, text: payees.find((p) => p.id === stream.payee_id)?.name ?? '' },
    cadence: stream.cadence,
    weeks: stream.cadence_weeks ?? '',
    anchorPayday: stream.anchor_payday,
    gross: centsText(stream.expected_gross_cents),
    netLow: centsText(stream.expected_net_low_cents),
    netHigh: centsText(stream.expected_net_high_cents),
    incomeCategory: {
      id: stream.income_category_id,
      text: categories.find((c) => c.id === stream.income_category_id)?.name ?? '',
    },
    destinationAccount: {
      id: stream.destination_account_id,
      text: accounts.find((a) => a.id === stream.destination_account_id)?.name ?? '',
    },
    deductions: stream.deductions.map((d) => ({
      category: { id: d.category_id, text: categories.find((c) => c.id === d.category_id)?.name ?? '' },
      amount: centsText(d.amount_cents),
    })),
  }
}

function streamBody(f, pickerDate, deductions) {
  const cents = (text) => (String(text).trim() === '' ? null : parseCents(text))
  return {
    on: pickerDate,
    name: f.name.trim(),
    payee_id: f.payee.id ?? null,
    cadence: f.cadence,
    cadence_weeks: f.cadence === 'weeks' && f.weeks !== '' ? Number(f.weeks) : null,
    anchor_payday: f.anchorPayday,
    expected_gross_cents: cents(f.gross),
    expected_net_low_cents: cents(f.netLow),
    expected_net_high_cents: cents(f.netHigh),
    income_category_id: f.incomeCategory.id,
    destination_account_id: f.destinationAccount.id,
    deductions,
  }
}

function unmatched(pick) {
  return pick.text && pick.id == null
}

// A blank row (no category typed, no amount) is dropped silently — it was never started. Any
// other incomplete row is refused: an empty amount is a forgotten field, not a stated zero
// (DESIGN.md § General concepts → Zero is a valid amount), and a category that didn't match
// would otherwise vanish from what gets saved.
function validateDeductions(deductions) {
  const cleaned = []
  for (const d of deductions) {
    const categoryEmpty = !d.category.text?.trim()
    const amountEmpty = String(d.amount).trim() === ''
    if (categoryEmpty && amountEmpty) continue
    if (unmatched(d.category) || d.category.id == null) {
      return { error: 'Pick a category for each deduction.' }
    }
    if (amountEmpty) {
      return { error: `Enter an amount for the ${d.category.text} deduction.` }
    }
    cleaned.push({ category_id: d.category.id, amount_cents: parseCents(d.amount) })
  }
  return { deductions: cleaned }
}

// Deductions: category + amount rows, added and removed freely, replaced as a set on save.
function DeductionFields({ deductions, categories, onChange }) {
  const set = (i, patch) => onChange(deductions.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  const remove = (i) => onChange(deductions.filter((_, idx) => idx !== i))
  return (
    <fieldset className="rounded bg-ink p-3 space-y-3">
      <legend className="px-1 text-sm font-medium">Expected deductions</legend>
      {deductions.map((d, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <NamePicker
              label="Category"
              items={categories}
              initialId={d.category.id}
              onChange={(id, text) => set(i, { category: { id, text } })}
            />
          </div>
          <label className="block text-sm w-28">
            <span className="text-paper-soft">Amount</span>
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
              value={d.amount}
              onChange={(e) => set(i, { amount: e.target.value })}
            />
          </label>
          <button type="button" className="text-xs text-accent pb-2" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-accent"
        onClick={() => onChange([...deductions, { category: {}, amount: '' }])}
      >
        + Add deduction
      </button>
    </fieldset>
  )
}

export default function Pay({ pickerDate }) {
  const [streams, setStreams] = useState(null)
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [payees, setPayees] = useState([])
  const [error, setError] = useState(null)
  const [rowError, setRowError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState(null)
  const [formKey, setFormKey] = useState(0)

  function refresh() {
    api.incomeStreams.list(pickerDate, showArchived).then(setStreams).catch((e) => setError(e.message))
    api.categories.list(pickerDate).then(setCategories).catch((e) => setError(e.message))
    api.accounts.list(pickerDate).then(setAccounts).catch((e) => setError(e.message))
    api.payees.list(pickerDate).then(setPayees).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function startEdit(stream) {
    setFormKey((k) => k + 1)
    setEditing(stream)
    setForm(streamToForm(stream, categories, accounts, payees))
    setFormError(null)
  }

  function resetForm() {
    setFormKey((k) => k + 1)
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function addPayee(name) {
    const payee = await api.payees.create({ name, created_on: pickerDate })
    setPayees((ps) => [...ps, payee])
    return payee
  }

  async function submit(e) {
    e.preventDefault()
    setFormError(null)
    const name = form.name.trim()
    if (!name) return setFormError('Name is required.')
    if (!form.cadence) return setFormError('Choose how often this pay lands.')
    if (!form.anchorPayday) return setFormError('The next payday you know about is required.')
    if (String(form.netLow).trim() === '') return setFormError('Enter the expected net, low.')
    if (String(form.netHigh).trim() === '') return setFormError('Enter the expected net, high.')
    if (unmatched(form.incomeCategory) || form.incomeCategory.id == null) {
      return setFormError('Pick the category this pay lands in.')
    }
    if (unmatched(form.destinationAccount) || form.destinationAccount.id == null) {
      return setFormError('Pick the account this pay lands in.')
    }
    if (unmatched(form.payee)) return setFormError(`"${form.payee.text}" is not an existing payee.`)
    const { deductions, error: deductionError } = validateDeductions(form.deductions)
    if (deductionError) return setFormError(deductionError)
    try {
      const body = streamBody(form, pickerDate, deductions)
      if (editing) await api.incomeStreams.update(editing.id, body)
      else await api.incomeStreams.create(body)
      resetForm()
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  async function archiveStream(stream) {
    setRowError(null)
    setWarnings([])
    try {
      const result = await api.incomeStreams.archive(stream.id, pickerDate)
      setWarnings(result.warnings.map((w) => `${stream.name}: ${w}`))
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  async function unarchiveStream(stream) {
    setRowError(null)
    setWarnings([])
    try {
      await api.incomeStreams.unarchive(stream.id)
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  const shown = (streams ?? []).filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="py-6 space-y-6">
      <h2 className="text-xl font-semibold">Pay</h2>

      <form key={formKey} onSubmit={submit} className="rounded-lg bg-ink-soft p-4 space-y-3">
        <h3 className="font-medium">{editing ? `Edit ${editing.name}` : 'Add a named pay'}</h3>
        <p className="text-sm text-paper-soft">
          Lumpy income? You can always set it monthly and estimate the least and most you receive in a month.
        </p>
        {formError && <p className="text-bad">{formError}</p>}
        <label className="block text-sm">
          <span className="text-paper-soft">Name</span>
          <input
            className="mt-1 w-full rounded bg-ink px-2 py-1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-paper-soft">Payee (optional)</span>
          <PayeePicker
            payees={payees}
            payeeId={form.payee.id ?? null}
            onSelect={(id) => setForm({ ...form, payee: { id, text: payees.find((p) => p.id === id)?.name ?? '' } })}
            onAdd={addPayee}
            onError={setFormError}
          />
        </label>
        <label className="block text-sm">
          <span className="text-paper-soft">How often</span>
          <select
            className="mt-1 w-full rounded bg-ink px-2 py-1"
            value={form.cadence}
            onChange={(e) => setForm({ ...form, cadence: e.target.value })}
          >
            <option value="">Choose…</option>
            {CADENCES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        {form.cadence === 'weeks' && (
          <label className="block text-sm">
            <span className="text-paper-soft">Number of weeks</span>
            <input
              type="text"
              inputMode="numeric"
              className="mt-1 w-full rounded bg-ink px-2 py-1"
              value={form.weeks}
              onChange={(e) => setForm({ ...form, weeks: e.target.value.replace(/[^0-9]/g, '') })}
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-paper-soft">Next payday you know about</span>
          <input
            type="date"
            className="mt-1 w-full rounded bg-ink px-2 py-1"
            value={form.anchorPayday}
            onChange={(e) => setForm({ ...form, anchorPayday: e.target.value })}
          />
        </label>
        <label className="block text-sm">
          <span className="text-paper-soft">Expected gross (optional)</span>
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded bg-ink px-2 py-1"
            value={form.gross}
            onChange={(e) => setForm({ ...form, gross: e.target.value })}
          />
        </label>
        <div className="flex gap-3">
          <label className="block text-sm flex-1">
            <span className="text-paper-soft">Expected net, low</span>
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 w-full rounded bg-ink px-2 py-1"
              value={form.netLow}
              onChange={(e) => setForm({ ...form, netLow: e.target.value })}
            />
          </label>
          <label className="block text-sm flex-1">
            <span className="text-paper-soft">Expected net, high</span>
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 w-full rounded bg-ink px-2 py-1"
              value={form.netHigh}
              onChange={(e) => setForm({ ...form, netHigh: e.target.value })}
            />
          </label>
        </div>
        <NamePicker
          label="Income category (where this pay lands)"
          items={categories}
          initialId={form.incomeCategory.id}
          onChange={(id, text) => setForm({ ...form, incomeCategory: { id, text } })}
        />
        <NamePicker
          label="Destination account"
          items={accounts}
          initialId={form.destinationAccount.id}
          onChange={(id, text) => setForm({ ...form, destinationAccount: { id, text } })}
        />
        <DeductionFields
          deductions={form.deductions}
          categories={categories}
          onChange={(deductions) => setForm({ ...form, deductions })}
        />
        <div className="flex gap-3">
          <button type="submit" className="rounded bg-accent px-3 py-1 text-ink">
            {editing ? 'Save' : 'Add named pay'}
          </button>
          {editing && (
            <button type="button" className="text-sm text-accent" onClick={resetForm}>Cancel</button>
          )}
        </div>
      </form>

      <section className="rounded-lg bg-ink-soft p-4 space-y-2">
        {error && <p className="text-bad">Could not reach the backend: {error}</p>}
        {rowError && <p className="text-bad">{rowError}</p>}
        {warnings.map((w) => (
          <p key={w} className="text-sm text-bad">{w}</p>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="rounded bg-ink px-2 py-1 text-sm"
            placeholder="Search named pays"
            aria-label="Search named pays"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
        {!error && !streams && <p>Loading…</p>}
        {streams && streams.length === 0 && <p className="text-paper-soft">No named pays yet.</p>}
        {shown.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-paper-soft">
                <th className="pb-1">Name</th>
                <th className="pb-1">Cadence</th>
                <th className="pb-1">Next payday</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td className="py-1">
                    {s.name}
                    {s.archived_on && (
                      <div className="text-xs text-paper-soft">archived {formatDate(s.archived_on)}</div>
                    )}
                  </td>
                  <td className="py-1">{cadenceText(s)}</td>
                  <td className="py-1">{formatDate(s.next_payday)}</td>
                  <td className="py-1 text-right space-x-3 whitespace-nowrap">
                    {!s.archived_on && (
                      <button type="button" className="text-xs text-accent" onClick={() => startEdit(s)}>
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={() => (s.archived_on ? unarchiveStream(s) : archiveStream(s))}
                    >
                      {s.archived_on ? 'Unarchive' : 'Archive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
