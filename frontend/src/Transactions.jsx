import { useTransactionsData } from './transactions/useTransactionsData.js'
import { useTransactionList } from './transactions/useTransactionList.js'
import { useTransactionForm } from './transactions/useTransactionForm.js'
import TransactionListView from './transactions/TransactionListView.jsx'
import TransactionFormView from './transactions/TransactionFormView.jsx'

// The ledger page: the list, or in its place the Record / Edit form while one is open. The state lives
// in the hooks under ./transactions, so the list view can change without touching the form.
export default function Transactions({ pickerDate }) {
  const data = useTransactionsData(pickerDate)
  const list = useTransactionList(data)
  const form = useTransactionForm({ pickerDate, data, collapsed: list.collapsed, setCollapsed: list.setCollapsed })

  if (!form.formOpen) return <TransactionListView data={data} list={list} form={form} />
  return <TransactionFormView form={form} />
}
