import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { ISO_DATE } from './payHelpers.js'

// What the pay screen reads from the backend: the named pay, the lists for the payday, the period's
// facts and the pay already recorded for it (DESIGN.md § Re-opening a recorded pay).
export function usePayData({ pickerDate, streamId, isOneOff, dateParam }) {
  const [streams, setStreams] = useState(null)
  const [categories, setCategories] = useState([])
  const [categoriesAll, setCategoriesAll] = useState([]) // including archived, to label a row "(archived)"
  const [accounts, setAccounts] = useState([])
  const [goals, setGoals] = useState([])
  // The backend's facts for this payday: { payday, period_end, recorded, last_period_actuals }.
  // `payday` says which one it answers, so a stale answer is never read for a payday since moved.
  const [period, setPeriod] = useState(null)
  const [error, setError] = useState(null)
  const [payday, setPayday] = useState(null)
  const [goalsLoaded, setGoalsLoaded] = useState(false)
  const [readyToAssign, setReadyToAssign] = useState(null) // block 10: /api/ready-to-assign summary

  const stream = streams?.find((s) => s.id === streamId) ?? null

  useEffect(() => {
    api.incomeStreams.list(pickerDate, true).then(setStreams).catch((e) => setError(e.message))
  }, [pickerDate])

  // The period end, the recorded pay and last period's actual for this payday all come from the
  // backend, which owns the cadence maths (app/services/cadence.py).
  // `isStale` lets the effect drop an answer for a payday the user has since moved off, so a slow
  // answer for an earlier payday can never land over the current one.
  function refreshPeriod(isStale = () => false) {
    if (!payday) return Promise.resolve()
    return api.payPeriod(payday, isOneOff ? null : streamId)
      .then((p) => { if (!isStale()) setPeriod({ ...p, payday }) })
      .catch((e) => { if (!isStale()) setError(e.message) })
  }

  useEffect(() => {
    let cancelled = false
    refreshPeriod(() => cancelled)
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when payday, stream or one-off changes
  }, [payday, streamId, isOneOff])

  const periodLoaded = period != null && period.payday === payday

  // Seed the payday once the stream is known — or, with no named pay behind this screen, from
  // the app-wide picker date, since there is no next payday to anchor on.
  useEffect(() => {
    if (payday !== null) return
    if (isOneOff) return setPayday(pickerDate)
    if (!stream) return
    setPayday(dateParam && ISO_DATE.test(dateParam) ? dateParam : stream.next_payday)
  }, [stream, payday, isOneOff, pickerDate, dateParam])

  useEffect(() => {
    if (!payday) return
    api.categories.list(payday).then(setCategories).catch((e) => setError(e.message))
    api.categories.list(payday, true).then(setCategoriesAll).catch((e) => setError(e.message))
    api.accounts.list(payday).then(setAccounts).catch((e) => setError(e.message))
    setGoalsLoaded(false)
    api.goals.list(payday)
      .then((g) => { setGoals(g); setGoalsLoaded(true) })
      .catch((e) => setError(e.message))
  }, [payday])

  function refreshReadyToAssign() {
    if (!payday) return
    return api.readyToAssign(payday).then(setReadyToAssign).catch((e) => setError(e.message))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the payday changes
  useEffect(() => { refreshReadyToAssign() }, [payday])

  // Every goal bound to this named pay (DESIGN.md § Goals are paid by a named pay).
  const streamGoals = useMemo(
    () => (stream ? goals.filter((g) => g.goal.income_stream_id === stream.id) : []),
    [goals, stream]
  )
  const retainGoals = useMemo(
    () => streamGoals.filter((g) => g.goal.kind === 'commitment' && g.goal.percent_of_net != null),
    [streamGoals]
  )
  const billGoals = useMemo(
    () =>
      streamGoals
        .filter((g) => g.goal.kind === 'recurring_bill')
        .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')),
    [streamGoals]
  )
  const fundingGoals = useMemo(
    () =>
      streamGoals.filter(
        (g) => g.goal.kind === 'commitment' && (g.goal.amount_cents != null || g.goal.level_cents != null)
      ),
    [streamGoals]
  )
  const targetGoals = useMemo(() => streamGoals.filter((g) => g.goal.kind === 'target'), [streamGoals])

  // Named pays only. A one-off has no income_stream_id and no anchor payday, so the screen has no
  // way to find the transaction it wrote before, and a marker invented just to re-find one would be
  // a second identity mechanism (DESIGN.md § Record income, "A one-off on the pay screen"). A
  // one-off is a one-shot write every time; a recorded one is corrected in the Ledger.
  const existingTransaction = useMemo(
    () => (periodLoaded ? (period.recorded ?? null) : null),
    [period, periodLoaded]
  )
  const reopening = existingTransaction != null

  return {
    streams, stream, categories, categoriesAll, accounts, goals, goalsLoaded, period, periodLoaded, error,
    payday, setPayday, readyToAssign, refreshPeriod, streamGoals, retainGoals, billGoals, fundingGoals, targetGoals,
    existingTransaction, reopening,
  }
}
