'use strict'
// MEASUREMENT, not a test (the name does not start with test-, so the sweep never runs it): how much JavaScript time one Inventory Check count submission spends OUTSIDE SQLite, by shape.
// It runs the real route on real SQLite under NODE on a developer machine: the figures are relative (compare shapes and before/after), not Cloudflare milliseconds. Free allows 10 ms of CPU per invocation.
// Run: node scripts/measure-inventory-check-submission-cpu.cjs [free|paid] [shapes like 20x1,100x4]
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
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  for (const file of ['0259_inventory_check_sessions.sql', '0285_inventory_check_items_latest.sql', '0286_inventory_check_approvals.sql', '0294_inventory_check_lot_lines.sql', '0316_inventory_check_line_decisions.sql', '0318_inventory_check_task_index.sql', '0319_inventory_check_open_task_index.sql']) db.exec(fs.readFileSync(path.join(HEAD, 'migrations', file), 'utf8'))
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
const dated = (products, datesEach) => () => seedProducts(products, datesEach).map(({ productId, ids }) => ({ productId, lots: ids.map(({ batchId, quantity }) => ({ batchId, scope: 'lot', counted: quantity + 1, seen: quantity })) }))
const plain = products => () => seedPlain(products).map(productId => ({ productId, countedQuantity: 9, seenQuantity: 8, checked: false }))
;(async () => {
  const tier = process.argv[2] || 'free'
  await run('warm-up', tier, dated(2, 2), 1)
  const shapes = (process.argv[3] || '1x1,20x1,40x1,41x1,40x10,20x20,100x4,400x1').split(',').map(text => text.split('x').map(Number))
  for (const [products, dates] of shapes) await run(tier + ' ' + products + ' products x ' + dates + ' dates', tier, dated(products, dates))
  for (const products of [20, 40, 41, 100, 500]) await run(tier + ' ' + products + ' plain products', tier, plain(products))
})().catch(error => { console.error(error); process.exit(1) })
