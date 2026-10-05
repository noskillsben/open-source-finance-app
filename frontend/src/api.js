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
    list: (asOf, includeArchived = false, anyDate = false) =>
      request(listPath('/api/goals', asOf, includeArchived) + (anyDate ? (asOf || includeArchived ? '&' : '?') + 'any_date=true' : '')),
    dueDates: (goalId) => request(`/api/goals/${goalId}/due-dates`),
    lastPayment: (goalId) => request(`/api/goals/${goalId}/last-payment`),
    set: (categoryId, goal) => request(`/api/categories/${categoryId}/goal`, { method: 'PUT', body: goal }),
    archive: (categoryId, archivedOn) => request(`/api/categories/${categoryId}/goal/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
  },
  readyToAssign: (asOf) => request(`/api/ready-to-assign?as_of=${asOf}`),
  earmarkMoves: {
    create: (move) => request('/api/earmark-moves', { method: 'POST', body: move }),
  },
  // A pay's earmark batch, saved whole: `replace` states every line and replaces whatever was
  // there; an empty list removes it (DESIGN.md § Earmarks).
  payBatch: {
    get: (transactionId) => request(`/api/transactions/${transactionId}/pay-batch`),
    replace: (transactionId, lines) =>
      request(`/api/transactions/${transactionId}/pay-batch`, { method: 'PUT', body: { lines } }),
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
    fill: (id, asOf) => request(`/api/payees/${id}/fill?as_of=${asOf}`),
    archive: (id, archivedOn) => request(`/api/payees/${id}/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
    unarchive: (id) => request(`/api/payees/${id}/unarchive`, { method: 'POST' }),
  },
  splits: {
    list: (asOf, includeArchived = false) => request(listPath('/api/splits', asOf, includeArchived)),
    create: (split) => request('/api/splits', { method: 'POST', body: split }),
    update: (id, split) => request(`/api/splits/${id}`, { method: 'PUT', body: split }),
    archive: (id, archivedOn) => request(`/api/splits/${id}/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
    unarchive: (id) => request(`/api/splits/${id}/unarchive`, { method: 'POST' }),
    // A member account's balance at the picker date and what built it since it last stood at zero.
    balance: (accountId, asOf) =>
      request(`/api/splits/accounts/${accountId}/balance${asOf ? `?as_of=${asOf}` : ''}`),
  },
  incomeStreams: {
    list: (asOf, includeArchived = false) => request(listPath('/api/income-streams', asOf, includeArchived)),
    create: (stream) => request('/api/income-streams', { method: 'POST', body: stream }),
    update: (id, stream) => request(`/api/income-streams/${id}`, { method: 'PUT', body: stream }),
    archive: (id, archivedOn) => request(`/api/income-streams/${id}/archive`, { method: 'POST', body: { archived_on: archivedOn } }),
    unarchive: (id) => request(`/api/income-streams/${id}/unarchive`, { method: 'POST' }),
  },
  // The pay screen's facts for one payday; no income stream id is a one-off.
  payPeriod: (payday, incomeStreamId) => {
    const params = new URLSearchParams({ payday })
    if (incomeStreamId != null) params.set('income_stream_id', incomeStreamId)
    return request(`/api/pay-period?${params}`)
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
