'use strict'
// MEASUREMENT (the name does not start with test-, so no sweep runs it): the JavaScript time one ISSUE BY FILTER spends outside SQLite, by catalogue size, as the administrator on the given plan tier.
// The route is the real one on node:sqlite with the full migration chain; the figures are relative (before and after), not Cloudflare milliseconds. Free allows 10 ms of CPU per invocation.
// Run (under the native-test lock): node scripts/measure-inventory-check-issue-cpu.cjs [free|paid] [100,101,3000,6000] [ranked|page]
// The test that pins it is test-inventory-check-issue-filter-native.cjs, which requires this file.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const HEAD = path.resolve(__dirname, '..')
const { transformSync } = require('esbuild')
const { loadAll } = require(path.join(HEAD, 'scripts/harness/load_migrations.cjs'))
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id.endsWith('.ts') ? id : `${id}.ts`)) : require(require.resolve(id, { paths: [HEAD] })), module, module.exports)
  return module.exports
}
const sessionsRoute = load(path.join(HEAD, 'src/routes/inventoryChecks.ts')).default
const { resetReadSwitchMemo } = load(path.join(HEAD, 'src/lib/readSwitches.ts'))
const planTier = load(path.join(HEAD, 'src/lib/planTier.ts'))
let db, stats
const bytes = v => typeof v === 'string' ? Buffer.byteLength(v) : v == null ? 0 : 8
function binding() {
  function prepare(sql) {
    return { sql, values: [], bind(...values) { return { ...this, values } }, async all() {
      const t = performance.now()
      const results = db.prepare(sql).all(...this.values)
      const changes = db.prepare('SELECT changes() AS n').get().n
      stats.sqlMs += performance.now() - t
      stats.statements++; if (!stats.inBatch) stats.calls++
      const pb = this.values.reduce((s, v) => s + bytes(v), 0)
      stats.paramBytes += pb; stats.maxParam = Math.max(stats.maxParam, ...this.values.map(bytes), 0); stats.maxSql = Math.max(stats.maxSql, Buffer.byteLength(sql)); stats.maxStmtBytes = Math.max(stats.maxStmtBytes, pb + Buffer.byteLength(sql))
      stats.maxParams = Math.max(stats.maxParams, this.values.length)
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) stats.changed += Number(changes)
      return { success: true, results, meta: { changes } }
    }, async run() {
      const t = performance.now(); const r = db.prepare(sql).run(...this.values); stats.sqlMs += performance.now() - t
      stats.statements++; if (!stats.inBatch) stats.calls++; stats.changed += Number(r.changes)
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
    } }
  }
  return { prepare, async batch(statements) {
    stats.calls++; stats.batches++; stats.batchSizes.push(statements.length); stats.inBatch = true
    let batchBytes = 0; for (const s of statements) batchBytes += Buffer.byteLength(s.sql) + s.values.reduce((a, v) => a + bytes(v), 0)
    stats.maxBatchBytes = Math.max(stats.maxBatchBytes, batchBytes)
    db.exec('BEGIN')
    try { const result = []; for (const statement of statements) result.push(await statement.all()); db.exec('COMMIT'); return result }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
    finally { stats.inBatch = false }
  } }
}
const COUNTER = 900001
function reset() {
  db?.close(); db = new DatabaseSync(':memory:')
  for (const sql of loadAll()) db.exec(sql)
  const full = { inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
  db.prepare('INSERT INTO roles(id,name,code,permissions) VALUES(900001,?,?,?)').run('Counter', 'employee', JSON.stringify(full))
  db.exec("INSERT INTO roles(id,name,code,permissions) VALUES(900003,'Administrator','admin','{}')")
  db.exec("INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES(900001,'counter-one','Counter One','unused',900001,1),(900003,'admin-one','Admin One','unused',900003,1)")
  db.exec("INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1)")
  for (const actor of [COUNTER, 900003]) db.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)").run(actor, createHash('sha256').update('token-' + actor).digest('hex'))
}
const setSwitch = value => {
  db.exec("DELETE FROM system_flags WHERE key='read_switches'")
  db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, set_at: '2026-11-03T00:00:00.000Z', set_by: 1, switches: value }))
  resetReadSwitchMemo()
}
const NAME = 'ក្រែមលាបមុខ ស្បែកស ការពារកំដៅថ្ងៃ SPF50 PA+++ 50ml'
function seedProducts(count, datesEach, opts = {}) {
  const base = opts.base ?? 950000, emptyEach = opts.emptyEach ?? 0
  const out = []
  for (let p = 0; p < count; p++) {
    const productId = base + p, ids = []
    db.prepare('INSERT INTO products(id,name,stock_quantity,image_path,unit) VALUES(?,?,?,?,?)').run(productId, NAME + ' #' + p, datesEach * 3, 'products/2026/10/' + productId + '-a1b2c3d4e5f6.webp', 'pcs')
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run(productId, datesEach * 3)
    for (let n = 0; n < datesEach + emptyEach; n++) {
      const batchId = base * 10 + p * 100 + n
      db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES(?,?,?,?,1)').run(batchId, productId, 'b-' + batchId, '2026-10-26')
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(batchId, n < datesEach ? 3 : 0)
      ids.push({ batchId, quantity: n < datesEach ? 3 : 0 })
    }
    out.push({ productId, ids })
  }
  return out
}
async function send(method, url, body, actor = COUNTER, env = {}) {
  stats = { calls: 0, statements: 0, batches: 0, batchSizes: [], paramBytes: 0, maxParam: 0, maxSql: 0, maxStmtBytes: 0, maxBatchBytes: 0, maxParams: 0, changed: 0, sqlMs: 0, inBatch: false }
  const tasks = []
  const bodyText = body ? JSON.stringify(body) : undefined
  const cpu0 = process.cpuUsage(), t0 = performance.now()
  const init = { method, headers: { 'Content-Type': 'application/json', Cookie: 'bos_session=token-' + actor } }
  if (bodyText) init.body = bodyText
  const response = await sessionsRoute.request('http://local' + url, init, { DB: binding(), CACHE: { get: async () => null, put: async () => {}, delete: async () => {} }, ...env }, { waitUntil: task => tasks.push(task) })
  const json = await response.json()
  await Promise.allSettled(tasks)
  const cpu = process.cpuUsage(cpu0), wall = performance.now() - t0
  return { status: response.status, body: json, stats: { ...stats, bodyBytes: bodyText ? Buffer.byteLength(bodyText) : 0, cpuMs: (cpu.user + cpu.system) / 1000, wallMs: wall, jsMs: wall - stats.sqlMs } }
}

function seedPlain(count) {
  const out = []
  for (let p = 0; p < count; p++) {
    const productId = 960000 + p
    db.prepare('INSERT INTO products(id,name,stock_quantity,image_path,unit) VALUES(?,?,?,?,?)').run(productId, NAME + ' #' + p, 8, 'products/2026/10/' + productId + '-a1b2c3d4e5f6.webp', 'pcs')
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,8)').run(productId)
    out.push(productId)
  }
  return out
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
async function run(label, tier, build, repeats = 9) {
  const samples = []; let last
  for (let i = 0; i < repeats + 1; i++) {
    if (global.gc) global.gc() // run with --expose-gc: a collection inside the timed call is noise, not the route
    reset(); setSwitch({ ic_simple: 'on', ic_lot_counts: 'on', ic_wired: 'on', ic_fix_stock: 'on' })
    const lines = build()
    planTier.__resetPlanTierCacheForTests()
    last = await send('POST', '/submissions', { branchId: 1, requestId: 'measure-' + i + '-' + label.replace(/\W/g, '') + '-0001', lines }, COUNTER, { PLAN_TIER: tier })
    if (i > 0) samples.push(last.stats.jsMs)
  }
  console.log(label.padEnd(36), String(last.status).padEnd(4), String(last.body && last.body.code || '').padEnd(34), 'JS outside SQLite median', median(samples).toFixed(1).padStart(6), 'ms', ' (runs ' + samples.map(v => v.toFixed(1)).join(' ') + ')', ' D1 calls', last.stats.calls)
}

/** One issue by filter of the WHOLE catalogue (the worst filter), as the administrator: the median JS time outside SQLite of the runs, and the last answer. mode 'ranked' turns catalog_ranked_scope ON (production's state since 16 Nov). */
async function runIssue(tier, products, mode, repeats = 9) {
  const samples = []; let last
  for (let i = 0; i < repeats + 1; i++) {
    if (global.gc) global.gc()
    reset(); setSwitch({ ic_simple: 'on', ic_lot_counts: 'on', ic_wired: 'on', ic_fix_stock: 'on', ...(mode === 'ranked' ? { catalog_ranked_scope: 'on' } : {}) })
    require(path.join(HEAD, 'scripts/harness/seed-stock-fixture.cjs')).seedStockFixture(db, () => seedPlain(products))
    planTier.__resetPlanTierCacheForTests()
    last = await send('POST', '/tasks', { branchId: 1, requestId: 'measure-issue-' + i + '-' + products + '-0001', filters: {} }, 900003, { PLAN_TIER: tier })
    if (i > 0) samples.push(last.stats.jsMs)
  }
  return { status: last.status, body: last.body, calls: last.stats.calls, statements: last.stats.statements, medianMs: median(samples), samples }
}
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } }
module.exports = { runIssue }
if (require.main === module) (async () => {
  const tier = process.argv[2] || 'free', mode = process.argv[4] || 'page'
  await runIssue(tier, 50, mode, 1)
  for (const n of (process.argv[3] || '100,101,3000,6000').split(',').map(Number)) {
    const r = await runIssue(tier, n, mode)
    console.log(tier, mode, 'catalogue', String(n).padEnd(5), 'status', r.status, String(r.body && r.body.code || '').padEnd(30), 'total', String(r.body && r.body.total).padEnd(5), 'atLeast', String(r.body && r.body.atLeast).padEnd(5), 'JS median', r.medianMs.toFixed(1).padStart(6), 'ms', 'D1 calls', r.calls, 'statements', r.statements, 'runs', r.samples.map((v) => v.toFixed(1)).join(' '))
  }
})().catch((error) => { console.error(error); process.exit(1) })
