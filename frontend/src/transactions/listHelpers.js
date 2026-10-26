export const COLLAPSED_KEY = 'transactions.collapsed'
export const DEFAULT_SORT = { key: 'date', dir: 'desc' }
export const NO_FILTERS = { search: '', account: '', category: '', payee: '', domain: '', need: '' }

export const marked = (list) => (list ?? []).map((e) => ({ id: e.id, name: e.archived_on ? `${e.name} (archived)` : e.name }))

// Every active facet must hold (DESIGN.md § UI conventions). Category is that exact category, never its
// descendants; domain and need level are the category's as it is now.
export function matches(t, f, categoriesAll, payeesAll) {
  if (f.account && !t.account_lines.some((l) => String(l.account_id) === f.account)) return false
  if (f.category && !t.category_lines.some((l) => String(l.category_id) === f.category)) return false
  if (f.payee && String(t.payee_id) !== f.payee) return false
  if (f.domain || f.need) {
    const cats = t.category_lines.map((l) => categoriesAll?.find((c) => c.id === l.category_id))
    if (f.domain && !cats.some((c) => c && String(c.domain_id) === f.domain)) return false
    if (f.need && !cats.some((c) => c && c.need_level === f.need)) return false
  }
  const needle = f.search.trim().toLowerCase()
  if (needle) {
    const payee = t.payee_id == null ? '' : (payeesAll?.find((p) => p.id === t.payee_id)?.name ?? '')
    if (!`${t.memo ?? ''}\n${payee}`.toLowerCase().includes(needle)) return false
  }
  return true
}

// Which months are collapsed is a per-device convenience (DESIGN.md § Nested and grouped lists):
// localStorage, and the page works without it.
export function loadCollapsed() {
  try {
    const keys = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return Array.isArray(keys) ? keys : []
  } catch {
    return []
  }
}
