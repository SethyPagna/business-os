const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const USER = { id: 91, username: 'recovery_admin', permissions: JSON.stringify({ backup_restore: true }) }
let currentUser = USER
let backupCalls = 0
let failBackup = false
let beforeBackup = null
const moduleCache = new Map()

function routeDb(db, hooks = {}) {
  let committed = false
  const api = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        all: (params) => statement.all(params),
        get: (params) => {
          if (committed && hooks.failReceiptRead && /FROM sale_incident_recovery_receipts/i.test(sql)) throw new Error('receipt read unavailable')
          if (committed && hooks.failAfterRead && /AS matched_items/i.test(sql)) throw new Error('after-state unavailable')
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
      committed = true
      if (hooks.lostResponse) throw new Error('lost D1 response')
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
      if (failBackup) throw new Error('backup failed')
      if (beforeBackup) await beforeBackup()
      return {}
    },
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => 1 },
  '../lib/errorReporting': { reportError: async () => false },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/actorSnapshot': { actorSnapshot: (user) => user?.username || 'unknown' },
}

function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
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

function fixture(hooks = {}) {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Shop',1,1)").run()
  db.prepare(`INSERT INTO products(id,name,stock_quantity,cost_price_usd,cost_price_khr,is_active,updated_at)
    VALUES(5370,'SK-II Serum Facial Treatment 50ml',7,170,0,1,'2026-09-09T06:11:40.658Z')`).run()
  db.prepare('INSERT INTO branch_stock(id,product_id,branch_id,quantity,rfid_confirmed_qty) VALUES(52786,5370,2,5,0)').run()
  db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,created_at,updated_at,expiry_date,unit_cost_usd,received_quantity,is_active)
    VALUES(56737,5370,'recovery-5370','RECON-20260902-5370','ADJ09/02/2026','2026-09-02T15:30:00.000Z','2026-09-02T15:30:00.000Z','2026-09-02T15:30:00.000Z',NULL,170,7,1)`).run()
  db.prepare(`INSERT INTO branch_batch_stock(id,batch_id,branch_id,quantity,updated_at)
    VALUES(69261,56737,2,5,'2026-09-02T15:30:00.000Z')`).run()
  db.prepare("UPDATE stock_session_revisions SET revision=1 WHERE entity_type='product' AND entity_key='5370'").run()
  const snapshot = JSON.stringify({ version: 1, origin: 'pos', products: [{ product_id: 5370, product: 'SK-II Serum Facial Treatment 50ml', sku: null, quantity: 1, unit_price_usd: 185, line_total_usd: 185 }] })
  db.prepare(`INSERT INTO sales(id,receipt_number,client_request_id,cashier_id,branch_id,customer_id,payment_method,payment_details,payment_currency,exchange_rate,
    subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,change_is_actual,
    membership_discount_usd,membership_discount_khr,membership_points_redeemed,is_delivery,delivery_fee_usd,delivery_fee_khr,delivery_fee_paid_by,
    delivery_actual_cost_usd,delivery_actual_cost_khr,loyalty_accrual,sale_status,stock_skipped,created_at,updated_at,creation_snapshot_json)
    VALUES(16954,'20260909-130228','sale-16954',4,2,99,'','[]','USD',4065,
    185,752025,0,0,0,0,185,752025,0,0,-185,-740000,0,0,0,0,0,0,0,'customer',NULL,NULL,0,
    'awaiting_payment',0,'2026-09-09 06:02:29','2026-09-09 06:02:29',@snapshot)`).run({ snapshot })
  const routed = routeDb(db, hooks)
  return { raw: db, env: { DB: routed, CACHE: { async get() { return null }, async put() {} } } }
}

async function call(env, route, options = {}) {
  const response = await app.request(route, options, env, ctx)
  return { status: response.status, headers: response.headers, body: await response.json() }
}

function applyOptions(request) {
  return { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(request) }
}

function state(db) {
  return {
    items: Number(db.prepare('SELECT COUNT(*) n FROM sale_items WHERE sale_id=16954').get().n),
    allocations: Number(db.prepare('SELECT COUNT(*) n FROM sale_item_batch_allocations').get().n),
    movements: Number(db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id=16954").get().n),
    receipts: Number(db.prepare("SELECT COUNT(*) n FROM sale_incident_recovery_receipts WHERE incident_key='sale-zero-items-20260909-v2'").get().n),
    histories: Number(db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity_id='16954'").get().n),
    audits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='recover_missing_sale_items' AND entity_id='16954'").get().n),
    revision: Number(db.prepare('SELECT revision n FROM sale_write_revisions WHERE sale_id=16954').get().n),
    product: Number(db.prepare('SELECT stock_quantity n FROM products WHERE id=5370').get().n),
    branch: Number(db.prepare('SELECT quantity n FROM branch_stock WHERE id=52786').get().n),
    batch: Number(db.prepare('SELECT quantity n FROM branch_batch_stock WHERE id=69261').get().n),
  }
}

const INITIAL = { items: 0, allocations: 0, movements: 0, receipts: 0, histories: 0, audits: 0, revision: 1, product: 7, branch: 5, batch: 5 }

;(async () => {
  {
    const f = fixture()
    currentUser = { ...USER, permissions: '{}' }
    const denied = await call(f.env, '/sale-incident-recovery-20260909-v2/preview')
    currentUser = USER
    assert.equal(denied.status, 403)
    assert.deepEqual(state(f.raw), INITIAL)
    console.log('PASS v2 preview requires backup_restore before reads or writes')
  }

  {
    const f = fixture()
    backupCalls = 0
    f.raw.prepare(`INSERT INTO sale_incident_recovery_receipts(id,incident_key,actor_id,actor_name,request_digest,request_json,before_json,after_json,response_json,backup_created)
      VALUES('prior-v1','sale-zero-items-20260909-v1',91,'Recovery Admin','digest','{}','{}','{}','{}',1)`).run()
    const preview = await call(f.env, '/sale-incident-recovery-20260909-v2/preview')
    assert.equal(preview.status, 200, JSON.stringify(preview.body))
    assert.equal(preview.headers.get('cache-control'), 'no-store')
    assert.equal(preview.body.target, 'sale-zero-items-20260909-v2')
    assert.deepEqual(preview.body.blocked_sales, [])
    assert.deepEqual(preview.body.unknown_line_fields, ['price_mode', 'base_price_usd', 'base_price_khr'])
    assert.deepEqual(preview.body.sales, [{
      id: 16954, receipt_number: '20260909-130228', status: 'awaiting_payment', expected_revision: 1,
      line_count: 1, stock_effect: 'released_allocation_only', subtotal_before_usd: 185,
      subtotal_after_usd: 185, total_before_usd: 185, total_after_usd: 185,
    }])
    const malformed = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions({ ...preview.body.request, extra: true }))
    assert.equal(malformed.status, 400)
    assert.equal(backupCalls, 0)
    const applied = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    assert.equal(applied.status, 200, JSON.stringify(applied.body))
    assert.equal(applied.body.outcome, 'applied')
    assert.deepEqual(applied.body.affected, { sales: 1, items: 1, allocations: 1, movements: 0, histories: 1, audits: 1 })
    assert.deepEqual(state(f.raw), { items: 1, allocations: 1, movements: 0, receipts: 1, histories: 1, audits: 1, revision: 3, product: 7, branch: 5, batch: 5 })
    const item = f.raw.prepare(`SELECT applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr,total_usd,total_khr,
      price_mode,base_price_usd,base_price_khr,product_discount_usd,manual_discount_usd,batch_id,batch_label FROM sale_items WHERE sale_id=16954`).get()
    assert.deepEqual({ ...item }, { applied_price_usd: 185, applied_price_khr: 752025, cost_price_usd: 170, cost_price_khr: 0, total_usd: 185, total_khr: 752025, price_mode: null, base_price_usd: null, base_price_khr: null, product_discount_usd: 0, manual_discount_usd: 0, batch_id: 56737, batch_label: 'ADJ09/02/2026' })
    const allocation = f.raw.prepare('SELECT quantity,released_quantity,released_at FROM sale_item_batch_allocations').get()
    assert.deepEqual({ quantity: allocation.quantity, released_quantity: allocation.released_quantity }, { quantity: 1, released_quantity: 1 })
    assert.ok(allocation.released_at)
    const provenance = JSON.parse(f.raw.prepare("SELECT details FROM audit_logs WHERE entity_id='16954'").get().details)
    assert.equal(provenance.cost_evidence.sha256, 'd35b883f00082292ca457f664a70ecb8be62aef20b5f149ad196c5271177b630')
    assert.equal(backupCalls, 1)
    f.raw.prepare("UPDATE sales SET sale_status='completed' WHERE id=16954").run()
    f.raw.prepare('UPDATE products SET stock_quantity=6 WHERE id=5370').run()
    const replay = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    assert.equal(replay.status, 200)
    assert.equal(replay.body.outcome, 'already_applied')
    assert.equal(backupCalls, 1)
    assert.equal(f.raw.prepare('SELECT sale_status FROM sales WHERE id=16954').get().sale_status, 'completed')
    assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=5370').get().stock_quantity, 6)
    console.log('PASS v2 apply/replay coexists with v1 receipt, restores cost, and preserves awaiting stock plus later activity')
  }

  {
    const f = fixture()
    const preview = await call(f.env, '/sale-incident-recovery-20260909-v2/preview')
    beforeBackup = () => f.raw.prepare("UPDATE product_batches SET lot_code='CHANGED-AFTER-PREVIEW' WHERE id=56737").run()
    const stale = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    beforeBackup = null
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.deepEqual(state(f.raw), INITIAL)
    console.log('PASS v2 lot-label race during backup rejects and rolls back')
  }

  {
    const f = fixture({ lostResponse: true })
    const preview = await call(f.env, '/sale-incident-recovery-20260909-v2/preview')
    const recovered = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    assert.equal(recovered.status, 200)
    assert.equal(recovered.body.outcome, 'applied')
    assert.equal(state(f.raw).items, 1)
    console.log('PASS v2 lost D1 response reconciles the durable receipt')
  }

  {
    const f = fixture({ lostResponse: true, failReceiptRead: true })
    const preview = await call(f.env, '/sale-incident-recovery-20260909-v2/preview')
    const uncertain = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    assert.equal(uncertain.status, 202)
    assert.deepEqual({ success: uncertain.body.success, outcome: uncertain.body.outcome, verification_pending: uncertain.body.verification_pending, cache_invalidated: uncertain.body.cache_invalidated, refresh_pending: uncertain.body.refresh_pending, broadcast_requested: uncertain.body.broadcast_requested }, { success: false, outcome: 'uncertain', verification_pending: true, cache_invalidated: false, refresh_pending: true, broadcast_requested: false })
    assert.equal(state(f.raw).items, 1)
    console.log('PASS v2 unresolved postcommit receipt read returns exact 202 uncertain shape')
  }

  {
    const f = fixture({ failAfterRead: true })
    const preview = await call(f.env, '/sale-incident-recovery-20260909-v2/preview')
    const pending = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    assert.equal(pending.status, 200)
    assert.equal(pending.body.verification_pending, true)
    console.log('PASS v2 committed receipt reports verification_pending when immediate read is unavailable')
  }

  {
    const f = fixture()
    const preview = await call(f.env, '/sale-incident-recovery-20260909-v2/preview')
    f.raw.exec("CREATE TRIGGER fail_v2_audit BEFORE INSERT ON audit_logs WHEN NEW.entity_id='16954' BEGIN SELECT RAISE(ABORT,'forced audit failure'); END")
    const failed = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    assert.equal(failed.status, 500)
    assert.deepEqual(state(f.raw), INITIAL)
    failBackup = true
    const backupFailed = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    failBackup = false
    assert.equal(backupFailed.status, 500)
    const originDenied = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preview.body.request) })
    assert.equal(originDenied.status, 403)
    const oversized = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions({ ...preview.body.request, padding: 'x'.repeat(5000) }))
    assert.equal(oversized.status, 413)
    f.env.CACHE.get = async (key) => String(key).includes('sale_incident_recovery_v2_apply') ? '5' : null
    const limited = await call(f.env, '/sale-incident-recovery-20260909-v2/apply', applyOptions(preview.body.request))
    assert.equal(limited.status, 429)
    console.log('PASS v2 audit rollback and backup/origin/body/rate gates preserve zero effects')
  }
})().catch((error) => { console.error(error); process.exit(1) })
