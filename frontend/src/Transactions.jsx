import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from './api.js'
import { formatCents, formatDate, parseCents } from './utils/format.js'
import PayeePicker from './PayeePicker.jsx'

const emptyLine = { account_id: '', cents: '' }
const emptyCategoryLine = { category_id: '', cents: '' }
const emptyDeposit = { category_id: '', cents: '', other_category_id: '' }

export default function Transactions({ pickerDate }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState(null)
  const [categories, setCategories] = useState(null)
  const [payees, setPayees] = useState(null)
  const [transactions, setTransactions] = useState(null)
  const [goals, setGoals] = useState(null)
  const [error, setError] = useState(null)

  const [date, setDate] = useState(pickerDate)
  const [memo, setMemo] = useState('')
  const [payeeId, setPayeeId] = useState(null)
  const [accountLines, setAccountLines] = useState([{ ...emptyLine }])
  const [categoryLines, setCategoryLines] = useState([])
  const [deposits, setDeposits] = useState([])
  // Which recurring bill this payment paid and which due date: stated, never inferred.
  const [billLink, setBillLink] = useState(null)
  const [declinedBills, setDeclinedBills] = useState([])
  const [billDueDates, setBillDueDates] = useState(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [formError, setFormError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [predatesCheckNotes, setPredatesCheckNotes] = useState([])

  function refresh() {
    api.accounts.list().then(setAccounts).catch((e) => setError(e.message))
    api.categories.list(pickerDate).then(setCategories).catch((e) => setError(e.message))
    api.payees.list(pickerDate).then(setPayees).catch((e) => setError(e.message))
    api.transactions.list().then(setTransactions).catch((e) => setError(e.message))
    api.goals.list(pickerDate).then(setGoals).catch((e) => setError(e.message))
  }

  async function addPayee(name) {
    const payee = await api.payees.create({ name, created_on: date })
    setPayees((current) => [...(current ?? []), payee].sort((a, b) => a.name.localeCompare(b.name)))
    return payee
  }

  useEffect(refresh, [pickerDate])

  // "Record" on a bill's row on Categories lands here with the bill, its due date and its expected
  // amount in route state (DESIGN.md § Paying a bill): the form opens pre-filled and already linked,
  // with the payee and account of the bill's last linked payment. The user still saves it.
  const recordBill = location.state?.recordBill
  useEffect(() => {
    if (!recordBill) return
    const cents = recordBill.amount_cents == null ? '' : String(-recordBill.amount_cents / 100)
    setDate(pickerDate)
    setCategoryLines([{ category_id: String(recordBill.category_id), cents }])
    setAccountLines([{ account_id: '', cents }])
    setBillLink({ goal_id: recordBill.goal_id, goal_due_on: recordBill.goal_due_on })
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
    Promise.all([api.goals.lastPayment(recordBill.goal_id), api.accounts.list()])
      .then(([last, accountList]) => {
        if (last.payee_id != null) setPayeeId(last.payee_id)
        if (last.account_id != null && accountList.some((a) => a.id === last.account_id)) {
          setAccountLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, account_id: String(last.account_id) } : l)))
        }
      })
      .catch((e) => setFormError(e.message))
  }, [recordBill])

  function updateAccountLine(i, field, value) {
    setAccountLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }
  function updateCategoryLine(i, field, value) {
    setCategoryLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  function updateDeposit(i, field, value) {
    setDeposits((rows) => rows.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  }

  function resetForm() {
    setEditingId(null)
    setDate(pickerDate)
    setMemo('')
    setPayeeId(null)
    setAccountLines([{ ...emptyLine }])
    setCategoryLines([])
    setDeposits([])
    setBillLink(null)
    setDeclinedBills([])
    setFormError(null)
  }

  function editTransaction(t) {
    setPredatesCheckNotes([])
    setEditingId(t.id)
    setDate(t.date)
    setMemo(t.memo || '')
    setPayeeId(t.payee_id)
    setAccountLines(
      t.account_lines.map((l) => ({ account_id: String(l.account_id), cents: String(l.cents / 100) }))
    )
    setCategoryLines(
      t.category_lines.map((l) => ({ category_id: String(l.category_id), cents: String(l.cents / 100) }))
    )
    setDeposits(
      (t.deposits ?? []).map((d) => ({
        category_id: String(d.category_id),
        cents: String(d.cents / 100),
        other_category_id: d.other_category_id ? String(d.other_category_id) : '',
      }))
    )
    setBillLink(t.goal_id != null ? { goal_id: t.goal_id, goal_due_on: t.goal_due_on } : null)
    setDeclinedBills([])
    setFormError(null)
  }

  async function deleteTransaction() {
    if (!editingId) return
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return
    try {
      await api.transactions.remove(editingId)
      resetForm()
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  async function addCategory(e) {
    e.preventDefault()
    if (!newCategoryName.trim()) return
    try {
      await api.categories.create({ name: newCategoryName.trim(), created_on: date })
      setNewCategoryName('')
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  // DESIGN.md § Linked categories: money moved into (or out of) an account with linked
  // categories asks which of those envelopes it funds (or leaves).
  const linkedCategoryIds = new Set()
  let linkedNet = 0
  for (const line of accountLines) {
    const account = accounts?.find((a) => String(a.id) === line.account_id)
    const cents = parseCents(line.cents)
    if (!account || account.linked_category_ids.length === 0 || cents === null) continue
    linkedNet += cents
    account.linked_category_ids.forEach((id) => linkedCategoryIds.add(id))
  }
  // DESIGN.md § Goals → Paying a bill: a category line on a category with a live recurring bill
  // offers "this pays Rent, due Oct 1"; the user confirms, picks another due date, or leaves it.
  const billsByCategory = new Map(
    (goals ?? []).filter((g) => g.goal.kind === 'recurring_bill').map((g) => [g.goal.category_id, g])
  )
  const linkedBill = billLink ? goals?.find((g) => g.goal.id === billLink.goal_id) : null
  const lineBill = categoryLines
    .map((l) => billsByCategory.get(Number(l.category_id)))
    .find((b) => b && !declinedBills.includes(b.goal.id))
  const offeredBill = billLink ? linkedBill : lineBill
  const offeredGoalId = billLink ? billLink.goal_id : lineBill?.goal.id

  useEffect(() => {
    setBillDueDates(null)
    if (offeredGoalId == null) return
    api.goals.dueDates(offeredGoalId).then((dates) => setBillDueDates({ goalId: offeredGoalId, dates })).catch(() => {})
  }, [offeredGoalId])

  const dueOptions = billDueDates && billDueDates.goalId === offeredGoalId ? billDueDates.dates : []
  const dueOptionValues = dueOptions.map((d) => d.due_on)
  const offeredDue = billLink?.goal_due_on ?? dueOptions.find((d) => d.earliest_unpaid)?.due_on ?? ''
  const envelopes = (categories ?? []).filter((c) => linkedCategoryIds.has(c.id))
  const depositTotal = deposits.reduce((sum, d) => sum + (parseCents(d.cents) ?? 0), 0)

  async function submit(e) {
    e.preventDefault()
    setFormError(null)

    if (!date) return setFormError('Date is required.')

    const parsedAccountLines = []
    for (const line of accountLines) {
      if (!line.account_id) continue
      const cents = parseCents(line.cents)
      if (cents === null) return setFormError('Every account line needs an amount.')
      parsedAccountLines.push({ account_id: Number(line.account_id), cents })
    }
    if (parsedAccountLines.length === 0) return setFormError('At least one account line is required.')

    const parsedCategoryLines = []
    for (const line of categoryLines) {
      if (!line.category_id) continue
      const cents = parseCents(line.cents)
      if (cents === null) return setFormError('Every category line needs an amount.')
      parsedCategoryLines.push({ category_id: Number(line.category_id), cents })
    }

    const parsedDeposits = []
    if (linkedNet !== 0) {
      for (const row of deposits) {
        if (!row.category_id) continue
        const cents = parseCents(row.cents)
        if (cents === null || cents <= 0) return setFormError('Every envelope needs an amount.')
        parsedDeposits.push({
          category_id: Number(row.category_id),
          cents,
          other_category_id: row.other_category_id ? Number(row.other_category_id) : null,
        })
      }
    }

    const body = {
      date,
      memo: memo.trim() || null,
      payee_id: payeeId,
      goal_id: billLink?.goal_id ?? null,
      goal_due_on: billLink?.goal_due_on ?? null,
      account_lines: parsedAccountLines,
      category_lines: parsedCategoryLines,
      deposits: parsedDeposits,
    }

    try {
      const saved = editingId
        ? await api.transactions.update(editingId, body)
        : await api.transactions.create(body)
      setPredatesCheckNotes(saved.notes || [])
      resetForm()
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  return (
    <div className="py-6 space-y-6">
      <h2 className="text-xl font-semibold">Transactions</h2>

      <section className="rounded-lg bg-ink-soft p-4 space-y-2">
        {error && <p className="text-bad">Could not reach the backend: {error}</p>}
        {!error && !transactions && <p>Loading…</p>}
        {transactions && transactions.length === 0 && <p className="text-paper-soft">No transactions yet.</p>}
        {transactions && transactions.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-paper-soft">
                <th className="pb-1">Date</th>
                <th className="pb-1">Memo</th>
                <th className="pb-1">Payee</th>
                <th className="pb-1">Account lines</th>
                <th className="pb-1">Category lines</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer hover:bg-ink"
                  onClick={() => editTransaction(t)}
                >
                  <td className="py-1 align-top">
                    {formatDate(t.date)}
                    {t.income_stream_id != null && (
                      <div>
                        <Link
                          className="text-xs text-accent"
                          to={`/pay/${t.income_stream_id}/record?date=${t.date}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Re-open pay
                        </Link>
                      </div>
                    )}
                  </td>
                  <td className="py-1 align-top">{t.memo || '—'}</td>
                  <td className="py-1 align-top">
                    {payees?.find((p) => p.id === t.payee_id)?.name ?? (t.payee_id ? `#${t.payee_id}` : '—')}
                  </td>
                  <td className="py-1 align-top">
                    {t.account_lines.map((l) => (
                      <div key={l.id}>
                        {accounts?.find((a) => a.id === l.account_id)?.name ?? `#${l.account_id}`}:{' '}
                        {formatCents(l.cents)}
                      </div>
                    ))}
                  </td>
                  <td className="py-1 align-top">
                    {t.category_lines.length === 0 && <span className="text-paper-soft">unassigned</span>}
                    {t.category_lines.map((l) => (
                      <div key={l.id}>
                        {categories?.find((c) => c.id === l.category_id)?.name ?? `#${l.category_id}`}:{' '}
                        {formatCents(l.cents)}
                      </div>
                    ))}
                    {t.goal_id != null && (
                      <div className="text-xs text-paper-soft">
                        pays {goals?.find((g) => g.goal.id === t.goal_id)?.goal.name ?? `bill #${t.goal_id}`}, due{' '}
                        {formatDate(t.goal_due_on)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg bg-ink-soft p-4 space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-paper-soft">
          {editingId ? `Edit transaction #${editingId}` : 'Record a transaction'}
        </h2>
        {predatesCheckNotes.length > 0 && (
          <div className="rounded bg-ink p-2 text-sm text-paper-soft space-y-1">
            {predatesCheckNotes.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
          </div>
        )}
        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="text-sm">Date</span>
            <input
              type="date"
              className="w-full rounded bg-ink px-2 py-1"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Memo</span>
            <input
              className="w-full rounded bg-ink px-2 py-1"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Payee (who it went to or came from — optional)</span>
            <PayeePicker
              payees={payees}
              payeeId={payeeId}
              onSelect={setPayeeId}
              onAdd={addPayee}
              onError={setFormError}
            />
          </label>

          <div className="space-y-2">
            <span className="text-sm">Account lines (which accounts this touched)</span>
            {accountLines.map((line, i) => (
              <div key={i} className="flex gap-2">
                <select
                  className="flex-1 rounded bg-ink px-2 py-1"
                  value={line.account_id}
                  onChange={(e) => updateAccountLine(i, 'account_id', e.target.value)}
                >
                  <option value="">Select account…</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-28 rounded bg-ink px-2 py-1"
                  value={line.cents}
                  onChange={(e) => updateAccountLine(i, 'cents', e.target.value)}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-sm text-accent"
              onClick={() => setAccountLines((lines) => [...lines, { ...emptyLine }])}
            >
              + add account line
            </button>
          </div>

          <div className="space-y-2">
            <span className="text-sm">Category lines (what it was for — leave empty for unassigned)</span>
            {categoryLines.map((line, i) => (
              <div key={i} className="flex gap-2">
                <select
                  className="flex-1 rounded bg-ink px-2 py-1"
                  value={line.category_id}
                  onChange={(e) => updateCategoryLine(i, 'category_id', e.target.value)}
                >
                  <option value="">Select category…</option>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-28 rounded bg-ink px-2 py-1"
                  value={line.cents}
                  onChange={(e) => updateCategoryLine(i, 'cents', e.target.value)}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-sm text-accent"
              onClick={() => setCategoryLines((lines) => [...lines, { ...emptyCategoryLine }])}
            >
              + add category line
            </button>
          </div>

          {(offeredBill || billLink) && (
            <div className="rounded bg-ink p-2 space-y-2 text-sm">
              <p>
                {billLink ? 'Marked as paying ' : 'This pays '}
                <strong>{offeredBill?.goal.name ?? `bill #${billLink.goal_id}`}</strong>, due{' '}
                {offeredDue ? formatDate(offeredDue) : '…'}.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {!billLink && (
                  <button
                    type="button"
                    className="rounded bg-ink-soft px-2 py-1 text-accent"
                    disabled={!offeredDue}
                    onClick={() => setBillLink({ goal_id: offeredGoalId, goal_due_on: offeredDue })}
                  >
                    Confirm
                  </button>
                )}
                <select
                  className="rounded bg-ink-soft px-2 py-1"
                  aria-label="Which due date"
                  value={offeredDue}
                  onChange={(e) => setBillLink({ goal_id: offeredGoalId, goal_due_on: e.target.value })}
                >
                  {offeredDue && !dueOptionValues.includes(offeredDue) && (
                    <option value={offeredDue}>{formatDate(offeredDue)}</option>
                  )}
                  {dueOptions.map((d) => (
                    <option key={d.due_on} value={d.due_on}>
                      {formatDate(d.due_on)}
                      {d.paid ? ' · already paid' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-accent"
                  onClick={() => {
                    if (billLink) setBillLink(null)
                    setDeclinedBills((ids) => [...ids, offeredGoalId])
                  }}
                >
                  {billLink ? 'Remove link' : 'Leave unlinked'}
                </button>
              </div>
            </div>
          )}

          {linkedNet !== 0 && (
            <div className="space-y-2">
              <span className="text-sm">
                {linkedNet > 0 ? 'Which envelope does this fund?' : 'Which envelope does this money leave?'}{' '}
                <span className="text-paper-soft">Leave empty if it is already earmarked.</span>
              </span>
              {deposits.map((row, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <select
                    className="flex-1 min-w-32 rounded bg-ink px-2 py-1"
                    aria-label="Envelope"
                    value={row.category_id}
                    onChange={(e) => updateDeposit(i, 'category_id', e.target.value)}
                  >
                    <option value="">Select envelope…</option>
                    {envelopes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label="Amount"
                    className="w-28 rounded bg-ink px-2 py-1"
                    value={row.cents}
                    onChange={(e) => updateDeposit(i, 'cents', e.target.value)}
                  />
                  <select
                    className="flex-1 min-w-32 rounded bg-ink px-2 py-1"
                    aria-label={linkedNet > 0 ? 'Taken from' : 'Goes to'}
                    value={row.other_category_id}
                    onChange={(e) => updateDeposit(i, 'other_category_id', e.target.value)}
                  >
                    <option value="">{linkedNet > 0 ? 'From ready to assign' : 'To ready to assign'}</option>
                    {categories?.filter((c) => String(c.id) !== row.category_id).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-sm text-accent"
                    onClick={() => setDeposits((rows) => rows.filter((_, idx) => idx !== i))}
                  >
                    remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-sm text-accent"
                onClick={() => setDeposits((rows) => [...rows, { ...emptyDeposit }])}
              >
                + add envelope
              </button>
              {deposits.length > 0 && (
                <p className="text-sm text-paper-soft">
                  {formatCents(depositTotal)} of {formatCents(Math.abs(linkedNet))} directed.
                </p>
              )}
            </div>
          )}

          {formError && <p className="text-bad text-sm">{formError}</p>}

          <div className="flex gap-2">
            <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm font-medium">
              {editingId ? 'Save changes' : 'Record transaction'}
            </button>
            {editingId && (
              <>
                <button
                  type="button"
                  className="rounded bg-ink px-3 py-1.5 text-sm"
                  onClick={() => {
                    resetForm()
                    setPredatesCheckNotes([])
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded bg-bad px-3 py-1.5 text-sm font-medium"
                  onClick={deleteTransaction}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </form>

        <form className="flex gap-2 pt-2" onSubmit={addCategory}>
          <input
            className="flex-1 rounded bg-ink px-2 py-1 text-sm"
            placeholder="New category name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          <button type="submit" className="rounded bg-ink px-3 py-1.5 text-sm">
            Add category
          </button>
        </form>
      </section>
    </div>
  )
}
