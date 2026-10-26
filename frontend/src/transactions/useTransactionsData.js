import { useEffect, useState } from 'react'
import { api } from '../api.js'

// The ledger's lists and their loading (DESIGN.md § General concepts): one refresh reloads them all.
export function useTransactionsData(pickerDate) {
  const [accounts, setAccounts] = useState(null)
  const [categories, setCategories] = useState(null)
  const [payees, setPayees] = useState(null)
  const [transactions, setTransactions] = useState(null)
  const [goals, setGoals] = useState(null)
  const [goalsFailed, setGoalsFailed] = useState(false)
  const [namesFailed, setNamesFailed] = useState({}) // which ledger name lists failed to load
  const [error, setError] = useState(null)
  // Ledger rows can name an archived entity (DESIGN.md § General concepts): these "all" lists
  // include archived rows and feed only the ledger table's name lookups, never the form pickers.
  const [accountsAll, setAccountsAll] = useState(null)
  const [categoriesAll, setCategoriesAll] = useState(null)
  const [payeesAll, setPayeesAll] = useState(null)
  const [goalsAll, setGoalsAll] = useState(null)
  const [splitsAll, setSplitsAll] = useState(null)
  const [domainsAll, setDomainsAll] = useState(null)

  function refresh() {
    api.accounts.list().then(setAccounts).catch((e) => setError(e.message))
    api.categories.list(pickerDate).then(setCategories).catch((e) => setError(e.message))
    api.payees.list(pickerDate).then(setPayees).catch((e) => setError(e.message))
    api.transactions.list().then(setTransactions).catch((e) => setError(e.message))
    api.goals.list(pickerDate).then(setGoals).catch((e) => {
      setGoalsFailed(true)
      setError(e.message)
    })
    api.accounts.list(undefined, true).then(setAccountsAll).catch((e) => {
      setNamesFailed((f) => ({ ...f, accounts: true }))
      setError(e.message)
    })
    api.categories.list(undefined, true).then(setCategoriesAll).catch((e) => {
      setNamesFailed((f) => ({ ...f, categories: true }))
      setError(e.message)
    })
    api.payees.list(undefined, true).then(setPayeesAll).catch((e) => {
      setNamesFailed((f) => ({ ...f, payees: true }))
      setError(e.message)
    })
    api.goals.list(pickerDate, true, true).then(setGoalsAll).catch((e) => {
      setNamesFailed((f) => ({ ...f, goals: true }))
      setError(e.message)
    })
    api.splits.list(undefined, true).then(setSplitsAll).catch((e) => {
      setNamesFailed((f) => ({ ...f, splits: true }))
      setError(e.message)
    })
    api.domains.list(undefined, true).then(setDomainsAll).catch((e) => setError(e.message))
  }

  useEffect(refresh, [pickerDate])

  return {
    accounts, categories, payees, setPayees, transactions, goals, goalsFailed, namesFailed, error,
    accountsAll, categoriesAll, payeesAll, goalsAll, splitsAll, domainsAll, refresh,
  }
}
