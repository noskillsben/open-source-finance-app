import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Banknote, CalendarClock, Ellipsis, Landmark, Plus, Zap, Receipt, Settings as SettingsIcon, ShieldCheck, Split, Tag, Users, Wallet,
} from 'lucide-react'
import { useFormOpen } from './components/SidePanel.jsx'

// The page-name table (DESIGN.md § UI conventions): four groups named for what you are doing, plus
// Settings below them. A group with nothing built yet still renders as a header with no items.
const GROUPS = [
  {
    name: 'Record',
    items: [
      { label: 'Quick add', to: '/quick-add', Icon: Zap },
      { label: 'Transactions', to: '/transactions', Icon: Receipt },
    ],
  },
  {
    name: 'Assign',
    items: [
      { label: 'Categories', to: '/categories', Icon: Wallet },
      { label: 'Accounts', to: '/accounts', Icon: Landmark },
      { label: 'Payees', to: '/payees', Icon: Users },
      { label: 'Domains', to: '/domains', Icon: Tag },
    ],
  },
  {
    name: 'Plan',
    items: [
      { label: 'Income', to: '/income', Icon: Banknote },
      { label: 'Due dates', to: '/due-dates', Icon: CalendarClock },
      { label: 'Split expenses', to: '/split-expenses', Icon: Split },
    ],
  },
  { name: 'Review', items: [] },
]

const SETTINGS = {
  name: 'Settings',
  items: [
    { label: 'Settings', to: '/settings', Icon: SettingsIcon, end: true },
    { label: 'Data check', to: '/settings/data-check', Icon: ShieldCheck },
  ],
}

/** The page title for the phone's top bar: the nav label of the longest matching route. */
export function titleFor(pathname) {
  const items = [...GROUPS, SETTINGS].flatMap((g) => g.items)
  const match = items
    .filter((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return match?.label ?? ''
}

function linkClass({ isActive }) {
  return `flex min-h-11 items-center gap-3 rounded-lg px-3 text-base ${
    isActive ? 'bg-raised font-medium text-accent' : 'text-text-2 hover:bg-raised'
  }`
}

function NavGroup({ group, onNavigate }) {
  return (
    <div>
      <h2 className="px-3 pb-1 pt-2 text-label uppercase text-text-3">{group.name}</h2>
      <ul>
        {group.items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className={linkClass} onClick={onNavigate}>
              <item.Icon aria-hidden="true" size={20} className="shrink-0" />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The desktop menu: a left sidebar with the group headers and Settings at its foot. */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto bg-surface p-4 md:flex">
      <p className="px-3 pb-4 text-section">Open Source Finance App</p>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-3">
        {GROUPS.map((group) => (
          <NavGroup key={group.name} group={group} />
        ))}
        <div className="mt-auto">
          <NavGroup group={SETTINGS} />
        </div>
      </nav>
    </aside>
  )
}

const barItem = 'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs'
const barLink = ({ isActive }) => `${barItem} ${isActive ? 'font-medium text-accent' : 'text-text-2'}`

/** The phone's bottom bar: Categories, Transactions, +, Due dates, More. It is pinned, clears the home
 * indicator, and is hidden while a form is open. The + opens Quick add. */
export function BottomBar({ onAdd }) {
  const [more, setMore] = useState(false)
  const formOpen = useFormOpen()
  const { pathname } = useLocation()
  if (formOpen) return null
  return (
    <>
      {more && (
        <div className="fixed inset-x-0 bottom-bar z-30 max-h-[70dvh] overflow-y-auto rounded-t-xl bg-raised p-4 md:hidden">
          <nav aria-label="More" className="space-y-1" key={pathname}>
            {[...GROUPS, SETTINGS].map((group) => (
              <NavGroup key={group.name} group={group} onNavigate={() => setMore(false)} />
            ))}
          </nav>
        </div>
      )}
      <nav
        aria-label="Bottom bar"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <NavLink to="/categories" className={barLink} onClick={() => setMore(false)}>
          <Wallet aria-hidden="true" size={24} />
          Categories
        </NavLink>
        <NavLink to="/transactions" className={barLink} onClick={() => setMore(false)}>
          <Receipt aria-hidden="true" size={24} />
          Transactions
        </NavLink>
        <div className="flex items-start justify-center">
          <button
            type="button"
            aria-label="Quick add"
            className="-mt-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent"
            onClick={() => {
              setMore(false)
              onAdd()
            }}
          >
            <Plus aria-hidden="true" size={24} />
          </button>
        </div>
        <NavLink to="/due-dates" className={barLink} onClick={() => setMore(false)}>
          <CalendarClock aria-hidden="true" size={24} />
          Due dates
        </NavLink>
        <button
          type="button"
          aria-expanded={more}
          className={`${barItem} ${more ? 'text-accent' : 'text-text-2'}`}
          onClick={() => setMore((v) => !v)}
        >
          <Ellipsis aria-hidden="true" size={24} />
          More
        </button>
      </nav>
    </>
  )
}
