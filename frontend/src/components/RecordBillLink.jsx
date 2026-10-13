import { Link } from 'react-router-dom'

// DESIGN.md § Nothing posts itself: opens the Ledger form pre-filled and linked to the bill's earliest
// unpaid due date; the user saves it. Shown on a recurring bill's row only, on Categories and Due dates.
export default function RecordBillLink({ progress }) {
  const { goal, earliest_unpaid_due_on: nextDue, earliest_unpaid_due_text: nextDueText } = progress
  if (goal.kind !== 'recurring_bill' || !nextDue) return null
  return (
    <Link
      className="btn btn-quiet"
      to="/transactions"
      onClick={(e) => e.stopPropagation()}
      state={{
        recordBill: {
          goal_id: goal.id,
          goal_due_on: nextDue,
          category_id: goal.category_id,
          amount_cents: goal.amount_cents,
        },
      }}
    >
      Record {nextDueText}
    </Link>
  )
}
