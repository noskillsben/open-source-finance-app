import NamePicker from '../NamePicker.jsx'
import MoneyInput from '../components/MoneyInput.jsx'
import { emptyRow } from './payHelpers.js'

// Category + amount rows, added and removed freely — the shape blocks 3, 5 and 9 all share.
export default function AmountRows({ rows, categories, onChange, addLabel }) {
  const set = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i))
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <NamePicker
              label="Category"
              items={categories}
              initialId={r.category.id}
              onChange={(id, text) => set(i, { category: { id, text } })}
            />
          </div>
          <MoneyInput label="Amount" className="w-28" value={r.amount} onChange={(text) => set(i, { amount: text })} />
          <button type="button" className="btn btn-quiet" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-quiet" onClick={() => onChange([...rows, emptyRow()])}>
        {addLabel}
      </button>
    </div>
  )
}
