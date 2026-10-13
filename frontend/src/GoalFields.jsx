import { CADENCES } from './cadences.js'
import MoneyInput from './components/MoneyInput.jsx'
import NamePicker from './NamePicker.jsx'
import { parseCents } from './utils/format.js'

// The one goal form (DESIGN.md § Goals), shared by the category's settings panel on Categories and
// the Due dates page: the fields, the form state, and the request body.

// Goal kinds and cadences (DESIGN.md § Goals). One goal per category; "No goal" archives it.
export const GOAL_KINDS = [
  { value: 'commitment', label: 'Commitment' },
  { value: 'recurring_bill', label: 'Recurring bill' },
  { value: 'target', label: 'Target' },
]
// A fixed-amount Commitment's cadence, in this order; "Each payday" is the empty cadence, and there
// is no every-N-weeks (that stays on bills).
export const COMMITMENT_CADENCES = [
  { value: '', label: 'Each payday' },
  ...CADENCES.filter((c) => c.value !== 'weeks'),
]
export const EMPTY_GOAL = {
  kind: '', name: '', flavour: 'add', addFlavour: 'fixed', amount: '', level: '', percent: '',
  cadence: '', weeks: '', date: '', firstDueMonth: '', incomeStreamId: null,
}

// "2026-10" -> the month's last day, "2026-10-31". Day 0 of the next month, in UTC.
const monthEnd = (month) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const centsText = (cents) => (cents == null ? '' : (cents / 100).toFixed(2))

export function goalToForm(goal) {
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
export function goalBody(g, pickerDate) {
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
export function GoalFields({ goal, onChange, streams, kinds, allowNone = true }) {
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
          {allowNone && <option value="">No goal</option>}
          {GOAL_KINDS.filter((k) => !kinds || kinds.includes(k.value)).map((k) => (
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
