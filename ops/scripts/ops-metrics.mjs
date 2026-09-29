#!/usr/bin/env node
// Latency and traffic are production numbers: they go only into the encrypted file, and the public log
// (this repository is public) carries route-group counts, HTTP statuses and PASS/FAIL.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  API_BASE, OpsError, commitId, isMain, publicToken, runId, runMain, say, sleep, summary,
  truncate, writeEncryptedReport,
} from './ops-common.mjs'

export const METRICS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'metrics')
export const QUERY_NAMES = Object.freeze(['route-latency', 'route-errors', 'build-revisions'])
export const MIN_ROWS_FOR_P95 = 100
export const MAX_DAYS = 7
// The shop trades 08:00-20:00 in Cambodia (UTC+7); deploys fall outside. The cron's 06:00 and 12:00 UTC runs fall
// inside as blob1 'bg' rows: the latency and error queries read 'api' only, and just the builds list counts them.
export const TRADING_HOURS_UTC = Object.freeze({ start: 1, end: 13 })
const REVISION = /^[A-Za-z0-9._-]{1,64}$/
const ACCOUNT_ID = /^[0-9a-f]{32}$/

// The owner's flows, plus one route no release should move: if it moves, the shift is platform-wide.
export const FLOW_ROUTES = Object.freeze([
  { flow: 'pos-search', method: 'GET', route: '/api/products/search', primary: true },
  { flow: 'pos-search', method: 'GET', route: '/api/products', primary: false },
  { flow: 'pos-search', method: 'GET', route: '/api/inventory/products/search', primary: false },
  { flow: 'pos-search', method: 'GET', route: '/api/products/filters', primary: false },
  { flow: 'checkout', method: 'POST', route: '/api/sales', primary: true },
  { flow: 'checkout', method: 'GET', route: '/api/sales/money-precision-capability', primary: false },
  { flow: 'product-edit', method: 'POST', route: '/api/products', primary: true },
  { flow: 'product-edit', method: 'PUT', route: '/api/products/:id', primary: true },
  { flow: 'product-edit', method: 'POST', route: '/api/inventory/fast-stock-in/commit', primary: false },
  { flow: 'admin-load', method: 'GET', route: '/api/auth/bootstrap', primary: true },
  { flow: 'admin-load', method: 'GET', route: '/api/settings', primary: true },
  { flow: 'admin-load', method: 'GET', route: '/api/notifications/summary', primary: true },
  { flow: 'admin-load', method: 'GET', route: '/api/dashboard/startup', primary: true },
  { flow: 'pos-load', method: 'GET', route: '/api/products/bootstrap', primary: true },
  { flow: 'storefront-load', method: 'GET', route: '/api/portal/config', primary: true },
  { flow: 'storefront-load', method: 'GET', route: '/api/portal/bootstrap', primary: true },
  { flow: 'storefront-load', method: 'GET', route: '/api/portal/catalog/products', primary: true },
  { flow: 'control', method: 'GET', route: '/api/auth/me', primary: true },
])

function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

const utcStamp = (date) => date.toISOString().slice(0, 19).replace('T', ' ')

export function tradingWindows(from, days) {
  if (!isRealDate(String(from))) throw new OpsError('metrics-bad-from', 'OPS_METRICS_FROM is not a YYYY-MM-DD date.')
  const count = Number(days)
  if (!/^\d+$/.test(String(days)) || count < 1 || count > MAX_DAYS) throw new OpsError('metrics-bad-days', `OPS_METRICS_DAYS must be a whole number from 1 to ${MAX_DAYS}.`)
  const first = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: count }, (_, day) => {
    const midnight = first + day * 86_400_000
    return {
      businessDate: new Date(midnight).toISOString().slice(0, 10),
      start: utcStamp(new Date(midnight + TRADING_HOURS_UTC.start * 3_600_000)),
      end: utcStamp(new Date(midnight + TRADING_HOURS_UTC.end * 3_600_000)),
    }
  })
}

export function windowClause(windows) {
  return windows.map((w) => `(timestamp >= toDateTime('${w.start}') AND timestamp < toDateTime('${w.end}'))`).join(' OR ')
}

export function revisionClause(revision) {
  if (revision === undefined || revision === '') return ''
  if (!REVISION.test(String(revision))) throw new OpsError('metrics-bad-revision', 'OPS_METRICS_REVISION is not a build revision.')
  return ` AND blob8 = '${revision}'`
}

export function loadTemplate(name, dir = METRICS_DIR) {
  if (!QUERY_NAMES.includes(name)) throw new OpsError('metrics-unknown-query', 'Not a metrics query.')
  return fs.readFileSync(path.join(dir, `${name}.sql`), 'utf8')
}

export function buildQuery(template, { windows, revision }) {
  const body = String(template).split(/\r?\n/).filter((line) => !/^\s*--/.test(line)).join('\n').trim()
  if (body.split('{{WINDOW}}').length !== 2) throw new OpsError('metrics-bad-template', 'A metrics query must hold {{WINDOW}} exactly once.')
  if (body.split('{{REVISION}}').length > 2) throw new OpsError('metrics-bad-template', 'A metrics query holds {{REVISION}} more than once.')
  const sql = body.replace('{{WINDOW}}', () => windowClause(windows)).replace('{{REVISION}}', () => revisionClause(revision))
  if (/\{\{|--|;/.test(sql)) throw new OpsError('metrics-bad-template', 'A metrics query kept a placeholder, a comment or a semicolon.')
  return sql
}

const number = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const normalizeRoute = (route) => (String(route).length > 1 ? String(route).replace(/\/+$/, '') : String(route))

export function flowOf(route, method) {
  const found = FLOW_ROUTES.find((r) => r.route === normalizeRoute(route) && r.method === String(method).toUpperCase())
  return found ? { flow: found.flow, primary: found.primary } : { flow: null, primary: false }
}

// Below MIN_ROWS_FOR_P95 stored rows, fewer than five lie above the 95th percentile: no p95 is reported.
export function summarizeLatency(rows) {
  return rows.map((row) => {
    const storedRows = number(row.stored_rows) ?? 0
    const enough = storedRows >= MIN_ROWS_FOR_P95
    return {
      route: String(row.route),
      method: String(row.method),
      cache: String(row.cache),
      ...flowOf(row.route, row.method),
      requests: number(row.requests),
      storedRows,
      enough,
      wallP50Ms: number(row.wall_p50_ms),
      wallP95Ms: enough ? number(row.wall_p95_ms) : null,
      d1WallP95Ms: enough ? number(row.d1_wall_p95_ms) : null,
      d1CallsAvg: number(row.d1_calls_avg),
      statementsAvg: number(row.statements_avg),
      rowsReadAvg: number(row.rows_read_avg),
    }
  })
}

// The SQL API takes the query as the raw body, not JSON, so ops-common's cfApi does not fit.
export async function queryAnalytics({ fetchImpl = fetch, accountId, token, sql, attempts = 3, timeoutMs = 30000 }) {
  if (!ACCOUNT_ID.test(String(accountId))) throw new OpsError('bad-account-id', 'CLOUDFLARE_ACCOUNT_ID is not a 32-character hex id.')
  let last = { ok: false, status: 0, rows: null, error: 'not run' }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchImpl(`${API_BASE}/accounts/${accountId}/analytics_engine/sql`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain', 'user-agent': 'business-os-ops' },
        body: sql,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* not JSON */ }
      const rows = json && Array.isArray(json.data) ? json.data : null
      last = { ok: res.ok && rows !== null, status: res.status, rows, error: res.ok && rows !== null ? null : truncate(text, 2000) }
      if (res.status !== 429 && res.status < 500) return last
    } catch (err) {
      last = { ok: false, status: 0, rows: null, error: err && err.name === 'TimeoutError' ? 'timed out' : String(err && err.message) }
    }
    if (attempt < attempts) await sleep(1000 * attempt * attempt)
  }
  return last
}

export async function readMetrics({ fetchImpl, accountId, token, from, days, revision, dir = METRICS_DIR }) {
  const windows = tradingWindows(from, days)
  const problems = []
  const queries = {}
  const rows = {}
  for (const name of QUERY_NAMES) {
    const sql = buildQuery(loadTemplate(name, dir), { windows, revision })
    const result = await queryAnalytics({ fetchImpl, accountId, token, sql })
    queries[name] = { status: result.status, ok: result.ok, error: result.error, sql }
    rows[name] = result.rows || []
    if (!result.ok) problems.push(`metrics-${name}-failed`)
  }
  const builds = rows['build-revisions']
  if (queries['build-revisions'].ok) {
    if (!builds.length) problems.push('metrics-no-datapoints')
    else if (revision && !builds.some((build) => String(build.revision) === String(revision))) problems.push('metrics-revision-not-served')
  }
  return {
    ok: problems.length === 0,
    problems,
    windows,
    revision: revision || null,
    latency: summarizeLatency(rows['route-latency']),
    errors: rows['route-errors'],
    builds,
    queries,
  }
}

export function publicLines({ result, bytes }) {
  const lines = [['metrics: Analytics Engine request metrics, counts only (the numbers are in the encrypted file)', {}]]
  lines.push(['window: {days} trading days, one build only: {filtered}', { days: result.windows.length, filtered: Boolean(result.revision) }])
  lines.push(['route groups: {groups}', { groups: result.latency.length }])
  for (const name of QUERY_NAMES) {
    const q = result.queries[name]
    if (q && !q.ok) lines.push(['query {name}: HTTP {status}', { name: publicToken(name), status: q.status }])
  }
  for (const problem of result.problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  if (bytes !== undefined) lines.push(['encrypted file: {bytes} bytes', { bytes }])
  lines.push(['metrics verdict: {verdict}', { verdict: result.ok ? 'PASS' : 'FAIL' }])
  return lines
}

export async function runMetrics({ env, fetchImpl = fetch }) {
  const get = (name) => {
    const value = env[name]
    if (!value) throw new OpsError('missing-environment', `Environment variable ${name} is not set.`)
    return value
  }
  const outDir = get('OPS_OUT_DIR')
  const startedAt = new Date().toISOString()
  const result = await readMetrics({
    fetchImpl, accountId: get('CLOUDFLARE_ACCOUNT_ID'), token: get('CLOUDFLARE_API_TOKEN'),
    from: get('OPS_METRICS_FROM'), days: env.OPS_METRICS_DAYS || '1', revision: env.OPS_METRICS_REVISION || undefined,
  })
  const commit = commitId()
  const run = runId()
  const payload = { kind: 'metrics', commit, runId: run, startedAt, finishedAt: new Date().toISOString(), minRowsForP95: MIN_ROWS_FOR_P95, ...result }
  const report = writeEncryptedReport(outDir, `metrics-${run}`, payload, { kind: 'metrics', name: 'request-metrics', commit, runId: run, createdAt: payload.finishedAt })
  return { result, report, lines: publicLines({ result, bytes: report.bytes }) }
}

async function main() {
  const { result, lines } = await runMetrics({ env: process.env })
  for (const [template, values] of lines) {
    say(template, values)
    summary(template, values)
  }
  return result.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
