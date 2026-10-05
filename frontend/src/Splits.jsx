import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api.js'
import LedgerTable, { useLedgerNames } from './LedgerTable.jsx'
import NamePicker from './NamePicker.jsx'
import PayeePicker from './PayeePicker.jsx'
import { formatCents, formatDate, formatPercent, parsePercent } from './utils/format.js'

const HUNDRED = 1000000 // 100% in ten-thousandths

// A split is a rule for sharing costs: the other people in it and their percentages. You are never a
// member — your share is whatever they leave (DESIGN.md § Splits). Settings only: nothing is recorded here.
export default function Splits({ pickerDate }) {
  const [splits, setSplits] = useState(null)
  const [payees, setPayees] = useState([])
  const [accounts, setAccounts] = useState([])
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const nextKey = useRef(1)
  const navigate = useNavigate()
  const names = useLedgerNames(pickerDate)
  // Each member account's balance and what built it, by account id: a person in two splits shows
  // the same balance under each (DESIGN.md § Splits).
  const [balances, setBalances] = useState({})

  function refresh() {
    api.splits.list(pickerDate, showArchived).then(setSplits).catch((e) => setError(e.message))
    api.payees.list(pickerDate).then(setPayees).catch((e) => setError(e.message))
    api.accounts.list(pickerDate).then(setAccounts).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  useEffect(() => {
    if (!splits) return
    const ids = [...new Set(splits.filter((s) => !s.archived_on).flatMap((s) => s.members.map((m) => m.account_id)))]
    Promise.all(ids.map((id) => api.splits.balance(id, pickerDate)))
      .then((all) => setBalances(Object.fromEntries(all.map((b) => [b.account_id, b]))))
      .catch((e) => setError(e.message))
  }, [splits, pickerDate])

  // Settle up is a plain transfer for the full balance, opened on the Ledger form (DESIGN.md § Splits):
  // their account takes the opposite of what they owe, mine is left for the user to pick.
  function settleUp(member, balance) {
    navigate('/ledger', { state: { settleUp: { account_id: member.account_id, cents: -balance.balance_cents } } })
  }

  function newMember(member = {}) {
    return { key: nextKey.current++, payeeId: null, accountId: null, accountText: '', percent: '', ...member }
  }

  function reset() {
    setEditing(null)
    setName('')
    setDescription('')
    setMembers([])
    setFormKey((k) => k + 1)
  }

  function startEdit(split) {
    setEditing(split)
    setName(split.name)
    setDescription(split.description ?? '')
    setMembers(
      split.members.map((m) =>
        newMember({ payeeId: m.payee_id, accountId: m.account_id, accountText: m.account_name, percent: String(Number(m.percent)) }),
      ),
    )
    setFormKey((k) => k + 1)
    setError(null)
  }

  function changeMember(key, change) {
    setMembers((all) => all.map((m) => (m.key === key ? { ...m, ...change } : m)))
  }

  // The members' total as it will be stored, so the share shown is the share the backend compares.
  const total = members.reduce((sum, m) => sum + (parsePercent(m.percent) ?? 0), 0)
  const over = total > HUNDRED

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (!name.trim()) return setError('Name is required.')
    const body = []
    for (const m of members) {
      const who = payees.find((p) => p.id === m.payeeId)
      if (!who) return setError('Pick a person for every member, or remove the empty row.')
      if (parsePercent(m.percent) === null) return setError(`Give ${who.name} a percent.`)
      if (m.accountText.trim() && m.accountId === null) return setError(`No account named "${m.accountText.trim()}".`)
      body.push({ payee_id: m.payeeId, account_id: m.accountId, percent: m.percent.replace(/[%\s]/g, '') })
    }
    setSaving(true)
    try {
      if (editing) {
        await api.splits.update(editing.id, { name: name.trim(), description: description.trim() || null, as_of: pickerDate, members: body })
      } else {
        await api.splits.create({ name: name.trim(), description: description.trim() || null, created_on: pickerDate, members: body })
      }
      reset()
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(split) {
    setError(null)
    try {
      if (split.archived_on) await api.splits.unarchive(split.id)
      else await api.splits.archive(split.id, pickerDate)
      if (editing?.id === split.id) reset()
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const accountItems = accounts.map((a) => ({ id: a.id, name: a.name }))

  return (
    <div className="py-6 space-y-6">
      <h2 className="text-xl font-semibold">Splits</h2>

      <section className="rounded-lg bg-ink-soft p-4 space-y-3">
        <p className="text-sm text-paper-soft">
          A split shares costs with other people — a roommate, a partner. List the others and their percentages;
          you are never a member, your share is whatever they leave.
        </p>
        {error && <p className="text-bad">{error}</p>}
        <form key={formKey} onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="text-paper-soft">{editing ? `Edit ${editing.name}` : 'Split name'}</span>
            <input className="mt-1 w-full rounded bg-ink px-2 py-1" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-paper-soft">Description (optional)</span>
            <input className="mt-1 w-full rounded bg-ink px-2 py-1" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.key} className="rounded bg-ink p-2 space-y-2">
                <div className="text-sm">
                  <span className="text-paper-soft">Person</span>
                  <PayeePicker
                    payees={payees}
                    payeeId={m.payeeId}
                    onSelect={(id) => changeMember(m.key, { payeeId: id })}
                    onAdd={async (newName) => {
                      const payee = await api.payees.create({ name: newName, created_on: pickerDate })
                      setPayees((all) => [...all, payee])
                      return payee
                    }}
                    onError={setError}
                  />
                </div>
                <NamePicker
                  label="Their account (optional — one is made or reused for you)"
                  items={accountItems}
                  initialId={m.accountId}
                  onChange={(id, typed) => changeMember(m.key, { accountId: id, accountText: typed })}
                  placeholder="Their balance account"
                />
                <div className="flex items-end gap-3">
                  <label className="block text-sm">
                    <span className="text-paper-soft">Percent</span>
                    <input
                      className="mt-1 w-28 rounded bg-ink-soft px-2 py-1"
                      inputMode="decimal"
                      value={m.percent}
                      onChange={(e) => changeMember(m.key, { percent: e.target.value })}
                    />
                  </label>
                  <button type="button" className="text-xs text-accent" onClick={() => setMembers((all) => all.filter((x) => x.key !== m.key))}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="text-sm text-accent" onClick={() => setMembers((all) => [...all, newMember()])}>
              + Add a person
            </button>
          </div>

          <p className={`text-sm ${over ? 'text-bad' : ''}`} aria-live="polite">
            {over
              ? `The members add up to ${formatPercent(total)}, more than 100%. This won't save.`
              : `Your share: ${formatPercent(HUNDRED - total)}`}
          </p>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="rounded bg-accent px-3 py-1 text-ink disabled:opacity-50">
              {editing ? 'Save' : 'Add split'}
            </button>
            {editing && (
              <button type="button" className="text-sm text-accent" onClick={reset}>Cancel</button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-lg bg-ink-soft p-4 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {!splits && !error && <p>Loading…</p>}
        {splits && splits.length === 0 && <p className="text-paper-soft">No splits yet.</p>}
        {splits && splits.length > 0 && (
          <ul className="space-y-3">
            {splits.map((s) => (
              <li key={s.id} className="text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">
                    {s.name}
                    {s.description && <span className="font-normal text-paper-soft"> — {s.description}</span>}
                    {s.archived_on && <span className="block text-xs font-normal text-paper-soft">archived {formatDate(s.archived_on)}</span>}
                  </span>
                  <span className="space-x-3 whitespace-nowrap">
                    {!s.archived_on && (
                      <button type="button" className="text-xs text-accent" onClick={() => startEdit(s)}>Edit</button>
                    )}
                    <button type="button" className="text-xs text-accent" onClick={() => toggleArchive(s)}>
                      {s.archived_on ? 'Unarchive' : 'Archive'}
                    </button>
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 text-paper-soft">
                  {s.members.map((m) => (
                    <li key={m.id}>
                      {m.payee_name} — {formatPercent(parsePercent(m.percent))}
                      {!s.archived_on && balances[m.account_id] && (
                        <MemberBalance
                          member={m}
                          balance={balances[m.account_id]}
                          names={names}
                          onSettle={() => settleUp(m, balances[m.account_id])}
                        />
                      )}
                    </li>
                  ))}
                  <li>You — {formatPercent(parsePercent(s.my_share_percent))}</li>
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// What a member owes, a Settle up button, and the transactions since the balance last stood at zero.
function MemberBalance({ member, balance, names, onSettle }) {
  const cents = balance.balance_cents
  const text =
    cents > 0 ? `${member.payee_name} owes you ${formatCents(cents)}`
    : cents < 0 ? `You owe ${member.payee_name} ${formatCents(-cents)}`
    : 'Settled up'
  return (
    <div className="mt-1 space-y-2 text-paper">
      <div className="flex items-center gap-3">
        <span>{text}</span>
        {cents !== 0 && (
          <button type="button" className="text-xs text-accent" onClick={onSettle}>Settle up</button>
        )}
      </div>
      {balance.transactions.length > 0 && (
        <div className="overflow-x-auto">
          <LedgerTable transactions={balance.transactions} names={names} />
        </div>
      )}
    </div>
  )
}
