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

export const api = {
  health: () => request('/api/health'),
  accounts: {
    list: (asOf) => request(asOf ? `/api/accounts?as_of=${asOf}` : '/api/accounts'),
    create: (account) => request('/api/accounts', { method: 'POST', body: account }),
    update: (id, account) => request(`/api/accounts/${id}`, { method: 'PUT', body: account }),
    checkBalance: (id, check) => request(`/api/accounts/${id}/balance-check`, { method: 'POST', body: check }),
  },
  categories: {
    list: () => request('/api/categories'),
    create: (category) => request('/api/categories', { method: 'POST', body: category }),
  },
  payees: {
    list: () => request('/api/payees'),
    create: (payee) => request('/api/payees', { method: 'POST', body: payee }),
  },
  transactions: {
    list: () => request('/api/transactions'),
    create: (transaction) => request('/api/transactions', { method: 'POST', body: transaction }),
    update: (id, transaction) => request(`/api/transactions/${id}`, { method: 'PUT', body: transaction }),
    remove: (id) => request(`/api/transactions/${id}`, { method: 'DELETE' }),
  },
}
