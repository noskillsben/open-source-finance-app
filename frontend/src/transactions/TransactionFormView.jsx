import { ArrowLeft } from 'lucide-react'
import ChoicePicker from '../components/ChoicePicker.jsx'
import MoneyInput from '../components/MoneyInput.jsx'
import { RefusalNote } from '../components/Notes.jsx'
import PayeePicker from '../PayeePicker.jsx'
import { BillLinkNote, DeleteConfirm, EnvelopeRows, RefundRows } from './TransactionFormParts.jsx'

// The Record / Edit form, shown in place of the list (DESIGN.md § Visual design → Where forms open).
export default function TransactionFormView({ form }) {
  const {
    accounts, categories, payees, goals, goalsFailed, splitsAll, date, setDate, memo, setMemo, payeeId, formKey,
    accountLines, categoryLines, amount, deposits, setDeposits, depositsTouched, billLink, setBillLink, setDeclinedBills,
    newCategoryName, setNewCategoryName, formError, setFormError, dateRef, editingId, deleteConfirm, setDeleteConfirm,
    linkedNet, offeredBill, offeredGoalId, offeredDue, dueOptions, dueOptionValues, envelopes, depositTotal,
    splitId, paidById, totalLocked, mePayeeId, chosenSplit, accountBoxes, categoryBoxes, formTitle,
    closeForm, submit, addCategory, openDeleteConfirm, confirmDelete, addPayee, pickPayee, changeAmount, chooseSplit,
    changePaidBy, changeReceipt, updateAccountLine, updateCategoryLine, updateDeposit, addAccountLine, addCategoryLine,
    removeAccountLine, removeCategoryLine, refundOffers, updateRefund,
  } = form

  return (
    <div className="space-y-4 py-4">
      <button type="button" className="btn btn-quiet" onClick={closeForm}>
        <ArrowLeft aria-hidden="true" size={20} />
        Transactions
      </button>

      <section className="card space-y-4">
        <h2 className="text-section">{formTitle}</h2>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="field-label">Date</span>
            <input
              ref={dateRef}
              type="date"
              className="w-full field"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="field-label">Memo</span>
            <input
              className="w-full field"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="field-label">Payee (who it went to or came from — optional)</span>
            <PayeePicker
              key={formKey}
              payees={payees}
              payeeId={payeeId}
              onSelect={pickPayee}
              onAdd={addPayee}
              onError={setFormError}
            />
          </label>

          <MoneyInput
            signed
            label="Amount"
            value={amount}
            readOnly={totalLocked}
            onChange={changeAmount}
          />

          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="field-label">Split (a shared bill — optional)</span>
              <select
                className="w-full field"
                aria-label="Split"
                value={splitId}
                onChange={(e) => chooseSplit(e.target.value)}
              >
                <option value="">No split</option>
                {[...(splitsAll ?? [])]
                  .filter((s) => !s.archived_on || String(s.id) === splitId)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.archived_on ? ' (archived)' : ''}</option>
                  ))}
              </select>
            </label>
            {chosenSplit && (
              <div className="flex flex-wrap gap-2">
                <label className="space-y-1">
                  <span className="field-label">Paid by</span>
                  <select
                    className="block field"
                    aria-label="Paid by"
                    value={paidById ?? ''}
                    onChange={(e) => changePaidBy(Number(e.target.value))}
                  >
                    {mePayeeId != null && <option value={mePayeeId}>Me</option>}
                    {[...chosenSplit.members].sort((a, b) => a.payee_name.localeCompare(b.payee_name)).map((m) => (
                      <option key={m.payee_id} value={m.payee_id}>{m.payee_name}</option>
                    ))}
                  </select>
                </label>
                {totalLocked && (
                  <p className="basis-full text-sm text-text-3">
                    This bill no longer matches its split, so change the amounts below by hand.
                  </p>
                )}
                <p className="basis-full text-sm text-text-3">
                  Only your share is spending. Every amount below can still be changed before you save.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <span className="field-label">Account lines (which accounts this touched)</span>
            {accountLines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="min-w-40 flex-1">
                  <ChoicePicker
                    items={accounts ?? []}
                    value={line.account_id}
                    onChange={(id) => updateAccountLine(i, 'account_id', id)}
                    placeholder="Select account…"
                    ariaLabel="Account"
                  />
                </div>
                {accountBoxes && (
                  <MoneyInput signed aria-label="Account amount" value={line.cents} onChange={(text) => updateAccountLine(i, 'cents', text)} />
                )}
                {accountLines.length > 1 && (
                  <button type="button" className="btn btn-quiet" aria-label="Remove account line" onClick={() => removeAccountLine(i)}>
                    remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-quiet" onClick={addAccountLine}>
              + add account line
            </button>
          </div>

          <div className="space-y-2">
            <span className="field-label">Category lines (what it was for — leave empty for unassigned)</span>
            {categoryLines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="min-w-40 flex-1">
                  <ChoicePicker
                    items={categories ?? []}
                    value={line.category_id}
                    onChange={(id) => updateCategoryLine(i, 'category_id', id)}
                    placeholder="Select category…"
                    ariaLabel="Category"
                  />
                </div>
                {chosenSplit && !totalLocked && (
                  <MoneyInput
                    placeholder="Receipt"
                    aria-label="Receipt amount"
                    value={line.receipt ?? ''}
                    onChange={(text) => changeReceipt(i, text)}
                  />
                )}
                {categoryBoxes && (
                  <MoneyInput
                    signed
                    aria-label={chosenSplit && !totalLocked ? 'Your share' : 'Category amount'}
                    value={line.cents}
                    onChange={(text) => updateCategoryLine(i, 'cents', text)}
                  />
                )}
                <button type="button" className="btn btn-quiet" aria-label="Remove category line" onClick={() => removeCategoryLine(i)}>
                  remove
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-quiet" onClick={addCategoryLine}>
              + add category line
            </button>
          </div>

          {(offeredBill || billLink) && (
            <BillLinkNote
              billLink={billLink}
              setBillLink={setBillLink}
              setDeclinedBills={setDeclinedBills}
              offeredBill={offeredBill}
              offeredGoalId={offeredGoalId}
              offeredDue={offeredDue}
              dueOptions={dueOptions}
              dueOptionValues={dueOptionValues}
              goals={goals}
              goalsFailed={goalsFailed}
            />
          )}

          {linkedNet !== 0 && (
            <EnvelopeRows
              linkedNet={linkedNet}
              deposits={deposits}
              setDeposits={setDeposits}
              depositsTouched={depositsTouched}
              updateDeposit={updateDeposit}
              envelopes={envelopes}
              categories={categories}
              depositTotal={depositTotal}
            />
          )}

          {refundOffers.length > 0 && (
            <RefundRows refundOffers={refundOffers} updateRefund={updateRefund} categories={categories} />
          )}

          {formError && <RefusalNote>{formError}</RefusalNote>}

          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Save changes' : 'Record transaction'}
            </button>
            {editingId && (
              <>
                <button type="button" className="btn btn-secondary" onClick={closeForm}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-destructive"
                  onClick={openDeleteConfirm}
                >
                  Delete
                </button>
              </>
            )}
          </div>
          {deleteConfirm && (
            <DeleteConfirm deleteConfirm={deleteConfirm} setDeleteConfirm={setDeleteConfirm} confirmDelete={confirmDelete} />
          )}
        </form>

        <form className="flex gap-2 pt-2" onSubmit={addCategory}>
          <input
            className="flex-1 field text-sm"
            placeholder="New category name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            Add category
          </button>
        </form>
      </section>
    </div>
  )
}
