import { useState } from 'react'
import { NavLink } from 'react-router-dom'

// The page-name table (DESIGN.md § UI conventions): four groups named for what you are doing, plus
// Settings below them. A group with nothing built yet still renders as a header with no items.
const GROUPS = [
  { name: 'Record', items: [{ label: 'Ledger', to: '/ledger' }] },
  {
    name: 'Assign',
    items: [
      { label: 'Categories', to: '/categories' },
      { label: 'Accounts', to: '/accounts' },
      { label: 'Payees', to: '/payees' },
      { label: 'Domains', to: '/domains' },
    ],
  },
  { name: 'Plan', items: [] },
  { name: 'Review', items: [] },
]

const SETTINGS = { name: 'Settings', items: [{ label: 'Data check', to: '/settings/data-check' }] }

function linkClass({ isActive }) {
  return `block rounded px-2 py-1 text-sm ${isActive ? 'bg-ink-soft font-medium' : 'text-paper-soft hover:bg-ink-soft'}`
}

function NavGroup({ group, onNavigate }) {
  return (
    <div>
      <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-paper-soft">{group.name}</h2>
      <ul>
        {group.items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} className={linkClass} onClick={onNavigate}>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Nav() {
  const [open, setOpen] = useState(false)

  const menu = (
    <nav aria-label="Main" className="space-y-4">
      {GROUPS.map((group) => (
        <NavGroup key={group.name} group={group} onNavigate={() => setOpen(false)} />
      ))}
      <NavGroup group={SETTINGS} onNavigate={() => setOpen(false)} />
    </nav>
  )

  return (
    <div>
      <button
        type="button"
        className="rounded bg-ink-soft px-3 py-1 text-sm md:hidden"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Menu
      </button>
      <div className="hidden md:block">{menu}</div>
      {open && <div className="mt-2 md:hidden">{menu}</div>}
    </div>
  )
}
