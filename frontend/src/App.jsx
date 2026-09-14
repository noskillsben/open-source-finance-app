import { useEffect, useState } from 'react'
import Accounts from './Accounts.jsx'
import Transactions from './Transactions.jsx'
import { api } from './api.js'

export default function App() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="mx-auto max-w-xl px-6">
      <header className="pt-6">
        <h1 className="text-2xl font-semibold">Open Source Finance App</h1>
        <p className="text-paper-soft">A financial mirror, not a financial cage.</p>
      </header>

      {error && (
        <p className="text-bad mt-2">Could not reach the backend: {error}</p>
      )}
      {health && health.status !== 'ok' && (
        <p className="text-bad mt-2">Backend reports: {JSON.stringify(health)}</p>
      )}

      <Accounts />
      <Transactions />
    </div>
  )
}
