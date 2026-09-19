import { useEffect, useState } from 'react'
import Accounts from './Accounts.jsx'
import IntegrityCheck from './IntegrityCheck.jsx'
import Transactions from './Transactions.jsx'
import { api } from './api.js'
import { todayIso } from './utils/format.js'

export default function App() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [pickerDate, setPickerDate] = useState(todayIso)

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="mx-auto max-w-xl px-6">
      <header className="pt-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Open Source Finance App</h1>
          <p className="text-paper-soft">A financial mirror, not a financial cage.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-paper-soft">Show as of</span>
          <input
            type="date"
            className="rounded bg-ink-soft px-2 py-1"
            value={pickerDate}
            onChange={(e) => setPickerDate(e.target.value)}
          />
        </label>
      </header>

      {error && (
        <p className="text-bad mt-2">Could not reach the backend: {error}</p>
      )}
      {health && health.status !== 'ok' && (
        <p className="text-bad mt-2">Backend reports: {JSON.stringify(health)}</p>
      )}

      <Accounts pickerDate={pickerDate} />
      <Transactions pickerDate={pickerDate} />
      <IntegrityCheck />
    </div>
  )
}
