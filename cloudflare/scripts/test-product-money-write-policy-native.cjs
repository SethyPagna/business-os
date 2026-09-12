// Actual Hono routes, shared writer, pending queue and review applier on the
// migrated SQLite schema. Authentication/image/cache services are fixture-only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const src = path.resolve(__dirname, '../src')
const database = openDb(loadAll(path.resolve(__dirname, '../migrations')))
const raw = database.db
let beforeProductUpdate = null, auditCount = 0
const DB = {
  prepare(sql) {
    let values = []
    const statement = {
      bind(...args) { values = args; return statement },
      async all() { return { results: raw.prepare(sql).all(...values) } },
      async first() { return raw.prepare(sql).get(...values) ?? null },
      async run() {
        if (/^UPDATE "products" SET/.test(sql) && beforeProductUpdate) { const hook = beforeProductUpdate; beforeProductUpdate = null; hook() }
        const result = raw.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    }
    return statement
  },
  async batch(statements) {
    raw.exec('BEGIN IMMEDIATE')
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results }
    catch (error) { raw.exec('ROLLBACK'); throw error }
  },
}
const env = { DB }
const real = new Set(['productWrites', 'moneyPrecision', 'productMerge', 'productIdentity', 'productDetailRule', 'db', 'sqlBinding', 'searchMatch', 'batchCode', 'actorSnapshot', 'pendingActions', 'reviewGate', 'reviewApply', 'conflictControl', 'renameCascade'])
const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined, construct: () => ({}) })
class ProductImageAssetError extends Error {}
const services = {
  auth: { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
  permissions: {
    getPermissionTier: (u) => u.tier || 'full', getActionTier: (u) => u.tier || 'full',
    hasPermission: (u) => u.tier !== 'none', isActionBlocked: () => false, isAdminControlUser: () => true,
  },
  audit: { audit: async () => { auditCount++ } },
  cache: { bumpVersion: async () => {} },
  broadcastHub: { broadcast: async () => {} },
  media: { sanitizeMediaList: () => [] },
  importImageMatch: { MAX_IMAGES_PER_PRODUCT: 3 },
  productImagePermission: { ProductImageAssetError, productImageFieldsChanged: () => false, productImageFieldsChangedResolved: async () => false, resolveProductImageFields: async () => {}, omitUnchangedProductImageFields: () => {} },
}
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const mod = { exports: {} }; cache.set(relative, mod.exports)
  const filename = path.join(src, relative)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText
  const localRequire = request => {
    if (request === 'hono') return { Hono }
    const name = request.split('/').pop()
    if (services[name]) return services[name]
    if (real.has(name)) return load(`lib/${name}.ts`)
    if (request.startsWith('.')) return noop
    return require(request)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  cache.set(relative, mod.exports); return mod.exports
}
const products = load('routes/products.ts').default
const reviews = load('routes/reviewQueue.ts').default
const writer = load('lib/productWrites.ts')
const context = { waitUntil: () => {}, passThroughOnException: () => {} }
const admin = { id: 1, username: 'admin', name: 'Admin', tier: 'full' }
const requester = { id: 2, username: 'requester', name: 'Requester', tier: 'review' }
async function request(app, method, url, body, user = admin) {
  const response = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { ...env, TEST_USER: user }, context)
  return { status: response.status, body: await response.json() }
}
const row = id => raw.prepare('SELECT * FROM products WHERE id=?').get(id)
function seed(name = 'Existing') {
  return Number(raw.prepare(`INSERT INTO products(name,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at) VALUES(?,1.2345,5000.1234,1.234567,5000,1.1,4500,NULL)`).run(name).lastInsertRowid)
}
;(async () => {
  const created = await request(products, 'POST', '/', { name: 'Direct New', cost_price_usd: 1.2345, selling_price_usd: '1.23004', selling_price_khr: 4321.1234 })
  assert.equal(created.status, 200, JSON.stringify(created))
  assert.equal(row(created.body.id).cost_price_usd, 1.2345)
  assert.equal(row(created.body.id).selling_price_usd, 1.24)
  assert.equal(row(created.body.id).selling_price_khr, 4321.1234, 'KHR is not given USD cent ceiling')
  const variant = await request(products, 'POST', '/variant', { name: 'Variant New', cost_price_usd: 1.2345, selling_price_usd: '1.23004' })
  assert.equal(variant.status, 200, JSON.stringify(variant))
  assert.equal(row(variant.body.id).selling_price_usd, 1.24)
  const queuedCreate = await request(products, 'POST', '/', { name: 'Reviewed New', cost_price_usd: '1.23455', selling_price_usd: '1.23000000000000001' }, requester)
  assert.equal(queuedCreate.status, 202, JSON.stringify(queuedCreate))
  assert.equal((await request(reviews, 'POST', `/${queuedCreate.body.pendingActionId}/approve`, {})).status, 200)
  const reviewedCreated = raw.prepare("SELECT * FROM products WHERE name='Reviewed New'").get()
  assert.equal(reviewedCreated.cost_price_usd, 1.2346)
  assert.equal(reviewedCreated.selling_price_usd, 1.24, 'decimal text reaches the kernel without binary pre-rounding')
  const id = seed()
  const preserved = await request(products, 'PUT', `/${id}`, { cost_price_usd: 1.2345, selling_price_usd: 1.234567 })
  assert.equal(preserved.status, 200, JSON.stringify(preserved))
  assert.equal(row(id).selling_price_usd, 1.234567)
  assert.equal(row(id).cost_price_usd, 1.2345)
  const historic = seed('Historical precision')
  raw.prepare('UPDATE products SET cost_price_usd=1.234567 WHERE id=?').run(historic)
  assert.equal((await request(products, 'PUT', `/${historic}`, { cost_price_usd: '1.2345670' })).status, 200)
  assert.equal(row(historic).cost_price_usd, 1.234567)
  const nullable = seed('Nullable explicit zero')
  assert.equal((await request(products, 'PUT', `/${nullable}`, { cost_price_usd: 0, cost_price_khr: null })).status, 200)
  assert.equal(row(nullable).cost_price_usd, 0)
  assert.equal(row(nullable).cost_price_khr, null)
  const directRace = seed('Direct race')
  const directBefore = row(directRace)
  beforeProductUpdate = () => raw.prepare("UPDATE products SET updated_at='concurrent revision' WHERE id=?").run(directRace)
  const directConflict = await request(products, 'PUT', `/${directRace}`, { cost_price_usd: 4, description: 'must not apply' })
  assert.equal(directConflict.body.code, 'product_money_state_conflict')
  assert.deepEqual({ ...row(directRace) }, { ...directBefore, updated_at: 'concurrent revision' }, 'whole direct UPDATE is rejected, not only its cost column')
  for (const body of [{ cost_price_usd: -.00004 }, { cost_price_usd: '-0.00004' }, { product_money_policy_version: 0 }, { product_money_policy_version: 2 }, { _product_money_write_plan: {} }]) {
    const before = row(id)
    assert.equal((await request(products, 'PUT', `/${id}`, body)).status, 400)
    assert.deepEqual(row(id), before)
  }
  for (const endpoint of ['/', '/variant']) {
    for (const value of [-.00004, '-0.00004', 'Infinity', 'not money']) {
      const count = raw.prepare('SELECT COUNT(*) n FROM products').get().n
      assert.equal((await request(products, 'POST', endpoint, { name: 'Invalid create', cost_price_usd: value })).status, 400)
      assert.equal(raw.prepare('SELECT COUNT(*) n FROM products').get().n, count)
    }
  }
  const deniedBefore = row(id)
  assert.equal((await request(products, 'PUT', `/${id}`, { cost_price_usd: 2 }, { ...admin, tier: 'none' })).status, 403)
  assert.deepEqual(row(id), deniedBefore)
  const queued = await request(products, 'PUT', `/${id}`, { cost_price_usd: 1.2345, selling_price_usd: '1.23004' }, requester)
  assert.equal(queued.status, 202, JSON.stringify(queued))
  const pendingId = queued.body.pendingActionId
  const pending = raw.prepare('SELECT * FROM pending_actions WHERE id=?').get(pendingId)
  const payload = JSON.parse(pending.payload_json)
  assert.equal(payload.product_money_policy_version, 1)
  assert.equal(payload._product_money_write_plan.before.selling_price_usd, 1.234567)
  assert.equal(payload._product_money_write_plan.after.selling_price_usd, 1.24)
  const approved = await request(reviews, 'POST', `/${pendingId}/approve`, {})
  assert.equal(approved.status, 200, JSON.stringify(approved))
  assert.equal(row(id).selling_price_usd, 1.24)
  assert.equal(row(id).cost_price_usd, 1.2345)
  const stale = await request(products, 'PUT', `/${id}`, { cost_price_usd: 2 }, requester)
  raw.prepare('UPDATE products SET cost_price_usd=7 WHERE id=?').run(id)
  const staleRow = row(id)
  assert.equal((await request(reviews, 'POST', `/${stale.body.pendingActionId}/approve`, {})).body.code, 'product_money_state_conflict')
  assert.deepEqual(row(id), staleRow)
  const race = await request(products, 'PUT', `/${id}`, { cost_price_usd: 3 }, requester)
  beforeProductUpdate = () => raw.prepare('UPDATE products SET selling_price_usd=9 WHERE id=?').run(id)
  assert.equal((await request(reviews, 'POST', `/${race.body.pendingActionId}/approve`, {})).body.code, 'product_money_state_conflict')
  assert.equal(row(id).cost_price_usd, 7)
  assert.equal(row(id).selling_price_usd, 9)
  raw.prepare("UPDATE pending_actions SET status='rejected' WHERE id=?").run(race.body.pendingActionId)
  const saved = JSON.parse(raw.prepare('SELECT payload_json FROM pending_actions WHERE id=?').get(race.body.pendingActionId).payload_json)
  const changed = { ...saved }; delete changed._product_money_write_plan; delete changed.product_money_policy_version
  assert.equal((await request(reviews, 'POST', `/${race.body.pendingActionId}/resubmit`, { payload: changed }, requester)).body.code, 'product_money_plan_immutable')
  assert.equal((await request(reviews, 'POST', `/${race.body.pendingActionId}/resubmit`, { payload: saved }, requester)).status, 200)
  const oldId = Number(raw.prepare("INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json,status,requested_by) VALUES('products','update','product',?,?,'open',2)").run(id, JSON.stringify({ cost_price_usd: 1.234567, selling_price_usd: 1.23004 })).lastInsertRowid)
  assert.equal((await request(reviews, 'POST', `/${oldId}/approve`, {})).status, 200)
  assert.equal(row(id).cost_price_usd, 1.234567, 'old unversioned plan is not restamped or repriced')
  assert.equal(row(id).selling_price_usd, 1.23004)
  raw.prepare("UPDATE pending_actions SET status='rejected' WHERE id=?").run(oldId)
  assert.equal((await request(reviews, 'POST', `/${oldId}/resubmit`, { payload: saved }, requester)).body.code, 'product_money_plan_immutable', 'legacy queue cannot accept client-authored policy metadata')
  const groupId = seed('Group Original')
  const groupBefore = row(groupId), auditBefore = auditCount
  const groupBad = await request(products, 'PUT', `/${groupId}`, { name: 'Group Changed', __rename_scope: 'group', cost_price_usd: 2 })
  assert.equal(groupBad.body.code, 'product_money_group_rename_requires_separate_save')
  assert.deepEqual(row(groupId), groupBefore)
  assert.equal(auditCount, auditBefore, 'changed money+group rename refuses before partial writes/audit')
  const groupNoop = await request(products, 'PUT', `/${groupId}`, { name: 'Group Renamed', __rename_scope: 'group', cost_price_usd: 1.2345, selling_price_usd: 1.234567 })
  assert.equal(groupNoop.status, 200, JSON.stringify(groupNoop))
  assert.equal(row(groupId).name, 'Group Renamed')
  assert.equal(row(groupId).selling_price_usd, 1.234567)
  assert.equal(row(groupId).cost_price_usd, 1.2345)
  const invalid = { product_money_policy_version: 1, _product_money_write_plan: { version: 0 } }
  assert.throws(() => writer.readProductMoneyPlan(invalid), /invalid/)
  for (const mutate of [p => { p.product_money_policy_version = 0 }, p => { p._product_money_write_plan.extra = true }, p => { delete p._product_money_write_plan.before.updated_at }, p => { p.cost_price_usd = 100 }]) {
    const corrupted = structuredClone(payload); mutate(corrupted)
    assert.throws(() => writer.readProductMoneyPlan(corrupted), /invalid/)
  }
  console.log('PASS actual product create/update/variant, reviewed policy/CAS/race/resubmit, old plans, permission refusal and group-rename boundaries')
})().catch(error => { console.error(error); process.exitCode = 1 })
