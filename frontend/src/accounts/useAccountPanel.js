import { useState } from 'react'
import { api } from '../api.js'
import { BOUNDARY_DEFAULT_SEEDED_KEY, BOUNDARY_DEFAULT_TYPES, DEFAULT_CREDIT_LIMIT_CENTS, DEFAULT_ON_BUDGET, LINKED_DEFAULT_TYPE, OWED_TO_ME_SEEDED_KEY } from '../account_types.js'
import { parseCents } from '../utils/format.js'
import { termsToText, textToTerms } from '../utils/terms.js'
import { creditLimitText, emptyForm } from './accountForm.js'
import { useArchiveAccount } from './useArchiveAccount.js'
import { useBalanceCheck } from './useBalanceCheck.js'

// The side panel's forms: add / edit an account, check its balance, archive it. One panel is open at a
// time, so opening one resets the others.
export function useAccountPanel({ pickerDate, data }) {
  const { accounts, categories, setPayees, refresh } = data
  // Bumped when the form resets or loads an account so the payee picker remounts with fresh text.
  const [formKey, setFormKey] = useState(0)
  // Same for the boundary category picker, which also reseeds when a type picks its default.
  const [boundaryKey, setBoundaryKey] = useState(0)
  const [form, setForm] = useState(() => emptyForm(pickerDate))
  const [formError, setFormError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  // The loan terms start folded under a one-line summary, for every type; the toggle unfolds them.
  const [termsOpen, setTermsOpen] = useState(false)
  const [adding, setAdding] = useState(false) // the add form is open in the side panel
  const [focusKey, setFocusKey] = useState(0) // returns focus to the panel's first field
  const [saving, setSaving] = useState(false)
  // The row just saved is highlighted; an add also says Recorded. Both clear when another form opens.
  const [savedNote, setSavedNote] = useState(null)
  const [highlightId, setHighlightId] = useState(null)

  const check = useBalanceCheck({ accounts, pickerDate, refresh })
  const archive = useArchiveAccount({ pickerDate, refresh })
  const { resetCheck } = check
  const { resetArchive } = archive

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  // The seeded "Debt payments" for the debt types, found by seeded_key and never by name.
  function boundaryDefault(type) {
    if (!BOUNDARY_DEFAULT_TYPES.includes(type)) return null
    return categories?.find((c) => c.seeded_key === BOUNDARY_DEFAULT_SEEDED_KEY)?.id ?? null
  }

  // The seeded "Owed to me" for Money owed to me, found by seeded_key and never by name; live only.
  function linkedDefault(type) {
    if (type !== LINKED_DEFAULT_TYPE) return null
    return categories?.find((c) => c.seeded_key === OWED_TO_ME_SEEDED_KEY && !c.archived_on)?.id ?? null
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
      // Same for the link: only when creating, and only while the pick is still the previous type's default.
      linked_category_id:
        editingId || f.linked_category_id !== linkedDefault(f.type) ? f.linked_category_id : linkedDefault(type),
      // Only when creating; a limit already typed is never overridden, and an edit never re-defaults.
      credit_limit_cents:
        editingId || f.credit_limit_cents !== creditLimitText(DEFAULT_CREDIT_LIMIT_CENTS[f.type])
          ? f.credit_limit_cents
          : creditLimitText(DEFAULT_CREDIT_LIMIT_CENTS[type]),
    }))
  }

  function clearSaved() {
    setSavedNote(null)
    setHighlightId(null)
  }

  function startAdd() {
    clearSaved()
    resetCheck()
    resetArchive()
    resetForm()
    setAdding(true)
    setFocusKey((k) => k + 1)
  }

  function closePanel() {
    resetForm()
    resetCheck()
    resetArchive()
    setAdding(false)
  }

  function editAccount(a) {
    clearSaved()
    resetCheck()
    resetArchive()
    setAdding(false)
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
    clearSaved()
    setAdding(false)
    resetArchive()
    setFocusKey((k) => k + 1)
    setEditingId(null)
    check.beginCheck(account)
  }

  function startArchive(account) {
    clearSaved()
    setAdding(false)
    setFocusKey((k) => k + 1)
    setEditingId(null)
    resetCheck()
    archive.beginArchive(account)
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
      let saved
      const wasAdd = !editingId
      if (editingId) {
        setSaving(true)
        saved = await api.accounts.update(editingId, {
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
        saved = await api.accounts.create({
          name: form.name.trim(),
          created_on: form.created_on,
          type: form.type,
          on_budget: form.on_budget,
          on_budget_floor_cents: floorCents,
          opening_balance_cents: openingBalanceCents,
          locked_payee_id: form.locked_payee_id,
          boundary_category_id: form.boundary_category_id,
          linked_category_id: form.on_budget ? form.linked_category_id : null,
          terms: { ...lenderTerms.terms, credit_limit_cents: creditLimitCents },
        })
      }
      const savedId = saved?.id ?? editingId
      closePanel()
      setSavedNote(wasAdd ? 'Recorded.' : null)
      setHighlightId(savedId ?? null)
      refresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const selectedId = editingId ?? check.checkingId ?? archive.archivingId
  const panelOpen = adding || selectedId != null
  const selectedAccount = accounts?.find((a) => a.id === selectedId)

  return {
    check, archive, form, updateField, selectType, formError, setFormError, editingId, termsOpen, setTermsOpen,
    adding, focusKey, saving, savedNote, highlightId, formKey, boundaryKey,
    startAdd, closePanel, editAccount, addPayee, submit, startCheck, startArchive,
    selectedId, panelOpen, selectedAccount,
  }
}
