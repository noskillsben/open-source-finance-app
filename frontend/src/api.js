// Every fetch in the app goes through request(). It surfaces the backend's `detail` on any non-OK response,
// so a carefully worded 4xx message actually reaches the screen.
export async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
    } catch { /* not JSON */ }
    throw new Error(detail)
  }
  return res.status === 204 ? null : res.json()
}

function listPath(base, asOf, includeArchived) {
  const params = new URLSearchParams()
  if (asOf) params.set('as_of', asOf)
  if (includeArchived) params.set('include_archived', 'true')
  const query = params.toString()
  return query ? `${base}?${query}` : base
}

export const api = {
  health: () => request('/api/health'),
  accounts: {
    list: (asOf, includeArchived = false) => {
      const params = new URLSearchParams()
      if (asOf) params.set('as_of', asOf)
      if (includeArchived) params.set('include_archived', 'true')
      const query = params.toString()
      return request(query ? `/api/accounts?${query}` : '/api/accounts')
    },
    create: (account) => request('/api/accounts', { method: 'POST', body: account }),
    update: (id, account) => request(`/api/accounts/${id}`, { method: 'PUT', body: account }),
    checkBalance: (id, check) => request(`/api/accounts/${id}/balance-check`, { method: 'POST', body: check }),
    checkBalancePreview: (id, date, statedCents) =>
      request(`/api/accounts/${id}/balance-check-preview?date=${date}&stated_balance_cents=${statedCents}`),
    archive: (id, archivedOn) => request(`/api/accounts/${id}/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
    unarchive: (id) => request(`/api/accounts/${id}/unarchive`, { method: 'POST' }),
  },
  valuations: {
    remove: (id) => request(`/api/valuations/${id}`, { method: 'DELETE' }),
  },
  categories: {
    list: (asOf, includeArchived = false) => request(listPath('/api/categories', asOf, includeArchived)),
    create: (category) => request('/api/categories', { method: 'POST', body: category }),
    update: (id, category) => request(`/api/categories/${id}`, { method: 'PUT', body: category }),
    setLinkedAccounts: (id, on, accountIds) =>
      request(`/api/categories/${id}/linked-accounts`, { method: 'PUT', body: { on, account_ids: accountIds } }),
    archive: (id, archivedOn) => request(`/api/categories/${id}/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
    unarchive: (id) => request(`/api/categories/${id}/unarchive`, { method: 'POST' }),
  },
  goals: {
    list: (asOf) => request(`/api/goals?as_of=${asOf}`),
    set: (categoryId, goal) => request(`/api/categories/${categoryId}/goal`, { method: 'PUT', body: goal }),
    archive: (categoryId, archivedOn) => request(`/api/categories/${categoryId}/goal/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
  },
  readyToAssign: (asOf) => request(`/api/ready-to-assign?as_of=${asOf}`),
  earmarkMoves: {
    create: (move) => request('/api/earmark-moves', { method: 'POST', body: move }),
  },
  domains: {
    list: (asOf, includeArchived = false) => request(listPath('/api/domains', asOf, includeArchived)),
    create: (domain) => request('/api/domains', { method: 'POST', body: domain }),
    update: (id, domain) => request(`/api/domains/${id}`, { method: 'PUT', body: domain }),
    archive: (id, archivedOn) => request(`/api/domains/${id}/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
    unarchive: (id) => request(`/api/domains/${id}/unarchive`, { method: 'POST' }),
  },
  payees: {
    list: (asOf, includeArchived = false) => request(listPath('/api/payees', asOf, includeArchived)),
    create: (payee) => request('/api/payees', { method: 'POST', body: payee }),
    archive: (id, archivedOn) => request(`/api/payees/${id}/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
    unarchive: (id) => request(`/api/payees/${id}/unarchive`, { method: 'POST' }),
  },
  incomeStreams: {
    list: (asOf, includeArchived = false) => request(listPath('/api/income-streams', asOf, includeArchived)),
    create: (stream) => request('/api/income-streams', { method: 'POST', body: stream }),
    update: (id, stream) => request(`/api/income-streams/${id}`, { method: 'PUT', body: stream }),
    archive: (id, archivedOn) => request(`/api/income-streams/${id}/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
    unarchive: (id) => request(`/api/income-streams/${id}/unarchive`, { method: 'POST' }),
  },
  transactions: {
    list: () => request('/api/transactions'),
    create: (transaction) => request('/api/transactions', { method: 'POST', body: transaction }),
    update: (id, transaction) => request(`/api/transactions/${id}`, { method: 'PUT', body: transaction }),
    remove: (id) => request(`/api/transactions/${id}`, { method: 'DELETE' }),
    reSave: (id) => request(`/api/transactions/${id}/re-save`, { method: 'POST' }),
  },
  integrityCheck: {
    list: () => request('/api/integrity-check'),
  },
}
