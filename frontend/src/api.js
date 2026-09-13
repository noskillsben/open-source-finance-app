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
}
