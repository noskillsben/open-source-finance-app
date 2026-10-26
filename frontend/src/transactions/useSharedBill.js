import { useRef, useState } from 'react'
import { parseCents } from '../utils/format.js'
import { basisFromSplit, linesFromBasis, receiptsForTotal, scaleBasis } from '../sharedBill.js'
import { splitSign } from './formShape.js'

// A shared bill (DESIGN.md § Splits): the split chosen, who paid, and the lines worked out from the bill total.
export function useSharedBill({ payees, splitsAll, accountLines, categoryLines, setAccountLines, setCategoryLines, amount, setAmount, setForceAccountBoxes, setForceCategoryBoxes }) {
  // A shared bill (DESIGN.md § Splits): the split chosen, who paid, the bill total, and the
  // unsigned breakdown the lines were last worked out from (null until there is a total).
  const [splitId, setSplitId] = useState('')
  const [paidById, setPaidById] = useState(null)
  const [shareBasis, setShareBasis] = useState(null)
  // The breakdown a saved bill was opened with: every new total is scaled from it, never from the
  // last result, so typing a total digit by digit lands where entering it whole would. Null for a
  // new bill, which works its shares out from the split's percentages each time.
  const [shareStart, setShareStart] = useState(null)
  // A saved shared bill whose proportions cannot be read back: its lines are left for hand
  // editing and the total is read-only. Never worked out again from the split's percentages.
  const [totalLocked, setTotalLocked] = useState(false)
  // My paying account and the category, kept across Paid by changes.
  const ownPicks = useRef({ account_id: '', category_id: '' })

  const mePayeeId = payees?.find((p) => p.is_me)?.id ?? null
  const chosenSplit = splitId ? splitsAll?.find((s) => String(s.id) === splitId) : null

  // Work the lines out from a breakdown (DESIGN.md § Splits). Every amount stays editable. Each
  // category row carries the receipt amount typed for it; my share is spread across the rows by
  // them, and a total that no longer matches them rescales them all by the same ratio.
  function fillShared(split, basis, sign, payerId, rows = categoryLines) {
    const memberAccountIds = new Set(split.members.map((m) => m.account_id))
    const ownLine = accountLines.find((l) => l.account_id && !memberAccountIds.has(Number(l.account_id)))
    if (ownLine) ownPicks.current.account_id = ownLine.account_id
    const categoryLine = rows.find((l) => l.category_id)
    if (categoryLine) ownPicks.current.category_id = categoryLine.category_id
    const cents = (text) => Math.abs(parseCents(text ?? '') ?? 0)
    let typed = rows.map((r) => cents(r.receipt))
    // Rows with no receipt yet (a plain transaction that just became a shared bill) weigh by their amounts.
    if (typed.every((c) => c === 0)) typed = rows.map((r) => cents(r.cents))
    const receipts = receiptsForTotal(basis.total, typed)
    const sourceRows = rows.length ? rows : [{ category_id: ownPicks.current.category_id }]
    const payerMember = split.members.find((m) => m.payee_id === payerId)
    const { accountLines: lines, categoryLines: cats } = linesFromBasis(basis, {
      sign,
      payerIsMe: payerId === mePayeeId,
      payerAccountId: ownPicks.current.account_id,
      payerMemberAccountId: payerMember?.account_id,
      categories: sourceRows.map((r, i) => ({
        category_id: rows.length ? r.category_id : ownPicks.current.category_id,
        receipt: rows.length ? receipts[i] : basis.total,
      })),
    })
    setShareBasis(basis)
    setAccountLines(
      lines.map((l) => ({
        account_id: String(l.account_id ?? ''),
        cents: String(l.cents / 100),
      }))
    )
    setCategoryLines(
      cats.map((l, i) => ({
        category_id: String(l.category_id ?? ''),
        // A share of 0 worked out from a typed receipt is a stated 0; only a row with no receipt stays blank.
        cents: l.cents === 0 && !(rows.length ? receipts[i] > 0 : basis.total > 0) ? '' : String(l.cents / 100),
        // The text typed in a receipt box stays as typed ("12." must not become "12").
        receipt:
          rows.length && receipts[i] === 0
            ? ''
            : rows.length && cents(rows[i].receipt) === receipts[i]
              ? rows[i].receipt
              : String((rows.length ? receipts[i] : basis.total) / 100),
      }))
    )
  }

  function chooseSplit(id) {
    setSplitId(id)
    setTotalLocked(false)
    setShareBasis(null)
    setShareStart(null)
    if (!id) {
      // The lines stay as the split left them, now as boxes of their own.
      setPaidById(null)
      setForceAccountBoxes(true)
      setForceCategoryBoxes(true)
      return
    }
    setPaidById(mePayeeId)
    // The Amount already typed becomes the Bill total.
    const typed = parseCents(amount)
    if (typed == null || typed === 0) return
    const split = splitsAll.find((s) => String(s.id) === id)
    fillShared(split, basisFromSplit(Math.abs(typed), split), splitSign(amount), mePayeeId)
  }

  // A receipt amount typed on a category row: the Bill total becomes the sum of them and every
  // share is spread again. Sign follows the Bill total, as when it is typed by hand.
  function changeReceipt(i, text) {
    const rows = categoryLines.map((l, idx) => (idx === i ? { ...l, receipt: text } : l))
    const total = rows.reduce((sum, l) => sum + Math.abs(parseCents(l.receipt) ?? 0), 0)
    if (!chosenSplit || totalLocked || total === 0) return setCategoryLines(rows)
    const sign = splitSign(amount)
    setAmount(String((-sign * total) / 100))
    const basis = (shareStart && scaleBasis(shareStart, total)) || basisFromSplit(total, chosenSplit)
    fillShared(chosenSplit, basis, sign, paidById, rows)
  }

  // The whole bill, sent only when someone other than Me paid — otherwise it is my account line.
  function sharedTotalCents() {
    if (!splitId || paidById == null || paidById === mePayeeId) return null
    const cents = parseCents(amount)
    return cents === null ? null : Math.abs(cents)
  }

  function changePaidBy(payeeId) {
    setPaidById(payeeId)
    if (!chosenSplit || !shareBasis) return
    fillShared(chosenSplit, shareBasis, splitSign(amount), payeeId)
  }

  return {
    splitId, setSplitId, paidById, setPaidById, shareBasis, setShareBasis, shareStart, setShareStart, totalLocked, setTotalLocked,
    ownPicks, mePayeeId, chosenSplit, fillShared, chooseSplit, changeReceipt, sharedTotalCents, changePaidBy,
  }
}
