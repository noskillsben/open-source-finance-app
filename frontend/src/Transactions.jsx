import { useEffect, useState } from 'react'
import { api } from './api.js'
import { formatCents, formatDate, parseCents, todayIso } from './utils/format.js'
import PayeePicker from './PayeePicker.jsx'

const emptyLine = { account_id: '', cents: '' }
const emptyCategoryLine = { category_id: '', cents: '' }

export default function Transactions() {
  const [accounts, setAccounts] = useState(null)
  const [categories, setCategories] = useState(null)
  const [payees, setPayees] = useState(null)
  const [transactions, setTransactions] = useState(null)
  const [error, setError] = useState(null)

  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [payeeId, setPayeeId] = useState(null)
  const [accountLines, setAccountLines] = useState([{ ...emptyLine }])
  const [categoryLines, setCategoryLines] = useState([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [formError, setFormError] = useState(null)
  const [editingId, setEditingId] = useState(null)

  function refresh() {
    api.accounts.list().then(setAccounts).catch((e) => setError(e.message))
    api.categories.list().then(setCategories).catch((e) => setError(e.message))
    api.payees.list().then(setPayees).catch((e) => setError(e.message))
    api.transactions.list().then(setTransactions).catch((e) => setError(e.message))
  }

  async function addPayee(name) {
    const payee = await api.payees.create({ name, created_on: date || todayIso() })
    setPayees((current) => [...(current ?? []), payee].sort((a, b) => a.name.localeCompare(b.name)))
    return payee
  }

  useEffect(refresh, [])

  function updateAccountLine(i, field, value) {
    setAccountLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }
  function updateCategoryLine(i, field, value) {
    setCategoryLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  function resetForm() {
    setEditingId(null)
    setDate('')
    setMemo('')
    setPayeeId(null)
    setAccountLines([{ ...emptyLine }])
    setCategoryLines([])
    setFormError(null)
  }

  function editTransaction(t) {
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
      await api.categories.create({ name: newCategoryName.trim(), created_on: date || todayIso() })
      setNewCategoryName('')
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

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

    const body = {
      date,
      memo: memo.trim() || null,
      payee_id: payeeId,
      account_lines: parsedAccountLines,
      category_lines: parsedCategoryLines,
    }

    try {
      if (editingId) {
        await api.transactions.update(editingId, body)
      } else {
        await api.transactions.create(body)
      }
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
                  <td className="py-1 align-top">{formatDate(t.date)}</td>
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
                  onClick={resetForm}
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
