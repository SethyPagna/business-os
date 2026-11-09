// Loads the REAL routes/portalOrders.ts and lib/onlineOrderStore.ts (transpiled, not reimplemented) against an in-memory SQLite database carrying every
// migration. Only platform pieces are replaced: the database adapter (it records every statement), the read switch, the portal account lookup and
// the PayWay transport, which is a script. No request leaves the machine and no key exists anywhere in this file.
//
//   const h = createOrdersHarness({ switchOn: true })
//   await h.request('/', 'POST', { lines: [...], name: ..., phone: ... })
//   h.calls            every PayWay request the Worker made: { op: 'generate-qr' | 'check' | 'close', body }
//   h.statements       every SQL statement the Worker ran (a batch counts each statement)
//   h.script.generate / h.script.check  replace what the fake PayWay answers
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')

const SRC = path.join(__dirname, '..', '..', 'src')

const FAKE_ENV = {
  PAYWAY_MERCHANT_ID: 'merchant-test-0001', PAYWAY_API_KEY: 'k'.repeat(40), PAYWAY_ENV: 'sandbox',
  APP_ENCRYPTION_KEY: 'e'.repeat(48), PORTAL_ABUSE_HMAC_SECRET: 'p'.repeat(48), BUSINESS_OS_PUBLIC_URL: 'https://shop.example.test',
  PLAN_TIER: 'paid',
}

function approved(amount, extra = {}) {
  return { status: { code: '0' }, data: { payment_status_code: 0, original_amount: amount, total_amount: amount, discount_amount: 0, payment_amount: amount, payment_currency: 'USD', apv: 'APV123', transaction_date: '2026-11-09 10:00:00', ...extra } }
}
const pending = () => ({ status: { code: '0' }, data: { payment_status_code: 2, original_amount: 0, total_amount: 0, discount_amount: 0 } })

function createOrdersHarness(options = {}) {
  const raw = openDb(loadAll())
  for (const [key, value] of Object.entries(options.settings || {})) raw.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, String(value))
  const statements = []
  const record = (sql) => statements.push(sql.replace(/\s+/g, ' ').trim())
  // A D1 call is what the Free plan counts (50 per request): each prepared get/all/run is one, and a whole batch is ONE however many statements it holds.
  const d1 = { calls: 0 }
  const db = {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        get: async (params) => { d1.calls += 1; record(sql); return stmt.get(params) },
        all: async (params) => { d1.calls += 1; record(sql); return stmt.all(params) || [] },
        run: async (params) => { d1.calls += 1; record(sql); const info = stmt.run(params); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
      }
    },
    batch: (items) => { d1.calls += 1; for (const item of items) record(item.sql); return raw.batch(items) },
  }
  const state = { switchOn: options.switchOn !== false, nowMs: options.nowMs ?? Date.UTC(2026, 10, 9, 3, 0, 0), account: null }
  const calls = []
  const script = {
    // Each receives the request body and returns the JSON PayWay would answer (or { status, json } to answer an HTTP status), or throws for a network failure.
    generate: (body, n) => ({ status: { code: '0', message: 'Success!' }, qrString: `000201KHQR${body.tran_id}`, abapay_deeplink: `abamobilebank://pay?t=${body.tran_id}` }),
    check: () => pending(),
    close: () => ({ status: { code: '0' } }),
  }
  let generated = 0
  const transport = async ({ url, body }) => {
    const op = url.includes('generate-qr') ? 'generate-qr' : url.includes('check-transaction') ? 'check' : 'close'
    calls.push({ op, body: { ...body } })
    const answer = op === 'generate-qr' ? script.generate(body, generated++) : op === 'check' ? script.check(body) : script.close(body)
    return answer && typeof answer === 'object' && 'httpStatus' in answer ? { status: answer.httpStatus, json: answer.json ?? null } : { status: 200, json: answer }
  }

  const overrides = {
    '../lib/db': { getDb: () => db },
    './db': { getDb: () => db },
    '../lib/readSwitches': { readSwitch: async () => state.switchOn },
    '../lib/portalSession': { getPortalAccountState: async () => (state.account ? { status: 'authenticated', account: state.account } : { status: 'unauthenticated', account: null }) },
    ...(options.overrides || {}),
  }
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(SRC, rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }

  const routeModule = load('routes/portalOrders.ts')
  const store = load('lib/onlineOrderStore.ts')
  const orders = load('lib/onlineOrders.ts')
  const planTier = load('lib/planTier.ts')
  const randomCounter = { n: 1 }
  // Deterministic but unique bytes: every call advances, so order numbers, tokens and tran ids never collide.
  const random = (length) => { const out = new Uint8Array(length); const seed = randomCounter.n++; for (let i = 0; i < length; i += 1) out[i] = (seed * 131 + i * 17 + (seed >> 3) * 29) & 255; return out }
  const app = routeModule.createPortalOrdersRoute({ transport, now: () => new Date(state.nowMs), random })
  const sweepModule = load('lib/onlineOrderSweep.ts')
  const paywayModule = load('lib/payway.ts')
  const callbackApp = load('routes/paywayCallback.ts').createPaywayCallbackRoute({ transport, now: () => new Date(state.nowMs) })

  const env = { DB: raw, ...FAKE_ENV, ...(options.env || {}) }
  const limits = []
  if (options.limiter) env.ORDER_LIMITER = { limit: async ({ key }) => { limits.push(key); return { success: options.limiter(key, limits.length) } } }

  async function request(pathname, method = 'POST', body, { ip = '203.0.113.9', headers = {}, rawBody, envOverride } = {}) {
    planTier.__resetPlanTierCacheForTests?.()
    store.resetNudgeThrottleForTests?.()
    const allHeaders = {
      'CF-Connecting-IP': ip, 'Sec-Fetch-Site': 'same-origin',
      ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
    }
    for (const key of Object.keys(allHeaders)) if (allHeaders[key] == null) delete allHeaders[key]
    const response = await app.request(pathname, { method, headers: allHeaders, body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body) }, { ...env, ...(envOverride || {}) },
      { waitUntil() {}, passThroughOnException() {} })
    let json = null
    try { json = await response.json() } catch (_) { json = null }
    return { status: response.status, body: json, headers: response.headers }
  }

  // The callback exactly as ABA would post it: the per-transaction token from the URL the Worker gave it, and a body nobody reads.
  async function callback(tranId, { token, body = { status: 'approved' }, method = 'POST', envOverride, query } = {}) {
    planTier.__resetPlanTierCacheForTests?.()
    const merged = { ...env, ...(envOverride || {}) }
    const s = token !== undefined ? token : (await paywayModule.callbackUrlFor(merged, 'https://shop.example.test', tranId)).split('s=')[1]
    const url = query !== undefined ? `/callback?${query}` : `/callback?t=${encodeURIComponent(tranId)}&s=${encodeURIComponent(s ?? '')}`
    const response = await callbackApp.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }, merged, { waitUntil() {}, passThroughOnException() {} })
    let json = null
    try { json = await response.json() } catch (_) { json = null }
    return { status: response.status, body: json }
  }
  const deps = (over = {}) => ({ db, env: { ...env, ...(over.env || {}) }, now: () => new Date(state.nowMs), random, transport, origin: null })
  const credentials = (over = {}) => paywayModule.paywayCredentials({ ...env, ...(over.env || {}) })
  async function sweep(over = {}) { planTier.__resetPlanTierCacheForTests?.(); return sweepModule.sweepOrders(deps(over), over.noCredentials ? null : credentials(over)) }
  const one = (sql, ...params) => raw.db.prepare(sql).get(...params)
  const all = (sql, ...params) => raw.db.prepare(sql).all(...params)
  const run = (sql, ...params) => raw.db.prepare(sql).run(...params)

  return {
    callback, sweep, sweepModule, paywayModule, load, env, raw, request, calls, statements, d1, script, state, limits, one, all, run, store, orders, planTier, approved, pending,
    setNow: (ms) => { state.nowMs = ms },
    advance: (ms) => { state.nowMs += ms },
    clearStatements: () => { statements.length = 0; d1.calls = 0 },
  }
}

module.exports = { createOrdersHarness, FAKE_ENV, approved, pending }
