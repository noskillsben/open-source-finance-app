import { useEffect, useState } from 'react'
import { api } from './api.js'
import { CADENCES } from './cadences.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { RefusalNote, WarningNote } from './components/Notes.jsx'
import Picker from './components/Picker.jsx'
import RecordBillLink from './components/RecordBillLink.jsx'
import SidePanel, { PanelLayout } from './components/SidePanel.jsx'
import { EMPTY_GOAL, GoalFields, goalBody, goalToForm } from './GoalFields.jsx'
import { goalSaved } from './goalProgress.js'
import NamePicker from './NamePicker.jsx'
import SortHeader from './components/SortHeader.jsx'
import { comparator, useSort } from './utils/useSort.js'

// The Due dates page (DESIGN.md § Goals → The Due dates page): a view of goals, never a second store.
// It lists the recurring bills and the fixed Commitments with a due month, soonest next due first.

const isBill = (p) => p.goal.kind === 'recurring_bill'

// Targets, and each-payday, refill and percent-of-net Commitments, have no date to sort by and stay on
// Categories only. A fixed Commitment qualifies when the server gave it a next due date.
export const qualifies = (p) => isBill(p) || (p.goal.kind === 'commitment' && p.commitment_next_due_on != null)

const nextDueOn = (p) => (isBill(p) ? p.earliest_unpaid_due_on : p.commitment_next_due_on) ?? null

// Default: next due date, soonest first, so overdue leads. Status is the column that carries it.
const DEFAULT_SORT = { key: 'status', dir: 'asc' }
const dueValue = (p, key) =>
  key === 'name' ? p.goal.name : key === 'amount' ? p.goal.amount_cents : key === 'saved' ? p.balance_cents : nextDueOn(p)

/** Rows in the chosen order; ties fall back to name A to Z. */
export function sortDueDates(rows, sort = DEFAULT_SORT) {
  return [...rows].sort(comparator(sort, dueValue, (p) => p.goal.name))
}

// A Commitment's "$200.00 monthly · next due Oct 31" is worded once on the server; the amount and
// how often are the part before the dot, the status the part after it.
function split(text) {
  const [amount, ...rest] = (text ?? '').split(' · ')
  return { amount, status: rest.join(' · ') }
}

const KIND_FILTERS = [
  { value: '', label: 'Bills and set-asides' },
  { value: 'bill', label: 'Bills' },
  { value: 'set_aside', label: 'Set-asides' },
]

function GoalPanel({ panel, categories, goals, streams, pickerDate, onClose, onSaved, onCategoryCreated }) {
  const editing = panel.progress ?? null
  const bill = panel.flavour === 'bill'
  const [goal, setGoal] = useState(() => {
    if (editing) return goalToForm(editing.goal)
    return { ...EMPTY_GOAL, kind: bill ? 'recurring_bill' : 'commitment', cadence: 'monthly' }
  })
  const [pick, setPick] = useState({ id: null, text: '' })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const categoryId = editing ? editing.goal.category_id : pick.id
  const needle = pick.text.trim().toLowerCase()
  const shown = [...categories]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((c) => c.name.toLowerCase().includes(needle))

  async function createCategory() {
    try {
      const created = await api.categories.create({
        name: pick.text.trim(), parent_id: null, pool_id: null, domain_id: null, need_level: null,
        absorb_overspending: false, created_on: pickerDate,
      })
      onCategoryCreated(created)
      setPick({ id: created.id, text: created.name })
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (categoryId == null) return setError('Pick the category this is for, or add a new one.')
    if (!editing && goals.some((p) => p.goal.category_id === categoryId)) {
      return setError('That category already has a goal. Open it from this list or from Categories.')
    }
    if (goal.kind === 'recurring_bill' && !goal.date) return setError('A recurring bill needs a first due date.')
    if (!editing && !bill && (!goal.cadence || !goal.firstDueMonth)) {
      return setError('A set-aside on this page needs how often it is due and the first month it is due.')
    }
    const name = goal.name.trim() || categories.find((c) => c.id === categoryId)?.name || ''
    const body = goalBody({ ...goal, name }, pickerDate)
    setSaving(true)
    try {
      if (goal.kind) await api.goals.set(categoryId, body)
      else await api.goals.archive(categoryId, pickerDate)
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const title = editing ? `Edit · ${editing.goal.name}` : bill ? 'Add a bill' : 'Add a set-aside'
  return (
    <SidePanel title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <RefusalNote>{error}</RefusalNote>}
        {editing ? (
          <p className="text-text-2">{categories.find((c) => c.id === editing.goal.category_id)?.name}</p>
        ) : (
          <div className="space-y-1">
            <label htmlFor="due-category" className="field-label block">Category</label>
            <Picker
              id="due-category"
              text={pick.text}
              placeholder="Pick or add a category"
              onText={(text) =>
                setPick({ id: categories.find((c) => c.name.toLowerCase() === text.trim().toLowerCase())?.id ?? null, text })
              }
              items={shown}
              onPick={(c) => setPick({ id: c.id, text: c.name })}
              onAdd={createCategory}
              addNoun="category"
            />
          </div>
        )}
        <GoalFields
          goal={goal}
          onChange={setGoal}
          streams={streams}
          kinds={['recurring_bill', 'commitment']}
          allowNone={!!editing}
        />
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>Save</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </SidePanel>
  )
}

export default function DueDates({ pickerDate }) {
  const [goals, setGoals] = useState(null)
  const [categories, setCategories] = useState([])
  const [streams, setStreams] = useState([])
  const [error, setError] = useState(null)
  const { sort, toggle: toggleSort } = useSort('due-dates.sort', DEFAULT_SORT)
  const [kind, setKind] = useState('')
  const [cadence, setCadence] = useState('')
  const [categoryId, setCategoryId] = useState(null)
  const [panel, setPanel] = useState(null) // { step: 'choose' } | { flavour } | { flavour, progress }

  function refresh() {
    api.goals.list(pickerDate).then(setGoals).catch((e) => setError(e.message))
    api.categories.list(pickerDate).then(setCategories).catch((e) => setError(e.message))
    api.incomeStreams.list(pickerDate).then(setStreams).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate])

  const categoryName = (id) => categories.find((c) => c.id === id)?.name ?? ''
  const all = goals ? goals.filter(qualifies) : []
  const rows = sortDueDates(
    all.filter(
      (p) =>
        (kind === '' || (kind === 'bill') === isBill(p)) &&
        (cadence === '' || p.goal.cadence === cadence) &&
        (categoryId == null || p.goal.category_id === categoryId),
    ),
    sort,
  )
  const filtered = kind !== '' || cadence !== '' || categoryId != null
  const closePanel = () => setPanel(null)

  const formPanel = panel && (
    panel.step === 'choose' ? (
      <SidePanel title="Add to Due dates" onClose={closePanel}>
        <p className="mb-3 text-text-2">What are you adding?</p>
        <div className="flex gap-3">
          <Button onClick={() => setPanel({ flavour: 'bill' })}>A bill</Button>
          <Button variant="secondary" onClick={() => setPanel({ flavour: 'set_aside' })}>A set-aside</Button>
        </div>
      </SidePanel>
    ) : (
      <GoalPanel
        key={panel.progress ? `edit-${panel.progress.goal.id}` : panel.flavour}
        panel={panel}
        categories={categories}
        goals={goals ?? []}
        streams={streams}
        pickerDate={pickerDate}
        onClose={closePanel}
        onSaved={() => {
          closePanel()
          refresh()
        }}
        onCategoryCreated={(c) => setCategories((list) => [...list, c])}
      />
    )
  )

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title hidden md:block">Due dates</h2>
        <Button className="ml-auto" onClick={() => setPanel({ step: 'choose' })}>Add</Button>
      </div>

      <PanelLayout panel={formPanel}>
        <section className="card space-y-3">
          {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <label className="block space-y-1">
              <span className="field-label">Show</span>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KIND_FILTERS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="field-label">How often</span>
              <select className="field" value={cadence} onChange={(e) => setCadence(e.target.value)}>
                <option value="">Any</option>
                {CADENCES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <div className="w-56">
              <NamePicker
                label="Category"
                placeholder="Any"
                items={categories}
                onChange={(id) => setCategoryId(id)}
              />
            </div>
          </div>
          {!error && !goals && <LoadingRows />}
          {goals && rows.length === 0 && (
            <EmptyState action={!filtered && <Button variant="secondary" onClick={() => setPanel({ step: 'choose' })}>Add</Button>}>
              {filtered
                ? 'Nothing matches these filters.'
                : 'No bills or set-asides with a due date yet. Add a bill, or a set-aside with a due month.'}
            </EmptyState>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Saved" sortKey="saved" sort={sort} onSort={toggleSort} className="text-right" />
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const bill = isBill(p)
                    const { amount, status: commitmentStatus } = split(p.commitment_cadence_text)
                    const saved = goalSaved(p)
                    const selected = panel?.progress?.goal.id === p.goal.id
                    const open = () => setPanel({ flavour: bill ? 'bill' : 'set_aside', progress: p })
                    return (
                      <tr
                        key={p.goal.id}
                        className={`cursor-pointer ${selected ? 'bg-raised' : ''}`}
                        tabIndex={0}
                        onClick={open}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && e.key === 'Enter') open()
                        }}
                      >
                        <td className="py-1">
                          {p.goal.name}
                          <div className="text-sm text-text-3">{categoryName(p.goal.category_id)}</div>
                        </td>
                        <td className="py-1">{bill ? p.per_period_text : amount}</td>
                        <td className={`py-1 ${p.bill_status === 'overdue' ? 'text-warning' : ''}`}>
                          {bill ? p.bill_status_text : commitmentStatus}
                        </td>
                        <td className="tabular py-1 text-right">
                          {saved.short ? <span className="text-negative">{saved.short} short</span> : saved.text}
                        </td>
                        <td className="py-1 text-right whitespace-nowrap">{bill && <RecordBillLink progress={p} />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PanelLayout>
    </div>
  )
}
