import { useState } from 'react'
import Button from './components/Button.jsx'
import EmptyState from './components/EmptyState.jsx'
import GroupBy from './components/GroupBy.jsx'
import ListFilters from './components/ListFilters.jsx'
import LoadingRows from './components/LoadingRows.jsx'
import { SaveNote, WarningNote } from './components/Notes.jsx'
import SidePanel, { PanelLayout } from './components/SidePanel.jsx'
import { ON_BUDGET_TYPES, TRACKING_TYPES } from './account_types.js'
import AccountEditForm from './accounts/AccountEditForm.jsx'
import AccountsTable from './accounts/AccountsTable.jsx'
import ArchiveForm from './accounts/ArchiveForm.jsx'
import BalanceCheckForm from './accounts/BalanceCheckForm.jsx'
import { GROUP_OPTIONS, VALUE_TYPES } from './accounts/accountForm.js'
import { useAccountPanel } from './accounts/useAccountPanel.js'
import { useAccountsData } from './accounts/useAccountsData.js'
import { useAccountsList } from './accounts/useAccountsList.js'

export default function Accounts({ pickerDate }) {
  const [showArchived, setShowArchived] = useState(false)
  const data = useAccountsData(pickerDate, showArchived)
  const { accounts, error, payeesAll } = data
  const list = useAccountsList(accounts)
  const { filters, setFilter, clearFilters, filtersActive, filtered, groupBy, setGroupBy, setCollapsed, groupedRows, hasRows } = list
  const panel = useAccountPanel({ pickerDate, data })
  const {
    check, archive, editingId, adding, focusKey, savedNote, highlightId, startAdd, closePanel, editAccount,
    startCheck, startArchive, selectedId, panelOpen, selectedAccount,
  } = panel

  const checkingTitle = VALUE_TYPES.includes(selectedAccount?.type) ? 'Update value' : 'Check balance'
  const panelTitle = adding
    ? 'Add an account'
    : editingId
      ? `Edit · ${selectedAccount?.name ?? ''}`
      : check.checkingId
        ? `${checkingTitle} · ${selectedAccount?.name ?? ''}`
        : `Archive · ${selectedAccount?.name ?? ''}`

  const panelForm = adding || editingId
    ? <AccountEditForm data={data} panel={panel} />
    : check.checkingId
      ? <BalanceCheckForm categories={data.categories} check={check} closePanel={closePanel} />
      : <ArchiveForm archive={archive} closePanel={closePanel} />
  const sidePanel = panelOpen && (
    <SidePanel title={panelTitle} onClose={closePanel} focusKey={focusKey}>
      {panelForm}
    </SidePanel>
  )

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title hidden md:block">Accounts</h2>
        <Button className="ml-auto" onClick={startAdd}>Add an account</Button>
      </div>

      <PanelLayout panel={sidePanel}>
        <section className="card space-y-3">
          {error && <WarningNote>Could not reach the backend: {error}</WarningNote>}
          {check.undoError && <WarningNote>{check.undoError}</WarningNote>}
          {archive.rowError && <WarningNote>{archive.rowError}</WarningNote>}
          {savedNote && <SaveNote>{savedNote}</SaveNote>}
          <ListFilters
            noun="accounts"
            search={filters.search}
            onSearch={(v) => setFilter('search', v)}
            active={filtersActive || groupBy !== 'side'}
            onClear={() => {
              clearFilters()
              setGroupBy('side')
            }}
            facets={[
              { name: 'type', label: 'Type', value: filters.type, onChange: (v) => setFilter('type', v), options: [...ON_BUDGET_TYPES, ...TRACKING_TYPES].map((t) => ({ value: t, label: t })) },
              { name: 'side', label: 'Side', value: filters.side, onChange: (v) => setFilter('side', v), options: [{ value: 'on', label: 'On-budget' }, { value: 'off', label: 'Tracking' }] },
            ]}
          >
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
            <GroupBy value={groupBy} onChange={setGroupBy} options={GROUP_OPTIONS} />
            {hasRows && !filtered && (
              <div className="flex">
                <Button variant="quiet" onClick={() => setCollapsed([])}>Expand all</Button>
                <Button variant="quiet" onClick={() => setCollapsed(groupedRows.map((g) => g.key))}>Collapse all</Button>
              </div>
            )}
          </ListFilters>
          {!error && !accounts && <LoadingRows />}
          {accounts && accounts.length === 0 && (
            <EmptyState action={<Button variant="secondary" onClick={startAdd}>Add an account</Button>}>
              No accounts yet.
            </EmptyState>
          )}
          {accounts && accounts.length > 0 && !hasRows && (
            <p className="text-text-2">No accounts match these filters.</p>
          )}
          {accounts && accounts.length > 0 && hasRows && (
            <AccountsTable
              list={list}
              payeesAll={payeesAll}
              selectedId={selectedId}
              highlightId={highlightId}
              editAccount={editAccount}
              startCheck={startCheck}
              startArchive={startArchive}
              unarchiveAccount={archive.unarchiveAccount}
              undoCheck={check.undoCheck}
            />
          )}
        </section>
      </PanelLayout>
    </div>
  )
}
