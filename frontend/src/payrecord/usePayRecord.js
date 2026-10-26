import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { centsToFieldText, parseCents } from '../utils/format.js'
import { correctedAccountLines, rowsToMoves } from './payHelpers.js'
import { usePayAmounts } from './usePayAmounts.js'
import { usePayData } from './usePayData.js'
import { usePayTotals } from './usePayTotals.js'

// The pay screen's state and its two writes: Record (a new pay, or the correction of a recorded one)
// and Delete. The data, the typed amounts and the totals are hooks of their own.
export function usePayRecord(pickerDate) {
  const { id } = useParams()
  const isOneOff = id === undefined
  const streamId = Number(id)
  const navigate = useNavigate()
  // The Ledger's "Re-open pay" link names the payday, since a stream's next payday rolls on past it.
  const [searchParams] = useSearchParams()
  const dateParam = searchParams.get('date')
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  const data = usePayData({ pickerDate, streamId, isOneOff, dateParam })
  const { payday, stream, existingTransaction, reopening, refreshPeriod } = data
  const amounts = usePayAmounts({ data, setFormError })
  const { deductionsOn, gross, deductions, netOnly, oneOff, removeBatchOnDelete, shortCovers, setShortCovers, archivedRows, reopenReady } = amounts
  const totals = usePayTotals({ isOneOff, data, amounts })
  const { grossCents, net, incomeCategoryId, destinationAccountId, retainRows, billRows, fundingRows, targetRows, coverRows, leftover, everythingElseMoves } = totals

  // Nothing moves until Record: a cover is a line in the pay batch, held in shortCovers.
  function coverFrom(row) {
    setFormError(null)
    const cents = Math.min(-leftover, row.availableCents)
    const already = parseCents(shortCovers[row.categoryId]) ?? 0
    setShortCovers({ ...shortCovers, [row.categoryId]: centsToFieldText(already + cents) })
  }

  async function record(e) {
    e.preventDefault()
    setFormError(null)
    if (reopening && !reopenReady) return setFormError('Still loading the recorded pay. Try again in a moment.')
    if (isOneOff) {
      if (incomeCategoryId == null) return setFormError('Pick the category this income lands in.')
      if (destinationAccountId == null) return setFormError('Pick the account this income lands in.')
    }
    if (deductionsOn) {
      if (!gross.trim()) return setFormError('Enter the gross amount.')
      for (const d of deductions) {
        const amountEmpty = String(d.amount).trim() === ''
        if (!d.category.text?.trim() && amountEmpty) continue
        if (d.category.id == null) return setFormError('Pick a category for each deduction.')
        if (amountEmpty) return setFormError(`Enter an amount for the ${d.category.text} deduction.`)
      }
    } else if (!netOnly.trim()) {
      return setFormError('Enter the net amount.')
    }
    setSaving(true)
    try {
      const categoryLines = deductionsOn
        ? [
            { category_id: incomeCategoryId, cents: grossCents },
            ...deductions
              .filter((d) => d.category.id != null && String(d.amount).trim() !== '')
              .map((d) => ({ category_id: d.category.id, cents: -parseCents(d.amount) })),
          ]
        : [{ category_id: incomeCategoryId, cents: net }]

      // A recorded pay is corrected through the ordinary update: same transaction, same date.
      // The update replaces the whole record, so memo, payee and deposits go back as they were.
      const txn = existingTransaction
        ? await api.transactions.update(existingTransaction.id, {
            date: existingTransaction.date,
            memo: existingTransaction.memo ?? null,
            payee_id: existingTransaction.payee_id ?? null,
            income_stream_id: existingTransaction.income_stream_id,
            account_lines: correctedAccountLines(existingTransaction, net),
            category_lines: categoryLines,
            deposits: existingTransaction.deposits ?? [],
          })
        : await api.transactions.create({
            date: payday,
            income_stream_id: isOneOff ? null : stream.id,
            account_lines: [{ account_id: destinationAccountId, cents: net }],
            category_lines: categoryLines,
          })

      // The whole earmark batch in one call, so a failure never leaves half of it (DESIGN.md §
      // Earmarks): income → each deduction category, income → ready to assign for the net, then
      // ready to assign → each envelope. A move against ready to assign is one line.
      const batch = []
      if (deductionsOn) {
        for (const d of deductions) {
          const cents = parseCents(d.amount)
          if (d.category.id == null || !cents) continue
          batch.push({ category_id: incomeCategoryId, cents: -cents }, { category_id: d.category.id, cents })
        }
      }
      if (net > 0) batch.push({ category_id: incomeCategoryId, cents: -net })
      const goalMoves = [...retainRows, ...billRows, ...fundingRows, ...targetRows]
        .filter((r) => r.cents > 0)
        .map((r) => ({ category_id: r.categoryId, cents: r.cents }))
      batch.push(...goalMoves, ...rowsToMoves(oneOff), ...everythingElseMoves())
      for (const r of coverRows) if (r.cents > 0) batch.push({ category_id: r.categoryId, cents: -r.cents })
      for (const r of archivedRows) batch.push(...r.lines)
      await api.payBatch.replace(txn.id, batch)

      navigate('/income')
    } catch (err) {
      setFormError(err.message)
      // For a named pay, a partial write (the transaction saved but the batch 400'd) must be
      // recognized as `existingTransaction` before the form is usable again, so Record can't be
      // resubmitted blindly into a second transaction for the same payday.
      await refreshPeriod()
    } finally {
      setSaving(false)
    }
  }

  async function deleteThisPay() {
    if (!existingTransaction) return
    if (!window.confirm('Delete this pay? This cannot be undone.')) return
    setFormError(null)
    try {
      if (removeBatchOnDelete) await api.payBatch.replace(existingTransaction.id, [])
      await api.transactions.remove(existingTransaction.id)
      navigate('/income')
    } catch (err) {
      setFormError(err.message)
    }
  }

  return { isOneOff, streamId, data, amounts, totals, formError, saving, coverFrom, record, deleteThisPay }
}
