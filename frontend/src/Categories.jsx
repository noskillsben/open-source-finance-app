import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from './api.js'
import { CADENCES } from './cadences.js'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import { GoalRow as GoalRowShell } from './components/ListRow.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import MoneyInput from './components/MoneyInput.jsx'
import { RefusalNote, SaveNote, WarningNote } from './components/Notes.jsx'
import SidePanel, { PanelLayout } from './components/SidePanel.jsx'
import NamePicker from './NamePicker.jsx'
import { formatCents, formatDate, parseCents } from './utils/format.js'

// The fixed ordinal scale (DESIGN.md § Need levels) — shown in its real order, not alphabetically.
const NEED_LEVELS = [
  { value: 'need', label: 'Need' },
  { value: 'should', label: 'Should' },
  { value: 'nice_to_have', label: 'Nice to have' },
  { value: 'want', label: 'Want' },
]
const needLabel = (value) => NEED_LEVELS.find((n) => n.value === value)?.label

// Children follow their parent (alphabetical within each level). A child whose parent isn't in the
// list — archived and hidden, say — is shown at the top level rather than dropped.
function orderTree(categories) {
  const ids = new Set(categories.map((c) => c.id))
  const byParent = new Map()
  for (const c of categories) {
    const key = c.parent_id !== null && ids.has(c.parent_id) ? c.parent_id : null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(c)
  }
  const rows = []
  function walk(parentId, depth) {
    for (const c of byParent.get(parentId) ?? []) {
      rows.push({ category: c, depth })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

const COLLAPSED_KEY = 'categories.collapsed'

// Which groups are collapsed is a per-device convenience (DESIGN.md § Nested and grouped lists), so it
// lives in localStorage and the page works without it.
function loadCollapsed() {
  try {
    const ids = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

function saveCollapsed(ids) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids))
  } catch {
    // private window or blocked storage: the state just doesn't survive a reload
  }
}

// What the table shows: each category once, with its group total (its own money plus every
// descendant's), minus the descendants of a collapsed group. A parent holding money of its own gets a
// "<name> itself" line first among its children. A search shows only matches and their ancestors, with
// every group open, so a collapsed group never hides a hit.
function viewRows(categories, availableOf, collapsed, search) {
  const ordered = orderTree(categories)
  const ids = new Set(categories.map((c) => c.id))
  const childrenOf = new Map()
  for (const { category: c } of ordered) {
    const key = c.parent_id !== null && ids.has(c.parent_id) ? c.parent_id : null
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key).push(c)
  }
  const totals = new Map()
  const totalOf = (c) => {
    if (!totals.has(c.id)) {
      totals.set(c.id, (childrenOf.get(c.id) ?? []).reduce((sum, child) => sum + totalOf(child), availableOf(c.id)))
    }
    return totals.get(c.id)
  }
  const query = search.trim().toLowerCase()
  const keeps = new Map()
  const keep = (c) => {
    if (!keeps.has(c.id)) {
      const below = (childrenOf.get(c.id) ?? []).map(keep).some(Boolean)
      keeps.set(c.id, c.name.toLowerCase().includes(query) || below)
    }
    return keeps.get(c.id)
  }
  const out = []
  // A match shows its whole subtree, so the group total is the sum of what is on screen.
  function walk(parentId, depth, whole = false) {
    for (const c of childrenOf.get(parentId) ?? []) {
      const matches = query && c.name.toLowerCase().includes(query)
      if (query && !whole && !keep(c)) continue
      const showAll = whole || matches
      const kids = childrenOf.get(c.id) ?? []
      const expanded = !!query || !collapsed.includes(c.id)
      out.push({ category: c, depth, isParent: kids.length > 0, expanded, total: totalOf(c) })
      if (kids.length > 0 && expanded) {
        if ((!query || showAll) && availableOf(c.id) !== 0) out.push({ itself: c, depth: depth + 1, cents: availableOf(c.id) })
        walk(c.id, depth + 1, !!showAll)
      }
    }
  }
  walk(null, 0)
  return out
}

// Goal kinds and cadences (DESIGN.md § Goals). One goal per category; "No goal" archives it.
const GOAL_KINDS = [
  { value: 'recurring_bill', label: 'Recurring bill' },
  { value: 'target', label: 'Target' },
  { value: 'commitment', label: 'Commitment' },
]
// A fixed-amount Commitment's cadence, in this order; "Each payday" is the empty cadence, and there
// is no every-N-weeks (that stays on bills).
const COMMITMENT_CADENCES = [
  { value: '', label: 'Each payday' },
  ...CADENCES.filter((c) => c.value !== 'weeks'),
]
const EMPTY_GOAL = {
  kind: '', name: '', flavour: 'add', addFlavour: 'fixed', amount: '', level: '', percent: '',
  cadence: '', weeks: '', date: '', firstDueMonth: '', incomeStreamId: null,
}

// "2026-10" -> the month's last day, "2026-10-31". Day 0 of the next month, in UTC.
const monthEnd = (month) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const centsText = (cents) => (cents == null ? '' : (cents / 100).toFixed(2))

function goalToForm(goal) {
  if (!goal) return EMPTY_GOAL
  return {
    kind: goal.kind,
    name: goal.name,
    flavour: goal.level_cents != null ? 'refill' : 'add',
    addFlavour: goal.percent_of_net != null ? 'percent' : 'fixed',
    amount: centsText(goal.amount_cents),
    level: centsText(goal.level_cents),
    percent: goal.percent_of_net ?? '',
    cadence: goal.cadence ?? '',
    weeks: goal.cadence_weeks ?? '',
    date: (goal.kind === 'recurring_bill' ? goal.first_due_on : goal.target_date) ?? '',
    firstDueMonth: goal.first_due_on ? goal.first_due_on.slice(0, 7) : '',
    incomeStreamId: goal.income_stream_id ?? null,
  }
}

// The request body for a goal form: a field the kind doesn't use is sent as null, never zero.
function goalBody(g, pickerDate) {
  const cents = (text) => (String(text).trim() === '' ? null : parseCents(text))
  const refill = g.kind === 'commitment' && g.flavour === 'refill'
  const percentFlavour = g.kind === 'commitment' && g.flavour === 'add' && g.addFlavour === 'percent'
  // Only a fixed-amount Commitment has a cadence, and then it needs its first due month.
  const commitmentCadence = g.kind === 'commitment' && !refill && !percentFlavour && COMMITMENT_CADENCES.some((c) => c.value && c.value === g.cadence) ? g.cadence : null
  // A Target is paced by its named pay or its own cadence, never both (DESIGN.md § Goals).
  const targetBound = g.kind === 'target' && g.incomeStreamId != null
  const cadence = g.kind === 'commitment' ? commitmentCadence : targetBound ? null : g.cadence || null
  return {
    on: pickerDate,
    name: g.name.trim(),
    kind: g.kind,
    amount_cents: refill || percentFlavour ? null : cents(g.amount),
    level_cents: refill ? cents(g.level) : null,
    percent_of_net: percentFlavour && String(g.percent).trim() !== '' ? g.percent : null,
    cadence,
    cadence_weeks: cadence === 'weeks' && g.weeks !== '' ? Number(g.weeks) : null,
    first_due_on: g.kind === 'recurring_bill' ? g.date || null : commitmentCadence && g.firstDueMonth ? monthEnd(g.firstDueMonth) : null,
    target_date: g.kind === 'target' && g.date ? g.date : null,
    income_stream_id: g.incomeStreamId ?? null,
  }
}

// The goal section of the category's settings form. The kind decides which fields show; "No goal"
// removes (archives) the goal on save.
function GoalFields({ goal, onChange, streams }) {
  const set = (patch) => onChange({ ...goal, ...patch })
  const moneyInput = (label, key) => (
    <MoneyInput label={label} value={goal[key]} onChange={(text) => set({ [key]: text })} />
  )
  const percentInput = (label, key) => (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        className="w-full field"
        value={goal[key]}
        onChange={(e) => set({ [key]: e.target.value.replace(/[^0-9.]/g, '') })}
      />
    </label>
  )
  // Picking a pay on a Target clears its own cadence and hides the control (one pace, never two);
  // clearing the pay brings the control back, so a cadence can only be picked while unbound.
  const payPicker = (
    <NamePicker
      label="Named pay this is paid by (optional)"
      items={streams}
      initialId={goal.incomeStreamId}
      onChange={(id) => set(id != null && goal.kind === 'target' ? { incomeStreamId: id, cadence: '', weeks: '' } : { incomeStreamId: id })}
    />
  )
  const cadenceInput = (label, optional) => (
    <>
      <label className="block space-y-1">
        <span className="field-label">{label}</span>
        <select
          className="w-full field"
          value={goal.cadence}
          onChange={(e) => set({ cadence: e.target.value })}
        >
          <option value="">{optional ? 'Not set' : 'Choose…'}</option>
          {CADENCES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>
      {goal.cadence === 'weeks' && (
        <label className="block space-y-1">
          <span className="field-label">Number of weeks</span>
          <input
            type="text"
            inputMode="numeric"
            className="w-full field"
            value={goal.weeks}
            onChange={(e) => set({ weeks: e.target.value.replace(/[^0-9]/g, '') })}
          />
        </label>
      )}
    </>
  )
  const dateInput = (label) => (
    <label className="block space-y-1">
      <span className="field-label">{label}</span>
      <input
        type="date"
        className="w-full field"
        value={goal.date}
        onChange={(e) => set({ date: e.target.value })}
      />
    </label>
  )
  return (
    <fieldset className="rounded-lg bg-raised p-3 space-y-3">
      <legend className="px-1 text-sm font-medium">Goal</legend>
      <label className="block space-y-1">
        <span className="field-label">Kind</span>
        <select
          className="w-full field"
          value={goal.kind}
          onChange={(e) => set({ kind: e.target.value })}
        >
          <option value="">No goal</option>
          {GOAL_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </label>
      {goal.kind && (
        <label className="block space-y-1">
          <span className="field-label">Goal name</span>
          <input
            className="w-full field"
            value={goal.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
      )}
      {goal.kind && payPicker}
      {goal.kind === 'recurring_bill' && (
        <>
          {moneyInput('Amount per bill', 'amount')}
          {cadenceInput('How often', false)}
          {dateInput('First due date')}
        </>
      )}
      {goal.kind === 'target' && (
        <>
          {moneyInput('Amount to reach', 'amount')}
          {dateInput('Target date (optional)')}
          {goal.date && goal.incomeStreamId == null && cadenceInput('Set aside every (optional)', true)}
        </>
      )}
      {goal.kind === 'commitment' && (
        <>
          <label className="block space-y-1">
            <span className="field-label">Rule</span>
            <select
              className="w-full field"
              value={goal.flavour}
              onChange={(e) => set({ flavour: e.target.value })}
            >
              <option value="add">Add a fixed amount</option>
              <option value="refill">Refill to a level</option>
            </select>
          </label>
          {goal.flavour === 'refill' && moneyInput('Level to refill to', 'level')}
          {goal.flavour === 'add' && (
            <>
              <label className="block space-y-1">
                <span className="field-label">Add</span>
                <select
                  className="w-full field"
                  value={goal.addFlavour}
                  onChange={(e) => set({ addFlavour: e.target.value })}
                >
                  <option value="fixed">A fixed amount</option>
                  <option value="percent">A percentage of net (needs a named pay above)</option>
                </select>
              </label>
              {goal.addFlavour === 'percent'
                ? percentInput('% of net', 'percent')
                : moneyInput('Amount to add', 'amount')}
            </>
          )}
          {goal.flavour === 'add' && goal.addFlavour === 'fixed' && (
            <>
              <label className="block space-y-1">
                <span className="field-label">How often</span>
                <select
                  className="w-full field"
                  value={goal.cadence}
                  onChange={(e) => set({ cadence: e.target.value, firstDueMonth: e.target.value ? goal.firstDueMonth : '' })}
                >
                  {COMMITMENT_CADENCES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </label>
              {goal.cadence && (
                <label className="block space-y-1">
                  <span className="field-label">First month it is due</span>
                  <input
                    type="month"
                    className="w-full field"
                    value={goal.firstDueMonth}
                    onChange={(e) => set({ firstDueMonth: e.target.value })}
                  />
                </label>
              )}
            </>
          )}
        </>
      )}
    </fieldset>
  )
}

// A goal date within this many years of the picker date counts as "due within a few years" for
// the Investment note on the link form (DESIGN.md § Linked categories).
const SHORT_HORIZON_YEARS = 5

function shortHorizonDate(goal, pickerDate) {
  if (!goal.kind || !goal.date) return null
  const limit = `${Number(pickerDate.slice(0, 4)) + SHORT_HORIZON_YEARS}${pickerDate.slice(4)}`
  return goal.date <= limit ? goal.date : null
}

// The link section of the category's settings form: the on-budget accounts this category's
// money lives in (many-to-many). Searchable once there are more than five to choose from.
function LinkFields({ accounts, linkIds, onChange, filter, onFilter, shortHorizonGoalDate }) {
  const eligible = accounts.filter((a) => a.on_budget || linkIds.includes(a.id))
  const shown = eligible.filter((a) => a.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const toggle = (id) => onChange(linkIds.includes(id) ? linkIds.filter((x) => x !== id) : [...linkIds, id])
  const investment = eligible.some((a) => linkIds.includes(a.id) && a.type === 'Investment')
  return (
    <fieldset className="space-y-1 text-sm">
      <legend className="text-text-2">Money lives in (on-budget accounts)</legend>
      {eligible.length === 0 && <p className="text-text-2">No on-budget accounts yet.</p>}
      {eligible.length > 5 && (
        <input
          className="w-full field"
          placeholder="Search accounts"
          aria-label="Search accounts"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
      )}
      {shown.map((a) => (
        <label key={a.id} className="flex items-center gap-2">
          <input type="checkbox" checked={linkIds.includes(a.id)} onChange={() => toggle(a.id)} />
          {a.name}
        </label>
      ))}
      {investment && shortHorizonGoalDate && (
        <p className="text-text-2">
          This goal is due {formatDate(shortHorizonGoalDate)}, and money in an investment account may not
          be there when the date comes.
        </p>
      )}
    </fieldset>
  )
}

// The goal row under a category: name, "$X of $Y", due date, per-period amount. Its one control is
// Record on a recurring bill; moving money is the category row's Move money.
function GoalRow({ progress, depth, archived, streams, onSelect, selected }) {
  const { goal, balance_cents: balance, target_cents: target, due_date: due } = progress
  const { bill_status: billStatus, bill_status_text: billStatusText, last_paid_text: lastPaidText } = progress
  const { commitment_cadence_text: cadenceLine, commitment_progress_text: progressLine, per_period_text: perPeriodText } = progress
  const nextDue = progress.earliest_unpaid_due_on
  const nextDueText = progress.earliest_unpaid_due_text
  const streamName = streams.find((s) => s.id === goal.income_stream_id)?.name
  // A goal whose category is below zero reads "$525.00 short" in negative, never "-$525.00 of $1,050.00"
  // (DESIGN.md § Visual design → Wording). #220.
  const short = balance < 0 ? formatCents(-balance) : null
  const status = (
    <>
      {short ? (
        <span className="text-negative">{short} short</span>
      ) : (
        <span>{progressLine ?? (target == null ? formatCents(balance) : `${formatCents(balance)} of ${formatCents(target)}`)}</span>
      )}
      {billStatusText && <span className={billStatus === 'overdue' ? 'text-warning' : undefined}>{billStatusText}</span>}
      {lastPaidText && <span>{lastPaidText}</span>}
      {/* DESIGN.md § Nothing posts itself: opens the Ledger form pre-filled and linked; the user saves it. */}
      {!archived && goal.kind === 'recurring_bill' && nextDue && (
        <Link
          className="btn btn-quiet"
          to="/transactions"
          onClick={(e) => e.stopPropagation()}
          state={{
            recordBill: {
              goal_id: goal.id,
              goal_due_on: nextDue,
              category_id: goal.category_id,
              amount_cents: goal.amount_cents,
            },
          }}
        >
          Record {nextDueText}
        </Link>
      )}
      {due && goal.kind !== 'recurring_bill' && <span>by {formatDate(due)}</span>}
      {cadenceLine ? (
        <span>{cadenceLine}</span>
      ) : goal.percent_of_net != null ? (
        <span>{goal.percent_of_net}% of net{streamName ? ` · ${streamName} pay` : ''}</span>
      ) : (
        perPeriodText && <span>{perPeriodText}</span>
      )}
    </>
  )
  return <GoalRowShell depth={depth} colSpan={5} name={goal.name} status={status} onSelect={onSelect} selected={selected} />
}

const EMPTY_FORM = { name: '', needLevel: '', parent: {}, pool: {}, domain: {}, absorb: false }

// A picker's state is { id, text }: `text` is what was typed, so a name that matches nothing can be
// refused rather than silently saved as "none".
// DESIGN.md § Linked categories: money taken out of a linked category is money sitting in an
// account you can't spend from directly. A warning after the fact, never a refusal.
function linkedNote(category) {
  if (category.linked_accounts.length === 0) return null
  return `${category.name}'s money is in ${category.linked_accounts.map((a) => a.name).join(' and ')}.`
}

function unmatched(pick) {
  return pick.text && pick.id == null
}

export default function Categories({ pickerDate }) {
  const [categories, setCategories] = useState(null)
  const [domains, setDomains] = useState([])
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [rowError, setRowError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [editing, setEditing] = useState(null) // the category being edited, or null when adding
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formKey, setFormKey] = useState(0) // remounts the form so its pickers reseed their text
  const [panelOpen, setPanelOpen] = useState(false) // the add/edit side panel
  const [focusKey, setFocusKey] = useState(0) // returns focus to the panel's first field
  const [saved, setSaved] = useState(null) // the save note after an add
  const [summary, setSummary] = useState(null) // ready to assign, overspent and each category's available
  const [moveAmount, setMoveAmount] = useState('') // the panel's Move money amount
  const [moveTo, setMoveTo] = useState({}) // the panel's "Move to…" pick, { id, text }
  const [moveKey, setMoveKey] = useState(0) // remounts the "Move to…" picker after a move
  const [moveNote, setMoveNote] = useState(null)
  const [collapsed, setCollapsed] = useState(loadCollapsed) // ids of collapsed groups, per device
  const [search, setSearch] = useState('')
  const [assignError, setAssignError] = useState(null)
  const [goals, setGoals] = useState([]) // every goal shown at the picker date, with its progress
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL)
  const [streams, setStreams] = useState([]) // named pays, for the goal form's pay picker
  const [accounts, setAccounts] = useState([]) // for the link picker
  const [linkIds, setLinkIds] = useState([]) // account ids the category being edited is linked to
  const [linkFilter, setLinkFilter] = useState('')
  const [linkedWarning, setLinkedWarning] = useState(null) // shown after money leaves a linked category

  function refresh() {
    api.categories.list(pickerDate, showArchived).then(setCategories).catch((e) => setError(e.message))
    api.domains.list(pickerDate).then(setDomains).catch((e) => setError(e.message))
    api.readyToAssign(pickerDate).then(setSummary).catch((e) => setError(e.message))
    api.goals.list(pickerDate).then(setGoals).catch((e) => setError(e.message))
    api.accounts.list(pickerDate).then(setAccounts).catch((e) => setError(e.message))
    api.incomeStreams.list(pickerDate).then(setStreams).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function startAdd() {
    resetForm()
    setPanelOpen(true)
    setSaved(null)
    setFocusKey((k) => k + 1)
  }

  function startEdit(category) {
    setFormKey((k) => k + 1)
    setPanelOpen(true)
    setSaved(null)
    setFocusKey((k) => k + 1)
    setEditing(category)
    setForm({
      name: category.name,
      needLevel: category.need_level ?? '',
      parent: { id: category.parent_id },
      pool: { id: category.pool_id },
      domain: { id: category.domain_id },
      absorb: category.absorb_overspending,
    })
    setGoalForm(goalToForm(goals.find((g) => g.goal.category_id === category.id)?.goal))
    resetMove()
    setLinkIds(category.linked_accounts.map((a) => a.id))
    setLinkFilter('')
    setFormError(null)
  }

  function resetMove() {
    setMoveAmount('')
    setMoveTo({})
    setMoveKey((k) => k + 1)
    setMoveNote(null)
    setAssignError(null)
    setLinkedWarning(null)
  }

  function setCollapsedIds(ids) {
    setCollapsed(ids)
    saveCollapsed(ids)
  }

  function toggleGroup(id) {
    setCollapsedIds(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id])
  }

  function resetForm() {
    setFormKey((k) => k + 1)
    setEditing(null)
    setForm(EMPTY_FORM)
    setGoalForm(EMPTY_GOAL)
    setLinkIds([])
    setFormError(null)
  }

  function closePanel() {
    resetForm()
    setPanelOpen(false)
    setSaved(null)
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setFormError(null)
    const name = form.name.trim()
    if (!name) return setFormError('Name is required.')
    for (const [label, pick] of [['parent', form.parent], ['pool', form.pool], ['domain', form.domain]]) {
      if (unmatched(pick)) return setFormError(`"${pick.text}" is not an existing ${label}. Pick one from the list or clear the box.`)
    }
    if (goalForm.kind === 'recurring_bill' && !goalForm.date) {
      return setFormError('A recurring bill needs a first due date.')
    }
    const settings = {
      name,
      parent_id: form.parent.id ?? null,
      pool_id: form.pool.id ?? null,
      domain_id: form.domain.id ?? null,
      need_level: form.needLevel || null,
      absorb_overspending: form.absorb,
    }
    setSaving(true)
    try {
      if (editing) {
        await api.categories.update(editing.id, settings)
        const hadGoal = goals.some((g) => g.goal.category_id === editing.id)
        if (goalForm.kind) await api.goals.set(editing.id, goalBody(goalForm, pickerDate))
        else if (hadGoal) await api.goals.archive(editing.id, pickerDate)
        const before = editing.linked_accounts.map((a) => a.id).sort().join()
        if (before !== [...linkIds].sort().join()) await api.categories.setLinkedAccounts(editing.id, pickerDate, linkIds)
        closePanel()
      } else {
        await api.categories.create({ ...settings, created_on: pickerDate })
        resetForm()
        setSaved(`Added ${name}.`)
      }
      refresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
      setFocusKey((k) => k + 1)
    }
  }

  // One earmark move line, dated the "Show as of" date, between ready to assign and the category:
  // Add moves money into the category, Withdraw moves it back out.
  async function addOrWithdraw(category, direction) {
    setAssignError(null)
    setLinkedWarning(null)
    setMoveNote(null)
    const cents = parseCents(moveAmount)
    if (cents === null || cents <= 0) return setAssignError(`Enter an amount to move for ${category.name}.`)
    const side = direction === 'add' ? { to_category_id: category.id } : { from_category_id: category.id }
    try {
      await api.earmarkMoves.create({ date: pickerDate, cents, ...side })
      setLinkedWarning(direction === 'withdraw' ? linkedNote(category) : null)
      setMoveAmount('')
      setMoveNote(`${direction === 'add' ? 'Added' : 'Withdrew'} ${formatCents(cents)} ${direction === 'add' ? 'to' : 'from'} ${category.name}.`)
      refresh()
    } catch (err) {
      setAssignError(err.message)
    }
  }

  // Two earmark lines, out of `category` and into the picked category.
  async function moveToCategory(e, category) {
    e.preventDefault()
    setAssignError(null)
    setLinkedWarning(null)
    setMoveNote(null)
    const cents = parseCents(moveAmount)
    if (cents === null || cents <= 0) return setAssignError(`Enter an amount to move out of ${category.name}.`)
    if (unmatched(moveTo) || moveTo.id == null) return setAssignError('Pick the category to move the money to.')
    try {
      await api.earmarkMoves.create({
        date: pickerDate,
        cents,
        from_category_id: category.id,
        to_category_id: moveTo.id,
      })
      setLinkedWarning(linkedNote(category))
      setMoveAmount('')
      setMoveTo({})
      setMoveKey((k) => k + 1)
      setMoveNote(`Moved ${formatCents(cents)} out of ${category.name}.`)
      refresh()
    } catch (err) {
      setAssignError(err.message)
    }
  }

  // Archives on the "Show as of" date. Warnings never block: the archive has already happened when shown.
  async function archiveCategory(category) {
    setRowError(null)
    setWarnings([])
    try {
      const result = await api.categories.archive(category.id, pickerDate)
      setWarnings(result.warnings.map((w) => `${category.name}: ${w}`))
      if (editing?.id === category.id) closePanel()
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  async function unarchiveCategory(category) {
    setRowError(null)
    setWarnings([])
    try {
      await api.categories.unarchive(category.id)
      if (editing?.id === category.id) closePanel()
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  const domainName = (id) => domains.find((d) => d.id === id)?.name
  const active = (categories ?? []).filter((c) => !c.archived_on)
  const available = (id) => summary?.categories.find((c) => c.category_id === id)?.available_cents ?? 0
  const rows = categories ? viewRows(categories, available, collapsed, search) : []
  const parentIds = rows.filter((r) => r.isParent).map((r) => r.category.id)
  const goalOf = (id) => goals.find((g) => g.goal.category_id === id)
  const poolAbsorber = (id) => summary?.categories.find((c) => c.category_id === id)?.pool_absorber ?? null
  const poolAvailable = (id) => summary?.categories.find((c) => c.category_id === id)?.pool_available_cents ?? 0

  const formPanel = panelOpen && (
    <SidePanel
      title={editing ? `Edit · ${editing.name}` : 'Add a category'}
      onClose={closePanel}
      focusKey={focusKey}
    >
      {editing && !editing.archived_on && (
        <section aria-label="Move money" className="mb-4 space-y-3 rounded-lg bg-raised p-3">
          <h4 className="text-section">Move money</h4>
          {assignError && <WarningNote>{assignError}</WarningNote>}
          {moveNote && <SaveNote>{moveNote}</SaveNote>}
          {linkedWarning && <WarningNote>{linkedWarning}</WarningNote>}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              addOrWithdraw(editing, 'add')
            }}
          >
            <MoneyInput label="Amount" value={moveAmount} onChange={setMoveAmount} />
            <div className="flex gap-3">
              <Button type="submit" variant="secondary">Add</Button>
              <Button variant="secondary" onClick={() => addOrWithdraw(editing, 'withdraw')}>Withdraw</Button>
            </div>
          </form>
          <form className="space-y-3" onSubmit={(e) => moveToCategory(e, editing)}>
            <NamePicker
              key={moveKey}
              label="Move to…"
              items={active.filter((c) => c.id !== editing.id)}
              onChange={(id, text) => setMoveTo({ id, text })}
            />
            <Button type="submit" variant="secondary">Move</Button>
          </form>
        </section>
      )}
      <form key={formKey} onSubmit={submit} className="space-y-4">
        {formError && <RefusalNote>{formError}</RefusalNote>}
        {saved && <SaveNote>{saved}</SaveNote>}
        <label className="block space-y-1">
          <span className="field-label">Name</span>
          <input
            className="field w-full"
            value={form.name}
            disabled={saving}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <NamePicker
          label="Sits under (optional)"
          items={active.filter((c) => !editing || c.id !== editing.id)}
          initialId={form.parent.id}
          onChange={(id, text) => setForm({ ...form, parent: { id, text } })}
        />
        <NamePicker
          label="Domain (optional)"
          items={domains}
          initialId={form.domain.id}
          onChange={(id, text) => setForm({ ...form, domain: { id, text } })}
        />
        <label className="block space-y-1">
          <span className="field-label">Default need level</span>
          <select
            className="field w-full"
            value={form.needLevel}
            onChange={(e) => setForm({ ...form, needLevel: e.target.value })}
          >
            <option value="">Not set</option>
            {NEED_LEVELS.map((n) => (
              <option key={n.value} value={n.value}>{n.label}</option>
            ))}
          </select>
        </label>
        <NamePicker
          label="Draws on when overspent (its pool, optional)"
          items={active.filter((c) => !editing || c.id !== editing.id)}
          initialId={form.pool.id}
          onChange={(id, text) => setForm({ ...form, pool: { id, text } })}
        />
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.absorb}
            onChange={(e) => setForm({ ...form, absorb: e.target.checked })}
          />
          Absorb overspending (when another category draws on this one and everything is spent, this one goes negative instead)
        </label>
        {editing && <GoalFields goal={goalForm} onChange={setGoalForm} streams={streams} />}
        {editing && (
          <LinkFields
            accounts={accounts}
            linkIds={linkIds}
            onChange={setLinkIds}
            filter={linkFilter}
            onFilter={setLinkFilter}
            shortHorizonGoalDate={shortHorizonDate(goalForm, pickerDate)}
          />
        )}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>{editing ? 'Save' : 'Add category'}</Button>
          <Button variant="secondary" onClick={closePanel}>{editing ? 'Cancel' : 'Done'}</Button>
        </div>
      </form>
      {editing && (
        <div className="mt-6 border-t border-line pt-3">
          {/* Archive, quiet negative, at the panel's foot (DESIGN.md § Row actions). */}
          <Button
            variant="destructive"
            onClick={() => (editing.archived_on ? unarchiveCategory(editing) : archiveCategory(editing))}
          >
            {editing.archived_on ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
      )}
    </SidePanel>
  )

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title hidden md:block">Categories</h2>
        <Button className="ml-auto" onClick={startAdd}>Add a category</Button>
      </div>

      {summary && (
        <p className="text-text-2">
          Ready to assign <span className="tabular block text-headline text-text">{formatCents(summary.ready_to_assign_cents)}</span>
          {summary.overspent_cents !== 0 && (
            <span className="text-sm text-text-2">
              (includes {formatCents(summary.overspent_cents)} in overspent categories)
            </span>
          )}
        </p>
      )}

      <PanelLayout panel={formPanel}>
        <section className="card space-y-3">
          {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
          {rowError && <WarningNote>{rowError}</WarningNote>}
          {!panelOpen && assignError && <WarningNote>{assignError}</WarningNote>}
          {!panelOpen && linkedWarning && <WarningNote>{linkedWarning}</WarningNote>}
          {warnings.map((w) => (
            <WarningNote key={w}>{w}</WarningNote>
          ))}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <input
              className="field"
              placeholder="Search categories"
              aria-label="Search categories"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
            {parentIds.length > 0 && !search.trim() && (
              <div className="flex">
                <Button variant="quiet" onClick={() => setCollapsedIds([])}>Expand all</Button>
                <Button variant="quiet" onClick={() => setCollapsedIds(parentIds)}>Collapse all</Button>
              </div>
            )}
          </div>
          {!error && !categories && <LoadingRows />}
          {categories && categories.length === 0 && (
            <EmptyState action={<Button variant="secondary" onClick={startAdd}>Add a category</Button>}>
              No categories yet.
            </EmptyState>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Domain</th>
                    <th>Need level</th>
                    <th className="text-right">Available</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    if (row.itself) {
                      const c = row.itself
                      return (
                        <tr
                          key={`${c.id}-itself`}
                          className={`cursor-pointer text-text-2 ${editing?.id === c.id ? 'bg-raised' : ''}`}
                          onClick={() => startEdit(c)}
                        >
                          <td className="py-1" style={{ paddingLeft: `${row.depth * 1.25 + 1.5}rem` }}>{c.name} itself</td>
                          <td></td>
                          <td></td>
                          <td className={`tabular py-1 text-right ${row.cents < 0 ? 'text-negative' : ''}`}>{formatCents(row.cents)}</td>
                          <td></td>
                        </tr>
                      )
                    }
                    const { category: c, depth, isParent, expanded, total } = row
                    const shown = isParent ? total : available(c.id)
                    const Chevron = expanded ? ChevronDown : ChevronRight
                    return (
                      <Fragment key={c.id}>
                        <tr
                          className={`cursor-pointer ${editing?.id === c.id ? 'bg-raised' : ''}`}
                          tabIndex={0}
                          onClick={() => startEdit(c)}
                          onKeyDown={(e) => {
                            if (e.target === e.currentTarget && e.key === 'Enter') startEdit(c)
                          }}
                        >
                          <td className="py-1" style={{ paddingLeft: `${depth * 1.25 + (isParent ? 0 : 1.5)}rem` }}>
                            <div className="flex items-center gap-1">
                              {isParent && (
                                <button
                                  type="button"
                                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${c.name}`}
                                  aria-expanded={expanded}
                                  className="btn btn-quiet px-0 text-text-2"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleGroup(c.id)
                                  }}
                                >
                                  <Chevron aria-hidden="true" size={20} />
                                </button>
                              )}
                              {isParent ? (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleGroup(c.id)
                                  }}
                                >
                                  {c.name}
                                </span>
                              ) : (
                                c.name
                              )}
                            </div>
                            {c.linked_accounts.length > 0 && (
                              <div className="text-sm text-text-3">
                                money is in {c.linked_accounts.map((a) => a.name).join(' and ')}
                              </div>
                            )}
                            {c.archived_on && (
                              <div className="text-sm text-text-3">archived {formatDate(c.archived_on)}</div>
                            )}
                          </td>
                          <td className="py-1">{domainName(c.domain_id) ?? ''}</td>
                          <td className="py-1">{needLabel(c.need_level) ?? ''}</td>
                          <td className={`tabular py-1 text-right ${shown < 0 ? 'text-negative' : ''}`}>
                            {formatCents(shown)}
                            {(poolAvailable(c.id) > 0 || poolAbsorber(c.id)) && (
                              <div className="text-sm text-text-3">
                                +{formatCents(poolAvailable(c.id))} available if overspent
                                {poolAbsorber(c.id) && `, then ${poolAbsorber(c.id)} absorbs the rest`}
                              </div>
                            )}
                          </td>
                          <td className="py-1 text-right whitespace-nowrap">
                            {/* On a phone the row has no visible control: tapping it opens the form. */}
                            {!c.archived_on && (
                              <Button
                                variant="secondary"
                                className="hidden md:inline-flex"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  startEdit(c)
                                }}
                              >
                                Move money
                              </Button>
                            )}
                          </td>
                        </tr>
                        {goalOf(c.id) && (
                          <GoalRow
                            progress={goalOf(c.id)}
                            depth={depth}
                            archived={!!c.archived_on}
                            streams={streams}
                            selected={editing?.id === c.id}
                            onSelect={() => startEdit(c)}
                          />
                        )}
                      </Fragment>
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
