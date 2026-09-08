const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..', 'src')
function loadTs(rel, stubs = {}) {
  const file = path.join(root, rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  })
  const permissive = () => new Proxy(function () {}, {
    get: (_target, property) => property === 'default' ? permissive() : permissive(), apply: () => undefined, construct: () => ({}),
  })
  const original = Module._load
  Module._load = (request, parent, main) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, main)
  }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod) }
  finally { Module._load = original }
  return mod.exports
}

class FakeHono {
  constructor() { this.posts = new Map(); this.gets = new Map(); FakeHono.instance = this }
  post(path, handler) { this.posts.set(path, handler); return this }
  get(path, handler) { this.gets.set(path, handler); return this }
  put() { return this } patch() { return this } delete() { return this } use() { return this }
  on() { return this } all() { return this } route() { return this } onError() { return this } notFound() { return this }
}

function adapter(d1, controls) {
  const observe = (sql, params = {}) => {
    controls.statements += 1
    controls.maxBindings = Math.max(controls.maxBindings, Object.keys(params || {}).length)
    const terms = 1 + (sql.match(/\bUNION(?:\s+ALL)?\b/gi) || []).length
    controls.maxCompoundTerms = Math.max(controls.maxCompoundTerms, terms)
    if (terms > 5) throw new Error(`too many terms in compound SELECT: ${terms}`)
    if (Object.keys(params || {}).length > 100) throw new Error(`too many SQL variables: ${Object.keys(params).length}`)
  }
  return {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get: (params) => { observe(sql, params); return statement.get(params || {}) },
        all: (params) => { observe(sql, params); return statement.all(params || {}) },
        run: (params) => { observe(sql, params); return statement.run(params || {}) },
      }
    },
    batch: async (statements) => {
      statements.forEach(({ sql, params }) => observe(sql, params))
      controls.maxBatchStatements = Math.max(controls.maxBatchStatements, statements.length)
      if (controls.failNextBatch) {
        controls.failNextBatch = false
        return d1.batch([...statements, { sql: 'INSERT INTO missing_atomic_guard(value) VALUES(1)', params: {} }])
      }
      return d1.batch(statements)
    },
  }
}

function loadRoute(d1) {
  const controls = { statements: 0, maxBindings: 0, maxCompoundTerms: 0, maxBatchStatements: 0, failNextBatch: false }
  const db = adapter(d1, controls)
  const detail = loadTs('lib/productDetailRule.ts')
  const binding = loadTs('lib/sqlBinding.ts')
  const identity = loadTs('lib/productIdentity.ts', { './db': {}, './sqlBinding': binding, './productDetailRule': detail })
  const merge = loadTs('lib/productMerge.ts')
  const selected = loadTs('lib/productConflictMergeBatch.ts', {
    './productIdentity': identity, './productDetailRule': detail, './productMerge': merge,
  })
  const actionGroups = loadTs('lib/productConflictActionGroups.ts', {
    './productIdentity': identity, './productDetailRule': detail, './productMerge': merge,
    './productConflictMergeBatch': selected,
  })
  const permissions = {
    getActionTier: (user, section, action) => action === 'merge_duplicates' && user.noMerge ? 'none' : 'full',
    getPermissionTier: () => 'full', hasPermission: () => true, getMergedPermissions: () => ({}), isAdminControlUser: () => true,
  }
  loadTs('routes/products.ts', {
    hono: { Hono: FakeHono }, '../index': {}, '../lib/db': { getDb: () => db }, '../lib/auth': { requireAuth: async () => {} },
    '../lib/productDetailRule': detail, '../lib/sqlBinding': binding, '../lib/productIdentity': identity, '../lib/productMerge': merge,
    '../lib/productConflictMergeBatch': selected, '../lib/productConflictActionGroups': actionGroups, '../lib/permissions': permissions,
    '../lib/audit': { audit: async () => {} }, '../lib/cache': { bumpVersion: async () => {}, cachedJsonResponse: async () => null, getVersionWithFallback: async () => '1' },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
  })
  return { app: FakeHono.instance, controls }
}

function seed(groupCount = 801) {
  const d1 = openDb(loadAll())
  d1.db.prepare("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1)").run()
  const insertProduct = d1.db.prepare(`INSERT INTO products
    (id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,
     selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
    VALUES(@id,@name,@nameKey,@barcode,@category,@brand,@unit,1,0,@quantity,@cost,0,@retail,0,@wholesale,0,@updatedAt)`)
  const insertStock = d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)')
  const groups = []
  for (let index = 0; index < groupCount; index += 1) {
      const left = 10000 + index * 2
      const right = left + 1
      const barcode = String(700000 + index)
      const name = `Reviewed ${index}`
      insertProduct.run({ id: left, name, nameKey: name.toLowerCase(), barcode: `0${barcode}`, category: 'A', brand: 'One', unit: 'pcs', quantity: 2, cost: 4, retail: 8, wholesale: 7, updatedAt: '2026-09-08 01:00:00' })
      insertProduct.run({ id: right, name: `Alternate ${index}`, nameKey: `alternate ${index}`, barcode, category: 'B', brand: 'Two', unit: 'box', quantity: 3, cost: 6, retail: 9, wholesale: 8, updatedAt: '2026-09-08 01:00:00' })
      insertStock.run(left, 1, 2); insertStock.run(right, 1, 3)
      groups.push({ group_key: `barcode:${barcode}`, member_ids: [right, left] })
  }
  d1.db.prepare(`INSERT INTO product_batches
      (id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,notes,batch_number,supplier_id,supplier_name,
       unit_cost_usd,payment_status,credit_due_date,received_quantity,received_branch_id,received_cost_usd)
      VALUES(99001,10000,'receipt-a','LOT-A','2027-01-01','2026-09-01',1,'first receipt',1,41,'Supplier A',4,'paid',NULL,2,1,8),
            (99002,10001,'receipt-b','LOT-B','2027-02-01','2026-09-02',1,'second receipt',1,42,'Supplier B',6,'credit','2026-10-01',3,1,18)`).run()
  d1.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(99001,1,2),(99002,1,3)').run()
  return { d1, groups }
}

async function post(app, body, user = { id: 900, username: 'reviewer' }) {
  return app.posts.get('/possible-duplicates/merge-batch/preview')({
    env: {}, req: { json: async () => body }, get: () => user,
    json: (payload, status = 200) => ({ status, body: payload }), executionCtx: { waitUntil: () => {} },
  })
}

async function get(app, reviewId, query = {}, user = { id: 900, username: 'reviewer' }) {
  return app.gets.get('/possible-duplicates/merge-batch/reviews/:reviewId')({
    env: {}, req: { query: (key) => query[key], param: () => reviewId }, get: () => user,
    json: (payload, status = 200) => ({ status, body: payload }),
  })
}

async function main() {
  const { d1, groups } = seed()
  groups.push({ group_key: 'missing:stale', member_ids: [9999001, 9999002] })
  const { app, controls } = loadRoute(d1)
  const before = {
    products: d1.db.prepare('SELECT COUNT(*) n FROM products').get().n,
    stock: d1.db.prepare('SELECT SUM(quantity) n FROM branch_stock').get().n,
    lots: d1.db.prepare('SELECT COUNT(*) n FROM product_batches').get().n,
    audit: d1.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,
    history: d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n,
  }
  const body = { manifest_version: 1, resolution_version: 2, client_request_id: 'group_review_1602', merge_groups: groups, remove_rows: [] }
  const response = await post(app, body)
  assert.equal(response.status, 200)
  assert.equal(response.body.counts.requested_groups, 802)
  assert.equal(response.body.counts.actionable_groups, 801)
  assert.equal(response.body.counts.blocked_groups, 1)
  assert.equal(response.body.counts.total_members, 1604)
  assert.equal(response.body.page.cursor, '0')
  assert.equal(response.body.page.groups.length, 50)
  assert.equal(response.body.page.next_cursor, '50')
  assert.equal(response.body.page.groups[0].economics.merged.cost_price_usd, 5)
  assert.equal(response.body.page.groups[0].stock.projected_by_branch[0].quantity, 5)
  assert.deepEqual(response.body.page.groups[0].lots.rows.map((row) => row.supplier_name), ['Supplier A', 'Supplier B'])
  assert.deepEqual(response.body.page.groups[0].lots.rows.map((row) => row.received_at), ['2026-09-01', '2026-09-02'])
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM product_conflict_action_reviews').get().n, 1)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM product_conflict_action_groups').get().n, 802)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM product_conflict_action_group_members').get().n, 1604)
  assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM product_conflict_action_groups WHERE blocker_code='stale_group_members'").get().n, 1)
  assert.deepEqual({
    products: d1.db.prepare('SELECT COUNT(*) n FROM products').get().n,
    stock: d1.db.prepare('SELECT SUM(quantity) n FROM branch_stock').get().n,
    lots: d1.db.prepare('SELECT COUNT(*) n FROM product_batches').get().n,
    audit: d1.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,
    history: d1.db.prepare('SELECT COUNT(*) n FROM action_history').get().n,
  }, before, 'preview receipt creation does not mutate catalog, stock, lot, audit, or history data')

  const next = await get(app, response.body.review_id, { cursor: '50', limit: '100' })
  assert.equal(next.status, 200)
  assert.equal(next.body.page.groups[0].ordinal, 50)
  assert.equal(next.body.page.groups.length, 100)
  assert.equal(next.body.page.next_cursor, '150')
  assert.equal((await get(app, response.body.review_id, {}, { id: 901, username: 'other' })).status, 404, 'review reads are actor scoped')

  const replay = await post(app, body)
  assert.equal(replay.body.review_id, response.body.review_id)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM product_conflict_action_reviews').get().n, 1)
  const reordered = structuredClone(body); reordered.merge_groups[0].member_ids.reverse()
  assert.equal((await post(app, reordered)).body.review_id, response.body.review_id, 'canonical member order replays the same review')
  const changed = structuredClone(body); changed.merge_groups[0].group_key = 'barcode:changed'
  const conflict = await post(app, changed)
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.code, 'idempotency_conflict')
  const remove = await post(app, { ...body, client_request_id: 'remove_disabled_001', remove_rows: [{ product_id: 10000, reason: 'bad' }] })
  assert.equal(remove.status, 409); assert.equal(remove.body.code, 'phase_not_available')
  const applyDisabled = await app.posts.get('/possible-duplicates/merge-batch')({
    env: {}, req: { json: async () => ({ resolution_version: 2, review_id: response.body.review_id, manifest_digest: response.body.draft_digest }) },
    get: () => ({ id: 900, username: 'reviewer' }), json: (payload, status = 200) => ({ status, body: payload }),
  })
  assert.equal(applyDisabled.status, 409); assert.equal(applyDisabled.body.code, 'phase_not_available')
  controls.failNextBatch = true
  await assert.rejects(post(app, { ...body, client_request_id: 'atomic_failure_001' }), /missing_atomic_guard/)
  assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM product_conflict_action_reviews WHERE request_id='atomic_failure_001'").get().n, 0)
  assert.equal(d1.db.prepare("SELECT COUNT(*) n FROM product_conflict_action_groups WHERE review_id NOT IN (SELECT id FROM product_conflict_action_reviews)").get().n, 0)
  assert.equal((await post(app, body, { id: 1, noMerge: true })).status, 403)
  assert.ok(controls.maxBindings <= 80, `max observed bindings ${controls.maxBindings}`)
  assert.ok(controls.maxCompoundTerms <= 5, `max compound terms ${controls.maxCompoundTerms}`)
  assert.ok(controls.statements <= 700, `request and verification stayed bounded: ${controls.statements}`)
  assert.ok(controls.maxBatchStatements < 100, `atomic receipt batch stayed compact: ${controls.maxBatchStatements}`)
  console.log(`product conflict action groups sqlite: 34 checks passed; ${controls.statements} statements, ${controls.maxBindings} bindings, ${controls.maxCompoundTerms} compound terms`)
}

main().catch((error) => { console.error(error); process.exit(1) })
