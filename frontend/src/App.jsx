import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Accounts from './Accounts.jsx'
import Categories from './Categories.jsx'
import Domains from './Domains.jsx'
import IntegrityCheck from './IntegrityCheck.jsx'
import { BottomBar, Sidebar, titleFor } from './Nav.jsx'
import Pay from './Pay.jsx'
import PayRecord from './PayRecord.jsx'
import Payees from './Payees.jsx'
import Splits from './Splits.jsx'
import Transactions from './Transactions.jsx'
import Button from './components/Button.jsx'
import { WarningNote } from './components/Notes.jsx'
import { FormOpenProvider } from './components/SidePanel.jsx'
import { api } from './api.js'
import { todayIso } from './utils/format.js'
import { clearPickerDate, loadPickerDate, savePickerDate } from './utils/pickerDate.js'

// The shell (DESIGN.md § Visual design → The shell): a sidebar and a top bar on a desktop; a top bar
// with the page title, and a bottom bar, on a phone. Pages use the full width beside the menu.
function Shell({ pickerDate, onPickerDate, onToday, notToday, error, health, children }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const addTransaction = () => navigate('/transactions', { state: { addTransaction: true } })

  return (
    <div className="md:flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-page px-4 py-2 md:px-8">
          <h1 className="page-title md:hidden">{titleFor(pathname)}</h1>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-2">
              <span className="field-label sr-only md:not-sr-only">Show as of</span>
              <input
                type="date"
                className={`field rounded-full md:rounded-lg ${notToday ? 'border-2 border-warning' : ''}`}
                value={pickerDate}
                onChange={(e) => onPickerDate(e.target.value)}
              />
            </label>
            {notToday && (
              <>
                <span className="text-sm font-medium text-warning">not today</span>
                <Button variant="quiet" onClick={onToday}>Today</Button>
              </>
            )}
            <Button className="hidden md:inline-flex" onClick={addTransaction}>+ Add transaction</Button>
          </div>
        </header>

        <main className="px-4 pb-bar md:px-8 md:pb-8">
          {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
          {health && health.status !== 'ok' && <WarningNote>Backend reports: {JSON.stringify(health)}</WarningNote>}
          {children}
        </main>
      </div>
      <BottomBar onAdd={addTransaction} />
    </div>
  )
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
      <FormOpenProvider>
        <Shell
          pickerDate={pickerDate}
          onPickerDate={changePickerDate}
          onToday={resetToToday}
          notToday={notToday}
          error={error}
          health={health}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/transactions" replace />} />
            <Route path="/income" element={<Pay pickerDate={pickerDate} />} />
            <Route path="/income/one-off" element={<PayRecord pickerDate={pickerDate} />} />
            <Route path="/income/:id/record" element={<PayRecord pickerDate={pickerDate} />} />
            <Route path="/transactions" element={<Transactions pickerDate={pickerDate} />} />
            <Route path="/categories" element={<Categories pickerDate={pickerDate} />} />
            <Route path="/accounts" element={<Accounts pickerDate={pickerDate} />} />
            <Route path="/payees" element={<Payees pickerDate={pickerDate} />} />
            <Route path="/split-expenses" element={<Splits pickerDate={pickerDate} />} />
            <Route path="/domains" element={<Domains pickerDate={pickerDate} />} />
            <Route path="/settings/data-check" element={<IntegrityCheck />} />
          </Routes>
        </Shell>
      </FormOpenProvider>
    </BrowserRouter>
  )
}
