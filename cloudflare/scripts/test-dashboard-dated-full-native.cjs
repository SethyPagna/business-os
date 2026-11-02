'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { createHash } = require('node:crypto'), { createRequire } = require('node:module')
assert.equal(process.argv.length, 2, 'This regression loads the current checkout; no arguments are supported')
const cf = path.resolve(__dirname, '..'), root = path.resolve(cf, '..'), ANALYTICS = 'cloudflare/src/lib/salesAnalytics.ts'
const sha = value => createHash('sha256').update(value).digest('hex')
const decode = value => new TextDecoder('utf-8', { fatal: true }).decode(value).replace(/\r\n/g, '\n')
const sources = new Map(), missing = new Set(), bindings = {}, cases = [], checks = []
const local = createRequire(path.join(cf, 'package.json')), { build } = local('esbuild'), { Miniflare, Log, LogLevel } = local('miniflare')
const exportsOnly = '\nexport {readSalesReportAtomicTotalsSnapshot as __datedAtomic,salesPeriodRowsFromSnapshot as __datedPeriod};\n'
function shown(relative) {
  if (missing.has(relative)) return null
  if (!sources.has(relative)) {
    const file = path.resolve(root, relative)
    if (!file.startsWith(cf + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { missing.add(relative); return null }
    const bytes = fs.readFileSync(file), text = decode(bytes)
    sources.set(relative, { file, bytes, text }); bindings[relative] = { raw: sha(bytes), lf: sha(Buffer.from(text)) }
  }
  return sources.get(relative).text
}
const plugin = { name: 'current-dated-dashboard-exports-only', setup(builder) {
  builder.onResolve({ filter: /^current:(analytics|money|schema|switches)$/ }, item => ({ path: { 'current:analytics': 'src/lib/salesAnalytics', 'current:money': 'src/lib/reportMoneyPrecision', 'current:schema': 'src/lib/schemaProbe', 'current:switches': 'src/lib/readSwitches' }[item.path], namespace: 'checkout' }))
  builder.onResolve({ filter: /^\.\.?\//, namespace: 'checkout' }, item => ({ path: path.posix.normalize(path.posix.join(path.posix.dirname(item.importer), item.path)), namespace: 'checkout' }))
  builder.onLoad({ filter: /.*/, namespace: 'checkout' }, item => {
    for (const suffix of ['.ts', '/index.ts', '.json', '']) {
      const relative = 'cloudflare/' + item.path + suffix, text = shown(relative)
      if (text !== null) return { contents: text + (relative === ANALYTICS ? exportsOnly : ''), loader: relative.endsWith('.json') ? 'json' : 'ts', resolveDir: cf }
    }
    throw new Error('Missing current source ' + item.path)
  })
} }
const worker = String.raw`
import * as api from 'current:analytics'
import * as money from 'current:money'
import { __resetSchemaProbeCacheForTests as resetSchema } from 'current:schema'
import { resetReadSwitchMemo as resetSwitches } from 'current:switches'
function phase(sqls: string[]) {
  if (sqls.length === 1 && /FROM system_flags WHERE key IN \(\?1, \?2\)/.test(sqls[0])) return 'switch'
  if (sqls.some(sql => sql.includes('report_restore_state_changed'))) return 'atomic-main'
  if (sqls.some(sql => sql.includes('report_flags_bytes'))) return sqls.length === 3 ? 'flags-prefetch' : 'flags-post'
  if (sqls.some(sql => /MIN\(si\.id\) AS lo,\s*MAX\(si\.id\) AS hi/.test(sql))) return 'item-band'
  if (sqls.some(sql => /FROM inventory_movements m/.test(sql))) return 'removal-loss'
  return 'read'
}
function err(error: any) { return { name: error?.name ?? typeof error, code: error?.code ?? null, message: String(error?.message ?? error) } }
function meter(raw: D1Database, fault: string | undefined) {
  const calls: any[] = [], mutations: any[] = [], pending = new Set<Promise<unknown>>()
  let order = 0
  const observe = (result: any) => ({ success: result?.success ?? null, meta: result?.meta ?? null, rows: Array.isArray(result?.results) ? result.results.length : null })
  const bound = (value: unknown) => value instanceof ArrayBuffer ? { binary_bytes: value.byteLength } : ArrayBuffer.isView(value) ? { binary_bytes: value.byteLength } : value
  const tracked = async (job: () => Promise<any>) => { const promise = job(); pending.add(promise); try { return await promise } finally { pending.delete(promise) } }
  const statement = (inner: any, sql: string, values: unknown[] = []): any => new Proxy(inner, { get(target, key) {
    if (key === '__native') return target
    if (key === '__sql') return sql
    if (key === '__values') return values
    if (key === 'bind') return (...next: unknown[]) => statement(target.bind(...next), sql, next)
    if (key === 'all' || key === 'run') return (...args: unknown[]) => tracked(async () => {
      const call: any = { operation: key, phase: phase([sql]), arity: 1, sqls: [sql], bindings: [values.map(bound)], started: ++order }; calls.push(call)
      let result
      try { result = await target[key](...args) } catch (error) { call.error = err(error); call.unknown_metadata = 1; call.completed = ++order; throw error }
      try { call.results = [observe(result)] } catch (error) { call.observer_error = err(error) }
      call.completed = ++order; return result
    })
    if (key === 'first' || key === 'raw') return () => { throw new Error('Unexpected unmetered statement method: ' + String(key)) }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  const db: any = new Proxy(raw, { get(target: any, key) {
    if (key === 'prepare') return (sql: string) => statement(target.prepare(sql), sql)
    if (key === 'batch') return (original: any[]) => tracked(async () => {
      let items = original
      const isMain = phase(original.map(item => item.__sql)) === 'atomic-main'
      if (fault === 'stale-band' && isMain) {
        const before = original[1].__sql, needle = 'SUM(invalid_item_band)>0'
        if (before.split(needle).length !== 2) throw new Error('Storage-control seam changed')
        const after = before.replace(needle, '0')
        items = original.map((item, index) => index === 1 ? statement(target.prepare(after).bind(...item.__values), after, item.__values) : item)
        mutations.push({ fault, before, after, replacements: 1 })
      }
      const call: any = { operation: 'batch', phase: phase(items.map(item => item.__sql)), arity: items.length, sqls: items.map(item => item.__sql), bindings: items.map(item => item.__values.map(bound)), started: ++order }; calls.push(call)
      let result
      try { result = await target.batch(items.map(item => item.__native)) } catch (error) { call.error = err(error); call.unknown_metadata = items.length; call.completed = ++order; throw error }
      if (fault === 'money' && isMain) {
        result = result.map((group: any, index: number) => index !== 4 ? group : { ...group, results: group.results.map((row: any) => {
          mutations.push({ fault, row_id: row.id, old_cost: row.cost_price_usd, new_cost: Number(row.cost_price_usd) + 1 })
          return { ...row, cost_price_usd: Number(row.cost_price_usd) + 1 }
        }) })
      }
      try { call.results = result.map(observe); if (isMain) call.admission = result[1]?.results } catch (error) { call.observer_error = err(error) }
      call.completed = ++order; return result
    })
    if (key === 'exec' || key === 'withSession' || key === 'dump') return () => { throw new Error('Unmetered native operation prohibited: ' + String(key)) }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  return { db, calls, mutations, async drain() { let stable = 0; while (stable < 2) { const jobs = [...pending]; if (jobs.length) { stable = 0; await Promise.allSettled(jobs) } else { stable++; await Promise.resolve() } } } }
}
function views(snapshot: any) {
  const totals = api.salesTotalsFromSnapshot(snapshot)
  return { totals, diagnostic: api.reportMoneyDiagnostic(totals), periodSeries: api.__datedPeriod(snapshot, 'day'), ...api.dashboardSplitsFromSnapshot(snapshot), ...api.dashboardRankingsFromSnapshot(snapshot, 20) }
}
async function run(input: any, env: any) {
  if (!['full', 'combined', 'previous', 'context', 'default', 'explicit-false', 'totals'].includes(input.mode) || !input.filters || ![undefined, 'cohort', 'money', 'stale-band'].includes(input.fault)) throw new Error('Invalid test selector')
  resetSchema(); resetSwitches()
  const measured = meter(env.DB, input.fault), local = { ...env, DB: measured.db, PLAN_TIER: 'paid' }
  let filters = input.mode === 'previous' ? api.previousPeriodFilters(input.filters) : input.filters
  if (input.fault === 'cohort') filters = { ...filters, branchId: 3 }
  const done = (value: any) => ({ ...value, filters, calls: measured.calls, mutations: measured.mutations })
  try {
    if (input.mode === 'combined') { const value = await api.getSalesTotalsAndPeriodSeries(local, filters, 'day', 20); return done({ kind: 'combined', value, diagnostic: api.reportMoneyDiagnostic(value.totals) }) }
    if (input.mode === 'previous') { const totals = await api.getSalesTotalsWithoutLosses(local, filters); return done({ kind: 'previous', totals, diagnostic: api.reportMoneyDiagnostic(totals) }) }
    if (input.mode === 'totals') { const value = await api.readSalesReportTotals(local, filters); return done({ kind: 'totals', value, diagnostic: api.reportMoneyDiagnostic(value.totals) }) }
    const snapshot = input.mode === 'full' ? await api.readSalesReportSnapshot(local, filters)
      : input.mode === 'default' ? await api.__datedAtomic(local, filters, false, null, {}, 'full')
      : await api.__datedAtomic(local, filters, false, null, {}, 'full', input.mode === 'context')
    return done({ kind: 'snapshot', snapshot, views: views(snapshot) })
  } catch (error) {
    const mapped = error instanceof money.ReportMoneyPrecisionError ? money.reportMoneyHttpError(error) : null
    return done({ kind: 'refusal', error: { ...err(error), status: mapped?.status ?? 500 } })
  } finally { await measured.drain() }
}
export default { async fetch(request: Request, env: any) {
  try { return Response.json({ ok: true, ...await run(await request.json(), env) }) }
  catch (error) { return Response.json({ ok: false, error: err(error) }, { status: 500 }) }
} }
`
const schema = [
  'CREATE TABLE customers(id INTEGER PRIMARY KEY,is_anonymous INTEGER DEFAULT 0)',
  'CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT)',
  'CREATE TABLE fees(id INTEGER PRIMARY KEY,sale_id INTEGER,fee_type TEXT,delivery_contact_id INTEGER,delivery_contact_name TEXT,amount_usd REAL,amount_khr REAL,created_at TEXT,fee_date TEXT,branch_id INTEGER)',
  `CREATE TABLE sales(id INTEGER PRIMARY KEY,created_at TEXT,sale_status TEXT,branch_id INTEGER,branch_name TEXT,cashier_id INTEGER,cashier_name TEXT,customer_id INTEGER,customer_name TEXT,customer_phone TEXT,receipt_number TEXT,payment_method TEXT,
    subtotal_usd REAL,discount_usd REAL DEFAULT 0,membership_discount_usd REAL DEFAULT 0,tax_usd REAL DEFAULT 0,total_usd REAL,delivery_fee_usd REAL DEFAULT 0,delivery_fee_paid_by TEXT DEFAULT 'customer',delivery_actual_cost_usd REAL,is_delivery INTEGER DEFAULT 0,
    source_return_id INTEGER,status_before_return TEXT,amount_paid_usd REAL,amount_paid_khr REAL DEFAULT 0,exchange_rate REAL DEFAULT 4000,delivery_contact_id INTEGER,delivery_contact_name TEXT,money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_total_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0)`,
  'CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,product_name TEXT,quantity REAL,total_usd REAL,cost_price_usd REAL,product_discount_usd REAL DEFAULT 0,manual_discount_usd REAL DEFAULT 0,pricing_snapshot_json TEXT)',
  "CREATE TABLE returns(id INTEGER PRIMARY KEY,sale_id INTEGER,created_at TEXT,status TEXT DEFAULT 'completed',return_scope TEXT DEFAULT 'customer',total_refund_usd REAL,owed_reduction_usd REAL DEFAULT 0,refund_currency TEXT,money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_refund_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0)",
  'CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,cost_price_usd REAL,quantity REAL,stock_action TEXT,return_to_stock INTEGER,sale_item_id INTEGER,total_usd REAL,refund_snapshot_json TEXT)',
  'CREATE TABLE delivery_contacts(id INTEGER PRIMARY KEY,name TEXT)',
  'CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,created_at TEXT,branch_id INTEGER,user_id INTEGER,movement_type TEXT,quantity REAL,reference_id TEXT,reason TEXT,unit_cost_usd REAL,total_cost_usd REAL,batch_id INTEGER)',
  'CREATE TABLE product_batches(id INTEGER PRIMARY KEY,unit_cost_usd REAL)',
  'CREATE INDEX idx_sales_created_pg ON sales(created_at,id)',
  'CREATE INDEX idx_sale_items_sale_id_pg ON sale_items(sale_id)',
]
const current = { startDate: '2026-09-10', endDate: '2026-09-10', branchId: 1 }, previous = { startDate: '2026-09-09', endDate: '2026-09-09', branchId: 1 }
let mf, final, bundleSha256, lastStage = 'start'
function metrics(value) {
  const failed = value.calls.filter(call => call.error), unknown = value.calls.reduce((sum, call) => sum + (call.unknown_metadata ?? 0), 0)
  const read = value.calls.filter(call => call.phase !== 'switch')
  return { switch_calls: value.calls.length - read.length, physical_calls: read.length, statements: read.reduce((sum, call) => sum + call.arity, 0), failed_calls: failed.length, unknown_statement_metadata: unknown, atomic_mains: value.calls.filter(call => call.phase === 'atomic-main').length }
}
function native(value, expectedStorageFailure = false) {
  const failures = value.calls.filter(call => call.error)
  assert.equal(failures.length, expectedStorageFailure ? 1 : 0, JSON.stringify(failures))
  if (expectedStorageFailure) { assert.equal(failures[0].phase, 'atomic-main'); assert.equal(failures[0].arity, 7); assert.match(failures[0].error.message, /bad JSON path|JSON path error/i); assert.ok(failures[0].error.message.includes('$[report_totals_storage]')); assert.equal(failures[0].unknown_metadata, 7); assert.equal(failures[0].results, undefined) }
  for (const call of value.calls) {
    assert.ok(call.completed > call.started); assert.equal(call.observer_error, undefined)
    if (call.error) continue
    assert.equal(call.results.length, call.arity); assert.equal(call.unknown_metadata ?? 0, 0)
    for (const result of call.results) { assert.equal(result.success, true); assert.equal(typeof result.meta?.rows_read, 'number'); assert.equal(result.meta?.rows_written, 0) }
  }
}
function golden(totals, diagnostic, expected) {
  for (const [key, value] of Object.entries({ tx_count: 1, revenue_usd: expected.revenue, cost_usd: expected.cost, profit_usd: expected.revenue - expected.cost, collected_total_usd: expected.revenue, refund_usd: expected.refund, cancelled_tx_count: expected.cancelled, cost_known_lines: 1, cost_missing_snapshot_lines: 0 })) assert.equal(totals[key], value, key)
  assert.deepEqual(diagnostic, { precision_mode: 'exact_recorded', complete: true, unknown_cost_lines: 0, contributing_rows: expected.rows })
}
function authority(value, which) {
  assert.equal(value.kind, 'snapshot', JSON.stringify(value.error)); native(value)
  const snapshot = value.snapshot
  assert.deepEqual(snapshot.sales.map(row => row.id), which === 'current' ? [10] : [30])
  assert.deepEqual(snapshot.voidSales.map(row => row.id), which === 'current' ? [20] : [])
  assert.deepEqual(snapshot.items.map(row => row.id), which === 'current' ? [100] : [300])
  assert.deepEqual(snapshot.returns.map(row => row.id), which === 'current' ? [1] : [])
  assert.deepEqual(snapshot.returnItems.map(row => row.id), which === 'current' ? [1] : [])
  assert.deepEqual(snapshot.deliveryFees, []); assert.equal(snapshot.row_count, which === 'current' ? 5 : 2)
  const expected = which === 'current' ? { revenue: 8, cost: 3, refund: 2, cancelled: 1, rows: 5 } : { revenue: 6, cost: 2, refund: 0, cancelled: 0, rows: 2 }
  golden(value.views.totals, value.views.diagnostic, expected)
  assert.equal(value.views.periodSeries.length, 1); assert.equal(value.views.periodSeries[0].revenue_usd, expected.revenue)
  assert.equal(snapshot.items[0].product_name, which === 'current' ? 'Current recorded item' : 'Previous recorded item')
  return expected
}
function combinedParity(value, full) {
  assert.equal(value.kind, 'combined', JSON.stringify(value.error)); assert.deepEqual(value.diagnostic, full.views.diagnostic)
  for (const [key, expected] of Object.entries(full.views.totals)) assert.deepEqual(value.value.totals[key], expected, key)
  for (const key of ['periodSeries', 'byPayment', 'byBranch', 'topCustomers', 'hourlyDist', 'topProducts', 'topProductsQty']) assert.deepEqual(value.value[key], full.views[key], key)
}
const trace = value => value.calls.map(call => ({ operation: call.operation, sqls: call.sqls, bindings: call.bindings }))
function storageRefusal(value) { assert.equal(value.kind, 'refusal'); assert.equal(value.error.code, 'unsupported_row'); assert.equal(value.error.status, 422) }
async function main() {
  lastStage = 'bundle'
  const bundle = (await build({ stdin: { contents: worker, resolveDir: cf, loader: 'ts', sourcefile: 'dashboard-dated-native-worker.ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], plugins: [plugin], logLevel: 'error' })).outputFiles[0].text
  bundleSha256 = sha(bundle); assert.ok(bindings[ANALYTICS])
  lastStage = 'native-open'
  mf = new Miniflare({ modules: true, script: bundle, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, d1Databases: ['DB'], d1Persist: false, cachePersist: false, outboundService: () => new Response('No external network', { status: 503 }), log: new Log(LogLevel.ERROR) })
  await mf.ready; const raw = await mf.getD1Database('DB')
  const setup = async statements => { const result = await raw.batch(statements.map(({ sql, values = [] }) => raw.prepare(sql).bind(...values))); assert.equal(result.length, statements.length); assert.ok(result.every(item => item.success === true)); return result }
  lastStage = 'minimal-native-schema'; await setup(schema.map(sql => ({ sql })))
  const sale = (id, day, branch, amount, status = 'completed') => ({ sql: "INSERT INTO sales(id,created_at,branch_id,branch_name,sale_status,customer_name,receipt_number,payment_method,subtotal_usd,total_usd,amount_paid_usd) VALUES(?,?,?,'Recorded branch',?,'Recorded customer',?,'Cash',?,?,?)", values: [id, day + ' 01:00:00', branch, status, 'DATED-' + id, amount, amount, amount] })
  const item = (id, parent, name, quantity, total, cost) => ({ sql: 'INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd) VALUES(?,?,?, ?,?,?,?)', values: [id, parent, parent, name, quantity, total, cost] })
  lastStage = 'owned-fixture'
  await setup([
    { sql: "INSERT INTO system_flags(key,value) VALUES('read_switches',?)", values: [JSON.stringify({ epoch: 1, switches: { report_atomic: 'on' } })] },
    sale(10, '2026-09-10', 1, 10), sale(20, '2026-09-10', 1, 7, 'cancelled'), sale(30, '2026-09-09', 1, 6), sale(40, '2026-09-10', 2, 50), sale(50, '2026-09-11', 1, 30), sale(60, '2026-09-10', 3, 50),
    item(100, 10, 'Current recorded item', 2, 10, 2), item(200, 20, 'Cancelled item', 1, 7, 1), item(300, 30, 'Previous recorded item', 1, 6, 2), item(0, 40, 'Excluded invalid zero', 1, 0, 0), item(-7, 40, 'Excluded invalid negative', 1, 0, 0), item(400, 40, 'Other branch item', 1, 50, 10), item(500, 50, 'Other date item', 1, 30, 10), item(600, 60, 'Nonempty wrong branch', 1, 50, 10),
    { sql: "INSERT INTO returns(id,sale_id,created_at,total_refund_usd,status,return_scope) VALUES(1,10,'2026-09-20 01:00:00',2,'completed','customer')" },
    { sql: "INSERT INTO return_items(id,return_id,sale_item_id,total_usd,cost_price_usd,quantity,stock_action,return_to_stock) VALUES(1,1,100,2,2,.5,'restock',1)" },
  ])
  // The oracle ('full' with the switch OFF) is the old reader, the base two-pass copy; every other selector runs with report_atomic ON, and
  // 'full-on' is the public full reader with it ON (one atomic batch for a plain dated window).
  let switchState = 'on'
  async function invoke(requested, label, filters = current, fault) {
    lastStage = label
    const mode = requested === 'full-on' ? 'full' : requested, want = requested === 'full' ? 'off' : 'on'
    if (want !== switchState) { await setup([{ sql: "UPDATE system_flags SET value=? WHERE key='read_switches'", values: [JSON.stringify({ epoch: 1, switches: { report_atomic: want } })] }]); switchState = want }
    const response = await mf.dispatchFetch('http://dated.test/probe', { method: 'POST', body: JSON.stringify({ mode, filters, ...(fault ? { fault } : {}) }) }), text = await response.text()
    assert.equal(response.status, 200, text)
    const value = JSON.parse(text); assert.equal(value.ok, true, text)
    // The report_atomic switch is read once per cold isolate by the public readers, and not at all by the direct atomic entry.
    assert.equal(metrics(value).switch_calls, ['context', 'default', 'explicit-false'].includes(mode) ? 0 : 1, label + ': switch reads')
    cases.push({ label, mode, fault: fault ?? null, filters: value.filters, metrics: metrics(value), kind: value.kind, error: value.error ?? null, response_sha256: sha(text) })
    return value
  }
  const full = await invoke('full', 'current-full-authority'); const currentGolden = authority(full, 'current')
  assert.equal(metrics(full).physical_calls, 23); checks.push('generic full authority: exact dated branch fields, late refund and manual money')
  const fullOn = await invoke('full-on', 'current-full-on'); native(fullOn); assert.deepEqual(fullOn.snapshot, full.snapshot); assert.deepEqual(fullOn.views, full.views); assert.equal(metrics(fullOn).physical_calls, 11); assert.equal(metrics(fullOn).atomic_mains, 1); checks.push('with report_atomic ON the public full reader reads one atomic batch and equals the old two-pass authority')
  const combined = await invoke('combined', 'current-combined-budget'); native(combined); combinedParity(combined, full)
  assert.equal(metrics(combined).physical_calls, 12, 'Actual dated combined helper must use12 cold native calls; the prior two-pass helper uses24 in this minimal fixture')
  assert.equal(metrics(combined).atomic_mains, 1); assert.equal(combined.calls.filter(call => call.phase === 'removal-loss').length, 1); checks.push('actual current helper12 versus generic full23 plus loss1')
  const prior = await invoke('full', 'previous-full-authority', previous), previousGolden = authority(prior, 'previous')
  const previousHelper = await invoke('previous', 'previous-actual-helper'); native(previousHelper); assert.deepEqual(previousHelper.filters, previous); assert.deepEqual(previousHelper.totals, prior.views.totals); golden(previousHelper.totals, previousHelper.diagnostic, previousGolden)
  assert.equal(metrics(previousHelper).physical_calls, 11); assert.equal(metrics(previousHelper).atomic_mains, 1); checks.push('actual previous helper11 versus generic full23')
  const context = await invoke('context', 'dated-context-full'); native(context); assert.deepEqual(context.snapshot, full.snapshot); assert.deepEqual(context.views, full.views); assert.equal(metrics(context).physical_calls, 11)
  const main = context.calls.find(call => call.phase === 'atomic-main'); assert.equal(main.arity, 7); assert.equal(main.admission[0].data_rows, 5); assert.ok(main.sqls[1].includes('invalid_item_band')); assert.ok(main.sqls[4].includes('sales s CROSS JOIN sale_items si'))
  const implicit = await invoke('default', 'dated-default-context'), explicit = await invoke('explicit-false', 'dated-explicit-false'); native(implicit); native(explicit); assert.deepEqual(implicit.snapshot, full.snapshot); assert.deepEqual(explicit.snapshot, full.snapshot); assert.deepEqual(trace(implicit), trace(explicit)); assert.ok(!implicit.calls.find(call => call.phase === 'atomic-main').sqls[1].includes('invalid_item_band')); checks.push('defaultfalse identity and all full fields')
  const totals = await invoke('totals', 'dated-public-totals'); native(totals); assert.equal(totals.kind, 'totals'); assert.deepEqual(totals.value.totals, full.views.totals); assert.deepEqual(totals.diagnostic, full.views.diagnostic); assert.equal(metrics(totals).atomic_mains, 0); assert.equal(totals.calls.filter(call => call.phase === 'item-band').length, 2)
  const generic = await invoke('combined', 'unsupported-rich-filter', { ...current, paymentMethod: 'Cash' }); native(generic); combinedParity(generic, full); assert.equal(metrics(generic).atomic_mains, 0); checks.push('dated Stats and richer filters keep legacy reader')
  const alltime = await invoke('full', 'alltime-full-authority', { branchId: 1 }), alltimeHelper = await invoke('combined', 'alltime-existing-helper', { branchId: 1 }); native(alltime); native(alltimeHelper); combinedParity(alltimeHelper, alltime); assert.equal(metrics(alltimeHelper).physical_calls, 12); assert.equal(metrics(alltimeHelper).atomic_mains, 1); assert.ok(!alltimeHelper.calls.find(call => call.phase === 'atomic-main').sqls[1].includes('invalid_item_band')); checks.push('existing alltime path and fields retained')
  const wrongCohort = await invoke('combined', 'control-nonempty-wrong-cohort', current, 'cohort'); native(wrongCohort); assert.equal(wrongCohort.kind, 'combined'); assert.equal(wrongCohort.value.totals.tx_count, 1); assert.equal(wrongCohort.value.totals.revenue_usd, 50); assert.throws(() => combinedParity(wrongCohort, full), assert.AssertionError)
  const wrongMoney = await invoke('combined', 'control-native-item-cost', current, 'money'); native(wrongMoney); assert.equal(wrongMoney.kind, 'combined'); assert.equal(wrongMoney.mutations.length, 1); assert.deepEqual(wrongMoney.mutations[0], { fault: 'money', row_id: 100, old_cost: 2, new_cost: 3 }); assert.throws(() => golden(wrongMoney.value.totals, wrongMoney.diagnostic, currentGolden), assert.AssertionError); checks.push('nonempty wrong cohort and native cost payload faults rejected')
  lastStage = 'move-only-owned-invalid-id'; await setup([{ sql: 'UPDATE sale_items SET sale_id=10 WHERE id=0' }])
  const invalidFull = await invoke('full', 'selected-id0-public-refusal'); storageRefusal(invalidFull); native(invalidFull)
  const invalidHelper = await invoke('combined', 'selected-id0-helper-refusal'); storageRefusal(invalidHelper); native(invalidHelper, true)
  const staleBand = await invoke('combined', 'control-stale-invalid-band', current, 'stale-band'); native(staleBand); assert.equal(staleBand.kind, 'combined'); assert.equal(staleBand.mutations.length, 1); assert.equal(staleBand.mutations[0].fault, 'stale-band'); assert.throws(() => storageRefusal(staleBand), assert.AssertionError); combinedParity(staleBand, full); checks.push('selected id0 refusal kills stale/ignored invalid-band control')
  assert.equal(cases.length, 17)
  lastStage = 'cleanup-owned-world'; await setup(['return_items', 'returns', 'sale_items', 'sales'].map(table => ({ sql: 'DELETE FROM ' + table })))
  const empty = await raw.prepare('SELECT (SELECT COUNT(*) FROM sales) AS sales,(SELECT COUNT(*) FROM sale_items) AS items,(SELECT COUNT(*) FROM returns) AS refunds').all(); assert.deepEqual(empty.results[0], { sales: 0, items: 0, refunds: 0 })
  for (const [relative, source] of sources) assert.ok(source.bytes.equals(fs.readFileSync(source.file)), 'Loaded source changed: ' + relative)
  final = { pass: true, checks: checks.length, requests: cases.length, bundle_sha256: bundleSha256, embedded_worker_sha256: sha(worker), schema_sha256: sha(JSON.stringify(schema)), loaded_sources: bindings, cases, scope: 'Minimal native financial/dated dispatch regression; no migration/trigger/auth/concurrent-writer/large-cap/provider CPU/peak/daily/call51 or whole Free certificate.' }
}
main().catch(error => { final = { pass: false, last_stage: lastStage, error: String(error?.stack ?? error), checks, requests: cases.length, cases, bundle_sha256: bundleSha256, loaded_sources: bindings }; process.exitCode = 1 }).finally(async () => {
  let disposed = false
  try { if (mf) { await mf.dispose(); disposed = true } } catch (error) { final = { pass: false, disposal_error: String(error?.stack ?? error), prior: final }; process.exitCode = 1 }
  console.log(JSON.stringify({ ...final, disposed }))
  if (!final?.pass || !disposed) process.exitCode = 1
})
