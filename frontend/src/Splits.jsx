import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api.js'
import LedgerTable, { useLedgerNames } from './LedgerTable.jsx'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { RefusalNote, SaveNote, WarningNote } from './components/Notes.jsx'
import SidePanel, { PanelLayout } from './components/SidePanel.jsx'
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
  const [warnings, setWarnings] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false) // the add/edit side panel
  const [focusKey, setFocusKey] = useState(0) // returns focus to the panel's first field
  const [saved, setSaved] = useState(null) // the save note after an add
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
    // A zero balance reads "Nothing owed" until a line has touched the account, "Settled up" after.
    Promise.all(ids.map((id) => api.splits.balance(id, pickerDate)))
      .then((all) => setBalances(Object.fromEntries(all.map((b) => [b.account_id, b]))))
      .catch((e) => setError(e.message))
  }, [splits, pickerDate])

  // Settle up is a plain transfer for the full balance, opened on the Ledger form (DESIGN.md § Splits):
  // their account takes the opposite of what they owe, mine is left for the user to pick.
  function settleUp(member, balance) {
    navigate('/transactions', { state: { settleUp: { account_id: member.account_id, cents: -balance.balance_cents } } })
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

  function startAdd() {
    reset()
    setPanelOpen(true)
    setSaved(null)
    setError(null)
    setWarnings([])
    setFocusKey((k) => k + 1)
  }

  function closePanel() {
    reset()
    setPanelOpen(false)
    setSaved(null)
  }

  function startEdit(split) {
    setPanelOpen(true)
    setSaved(null)
    setFocusKey((k) => k + 1)
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
    setWarnings([])
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
    setWarnings([])
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
        const result = await api.splits.update(editing.id, { name: name.trim(), description: description.trim() || null, as_of: pickerDate, members: body })
        setWarnings(result.warnings ?? [])
        closePanel()
      } else {
        await api.splits.create({ name: name.trim(), description: description.trim() || null, created_on: pickerDate, members: body })
        const added = name.trim()
        reset()
        setSaved(`Added ${added}.`)
      }
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
      setFocusKey((k) => k + 1)
    }
  }

  async function toggleArchive(split) {
    setError(null)
    setWarnings([])
    try {
      if (split.archived_on) await api.splits.unarchive(split.id)
      else setWarnings((await api.splits.archive(split.id, pickerDate)).warnings)
      if (editing?.id === split.id) closePanel()
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const accountItems = accounts.map((a) => ({ id: a.id, name: a.name }))

  const formPanel = panelOpen && (
    <SidePanel title={editing ? `Edit · ${editing.name}` : 'Add a split'} onClose={closePanel} focusKey={focusKey}>
        <form key={formKey} onSubmit={submit} className="space-y-4">
          {saved && <SaveNote>{saved}</SaveNote>}
          {error && <RefusalNote>{error}</RefusalNote>}
          <label className="block space-y-1">
            <span className="field-label">Split name</span>
            <input className="w-full field" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="field-label">Description (optional)</span>
            <input className="w-full field" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.key} className="rounded-lg bg-raised p-3 space-y-2">
                <div className="space-y-1">
                  <span className="field-label">Person</span>
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
                  <label className="block space-y-1">
                    <span className="field-label">Percent</span>
                    <input
                      className="w-28 field"
                      inputMode="decimal"
                      value={m.percent}
                      onChange={(e) => changeMember(m.key, { percent: e.target.value })}
                    />
                  </label>
                  <Button variant="quiet" onClick={() => setMembers((all) => all.filter((x) => x.key !== m.key))}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="quiet" onClick={() => setMembers((all) => [...all, newMember()])}>
              + Add a person
            </Button>
          </div>

          {over ? (
            <RefusalNote aria-live="polite">{`The members add up to ${formatPercent(total)}, more than 100%. This won't save.`}</RefusalNote>
          ) : (
            <p className="text-text-2" aria-live="polite">{`Your share: ${formatPercent(HUNDRED - total)}`}</p>
          )}
          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>{editing ? 'Save' : 'Add split'}</Button>
            <Button variant="secondary" onClick={closePanel}>{editing ? 'Cancel' : 'Done'}</Button>
          </div>
        </form>
    </SidePanel>
  )

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title hidden md:block">Split expenses</h2>
        <Button className="ml-auto" onClick={startAdd}>Add a split</Button>
      </div>

      <PanelLayout panel={formPanel}>
        <section className="card space-y-3">
          <p className="max-w-prose text-text-2">
            A split shares costs with other people — a roommate, a partner. List the others and their percentages;
            you are never a member, your share is whatever they leave.
          </p>
          {!panelOpen && error && <WarningNote>{error}</WarningNote>}
          {warnings.map((w) => (
            <WarningNote key={w}>{w}</WarningNote>
          ))}
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {!splits && !error && <LoadingRows />}
          {splits && splits.length === 0 && (
            <EmptyState action={<Button variant="secondary" onClick={startAdd}>Add a split</Button>}>
              No splits yet.
            </EmptyState>
          )}
          {splits && splits.length > 0 && (
            <ul className="space-y-3">
              {splits.map((s) => (
                <li key={s.id} className={`rounded-lg px-2 py-1 ${editing?.id === s.id ? 'bg-raised' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">
                      {s.name}
                      {s.description && <span className="font-normal text-text-2"> — {s.description}</span>}
                      {s.archived_on && <span className="block text-sm font-normal text-text-3">archived {formatDate(s.archived_on)}</span>}
                    </span>
                    <span className="whitespace-nowrap">
                      {!s.archived_on && <Button variant="quiet" onClick={() => startEdit(s)}>Edit</Button>}
                      <Button variant="quiet" onClick={() => toggleArchive(s)}>
                        {s.archived_on ? 'Unarchive' : 'Archive'}
                      </Button>
                    </span>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-text-2">
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
      </PanelLayout>
    </div>
  )
}

// What a member owes, a Settle up button, and the transactions since the balance last stood at zero.
function MemberBalance({ member, balance, names, onSettle }) {
  const cents = balance.balance_cents
  const text =
    cents > 0 ? `${member.payee_name} owes you ${formatCents(cents)}`
    : cents < 0 ? `You owe ${member.payee_name} ${formatCents(-cents)}`
    : balance.touched ? 'Settled up' : 'Nothing owed'
  return (
    <div className="mt-1 space-y-2 text-text">
      <div className="flex items-center gap-3">
        <span>{text}</span>
        {cents !== 0 && (
          <Button variant="quiet" onClick={onSettle}>Settle up</Button>
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
