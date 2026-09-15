import { useEffect, useState } from 'react'
import { api } from './api.js'
import { DEFAULT_ON_BUDGET, ON_BUDGET_TYPES, TRACKING_TYPES } from './account_types.js'
import { formatCents, formatDate, parseCents } from './utils/format.js'

function emptyForm(pickerDate) {
  return {
    name: '',
    type: ON_BUDGET_TYPES[0],
    on_budget: DEFAULT_ON_BUDGET[ON_BUDGET_TYPES[0]],
    on_budget_floor_cents: '0',
    opening_balance_cents: '',
    created_on: pickerDate,
  }
}

export default function Accounts({ pickerDate }) {
  const [accounts, setAccounts] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(() => emptyForm(pickerDate))
  const [formError, setFormError] = useState(null)
  const [editingId, setEditingId] = useState(null)

  function refresh() {
    api.accounts.list(pickerDate).then(setAccounts).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate])

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function selectType(type) {
    setForm((f) => ({ ...f, type, on_budget: DEFAULT_ON_BUDGET[type] }))
  }

  function editAccount(a) {
    setEditingId(a.id)
    setForm({
      name: a.name,
      type: a.type,
      on_budget: a.on_budget,
      on_budget_floor_cents: String(a.on_budget_floor_cents / 100),
      opening_balance_cents: '',
      created_on: a.created_on,
    })
    setFormError(null)
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm(pickerDate))
    setFormError(null)
  }

  async function submit(e) {
    e.preventDefault()
    setFormError(null)

    const floorCents = parseCents(form.on_budget_floor_cents) ?? 0
    if (!form.name.trim()) return setFormError('Name is required.')

    try {
      if (editingId) {
        await api.accounts.update(editingId, {
          name: form.name.trim(),
          type: form.type,
          on_budget: form.on_budget,
          on_budget_floor_cents: floorCents,
        })
      } else {
        const openingBalanceCents = parseCents(form.opening_balance_cents)
        if (!form.created_on) return setFormError('Opening balance date is required.')
        if (openingBalanceCents === null) return setFormError('Opening balance must be a number.')
        await api.accounts.create({
          name: form.name.trim(),
          created_on: form.created_on,
          type: form.type,
          on_budget: form.on_budget,
          on_budget_floor_cents: floorCents,
          opening_balance_cents: openingBalanceCents,
        })
      }
      resetForm()
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  return (
    <div className="py-6 space-y-6">
      <h2 className="text-xl font-semibold">Accounts</h2>

      <section className="rounded-lg bg-ink-soft p-4 space-y-2">
        {error && <p className="text-bad">Could not reach the backend: {error}</p>}
        {!error && !accounts && <p>Loading…</p>}
        {accounts && accounts.length === 0 && <p className="text-paper-soft">No accounts yet.</p>}
        {accounts && accounts.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-paper-soft">
                <th className="pb-1">Name</th>
                <th className="pb-1">Type</th>
                <th className="pb-1">Side</th>
                <th className="pb-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-ink" onClick={() => editAccount(a)}>
                  <td className="py-1">{a.name}</td>
                  <td className="py-1">{a.type}</td>
                  <td className="py-1">{a.on_budget ? 'On-budget' : 'Tracking'}</td>
                  <td className={`py-1 text-right ${a.balance_cents < 0 ? 'text-bad' : ''}`}>
                    {formatCents(a.balance_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg bg-ink-soft p-4 space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-paper-soft">
          {editingId ? `Edit account #${editingId}` : 'Add an account'}
        </h2>
        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="text-sm">Name</span>
            <input
              className="w-full rounded bg-ink px-2 py-1"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Type</span>
            <select
              className="w-full rounded bg-ink px-2 py-1"
              value={form.type}
              onChange={(e) => selectType(e.target.value)}
            >
              <optgroup label="On-budget">
                {ON_BUDGET_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
              <optgroup label="Tracking">
                {TRACKING_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.on_budget}
              onChange={(e) => updateField('on_budget', e.target.checked)}
            />
            <span className="text-sm">On-budget (money here can be assigned to categories)</span>
          </label>

          <label className="block space-y-1">
            <span className="text-sm">On-budget floor</span>
            <input
              inputMode="decimal"
              className="w-full rounded bg-ink px-2 py-1"
              value={form.on_budget_floor_cents}
              onChange={(e) => updateField('on_budget_floor_cents', e.target.value)}
              placeholder="0.00"
            />
          </label>

          {!editingId && (
            <>
              <label className="block space-y-1">
                <span className="text-sm">Opening balance</span>
                <input
                  inputMode="decimal"
                  className="w-full rounded bg-ink px-2 py-1"
                  value={form.opening_balance_cents}
                  onChange={(e) => updateField('opening_balance_cents', e.target.value)}
                  placeholder="0.00"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-sm">Opening balance date</span>
                <input
                  type="date"
                  className="w-full rounded bg-ink px-2 py-1"
                  value={form.created_on}
                  onChange={(e) => updateField('created_on', e.target.value)}
                />
              </label>
            </>
          )}

          {editingId && (
            <p className="text-xs text-paper-soft">
              Only transactions recorded after this change use the new type, side or floor —
              nothing already recorded is touched.
            </p>
          )}

          {formError && <p className="text-bad text-sm">{formError}</p>}

          <div className="flex gap-2">
            <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm font-medium">
              {editingId ? 'Save changes' : 'Add account'}
            </button>
            {editingId && (
              <button type="button" className="rounded bg-ink px-3 py-1.5 text-sm" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}
