import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { parseCents } from '../utils/format.js'
import { readable } from './formShape.js'

// Picking a payee fills the form from their last payment (DESIGN.md § Payees), and spending from an
// account locked to a payee pre-fills that payee (DESIGN.md § Payee-locked accounts).
export function usePayeeFill({ pickerDate, accounts, categories, payees, splitsAll, payeeId, setPayeeId, billLink, editingId, amount, accountLines, setAccountLines, categoryLines, setCategoryLines, splitId, ownPicks, chooseSplit, setFormError }) {
  // Picking a payee fills the form from their last payment (DESIGN.md § Payees): the lookup's
  // answer waits here and is applied by an effect, so it sees the form as it is now.
  const [payeeFill, setPayeeFill] = useState(null)
  const pickedPayee = useRef(null)

  // Spending from an account locked to a payee pre-fills that payee (DESIGN.md § Payee-locked
  // accounts) — only while none is chosen, and once per account per form, so clearing it sticks.
  const prefilledFor = useRef(new Set())
  function prefillLockedPayee(line) {
    const account = accounts?.find((a) => String(a.id) === line.account_id)
    const cents = parseCents(line.cents)
    if (!account || account.locked_payee_id == null || cents === null || cents >= 0) return
    if (payeeId !== null || prefilledFor.current.has(account.id)) return
    if (!payees?.some((p) => p.id === account.locked_payee_id)) return // archived: not offered
    prefilledFor.current.add(account.id)
    setPayeeId(account.locked_payee_id)
  }

  // Only the person picking a payee fills the form — never Record now, the locked-payee
  // prefill, an edit load or settle up, which set the payee some other way — and never when a
  // bill link is set or a saved transaction is open.
  async function pickPayee(id) {
    setPayeeId(id)
    pickedPayee.current = id
    setPayeeFill(null)
    if (id == null || billLink || editingId != null) return
    try {
      const fill = await api.payees.fill(id, pickerDate)
      if (pickedPayee.current === id) setPayeeFill({ payeeId: id, ...fill })
    } catch (err) {
      setFormError(err.message)
    }
  }

  // Fill only what is still empty; everything filled stays changeable and clearable.
  useEffect(() => {
    if (!payeeFill) return
    setPayeeFill(null)
    if (billLink || editingId != null || payeeId !== payeeFill.payeeId) return
    const usable = (id, list) => id != null && list?.some((x) => x.id === id)
    // An account already on another line stays there only: settle up must not get the same
    // account on both sides of the transfer.
    const accountId =
      usable(payeeFill.account_id, accounts) && !accountLines.some((l) => String(l.account_id) === String(payeeFill.account_id))
        ? String(payeeFill.account_id)
        : ''
    const categoryId = usable(payeeFill.category_id, categories) ? String(payeeFill.category_id) : ''
    const split = splitId === '' && payeeFill.split_id != null ? splitsAll?.find((s) => s.id === payeeFill.split_id) : null

    const emptyAccount = accountLines.findIndex((l) => !l.account_id)
    if (accountId && emptyAccount !== -1) {
      setAccountLines((lines) => lines.map((l, i) => (i === emptyAccount ? { ...l, account_id: accountId } : l)))
    }
    const hasCategory = categoryLines.some((l) => l.category_id)
    if (categoryId && !hasCategory) {
      const plain = !split && splitId === ''
      const typed = plain ? readable(amount) : ''
      const emptyCategory = categoryLines.findIndex((l) => !l.category_id)
      setCategoryLines(
        emptyCategory === -1
          ? [{ category_id: categoryId, cents: typed }]
          : categoryLines.map((l, i) => (i === emptyCategory ? { ...l, category_id: categoryId, cents: l.cents || typed } : l))
      )
    }
    if (split) {
      // The split's own arithmetic takes my account and the category from the picks.
      if (accountId && emptyAccount !== -1) ownPicks.current.account_id = accountId
      if (categoryId && !hasCategory) ownPicks.current.category_id = categoryId
      chooseSplit(String(split.id))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run only on the picked ids; the form lines they fill must not retrigger this
  }, [payeeFill])

  return { setPayeeFill, pickedPayee, prefilledFor, prefillLockedPayee, pickPayee }
}
