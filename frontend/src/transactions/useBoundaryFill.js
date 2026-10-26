import { useEffect, useRef } from 'react'
import { parseCents } from '../utils/format.js'
import { emptyCategoryLine } from './formShape.js'

// Money leaving the budget into a tracking account with a boundary category fills the category lines.
export function useBoundaryFill({ editingId, splitId, accounts, categories, accountLines, categoryLines, setCategoryLines }) {
  // Money leaving the budget into a tracking account with a boundary category pre-fills the
  // principal: that category, minus what landed on the tracking account (DESIGN.md § Accounts →
  // Money crossing the budget boundary). If the budget movement is bigger, a second line carries
  // the difference with no category: nothing is guessed. Money coming in pre-fills nothing.
  // Filled once per form, then only follows the account lines while still untouched.
  const boundaryFill = useRef({ filled: false, lines: null })
  useEffect(() => {
    if (editingId != null || splitId || !accounts || !categories) return
    let movement = 0
    let landed = 0
    let boundaryId = null
    for (const line of accountLines) {
      const account = accounts.find((a) => String(a.id) === line.account_id)
      const cents = parseCents(line.cents)
      if (!account || cents === null) continue
      if (account.on_budget) movement += cents
      else if (account.boundary_category_id != null && (boundaryId === null || boundaryId === account.boundary_category_id)) {
        boundaryId = account.boundary_category_id
        landed += cents
      }
    }
    if (boundaryId === null || movement >= 0 || landed <= 0 || !categories.some((c) => c.id === boundaryId)) return
    const principal = Math.max(movement, -landed)
    const remainder = movement - principal
    const fill = [{ category_id: String(boundaryId), cents: String(principal / 100) }]
    if (remainder !== 0) fill.push({ category_id: '', cents: String(remainder / 100) })
    const same = (a, b) => a.length === b.length && a.every((l, i) => l.category_id === b[i].category_id && l.cents === b[i].cents)
    const last = boundaryFill.current.lines
    const untouched = last && same(categoryLines, last)
    const blank = !boundaryFill.current.filled && categoryLines.every((l) => !l.category_id && !l.cents)
    if (!untouched && !blank) return
    if (untouched && same(last, fill)) return
    boundaryFill.current = { filled: true, lines: fill }
    setCategoryLines(fill.map((f) => ({ ...emptyCategoryLine, ...f })))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fill only when the boundary inputs change, never on every typed line
  }, [accountLines, accounts, categories])

  return boundaryFill
}
