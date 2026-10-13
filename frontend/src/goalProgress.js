import { formatCents } from './utils/format.js'

/** What a goal has saved, worded once for the Categories goal row and the Due dates page, so the two
 * never show different numbers. `short` is set when the category is below zero ("$525.00 short" in
 * negative, never "-$525.00 of $1,050.00", #220); otherwise `text` is a Commitment's "$140.00 of
 * $200.00 this month" or the balance against its target. */
export function goalSaved(progress) {
  const { balance_cents: balance, target_cents: target, commitment_progress_text: progressLine } = progress
  const short = balance < 0 ? formatCents(-balance) : null
  const text = progressLine ?? (target == null ? formatCents(balance) : `${formatCents(balance)} of ${formatCents(target)}`)
  return { short, text }
}
