import { useEffect, useState } from 'react'
import { api } from './api.js'
import { DEFAULT_CREDIT_LIMIT_CENTS, DEFAULT_ON_BUDGET, ON_BUDGET_TYPES, TRACKING_TYPES } from './account_types.js'
import { formatCents, formatDate, parseCents } from './utils/format.js'

const VALUE_TYPES = ['Asset', 'Investment']

// Blank string is null (unknown); "0.00" is 0 (no credit) — the form never collapses them.
function creditLimitText(cents) {
  return cents === null || cents === undefined ? '' : String(cents / 100)
}

function emptyForm(pickerDate) {
  return {
    name: '',
    type: ON_BUDGET_TYPES[0],
    on_budget: DEFAULT_ON_BUDGET[ON_BUDGET_TYPES[0]],
    on_budget_floor_cents: '0',
    credit_limit_cents: creditLimitText(DEFAULT_CREDIT_LIMIT_CENTS[ON_BUDGET_TYPES[0]]),
    opening_balance_cents: '',
    created_on: pickerDate,
  }
}

function emptyCheckForm(pickerDate) {
  return { date: pickerDate, stated_balance_cents: '', category_id: '' }
}

export default function Accounts({ pickerDate }) {
  const [accounts, setAccounts] = useState(null)
  const [categories, setCategories] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(() => emptyForm(pickerDate))
  const [formError, setFormError] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const [checkingId, setCheckingId] = useState(null)
  const [checkForm, setCheckForm] = useState(() => emptyCheckForm(pickerDate))
  const [checkError, setCheckError] = useState(null)
  const [checkResult, setCheckResult] = useState(null)
  const [undoError, setUndoError] = useState(null)

  const [showArchived, setShowArchived] = useState(false)
  const [archivingId, setArchivingId] = useState(null)
  const [archiveDate, setArchiveDate] = useState(pickerDate)
  const [archiveError, setArchiveError] = useState(null)
  const [archiveWarnings, setArchiveWarnings] = useState([])
  const [archiveDone, setArchiveDone] = useState(false)
  const [rowError, setRowError] = useState(null)

  function refresh() {
    api.accounts.list(pickerDate, showArchived).then(setAccounts).catch((e) => setError(e.message))
    api.categories.list().then(setCategories).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function selectType(type) {
    setForm((f) => ({
      ...f,
      type,
      on_budget: DEFAULT_ON_BUDGET[type],
      // Only when creating; a limit already typed is never overridden, and an edit never re-defaults.
      credit_limit_cents:
        editingId || f.credit_limit_cents !== creditLimitText(DEFAULT_CREDIT_LIMIT_CENTS[f.type])
          ? f.credit_limit_cents
          : creditLimitText(DEFAULT_CREDIT_LIMIT_CENTS[type]),
    }))
  }

  function editAccount(a) {
    resetCheck()
    setEditingId(a.id)
    setForm({
      name: a.name,
      type: a.type,
      on_budget: a.on_budget,
      on_budget_floor_cents: String(a.on_budget_floor_cents / 100),
      credit_limit_cents: creditLimitText(a.terms.credit_limit_cents),
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

  function startCheck(account) {
    setEditingId(null)
    setCheckingId(account.id)
    setCheckForm(emptyCheckForm(pickerDate))
    setCheckError(null)
    setCheckResult(null)
  }

  function resetCheck() {
    setCheckingId(null)
    setCheckForm(emptyCheckForm(pickerDate))
    setCheckError(null)
    setCheckResult(null)
  }

  function startArchive(account) {
    setEditingId(null)
    resetCheck()
    setArchivingId(account.id)
    setArchiveDate(pickerDate)
    setArchiveError(null)
    setArchiveWarnings([])
    setArchiveDone(false)
  }

  function resetArchive() {
    setArchivingId(null)
    setArchiveError(null)
    setArchiveWarnings([])
    setArchiveDone(false)
  }

  // Warnings never block: the archive has already happened by the time they are shown.
  async function submitArchive(e) {
    e.preventDefault()
    setArchiveError(null)
    if (!archiveDate) return setArchiveError('Date is required.')
    try {
      const result = await api.accounts.archive(archivingId, archiveDate)
      setArchiveWarnings(result.warnings)
      setArchiveDone(true)
      refresh()
    } catch (err) {
      setArchiveError(err.message)
    }
  }

  async function unarchiveAccount(e, account) {
    e.stopPropagation()
    setRowError(null)
    try {
      await api.accounts.unarchive(account.id)
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
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

    try {
      const result = await api.accounts.checkBalance(checkingId, {
        date: checkForm.date,
        stated_balance_cents: statedCents,
        category_id: checkForm.category_id ? Number(checkForm.category_id) : null,
      })
      setCheckResult(result)
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

  async function submit(e) {
    e.preventDefault()
    setFormError(null)

    const floorCents = parseCents(form.on_budget_floor_cents) ?? 0
    if (!form.name.trim()) return setFormError('Name is required.')
    const creditLimitCents = parseCents(form.credit_limit_cents) // blank stays null: unknown, not 0

    try {
      if (editingId) {
        await api.accounts.update(editingId, {
          name: form.name.trim(),
          type: form.type,
          on_budget: form.on_budget,
          on_budget_floor_cents: floorCents,
          // Keep the account's other terms as they are; only the limit is editable here.
          terms: { ...accounts.find((a) => a.id === editingId).terms, credit_limit_cents: creditLimitCents },
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
          terms: { credit_limit_cents: creditLimitCents },
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
        {undoError && <p className="text-bad">{undoError}</p>}
        {rowError && <p className="text-bad">{rowError}</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
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
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-ink" onClick={() => editAccount(a)}>
                  <td className="py-1">
                    {a.name}
                    {a.archived_on && (
                      <div className="text-xs text-paper-soft">archived {formatDate(a.archived_on)}</div>
                    )}
                    {a.checked_on && (
                      <div className="text-xs text-paper-soft">
                        {VALUE_TYPES.includes(a.type) ? 'value updated' : 'balance checked'} {formatDate(a.checked_on)}
                        {a.entries_added_since_check > 0 &&
                          ` — ${a.entries_added_since_check} ${a.entries_added_since_check === 1 ? 'entry' : 'entries'} added since`}
                        {' — '}
                        <button
                          type="button"
                          className="text-accent underline"
                          onClick={(e) => undoCheck(e, a)}
                        >
                          Undo check
                        </button>
                      </div>
                    )}
                    {a.notes.map((note) => (
                      <div key={note} className="text-xs text-bad">{note}</div>
                    ))}
                  </td>
                  <td className="py-1">{a.type}</td>
                  <td className="py-1">{a.on_budget ? 'On-budget' : 'Tracking'}</td>
                  <td className={`py-1 text-right ${a.balance_cents < 0 ? 'text-bad' : ''}`}>
                    {formatCents(a.balance_cents)}
                  </td>
                  <td className="py-1 text-right space-x-2">
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={(e) => {
                        e.stopPropagation()
                        startCheck(a)
                      }}
                    >
                      {VALUE_TYPES.includes(a.type) ? 'Update value' : 'Check balance'}
                    </button>
                    {a.archived_on ? (
                      <button type="button" className="text-xs text-accent" onClick={(e) => unarchiveAccount(e, a)}>
                        Unarchive
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-accent"
                        onClick={(e) => {
                          e.stopPropagation()
                          startArchive(a)
                        }}
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {archivingId && (
        <section className="rounded-lg bg-ink-soft p-4 space-y-3">
          <h2 className="text-sm uppercase tracking-wide text-paper-soft">
            Archive — {accounts?.find((a) => a.id === archivingId)?.name}
          </h2>
          <form className="space-y-3" onSubmit={submitArchive}>
            <label className="block space-y-1">
              <span className="text-sm">Archive on</span>
              <input
                type="date"
                className="w-full rounded bg-ink px-2 py-1"
                value={archiveDate}
                disabled={archiveDone}
                onChange={(e) => setArchiveDate(e.target.value)}
              />
            </label>
            {archiveError && <p className="text-bad text-sm">{archiveError}</p>}
            {archiveDone && (
              <>
                <p className="text-sm text-paper-soft">Archived on {formatDate(archiveDate)}.</p>
                {archiveWarnings.map((w) => (
                  <p key={w} className="text-sm text-bad">{w}</p>
                ))}
              </>
            )}
            <div className="flex gap-2">
              {!archiveDone && (
                <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm font-medium">
                  Archive
                </button>
              )}
              <button type="button" className="rounded bg-ink px-3 py-1.5 text-sm" onClick={resetArchive}>
                Close
              </button>
            </div>
          </form>
        </section>
      )}

      {checkingId && (
        <section className="rounded-lg bg-ink-soft p-4 space-y-3">
          <h2 className="text-sm uppercase tracking-wide text-paper-soft">
            {VALUE_TYPES.includes(accounts.find((a) => a.id === checkingId)?.type) ? 'Update value' : 'Check balance'}
            {' — '}
            {accounts.find((a) => a.id === checkingId)?.name}
          </h2>
          <form className="space-y-3" onSubmit={submitCheck}>
            <label className="block space-y-1">
              <span className="text-sm">Date</span>
              <input
                type="date"
                className="w-full rounded bg-ink px-2 py-1"
                value={checkForm.date}
                onChange={(e) => updateCheckField('date', e.target.value)}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm">Stated balance</span>
              <input
                inputMode="decimal"
                className="w-full rounded bg-ink px-2 py-1"
                value={checkForm.stated_balance_cents}
                onChange={(e) => updateCheckField('stated_balance_cents', e.target.value)}
                placeholder="0.00"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm">Category for the difference (optional — otherwise ready to assign)</span>
              <select
                className="w-full rounded bg-ink px-2 py-1"
                value={checkForm.category_id}
                onChange={(e) => updateCheckField('category_id', e.target.value)}
              >
                <option value="">Ready to assign</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            {checkError && <p className="text-bad text-sm">{checkError}</p>}
            {checkResult && checkResult.diff_cents === 0 && (
              <p className="text-sm text-paper-soft">That matches the ledger — nothing recorded.</p>
            )}
            {checkResult && checkResult.diff_cents !== 0 && (
              <p className="text-sm text-paper-soft">
                Adjustment of {formatCents(checkResult.diff_cents)} recorded
                {checkForm.category_id
                  ? ` to ${categories?.find((c) => c.id === Number(checkForm.category_id))?.name}.`
                  : ' to ready to assign.'}
              </p>
            )}

            <div className="flex gap-2">
              <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm font-medium">
                Save
              </button>
              <button type="button" className="rounded bg-ink px-3 py-1.5 text-sm" onClick={resetCheck}>
                Close
              </button>
            </div>
          </form>
        </section>
      )}

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

          <label className="block space-y-1">
            <span className="text-sm">Credit limit (blank if you don't know it; 0 for none)</span>
            <input
              inputMode="decimal"
              className="w-full rounded bg-ink px-2 py-1"
              value={form.credit_limit_cents}
              onChange={(e) => updateField('credit_limit_cents', e.target.value)}
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
