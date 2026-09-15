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
const frontendSrc = path.resolve(__dirname, '../../frontend/src')
const database = openDb(loadAll(path.resolve(__dirname, '../migrations')))
const raw = database.db
let beforeProductUpdate = null, afterRead = null, beforeBatch = null, auditCount = 0
const DB = {
  prepare(sql) {
    let values = []
    const statement = {
      bind(...args) { values = args; return statement },
      async all() { return { results: raw.prepare(sql).all(...values) } },
      async first() { const value = raw.prepare(sql).get(...values) ?? null; if (afterRead) afterRead(sql, value); return value },
      async run() {
        if (/^UPDATE "products" SET/.test(sql) && beforeProductUpdate) { const hook = beforeProductUpdate; beforeProductUpdate = null; hook() }
        const result = raw.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    }
    return statement
  },
  async batch(statements) {
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook() }
    raw.exec('BEGIN IMMEDIATE')
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results }
    catch (error) { raw.exec('ROLLBACK'); throw error }
  },
}
const env = { DB }
const real = new Set(['productWrites', 'moneyPrecision', 'productMerge', 'productIdentity', 'productDetailRule', 'db', 'sqlBinding', 'searchMatch', 'batchCode', 'actorSnapshot', 'pendingActions', 'reviewGate', 'reviewApply', 'conflictControl', 'renameCascade', 'schemaProbe'])
const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined, construct: () => ({}) })
class ProductImageAssetError extends Error {}
const services = {
  auth: { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
  permissions: {
    getPermissionTier: (u) => u.tier || 'full', getActionTier: (u) => u.tier || 'full',
    hasPermission: (u) => u.tier !== 'none', isActionBlocked: () => false, isAdminControlUser: () => true,
  },
  audit: { audit: async () => { auditCount++ } },
  cache: { bumpVersion: async () => {}, bumpVersions: async () => {} },
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
const frontendCache = new Map()
function loadFrontend(relative) {
  const filename = path.resolve(frontendSrc, relative)
  if (frontendCache.has(filename)) return frontendCache.get(filename)
  const mod = { exports: {} }; frontendCache.set(filename, mod.exports)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText
  const localRequire = request => {
    if (!request.startsWith('.')) return require(request)
    const resolved = path.resolve(path.dirname(filename), request)
    return loadFrontend(path.relative(frontendSrc, resolved))
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  frontendCache.set(filename, mod.exports); return mod.exports
}
const products = load('routes/products.ts').default
const reviews = load('routes/reviewQueue.ts').default
const writer = load('lib/productWrites.ts')
const frontendWriter = loadFrontend('components/products/helpers/productWriteHelpers.ts')
const context = { waitUntil: () => {}, passThroughOnException: () => {} }
const admin = { id: 1, username: 'admin', name: 'Admin', tier: 'full' }
const requester = { id: 2, username: 'requester', name: 'Requester', tier: 'review' }
async function request(app, method, url, body, user = admin) {
  const response = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { ...env, TEST_USER: user }, context)
  return { status: response.status, body: await response.json() }
}
const row = id => raw.prepare('SELECT * FROM products WHERE id=?').get(id)
function seed(name = 'Existing') {
  return Number(raw.prepare(`INSERT INTO products(name,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,purchase_price_usd,purchase_price_khr,updated_at) VALUES(?,1.2345,5000.1234,1.234567,5000,1.1,4500,2.345678,9000.123456,NULL)`).run(name).lastInsertRowid)
}
;(async () => {
  const created = await request(products, 'POST', '/', { name: 'Direct New', cost_price_usd: 1.2345, purchase_price_usd: '2.34565', purchase_price_khr: '9000.12345', selling_price_usd: '1.23004', selling_price_khr: 4321.1234 })
  assert.equal(created.status, 200, JSON.stringify(created))
  assert.equal(row(created.body.id).cost_price_usd, 1.2345)
  assert.equal(row(created.body.id).selling_price_usd, 1.24)
  assert.equal(row(created.body.id).selling_price_khr, 4321.1234, 'KHR is not given USD cent ceiling')
  assert.equal(row(created.body.id).purchase_price_usd, 2.3457)
  assert.equal(row(created.body.id).purchase_price_khr, 9000.1235, 'purchase cost uses nearest four decimals in both currencies')
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
  raw.prepare('UPDATE products SET purchase_price_usd=2.345678 WHERE id=?').run(historic)
  assert.equal((await request(products, 'PUT', `/${historic}`, { purchase_price_usd: '2.3456780' })).status, 200)
  assert.equal(row(historic).purchase_price_usd, 2.345678, 'no-op text does not reprice an authoritative historical purchase cost')
  const composedUnchanged = frontendWriter.buildProductBulkPricingUpdates({ purchase_price_usd: '2.345678' })
  assert.deepEqual(composedUnchanged, { purchase_price_usd: '2.345678' }, 'frontend keeps absolute purchase input raw until the route reads the before-image')
  assert.equal((await request(products, 'PUT', `/${historic}`, composedUnchanged)).status, 200)
  assert.equal(row(historic).purchase_price_usd, 2.345678, 'actual frontend helper through Hono and SQLite preserves unchanged historical precision')
  const composedNegative = frontendWriter.buildProductBulkPricingUpdates({ purchase_price_usd: '-0.00004' })
  assert.deepEqual(composedNegative, { purchase_price_usd: '-0.00004' }, 'frontend must not quantize a raw negative into zero')
  const composedNegativeBefore = row(historic)
  assert.equal((await request(products, 'PUT', `/${historic}`, composedNegative)).status, 400)
  assert.deepEqual(row(historic), composedNegativeBefore, 'actual frontend helper through Hono and SQLite rejects raw negative without a write')
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
  for (const body of [{ cost_price_usd: -.00004 }, { cost_price_usd: '-0.00004' }, { purchase_price_usd: -.00004 }, { purchase_price_khr: '-0.00004' }, { product_money_policy_version: 0 }, { product_money_policy_version: 2 }, { _product_money_write_plan: {} }]) {
    const before = row(id)
    assert.equal((await request(products, 'PUT', `/${id}`, body)).status, 400)
    assert.deepEqual(row(id), before)
  }
  for (const endpoint of ['/', '/variant']) {
    for (const value of [-.00004, '-0.00004', 'Infinity', 'not money']) {
      const count = raw.prepare('SELECT COUNT(*) n FROM products').get().n
      assert.equal((await request(products, 'POST', endpoint, { name: 'Invalid create', purchase_price_usd: value })).status, 400)
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
  assert.equal(payload.product_money_policy_version, 2)
  assert.equal(payload._product_money_write_plan.version, 2)
  assert.equal(payload._product_money_write_plan.before.selling_price_usd, 1.234567)
  assert.equal(payload._product_money_write_plan.before.purchase_price_usd, 2.345678)
  assert.equal(payload._product_money_write_plan.after.selling_price_usd, 1.24)
  const approved = await request(reviews, 'POST', `/${pendingId}/approve`, {})
  assert.equal(approved.status, 200, JSON.stringify(approved))
  assert.equal(row(id).selling_price_usd, 1.24)
  assert.equal(row(id).cost_price_usd, 1.2345)
  const textOnly = await request(products, 'PUT', `/${id}`, { description: 'Review description only' }, requester)
  const textPending = raw.prepare('SELECT * FROM pending_actions WHERE id=?').get(textOnly.body.pendingActionId)
  const textPayload = JSON.parse(textPending.payload_json)
  assert.equal(textPayload.product_money_policy_version, 2, 'every newly queued request is distinguishable from historical unversioned/v1 requests')
  assert.deepEqual(textPayload._product_money_write_plan.after, {})
  raw.prepare("UPDATE pending_actions SET status='rejected' WHERE id=?").run(textPending.id)
  const textBefore = row(id)
  for (const extra of [{ cost_price_usd: -.00004 }, { selling_price_usd: 1.23004 }]) {
    const injection = await request(reviews, 'POST', `/${textPending.id}/resubmit`, { payload: { description: textPayload.description, ...extra } }, requester)
    assert.equal(injection.status, 409)
    assert.equal(injection.body.code, 'product_money_plan_immutable')
    assert.deepEqual(row(id), textBefore)
    assert.equal(raw.prepare('SELECT status FROM pending_actions WHERE id=?').get(textPending.id).status, 'rejected')
  }
  assert.equal((await request(reviews, 'POST', `/${textPending.id}/resubmit`, { payload: textPayload }, requester)).status, 200)
  assert.equal((await request(reviews, 'POST', `/${textPending.id}/approve`, {})).status, 200)
  assert.equal(row(id).cost_price_usd, textBefore.cost_price_usd)
  assert.equal(row(id).selling_price_usd, textBefore.selling_price_usd)
  const expectedId = seed('Expected revision')
  raw.prepare("UPDATE products SET updated_at='editor revision' WHERE id=?").run(expectedId)
  afterRead = sql => {
    if (!/^SELECT updated_at FROM products/.test(sql)) return
    afterRead = null
    raw.prepare("UPDATE products SET cost_price_usd=99, updated_at='newer revision' WHERE id=?").run(expectedId)
  }
  const expectedRace = await request(products, 'PUT', `/${expectedId}`, { expectedUpdatedAt: 'editor revision', cost_price_usd: 2 })
  assert.equal(expectedRace.status, 409)
  assert.equal(row(expectedId).cost_price_usd, 99, 'snapshot may not adopt a newer revision than the supplied editor token')
  const stale = await request(products, 'PUT', `/${id}`, { cost_price_usd: 2 }, requester)
  raw.prepare('UPDATE products SET cost_price_usd=7 WHERE id=?').run(id)
  const staleRow = row(id)
  assert.equal((await request(reviews, 'POST', `/${stale.body.pendingActionId}/approve`, {})).body.code, 'product_money_state_conflict')
  assert.deepEqual(row(id), staleRow)
  const stalePurchase = await request(products, 'PUT', `/${id}`, { purchase_price_usd: '3.45675' }, requester)
  raw.prepare('UPDATE products SET purchase_price_usd=8.765432 WHERE id=?').run(id)
  const stalePurchaseRow = row(id)
  const stalePurchaseResult = await request(reviews, 'POST', `/${stalePurchase.body.pendingActionId}/approve`, {})
  assert.equal(stalePurchaseResult.body.code, 'product_money_state_conflict')
  assert.deepEqual(row(id), stalePurchaseRow, 'purchase-only concurrent change is covered by the v2 before-image CAS')
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
  const v1ReplayProductId = seed('Frozen v1 replay')
  const v1ReplayBefore = row(v1ReplayProductId)
  const v1Fields = ['cost_price_usd', 'cost_price_khr', 'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr']
  const v1ReplayPayload = {
    cost_price_usd: 4.5678,
    product_money_policy_version: 1,
    _product_money_write_plan: {
      version: 1,
      kind: 'update',
      product_id: v1ReplayProductId,
      before: Object.fromEntries([...v1Fields, 'updated_at', 'name'].map(key => [key, v1ReplayBefore[key] ?? null])),
      after: { cost_price_usd: 4.5678 },
      group_rename: null,
    },
  }
  const v1ReplayId = Number(raw.prepare("INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json,status,requested_by) VALUES('products','update','product',?,?,'open',2)").run(v1ReplayProductId, JSON.stringify(v1ReplayPayload)).lastInsertRowid)
  assert.equal((await request(reviews, 'POST', `/${v1ReplayId}/approve`, {})).status, 200)
  assert.equal(row(v1ReplayProductId).cost_price_usd, 4.5678, 'an already-frozen six-field v1 plan still applies through the real review route')
  assert.equal(row(v1ReplayProductId).purchase_price_usd, v1ReplayBefore.purchase_price_usd, 'v1 replay neither owns nor rewrites purchase cost')
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
  const groupRaceId = seed('Race Initial'), groupRaceSibling = seed('Race Concurrent')
  const groupRaceAudit = auditCount
  let groupRaceSiblingBefore = row(groupRaceSibling)
  afterRead = sql => {
    if (!/SELECT cost_price_usd,cost_price_khr/.test(sql)) return
    afterRead = null
    raw.prepare("UPDATE products SET name='Race Concurrent' WHERE id=?").run(groupRaceId)
    groupRaceSiblingBefore = row(groupRaceSibling) // include only the concurrent writer's real trigger effects
  }
  const groupRace = await request(products, 'PUT', `/${groupRaceId}`, { name: 'Race Initial', __rename_scope: 'group', cost_price_usd: 2 })
  assert.equal(groupRace.status, 409)
  assert.equal(row(groupRaceId).name, 'Race Concurrent')
  assert.equal(row(groupRaceId).cost_price_usd, 1.2345)
  assert.deepEqual(row(groupRaceSibling), groupRaceSiblingBefore)
  assert.equal(auditCount, groupRaceAudit, 'late identity read cannot publish a new group rename before rejected money CAS')
  const atomicGroupId = seed('Atomic Group'), atomicSibling = seed('Atomic Group')
  const atomicSiblingBefore = row(atomicSibling), atomicAudit = auditCount
  beforeBatch = () => raw.prepare('UPDATE products SET cost_price_usd=99 WHERE id=?').run(atomicGroupId)
  const atomicGroupRace = await request(products, 'PUT', `/${atomicGroupId}`, { name: 'Atomic Renamed', __rename_scope: 'group', cost_price_usd: 1.2345 })
  assert.equal(atomicGroupRace.status, 409)
  assert.equal(row(atomicGroupId).name, 'Atomic Group')
  assert.equal(row(atomicGroupId).cost_price_usd, 99)
  assert.deepEqual(row(atomicSibling), atomicSiblingBefore)
  assert.equal(auditCount, atomicAudit)
  for (const mutation of ['cost', 'description', 'membership', 'destination_cost', 'destination_membership']) {
    const leader = seed(`Group ${mutation}`), sibling = seed(`Group ${mutation}`)
    const destination = seed(`Renamed ${mutation}`)
    // Give the leader/sibling group a REAL barcode distinct from the
    // destination row's REAL barcode. Under the Sep 15 2026 wildcard rule a
    // broken barcode on either side of a same-name pair always matches --
    // this loop renames the leader to the destination's exact name to
    // exercise the money-write-policy race guard, not the (correct,
    // separate) same-identity duplicate guard, so both sides need real,
    // differing barcodes to stay genuinely distinct identities.
    raw.prepare('UPDATE products SET barcode=? WHERE id IN (?,?)').run(`900${leader}00`, leader, sibling)
    raw.prepare('UPDATE products SET barcode=? WHERE id=?').run(`901${destination}00`, destination)
    let expectedLeader, expectedSibling, expectedDestination, expectedCount
    const auditAtStart = auditCount
    beforeBatch = () => {
      if (mutation === 'cost') raw.prepare('UPDATE products SET cost_price_usd=44 WHERE id=?').run(sibling)
      if (mutation === 'description') raw.prepare("UPDATE products SET description='concurrent' WHERE id=?").run(sibling)
      if (mutation === 'membership') seed(`Group ${mutation}`)
      if (mutation === 'destination_cost') raw.prepare('UPDATE products SET cost_price_usd=88 WHERE id=?').run(destination)
      if (mutation === 'destination_membership') seed(`Renamed ${mutation}`)
      expectedLeader = row(leader); expectedSibling = row(sibling)
      expectedDestination = row(destination)
      expectedCount = raw.prepare('SELECT COUNT(*) n FROM products').get().n
    }
    const conflict = await request(products, 'PUT', `/${leader}`, { name: `Renamed ${mutation}`, __rename_scope: 'group', cost_price_usd: 1.2345 })
    assert.equal(conflict.status, 409, mutation)
    assert.deepEqual(row(leader), expectedLeader, mutation)
    assert.deepEqual(row(sibling), expectedSibling, mutation)
    assert.deepEqual(row(destination), expectedDestination, mutation)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM products').get().n, expectedCount)
    assert.equal(auditCount, auditAtStart)
  }
  const reviewedGroup = await request(products, 'PUT', `/${atomicGroupId}`, { name: 'Reviewed Group', __rename_scope: 'group', cost_price_usd: 99 }, requester)
  assert.equal(reviewedGroup.status, 202)
  assert.equal(row(atomicGroupId).name, 'Atomic Group', 'review submission has no group side effects')
  assert.deepEqual(row(atomicSibling), atomicSiblingBefore)
  assert.equal(auditCount, atomicAudit)
  assert.equal((await request(reviews, 'POST', `/${reviewedGroup.body.pendingActionId}/approve`, {})).status, 200)
  assert.equal(row(atomicGroupId).name, 'Reviewed Group')
  assert.equal(row(atomicSibling).name, 'Reviewed Group')
  const oversized = seed('Oversized guarded group')
  raw.prepare('UPDATE products SET description=? WHERE id=?').run('x'.repeat(500_001), oversized)
  const oversizedBefore = row(oversized), oversizedAudit = auditCount
  const oversizedResponse = await request(products, 'PUT', `/${oversized}`, { name: 'Oversized renamed', __rename_scope: 'group' })
  assert.equal(oversizedResponse.body.code, 'product_group_plan_too_large')
  assert.deepEqual(row(oversized), oversizedBefore)
  assert.equal(auditCount, oversizedAudit)
  const invalid = { product_money_policy_version: 1, _product_money_write_plan: { version: 0 } }
  assert.throws(() => writer.readProductMoneyPlan(invalid), /invalid/)
  for (const mutate of [p => { p.product_money_policy_version = 0 }, p => { p._product_money_write_plan.extra = true }, p => { delete p._product_money_write_plan.before.updated_at }, p => { p.cost_price_usd = 100 }]) {
    const corrupted = structuredClone(payload); mutate(corrupted)
    assert.throws(() => writer.readProductMoneyPlan(corrupted), /invalid/)
  }
  const legacyV1 = structuredClone(payload)
  legacyV1.product_money_policy_version = 1
  legacyV1._product_money_write_plan.version = 1
  delete legacyV1._product_money_write_plan.before.purchase_price_usd
  delete legacyV1._product_money_write_plan.before.purchase_price_khr
  assert.equal(writer.readProductMoneyPlan(legacyV1).version, 1, 'an exact six-field v1 frozen plan remains readable')
  assert.throws(() => writer.readProductMoneyPlan({ ...structuredClone(legacyV1), purchase_price_usd: 7 }), /invalid/, 'purchase fields cannot bypass the v1 plan')
  const v1BeforeExtra = structuredClone(legacyV1)
  v1BeforeExtra._product_money_write_plan.before.purchase_price_usd = 2
  assert.throws(() => writer.readProductMoneyPlan(v1BeforeExtra), /invalid/, 'v1 before-images remain exactly six money fields')
  const v1AfterExtra = structuredClone(legacyV1)
  v1AfterExtra._product_money_write_plan.after.purchase_price_usd = 2
  assert.throws(() => writer.readProductMoneyPlan(v1AfterExtra), /invalid/, 'v1 after-images cannot claim v2 purchase fields')
  const v2BeforeMissing = structuredClone(payload)
  delete v2BeforeMissing._product_money_write_plan.before.purchase_price_usd
  assert.throws(() => writer.readProductMoneyPlan(v2BeforeMissing), /invalid/, 'v2 before-images cannot omit a purchase field from CAS')
  const mixedVersion = structuredClone(payload)
  mixedVersion.product_money_policy_version = 1
  assert.throws(() => writer.readProductMoneyPlan(mixedVersion), /invalid/, 'outer and inner policy versions must match')
  console.log('PASS actual product create/update/variant, reviewed policy/CAS/race/resubmit, old plans, permission refusal and group-rename boundaries')
})().catch(error => { console.error(error); process.exitCode = 1 })
