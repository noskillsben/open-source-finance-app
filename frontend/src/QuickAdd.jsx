import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from './api.js'
import Button from './components/Button.jsx'
import ChoicePicker from './components/ChoicePicker.jsx'
import MoneyInput from './components/MoneyInput.jsx'
import { RefusalNote, SaveNote, WarningNote } from './components/Notes.jsx'
import PayeePicker from './PayeePicker.jsx'
import { formatCents, formatDate, parseCents } from './utils/format.js'

// Quick add (DESIGN.md § Visual design → Quick add): pick a payee, type the amount, save. A page,
// not a mode: it records through the same POST /api/transactions as the Transactions form, and
// "More details" hands everything typed to that form.

// One of category / account / date: its current value, one tap to change.
function ChangeRow({ label, shown, children }) {
  const [open, setOpen] = useState(false)
  const editing = open
  return (
    <div className="space-y-1">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="field-label">{label}</span>
        {!editing && (
          <>
            <span className="min-w-0 flex-1 truncate text-right">{shown}</span>
            <Button variant="quiet" aria-label={`Change ${label.toLowerCase()}`} onClick={() => setOpen(true)}>
              Change
            </Button>
          </>
        )}
      </div>
      {editing && <div onBlur={() => setOpen(false)}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

export default function QuickAdd({ pickerDate }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [payees, setPayees] = useState(null)
  const [recent, setRecent] = useState([])
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [goals, setGoals] = useState([])
  const [splits, setSplits] = useState([])
  const [error, setError] = useState(null)

  const [formKey, setFormKey] = useState(0)
  const [payeeId, setPayeeId] = useState(null)
  const [amount, setAmount] = useState('-') // − Spent is the default
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(pickerDate)
  const [memo, setMemo] = useState('')
  const [fill, setFill] = useState(null) // the last payment's answer for the chosen payee
  const [billAnswer, setBillAnswer] = useState(null) // goal id -> 'yes' | 'no'
  const [formError, setFormError] = useState(null)
  const [saved, setSaved] = useState(null) // { what, notes, overspent }
  const touched = useRef({ category: false, account: false, date: false })
  const pickedPayee = useRef(null)
  const saving = useRef(false)

  useEffect(() => {
    Promise.all([
      api.payees.list(pickerDate),
      api.payees.recent(pickerDate),
      api.accounts.list(),
      api.categories.list(pickerDate),
      api.goals.list(pickerDate),
    ])
      .then(([p, r, a, c, g]) => {
        setPayees(p)
        setRecent(r)
        setAccounts(a)
        setCategories(c)
        setGoals(g)
      })
      .catch((e) => setError(e.message))
  }, [pickerDate])

  // The date is Show as of until a hand picks another.
  useEffect(() => {
    if (!touched.current.date) setDate(pickerDate)
  }, [pickerDate])

  const payee = payees?.find((p) => p.id === payeeId) ?? null
  const category = categories.find((c) => String(c.id) === categoryId)
  const account = accounts.find((a) => String(a.id) === accountId)
  const cents = parseCents(amount)
  const split = fill?.split_id != null ? splits.find((s) => s.id === fill.split_id) : null
  const isSplit = fill?.split_id != null

  async function pickPayee(id) {
    setPayeeId(id)
    pickedPayee.current = id
    setFill(null)
    if (id == null) return
    try {
      const answer = await api.payees.fill(id, pickerDate)
      if (pickedPayee.current !== id) return
      setFill(answer)
      const usable = (value, list) => value != null && list.some((x) => x.id === value)
      if (!touched.current.category) setCategoryId(usable(answer.category_id, categories) ? String(answer.category_id) : '')
      if (!touched.current.account) setAccountId(usable(answer.account_id, accounts) ? String(answer.account_id) : '')
      if (answer.split_id != null) api.splits.list(undefined, true).then(setSplits).catch(() => {})
    } catch (err) {
      setFormError(err.message)
    }
  }

  async function addPayee(name) {
    const created = await api.payees.create({ name, created_on: pickerDate })
    setPayees((current) => [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)))
    return created
  }

  // A recurring bill on the chosen category with a due date still unpaid: ask, never link silently.
  const bill =
    !isSplit && cents !== null && cents < 0 && categoryId
      ? goals.find(
          (g) => g.goal.kind === 'recurring_bill' && String(g.goal.category_id) === categoryId && g.earliest_unpaid_due_on
        )
      : null
  const linked = bill && billAnswer?.goalId === bill.goal.id && billAnswer.answer === 'yes'

  let source = null
  if (payee && fill) {
    source =
      fill.category_id != null || fill.account_id != null
        ? `Category and account come from your last payment to ${payee.name}; the date is Show as of.`
        : `No earlier payment to ${payee.name}, so pick a category and account. The date is Show as of.`
  }

  function reset() {
    touched.current = { category: false, account: false, date: false }
    pickedPayee.current = null
    setPayeeId(null)
    setAmount('-')
    setCategoryId('')
    setAccountId('')
    setDate(pickerDate)
    setMemo('')
    setFill(null)
    setBillAnswer(null)
    setFormError(null)
    setSaved(null)
    setFormKey((k) => k + 1)
  }

  async function save() {
    if (saving.current) return
    setFormError(null)
    if (!date) return setFormError('Date is required.')
    if (cents === null || cents === 0) return setFormError('Type an amount first.')
    if (!accountId) return setFormError('Pick the account the money moved in.')
    saving.current = true
    let result
    try {
      result = await api.transactions.create({
        date,
        memo: memo.trim() || null,
        payee_id: payeeId,
        goal_id: linked ? bill.goal.id : null,
        goal_due_on: linked ? bill.earliest_unpaid_due_on : null,
        split_id: null,
        paid_by_payee_id: null,
        shared_total_cents: null,
        account_lines: [{ account_id: Number(accountId), cents }],
        category_lines: categoryId ? [{ category_id: Number(categoryId), cents }] : [],
        deposits: [],
      })
    } catch (err) {
      saving.current = false
      return setFormError(err.message)
    }
    // Saved. Whatever follows can fail without undoing it, and the form is gone so it cannot be saved twice.
    const what = `${payee?.name ?? 'Transaction'}, ${formatCents(cents)}`
    const next = { what, notes: result?.notes ?? [], overspent: null, checkFailed: null }
    setSaved(next)
    saving.current = false
    if (!categoryId) return
    try {
      const summary = await api.readyToAssign(pickerDate)
      const available = summary.categories.find((c) => c.category_id === Number(categoryId))?.available_cents ?? 0
      if (available < 0) setSaved({ ...next, overspent: { name: category?.name, cents: -available } })
    } catch (err) {
      setSaved({ ...next, checkFailed: err.message })
    }
  }

  function done() {
    if (location.key !== 'default') navigate(-1)
    else navigate('/transactions')
  }

  function moreDetails() {
    navigate('/transactions', {
      state: {
        quickAdd: {
          date,
          memo,
          payee_id: payeeId,
          account_id: accountId ? Number(accountId) : null,
          category_id: categoryId && !isSplit ? Number(categoryId) : null,
          amount_text: amount === '-' ? '' : amount,
          goal: linked ? { goal_id: bill.goal.id, goal_due_on: bill.earliest_unpaid_due_on } : null,
          refill: isSplit,
        },
      },
    })
  }

  const visible = (recent ?? []).filter((p) => payees?.some((q) => q.id === p.id))

  if (saved) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-4">
        <h2 className="page-title hidden md:block">Quick add</h2>
        <SaveNote>Recorded {saved.what}.</SaveNote>
        {saved.overspent && (
          <WarningNote>
            {saved.overspent.name} is now overspent by {formatCents(saved.overspent.cents)}. Move money into it on Categories.
          </WarningNote>
        )}
        {saved.checkFailed && (
          <WarningNote>Recorded, but the overspent check did not run: {saved.checkFailed}</WarningNote>
        )}
        {saved.notes.map((note, i) => (
          <WarningNote key={i}>{note}</WarningNote>
        ))}
        <div className="flex gap-3">
          <Button onClick={reset}>Add another</Button>
          <Button variant="secondary" onClick={done}>Done</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 py-4">
      <h2 className="page-title hidden md:block">Quick add</h2>
      {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}

      <section className="space-y-2">
        <h3 className="field-label">Who</h3>
        {visible.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Recent payees">
            {visible.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === payeeId}
                className={`btn min-w-0 px-3 ${p.id === payeeId ? 'bg-raised text-text ring-1 ring-accent' : 'btn-secondary'}`}
                onClick={() => pickPayee(p.id === payeeId ? null : p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        <PayeePicker key={formKey} payees={payees} payeeId={payeeId} onSelect={pickPayee} onAdd={addPayee} onError={setFormError} />
      </section>

      <section className="space-y-2">
        <h3 className="field-label">How much</h3>
        <MoneyInput
          signed
          value={amount}
          onChange={setAmount}
          aria-label="Amount"
          inputClassName="text-2xl"
        />
      </section>

      {isSplit ? (
        <section className="space-y-3">
          <WarningNote>
            Your last payment to {payee?.name} was a shared bill{split ? ` (${split.name})` : ''}. The full form works out
            the shares.
          </WarningNote>
          <Button onClick={moreDetails}>Open the full form</Button>
        </section>
      ) : (
        <>
          <section className="space-y-1">
            <ChangeRow label="Category" shown={category?.name ?? 'None yet'}>
              {(close) => (
                <ChoicePicker
                  items={categories}
                  value={categoryId}
                  placeholder="Search categories…"
                  ariaLabel="Category"
                  onChange={(v) => {
                    touched.current.category = true
                    setCategoryId(v)
                    if (v) close()
                  }}
                />
              )}
            </ChangeRow>
            <ChangeRow label="Account" shown={account?.name ?? 'None yet'}>
              {(close) => (
                <ChoicePicker
                  items={accounts}
                  value={accountId}
                  placeholder="Search accounts…"
                  ariaLabel="Account"
                  onChange={(v) => {
                    touched.current.account = true
                    setAccountId(v)
                    if (v) close()
                  }}
                />
              )}
            </ChangeRow>
            <ChangeRow label="Date" shown={formatDate(date)}>
              {(close) => (
                <input
                  type="date"
                  aria-label="Date"
                  className="field w-full"
                  value={date}
                  onChange={(e) => {
                    touched.current.date = true
                    setDate(e.target.value)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && close()}
                />
              )}
            </ChangeRow>
            {source && <p className="text-sm text-text-3">{source}</p>}
          </section>

          <label className="block space-y-1">
            <span className="field-label">Memo</span>
            <input className="w-full field" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>

          {bill && (
            <div className="space-y-2 rounded-lg bg-raised p-3">
              <p>
                This pays <strong>{bill.goal.name}</strong>, due {bill.earliest_unpaid_due_text}?
              </p>
              <div className="flex gap-2">
                {['yes', 'no'].map((answer) => (
                  <button
                    key={answer}
                    type="button"
                    className="btn btn-secondary"
                    aria-pressed={billAnswer?.goalId === bill.goal.id && billAnswer.answer === answer}
                    onClick={() => setBillAnswer({ goalId: bill.goal.id, answer })}
                  >
                    {answer === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {formError && <RefusalNote>{formError}</RefusalNote>}

          <div className="sticky bottom-bar z-10 flex gap-3 bg-page py-3 md:bottom-0">
            <Button className="flex-1" onClick={save}>Save</Button>
            <Button variant="secondary" onClick={moreDetails}>More details</Button>
          </div>
        </>
      )}
      {isSplit && formError && <RefusalNote>{formError}</RefusalNote>}
    </div>
  )
}
