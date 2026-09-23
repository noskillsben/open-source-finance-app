import { Fragment, useEffect, useState } from 'react'
import { api } from './api.js'
import Domains from './Domains.jsx'
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

// Goal kinds and cadences (DESIGN.md § Goals). One goal per category; "No goal" archives it.
const GOAL_KINDS = [
  { value: 'recurring_bill', label: 'Recurring bill' },
  { value: 'target', label: 'Target' },
  { value: 'commitment', label: 'Commitment' },
]
const CADENCES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'weeks', label: 'Every N weeks' },
]
const EMPTY_GOAL = {
  kind: '', name: '', flavour: 'add', addFlavour: 'fixed', amount: '', level: '', percent: '',
  cadence: '', weeks: '', date: '', incomeStreamId: null,
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
    date: goal.target_date ?? '',
    incomeStreamId: goal.income_stream_id ?? null,
  }
}

// The request body for a goal form: a field the kind doesn't use is sent as null, never zero.
function goalBody(g, pickerDate) {
  const cents = (text) => (String(text).trim() === '' ? null : parseCents(text))
  const refill = g.kind === 'commitment' && g.flavour === 'refill'
  const percentFlavour = g.kind === 'commitment' && g.flavour === 'add' && g.addFlavour === 'percent'
  return {
    on: pickerDate,
    name: g.name.trim(),
    kind: g.kind,
    amount_cents: refill || percentFlavour ? null : cents(g.amount),
    level_cents: refill ? cents(g.level) : null,
    percent_of_net: percentFlavour && String(g.percent).trim() !== '' ? g.percent : null,
    cadence: g.cadence || null,
    cadence_weeks: g.cadence === 'weeks' && g.weeks !== '' ? Number(g.weeks) : null,
    target_date: g.kind !== 'commitment' && g.date ? g.date : null,
    income_stream_id: g.incomeStreamId ?? null,
  }
}

const cadenceText = (goal) => (goal.cadence === 'weeks' ? `every ${goal.cadence_weeks} weeks` : goal.cadence)

// The goal section of the category's settings form. The kind decides which fields show; "No goal"
// removes (archives) the goal on save.
function GoalFields({ goal, onChange, streams }) {
  const set = (patch) => onChange({ ...goal, ...patch })
  const moneyInput = (label, key) => (
    <label className="block text-sm">
      <span className="text-paper-soft">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
        value={goal[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </label>
  )
  const percentInput = (label, key) => (
    <label className="block text-sm">
      <span className="text-paper-soft">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
        value={goal[key]}
        onChange={(e) => set({ [key]: e.target.value.replace(/[^0-9.]/g, '') })}
      />
    </label>
  )
  const payPicker = (
    <NamePicker
      label="Named pay this is paid by (optional)"
      items={streams}
      initialId={goal.incomeStreamId}
      onChange={(id) => set({ incomeStreamId: id })}
    />
  )
  const cadenceInput = (label, optional) => (
    <>
      <label className="block text-sm">
        <span className="text-paper-soft">{label}</span>
        <select
          className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
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
        <label className="block text-sm">
          <span className="text-paper-soft">Number of weeks</span>
          <input
            type="text"
            inputMode="numeric"
            className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
            value={goal.weeks}
            onChange={(e) => set({ weeks: e.target.value.replace(/[^0-9]/g, '') })}
          />
        </label>
      )}
    </>
  )
  const dateInput = (label) => (
    <label className="block text-sm">
      <span className="text-paper-soft">{label}</span>
      <input
        type="date"
        className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
        value={goal.date}
        onChange={(e) => set({ date: e.target.value })}
      />
    </label>
  )
  return (
    <fieldset className="rounded bg-ink p-3 space-y-3">
      <legend className="px-1 text-sm font-medium">Goal</legend>
      <label className="block text-sm">
        <span className="text-paper-soft">Kind</span>
        <select
          className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
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
        <label className="block text-sm">
          <span className="text-paper-soft">Goal name</span>
          <input
            className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
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
          {dateInput('Next due date (optional)')}
        </>
      )}
      {goal.kind === 'target' && (
        <>
          {moneyInput('Amount to reach', 'amount')}
          {dateInput('Target date (optional)')}
          {goal.date && cadenceInput('Set aside every (optional)', true)}
        </>
      )}
      {goal.kind === 'commitment' && (
        <>
          <label className="block text-sm">
            <span className="text-paper-soft">Rule</span>
            <select
              className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
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
              <label className="block text-sm">
                <span className="text-paper-soft">Add</span>
                <select
                  className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
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
          {cadenceInput('How often', false)}
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
      <legend className="text-paper-soft">Money lives in (on-budget accounts)</legend>
      {eligible.length === 0 && <p className="text-paper-soft">No on-budget accounts yet.</p>}
      {eligible.length > 5 && (
        <input
          className="w-full rounded bg-ink px-2 py-1"
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
        <p className="text-paper-soft">
          This goal is due {formatDate(shortHorizonGoalDate)}, and money in an investment account may not
          be there when the date comes.
        </p>
      )}
    </fieldset>
  )
}

// The goal row under a category: name, "$X of $Y", due date, per-period amount, and its own
// Add / Withdraw box — the same earmark move as the row above, so progress and available stay one number.
function GoalRow({ progress, depth, amount, onAmount, onMove, archived }) {
  const { goal, balance_cents: balance, target_cents: target, owed_cents: owed, due_date: due, per_period_cents: perPeriod } = progress
  return (
    <tr className="text-sm text-paper-soft">
      <td colSpan={6} className="pb-2" style={{ paddingLeft: `${depth * 1.25 + 1}rem` }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-paper">{goal.name}</span>
          <span>{target == null ? formatCents(balance) : `${formatCents(balance)} of ${formatCents(target)}`}</span>
          {goal.kind === 'recurring_bill' && owed > 0 && <span>{formatCents(owed)} still owed this cycle</span>}
          {due && <span>{goal.kind === 'recurring_bill' ? 'due' : 'by'} {formatDate(due)}</span>}
          {perPeriod != null && (
            <span>
              {formatCents(perPeriod)}
              {goal.cadence ? ` ${cadenceText(goal)}` : ''}
            </span>
          )}
          {!archived && (
            <form
              className="flex gap-2 items-center"
              onSubmit={(e) => {
                e.preventDefault()
                onMove('add')
              }}
            >
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Amount to add to or withdraw from ${goal.name}`}
                className="w-24 rounded bg-ink px-2 py-1"
                value={amount}
                onChange={(e) => onAmount(e.target.value)}
              />
              <button type="submit" className="text-xs text-accent">Add</button>
              <button type="button" className="text-xs text-accent" onClick={() => onMove('withdraw')}>Withdraw</button>
            </form>
          )}
        </div>
      </td>
    </tr>
  )
}

const EMPTY_FORM = { name: '', needLevel: '', parent: {}, pool: {}, domain: {} }

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
  const [formKey, setFormKey] = useState(0) // remounts the form so its pickers reseed their text
  const [summary, setSummary] = useState(null) // ready to assign, overspent and each category's available
  const [amounts, setAmounts] = useState({}) // the assign box's text per category id
  const [assignError, setAssignError] = useState(null)
  const [goals, setGoals] = useState([]) // every goal shown at the picker date, with its progress
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL)
  const [streams, setStreams] = useState([]) // named pays, for the goal form's pay picker
  const [accounts, setAccounts] = useState([]) // for the link picker
  const [linkIds, setLinkIds] = useState([]) // account ids the category being edited is linked to
  const [linkFilter, setLinkFilter] = useState('')
  const [linkedWarning, setLinkedWarning] = useState(null) // shown after money leaves a linked category
  const [moving, setMoving] = useState(null) // { category, to: { id, text }, amount } while moving out of a category

  function refresh() {
    api.categories.list(pickerDate, showArchived).then(setCategories).catch((e) => setError(e.message))
    api.domains.list(pickerDate).then(setDomains).catch((e) => setError(e.message))
    api.readyToAssign(pickerDate).then(setSummary).catch((e) => setError(e.message))
    api.goals.list(pickerDate).then(setGoals).catch((e) => setError(e.message))
    api.accounts.list(pickerDate).then(setAccounts).catch((e) => setError(e.message))
    api.incomeStreams.list(pickerDate).then(setStreams).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  function startEdit(category) {
    setFormKey((k) => k + 1)
    setEditing(category)
    setForm({
      name: category.name,
      needLevel: category.need_level ?? '',
      parent: { id: category.parent_id },
      pool: { id: category.pool_id },
      domain: { id: category.domain_id },
    })
    setGoalForm(goalToForm(goals.find((g) => g.goal.category_id === category.id)?.goal))
    setLinkIds(category.linked_accounts.map((a) => a.id))
    setLinkFilter('')
    setFormError(null)
  }

  function resetForm() {
    setFormKey((k) => k + 1)
    setEditing(null)
    setForm(EMPTY_FORM)
    setGoalForm(EMPTY_GOAL)
    setLinkIds([])
    setFormError(null)
  }

  async function submit(e) {
    e.preventDefault()
    setFormError(null)
    const name = form.name.trim()
    if (!name) return setFormError('Name is required.')
    for (const [label, pick] of [['parent', form.parent], ['pool', form.pool], ['domain', form.domain]]) {
      if (unmatched(pick)) return setFormError(`"${pick.text}" is not an existing ${label}. Pick one from the list or clear the box.`)
    }
    const settings = {
      name,
      parent_id: form.parent.id ?? null,
      pool_id: form.pool.id ?? null,
      domain_id: form.domain.id ?? null,
      need_level: form.needLevel || null,
    }
    try {
      if (editing) {
        await api.categories.update(editing.id, settings)
        const hadGoal = goals.some((g) => g.goal.category_id === editing.id)
        if (goalForm.kind) await api.goals.set(editing.id, goalBody(goalForm, pickerDate))
        else if (hadGoal) await api.goals.archive(editing.id, pickerDate)
        const before = editing.linked_accounts.map((a) => a.id).sort().join()
        if (before !== [...linkIds].sort().join()) await api.categories.setLinkedAccounts(editing.id, pickerDate, linkIds)
      } else await api.categories.create({ ...settings, created_on: pickerDate })
      resetForm()
      refresh()
    } catch (err) {
      setFormError(err.message)
    }
  }

  // One earmark move line, dated the "Show as of" date, between ready to assign and the category:
  // Add moves money into the category, Withdraw moves it back out.
  async function addOrWithdraw(category, direction, boxKey = category.id) {
    setAssignError(null)
    setLinkedWarning(null)
    const cents = parseCents(amounts[boxKey])
    if (cents === null || cents <= 0) return setAssignError(`Enter an amount to move for ${category.name}.`)
    const side = direction === 'add' ? { to_category_id: category.id } : { from_category_id: category.id }
    try {
      await api.earmarkMoves.create({ date: pickerDate, cents, ...side })
      setLinkedWarning(direction === 'withdraw' ? linkedNote(category) : null)
      setAmounts({ ...amounts, [boxKey]: '' })
      refresh()
    } catch (err) {
      setAssignError(err.message)
    }
  }

  // Two earmark lines, out of `moving.category` and into the picked category.
  async function moveToCategory(e) {
    e.preventDefault()
    setAssignError(null)
    setLinkedWarning(null)
    const cents = parseCents(moving.amount)
    if (cents === null || cents <= 0) return setAssignError(`Enter an amount to move out of ${moving.category.name}.`)
    if (unmatched(moving.to) || moving.to.id == null) return setAssignError('Pick the category to move the money to.')
    try {
      await api.earmarkMoves.create({
        date: pickerDate,
        cents,
        from_category_id: moving.category.id,
        to_category_id: moving.to.id,
      })
      setLinkedWarning(linkedNote(moving.category))
      setMoving(null)
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
      refresh()
    } catch (err) {
      setRowError(err.message)
    }
  }

  const rows = categories ? orderTree(categories) : []
  const domainName = (id) => domains.find((d) => d.id === id)?.name
  const active = (categories ?? []).filter((c) => !c.archived_on)
  const available = (id) => summary?.categories.find((c) => c.category_id === id)?.available_cents ?? 0
  const goalOf = (id) => goals.find((g) => g.goal.category_id === id)
  const poolAvailable = (id) => summary?.categories.find((c) => c.category_id === id)?.pool_available_cents ?? 0

  return (
    <div className="py-6 space-y-6">
      <h2 className="text-xl font-semibold">Categories</h2>

      {summary && (
        <p className="text-lg">
          Ready to assign {formatCents(summary.ready_to_assign_cents)}
          {summary.overspent_cents !== 0 && (
            <span className="text-sm text-paper-soft">
              {' '}(includes {formatCents(summary.overspent_cents)} in overspent categories)
            </span>
          )}
        </p>
      )}

      <form
        key={formKey}
        onSubmit={submit}
        className="rounded-lg bg-ink-soft p-4 space-y-3"
      >
        <h3 className="font-medium">{editing ? `Edit ${editing.name}` : 'Add a category'}</h3>
        {formError && <p className="text-bad">{formError}</p>}
        <label className="block text-sm">
          <span className="text-paper-soft">Name</span>
          <input
            className="mt-1 w-full rounded bg-ink px-2 py-1"
            value={form.name}
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
        <label className="block text-sm">
          <span className="text-paper-soft">Default need level</span>
          <select
            className="mt-1 w-full rounded bg-ink px-2 py-1"
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
          <button type="submit" className="rounded bg-accent px-3 py-1 text-ink">
            {editing ? 'Save' : 'Add category'}
          </button>
          {editing && (
            <button type="button" className="text-sm text-accent" onClick={resetForm}>Cancel</button>
          )}
        </div>
      </form>

      <section className="rounded-lg bg-ink-soft p-4 space-y-2">
        {error && <p className="text-bad">Could not reach the backend: {error}</p>}
        {rowError && <p className="text-bad">{rowError}</p>}
        {assignError && <p className="text-bad">{assignError}</p>}
        {linkedWarning && <p className="text-paper-soft">{linkedWarning}</p>}
        {warnings.map((w) => (
          <p key={w} className="text-sm text-bad">{w}</p>
        ))}
        {moving && (
          <form key={moving.category.id} onSubmit={moveToCategory} className="rounded bg-ink p-3 space-y-2">
            <h3 className="font-medium">Move money out of {moving.category.name}</h3>
            <NamePicker
              label="Move to"
              items={active.filter((c) => c.id !== moving.category.id)}
              onChange={(id, text) => setMoving({ ...moving, to: { id, text } })}
            />
            <label className="block text-sm">
              <span className="text-paper-soft">Amount</span>
              <input
                type="text"
                inputMode="decimal"
                className="mt-1 w-full rounded bg-ink-soft px-2 py-1"
                value={moving.amount}
                onChange={(e) => setMoving({ ...moving, amount: e.target.value })}
              />
            </label>
            <div className="flex gap-3">
              <button type="submit" className="rounded bg-accent px-3 py-1 text-ink">Move</button>
              <button type="button" className="text-sm text-accent" onClick={() => setMoving(null)}>Cancel</button>
            </div>
          </form>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {!error && !categories && <p>Loading…</p>}
        {categories && categories.length === 0 && <p className="text-paper-soft">No categories yet.</p>}
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-paper-soft">
                <th className="pb-1">Name</th>
                <th className="pb-1">Domain</th>
                <th className="pb-1">Need level</th>
                <th className="pb-1 text-right">Available</th>
                <th className="pb-1">Move money</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ category: c, depth }) => (
                <Fragment key={c.id}>
                <tr>
                  <td className="py-1" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                    {c.name}
                    {c.linked_accounts.length > 0 && (
                      <div className="text-xs text-paper-soft">
                        money is in {c.linked_accounts.map((a) => a.name).join(' and ')}
                      </div>
                    )}
                    {c.archived_on && (
                      <div className="text-xs text-paper-soft">archived {formatDate(c.archived_on)}</div>
                    )}
                  </td>
                  <td className="py-1">{domainName(c.domain_id) ?? ''}</td>
                  <td className="py-1">{needLabel(c.need_level) ?? ''}</td>
                  <td className={`py-1 text-right ${available(c.id) < 0 ? 'text-bad' : ''}`}>
                    {formatCents(available(c.id))}
                    {poolAvailable(c.id) > 0 && (
                      <div className="text-xs text-paper-soft">
                        +{formatCents(poolAvailable(c.id))} available if overspent
                      </div>
                    )}
                  </td>
                  <td className="py-1 whitespace-nowrap">
                    {!c.archived_on && (
                      <form
                        className="flex gap-2 items-center"
                        onSubmit={(e) => {
                          e.preventDefault()
                          addOrWithdraw(c, 'add')
                        }}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Amount to add to or withdraw from ${c.name}`}
                          className="w-24 rounded bg-ink px-2 py-1"
                          value={amounts[c.id] ?? ''}
                          onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                        />
                        <button type="submit" className="text-xs text-accent">Add</button>
                        <button type="button" className="text-xs text-accent" onClick={() => addOrWithdraw(c, 'withdraw')}>
                          Withdraw
                        </button>
                        <button
                          type="button"
                          className="text-xs text-accent"
                          onClick={() => setMoving({ category: c, to: {}, amount: '' })}
                        >
                          Move to another category
                        </button>
                      </form>
                    )}
                  </td>
                  <td className="py-1 text-right space-x-3 whitespace-nowrap">
                    <button type="button" className="text-xs text-accent" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-accent"
                      onClick={() => (c.archived_on ? unarchiveCategory(c) : archiveCategory(c))}
                    >
                      {c.archived_on ? 'Unarchive' : 'Archive'}
                    </button>
                  </td>
                </tr>
                {goalOf(c.id) && (
                  <GoalRow
                    progress={goalOf(c.id)}
                    depth={depth}
                    amount={amounts[`goal-${c.id}`] ?? ''}
                    onAmount={(text) => setAmounts({ ...amounts, [`goal-${c.id}`]: text })}
                    onMove={(direction) => addOrWithdraw(c, direction, `goal-${c.id}`)}
                    archived={!!c.archived_on}
                  />
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Domains pickerDate={pickerDate} onChange={refresh} />
    </div>
  )
}
