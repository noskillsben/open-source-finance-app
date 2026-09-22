import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Accounts from './Accounts.jsx'
import Categories from './Categories.jsx'
import Domains from './Domains.jsx'
import IntegrityCheck from './IntegrityCheck.jsx'
import Nav from './Nav.jsx'
import Payees from './Payees.jsx'
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
    <BrowserRouter>
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

        <div className="mt-4">
          <Nav />
        </div>

        {error && (
          <p className="text-bad mt-2">Could not reach the backend: {error}</p>
        )}
        {health && health.status !== 'ok' && (
          <p className="text-bad mt-2">Backend reports: {JSON.stringify(health)}</p>
        )}

        <Routes>
          <Route path="/" element={<Navigate to="/ledger" replace />} />
          <Route path="/ledger" element={<Transactions pickerDate={pickerDate} />} />
          <Route path="/categories" element={<Categories pickerDate={pickerDate} />} />
          <Route path="/accounts" element={<Accounts pickerDate={pickerDate} />} />
          <Route path="/payees" element={<Payees pickerDate={pickerDate} />} />
          <Route path="/domains" element={<Domains pickerDate={pickerDate} />} />
          <Route path="/settings/data-check" element={<IntegrityCheck />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
