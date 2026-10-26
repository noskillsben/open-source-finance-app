import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import FilterPicker from '../components/FilterPicker.jsx'
import ListFilters from '../components/ListFilters.jsx'
import LoadingRows from '../components/LoadingRows.jsx'
import { SaveNote, WarningNote } from '../components/Notes.jsx'
import LedgerTable, { groupByMonth } from '../LedgerTable.jsx'
import { NEED_LEVELS } from '../utils/order.js'
import { DEFAULT_SORT, marked } from './listHelpers.js'

// The list view: filters, the collapse-all controls and the ledger table. The table markup lives in
// LedgerTable, so the list can be swapped for the shared list without touching the form.
export default function TransactionListView({ data, list, form }) {
  const { error, transactions, accountsAll, categoriesAll, payeesAll, goalsAll, splitsAll, domainsAll, namesFailed } = data
  const { filters, setFilter, clearFilters, clearShows, filtered, sort, toggleSort, collapsed, setCollapsed, shown } = list
  const { savedNote, predatesCheckNotes, openAdd, highlightId, editTransaction } = form

  return (
    <div className="space-y-6 py-4">
      <h2 className="page-title hidden md:block">Transactions</h2>

      <section className="card space-y-3">
        {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
        {savedNote && <SaveNote>{savedNote}</SaveNote>}
        {predatesCheckNotes.map((note, i) => (
          <WarningNote key={i}>{note}</WarningNote>
        ))}
        {!error && !transactions && <LoadingRows />}
        {transactions && transactions.length === 0 && (
          <EmptyState action={<Button onClick={openAdd}>Record a transaction</Button>}>No transactions yet.</EmptyState>
        )}
        {transactions && transactions.length > 0 && (
          <ListFilters
            noun="transactions"
            search={filters.search}
            onSearch={(v) => setFilter('search', v)}
            facets={[{ name: 'need', label: 'Need level', value: filters.need, onChange: (v) => setFilter('need', v), options: NEED_LEVELS }]}
            active={clearShows}
            onClear={clearFilters}
            extraCount={['account', 'category', 'payee', 'domain'].filter((k) => filters[k] !== '').length}
            sort={sort}
            onSort={toggleSort}
            sortOptions={[{ key: 'date', label: 'Date' }, { key: 'payee', label: 'Payee' }]}
            {...(!filtered
              ? { onExpandAll: () => setCollapsed([]), onCollapseAll: () => setCollapsed(groupByMonth(transactions, DEFAULT_SORT, () => '').map((g) => g.key)) }
              : {})}
          >
            <FilterPicker label="Account" items={marked(accountsAll)} value={filters.account} onChange={(v) => setFilter('account', v)} />
            <FilterPicker label="Category" items={marked(categoriesAll)} value={filters.category} onChange={(v) => setFilter('category', v)} />
            <FilterPicker label="Payee" items={marked(payeesAll)} value={filters.payee} onChange={(v) => setFilter('payee', v)} />
            <FilterPicker label="Domain" items={marked(domainsAll)} value={filters.domain} onChange={(v) => setFilter('domain', v)} />
          </ListFilters>
        )}
        {transactions && transactions.length > 0 && shown.length === 0 && (
          <EmptyState action={<Button onClick={clearFilters}>Clear filters</Button>}>No transactions match these filters.</EmptyState>
        )}
        {transactions && shown.length > 0 && (
          <div className="overflow-x-auto">
            <LedgerTable
              allTransactions={transactions}
              transactions={shown}
              names={{ accounts: accountsAll, categories: categoriesAll, payees: payeesAll, goals: goalsAll, splits: splitsAll, failed: namesFailed }}
              onSelect={editTransaction}
              selectedId={highlightId}
              byMonth={{
                sort,
                onSort: toggleSort,
                // While filtering, every month holding a match is open; the stored list is left alone.
                collapsed: filtered ? [] : collapsed,
                onToggle: (key) => {
                  if (filtered) return
                  setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])
                },
                accountId: filters.account ? Number(filters.account) : null,
              }}
            />
          </div>
        )}
      </section>
    </div>
  )
}
