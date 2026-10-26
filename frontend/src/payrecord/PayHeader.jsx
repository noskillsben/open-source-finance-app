import { Link } from 'react-router-dom'
import NamePicker from '../NamePicker.jsx'
import { formatDate } from '../utils/format.js'

// Block 1: which pay this is, its payday and period, and for a one-off where it lands.
export default function PayHeader({ pay, periodEnd }) {
  const { isOneOff, data, amounts } = pay
  const { stream, categories, accounts, payday, setPayday, existingTransaction, reopening } = data
  const { oneOffIncomeCategory, setOneOffIncomeCategory, oneOffDestinationAccount, setOneOffDestinationAccount } = amounts

  return (
    <>
      <Link to="/income" className="btn btn-quiet px-0">← Income</Link>
      {/* 1. Header */}
      <div className="card space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="page-title hidden md:block">{isOneOff ? 'One-off income' : stream.name}</h2>
          {!isOneOff && (
            <span className="pill">
              {existingTransaction ? 'recorded' : 'upcoming'}
            </span>
          )}
        </div>
        <label className="block space-y-1">
          <span className="field-label">{isOneOff ? 'Date' : 'Payday'}</span>
          <input
            type="date"
            className="mt-1 field disabled:opacity-50"
            disabled={reopening}
            value={payday}
            onChange={(e) => setPayday(e.target.value)}
          />
        </label>
        {isOneOff ? (
          <p className="text-sm text-text-2">{formatDate(payday)}</p>
        ) : (
          <p className="text-sm text-text-2">{formatDate(payday)}{periodEnd && <> – {formatDate(periodEnd)}</>}</p>
        )}
        {isOneOff && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <NamePicker
              label="Income category"
              items={categories}
              initialId={oneOffIncomeCategory.id}
              onChange={(catId, text) => setOneOffIncomeCategory({ id: catId, text })}
            />
            <NamePicker
              label="Destination account"
              items={accounts}
              initialId={oneOffDestinationAccount.id}
              onChange={(acctId, text) => setOneOffDestinationAccount({ id: acctId, text })}
            />
          </div>
        )}
      </div>
    </>
  )
}
