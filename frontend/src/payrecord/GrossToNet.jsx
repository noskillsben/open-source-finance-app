import MoneyInput from '../components/MoneyInput.jsx'
import { formatCents } from '../utils/format.js'
import AmountRows from './AmountRows.jsx'

// Block 3: gross to net, or just the net when the paycheque has no deductions.
export default function GrossToNet({ pay }) {
  const { data, amounts, totals } = pay
  const { categories } = data
  const { deductionsOn, setDeductionsOn, gross, setGross, deductions, setDeductions, netOnly, setNetOnly } = amounts
  const { net } = totals

  return (
    <fieldset className="card space-y-3">
      <legend className="px-1 text-section">Gross to net</legend>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={deductionsOn} onChange={(e) => setDeductionsOn(e.target.checked)} />
        This paycheque has deductions
      </label>
      {deductionsOn ? (
        <>
          <MoneyInput label="Gross — what the employer pays before deductions" value={gross} onChange={(text) => setGross(text)} />
          <AmountRows rows={deductions} categories={categories} onChange={setDeductions} addLabel="+ Add deduction" />
        </>
      ) : (
        <MoneyInput label="Net" value={netOnly} onChange={(text) => setNetOnly(text)} />
      )}
      <p className="text-sm text-text-2">Net: {formatCents(net)}</p>
    </fieldset>
  )
}
