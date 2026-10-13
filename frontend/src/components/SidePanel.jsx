import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// The shell hides its bottom bar while a form is open, so it never rides on the keyboard. Each
// open SidePanel registers itself here; without a provider (a page rendered alone) it is a no-op.
const FormOpenContext = createContext(null)

export function FormOpenProvider({ children }) {
  const [count, setCount] = useState(0)
  const register = useCallback(() => {
    setCount((c) => c + 1)
    return () => setCount((c) => c - 1)
  }, [])
  const value = useMemo(() => ({ open: count > 0, register }), [count, register])
  return <FormOpenContext.Provider value={value}>{children}</FormOpenContext.Provider>
}

export function useFormOpen() {
  return useContext(FormOpenContext)?.open ?? false
}

/** Registers a form as open while `active`, so the shell hides its bottom bar. The Transactions form
 * is inline, so it passes true while it is being edited or has focus (the keyboard is up). */
export function useRegisterFormOpen(active) {
  const ctx = useContext(FormOpenContext)
  const register = ctx?.register
  useEffect(() => (active && register ? register() : undefined), [active, register])
}

/** A page with an optional side panel at its right (DESIGN.md § Visual design → Where forms open):
 * the list stays visible beside it. On a phone the panel is full screen instead. */
export function PanelLayout({ panel, children }) {
  return (
    <div className="md:flex md:items-start md:gap-6">
      <div className="min-w-0 flex-1">{children}</div>
      {panel}
    </div>
  )
}

/** The side panel: an add or edit form for one row. It closes on cancel, Escape or ×; saving is the
 * form's business. `focusKey` returns focus to the first field whenever it changes (after an add,
 * ready for the next entry). */
export default function SidePanel({ title, onClose, focusKey = 0, children }) {
  const ref = useRef(null)
  const ctx = useContext(FormOpenContext)

  // Register once on mount; the cleanup unregisters on close.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => ctx?.register(), [])

  useEffect(() => {
    const field = ref.current?.querySelector('input:not([disabled]):not([type=checkbox]), select, textarea')
    field?.focus()
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [focusKey])

  return (
    <aside
      ref={ref}
      aria-label={title}
      className="fixed inset-0 z-40 overflow-y-auto bg-surface p-4 pb-8 md:sticky md:inset-auto md:top-4 md:z-auto md:max-h-[calc(100dvh-2rem)] md:w-[26rem] md:shrink-0 md:rounded-xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-section">{title}</h3>
        <button type="button" aria-label="Close" className="btn btn-quiet text-section" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </aside>
  )
}
