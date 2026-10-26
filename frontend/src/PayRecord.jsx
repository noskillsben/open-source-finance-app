import LoadingRows from './components/LoadingRows.jsx'
import { RefusalNote, WarningNote } from './components/Notes.jsx'
import { useRegisterFormOpen } from './components/SidePanel.jsx'
import { formatCents } from './utils/format.js'
import AmountRows from './payrecord/AmountRows.jsx'
import GrossToNet from './payrecord/GrossToNet.jsx'
import PayHeader from './payrecord/PayHeader.jsx'
import { Bills, FundingRules, GoalSetAsides, RetainIncome } from './payrecord/PayGoalBlocks.jsx'
import { EverythingElse, LeftOver, ShortBy } from './payrecord/PayLeftoverBlocks.jsx'
import { usePayRecord } from './payrecord/usePayRecord.js'

export default function PayRecord({ pickerDate }) {
  // The pay screen is a form: hide the shell's bottom bar so the pinned Left over bar owns the edge.
  useRegisterFormOpen(true)
  const pay = usePayRecord(pickerDate)
  const { isOneOff, streamId, data, amounts, totals, formError, record } = pay
  const { streams, stream, categories, payday, period, periodLoaded, error, retainGoals, billGoals, fundingGoals, targetGoals } = data
  const { oneOff, setOneOff } = amounts
  const { net, leftover, coverRows } = totals

  if (error) return <WarningNote>Could not reach the backend: {error}</WarningNote>
  if (!streams || !payday) return <LoadingRows />
  if (!isOneOff && !stream) return <WarningNote>No named pay with id {streamId}.</WarningNote>

  // The header shows the last day of the period, so two periods never appear to share a day.
  const periodEnd = periodLoaded ? period.period_end : null

  return (
    <form onSubmit={record} className="space-y-6 py-4 pb-24 lg:pb-4 lg:pr-56">
      {/* Running Left over (#399): pinned so it stays in view the whole way down. A bar at the
          bottom on a phone (the app's bottom bar is hidden on this screen), a small card on the
          right edge on desktop. Same value as block 11. */}
      <div
        role="status"
        aria-label="Running left over"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between border-t border-line bg-surface px-4 pt-3 md:left-60 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-auto lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-24 lg:w-52 lg:flex-col lg:items-start lg:gap-1 lg:rounded-xl lg:border"
      >
        <span className="text-text-2">Left over so far</span>
        <span data-testid="running-leftover" className={`tabular text-section ${leftover < 0 ? 'text-negative' : ''}`}>{formatCents(leftover)}</span>
      </div>
      <PayHeader pay={pay} periodEnd={periodEnd} />

      {formError && <RefusalNote>{formError}</RefusalNote>}

      {/* 2. Income this period */}
      <div className="card">
        <p className="text-sm text-text-2">Income this period</p>
        <p className="tabular text-headline">{formatCents(net)}</p>
      </div>

      {/* 3. Gross to net */}
      <GrossToNet pay={pay} />

      {/* 4. Retain income */}
      {retainGoals.length > 0 && <RetainIncome pay={pay} />}

      {/* 5. One-off this period */}
      <fieldset className="card space-y-3">
        <legend className="px-1 text-section">One-off this period</legend>
        <p className="text-sm text-text-2">Add anything that only applies this period.</p>
        <AmountRows rows={oneOff} categories={categories} onChange={setOneOff} addLabel="+ Add a one-off" />
      </fieldset>

      {/* 6. Bills */}
      {billGoals.length > 0 && <Bills pay={pay} />}

      {/* 7. Funding rules */}
      {fundingGoals.length > 0 && <FundingRules pay={pay} />}

      {/* 8. Goal set-asides */}
      {targetGoals.length > 0 && <GoalSetAsides pay={pay} />}

      {/* 9. Everything else */}
      <EverythingElse pay={pay} />

      {/* 10. Short by */}
      {(leftover < 0 || coverRows.length > 0) && <ShortBy pay={pay} />}

      {/* 11. Left over */}
      <LeftOver pay={pay} />
    </form>
  )
}
