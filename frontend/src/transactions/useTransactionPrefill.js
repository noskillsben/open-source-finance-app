import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { centsToFieldText } from '../utils/format.js'
import { emptyCategoryLine } from './formShape.js'

// Other pages open the Record form with route state: the shell's + Add transaction, a bill's Record
// link, Quick add's More details, and Settle up. Each is applied once and then cleared from the route.
export function useTransactionPrefill({ pickerDate, openAdd, setFormOpen, setDate, setMemo, showLines, setBillLink, setPayeeId, setAccountLines, setFormError, pickedPayee, pickPayee }) {
  const location = useLocation()
  const navigate = useNavigate()

  // The shell's + Add transaction lands here: a blank form, even if the list's own form was open.
  const addTransaction = location.state?.addTransaction
  useEffect(() => {
    if (!addTransaction) return
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
    openAdd()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the navigation state arrives; later renders must not reopen a blank form
  }, [addTransaction])

  // "Record" on a bill's row on Categories lands here with the bill, its due date and its expected
  // amount in route state (DESIGN.md § Paying a bill): the form opens pre-filled and already linked,
  // with the payee and account of the bill's last linked payment. The user still saves it.
  const recordBill = location.state?.recordBill
  useEffect(() => {
    if (!recordBill) return
    setFormOpen(true)
    const cents = recordBill.amount_cents == null ? '' : centsToFieldText(-recordBill.amount_cents)
    setDate(pickerDate)
    showLines([{ account_id: '', cents }], [{ ...emptyCategoryLine, category_id: String(recordBill.category_id), cents }])
    setBillLink({ goal_id: recordBill.goal_id, goal_due_on: recordBill.goal_due_on })
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
    Promise.all([api.goals.lastPayment(recordBill.goal_id), api.accounts.list()])
      .then(([last, accountList]) => {
        if (last.payee_id != null) setPayeeId(last.payee_id)
        if (last.account_id != null && accountList.some((a) => a.id === last.account_id)) {
          setAccountLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, account_id: String(last.account_id) } : l)))
        }
      })
      .catch((e) => setFormError(e.message))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the navigation state arrives; later renders must not re-prefill the form
  }, [recordBill])

  // Quick add's "More details" lands here with everything typed (DESIGN.md § Quick add): the date,
  // payee, signed amount, account, category and any bill the person said yes to. A payee whose last
  // payment was a shared bill is picked the ordinary way, so the form fills the split itself.
  const quickAdd = location.state?.quickAdd
  useEffect(() => {
    if (!quickAdd) return
    setFormOpen(true)
    setDate(quickAdd.date)
    setMemo(quickAdd.memo || '')
    showLines(
      [{ account_id: quickAdd.account_id != null ? String(quickAdd.account_id) : '', cents: quickAdd.amount_text }],
      quickAdd.category_id != null ? [{ ...emptyCategoryLine, category_id: String(quickAdd.category_id), cents: quickAdd.amount_text }] : []
    )
    if (quickAdd.goal) setBillLink(quickAdd.goal)
    if (quickAdd.payee_id != null) {
      setPayeeId(quickAdd.payee_id)
      pickedPayee.current = quickAdd.payee_id
      if (quickAdd.refill) pickPayee(quickAdd.payee_id)
    }
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the quick-add state arrives; later renders must not wipe typed input
  }, [quickAdd])

  // "Settle up" on the Split expenses page lands here with their account and the signed cents to put on it
  // (DESIGN.md § Splits): a plain transfer, no category, my account left for the user to pick. The
  // amount is editable and the user still saves it.
  const settleUp = location.state?.settleUp
  useEffect(() => {
    if (!settleUp) return
    setFormOpen(true)
    const theirs = String(settleUp.cents / 100)
    const mine = String(-settleUp.cents / 100)
    setDate(pickerDate)
    showLines([{ account_id: String(settleUp.account_id), cents: theirs }, { account_id: '', cents: mine }], [])
    navigate(location.pathname, { replace: true, state: null }) // a reload must not re-apply it
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the settle-up state arrives; later renders must not wipe typed input
  }, [settleUp])
}
