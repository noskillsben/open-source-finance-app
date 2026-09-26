// History replay (DESIGN.md § Working on the app → History replay): plays a scenario file into a FRESH
// database through the same HTTP calls the screens make, then reports what the running app says.
// Development tooling — nothing in the app imports this file and it is not part of the production build.
//
// From the browser console on http://localhost:5173 (the dev server serves this folder at /replay/):
//
//   const sim = await import('/replay/replay.js')
//   await sim.setup({ scenario: '/replay/sample.json' })   // accounts, payees, categories, named pays, goals
//   await sim.run({ until: '2026-08-31' })                 // replay events up to a date (inclusive)
//   await sim.run({ stopBefore: ['pay'] })                 // ...or stop before the next pay and do it by hand
//   sim.skip()                                             // mark the event you just did by hand as done
//   await sim.report()                                     // balances vs the source, integrity check
//
// Progress (how many events are done, and which scenario) is kept in localStorage, so a run resumes where
// it stopped, even after a page reload. Everything is addressed by name and resolved to ids against this
// database at run time. See README.md for the scenario format.

const KEY = 'replay.progress'
let S = null
const ids = { accounts: {}, categories: {}, payees: {}, domains: {}, streams: {}, goals: {} }
export const log = []

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data?.detail ?? data)}`)
  return data
}

const progress = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? { scenario: null, done: 0 } } catch { return { scenario: null, done: 0 } }
}
const saveProgress = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private window */ } }

// The scenario is the one named here, else the one this page last used (remembered with the progress).
async function load(scenario) {
  const url = scenario ?? progress().scenario
  if (!url) throw new Error('no scenario yet — call setup({ scenario: "/replay/sample.json" }) first')
  if (!S || S.url !== url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`could not load scenario ${url}: ${res.status}`)
    S = { ...(await res.json()), url }
  }
  return S
}

export function reset() { saveProgress({ scenario: S?.url ?? progress().scenario, done: 0 }) }
export function skip() {
  const p = progress()
  const next = S?.events[p.done] ?? null
  saveProgress({ ...p, done: p.done + 1 })
  return next
}

const lower = (s) => s.toLowerCase()
function byName(list) {
  return Object.fromEntries(list.map((x) => [lower(x.name), x]))
}

async function resolve() {
  const end = '2099-12-31'
  ids.accounts = byName(await api(`/api/accounts?as_of=${end}&include_archived=true`))
  ids.categories = byName(await api(`/api/categories?as_of=${end}&include_archived=true`))
  ids.payees = byName(await api(`/api/payees?as_of=${end}&include_archived=true`))
  ids.domains = byName(await api(`/api/domains?as_of=${end}&include_archived=true`))
  ids.streams = byName(await api(`/api/income-streams?as_of=${end}&include_archived=true`))
  const goals = await api(`/api/goals?as_of=${end}`)
  ids.goals = Object.fromEntries(goals.map((g) => [g.goal.category_id, g.goal]))
}

function id(kind, name) {
  if (name == null) return null
  const hit = ids[kind][lower(name)]
  if (!hit) throw new Error(`no ${kind.slice(0, -1)} named ${JSON.stringify(name)}`)
  return hit.id
}

async function assertFresh(force) {
  const existing = await api('/api/transactions')
  if (existing.length && !force) throw new Error(`database already has ${existing.length} transactions — use a fresh one`)
}

const dollars = (cents) => (cents / 100).toFixed(2)

// ------------------------------------------------------------------ setup
export async function setup({ scenario, force = false } = {}) {
  await load(scenario)
  await assertFresh(force)
  const start = S.start
  const st = S.setup
  await resolve()

  for (const name of st.domains ?? []) {
    if (!ids.domains[lower(name)]) await api('/api/domains', 'POST', { name, created_on: start })
  }
  for (const name of st.payees ?? []) {
    if (!ids.payees[lower(name)]) await api('/api/payees', 'POST', { name, created_on: start })
  }
  for (const a of st.accounts ?? []) {
    if (ids.accounts[lower(a.name)]) continue
    await api('/api/accounts', 'POST', {
      name: a.name, created_on: a.created_on ?? start, type: a.type, on_budget: a.on_budget,
      on_budget_floor_cents: a.floor_cents ?? 0, opening_balance_cents: a.opening_cents ?? 0,
      terms: { credit_limit_cents: a.credit_limit_cents ?? null },
    })
  }
  await resolve()
  // In the order listed, so a pool or parent is created before the categories that name it.
  for (const c of st.categories ?? []) {
    const body = {
      name: c.name, parent_id: id('categories', c.parent), pool_id: id('categories', c.pool),
      domain_id: id('domains', c.domain), need_level: c.need_level ?? null,
    }
    const have = ids.categories[lower(c.name)]
    const saved = have
      ? await api(`/api/categories/${have.id}`, 'PUT', body) // a seeded default with the same name
      : await api('/api/categories', 'POST', { ...body, created_on: start })
    ids.categories[lower(c.name)] = saved
  }
  for (const name of st.archive_seed_categories ?? []) {
    const c = ids.categories[lower(name)]
    if (c && !c.archived_on) await api(`/api/categories/${c.id}/archive`, 'POST', { archived_on: start })
  }
  for (const name of st.archive_seed_domains ?? []) {
    const d = ids.domains[lower(name)]
    if (d && !d.archived_on) await api(`/api/domains/${d.id}/archive`, 'POST', { archived_on: start })
  }
  for (const s of st.income_streams ?? []) {
    if (ids.streams[lower(s.name)]) continue
    await api('/api/income-streams', 'POST', {
      on: start, name: s.name, payee_id: id('payees', s.payee), cadence: s.cadence, cadence_weeks: s.cadence_weeks ?? null,
      anchor_payday: s.anchor_payday, expected_gross_cents: s.expected_gross_cents ?? null,
      expected_net_low_cents: s.expected_net_low_cents, expected_net_high_cents: s.expected_net_high_cents,
      income_category_id: id('categories', s.income_category), destination_account_id: id('accounts', s.destination_account),
      deductions: (s.deductions ?? []).map((d) => ({ category_id: id('categories', d.category), amount_cents: d.amount_cents })),
    })
  }
  await resolve()
  for (const g of st.goals ?? []) {
    await api(`/api/categories/${id('categories', g.category)}/goal`, 'PUT', {
      on: start, name: g.name, kind: g.kind, amount_cents: g.amount_cents ?? null, cadence: g.cadence ?? null,
      cadence_weeks: g.cadence_weeks ?? null, target_date: g.target_date ?? null, level_cents: g.level_cents ?? null,
      income_stream_id: id('streams', g.income_stream), percent_of_net: null,
    })
  }
  await resolve()
  log.length = 0
  saveProgress({ scenario: S.url, done: 0 })
  return `setup done: ${(st.accounts ?? []).length} accounts, ${(st.categories ?? []).length} categories, ${(st.goals ?? []).length} goals`
}

// ------------------------------------------------------------------ events
function txnBody(e) {
  const body = {
    date: e.date, memo: e.memo ?? null, payee_id: id('payees', e.payee),
    account_lines: e.account_lines.map((l) => ({ account_id: id('accounts', l.account), cents: l.cents })),
    category_lines: e.category_lines.map((l) => ({ category_id: id('categories', l.category), cents: l.cents })),
  }
  if (e.bill) {
    body.goal_id = ids.goals[id('categories', e.bill.category)].id
    body.goal_due_on = e.bill.due_on
  }
  return body
}

// The pay screen's two calls (PayRecord.jsx): one transaction, then the whole batch.
function payLines(incomeCategory, gross, deductions) {
  return [
    { category_id: id('categories', incomeCategory), cents: gross },
    ...deductions.map((d) => ({ category_id: id('categories', d.category), cents: -d.amount_cents })),
  ]
}
function batchLines(incomeCategory, net, deductions, distribution) {
  const inc = id('categories', incomeCategory)
  const out = []
  for (const d of deductions) out.push({ category_id: inc, cents: -d.amount_cents }, { category_id: id('categories', d.category), cents: d.amount_cents })
  if (net > 0) out.push({ category_id: inc, cents: -net })
  // A negative amount is a cover (Short by), a positive one an assignment.
  for (const x of distribution) if (x.cents !== 0) out.push({ category_id: id('categories', x.category), cents: x.cents })
  return out
}

async function apply(e, events) {
  switch (e.kind) {
    case 'transaction': {
      const t = await api('/api/transactions', 'POST', txnBody(e))
      return t.notes
    }
    case 'move': {
      await api('/api/earmark-moves', 'POST', {
        date: e.date, cents: e.cents, from_category_id: id('categories', e.from), to_category_id: id('categories', e.to),
      })
      return []
    }
    case 'pay': {
      const deductions = e.deductions ?? []
      const gross = e.gross_cents ?? e.net_cents
      const t = await api('/api/transactions', 'POST', {
        date: e.date, memo: e.memo ?? null, payee_id: id('payees', e.payee),
        income_stream_id: e.one_off ? null : id('streams', e.income_stream),
        account_lines: [{ account_id: id('accounts', e.account), cents: e.net_cents }],
        category_lines: payLines(e.income_category, gross, deductions),
      })
      await api(`/api/transactions/${t.id}/pay-batch`, 'PUT', { lines: batchLines(e.income_category, e.net_cents, deductions, e.distribution) })
      const assigned = e.distribution.reduce((s, x) => s + x.cents, 0)
      return [...t.notes, `Left over ${dollars(e.net_cents - assigned)}`]
    }
    case 'reopen_pay': {
      // The pay it corrects is the earlier 'pay' event on `payday`; its account, income category and
      // distribution carry over, the stub's gross and deductions replace the recorded ones.
      const orig = events.find((x) => x.kind === 'pay' && x.date === e.payday && x.income_stream === e.income_stream)
      if (!orig) throw new Error(`no pay event for ${JSON.stringify(e.income_stream)} on ${e.payday} to re-open`)
      const t = (await api('/api/transactions')).find((x) => x.income_stream_id === id('streams', e.income_stream) && x.date === e.payday)
      if (!t) throw new Error(`no recorded pay for ${JSON.stringify(e.income_stream)} on ${e.payday}`)
      const deductions = e.deductions ?? []
      const net = e.gross_cents - deductions.reduce((s, d) => s + d.amount_cents, 0)
      await api(`/api/transactions/${t.id}`, 'PUT', {
        date: t.date, memo: t.memo, payee_id: t.payee_id, income_stream_id: t.income_stream_id,
        account_lines: [{ account_id: t.account_lines[0].account_id, cents: net }],
        category_lines: payLines(orig.income_category, e.gross_cents, deductions), deposits: [],
      })
      await api(`/api/transactions/${t.id}/pay-batch`, 'PUT', { lines: batchLines(orig.income_category, net, deductions, e.distribution ?? orig.distribution) })
      return [`re-opened ${e.payday}: net now ${dollars(net)}`]
    }
    case 'balance_check': {
      const r = await api(`/api/accounts/${id('accounts', e.account)}/balance-check`, 'POST', {
        date: e.date, stated_balance_cents: e.stated_cents,
      })
      // The source recorded the difference this check found; the app must find the same one.
      if (e.expected_diff_cents != null && r.diff_cents !== e.expected_diff_cents) {
        return [`MISMATCH ${e.account} ${e.date}: app found ${dollars(r.diff_cents)}, source found ${dollars(e.expected_diff_cents)}`]
      }
      return r.diff_cents ? [`adjustment ${dollars(r.diff_cents)}`] : []
    }
    default:
      throw new Error(`unknown event kind ${e.kind}`)
  }
}

export async function run({ scenario, until = '9999-12-31', stopBefore = [], max = Infinity, quiet = false } = {}) {
  await load(scenario)
  const p = progress()
  await resolve()
  let n = 0
  for (let i = p.done; i < S.events.length; i += 1) {
    const e = S.events[i]
    const label = `#${i + 1} ${e.date} ${e.kind}`
    if (e.date > until || n >= max) break
    if (stopBefore.includes(e.kind)) {
      console.log(`⏸ stopped before ${label}`, e)
      return e
    }
    try {
      const notes = await apply(e, S.events)
      log.push({ event: i + 1, date: e.date, kind: e.kind, notes })
      if (!quiet && notes?.length) console.log(`${label}:`, notes.join(' | '))
    } catch (err) {
      log.push({ event: i + 1, date: e.date, kind: e.kind, error: err.message })
      console.error(`✖ ${label}: ${err.message}`, e)
      throw err
    }
    p.done = i + 1
    saveProgress({ ...p, scenario: S.url })
    n += 1
  }
  return `replayed ${n} events; ${p.done} of ${S.events.length} done`
}

// What the running app says now, against what the source recorded. Nothing here recomputes a balance.
export async function report(scenario) {
  await load(scenario)
  const asOf = S.as_of
  const accounts = await api(`/api/accounts?as_of=${asOf}&include_archived=true`)
  const rows = Object.entries(S.expected_final_balances).map(([name, want]) => {
    const got = accounts.find((a) => lower(a.name) === lower(name))?.balance_cents
    return { account: name, app: (got ?? NaN) / 100, source: want / 100, match: got === want }
  })
  console.table(rows)
  const rta = await api(`/api/ready-to-assign?as_of=${asOf}`)
  const findings = await api('/api/integrity-check')
  const checkMismatches = log.filter((l) => l.notes?.some((n) => n.startsWith('MISMATCH')))
  const errors = log.filter((l) => l.error)
  return {
    asOf,
    allMatch: rows.every((r) => r.match) && !checkMismatches.length,
    readyToAssign: rta.ready_to_assign_cents / 100,
    overspent: rta.overspent_cents / 100,
    integrityFindings: findings.length,
    checkMismatches,
    errors,
  }
}
