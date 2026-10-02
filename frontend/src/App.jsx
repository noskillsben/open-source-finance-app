import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Accounts from './Accounts.jsx'
import Categories from './Categories.jsx'
import Domains from './Domains.jsx'
import IntegrityCheck from './IntegrityCheck.jsx'
import Nav from './Nav.jsx'
import Pay from './Pay.jsx'
import PayRecord from './PayRecord.jsx'
import Payees from './Payees.jsx'
import Transactions from './Transactions.jsx'
import { api } from './api.js'
import { todayIso } from './utils/format.js'
import { clearPickerDate, loadPickerDate, savePickerDate } from './utils/pickerDate.js'

// Categories carries a wide table, so it gets room on a desktop; every other page stays narrow.
function Layout({ children }) {
  const { pathname } = useLocation()
  const width = pathname === '/categories' ? 'max-w-xl lg:max-w-6xl' : 'max-w-xl'
  return <div className={`mx-auto ${width} px-6`}>{children}</div>
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [pickerDate, setPickerDate] = useState(loadPickerDate)

  const today = todayIso()
  const notToday = pickerDate !== today

  // An empty input (cleared by the user) means "back to today", never "no date".
  function changePickerDate(value) {
    if (!value) return resetToToday()
    setPickerDate(value)
    savePickerDate(value)
  }

  function resetToToday() {
    setPickerDate(today)
    clearPickerDate()
  }

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message))
  }, [])

  return (
    <BrowserRouter>
      <Layout>
        <header className="pt-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Open Source Finance App</h1>
            <p className="text-paper-soft">A financial mirror, not a financial cage.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-paper-soft">Show as of</span>
              <input
                type="date"
                className={`rounded bg-ink-soft px-2 py-1 ${notToday ? 'border-2 border-warn' : ''}`}
                value={pickerDate}
                onChange={(e) => changePickerDate(e.target.value)}
              />
            </label>
            {notToday && (
              <>
                <span className="font-medium text-warn">not today</span>
                <button
                  type="button"
                  className="rounded bg-accent px-2 py-1 text-paper"
                  onClick={resetToToday}
                >
                  Today
                </button>
              </>
            )}
          </div>
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
          <Route path="/pay" element={<Pay pickerDate={pickerDate} />} />
          <Route path="/pay/one-off" element={<PayRecord pickerDate={pickerDate} />} />
          <Route path="/pay/:id/record" element={<PayRecord pickerDate={pickerDate} />} />
          <Route path="/ledger" element={<Transactions pickerDate={pickerDate} />} />
          <Route path="/categories" element={<Categories pickerDate={pickerDate} />} />
          <Route path="/accounts" element={<Accounts pickerDate={pickerDate} />} />
          <Route path="/payees" element={<Payees pickerDate={pickerDate} />} />
          <Route path="/domains" element={<Domains pickerDate={pickerDate} />} />
          <Route path="/settings/data-check" element={<IntegrityCheck />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
