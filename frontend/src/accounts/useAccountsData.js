import { useEffect, useState } from 'react'
import { api } from '../api.js'

// The accounts page's lists and their loading: one refresh reloads them all.
export function useAccountsData(pickerDate, showArchived) {
  const [accounts, setAccounts] = useState(null)
  const [categories, setCategories] = useState(null)
  const [payees, setPayees] = useState(null) // not archived at the picker date: the lock picker's choices
  const [payeesAll, setPayeesAll] = useState(null) // names for a lock on a payee archived since
  const [error, setError] = useState(null)

  function refresh() {
    api.accounts.list(pickerDate, showArchived).then(setAccounts).catch((e) => setError(e.message))
    api.categories.list().then(setCategories).catch((e) => setError(e.message))
    api.payees.list(pickerDate).then(setPayees).catch((e) => setError(e.message))
    api.payees.list(undefined, true).then(setPayeesAll).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate, showArchived])

  return { accounts, categories, payees, setPayees, payeesAll, error, refresh }
}
