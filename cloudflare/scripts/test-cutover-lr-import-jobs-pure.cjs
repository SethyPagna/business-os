// CUTOVER-LR import jobs (owner ruling 6 Oct 2026): after the branch cutover "Old Shop" is disabled (successor
// LC Store). A sheet row addressed to it ("shop") is never silently redirected: the request that would move
// anything -- POST /api/import-jobs/:id/approve, or /:id/retry when it re-applies -- answers 409
// branch_redirect_required until it carries X-Branch-Redirect naming the active branch the operator confirmed;
// then the job keeps that target in its policy and the background apply lands every such row there, still
// addressed to Shop, re-proving the pair inside each write batch.
//
// The REAL routes/importJobs.ts and lib/importEngine.ts (and every module they use) run against an in-memory
// SQLite with every migration applied, through the real lib/db.ts D1Compat. The queue is drained by calling the
// real runImportAnalyze / runImportApply. Covered for each job type that moves stock or records a sale
// (products, inventory, sales, stock_actions):
//   * before the cutover (both branches active) the new code writes byte-identical business statements and ends
//     in identical rows -- an ORACLE world loads the import files exactly as they were at eb5dd0ba3 (the one
//     documented exception: the stock-action add batch gains its in-batch landing-branch guard, the closed loophole);
//   * after the cutover with no header: 409 branch_redirect_required with the redirect detail, the job stays in
//     review, and not one business row is written;
//   * an invalid target (the disabled branch itself, an unknown id): 409 branch_redirect_target_invalid;
//   * a valid header: applied at LC Store, Old Shop rows exactly 0 in both stock ledgers, the movements carry
//     addressed_branch_name, and the confirmed target is kept on the job;
//   * the oracle on the post-cutover world shows the defect the fix removes (the old code redirected silently).
//
// Run (from cloudflare/): node scripts/test-cutover-lr-import-jobs-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const ORACLE = 'da2004932b4510df0effee0399bc002b14d97372'
const ORACLE_FILES = new Set([
  'routes/importJobs.ts', 'lib/importEngine.ts', 'lib/importBranchAuthority.ts', 'lib/stockActionImport.ts',
  'lib/stockActionCatalog.ts', 'lib/stockActionCommit.ts', 'lib/salesImportCommit.ts',
])
const USER = { id: 71, username: 'owner', name: 'Owner', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const executionCtx = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }
const noop = async () => {}
const REPO_ROOT = path.join(__dirname, '..', '..')

// The engine's own timing lines are noise here.
const consoleLog = console.log
console.log = (...args) => { if (!/^\[import/.test(String(args[0] ?? ''))) consoleLog(...args) }

// Deterministic job ids, so the two worlds hash the same client_request_ids and receipt numbers.
let nextJobId = null
const realRandomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto)
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => nextJobId || realRandomUUID() })

function makeWorld(oracleSha = null) {
  const cache = new Map()
  const partial = {
    'lib/auth.ts': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
    'lib/audit.ts': { audit: noop },
    'durable-objects/broadcastHub.ts': { broadcast: noop },
    'lib/cache.ts': { bumpVersion: noop, bumpVersions: noop, getVersionWithFallback: async () => '0', cachedJsonResponse: async (_r, _c, _k, _t, loader) => loader() },
  }
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', 'src', rel)
    const text = oracleSha && ORACLE_FILES.has(rel)
      ? execFileSync('git', ['show', `${oracleSha}:cloudflare/src/${rel}`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      : fs.readFileSync(sourcePath, 'utf8')
    const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    if (partial[rel]) mod.exports = Object.assign({}, mod.exports, partial[rel])
    return mod.exports
  }
  return { app: load('routes/importJobs.ts').default, engine: load('lib/importEngine.ts') }
}

let template = null
function migratedDb() {
  if (!template) {
    const seed = new Database(':memory:')
    seed.pragma('foreign_keys = OFF')
    for (const migration of loadAll()) seed.exec(migration)
    template = seed.serialize()
    seed.close()
  }
  const db = new Database(template)
  db.pragma('foreign_keys = OFF')
  return db
}

// The D1 binding lib/db.ts wraps. Every write is captured in order: a batch as one entry, a run() as one statement.
function binding(sql, capture) {
  const bump = (text, changes) => (/INSERT\s+INTO\s+sales\s*\(/i.test(text) && changes > 0 ? changes + 1 : changes)
  return {
    prepare(text) {
      return {
        bind(...params) {
          return {
            text, params,
            async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
            async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
            async run() {
              if (!sql.prepare(text).reader) capture.push([{ sql: text, params }])
              const r = sqliteD1Call(sql.prepare(text), 'run', params)
              return { meta: { changes: bump(text, Number(r.changes)), last_row_id: Number(r.lastInsertRowid) } }
            },
          }
        },
      }
    },
    async batch(statements) {
      capture.push(statements.map((statement) => ({ sql: statement.text, params: statement.params })))
      return sql.transaction(() => statements.map((statement) => {
        if (sql.prepare(statement.text).reader) {
          return { results: sqliteD1Call(sql.prepare(statement.text), 'all', statement.params), meta: { changes: 0 } }
        }
        const r = sqliteD1Call(sql.prepare(statement.text), 'run', statement.params)
        return { meta: { changes: bump(statement.text, Number(r.changes)), last_row_id: Number(r.lastInsertRowid) } }
      }))()
    },
  }
}

function assets() {
  const objects = new Map()
  return {
    objects,
    async get(key, options) {
      const bytes = objects.get(key)
      if (!bytes) return null
      const offset = Number(options?.range?.offset || 0)
      const length = Number(options?.range?.length || bytes.byteLength)
      const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + length))
      return {
        size: bytes.byteLength,
        async arrayBuffer() { return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) },
        async text() { return Buffer.from(slice).toString('utf8') },
      }
    },
    async head(key) { return objects.has(key) ? { size: objects.get(key).byteLength } : null },
    async put(key, value) { objects.set(key, Buffer.from(value)) },
    async delete(keys) { for (const key of [].concat(keys)) objects.delete(key) },
    async list() { return { objects: [], truncated: false } },
  }
}

// Production ids: 1 = LC Store (formerly Warehouse), 2 = Shop. Product 10 "Serum" (ABC) with lots at both branches
// before; after the consolidation all of it is on LC Store (lot 500 folded into 600) and Old Shop holds nothing.
function seed(sql, state) {
  sql.exec('DELETE FROM branches')
  if (state === 'before') {
    sql.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Warehouse',1,1)").run()
    sql.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Shop',0,1)").run()
  } else {
    sql.prepare("INSERT INTO branches(id,name,is_default,is_active,role,canonical_key) VALUES(1,'LC Store',1,1,'shop','warehouse')").run()
    sql.prepare("INSERT INTO branches(id,name,is_default,is_active,role,canonical_key,successor_branch_id) VALUES(2,'Old Shop',0,0,'shop','shop',1)").run()
  }
  sql.prepare("INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(71,'owner','Owner','x',?,1)").run(JSON.stringify({ all: true }))
  sql.prepare(`INSERT INTO products(id,name,name_normalized,barcode,sku,unit,selling_price_usd,cost_price_usd,stock_quantity,is_active)
    VALUES(10,'Serum','serum','ABC','SER-1','pcs',12,4,?,1)`).run(state === 'before' ? 8 : 8)
  sql.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,supplier_name,received_quantity)
    VALUES(600,10,'lot-a','LOT-A','2026-08-01',1,1,4,'Acme',5)`).run()
  if (state === 'before') {
    sql.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,supplier_name,received_quantity)
      VALUES(500,10,'lot-b','LOT-B','2026-08-01',1,2,4,'Acme',3)`).run()
    sql.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,5),(10,2,3)').run()
    sql.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(600,1,5),(500,2,3)').run()
  } else {
    sql.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,8),(10,2,0)').run()
    sql.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(600,1,8)').run()
  }
}

const CSV = {
  products: 'name,barcode,branch,stock_quantity,cost_price_usd,selling_price_usd\nToner,TON-1,shop,4,2,5\n',
  inventory: 'barcode,name,branch,quantity,reason\nABC,Serum,shop,2,count\n',
  // The returned unit restocks the receipt's lot: LOT-B lived at Shop before the cutover; after it the fold put Old
  // Shop's units on LC Store's LOT-A, which is the lot a sheet names now.
  sales: (state) => `receipt_number,sale_date,branch,barcode,name,quantity,unit_price_usd,sale_status,returned_quantity,batch_label\nR-100,2026-09-01 10:00,shop,ABC,Serum,2,12,partial_return,1,${state === 'before' ? 'LOT-B' : 'LOT-A'}\n`,
  stock_actions: 'name,barcode,shop,warehouse,date,action,selling_price,cost_price,supplier\nSerum,ABC,2,1,09/02/2026,add,12,4,Acme\n',
}
const POLICY = { stock_actions: { stock_action_mode: 'direct' } }

async function world(state, { oracle = false } = {}) {
  const sql = migratedDb()
  seed(sql, state)
  const capture = []
  const queue = []
  const env = { DB: binding(sql, capture), ASSETS: assets(), IMPORT_QUEUE: { async send(message) { queue.push(message) } } }
  const w = makeWorld(oracle ? ORACLE : null)
  const request = async (method, url, body, redirect = null) => {
    const headers = { 'content-type': 'application/json', ...(redirect == null ? {} : { 'x-branch-redirect': String(redirect) }) }
    const response = await w.app.request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, executionCtx)
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { json = { error: text } }
    return { status: response.status, body: json }
  }
  const failures = []
  const drain = async () => {
    for (let guard = 0; queue.length && guard < 200; guard++) {
      const message = queue.shift()
      const run = message.kind === 'analyze' ? w.engine.runImportAnalyze : w.engine.runImportApply
      await run(env, message.jobId).catch((error) => failures.push(error))
    }
  }
  return { state, sql, env, capture, queue, request, drain, failures }
}

// Creates the job, gives it the CSV, runs the analysis to the review step.
async function analysed(w, type, jobId) {
  nextJobId = jobId
  const created = await w.request('POST', '/', { type, policy: POLICY[type] || {} })
  nextJobId = null
  assert.equal(created.status, 200, JSON.stringify(created.body))
  assert.equal(created.body.job.id, jobId)
  const key = `imports/${jobId}/incoming/sheet.csv`
  const bytes = Buffer.from(typeof CSV[type] === 'function' ? CSV[type](w.state) : CSV[type], 'utf8')
  w.env.ASSETS.objects.set(key, bytes)
  w.sql.prepare("INSERT INTO import_job_files(job_id,kind,original_name,stored_path,byte_size) VALUES(?,?,?,?,?)").run(jobId, 'csv', 'sheet.csv', key, bytes.byteLength)
  const started = await w.request('POST', `/${jobId}/start`, {})
  assert.equal(started.status, 200, JSON.stringify(started.body))
  await w.drain()
  const job = w.sql.prepare('SELECT status, last_error FROM import_jobs WHERE id = ?').get(jobId)
  assert.equal(job.status, 'awaiting_review', `${type}: analysis reaches review (${job.last_error || ''}) ${w.failures.map((e) => e.stack).join('\n')}`)
}

const approveBody = (type) => (type === 'stock_actions' ? { confirm_stock_actions: true } : {})

const BUSINESS = ['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'sales', 'sale_items', 'sale_item_batch_allocations', 'import_sales_commits', 'import_stock_action_commits']
const VOLATILE = new Set(['created_at', 'updated_at', 'applied_at', 'received_at', 'recorded_at', 'stock_skipped_at', 'creation_snapshot_json'])
function businessRows(sql) {
  const out = {}
  for (const table of BUSINESS) {
    out[table] = sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !VOLATILE.has(key))))
  }
  return out
}
const businessTableRe = new RegExp(`\\b(${BUSINESS.join('|')})\\b`, 'i')
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g
function businessWrites(capture) {
  return capture.map((batch) => batch.filter((statement) => businessTableRe.test(statement.sql) && !/\bimport_jobs\b/.test(statement.sql)))
    .filter((batch) => batch.length)
    .map((batch) => batch.map((statement) => JSON.stringify(statement).replace(ISO, 'TS')))
}
const oldShopRows = (sql) => ({
  stock: sql.prepare('SELECT COUNT(*) n FROM branch_stock WHERE branch_id = 2 AND quantity <> 0').get().n,
  lots: sql.prepare('SELECT COUNT(*) n FROM branch_batch_stock WHERE branch_id = 2').get().n,
  movements: sql.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE branch_id = 2').get().n,
  sales: sql.prepare('SELECT COUNT(*) n FROM sales WHERE branch_id = 2').get().n,
  saleItems: sql.prepare('SELECT COUNT(*) n FROM sale_items WHERE branch_id = 2').get().n,
})
const ZERO = { stock: 0, lots: 0, movements: 0, sales: 0, saleItems: 0 }

let checks = 0
const check = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`) }

async function main() {
  const TYPES = ['products', 'inventory', 'sales', 'stock_actions']

  for (const type of TYPES) {
    // ---- before the cutover: inert ------------------------------------------------------------------------------
    await check(`${type}: before the cutover the approve + apply writes byte-identical business statements and rows (oracle eb5dd0ba3)`, async () => {
      const results = []
      for (const oracle of [false, true]) {
        const w = await world('before', { oracle })
        await analysed(w, type, `job-before-${type}`)
        const mark = w.capture.length
        const approved = await w.request('POST', `/job-before-${type}/approve`, approveBody(type), 1)
        assert.equal(approved.status, 200, JSON.stringify(approved.body))
        await w.drain()
        const job = w.sql.prepare('SELECT status, policy_json, last_error FROM import_jobs WHERE id = ?').get(`job-before-${type}`)
        assert.match(job.status, /^completed/, `${type} applies (${job.last_error || ''})`)
        assert.ok(!/branch_redirect/.test(job.policy_json), 'no redirect key is ever recorded while every branch is active (the header was even sent)')
        results.push({ writes: businessWrites(w.capture.slice(mark)), rows: businessRows(w.sql) })
      }
      const [fresh, old] = results
      assert.deepEqual(fresh.rows, old.rows, `${type}: identical business rows`)
      if (type === 'stock_actions') {
        // The one deliberate addition: the add batch's in-batch guard that its landing branch is still active (the
        // closed loophole). Remove it and the rest is byte-identical.
        const isLandingGuard = (text) => /landing_branch_guard/.test(text)
        const added = fresh.writes.flat().filter(isLandingGuard)
        const adds = fresh.rows.inventory_movements.filter((movement) => movement.movement_type === 'add').length
        assert.ok(adds === 2 && added.length === adds, 'exactly one landing guard per applied add (shop 2 -> Shop, warehouse 1 -> Warehouse)')
        assert.deepEqual(fresh.writes.map((batch) => batch.filter((text) => !isLandingGuard(text))), old.writes, `${type}: otherwise byte-identical`)
      } else {
        assert.deepEqual(fresh.writes, old.writes, `${type}: byte-identical business statements`)
      }
    })

    // ---- after the cutover, no header: refused, nothing written --------------------------------------------------
    await check(`${type}: after the cutover approve without X-Branch-Redirect is 409 branch_redirect_required and writes nothing`, async () => {
      const w = await world('after')
      await analysed(w, type, `job-noheader-${type}`)
      const rowsBefore = businessRows(w.sql)
      const mark = w.capture.length
      const refused = await w.request('POST', `/job-noheader-${type}/approve`, approveBody(type))
      assert.equal(refused.status, 409, JSON.stringify(refused.body))
      assert.equal(refused.body.code, 'branch_redirect_required')
      assert.equal(refused.body.error, 'This change is addressed to a disabled branch. Choose the active branch it should go to. Nothing was changed.')
      assert.deepEqual(refused.body.redirect, {
        addressed_branch_id: 2, addressed_branch_name: 'Old Shop', successor_branch_id: 1, successor_branch_name: 'LC Store',
        targets: [{ id: 1, name: 'LC Store' }], requested_target_id: null,
      })
      assert.equal(w.capture.length, mark, 'the refusal writes no statement at all')
      assert.equal(w.queue.length, 0, 'nothing is queued')
      const job = w.sql.prepare('SELECT status, policy_json FROM import_jobs WHERE id = ?').get(`job-noheader-${type}`)
      assert.equal(job.status, 'awaiting_review', 'the job stays in review')
      assert.ok(!/branch_redirect/.test(job.policy_json))
      assert.deepEqual(businessRows(w.sql), rowsBefore, 'no business row changed')
    })

    // ---- after the cutover, invalid target ----------------------------------------------------------------------
    await check(`${type}: after the cutover an invalid target is 409 branch_redirect_target_invalid and writes nothing`, async () => {
      const w = await world('after')
      await analysed(w, type, `job-invalid-${type}`)
      const rowsBefore = businessRows(w.sql)
      for (const target of [2, 99]) {
        const mark = w.capture.length
        const refused = await w.request('POST', `/job-invalid-${type}/approve`, approveBody(type), target)
        assert.equal(refused.status, 409, JSON.stringify(refused.body))
        assert.equal(refused.body.code, 'branch_redirect_target_invalid', `target ${target}`)
        assert.equal(refused.body.redirect.requested_target_id, target)
        assert.deepEqual(refused.body.redirect.targets, [{ id: 1, name: 'LC Store' }])
        assert.equal(w.capture.length, mark)
      }
      assert.equal(w.queue.length, 0)
      assert.deepEqual(businessRows(w.sql), rowsBefore)
    })

    // ---- after the cutover, confirmed target: lands on LC Store, addressed to Shop --------------------------------
    await check(`${type}: after the cutover a confirmed X-Branch-Redirect applies at LC Store, addressed to Shop; Old Shop rows stay 0`, async () => {
      const w = await world('after')
      await analysed(w, type, `job-ok-${type}`)
      const approved = await w.request('POST', `/job-ok-${type}/approve`, approveBody(type), 1)
      assert.equal(approved.status, 200, JSON.stringify(approved.body))
      const policy = JSON.parse(w.sql.prepare('SELECT policy_json FROM import_jobs WHERE id = ?').get(`job-ok-${type}`).policy_json)
      assert.equal(policy.branch_redirect_target, 1, 'the confirmed target is kept with the job')
      assert.equal(policy.branch_redirect_addressed_id, 2)
      assert.equal(policy.branch_redirect_confirmed_by, 71)
      await w.drain()
      const job = w.sql.prepare('SELECT status, last_error FROM import_jobs WHERE id = ?').get(`job-ok-${type}`)
      assert.equal(job.status, 'completed', `${type} applies (${job.last_error || ''}) ${w.failures.map((e) => e.message).join('; ')}`)
      assert.deepEqual(oldShopRows(w.sql), ZERO, 'Old Shop receives nothing in either ledger')
      // Both ledgers agree at LC Store for every product touched.
      for (const { product_id: productId } of w.sql.prepare('SELECT DISTINCT product_id FROM branch_stock WHERE branch_id = 1').all()) {
        const aggregate = w.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1').get(productId).quantity
        const lots = w.sql.prepare('SELECT COALESCE(SUM(s.quantity),0) q FROM branch_batch_stock s JOIN product_batches b ON b.id = s.batch_id WHERE b.variant_product_id = ? AND s.branch_id = 1').get(productId).q
        assert.equal(lots, aggregate, `product ${productId}: lot ledger = branch_stock at LC Store`)
      }
      const redirectGuardSeen = w.capture.flat().some((statement) => /"addressed\\?":2,\\?"effect\\?":1/.test(JSON.stringify(statement.params)))
      assert.ok(redirectGuardSeen, 'the write batch re-proves the Old Shop -> LC Store pair')
      if (type === 'products') {
        const toner = w.sql.prepare("SELECT id FROM products WHERE barcode = 'TON-1'").get()
        assert.ok(toner, 'the product was created')
        assert.equal(w.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = 1').get(toner.id).quantity, 4)
      }
      if (type === 'inventory') {
        const movement = w.sql.prepare("SELECT branch_id, addressed_branch_name, reason, quantity FROM inventory_movements WHERE product_id = 10 ORDER BY id DESC LIMIT 1").get()
        assert.deepEqual([movement.branch_id, movement.addressed_branch_name, movement.quantity], [1, 'Shop', 2])
        assert.match(movement.reason, /addressed to Shop, stock recorded at LC Store/)
      }
      if (type === 'sales') {
        const sale = w.sql.prepare("SELECT id, branch_id, branch_name, notes FROM sales WHERE legacy_receipt_number = 'R-100' OR receipt_number = 'R-100'").get()
        assert.deepEqual([sale.branch_id, sale.branch_name], [1, 'LC Store'], 'the historical receipt is recorded at the confirmed branch')
        assert.match(sale.notes, /Import addressed to Shop/)
        const restock = w.sql.prepare("SELECT branch_id, addressed_branch_name, quantity FROM inventory_movements WHERE movement_type = 'return'").get()
        assert.deepEqual([restock.branch_id, restock.addressed_branch_name, restock.quantity], [1, 'Shop', 1], 'the returned unit goes back to LC Store, addressed to Shop')
        assert.equal(w.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 1').get().quantity, 9)
      }
      if (type === 'stock_actions') {
        const movement = w.sql.prepare("SELECT branch_id, addressed_branch_name, quantity, reason FROM inventory_movements WHERE movement_type = 'add'").get()
        assert.deepEqual([movement.branch_id, movement.addressed_branch_name, movement.quantity], [1, 'Shop', 3], 'shop 2 + warehouse 1 = one Add of 3 at LC Store')
        assert.match(movement.reason, /addressed to Shop, recorded at LC Store/)
        assert.equal(w.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 1').get().quantity, 11)
      }
    })

    // ---- the defect: the old code redirects silently ------------------------------------------------------------
    await check(`${type}: control -- the pre-change code applies the same post-cutover job with no confirmation at all`, async () => {
      const w = await world('after', { oracle: true })
      await analysed(w, type, `job-old-${type}`)
      const approved = await w.request('POST', `/job-old-${type}/approve`, approveBody(type))
      assert.equal(approved.status, 200, 'the old route never asked')
      await w.drain()
      const moved = w.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n + w.sql.prepare('SELECT COUNT(*) n FROM sales').get().n
        + w.sql.prepare("SELECT COUNT(*) n FROM products WHERE barcode = 'TON-1'").get().n
      assert.ok(moved > 0, 'it wrote business rows without the operator choosing a branch')
    })
  }

  // ---- a job analysed with no target cannot apply without one (the engine refuses, coded) --------------------------
  await check('apply without a confirmed target refuses with branch_redirect_required (no business row), and Retry then asks for the landing', async () => {
    for (const type of TYPES) {
      const w = await world('after')
      await analysed(w, type, `job-engine-${type}`)
      // Bypass the route gate on purpose: queue the apply as if approved, with no target on the job.
      w.sql.prepare("UPDATE import_jobs SET status = 'approved', phase = 'approved', policy_json = json_set(COALESCE(policy_json,'{}'), '$.apply_authorized_by_id', 71) WHERE id = ?").run(`job-engine-${type}`)
      const rowsBefore = businessRows(w.sql)
      w.queue.push({ jobId: `job-engine-${type}`, kind: 'apply' })
      await w.drain()
      const job = w.sql.prepare('SELECT status, last_error FROM import_jobs WHERE id = ?').get(`job-engine-${type}`)
      assert.equal(job.status, 'failed', type)
      assert.equal(job.last_error, 'This change is addressed to a disabled branch. Choose the active branch it should go to. Nothing was changed.', type)
      assert.deepEqual(businessRows(w.sql), rowsBefore, `${type}: nothing written`)
      // A Retry of a failed job re-analyses (importLifecycleGate); the approve after it is the confirmation point.
      const retry = await w.request('POST', `/job-engine-${type}/retry`, {})
      assert.equal(retry.status, 200, `${type}: ${JSON.stringify(retry.body)}`)
      await w.drain()
      assert.equal(w.sql.prepare('SELECT status FROM import_jobs WHERE id = ?').get(`job-engine-${type}`).status, 'awaiting_review', type)
      const refused = await w.request('POST', `/job-engine-${type}/approve`, approveBody(type))
      assert.equal(refused.status, 409, type)
      assert.equal(refused.body.code, 'branch_redirect_required')
      // A Retry that RE-APPLIES (an approved job) is a confirmation point of its own: same gate, same refusal.
      w.sql.prepare("UPDATE import_jobs SET status = 'approved', phase = 'approved' WHERE id = ?").run(`job-engine-${type}`)
      const reapply = await w.request('POST', `/job-engine-${type}/retry`, {})
      assert.equal(reapply.status, 409, `${type}: ${JSON.stringify(reapply.body)}`)
      assert.equal(reapply.body.code, 'branch_redirect_required')
      assert.equal(w.queue.length, 0, 'nothing queued by either refusal')
      const confirmed = await w.request('POST', `/job-engine-${type}/retry`, {}, 1)
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
      assert.equal(JSON.parse(w.sql.prepare('SELECT policy_json FROM import_jobs WHERE id = ?').get(`job-engine-${type}`).policy_json).branch_redirect_target, 1)
      await w.drain()
      assert.equal(w.sql.prepare('SELECT status FROM import_jobs WHERE id = ?').get(`job-engine-${type}`).status, 'completed', type)
      assert.deepEqual(oldShopRows(w.sql), ZERO, type)
    }
  })

  // ---- a row analysed BEFORE the cutover and approved after it ------------------------------------------------------
  await check('a job analysed while Shop was active and approved after the cutover is gated too (its analysed branch is now disabled)', async () => {
    const w = await world('before')
    await analysed(w, 'inventory', 'job-stale')
    // The cutover happens while the job waits for review.
    w.sql.exec("UPDATE branches SET name='LC Store', role='shop', canonical_key='warehouse' WHERE id=1")
    w.sql.exec("UPDATE branches SET name='Old Shop', role='shop', canonical_key='shop', is_active=0, successor_branch_id=1 WHERE id=2")
    const refused = await w.request('POST', '/job-stale/approve', {})
    assert.equal(refused.status, 409)
    assert.equal(refused.body.code, 'branch_redirect_required')
    assert.equal(refused.body.redirect.addressed_branch_id, 2)
    const approved = await w.request('POST', '/job-stale/approve', {}, 1)
    assert.equal(approved.status, 200)
    await w.drain()
    // The reviewed preview said Shop; the landing is now LC Store, so the existing review seal refuses the apply
    // (nothing written) and asks for a fresh analysis -- which previews the confirmed landing.
    const stale = w.sql.prepare("SELECT status, last_error FROM import_jobs WHERE id='job-stale'").get()
    assert.equal(stale.status, 'failed')
    assert.match(stale.last_error, /changed product, branch, direction, or quantity after review/)
    assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 0, 'nothing applied')
    const reanalyse = await w.request('POST', '/job-stale/retry', {})
    assert.equal(reanalyse.status, 200)
    await w.drain()
    const preview = JSON.parse(w.sql.prepare("SELECT result_json FROM import_job_rows WHERE job_id='job-stale' AND phase='analyze'").get().result_json)
    assert.deepEqual([preview.data.branch_id, preview.data.branch_redirect_addressed_id, preview.data.branch_redirect_pending], [1, 2, undefined], 'the fresh preview shows the confirmed landing, addressed to Old Shop')
    assert.equal((await w.request('POST', '/job-stale/approve', {})).status, 409, 'a new approve is a new confirmation')
    assert.equal((await w.request('POST', '/job-stale/approve', {}, 1)).status, 200)
    await w.drain()
    const done = w.sql.prepare("SELECT status, last_error FROM import_jobs WHERE id='job-stale'").get()
    assert.equal(done.status, 'completed', done.last_error)
    assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE branch_id = 2').get().n, 0)
    assert.equal(w.sql.prepare("SELECT addressed_branch_name FROM inventory_movements WHERE product_id = 10 ORDER BY id DESC LIMIT 1").get().addressed_branch_name, 'Shop')
  })

  // ---- a row that reaches LC Store directly needs no confirmation ---------------------------------------------------
  await check('after the cutover a sheet that only names warehouse / store applies with no header (nothing addressed to a disabled branch)', async () => {
    const w = await world('after')
    CSV.inventory_direct = 'barcode,name,branch,quantity,reason\nABC,Serum,warehouse,2,count\n'
    const original = CSV.inventory
    CSV.inventory = CSV.inventory_direct
    try {
      await analysed(w, 'inventory', 'job-direct')
    } finally { CSV.inventory = original }
    const approved = await w.request('POST', '/job-direct/approve', {})
    assert.equal(approved.status, 200, JSON.stringify(approved.body))
    await w.drain()
    const movement = w.sql.prepare('SELECT branch_id, addressed_branch_name FROM inventory_movements ORDER BY id DESC LIMIT 1').get()
    assert.deepEqual([movement.branch_id, movement.addressed_branch_name], [1, null])
    assert.ok(!/branch_redirect/.test(w.sql.prepare("SELECT policy_json FROM import_jobs WHERE id='job-direct'").get().policy_json))
  })

  // ---- a client cannot pre-seed the confirmed target ---------------------------------------------------------------
  await check('a client-supplied policy never carries the confirmed target (stripped at create)', async () => {
    const w = await world('after')
    nextJobId = 'job-seeded'
    const created = await w.request('POST', '/', { type: 'inventory', policy: { branch_redirect_target: 1, branch_redirect_confirmed_by: 1, keep: 'me' } })
    nextJobId = null
    assert.equal(created.status, 200)
    assert.deepEqual(JSON.parse(w.sql.prepare("SELECT policy_json FROM import_jobs WHERE id='job-seeded'").get().policy_json), { keep: 'me' })
  })

  console.log(`\n${checks} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
