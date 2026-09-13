import { useEffect, useState } from 'react'
import { api } from './api.js'
import { formatCents, formatDate } from './utils/format.js'

export default function App() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message))
  }, [])

  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Open Source Finance App</h1>
        <p className="text-paper-soft">A financial mirror, not a financial cage.</p>
      </header>

      <section className="rounded-lg bg-ink-soft p-4 space-y-2">
        <h2 className="text-sm uppercase tracking-wide text-paper-soft">Backend</h2>
        {error && <p className="text-bad">Could not reach the backend: {error}</p>}
        {!error && !health && <p>Checking…</p>}
        {health && (
          <ul className="space-y-1">
            <li>API: <span className={health.status === 'ok' ? 'text-ok' : 'text-bad'}>{health.status}</span></li>
            <li>Database: <span className={health.database === 'ok' ? 'text-ok' : 'text-bad'}>{health.database}</span></li>
            <li>Mode: {health.app_mode}</li>
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-ink-soft p-4 space-y-1 text-paper-soft text-sm">
        <p>Formatter check: {formatCents(123456)} on {formatDate('2026-09-12')}.</p>
        <p>Nothing else exists yet. The design is in <code>docs/design/DESIGN.md</code>.</p>
      </section>
    </main>
  )
}
