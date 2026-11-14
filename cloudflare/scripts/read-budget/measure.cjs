'use strict'
// Writes budgets.json and fingerprints/ from a fresh measurement: `node scripts/read-budget/measure.cjs --init`.
// Every ceiling is the measured figure x 1.10, rounded up. A later change to an existing ceiling is made by hand in
// budgets.json and must carry "raised": { "from": n, "reason": "..." } (the coverage test prints every raise).
// `--only=<regex>` measures and records ONLY the shapes whose id matches (a new shape, or one whose request changed) and merges them into the existing budgets.json and
// fingerprints/: every other entry, exemption, pass and note is carried over untouched, so adding a shape never re-baselines the rest.
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
  // Routes whose statements change with a switch. Their fingerprints pin the old path, so they are captured on a second world with no switch stored.
  switchSensitive: ['/api/fees', '/api/fees/report', '/api/dashboard/startup', '/api/sales/stats', '/api/analytics', '/api/sales/daily-report', '/api/reports/grouped', '/api/reports/periods',
    '/api/reports/business-summary/sales', '/api/dashboard/insight-list'],
  reason: (r) => (r.method === 'GET' ? (r.route.startsWith('/api') ? 'get-not-in-shapes' : 'static-or-document') : 'write-not-measured'),
}

// The GET passes are data in budgets.json "passes" (budgets.cjs passOf); a re-measure keeps the ones already there, so a switch flip is never undone by --init.
// The free pass is what the shapes' ceilings are measured with; the live pass is only carried over (it measures calls, runner.cjs runLivePass).
const DEFAULT_PASSES = {
  free: { tier: 'free', switches: { report_atomic: 'on', report_atomic_long: 'on', expense_reads: 'on', dash_overview_5m: 'on' } },
  live: { tier: 'paid', seedTier: 'free', switches: { ic_simple: 'on' }, cold_calls_max: 45, known_failures: [] },
}
const PASSES = (fs.existsSync(BUDGETS_FILE) && JSON.parse(fs.readFileSync(BUDGETS_FILE, 'utf8')).passes) || DEFAULT_PASSES

const EXEMPTION_REASONS = {
  'static-or-document': 'served assets or documents; no D1 read',
  'write-not-measured': 'a write route with no measured shape yet; the slice that changes it adds one',
  'get-not-in-shapes': 'a GET with no shape yet: OAuth callback, job poll, download, duplicate check',
}

const switchSensitive = (routes, shape) => ROUTE_NOTES.switchSensitive.includes((matchRoute(routes, shape.method, (shape.url || '').split('?')[0]) || {}).route)

const classOf = (entry, longRange) => (Math.max(entry.rows_max, entry.rows_max_analyze) > 50000 || longRange ? 'H' : ROUTE_NOTES.protected.includes(`${entry.method} ${entry.route}`) ? 'P' : 'N')

function expectOf(status, code) {
  if (status < 400) return 'ok'
  return { refused: code || 'http_' + status, until: ROUTE_NOTES.until[code] ?? null }
}

// Why a ceiling is what it is, for the shapes that need a word (written into the entry as "note").
const ENTRY_NOTES = {
  'w-shift-close':
    "6.0.2057 (lane/shift-close-reads): the window prefilters take the Cambodia business date (shiftWindowFloor) and the previous/next shift lookup is a seek on the 0306 indexes, so the close no longer reads one more day from 17:00Z and no longer scans every stored shift (6185 before; 2954 read in the write pass; +1000 stored shifts added 1 row). Measured in the full write pass (the gate's world, after the earlier shapes), not by --only, which runs the shape alone in a fresh world and reads 1827. 2954 x 1.10 = 3250.",
  'fees-list-with-sale-delivery-rows-all-time-branch-source-all':
    'No window, so the expense summary reads every expense once (8,695) plus the 100-row page (234); the sale half is 5,310 with idx_sales_courier_cost leading. 6.0.1053: +f.branch_id keeps the branch index out; it was 29,073 with it.',
  'fees-list-with-sale-delivery-rows-month-branch-source-all':
    'The window index (idx_fees_fee_date) leads and the branch is checked on the window rows. 6.0.1053: +f.branch_id; it was 10,565 with the branch index reading the whole branch.',
  'fees-report-with-sale-delivery-all-time-branch-include-sales':
    "No window: the report only aggregates, so the branch equality stays plain and the planner reads just the branch through its index (4,455 + 8,910 + 8,912 + 13,365 expense rows, branch 1 holding about half of this seed) plus the sale half 1,506. E1-F (read switch expense_reads ON, Free): a window without both dates is not folded on Free (the plan table says so: expenseReportFoldUnboundedWindows is false), so the four passes answer exactly as with the switch off, 37,151 rows; the extra call on a cold isolate is the switch row. Paid folds the same window in one pass: 8,913 + 1,506.",
  'fees-report-with-sale-delivery-month-branch-include-sales':
    "The window index leads and the branch is checked on the window rows. 6.0.1053: +f.branch_id; it was 19,411 with the branch index reading the whole branch. E1-F (read switch expense_reads ON): one grouped pass over the window's 370 expenses instead of four (849 against 2,702); a window of more than the Free fold cap (1,500 rows) is turned away after that many rows.",
  'fees-export-first-page-by-cursor-source-all':
    "E1-F (read switch expense_reads ON, Free page of 500): the first page also totals the expense summary (8,695) and the courier-sale totals (1,506); it takes no snapshot when it is the only page, and reads the highest ids once after the page when another follows. 6.0.1053 read 15,175 for the first page and again 16,000 to 28,000 for every later one.",
  'fees-export-middle-page-by-cursor-source-all':
    "E1-F: resumes after the 2,000th expense and the middle courier sale and reads its own 500 rows (an expense index entry, row and joins per returned row, plus the sale probe and page), not the 2,000 before it; the 6.0.1053 page at offset 2,000 read 19,236.",
  'fees-export-middle-page-by-cursor-with-a-branch-source-all':
    "E1-F: the middle page with a branch filter: +f.branch_id and +sales.branch_id keep the branch index out, so the page still reads its own rows.",
}

// 6.0.1053: the sale half of the Expenses list (routes/feesCatalog.ts) must start from idx_sales_courier_cost, the partial index of the few sales that
// carry a courier cost, whatever the filter. With a branch filter the planner once chose idx_sales_branch_created and read every sale of the branch.
const SALE_COST_STATEMENTS = ['FROM sales WHERE', 'SELECT sales.id, sales.receipt_number']
const pinsOf = (statements) => {
  const pins = []
  for (const s of statements || []) {
    const found = /INDEXED BY (\w+)/.exec(s.sql)
    if (found && !pins.some((p) => p.index === found[1])) pins.push({ match: `INDEXED BY ${found[1]}`, index: found[1] })
  }
  for (const start of SALE_COST_STATEMENTS) {
    if ((statements || []).some((s) => s.sql.includes(start) && s.sql.includes('delivery_actual_cost_usd IS NOT NULL'))) pins.push({ match: start, index: 'idx_sales_courier_cost' })
  }
  return pins
}

// What the cache keeps of one measured shape.
const slim = (w) => ({ status: w.status, code: codeOf(w), rowsRead: w.rowsRead, rowsWritten: w.rowsWritten, calls: w.calls, fingerprints: (w.fingerprints || []).map((f) => [f.h, f.head]) })

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  const ONLY = onlyArg ? new RegExp(onlyArg.slice('--only='.length)) : null
  if (!process.argv.includes('--init') && !process.argv.includes('--resume') && !ONLY) throw new Error('usage: node scripts/read-budget/measure.cjs --init | --resume | --only=<shape id regex>')
  if (!process.argv.includes('--resume')) fs.rmSync(CACHE, { force: true })
  const done = new Map()
  if (fs.existsSync(CACHE)) for (const line of fs.readFileSync(CACHE, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(line); done.set(`${r.phase}:${r.id}`, r.data) }
  const remember = (phase, id, data) => { done.set(`${phase}:${id}`, data); fs.appendFileSync(CACHE, JSON.stringify({ phase, id, data }) + '\n') }
  const routes = await registeredRoutes()
  const getShapeList = getShapes(require('./seed.cjs').seedContext()).filter((s) => !ONLY || ONLY.test(s.id))
  const writeShapeList = writeShapes(require('./seed.cjs').seedContext()).filter((s) => s.variant === 'base' && (!ONLY || ONLY.test(s.id)))

  if (getShapeList.some((s) => !done.has(`get:${s.id}`))) {
    const world = await bootWorld({ tier: PASSES.free.tier, switches: PASSES.free.switches })
    try {
      await prepareWorld(world)
      for (const shape of getShapeList.filter((s) => !done.has(`get:${s.id}`))) {
        const m = await measureGet(world, shape, { cold: true, statements: true, fingerprints: true })
        remember('get', shape.id, { url: m.url, cold: { status: m.cold.status, calls: m.cold.calls }, warm: slim(m.warm), pins: pinsOf(m.statements) })
        process.stdout.write(`${shape.id}: cold ${m.cold.calls} calls, warm-miss ${m.warm.rowsRead} rows\n`)
      }
    } finally { await world.dispose() }
  }
  if (getShapeList.some((s) => switchSensitive(routes, s) && !done.has(`fpold:${s.id}`))) {
    const world = await bootWorld({ tier: 'free' })
    try {
      await prepareWorld(world)
      for (const shape of getShapeList.filter((s) => switchSensitive(routes, s) && !done.has(`fpold:${s.id}`))) {
        const m = await measureGet(world, shape, { cold: false, fingerprints: true })
        remember('fpold', shape.id, slim(m.warm).fingerprints)
        process.stdout.write(`${shape.id}: old-path fingerprints (${m.warm.fingerprints.length} statements)
`)
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
    const world = await bootWorld({ tier: PASSES.free.tier, switches: PASSES.free.switches })
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
    if (ENTRY_NOTES[shape.id]) entry.note = ENTRY_NOTES[shape.id]
    entries.push(entry)
    ;(prints[reg.route.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')] ||= {})[shape.id] = (isGet && done.get(`fpold:${shape.id}`)) || w.fingerprints
  }
  // A route registered for every method (app.all, a path-level middleware) is covered by a shape on the same path.
  const covered = (r) => entries.some((e) => e.route === r.route && (r.method === 'ALL' || e.method === r.method))
  const exemptions = routes.filter((r) => r.method !== 'HEAD' && !covered(r))
    .map((r) => ({ method: r.method, route: r.route, class: ROUTE_NOTES.protected.includes(`${r.method} ${r.route}`) ? 'P' : 'N', reason: ROUTE_NOTES.reason(r) }))
  if (ONLY) {
    const old = JSON.parse(fs.readFileSync(BUDGETS_FILE, 'utf8'))
    const byId = new Map(entries.map((e) => [e.id, e]))
    const merged = old.shapes.map((e) => byId.get(e.id) || e)
    for (const e of entries) if (!old.shapes.some((x) => x.id === e.id)) merged.push(e)
    fs.writeFileSync(BUDGETS_FILE, serialize({ ...old, shapes: merged }))
    fs.mkdirSync(FINGERPRINTS, { recursive: true })
    for (const [name, byShape] of Object.entries(prints)) {
      const f = path.join(FINGERPRINTS, name + '.json')
      const had = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}
      fs.writeFileSync(f, JSON.stringify({ ...had, ...byShape }, null, 1) + '\n')
    }
    console.log(`budgets.json: ${entries.length} shape(s) merged (${entries.map((e) => e.id).join(', ')}); ${Object.keys(prints).length} fingerprint file(s) updated; nothing else touched`)
    return
  }
  const file = { version: 1, base: '05ef61b73', rule: 'MEASURED at the base x 1.10, rounded up; +8 rows under 80 rows. Ratchet only: a raise needs "raised": { from, reason }.',
    programme: { rows_ceiling: 100000, by: '2026-11-30' }, passes: PASSES, reasons: EXEMPTION_REASONS, exemptions, shapes: entries }
  fs.writeFileSync(BUDGETS_FILE, serialize(file))
  fs.rmSync(FINGERPRINTS, { recursive: true, force: true })
  fs.mkdirSync(FINGERPRINTS)
  for (const [name, byShape] of Object.entries(prints)) fs.writeFileSync(path.join(FINGERPRINTS, name + '.json'), JSON.stringify(byShape, null, 1) + '\n')
  console.log(`budgets.json: ${entries.length} shapes, ${exemptions.length} exemptions; ${Object.keys(prints).length} fingerprint files`)
}

// One line per shape, exemption or known failure keeps a raised ceiling a one-line diff.
function serialize(file) {
  const line = (x) => '    ' + JSON.stringify(x)
  const { known_failures: known, ...live } = file.passes.live
  const passes = `  "passes": {\n    "free": ${JSON.stringify(file.passes.free)},\n    "live": ${JSON.stringify(live).slice(0, -1)},"known_failures":[\n${known.map((k) => '      ' + JSON.stringify(k)).join(',\n')}\n    ]}\n  },\n`
  return `{\n  "version": ${file.version},\n  "base": ${JSON.stringify(file.base)},\n  "rule": ${JSON.stringify(file.rule)},\n  "programme": ${JSON.stringify(file.programme)},\n${passes}  "reasons": ${JSON.stringify(file.reasons)},\n`
    + `  "exemptions": [\n${file.exemptions.map(line).join(',\n')}\n  ],\n  "shapes": [\n${file.shapes.map(line).join(',\n')}\n  ]\n}\n`
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
