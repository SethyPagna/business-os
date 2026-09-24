// Products -> Duplicates, the Resolve grid's Keep merge (owner asks N1, N3, N4
// of 23 Sep 2026): the real POST /api/products/possible-duplicates/merge and
// GET .../merge-preview routes, the real fold, identity, merge and undo code,
// the full migration chain in SQLite. All data is synthetic.
//
//   N1  keep:true follows the kept product: its name and stored barcode stay,
//       a different real barcode is never a refusal, the other barcode is
//       recorded (audit row, the merged record keeps it); a kept product with
//       NO barcode takes the merged one's real barcode
//   N3  every conflict type (leading_zero, same_barcode, same_name,
//       similar_name) applies and answers with the kept product as stored;
//       the preview never reports "different" for a detected pair
//   --  only a CURRENT system-detected cluster merges: a hand-picked pair, a
//       dismissed cluster or a pair that stopped matching is 409
//   N4  a chosen cost is written only with product_cost_edit (403 without),
//       and undo restores the kept product exactly, redo repeats the choice
//   --  the old body (no keep) keeps refusing a cross-identity pair
//
// Run (from cloudflare/scripts): node test-product-resolve-keep-merge-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '../src')
// A stand-in for every module this test does not exercise. It must also work
// as a computed object key (undoAppliers keys its registry by imported kinds).
let inertKeys = 0
function inert() {
  const key = `inert-${inertKeys += 1}`
  return new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => key : inert()),
    apply: () => inert(),
    construct: () => inert(),
  })
}
function load(file, overrides = {}) {
  const full = path.join(SRC, file)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => Object.hasOwn(overrides, request) ? overrides[request] : request.startsWith('.') ? inert() : original(request, parent, isMain)
  const mod = { exports: {} }
  try { new Function('require', 'module', 'exports', '__filename', '__dirname', code)(require, mod, mod.exports, full, path.dirname(full)) } finally { Module._load = original }
  return mod.exports
}

const state = { native: null, user: null, audits: [] }
const adapter = {
  prepare(sql) {
    const st = state.native.prepare(sql)
    return {
      get: (p) => st.get(p == null ? {} : p),
      all: (p) => st.all(p == null ? {} : p),
      run: (p) => {
        const r = st.run(p == null ? {} : p)
        return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  batch: (statements) => state.native.batch(statements),
}

const moneyPrecision = load('lib/moneyPrecision.ts')
const permissions = load('lib/permissions.ts')
const actorSnapshot = load('lib/actorSnapshot.ts')
const sqlBinding = load('lib/sqlBinding.ts')
const detailRule = load('lib/productDetailRule.ts', { './moneyPrecision': moneyPrecision })
const productIdentity = load('lib/productIdentity.ts', { './db': {}, './sqlBinding': sqlBinding, './productDetailRule': detailRule })
const productMerge = load('lib/productMerge.ts', { './moneyPrecision': moneyPrecision })
const productMergeSnapshot = load('lib/productMergeSnapshot.ts', { './db': {} })
const acquisitionCostAccess = load('lib/acquisitionCostAccess.ts', { './permissions': permissions })
const noAudit = { audit: async (_env, _uid, _uname, action, entity, id, detail) => { state.audits.push({ action, entity, id, detail }) } }
const broadcastHub = { broadcast: async () => {} }
const undoAppliers = load('lib/undoAppliers.ts', {
  './actorSnapshot': actorSnapshot,
  './db': { getDb: () => adapter },
  './audit': noAudit,
  '../durable-objects/broadcastHub': broadcastHub,
  './permissions': permissions,
  './productMerge': productMerge,
  './productMergeSnapshot': productMergeSnapshot,
  './sqlBinding': sqlBinding,
  './moneyPrecision': moneyPrecision,
  './productIdentity': productIdentity,
  './productDetailRule': detailRule,
  './branchWrites': { branchUpdateStatements: () => [] },
})
const products = load('routes/products.ts', {
  '../lib/db': { getDb: () => adapter },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); return next() } },
  '../lib/permissions': permissions,
  '../lib/actorSnapshot': actorSnapshot,
  '../lib/acquisitionCostAccess': acquisitionCostAccess,
  '../lib/audit': noAudit,
  '../lib/undoAppliers': undoAppliers,
  '../lib/productDetailRule': detailRule,
  '../lib/productIdentity': productIdentity,
  '../lib/productMerge': productMerge,
  '../lib/productMergeSnapshot': productMergeSnapshot,
  '../lib/sqlBinding': sqlBinding,
  '../lib/moneyPrecision': moneyPrecision,
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {}, cachedJsonResponse: async () => null, getVersionWithFallback: async () => '1' },
  '../durable-objects/broadcastHub': broadcastHub,
}).default
const app = new Hono()
app.route('/api/products', products)

const ADMIN = { id: 1, username: 'admin', name: 'Admin', permissions: '{}' }
// A products manager with merge_duplicates but no cost grants.
const MANAGER = { id: 2, username: 'mgr', name: 'Manager', role: 'staff', permissions: JSON.stringify({ products: true, inventory: true }) }
const COST_EDITOR = { ...MANAGER, id: 3, username: 'cost', permissions: JSON.stringify({ products: true, inventory: true, product_cost_view: true, product_cost_edit: true }) }

const SEED = `
  INSERT INTO branches (id, name) VALUES (1, 'shop'), (2, 'warehouse');
  INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, stock_quantity, is_active) VALUES
    -- same_name: one display name, two DIFFERENT real barcodes
    (10, 'Rose Toner 100ml', '8801111111111', 5, 20500, 12, 3, 1),
    (11, 'Rose Toner 100ml', '8802222222222', 7, 28700, 15, 2, 1),
    -- leading_zero twins
    (20, 'MAC Shade 601', '0601', 9, 0, 20, 0, 1),
    (21, 'MAC Shade 601', '601', 11, 0, 22, 0, 1),
    -- same_barcode, different names
    (30, 'Dior Sauvage EDT 100ml', '3348901250153', 60, 0, 95, 0, 1),
    (31, 'Dior Sauvage EDP 100ml', '3348901250153', 70, 0, 110, 0, 1),
    -- similar_name, the kept one has NO barcode
    (40, 'Setting-Spray Fix Plus', '', 4, 0, 9, 0, 1),
    (41, 'Setting Spray Fix Plus', '6923644012345', 6, 0, 10, 0, 1),
    -- a bystander nothing lists with 10
    (50, 'Unrelated Lipstick', '8809999999999', 3, 0, 8, 0, 1);
  INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 3), (11, 1, 1), (11, 2, 1);
`
function fresh() {
  state.native = openDb(loadAll())
  state.native.db.exec(SEED)
  state.user = ADMIN
  state.audits = []
}
const one = (sql, ...params) => { const row = state.native.db.prepare(sql).get(...params); return row ? { ...row } : row }
const rows = (sql, ...params) => state.native.db.prepare(sql).all(...params).map((row) => ({ ...row }))
const dump = () => JSON.stringify(['products', 'branch_stock', 'product_batches', 'audit_logs', 'action_history'].map((table) => rows(`SELECT * FROM ${table} ORDER BY rowid`)))

async function request(method, url, body) {
  const init = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await app.request(url, init, { DB: {} }, { waitUntil: () => {}, passThroughOnException: () => {} })
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { throw new Error(`${method} ${url} ${res.status}: ${text}`) }
}
const merge = (body) => request('POST', '/api/products/possible-duplicates/merge', body)
const preview = (keepId, mergeId, extra = '') => request('GET', `/api/products/possible-duplicates/merge-preview?keepId=${keepId}&mergeId=${mergeId}&keep=1${extra}`)

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 14).join('\n  ')}`) }
}

async function main() {
  await check('N1: same_name pair with two real barcodes merges into the kept product, its barcode kept, the other recorded', async () => {
    fresh()
    const seen = await preview(10, 11)
    assert.equal(seen.status, 200, JSON.stringify(seen.body))
    assert.equal(seen.body.cluster, true)
    assert.equal(seen.body.blocked, null, 'a detected pair is never "different"')
    assert.deepEqual(seen.body.keeperStock.branches.map((b) => [b.branchId, b.quantity]), [[1, 3]])
    const done = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const keeper = one('SELECT name, barcode, is_active FROM products WHERE id = 10')
    assert.deepEqual(keeper, { name: 'Rose Toner 100ml', barcode: '8801111111111', is_active: 1 })
    assert.equal(one('SELECT is_active FROM products WHERE id = 11').is_active, 0)
    assert.equal(one('SELECT barcode FROM products WHERE id = 11').barcode, '8802222222222', 'the other barcode stays on the merged record')
    assert.equal(done.body.keeper.barcode, '8801111111111')
    assert.deepEqual(done.body.keeper.absorbed_barcodes, ['8802222222222'])
    assert.equal(done.body.keeper.stock_quantity, 5, 'stock carried: 3 + 2')
    assert.deepEqual(done.body.keeper.branch_stock.map((b) => [b.branchId, b.quantity]), [[1, 4], [2, 1]])
    // The same audit row every pair merge writes, inside the merge's own batch.
    const auditRows = rows("SELECT entity_id, details FROM audit_logs WHERE action = 'merge_duplicate'")
    assert.equal(auditRows.length, 1, 'the merge wrote its audit row')
    assert.equal(auditRows[0].entity_id, '11')
    const details = JSON.parse(auditRows[0].details)
    assert.equal(details.mergedIntoProductId, 10)
    assert.equal(details.keeperFollows, true)
    assert.deepEqual(details.absorbedBarcodes, ['8802222222222'])
  })

  await check('N1: the kept product keeps its leading-zero spelling; a kept product with no barcode takes the real one', async () => {
    fresh()
    const zero = await merge({ keepId: 20, mergeId: 21, keep: true })
    assert.equal(zero.status, 200, JSON.stringify(zero.body))
    assert.equal(one('SELECT barcode FROM products WHERE id = 20').barcode, '0601', 'the stored spelling is never rewritten')
    assert.deepEqual(zero.body.keeper.absorbed_barcodes, [], 'a leading-zero twin is the same barcode, nothing to record')
    const blank = await merge({ keepId: 40, mergeId: 41, keep: true })
    assert.equal(blank.status, 200, JSON.stringify(blank.body))
    assert.equal(one('SELECT barcode FROM products WHERE id = 40').barcode, '6923644012345')
    assert.equal(one('SELECT name FROM products WHERE id = 40').name, 'Setting-Spray Fix Plus', 'the name follows the kept product')
  })

  await check('N3: every conflict type applies (same_barcode with two names included) and nothing says failed or different', async () => {
    fresh()
    for (const [keepId, mergeId] of [[31, 30], [21, 20], [11, 10], [41, 40]]) {
      const seen = await preview(keepId, mergeId)
      assert.equal(seen.body.blocked, null, `${keepId}<-${mergeId}: ${JSON.stringify(seen.body.blocked)}`)
      const done = await merge({ keepId, mergeId, keep: true, stock: 'merge' })
      assert.equal(done.status, 200, `${keepId}<-${mergeId}: ${JSON.stringify(done.body)}`)
      assert.equal(done.body.keeper.id, keepId)
      assert.equal(one('SELECT name FROM products WHERE id = ?', keepId).name, done.body.keeper.name)
    }
    assert.equal(one('SELECT name FROM products WHERE id = 31').name, 'Dior Sauvage EDP 100ml')
  })

  await check('only a current system-detected cluster merges: hand-picked, dismissed and changed pairs are 409 and write nothing', async () => {
    fresh()
    const before = dump()
    const handPicked = await merge({ keepId: 10, mergeId: 50, keep: true })
    assert.equal(handPicked.status, 409, JSON.stringify(handPicked.body))
    assert.equal(handPicked.body.code, 'product_merge_not_duplicates')
    assert.equal((await preview(10, 50)).body.blocked.code, 'product_merge_not_duplicates')
    state.native.db.prepare("INSERT INTO product_duplicate_dismissals (cluster_type, cluster_value) VALUES ('name', 'rose toner 100ml')").run()
    const dismissed = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })
    assert.equal(dismissed.status, 409, JSON.stringify(dismissed.body))
    assert.equal(dismissed.body.code, 'product_merge_not_duplicates')
    state.native.db.prepare('DELETE FROM product_duplicate_dismissals').run()
    state.native.db.prepare("UPDATE products SET name = 'Rose Toner 200ml' WHERE id = 11").run()
    const changed = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge' })
    assert.equal(changed.status, 409, JSON.stringify(changed.body))
    assert.equal(changed.body.code, 'product_merge_not_duplicates')
    state.native.db.prepare("UPDATE products SET name = 'Rose Toner 100ml' WHERE id = 11").run()
    assert.equal(dump(), before)
  })

  await check('the old body (no keep) still refuses a cross-identity pair; the sibling exact-twin merge is unchanged', async () => {
    fresh()
    const old = await merge({ keepId: 10, mergeId: 11, stock: 'merge' })
    assert.equal(old.status, 409)
    assert.equal(old.body.code, 'incompatible_product_identity')
    const oldPreview = await request('GET', '/api/products/possible-duplicates/merge-preview?keepId=10&mergeId=11')
    assert.equal(oldPreview.body.blocked.code, 'incompatible_product_identity')
    assert.equal('cluster' in oldPreview.body, false)
    const twin = await merge({ keepId: 21, mergeId: 20 })
    assert.equal(twin.status, 200, JSON.stringify(twin.body))
    assert.equal('keeper' in twin.body, false, 'the old answer shape')
  })

  await check('N4: a chosen cost needs product_cost_edit (403 without, nothing written); with it the cost is stored', async () => {
    fresh()
    const before = dump()
    state.user = MANAGER
    const denied = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge', cost_price_usd: 6.5 })
    assert.equal(denied.status, 403, JSON.stringify(denied.body))
    assert.equal(denied.body.code, 'cost_permission_required')
    assert.equal(dump(), before)
    const noCost = await preview(10, 11, '&groupIds=10,11')
    assert.equal(noCost.status, 200)
    assert.equal('groupCost' in noCost.body && noCost.body.groupCost && 'cost_price_usd' in noCost.body.groupCost, false, 'cost is projected away without cost view')
    state.user = COST_EDITOR
    const seen = await preview(10, 11, '&groupIds=10,11')
    assert.deepEqual(seen.body.groupCost, { cost_price_usd: 6, cost_price_khr: 24600 }, 'the rule: mean of the distinct costs')
    const invalid = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge', cost_price_usd: -1 })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.code, 'invalid_merge_cost')
    const outside = await merge({ keepId: 10, mergeId: 11, stock: 'merge', cost_price_usd: 6.5 })
    assert.equal(outside.status, 400, 'only the Resolve merge takes a cost')
    const done = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge', cost_price_usd: 6.5, cost_price_khr: 26650 })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.deepEqual(one('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = 10'), { cost_price_usd: 6.5, cost_price_khr: 26650 })
    assert.equal(done.body.keeper.cost_price_usd, 6.5)
    state.user = MANAGER
    const plain = await merge({ keepId: 20, mergeId: 21, keep: true })
    assert.equal(plain.status, 200, 'no cost chosen needs no cost grant')
    assert.equal('cost_price_usd' in plain.body.keeper, false, 'the answer hides cost from a user without cost view')
  })

  await check('undo restores the kept product exactly and redo repeats the keeper choice and the chosen cost', async () => {
    fresh()
    const keeperBefore = one('SELECT name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, is_active FROM products WHERE id = 10')
    const done = await merge({ keepId: 10, mergeId: 11, keep: true, stock: 'merge', cost_price_usd: 6.5 })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const history = one("SELECT id, undo_payload, redo_payload FROM action_history WHERE status = 'undoable' ORDER BY id DESC LIMIT 1")
    assert.ok(history, 'the merge is in History, undoable like every pair merge')
    const applier = undoAppliers.resolveUndoApplier(JSON.parse(history.undo_payload))
    assert.equal(applier.name, 'product.merge')
    const ctx = (direction) => ({ env: { DB: {} }, user: ADMIN, direction, historyId: history.id })
    await applier.run(JSON.parse(history.undo_payload), ctx('undo'))
    assert.deepEqual(one('SELECT name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, is_active FROM products WHERE id = 10'), keeperBefore)
    assert.equal(one('SELECT is_active FROM products WHERE id = 11').is_active, 1)
    await applier.run(JSON.parse(history.redo_payload), ctx('redo'))
    assert.deepEqual(one('SELECT name, barcode, cost_price_usd FROM products WHERE id = 10'), { name: 'Rose Toner 100ml', barcode: '8801111111111', cost_price_usd: 6.5 })
    assert.equal(one('SELECT is_active FROM products WHERE id = 11').is_active, 0)
  })

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
