import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from './api.js'
import { CADENCES } from './cadences.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import ListFilters from './components/ListFilters.jsx'
import { useFilters } from './utils/useFilters.js'
import LoadingRows from './components/LoadingRows.jsx'
import MoneyInput from './components/MoneyInput.jsx'
import { RefusalNote, WarningNote } from './components/Notes.jsx'
import SidePanel, { PanelLayout } from './components/SidePanel.jsx'
import NamePicker from './NamePicker.jsx'
import PayeePicker from './PayeePicker.jsx'
import { formatDate, optionalCentsToFieldText, parseCents } from './utils/format.js'

const cadenceText = (stream) => (stream.cadence === 'weeks' ? `every ${stream.cadence_weeks} weeks` : (CADENCES.find((c) => c.value === stream.cadence)?.label ?? stream.cadence).toLowerCase())


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
    gross: optionalCentsToFieldText(stream.expected_gross_cents),
    netLow: optionalCentsToFieldText(stream.expected_net_low_cents),
    netHigh: optionalCentsToFieldText(stream.expected_net_high_cents),
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
      amount: optionalCentsToFieldText(d.amount_cents),
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
    <fieldset className="rounded-lg bg-raised p-3 space-y-3">
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
          <MoneyInput label="Amount" value={d.amount} onChange={(amount) => set(i, { amount })} />
          <Button variant="quiet" onClick={() => remove(i)}>Remove</Button>
        </div>
      ))}
      <Button variant="quiet" onClick={() => onChange([...deductions, { category: {}, amount: '' }])}>
        + Add deduction
      </Button>
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
  const { filters, setFilter, clear: clearFilters, active: filtersActive } = useFilters('income.filters', { search: '', cadence: '' })
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false) // the add/edit side panel
  const [focusKey, setFocusKey] = useState(0) // returns focus to the panel's first field

  function refresh() {
    api.incomeStreams.list(pickerDate, showArchived).then(setStreams).catch((e) => setError(e.message))
    api.categories.list(pickerDate).then(setCategories).catch((e) => setError(e.message))
    api.accounts.list(pickerDate).then(setAccounts).catch((e) => setError(e.message))
    api.payees.list(pickerDate).then(setPayees).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function startAdd() {
    resetForm()
    setPanelOpen(true)
    setFocusKey((k) => k + 1)
  }

  function closePanel() {
    resetForm()
    setPanelOpen(false)
  }

  function startEdit(stream) {
    setPanelOpen(true)
    setFocusKey((k) => k + 1)
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
    if (saving) return
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
    setSaving(true)
    try {
      const body = streamBody(form, pickerDate, deductions)
      if (editing) {
        await api.incomeStreams.update(editing.id, body)
        closePanel()
      } else {
        await api.incomeStreams.create(body)
        closePanel()
      }
      refresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
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

  // A pay already recorded for its next payday is re-opened to correct it, not recorded again.

  const shown = (streams ?? []).filter(
    (s) => s.name.toLowerCase().includes(filters.search.trim().toLowerCase()) && (filters.cadence === '' || s.cadence === filters.cadence),
  )

  const formPanel = panelOpen && (
    <SidePanel title={editing ? `Edit · ${editing.name}` : 'Add a named pay'} onClose={closePanel} focusKey={focusKey}>
      <form key={formKey} onSubmit={submit} className="space-y-4">
          <p className="text-sm text-text-2">
            Lumpy income? You can always set it monthly and estimate the least and most you receive in a month.
          </p>
          {formError && <RefusalNote>{formError}</RefusalNote>}
          <label className="block space-y-1">
            <span className="field-label">Name</span>
            <input
              className="w-full field"
              value={form.name}
              disabled={saving}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="field-label">Payee (optional)</span>
            <PayeePicker
              payees={payees}
              payeeId={form.payee.id ?? null}
              onSelect={(id) => setForm({ ...form, payee: { id, text: payees.find((p) => p.id === id)?.name ?? '' } })}
              onAdd={addPayee}
              onError={setFormError}
            />
          </label>
          <label className="block space-y-1">
            <span className="field-label">How often</span>
            <select
              className="w-full field"
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
            <label className="block space-y-1">
              <span className="field-label">Number of weeks</span>
              <input
                type="text"
                inputMode="numeric"
                className="w-full field"
                value={form.weeks}
                onChange={(e) => setForm({ ...form, weeks: e.target.value.replace(/[^0-9]/g, '') })}
              />
            </label>
          )}
          <label className="block space-y-1">
            <span className="field-label">Next payday you know about</span>
            <input
              type="date"
              className="w-full field"
              value={form.anchorPayday}
              onChange={(e) => setForm({ ...form, anchorPayday: e.target.value })}
            />
          </label>
          <MoneyInput label="Expected gross (optional)" value={form.gross} onChange={(text) => setForm({ ...form, gross: text })} />
          <div className="flex gap-3">
            <MoneyInput className="flex-1" label="Expected net, low" value={form.netLow} onChange={(text) => setForm({ ...form, netLow: text })} />
            <MoneyInput className="flex-1" label="Expected net, high" value={form.netHigh} onChange={(text) => setForm({ ...form, netHigh: text })} />
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
            <Button type="submit" disabled={saving}>{editing ? 'Save' : 'Add named pay'}</Button>
            <Button variant="secondary" onClick={closePanel}>Cancel</Button>
          </div>
      </form>
    </SidePanel>
  )

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title hidden md:block">Income</h2>
        <Button className="ml-auto" onClick={startAdd}>Add a named pay</Button>
      </div>

      <PanelLayout panel={formPanel}>
      <section className="card space-y-3">
        {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
        {rowError && <WarningNote>{rowError}</WarningNote>}
        {warnings.map((w) => (
          <WarningNote key={w}>{w}</WarningNote>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ListFilters
            noun="named pays"
            search={filters.search}
            onSearch={(v) => setFilter('search', v)}
            active={filtersActive}
            onClear={clearFilters}
            facets={[
              { name: 'cadence', label: 'How often', value: filters.cadence, onChange: (v) => setFilter('cadence', v), options: CADENCES },
            ]}
          >
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
          </ListFilters>
          <Link className="btn btn-quiet" to="/income/one-off">
            One-off income
          </Link>
        </div>
        {!error && !streams && <LoadingRows />}
        {streams && streams.length === 0 && (
          <EmptyState action={<Button variant="secondary" onClick={startAdd}>Add a named pay</Button>}>
            No named pays yet.
          </EmptyState>
        )}
        {streams && streams.length > 0 && shown.length === 0 && (
          <p className="text-text-2">No named pays match these filters.</p>
        )}
        {shown.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-text-2">
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
                      <div className="text-sm text-text-3">archived {formatDate(s.archived_on)}</div>
                    )}
                  </td>
                  <td className="py-1">{cadenceText(s)}</td>
                  <td className="py-1">{formatDate(s.next_payday)}</td>
                  <td className="py-1 text-right space-x-3 whitespace-nowrap">
                    {!s.archived_on && (
                      <Link className="btn btn-quiet" to={`/income/${s.id}/record`}>
                        {s.next_payday_recorded ? 'Re-open' : 'Record'}
                      </Link>
                    )}
                    {!s.archived_on && (
                      <button type="button" className="btn btn-quiet" onClick={() => startEdit(s)}>
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-quiet"
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
      </PanelLayout>
    </div>
  )
}
