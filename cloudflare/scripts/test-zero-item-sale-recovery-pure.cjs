const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const USER = { id: 91, username: 'recovery_admin', name: 'Recovery Admin', permissions: JSON.stringify({ backup_restore: true }) }
let currentUser = USER
let backupCalls = 0
let failBackup = false
let beforeBackup = null
const moduleCache = new Map()

function routeDb(db, hooks = {}) {
  let batchCommitted = false
  const api = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        all: (params) => statement.all(params),
        get: (params) => {
          if (batchCommitted && hooks.failReceiptReadAfterBatch && /FROM sale_incident_recovery_receipts/i.test(sql)) throw new Error('simulated receipt read failure')
          if (batchCommitted && hooks.failAfterStateReadAfterBatch && /AS matched_items/i.test(sql)) throw new Error('simulated after-state read failure')
          return statement.get(params)
        },
        run: async (params) => {
          const result = statement.run(params)
          return { changes: Number(result.meta?.changes || 0), lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
    batch: async (statements) => {
      const result = await db.batch(statements)
      batchCommitted = true
      if (hooks.afterBatchThrow) throw new Error('simulated lost D1 response')
      return result
    },
  }
  api.staging = api
  return api
}

const overrides = {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() } },
  '../lib/permissions': { hasPermission: (user, key) => Boolean(JSON.parse(user?.permissions || '{}')[key]) },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/audit': { audit: async () => {} },
  '../lib/dataIntegrity': { runDataIntegrityCheck: async () => ({}) },
  '../lib/r2': { listObjects: async () => [], deleteObject: async () => {}, deleteObjectsBulk: async () => ({}) },
  '../lib/importRetention': { cleanOrphanImportStaging: async () => ({}) },
  '../lib/media': { sanitizeMediaList: (value) => value },
  '../lib/coreDataInvariants': { ensureCoreDataInvariants: async () => {}, dropAllCustomTables: async () => {}, FACTORY_RESET_TABLES: [], PRODUCTS_RESET_TABLES: [] },
  '../lib/backup': {
    createCloudflareBackup: async () => ({}),
    createSectionBackup: async () => {
      backupCalls += 1
      if (failBackup) throw new Error('forced backup failure')
      if (beforeBackup) await beforeBackup()
      return {}
    },
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => 1 },
  '../lib/errorReporting': { reportError: async () => false },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/actorSnapshot': { actorSnapshot: (user) => user?.username || user?.name || 'unknown' },
}

function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const app = load('routes/system.ts').default
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
const SPECS = [
  { id: 16951, receipt: '20260909-101913', status: 'completed', updated: '2026-09-09 03:19:13', revision: 1, product: 4208, name: 'Maybelline Loose Powder 05', qty: 36, price: 9.5, total: 342 },
  { id: 16952, receipt: '20260909-104116', status: 'awaiting_payment', updated: '2026-09-09T03:55:19.857Z', revision: 6, product: 859, name: 'Chanel Set Limited', qty: 1, price: 299, total: 299 },
  { id: 16953, receipt: '20260909-111455', status: 'awaiting_payment', updated: '2026-09-09 04:14:55', revision: 1, products: [{ product: 409, name: 'Canmake Eyeliner Dark Brown 03', price: 13 }, { product: 3490, name: 'Lancôme Idole Mascara 8ml', price: 27 }] },
]
const PRODUCTS = [
  { id: 409, name: 'Canmake Eyeliner Dark Brown 03', cost: 6.5, stock: 9, updated: '2026-09-08 08:45:26', branch: 3, batch: 51466, bbs: 58719, lot: 'ADJ09/02/2026' },
  { id: 859, name: 'Chanel Set Limited', cost: 280, stock: 1, updated: '2026-09-02T15:30:00.000Z', branch: 1, batch: 53462, bbs: 62711, lot: 'ADJ09/02/2026' },
  { id: 3490, name: 'Lancôme Idole Mascara 8ml', cost: 18, stock: 3, updated: '2026-09-02T15:30:00.000Z', branch: 3, batch: 51280, bbs: 58347, lot: 'ADJ09/02/2026' },
  { id: 4208, name: 'Maybelline Loose Powder 05', cost: 9.55, stock: 288, updated: '2026-09-08T15:19:49.111Z', branch: 96, batch: 61143, bbs: 77975, lot: '09082026' },
]

function fixture(hooks = {}) {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Shop',1,1)").run()
  for (const product of PRODUCTS) {
    db.prepare(`INSERT INTO products(id,name,stock_quantity,cost_price_usd,cost_price_khr,is_active,updated_at) VALUES(@id,@name,@stock,@cost,0,1,@updated)`).run(product)
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(@id,2,@branch)').run(product)
    db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,updated_at) VALUES(@batch,@id,@key,@lot,'2026-09-02',1,'2026-09-02')`).run({ ...product, key: `recovery-${product.id}` })
    db.prepare('INSERT INTO branch_batch_stock(id,batch_id,branch_id,quantity,updated_at) VALUES(@bbs,@batch,2,@branch,@updated)').run(product)
  }
  for (const spec of SPECS) {
    const products = spec.products || [{ product: spec.product, name: spec.name, price: spec.price }]
    const snapshotProducts = products.map((entry) => ({ product_id: entry.product, product: entry.name, sku: null, quantity: spec.qty || 1, unit_price_usd: entry.price, line_total_usd: entry.price * (spec.qty || 1) }))
    const subtotal = spec.id === 16952 ? 0 : (spec.total || 40)
    db.prepare(`INSERT INTO sales(id,receipt_number,client_request_id,cashier_id,branch_id,customer_id,payment_method,payment_details,payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,change_is_actual,membership_discount_usd,membership_discount_khr,membership_points_redeemed,is_delivery,delivery_fee_usd,delivery_fee_khr,delivery_fee_paid_by,delivery_actual_cost_usd,delivery_actual_cost_khr,loyalty_accrual,sale_status,stock_skipped,created_at,updated_at,creation_snapshot_json)
      VALUES(@id,@receipt,@client,4,2,99,@payment,@details,'USD',4065,@subtotal,@subtotal_khr,0,0,0,0,@subtotal,@subtotal_khr,@paid,0,@change,@change_khr,0,0,0,0,@delivery,@fee,@fee_khr,@fee_by,@actual,@actual_khr,0,@status,0,@created,@updated,@snapshot)`).run({
      id: spec.id, receipt: spec.receipt, client: `sale-${spec.id}`, payment: spec.id === 16951 ? 'ABA' : '', details: spec.id === 16951 ? '[{"method":"ABA","amount_usd":342,"amount_khr":0}]' : '[]',
      subtotal, subtotal_khr: subtotal * 4065, paid: spec.id === 16951 ? 342 : 0,
      change: spec.id === 16953 ? -40 : 0, change_khr: spec.id === 16953 ? -160000 : 0,
      delivery: spec.id === 16951 || spec.id === 16952 ? 1 : 0,
      fee: spec.id === 16951 ? 1.5 : spec.id === 16952 ? 2.7 : 0,
      fee_khr: spec.id === 16951 ? 6098 : spec.id === 16952 ? 10975.5 : 0,
      fee_by: spec.id === 16951 || spec.id === 16952 ? 'store' : 'customer',
      actual: spec.id === 16951 ? 1.5 : spec.id === 16952 ? 2.7 : null,
      actual_khr: spec.id === 16951 ? 6098 : spec.id === 16952 ? 10975.5 : null,
      status: spec.status, created: spec.updated, updated: spec.updated,
      snapshot: JSON.stringify({ version: 1, origin: 'pos', products: snapshotProducts }),
    })
  }
  db.prepare(`INSERT INTO sale_amendments(id,sale_id,kind,amount_before_usd,amount_after_usd,amount_delta_usd,total_before_usd,total_after_usd,created_at) VALUES(13,16952,'delivery_actual_cost_changed',2.6,2.7,0.1,299,299,'2026-09-09 03:55:04')`).run()
  db.prepare(`INSERT INTO sale_amendments(id,sale_id,kind,amount_before_usd,amount_after_usd,amount_delta_usd,total_before_usd,total_after_usd,created_at) VALUES(14,16952,'delivery_fee_changed',2.6,2.7,0.1,299,0,'2026-09-09 03:55:19')`).run()
  for (const id of [13, 14]) db.prepare(`INSERT INTO sale_mutation_receipts(id,actor_id,sale_id,mutation_kind,request_id,request_digest,request_json,before_json,after_json,response_json,sale_revision) VALUES(@id,4,16952,'amendment',@request,'digest','{}','{}','{}','{}',@revision)`).run({ id: `amend-${id}`, request: `amend-request-${id}`, revision: id === 13 ? 4 : 6 })
  db.prepare('UPDATE sale_write_revisions SET revision=1 WHERE sale_id IN (16951,16953)').run()
  db.prepare('UPDATE sale_write_revisions SET revision=6 WHERE sale_id=16952').run()
  const routed = routeDb(db, hooks)
  return { raw: db, route: routed, env: { DB: routed, CACHE: { async get() { return null }, async put() {} } } }
}

async function call(env, route, options = {}) {
  const response = await app.request(route, options, env, ctx)
  return { status: response.status, headers: response.headers, body: await response.json() }
}

function state(db) {
  return {
    items: Number(db.prepare('SELECT COUNT(*) n FROM sale_items WHERE sale_id IN (16951,16952,16953)').get().n),
    allocations: Number(db.prepare('SELECT COUNT(*) n FROM sale_item_batch_allocations').get().n),
    movements: Number(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE movement_type='sale'").get().n),
    receipts: Number(db.prepare('SELECT COUNT(*) n FROM sale_incident_recovery_receipts').get().n),
    histories: Number(db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity='sale_incident_recovery'").get().n),
    audits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='recover_missing_sale_items'").get().n),
    product4208: Number(db.prepare('SELECT stock_quantity n FROM products WHERE id=4208').get().n),
    branch4208: Number(db.prepare('SELECT quantity n FROM branch_stock WHERE product_id=4208 AND branch_id=2').get().n),
    batch4208: Number(db.prepare('SELECT quantity n FROM branch_batch_stock WHERE id=77975').get().n),
  }
}

;(async () => {
  {
    const db = openDb(loadAll())
    const history = db.prepare("INSERT INTO action_history(label,reversible,status) VALUES('future v2 schema proof',0,'recorded')").run()
    db.prepare(`INSERT INTO sale_incident_recovery_receipts(id,incident_key,actor_id,actor_name,request_digest,request_json,before_json,after_json,response_json,backup_created) VALUES('v2-proof','sale-zero-items-20260909-v2',91,'Recovery Admin','digest','{}','{}','{}','{}',1)`).run()
    db.prepare(`INSERT INTO sale_incident_recovery_members(operation_id,sale_id,history_id,before_json,after_json) VALUES('v2-proof',16954,@history,'{}','{}')`).run({ history: Number(history.meta.last_row_id) })
    assert.equal(db.prepare('SELECT sale_id FROM sale_incident_recovery_members').get().sale_id, 16954)
    assert.throws(() => db.prepare("UPDATE sale_incident_recovery_receipts SET response_json='{}' WHERE id='v2-proof'").run(), /append-only/)
    assert.throws(() => db.prepare("DELETE FROM sale_incident_recovery_members WHERE operation_id='v2-proof'").run(), /append-only/)
    await db.batch([
      { sql: `INSERT INTO system_flags(key,value) VALUES('sale_incident_recovery_reset_guard','{"mode":"reset","token":"test"}')` },
      { sql: "DELETE FROM sale_incident_recovery_members WHERE operation_id='v2-proof'" },
      { sql: "DELETE FROM sale_incident_recovery_receipts WHERE id='v2-proof'" },
      { sql: "DELETE FROM system_flags WHERE key='sale_incident_recovery_reset_guard'" },
    ])
    db.prepare(`INSERT INTO sale_incident_recovery_receipts(id,incident_key,actor_id,actor_name,request_digest,request_json,before_json,after_json,response_json,backup_created) VALUES('v2-restore','sale-zero-items-20260909-v2',91,'Recovery Admin','digest','{}','{}','{}','{}',1)`).run()
    db.prepare(`INSERT INTO sale_incident_recovery_members(operation_id,sale_id,history_id,before_json,after_json) VALUES('v2-restore',16954,@history,'{}','{}')`).run({ history: Number(history.meta.last_row_id) })
    db.prepare(`INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`).run()
    db.prepare("DELETE FROM sale_incident_recovery_members WHERE operation_id='v2-restore'").run()
    db.prepare("DELETE FROM sale_incident_recovery_receipts WHERE id='v2-restore'").run()
    db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
    console.log('PASS migration 0145 reserves v2 and makes receipts append-only outside guarded reset/restore')
  }
  {
    const f = fixture()
    currentUser = { ...USER, permissions: '{}' }
    const denied = await call(f.env, '/sale-incident-recovery-20260909/preview')
    currentUser = USER
    assert.equal(denied.status, 403)
    assert.deepEqual(state(f.raw), { items: 0, allocations: 0, movements: 0, receipts: 0, histories: 0, audits: 0, product4208: 288, branch4208: 96, batch4208: 96 })
    console.log('PASS recovery preview requires backup_restore permission before reads or writes')
  }

  {
    const f = fixture()
    backupCalls = 0
    const preview = await call(f.env, '/sale-incident-recovery-20260909/preview')
    assert.equal(preview.status, 200, JSON.stringify(preview.body))
    assert.equal(preview.headers.get('cache-control'), 'no-store')
    assert.deepEqual(Object.keys(preview.body.request).sort(), ['confirmation', 'manifest_sha256', 'target'])
    assert.deepEqual(preview.body.sales.map((sale) => sale.id), [16951, 16952, 16953])
    assert.deepEqual(preview.body.blocked_sales, [{ id: 16954, receipt_number: '20260909-130228', reason: 'sale_time_cost_not_proven' }])
    assert.equal(preview.body.sales[1].total_before_usd, 0)
    assert.equal(preview.body.sales[1].total_after_usd, 299)
    const applied = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(applied.body.outcome, 'applied')
    assert.deepEqual(applied.body.affected, { sales: 3, items: 4, allocations: 4, movements: 1, histories: 3, audits: 3 })
    assert.deepEqual(state(f.raw), { items: 4, allocations: 4, movements: 1, receipts: 1, histories: 3, audits: 3, product4208: 252, branch4208: 60, batch4208: 60 })
    const sale16952 = f.raw.prepare('SELECT subtotal_usd,total_usd,delivery_fee_usd,delivery_actual_cost_usd FROM sales WHERE id=16952').get()
    assert.deepEqual({ ...sale16952 }, { subtotal_usd: 299, total_usd: 299, delivery_fee_usd: 2.7, delivery_actual_cost_usd: 2.7 })
    const unknowns = f.raw.prepare('SELECT price_mode,base_price_usd,base_price_khr,product_discount_usd,manual_discount_usd FROM sale_items WHERE sale_id=16951').get()
    assert.deepEqual({ ...unknowns }, { price_mode: null, base_price_usd: null, base_price_khr: null, product_discount_usd: 0, manual_discount_usd: 0 })
    assert.equal(backupCalls, 1)
    f.raw.prepare("UPDATE sales SET sale_status='completed' WHERE id=16953").run()
    f.raw.prepare('UPDATE products SET stock_quantity=251 WHERE id=4208').run()
    f.raw.prepare('UPDATE branch_stock SET quantity=59 WHERE product_id=4208 AND branch_id=2').run()
    f.raw.prepare('UPDATE branch_batch_stock SET quantity=59 WHERE id=77975').run()
    const replay = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.outcome, 'already_applied')
    assert.equal(backupCalls, 1, 'exact replay must not take a second backup')
    assert.equal(state(f.raw).items, 4)
    assert.equal(f.raw.prepare('SELECT sale_status FROM sales WHERE id=16953').get().sale_status, 'completed')
    assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=4208').get().stock_quantity, 251)
    console.log('PASS apply preserves sale16952 and receipt replay neither rejects nor overwrites legitimate later changes')
  }

  {
    const f = fixture()
    const preview = await call(f.env, '/sale-incident-recovery-20260909/preview')
    f.raw.prepare("UPDATE sales SET updated_at='2026-09-09 07:00:00' WHERE id=16953").run()
    const stale = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.equal(state(f.raw).items, 0)
    console.log('PASS stale sale revision/header state rejects the held manifest before backup or mutation')
  }

  {
    const f = fixture()
    const preview = await call(f.env, '/sale-incident-recovery-20260909/preview')
    beforeBackup = () => f.raw.prepare("UPDATE product_batches SET lot_code='CHANGED-AFTER-PREVIEW' WHERE id=61143").run()
    const stale = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(preview.body.request),
    })
    beforeBackup = null
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.deepEqual(state(f.raw), { items: 0, allocations: 0, movements: 0, receipts: 0, histories: 0, audits: 0, product4208: 288, branch4208: 96, batch4208: 96 })
    console.log('PASS lot label race during backup is rejected by the in-batch fingerprint and typed stale recheck')
  }

  {
    const f = fixture({ afterBatchThrow: true })
    const preview = await call(f.env, '/sale-incident-recovery-20260909/preview')
    const recovered = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body))
    assert.equal(recovered.body.outcome, 'applied')
    assert.equal(state(f.raw).receipts, 1)
    assert.equal(state(f.raw).items, 4)
    console.log('PASS lost D1 response reconciles the exact committed receipt without a second mutation')
  }

  {
    const f = fixture({ afterBatchThrow: true, failReceiptReadAfterBatch: true })
    const preview = await call(f.env, '/sale-incident-recovery-20260909/preview')
    const uncertain = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(uncertain.status, 202, JSON.stringify(uncertain.body))
    assert.equal(uncertain.body.outcome, 'uncertain')
    assert.equal(uncertain.body.verification_pending, true)
    assert.equal(uncertain.body.refresh_pending, true)
    assert.equal(state(f.raw).receipts, 1, 'simulated network uncertainty occurs after the atomic commit')
    console.log('PASS unresolved post-commit receipt read returns honest uncertain/pending state')
  }

  {
    const f = fixture({ failAfterStateReadAfterBatch: true })
    const preview = await call(f.env, '/sale-incident-recovery-20260909/preview')
    const pending = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(pending.status, 200, JSON.stringify(pending.body))
    assert.equal(pending.body.outcome, 'applied')
    assert.equal(pending.body.verification_pending, true)
    assert.equal(state(f.raw).receipts, 1)
    console.log('PASS committed receipt with unavailable immediate after-state reports verification_pending')
  }

  {
    const f = fixture()
    const preview = await call(f.env, '/sale-incident-recovery-20260909/preview')
    f.raw.exec("CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON audit_logs WHEN NEW.action='recover_missing_sale_items' BEGIN SELECT RAISE(ABORT,'forced audit failure'); END")
    const failed = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(failed.status, 500, JSON.stringify(failed.body))
    assert.deepEqual(state(f.raw), { items: 0, allocations: 0, movements: 0, receipts: 0, histories: 0, audits: 0, product4208: 288, branch4208: 96, batch4208: 96 })
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM sale_incident_recovery_guards').get().n, 0)
    console.log('PASS late audit failure rolls back receipt, lines, allocations, stock, movement and history')
  }

  {
    const f = fixture()
    const preview = await call(f.env, '/sale-incident-recovery-20260909/preview')
    failBackup = true
    const failed = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(preview.body.request),
    })
    failBackup = false
    assert.equal(failed.status, 500)
    assert.equal(state(f.raw).receipts, 0)
    assert.equal(state(f.raw).items, 0)
    const originDenied = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(originDenied.status, 403)
    const oversized = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify({ ...preview.body.request, padding: 'x'.repeat(5000) }),
    })
    assert.equal(oversized.status, 413)
    f.env.CACHE.get = async (key) => String(key).includes('sale_incident_recovery_apply') ? '5' : null
    const limited = await call(f.env, '/sale-incident-recovery-20260909/apply', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(preview.body.request),
    })
    assert.equal(limited.status, 429)
    console.log('PASS backup, origin, body-size and rate gates fail before the atomic recovery')
  }
})().catch((error) => { console.error(error); process.exit(1) })
