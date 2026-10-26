import { COMPOUNDING_RULES, GIFT_CARD_TYPE, ON_BUDGET_TYPES, PREPAYMENT_MODELS, TRACKING_TYPES } from '../account_types.js'
import Button from '../components/Button.jsx'
import MoneyInput from '../components/MoneyInput.jsx'
import { RefusalNote } from '../components/Notes.jsx'
import NamePicker from '../NamePicker.jsx'
import PayeePicker from '../PayeePicker.jsx'
import { termsLine, textToTerms } from '../utils/terms.js'
import { TermDate, TermSelect, TermText } from './TermFields.jsx'

// The add / edit account form in the side panel, loan terms folded under a one-line summary.
export default function AccountEditForm({ data, panel }) {
  const { categories, payees, payeesAll } = data
  const {
    form, updateField, selectType, formError, setFormError, editingId, termsOpen, setTermsOpen,
    formKey, boundaryKey, saving, submit, closePanel, addPayee,
  } = panel

  // A lock on a payee archived since stays visible in the picker, labelled, and saves unchanged
  // (DESIGN.md § General concepts): archived entities leave pickers but not where they are referenced.
  const lockedArchived =
    form.locked_payee_id != null && payees && !payees.some((p) => p.id === form.locked_payee_id)
      ? payeesAll?.find((p) => p.id === form.locked_payee_id)
      : null
  const pickerPayees = lockedArchived ? [...payees, { ...lockedArchived, name: `${lockedArchived.name} (archived)` }] : payees

  const onBudget = form.on_budget
  // The loan terms fold under one line: what is stated so far, or that nothing is.
  const termsSummary = (() => {
    const parsed = textToTerms(form)
    return (parsed.terms && termsLine(parsed.terms)) || 'Nothing entered'
  })()

  // Gift card / store credit puts the lock field first (a form-only ordering; the lock stays the one mechanism).
  const lockFirst = form.type === GIFT_CARD_TYPE
  const lockField = (
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
  )
  return (
    <form className="space-y-4" onSubmit={submit}>
      {lockFirst && lockField}
      {formError && <RefusalNote>{formError}</RefusalNote>}
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

      {!lockFirst && lockField}

      {categories && !onBudget && (
        <NamePicker
          key={boundaryKey}
          label="Category money leaves the budget through (optional — a loan payment is recorded against it)"
          items={categories.filter((c) => !c.archived_on)}
          initialId={form.boundary_category_id}
          onChange={(id) => updateField('boundary_category_id', id)}
        />
      )}

      {categories && onBudget && !editingId && (
        <NamePicker
          key={`linked-${boundaryKey}`}
          label="Linked to (optional — the category this account's money belongs to)"
          items={categories.filter((c) => !c.archived_on)}
          initialId={form.linked_category_id}
          onChange={(id) => updateField('linked_category_id', id)}
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
        <Button variant="secondary" onClick={closePanel}>Cancel</Button>
      </div>
    </form>
  )
}
