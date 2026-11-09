// The real /api/inventory and /api/batches routes with the real stock writers over an in-memory SQLite that holds every migration (INV S6). Only the Worker-runtime
// seams are stubbed (session, KV cache versions, broadcast, telegram). `cacheBumps` lists every cache version bump the routes make, in order.
//
//   const w = createLotSetWorld(); const f = w.world(); await w.call(f, 'POST', '/api/inventory/adjust', { ... })
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { Hono } = require('hono')
const { createHash } = require('node:crypto')
const { sqliteD1Call } = require('./sqlite_d1_bindings.cjs')
const { seedStockFixture } = require('./seed-stock-fixture.cjs')

const root = path.resolve(__dirname, '..', '..')

// options.admin: the acting user is an administrator with a real user row and session (the count approvals route checks its actor and session against the database).
const TOKEN = 'approver-token-0001'
function createLotSetWorld(options = {}) {
  const actor = options.admin
    ? { id: 7, username: 'stock-user', name: 'Stock User', organization_id: null, role_id: 1, role_code: 'admin', role_permissions: '{}', permissions: '{}', is_active: 1, ...(options.actor || {}) }
    : { id: 7, username: 'stock-user', name: 'Stock User', organization_id: null, role_id: null,
      permissions: JSON.stringify({ inventory: true, products: true, product_cost_edit: true, product_cost_view: true }), is_active: 1, ...(options.actor || {}) }
  const cacheBumps = []
  const cache = new Map()
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports
    const file = path.join(root, 'src', relative)
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
    const module = { exports: {} }
    cache.set(relative, module)
    // import('./x') of a module in src is resolved like the static imports.
    new Function('require', 'module', 'exports', compiled.replace(/\bimport\(([^)]+)\)/g, 'Promise.resolve().then(() => require($1))'))(request => {
      if (request === '../lib/auth' || request === './auth') return { requireAuth: async (c, next) => { c.set('user', actor); await next() } }
      if (request === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
      if (request === './cache' || request === '../lib/cache') return { bumpVersion: async (_env, namespace) => { cacheBumps.push(namespace) }, bumpVersions: async (_env, list) => { cacheBumps.push(...list) }, getVersion: async () => 0,
        cacheKey: (...args) => args.join(':'), cachedJson: async (c, key, ttl, fn) => c.json(await fn()) }
      if (request === './telegram' || request === '../lib/telegram') return { sendTelegramEvent: async () => {}, formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [] }
      if (request.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), request)) + '.ts')
      return require(request)
    }, module, module.exports)
    return module.exports
  }
  const { D1Compat } = load('lib/db.ts')
  const lot = load('lib/stockLotAdjustment.ts')
  const app = new Hono()
  app.route('/api/inventory', load('routes/inventory.ts').default)
  app.route('/api/batches', load('routes/batches.ts').default)
  if (options.admin) app.route('/api/inventory-checks', load('routes/inventoryChecks.ts').default)

  // Fixture: product 1 with received dates 10 (3 units, 2026-09-02) and 11 (7 units, 2026-09-09) at branch 1; branch 2 exists and is empty.
  function world({ switches } = {}) {
    lot.resetStockLotSetSchemaProbe()
    load('lib/stockMutationReceipt.ts').resetStockMutationReceiptSchemaProbe()
    load('lib/readSwitches.ts').resetReadSwitchMemo()
    const raw = new DatabaseSync(':memory:')
    raw.limits.exprDepth = 100
    raw.exec('PRAGMA foreign_keys=OFF')
    for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
    seedStockFixture(raw, () => raw.exec(`INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Store',0,1);
      INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(1,'Serum','SER',2,0,10,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10);
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active)
        VALUES(10,1,'OLD','OLD','2026-09-02',1,3,1),(11,1,'NEW','NEW','2026-09-09',2,5,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(10,1,3),(11,1,7);`))
    raw.exec('PRAGMA foreign_keys=ON')
    const control = { before: null, beforeMatch: null, batches: 0, calls: 0 }
    function prepared(sql, values = []) {
      const execute = () => {
        assert(values.length <= 100, 'D1 bind limit')
        const statement = raw.prepare(sql)
        if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { success: true, results: sqliteD1Call(statement, 'all', values), meta: { changes: 0 } }
        if (/\bRETURNING\b/i.test(sql)) {
          const results = sqliteD1Call(statement, 'all', values)
          return { success: true, results, meta: raw.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get() }
        }
        const r = sqliteD1Call(statement, 'run', values)
        return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
      }
      const counted = fn => async () => { control.calls++; return fn() }
      return { bind: (...bound) => prepared(sql, bound), first: counted(async () => execute().results[0] || null), all: counted(async () => execute()), run: counted(async () => execute()), execute, sql }
    }
    const env = { DB: { prepare: prepared, batch: async statements => {
      control.batches++; control.calls++
      if (control.before && (!control.beforeMatch || control.beforeMatch(statements))) { const action = control.before; control.before = null; action(raw, statements) }
      raw.exec('BEGIN IMMEDIATE')
      try { const results = statements.map(statement => statement.execute()); raw.exec('COMMIT'); return results }
      catch (error) { raw.exec('ROLLBACK'); throw error }
    } } }
    if (options.admin) {
      raw.exec(`INSERT INTO roles(id,name,code,permissions) VALUES(1,'Administrator','admin','{}');
        INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES(7,'stock-user','Stock User','unused',1,NULL),(8,'counter-user','Counter User','unused',1,NULL)`)
      raw.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(7,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)").run(createHash('sha256').update(TOKEN).digest('hex'))
    }
    if (switches) raw.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, set_at: '2026-11-09T00:00:00.000Z', set_by: 1, switches }))
    return { raw, env, db: new D1Compat(env.DB), control }
  }
  /** Seeds rows through the stock-transaction permit the triggers demand. */
  const seed = (f, sql) => seedStockFixture(f.raw, () => f.raw.exec(sql))
  const setSwitches = (f, switches) => {
    f.raw.exec("DELETE FROM system_flags WHERE key='read_switches'")
    if (switches) f.raw.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, set_at: '2026-11-09T00:00:00.000Z', set_by: 1, switches }))
    load('lib/readSwitches.ts').resetReadSwitchMemo()
  }
  async function call(f, method, url, body, env = {}) {
    const pending = []
    const response = await app.request(url, { method, headers: { 'content-type': 'application/json', cookie: `bos_session=${TOKEN}` }, body: body === undefined ? undefined : JSON.stringify(body) }, { ...f.env, ...env }, { waitUntil: p => pending.push(p), passThroughOnException() {} })
    await Promise.allSettled(pending)
    return { status: response.status, body: await response.json() }
  }
  const snapshot = f => JSON.stringify(['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'stock_lot_adjustment_operations', 'stock_mutation_receipts', 'action_history', 'audit_logs', 'damaged_stock_lots']
    .filter(table => f.raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
    .map(table => [table, f.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  /** A waiting count of one product at one branch: a session, its item line and a pending approval (the shape the submission writes). */
  function waitingCount(f, { productId = 1, branchId = 1, session = 'waiting-session-1', seen = 10, counted = 8 } = {}) {
    f.raw.exec('PRAGMA foreign_keys=OFF')
    f.raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
      VALUES(?,NULL,?,7,'','closed',0,'{}','2026-11-09T01:00:00.000Z','2026-11-09T01:00:00.000Z','2026-11-09T01:00:00.000Z')`).run(session, branchId)
    f.raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      VALUES(?,?,?,'{}',?,'{}','issue',?,'miscount',1,7,'2026-11-09T01:00:00.000Z')`).run(session, productId, branchId, seen, counted)
    f.raw.prepare(`INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json)
      VALUES(?,NULL,?,'pending',1,7,'2026-11-09T01:00:00.000Z',?)`).run(session, branchId, JSON.stringify({ [productId]: seen }))
    f.raw.exec('PRAGMA foreign_keys=ON')
  }
  /**
   * A waiting count per received date, as the submission writes it: the product's item (counted = the sum of the lines, baseline = the sum of the seen figures), one lot line per date and
   * a pending approval. lines: [[batchId, counted, seen], ...]; batchId 0 is a branch-total line.
   */
  function dateCount(f, { productId = 1, branchId = 1, session = 'dated-session-1', lines, submittedBy = 8 } = {}) {
    const counted = lines.reduce((sum, line) => sum + line[1], 0), seen = lines.reduce((sum, line) => sum + line[2], 0)
    f.raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
      VALUES(?,NULL,?,?,'','closed',0,'{}','2026-11-09T01:00:00.000Z','2026-11-09T01:00:00.000Z','2026-11-09T01:00:00.000Z')`).run(session, branchId, submittedBy)
    f.raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      VALUES(?,?,?,'{}',?,'{}','issue',?,'Count differs from stock',1,?,'2026-11-09T01:00:00.000Z')`).run(session, productId, branchId, seen, counted, submittedBy)
    for (const [batchId, lineCounted, lineSeen] of lines) {
      f.raw.prepare(`INSERT INTO inventory_check_lot_lines(session_id,product_id,branch_id,batch_id,scope,seen_quantity,counted_quantity,seen_source,created_at)
        VALUES(?,?,?,?,?,?,?,'screen','2026-11-09T01:00:00.000Z')`).run(session, productId, branchId, batchId, batchId === 0 ? 'branch' : 'lot', lineSeen, lineCounted)
    }
    f.raw.prepare(`INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json)
      VALUES(?,NULL,?,'pending',1,?,'2026-11-09T01:00:00.000Z',?)`).run(session, branchId, submittedBy, JSON.stringify({ [productId]: seen }))
  }
  return { actor, load, lot, app, world, seed, setSwitches, call, snapshot, waitingCount, dateCount, cacheBumps, resetBumps: () => { cacheBumps.length = 0 } }
}

module.exports = { createLotSetWorld }
