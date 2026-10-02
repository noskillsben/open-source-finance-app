import { todayIso } from './format.js'

// The header's "Show as of" date is a per-tab convenience: session storage keeps it across a
// reload, and a new tab starts on today. Never a backend setting, never in the URL.
const KEY = 'pickerDate'

function isValidIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** The remembered date for this tab, or today when nothing valid is stored or storage is blocked. */
export function loadPickerDate() {
  try {
    const stored = window.sessionStorage.getItem(KEY)
    if (isValidIso(stored)) return stored
  } catch {
    // Storage blocked: carry on with today.
  }
  return todayIso()
}

/** Remember the date for this tab. An empty or invalid value is not stored; storage errors are ignored. */
export function savePickerDate(value) {
  if (!isValidIso(value)) return
  try {
    window.sessionStorage.setItem(KEY, value)
  } catch {
    // Storage blocked: the date just won't survive a reload.
  }
}

/** Forget the remembered date, so the next load starts on today. */
export function clearPickerDate() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to clean up.
  }
}
