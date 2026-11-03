'use strict'
// Writes budgets.json and fingerprints/ from a fresh measurement: `node scripts/read-budget/measure.cjs --init`.
// Every ceiling is the measured figure x 1.10, rounded up. A later change to an existing ceiling is made by hand in
// budgets.json and must carry "raised": { "from": n, "reason": "..." } (the coverage test prints every raise).
// Each measured shape is appended to a cache file as it finishes; `--resume` continues a run that was cut short.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { bootWorld } = require('./world.cjs')
const { getShapes } = require('./shapes.cjs')
const { writeShapes, measureWrite } = require('./writes.cjs')
const { registeredRoutes, matchRoute } = require('./routes.cjs')
const { roundUp, BUDGETS_FILE, FREE_CALL_LIMIT } = require('./budgets.cjs')
const { measureGet, prepareWorld, codeOf, switchFence } = require('./runner.cjs')

const FINGERPRINTS = path.join(__dirname, 'fingerprints')
const CACHE = path.join(os.tmpdir(), 'read-budget-measure.jsonl')

// Routes the plan serves in every zone (RELIABILITY-PLAN 2.4), the slice that lifts a Free-config refusal, and the dated target of
// each route over the 50-call Free limit. Everything else is N, or H above 50,000 rows or on a long range.
const ROUTE_NOTES = {
  protected: ['POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/auth/me', 'GET /api/auth/bootstrap', 'GET /api/runtime/version', 'POST /api/sales', 'PATCH /api/sales/:id/status',
    'POST /api/sales/:id/amendments', 'GET /api/sales/:id/records', 'GET /api/sales/create-receipt', 'POST /api/returns', 'POST /api/returns/quote', 'POST /api/shifts/open', 'POST /api/shifts/close',
    'GET /api/shifts/current', 'GET /api/shifts/policy', 'GET /api/products/bootstrap'],
  until: { stock_session_query_budget_exceeded: 'P1.1', customer_return_over_plan_budget: 'P1.1', http_500: 'P1.1' },
  targets: {
    '/api/dashboard/startup': { cold_calls_max: 45, slice: 'P1.4', by: '2026-11-11' },
    '/api/sales/stats': { cold_calls_max: 45, slice: 'P1.4', by: '2026-11-11' },
    '/api/analytics': { cold_calls_max: 45, slice: 'P1.4', by: '2026-11-11' },
    '/api/sales/daily-report': { cold_calls_max: 45, slice: 'P1.5', by: '2026-11-13' },
    '/api/reports/grouped': { cold_calls_max: 45, slice: 'P1.5', by: '2026-11-13' },
    '/api/settings/payment-methods/impact': { cold_calls_max: 45, slice: 'P1.2', by: '2026-11-11' },
    '/api/sales/:id/status': { cold_calls_max: 45, slice: 'P1.2', by: '2026-11-11' },
  },
  reason: (r) => (r.method === 'GET' ? (r.route.startsWith('/api') ? 'get-not-in-shapes' : 'static-or-document') : 'write-not-measured'),
}

const EXEMPTION_REASONS = {
  'static-or-document': 'served assets or documents; no D1 read',
  'write-not-measured': 'a write route with no measured shape yet; the slice that changes it adds one',
  'get-not-in-shapes': 'a GET with no shape yet: OAuth callback, job poll, download, duplicate check',
}

const classOf = (entry, longRange) => (Math.max(entry.rows_max, entry.rows_max_analyze) > 50000 || longRange ? 'H' : ROUTE_NOTES.protected.includes(`${entry.method} ${entry.route}`) ? 'P' : 'N')

function expectOf(status, code) {
  if (status < 400) return 'ok'
  return { refused: code || 'http_' + status, until: ROUTE_NOTES.until[code] ?? null }
}

const pinsOf = (statements) => {
  const pins = []
  for (const s of statements || []) {
    const found = /INDEXED BY (\w+)/.exec(s.sql)
    if (found && !pins.some((p) => p.index === found[1])) pins.push({ match: `INDEXED BY ${found[1]}`, index: found[1] })
  }
  return pins
}

// What the cache keeps of one measured shape.
const slim = (w) => ({ status: w.status, code: codeOf(w), rowsRead: w.rowsRead, rowsWritten: w.rowsWritten, calls: w.calls, fingerprints: (w.fingerprints || []).map((f) => [f.h, f.head]) })

async function main() {
  if (!process.argv.includes('--init') && !process.argv.includes('--resume')) throw new Error('usage: node scripts/read-budget/measure.cjs --init | --resume')
  if (!process.argv.includes('--resume')) fs.rmSync(CACHE, { force: true })
  const done = new Map()
  if (fs.existsSync(CACHE)) for (const line of fs.readFileSync(CACHE, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(line); done.set(`${r.phase}:${r.id}`, r.data) }
  const remember = (phase, id, data) => { done.set(`${phase}:${id}`, data); fs.appendFileSync(CACHE, JSON.stringify({ phase, id, data }) + '\n') }
  const routes = await registeredRoutes()
  const getShapeList = getShapes(require('./seed.cjs').seedContext())
  const writeShapeList = writeShapes(require('./seed.cjs').seedContext()).filter((s) => s.variant === 'base')

  if (getShapeList.some((s) => !done.has(`get:${s.id}`))) {
    const world = await bootWorld({ tier: 'free' })
    try {
      await prepareWorld(world)
      for (const shape of getShapeList.filter((s) => !done.has(`get:${s.id}`))) {
        const m = await measureGet(world, shape, { cold: true, statements: true, fingerprints: true })
        remember('get', shape.id, { url: m.url, cold: { status: m.cold.status, calls: m.cold.calls }, warm: slim(m.warm), pins: pinsOf(m.statements) })
        process.stdout.write(`${shape.id}: cold ${m.cold.calls} calls, warm-miss ${m.warm.rowsRead} rows\n`)
      }
    } finally { await world.dispose() }
  }
  if (writeShapeList.some((s) => !done.has(`write:${s.id}`))) {
    const world = await bootWorld({ tier: 'free' })
    try {
      for (const shape of writeShapeList) {
        const m = await measureWrite(world, shape, { fingerprints: true })
        remember('write', shape.id, slim(m))
        process.stdout.write(`${shape.id}: ${m.status} ${codeOf(m) || ''} ${m.calls} calls, ${m.rowsRead} read, ${m.rowsWritten} written\n`)
      }
    } finally { await world.dispose() }
  }
  if (getShapeList.some((s) => !done.has(`analyze:${s.id}`))) {
    const world = await bootWorld({ tier: 'free' })
    try {
      await prepareWorld(world)
      await world.analyze()
      await world.restart(); await world.login()
      const fence = switchFence()
      for (const shape of getShapeList.filter((s) => !done.has(`analyze:${s.id}`))) {
        await fence(world, shape)
        const m = await measureGet(world, shape, { cold: false })
        remember('analyze', shape.id, { rowsRead: m.warm.rowsRead })
        process.stdout.write(`${shape.id}: ANALYZE warm-miss ${m.warm.rowsRead} rows\n`)
      }
    } finally { await world.dispose() }
  }

  const entries = []
  const prints = {}
  for (const shape of [...getShapeList, ...writeShapeList]) {
    const isGet = shape.kind === 'get'
    const data = done.get(`${isGet ? 'get' : 'write'}:${shape.id}`)
    const w = isGet ? data.warm : data
    const pathname = ((isGet ? data.url : shape.url) || '').split('?')[0]
    const reg = matchRoute(routes, shape.method, pathname)
    if (!reg) throw new Error(`${shape.id}: no registered route matches ${shape.method} ${pathname}`)
    const cold = isGet ? data.cold.calls : data.calls
    const entry = { id: shape.id, method: shape.method, route: reg.route, params: (shape.url || '').split('?')[1] || '', status: w.status }
    entry.cold_calls_max = cold > FREE_CALL_LIMIT ? Math.ceil(cold * 1.1) : Math.min(FREE_CALL_LIMIT, Math.ceil(cold * 1.1))
    entry.rows_max = roundUp(w.rowsRead)
    entry.rows_max_analyze = isGet ? roundUp(done.get(`analyze:${shape.id}`).rowsRead) : entry.rows_max
    entry.rows_written_max = roundUp(w.rowsWritten)
    entry.class = classOf(entry, shape.longRange)
    entry.expect = expectOf(w.status, w.code)
    if (cold > FREE_CALL_LIMIT) {
      entry.target = ROUTE_NOTES.targets[reg.route]
      if (!entry.target) throw new Error(`${shape.id}: ${cold} cold calls and no dated target for ${reg.route}`)
    }
    if (isGet && data.pins.length) entry.pins = data.pins
    entries.push(entry)
    ;(prints[reg.route.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')] ||= {})[shape.id] = w.fingerprints
  }
  // A route registered for every method (app.all, a path-level middleware) is covered by a shape on the same path.
  const covered = (r) => entries.some((e) => e.route === r.route && (r.method === 'ALL' || e.method === r.method))
  const exemptions = routes.filter((r) => r.method !== 'HEAD' && !covered(r))
    .map((r) => ({ method: r.method, route: r.route, class: ROUTE_NOTES.protected.includes(`${r.method} ${r.route}`) ? 'P' : 'N', reason: ROUTE_NOTES.reason(r) }))
  const file = { version: 1, base: '05ef61b73', rule: 'MEASURED at the base x 1.10, rounded up; +8 rows under 80 rows. Ratchet only: a raise needs "raised": { from, reason }.',
    programme: { rows_ceiling: 100000, by: '2026-11-30' }, reasons: EXEMPTION_REASONS, exemptions, shapes: entries }
  fs.writeFileSync(BUDGETS_FILE, serialize(file))
  fs.rmSync(FINGERPRINTS, { recursive: true, force: true })
  fs.mkdirSync(FINGERPRINTS)
  for (const [name, byShape] of Object.entries(prints)) fs.writeFileSync(path.join(FINGERPRINTS, name + '.json'), JSON.stringify(byShape, null, 1) + '\n')
  console.log(`budgets.json: ${entries.length} shapes, ${exemptions.length} exemptions; ${Object.keys(prints).length} fingerprint files`)
}

// One line per shape or exemption keeps a raised ceiling a one-line diff.
function serialize(file) {
  const line = (x) => '    ' + JSON.stringify(x)
  return `{\n  "version": ${file.version},\n  "base": ${JSON.stringify(file.base)},\n  "rule": ${JSON.stringify(file.rule)},\n  "programme": ${JSON.stringify(file.programme)},\n  "reasons": ${JSON.stringify(file.reasons)},\n`
    + `  "exemptions": [\n${file.exemptions.map(line).join(',\n')}\n  ],\n  "shapes": [\n${file.shapes.map(line).join(',\n')}\n  ]\n}\n`
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
