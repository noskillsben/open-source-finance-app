import { useEffect, useState } from 'react'
import { api } from './api.js'
import {
  BOUNDARY_DEFAULT_SEEDED_KEY, BOUNDARY_DEFAULT_TYPES, COMPOUNDING_RULES, DEBT_TYPES, DEFAULT_CREDIT_LIMIT_CENTS, DEFAULT_ON_BUDGET, ON_BUDGET_TYPES, PREPAYMENT_MODELS,
  TRACKING_TYPES,
} from './account_types.js'
import { formatCents, formatDate, parseCents } from './utils/format.js'
import Button from './components/Button.jsx'
import ChoicePicker from './components/ChoicePicker.jsx'
import EmptyState from './components/EmptyState.jsx'
import ListFilters from './components/ListFilters.jsx'
import { useFilters } from './utils/useFilters.js'
import LoadingRows from './components/LoadingRows.jsx'
import MoneyInput from './components/MoneyInput.jsx'
import { RefusalNote, SaveNote, WarningNote } from './components/Notes.jsx'
import SidePanel, { PanelLayout } from './components/SidePanel.jsx'
import NamePicker from './NamePicker.jsx'
import PayeePicker from './PayeePicker.jsx'
import { emptyTermsText, termsLine, termsToText, textToTerms } from './utils/terms.js'

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
    locked_payee_id: null,
    boundary_category_id: null,
    opening_balance_cents: '',
    created_on: pickerDate,
    ...emptyTermsText(),
  }
}

function emptyCheckForm(pickerDate) {
  return { date: pickerDate, stated_balance_cents: '', category_id: '' }
}

function TermText({ form, field, label, onChange, decimal = false }) {
  return (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      <input
        inputMode={decimal ? 'decimal' : field === 'minimum_payment_rule' ? 'text' : 'numeric'}
        className="w-full field"
        value={form[field]}
        onChange={(e) => onChange(field, e.target.value)}
      />
    </label>
  )
}

function TermDate({ form, field, label, onChange }) {
  return (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      <input type="date" className="w-full field" value={form[field]} onChange={(e) => onChange(field, e.target.value)} />
    </label>
  )
}

function TermSelect({ form, field, label, options, onChange }) {
  return (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      <select className="w-full field" value={form[field]} onChange={(e) => onChange(field, e.target.value)}>
        <option value="">Unknown</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

export default function Accounts({ pickerDate }) {
  const [accounts, setAccounts] = useState(null)
  const [categories, setCategories] = useState(null)
  const [payees, setPayees] = useState(null) // not archived at the picker date: the lock picker's choices
  const [payeesAll, setPayeesAll] = useState(null) // names for a lock on a payee archived since
  // Bumped when the form resets or loads an account so the payee picker remounts with fresh text.
  const [formKey, setFormKey] = useState(0)
  // Same for the boundary category picker, which also reseeds when a type picks its default.
  const [boundaryKey, setBoundaryKey] = useState(0)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(() => emptyForm(pickerDate))
  const [formError, setFormError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  // The loan terms start folded under a one-line summary, for every type; the toggle unfolds them.
  const [termsOpen, setTermsOpen] = useState(false)
  const [adding, setAdding] = useState(false) // the add form is open in the side panel
  const [focusKey, setFocusKey] = useState(0) // returns focus to the panel's first field
  const [saved, setSaved] = useState(null) // the save note after an add
  const [saving, setSaving] = useState(false)

  const [checkingId, setCheckingId] = useState(null)
  const [checkForm, setCheckForm] = useState(() => emptyCheckForm(pickerDate))
  const [checkError, setCheckError] = useState(null)
  const [checkResult, setCheckResult] = useState(null)
  // The linked-category split of a gain or loss (DESIGN.md § Linked categories): suggested by the
  // backend, edited here, sent as the adjustment's category lines.
  const [splitLines, setSplitLines] = useState([])
  const [splitDiff, setSplitDiff] = useState(0)
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
    api.payees.list(pickerDate).then(setPayees).catch((e) => setError(e.message))
    api.payees.list(undefined, true).then(setPayeesAll).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  // The seeded "Debt payments" for the debt types, found by seeded_key and never by name.
  function boundaryDefault(type) {
    if (!BOUNDARY_DEFAULT_TYPES.includes(type)) return null
    return categories?.find((c) => c.seeded_key === BOUNDARY_DEFAULT_SEEDED_KEY)?.id ?? null
  }

  function selectType(type) {
    if (!editingId) setBoundaryKey((k) => k + 1)
    setForm((f) => ({
      ...f,
      type,
      on_budget: DEFAULT_ON_BUDGET[type],
      // Only when creating, and only while the pick is still the previous type's default.
      boundary_category_id:
        editingId || f.boundary_category_id !== boundaryDefault(f.type) ? f.boundary_category_id : boundaryDefault(type),
      // Only when creating; a limit already typed is never overridden, and an edit never re-defaults.
      credit_limit_cents:
        editingId || f.credit_limit_cents !== creditLimitText(DEFAULT_CREDIT_LIMIT_CENTS[f.type])
          ? f.credit_limit_cents
          : creditLimitText(DEFAULT_CREDIT_LIMIT_CENTS[type]),
    }))
  }

  function startAdd() {
    resetCheck()
    resetArchive()
    resetForm()
    setAdding(true)
    setSaved(null)
    setFocusKey((k) => k + 1)
  }

  function closePanel() {
    resetForm()
    resetCheck()
    resetArchive()
    setAdding(false)
    setSaved(null)
  }

  function editAccount(a) {
    resetCheck()
    resetArchive()
    setAdding(false)
    setSaved(null)
    setFocusKey((k) => k + 1)
    setEditingId(a.id)
    setForm({
      name: a.name,
      type: a.type,
      on_budget: a.on_budget,
      on_budget_floor_cents: String(a.on_budget_floor_cents / 100),
      credit_limit_cents: creditLimitText(a.terms.credit_limit_cents),
      locked_payee_id: a.locked_payee_id,
      boundary_category_id: a.boundary_category_id ?? null,
      opening_balance_cents: '',
      created_on: a.created_on,
      ...termsToText(a.terms),
    })
    setTermsOpen(false)
    setFormKey((k) => k + 1)
    setBoundaryKey((k) => k + 1)
    setFormError(null)
  }

  // A new store name typed into the lock box: create the payee (dated at the account's opening date,
  // as Transactions uses its form date) and hand it back for the picker to choose.
  async function addPayee(name) {
    const payee = await api.payees.create({ name, created_on: form.created_on })
    setPayees((current) => [...(current ?? []), payee].sort((a, b) => a.name.localeCompare(b.name)))
    return payee
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm(pickerDate))
    setTermsOpen(false)
    setFormKey((k) => k + 1)
    setBoundaryKey((k) => k + 1)
    setFormError(null)
  }

  function startCheck(account) {
    setAdding(false)
    resetArchive()
    setSaved(null)
    setFocusKey((k) => k + 1)
    setEditingId(null)
    setCheckingId(account.id)
    setCheckForm(emptyCheckForm(pickerDate))
    setCheckError(null)
    setCheckResult(null)
    setSplitLines([])
  }

  function resetCheck() {
    setSplitLines([])
    setCheckingId(null)
    setCheckForm(emptyCheckForm(pickerDate))
    setCheckError(null)
    setCheckResult(null)
  }

  function startArchive(account) {
    setAdding(false)
    setSaved(null)
    setFocusKey((k) => k + 1)
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

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setFormError(null)

    const floorCents = parseCents(form.on_budget_floor_cents) ?? 0
    if (!form.name.trim()) return setFormError('Name is required.')
    const creditLimitCents = parseCents(form.credit_limit_cents) // blank stays null: unknown, not 0
    const lenderTerms = textToTerms(form)
    if (lenderTerms.error) return setFormError(lenderTerms.error)

    try {
      if (editingId) {
        setSaving(true)
        await api.accounts.update(editingId, {
          name: form.name.trim(),
          type: form.type,
          on_budget: form.on_budget,
          on_budget_floor_cents: floorCents,
          locked_payee_id: form.locked_payee_id,
          boundary_category_id: form.boundary_category_id,
          // The whole block, merged over the account's own: a PUT that sends terms replaces all of them.
          terms: { ...accounts.find((a) => a.id === editingId).terms, ...lenderTerms.terms, credit_limit_cents: creditLimitCents },
        })
      } else {
        // Blank, or Owed chosen with nothing typed, matches the field's 0.00 placeholder; typed text that isn't a number is still refused.
        const openingBalanceCents = form.opening_balance_cents.replace(/[-−+\s]/g, '') === '' ? 0 : parseCents(form.opening_balance_cents)
        if (!form.created_on) return setFormError('Opening balance date is required.')
        if (openingBalanceCents === null) return setFormError('Opening balance must be a number.')
        setSaving(true)
        await api.accounts.create({
          name: form.name.trim(),
          created_on: form.created_on,
          type: form.type,
          on_budget: form.on_budget,
          on_budget_floor_cents: floorCents,
          opening_balance_cents: openingBalanceCents,
          locked_payee_id: form.locked_payee_id,
          boundary_category_id: form.boundary_category_id,
          terms: { ...lenderTerms.terms, credit_limit_cents: creditLimitCents },
        })
      }
      if (editingId) closePanel()
      else {
        resetForm()
        setSaved(`Added ${form.name.trim()}.`)
      }
      refresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
      setFocusKey((k) => k + 1)
    }
  }

  // Accounts locked to the same payee read as one line with a balance each (DESIGN.md § Payee-locked
  // accounts). Derived here from the list, at read time: a lone locked account keeps its own row.
  const { filters, setFilter, clear: clearFilters, active: filtersActive } = useFilters('accounts.filters', { search: '', type: '', side: '' })
  const needle = filters.search.trim().toLowerCase()
  const visible = (accounts ?? []).filter(
    (a) =>
      a.name.toLowerCase().includes(needle) &&
      (filters.type === '' || a.type === filters.type) &&
      (filters.side === '' || a.on_budget === (filters.side === 'on')),
  )
  const rows = []
  const groups = new Map()
  for (const a of visible) {
    const shared = a.locked_payee_id != null && accounts.filter((o) => o.locked_payee_id === a.locked_payee_id).length > 1
    if (!shared) rows.push({ account: a })
    else if (!groups.has(a.locked_payee_id)) {
      const row = { payeeId: a.locked_payee_id, group: [] }
      groups.set(a.locked_payee_id, row)
      rows.push(row)
    }
    if (shared) groups.get(a.locked_payee_id).group.push(a)
  }

  // A lock on a payee archived since stays visible in the picker, labelled, and saves unchanged
  // (DESIGN.md § General concepts): archived entities leave pickers but not where they are referenced.
  const lockedArchived =
    form.locked_payee_id != null && payees && !payees.some((p) => p.id === form.locked_payee_id)
      ? payeesAll?.find((p) => p.id === form.locked_payee_id)
      : null
  const pickerPayees = lockedArchived ? [...payees, { ...lockedArchived, name: `${lockedArchived.name} (archived)` }] : payees

  function accountNotes(a) {
    return (
      <>
        {termsLine(a.terms) && <div className="text-sm text-text-3">{termsLine(a.terms)}</div>}
        {a.archived_on && <div className="text-sm text-text-3">archived {formatDate(a.archived_on)}</div>}
        {a.checked_on && (
          <div className="text-sm text-text-3">
            {a.checked_is_opening ? 'opened' : VALUE_TYPES.includes(a.type) ? 'value updated' : 'balance checked'}{' '}
            {formatDate(a.checked_on)}
            {a.entries_added_since_check > 0 &&
              ` — ${a.entries_added_since_check} ${a.entries_added_since_check === 1 ? 'entry' : 'entries'} added since`}
            {!a.checked_is_opening && (
              <>
                {' — '}
                <button type="button" className="btn btn-quiet underline" onClick={(e) => undoCheck(e, a)}>
                  Undo check
                </button>
              </>
            )}
          </div>
        )}
        {a.notes.map((note) => (
          <div key={note} className="text-sm text-warning">{note}</div>
        ))}
      </>
    )
  }

  function accountActions(a) {
    return (
      <>
        <Button
          variant="quiet"
          onClick={(e) => {
            e.stopPropagation()
            startCheck(a)
          }}
        >
          {VALUE_TYPES.includes(a.type) ? 'Update value' : 'Check balance'}
        </Button>
        {a.archived_on ? (
          <Button variant="quiet" onClick={(e) => unarchiveAccount(e, a)}>Unarchive</Button>
        ) : (
          <Button
            variant="quiet"
            onClick={(e) => {
              e.stopPropagation()
              startArchive(a)
            }}
          >
            Archive
          </Button>
        )}
      </>
    )
  }

  const selectedId = editingId ?? checkingId ?? archivingId
  const panelOpen = adding || selectedId != null
  const selectedAccount = accounts?.find((a) => a.id === selectedId)
  const onBudget = form.on_budget
  // The loan terms fold under one line: what is stated so far, or that nothing is.
  const termsSummary = (() => {
    const parsed = textToTerms(form)
    return (parsed.terms && termsLine(parsed.terms)) || 'Nothing entered'
  })()

  const editForm = (
    <form className="space-y-4" onSubmit={submit}>
      {formError && <RefusalNote>{formError}</RefusalNote>}
      {saved && <SaveNote>{saved}</SaveNote>}
      <label className="block space-y-1">
        <span className="field-label">Name</span>
        <input
          className="w-full field"
          value={form.name}
          disabled={saving}
          onChange={(e) => updateField('name', e.target.value)}
        />
      </label>

      <label className="block space-y-1">
        <span className="field-label">Type</span>
        <select className="w-full field" value={form.type} onChange={(e) => selectType(e.target.value)}>
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

      <label className="flex min-h-11 items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.on_budget}
          onChange={(e) => updateField('on_budget', e.target.checked)}
        />
        <span>On-budget (money here can be assigned to categories)</span>
      </label>

      {onBudget && (
        <MoneyInput
          label="On-budget floor"
          signed
          balance
          value={form.on_budget_floor_cents}
          onChange={(text) => updateField('on_budget_floor_cents', text)}
        />
      )}

      <MoneyInput
        label="Credit limit (blank if you don't know it; 0 for none)"
        value={form.credit_limit_cents}
        onChange={(text) => updateField('credit_limit_cents', text)}
        placeholder="unknown"
      />

      <div className="space-y-2">
        <button
          type="button"
          aria-expanded={termsOpen}
          className="btn btn-quiet w-full justify-between px-0"
          onClick={() => setTermsOpen((v) => !v)}
        >
          <span>Loan terms</span>
          <span aria-hidden="true">{termsOpen ? '−' : '+'}</span>
        </button>
        <p className="text-sm text-text-3">{termsSummary}</p>
        {termsOpen && (
          <fieldset className="space-y-3 rounded-lg bg-raised p-3">
            <legend className="px-1 text-sm text-text-2">Leave blank what you don&apos;t know</legend>
            <TermText form={form} field="annual_rate" label="Annual rate (%)" onChange={updateField} decimal />
            <TermSelect form={form} field="compounding_rule" label="Compounds" options={COMPOUNDING_RULES} onChange={updateField} />
            <TermText form={form} field="statement_close_day" label="Statement closes on day (1–31)" onChange={updateField} />
            <TermText form={form} field="grace_days" label="Grace days after the statement closes" onChange={updateField} />
            <TermDate form={form} field="term_end" label="Term ends" onChange={updateField} />
            <TermDate form={form} field="amortization_end" label="Amortization ends" onChange={updateField} />
            <TermSelect form={form} field="prepayment_model" label="Prepayment" options={PREPAYMENT_MODELS} onChange={updateField} />
            <TermDate form={form} field="promo_expiry_date" label="Promo ends" onChange={updateField} />
            <TermText form={form} field="deferred_rate" label="Deferred rate (%)" onChange={updateField} decimal />
            <TermText form={form} field="minimum_payment_rule" label="Minimum payment rule" onChange={updateField} />
          </fieldset>
        )}
      </div>

      <label className="block space-y-1">
        <span className="field-label">Locked to a payee (optional — a gift card or store credit only spends there)</span>
        <PayeePicker
          key={formKey}
          payees={pickerPayees}
          payeeId={form.locked_payee_id}
          onSelect={(id) => updateField('locked_payee_id', id)}
          onAdd={addPayee}
          onError={setFormError}
          inline
        />
      </label>

      {categories && !onBudget && (
        <NamePicker
          key={boundaryKey}
          label="Category money leaves the budget through (optional — a loan payment is recorded against it)"
          items={categories.filter((c) => !c.archived_on)}
          initialId={form.boundary_category_id}
          onChange={(id) => updateField('boundary_category_id', id)}
        />
      )}

      {!editingId && (
        <>
          <MoneyInput
            label="Opening balance"
            signed
            balance
            value={form.opening_balance_cents}
            onChange={(text) => updateField('opening_balance_cents', text)}
          />

          <label className="block space-y-1">
            <span className="field-label">Opening balance date</span>
            <input
              type="date"
              className="w-full field"
              value={form.created_on}
              onChange={(e) => updateField('created_on', e.target.value)}
            />
          </label>
        </>
      )}

      {editingId && (
        <p className="text-sm text-text-3">
          Only transactions recorded after this change use the new type, side or floor —
          nothing already recorded is touched.
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>{editingId ? 'Save changes' : 'Add account'}</Button>
        <Button variant="secondary" onClick={closePanel}>{editingId ? 'Cancel' : 'Done'}</Button>
      </div>
    </form>
  )

  const checkingTitle = VALUE_TYPES.includes(selectedAccount?.type) ? 'Update value' : 'Check balance'
  const checkPanel = (
    <form className="space-y-4" onSubmit={submitCheck}>
      <label className="block space-y-1">
        <span className="field-label">Date</span>
        <input
          type="date"
          className="w-full field"
          value={checkForm.date}
          onChange={(e) => updateCheckField('date', e.target.value)}
        />
      </label>

      <MoneyInput
        label="Stated balance"
        signed
        balance
        value={checkForm.stated_balance_cents}
        onChange={(text) => updateCheckField('stated_balance_cents', text)}
      />

      {splitLines.length > 0 && (
        <div className="space-y-2">
          <span className="field-label">
            Split of the difference across the linked categories, by their balances — edit before saving.
          </span>
          {splitLines.map((line, i) => (
            <div key={line.category_id} className="flex items-center gap-2">
              <span className="flex-1 px-2 py-1">
                {categories?.find((c) => c.id === line.category_id)?.name ?? `#${line.category_id}`}
              </span>
              <MoneyInput signed aria-label="Amount" value={line.cents} onChange={(text) => updateSplitLine(i, text)} />
            </div>
          ))}
          <p className="text-sm text-text-2">
            {formatCents(splitLines.reduce((sum, l) => sum + (parseCents(l.cents) ?? 0), 0))} split of a{' '}
            {formatCents(splitDiff)} difference. Clear every amount to pick one category instead.
          </p>
        </div>
      )}

      {!checkingIsTracking && (
        <label className="block space-y-1">
          <span className="field-label">Category for the difference (optional — otherwise ready to assign)</span>
          <ChoicePicker
            items={categories ?? []}
            value={checkForm.category_id}
            onChange={(id) => updateCheckField('category_id', id)}
            placeholder="Ready to assign"
            ariaLabel="Category for the difference"
            emptyLabel="Ready to assign"
          />
        </label>
      )}

      {checkError && <RefusalNote>{checkError}</RefusalNote>}
      {checkResult && checkResult.diff_cents === 0 && (
        <SaveNote>That matches the ledger — balance checked {formatDate(checkResult.date)}, no adjustment needed.</SaveNote>
      )}
      {checkResult && checkResult.diff_cents !== 0 && (
        <SaveNote>
          Adjustment of {formatCents(checkResult.diff_cents)} recorded
          {checkingIsTracking
            ? ". This account is outside your budget, so ready to assign doesn't change."
            : checkResult.transaction.category_lines.length === 0
              ? ' to ready to assign.'
              : ` to ${checkResult.transaction.category_lines
                  .map((l) => `${categories?.find((c) => c.id === l.category_id)?.name} ${formatCents(l.cents)}`)
                  .join(', ')}.`}
        </SaveNote>
      )}

      <div className="flex gap-3">
        <Button type="submit">Save</Button>
        <Button variant="secondary" onClick={closePanel}>Close</Button>
      </div>
    </form>
  )

  const archivePanel = (
    <form className="space-y-4" onSubmit={submitArchive}>
      <label className="block space-y-1">
        <span className="field-label">Archive on</span>
        <input
          type="date"
          className="w-full field"
          value={archiveDate}
          disabled={archiveDone}
          onChange={(e) => setArchiveDate(e.target.value)}
        />
      </label>
      {archiveError && <RefusalNote>{archiveError}</RefusalNote>}
      {archiveDone && (
        <>
          <SaveNote>Archived on {formatDate(archiveDate)}.</SaveNote>
          {archiveWarnings.map((w) => (
            <WarningNote key={w}>{w}</WarningNote>
          ))}
        </>
      )}
      <div className="flex gap-3">
        {!archiveDone && <Button type="submit">Archive</Button>}
        <Button variant="secondary" onClick={closePanel}>Close</Button>
      </div>
    </form>
  )

  const panelTitle = adding
    ? 'Add an account'
    : editingId
      ? `Edit · ${selectedAccount?.name ?? ''}`
      : checkingId
        ? `${checkingTitle} · ${selectedAccount?.name ?? ''}`
        : `Archive · ${selectedAccount?.name ?? ''}`

  const panel = panelOpen && (
    <SidePanel title={panelTitle} onClose={closePanel} focusKey={focusKey}>
      {adding || editingId ? editForm : checkingId ? checkPanel : archivePanel}
    </SidePanel>
  )

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title hidden md:block">Accounts</h2>
        <Button className="ml-auto" onClick={startAdd}>Add an account</Button>
      </div>

      <PanelLayout panel={panel}>
        <section className="card space-y-3">
          {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
          {undoError && <WarningNote>{undoError}</WarningNote>}
          {rowError && <WarningNote>{rowError}</WarningNote>}
          <ListFilters
            noun="accounts"
            search={filters.search}
            onSearch={(v) => setFilter('search', v)}
            active={filtersActive}
            onClear={clearFilters}
            facets={[
              { name: 'type', label: 'Type', value: filters.type, onChange: (v) => setFilter('type', v), options: [...ON_BUDGET_TYPES, ...TRACKING_TYPES].map((t) => ({ value: t, label: t })) },
              { name: 'side', label: 'Side', value: filters.side, onChange: (v) => setFilter('side', v), options: [{ value: 'on', label: 'On-budget' }, { value: 'off', label: 'Tracking' }] },
            ]}
          >
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
          </ListFilters>
          {!error && !accounts && <LoadingRows />}
          {accounts && accounts.length === 0 && (
            <EmptyState action={<Button variant="secondary" onClick={startAdd}>Add an account</Button>}>
              No accounts yet.
            </EmptyState>
          )}
          {accounts && accounts.length > 0 && rows.length === 0 && (
            <p className="text-text-2">No accounts match these filters.</p>
          )}
          {accounts && accounts.length > 0 && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Side</th>
                    <th className="text-right">Balance</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) =>
                    row.group ? (
                      <tr key={`payee-${row.payeeId}`}>
                        <td colSpan={5} className="py-1">
                          <div className="text-sm text-text-3">
                            Locked to {payeesAll?.find((p) => p.id === row.payeeId)?.name ?? `#${row.payeeId}`}
                          </div>
                          {row.group.map((a) => (
                            <div
                              key={a.id}
                              className={`flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-2 hover:bg-raised md:min-h-11 ${selectedId === a.id ? 'bg-raised' : ''}`}
                              onClick={() => editAccount(a)}
                            >
                              <div>
                                {a.name}
                                {accountNotes(a)}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={`tabular ${a.balance_cents < 0 ? 'text-negative' : ''}`}>{formatCents(a.balance_cents)}</span>
                                <span>{accountActions(a)}</span>
                              </div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={row.account.id}
                        className={`cursor-pointer hover:bg-raised ${selectedId === row.account.id ? 'bg-raised' : ''}`}
                        onClick={() => editAccount(row.account)}
                      >
                        <td className="py-1">
                          {row.account.name}
                          {accountNotes(row.account)}
                        </td>
                        <td className="py-1">{row.account.type}</td>
                        <td className="py-1">{row.account.on_budget ? 'On-budget' : 'Tracking'}</td>
                        <td className={`tabular py-1 text-right ${row.account.balance_cents < 0 ? 'text-negative' : ''}`}>
                          {formatCents(row.account.balance_cents)}
                        </td>
                        <td className="py-1 text-right">{accountActions(row.account)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PanelLayout>
    </div>
  )
}
