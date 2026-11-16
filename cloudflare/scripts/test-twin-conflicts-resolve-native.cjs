// Owner, 16 Nov 2026 (lead decision, Option A): every cluster the "Duplicate" tag marks must be listed by the Products Conflicts sweep (GET
// /api/products/possible-duplicates) and must be resolvable there (the Resolve grid's Keep merge, POST .../possible-duplicates/merge), so the tag's
// "Merge it in the Conflicts tab" is never a dead end. The twin rule is the owner's identity rule of 15 Sep 2026 (see test-twin-rule-parity-pure.cjs):
// same name, unless two genuinely different real barcodes separate the rows; an empty, word-like or short barcode never does.
//
// The real routes, the real fold, identity, merge and undo code and the full migration chain in SQLite (the harness is the one
// test-product-resolve-keep-merge-native.cjs uses). The twin clusters come from the real client function (frontend unmergedTwinKeys over the rows read
// from the database). All data is synthetic.
//   * every tagged cluster is in one Conflicts cluster, for the Worker as it is and NOT for the old rule (a sweep that only lists a shared code of
//     4 or more characters), which this test turns red;
//   * every tagged cluster resolves, whichever row is kept: the real barcode wins, two empty barcodes stay one empty barcode, and the merged cost is
//     the mean of the distinct non-zero costs;
//   * a pair the tag does not mark (two genuinely different real barcodes) is still listed and still resolvable: Conflicts is the superset.
//
// Run (from cloudflare/scripts): node test-twin-conflicts-resolve-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { build: esbuild } = require('esbuild')

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
function load(file, overrides = {}, patches = []) {
  const full = path.join(SRC, file)
  let text = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  for (const [from, to] of patches) { if (text.split(from).length !== 2) throw new Error('patch anchor must occur exactly once in ' + file); text = text.replace(from, () => to) }
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => Object.hasOwn(overrides, request) ? overrides[request] : request.startsWith('.') ? inert() : original(request, parent, isMain)
  const mod = { exports: {} }
  try { new Function('require', 'module', 'exports', '__filename', '__dirname', code)((request) => Object.hasOwn(overrides, request) ? overrides[request] : require(request), mod, mod.exports, full, path.dirname(full)) } finally { Module._load = original }
  return mod.exports
}

const state = { native: null, user: null, audits: [] }
const adapter = {
  prepare(sql) {
    const st = state.native.prepare(sql)
    return {
      get: (p) => { state.queries += 1; return st.get(p == null ? {} : p) },
      all: (p) => {
        state.queries += 1
        const result = st.all(p == null ? {} : p)
        if (state.afterStockRead && sql === 'SELECT branch_id, quantity FROM branch_stock WHERE product_id = @id') {
          const mutate = state.afterStockRead
          state.afterStockRead = null
          mutate()
        }
        return result
      },
      run: (p) => {
        state.queries += 1
        const r = st.run(p == null ? {} : p)
        return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  batch: (statements) => {
    state.queries += statements.length
    if (state.beforeFold && statements.some((statement) => /INSERT INTO undo_snapshots/.test(statement.sql))) {
      const mutate = state.beforeFold
      state.beforeFold = null
      mutate()
    }
    return state.native.batch(statements)
  },
}

let planTier, app
function buildApp(sweepPatches = []) {
  const stockTransaction = load('lib/stockTransaction.ts')
  const moneyPrecision = load('lib/moneyPrecision.ts')
  const permissions = load('lib/permissions.ts')
  planTier = load('lib/planTier.ts')
  const requestBodyGuard = load('lib/requestBodyGuard.ts')
  const actorSnapshot = load('lib/actorSnapshot.ts')
  const sqlBinding = load('lib/sqlBinding.ts')
  const detailRule = load('lib/productDetailRule.ts', { './moneyPrecision': moneyPrecision })
  const productIdentity = load('lib/productIdentity.ts', { './db': {}, './sqlBinding': sqlBinding, './productDetailRule': detailRule }, sweepPatches)
  const productMerge = load('lib/productMerge.ts', { './moneyPrecision': moneyPrecision })
  const productStockGuard = load('lib/productStockGuard.ts')
  const productMergeSnapshot = load('lib/productMergeSnapshot.ts', { './db': {} })
  const acquisitionCostAccess = load('lib/acquisitionCostAccess.ts', { './permissions': permissions })
  const noAudit = { audit: async (_env, _uid, _uname, action, entity, id, detail) => { state.audits.push({ action, entity, id, detail }) } }
  const broadcastHub = { broadcast: async () => {} }
  const catalogCost = load('lib/catalogCostRecompute.ts', { './moneyPrecision': moneyPrecision })
  const costReview = load('lib/productCostReview.ts', { './catalogCostRecompute': catalogCost })
  const costPreview = load('lib/productMergeCostPreview.ts', { './catalogCostRecompute': catalogCost, './productCostReview': costReview, './productConflictActionGroups': load('lib/productConflictActionGroups.ts') })
  // UI-CONFLICTS B1: the Resolve choices kernel, real, so the route never sees an inert stand-in.
  const resolveChoices = load('lib/productResolveChoices.ts', { './moneyPrecision': moneyPrecision, './searchMatch': load('lib/searchMatch.ts') })
  const undoAppliers = load('lib/undoAppliers.ts', {
    './acquisitionCostAccess': acquisitionCostAccess,
    './stockTransaction': stockTransaction,
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
    // U-cost: merge undo re-derives catalog cost with the real formula.
    './catalogCostRecompute': catalogCost,
    './productCostReview': costReview,
  })
  const productModule = load('routes/products.ts', {
    '../lib/stockTransaction': stockTransaction,
    // U-cost: the merge fold re-derives the keeper's catalog cost too.
    '../lib/catalogCostRecompute': catalogCost,
    '../lib/productCostReview': costReview,
    '../lib/productMergeCostPreview': costPreview,
    '../lib/requestBodyGuard': requestBodyGuard,
    '../lib/productConflictActionGroups': load('lib/productConflictActionGroups.ts'),
    '../lib/db': { getDb: () => adapter },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); return next() } },
    '../lib/permissions': permissions,
    '../lib/planTier': planTier,
    '../lib/actorSnapshot': actorSnapshot,
    '../lib/acquisitionCostAccess': acquisitionCostAccess,
    '../lib/audit': noAudit,
    '../lib/undoAppliers': undoAppliers,
    '../lib/productDetailRule': detailRule,
    '../lib/productIdentity': productIdentity,
    '../lib/productMerge': productMerge,
    '../lib/productStockGuard': productStockGuard,
    '../lib/productMergeSnapshot': productMergeSnapshot,
    '../lib/productResolveChoices': resolveChoices,
    '../lib/mergeRouteLog': load('lib/mergeRouteLog.ts'),
    '../lib/sqlBinding': sqlBinding,
    '../lib/moneyPrecision': moneyPrecision,
    '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {}, cachedJsonResponse: async (_request, _ctx, _version, _ttl, producer) => producer(), getVersionWithFallback: async () => '1', getVersionsWithFallback: async (_env, namespaces) => namespaces.map(() => '1'), cacheIdentity: () => 'test' },
    '../durable-objects/broadcastHub': broadcastHub,
  })
  const products = productModule.default
  app = new Hono()
  app.route('/api/products', products)
}

const KHMER = '៨៨៥១២៣៤៥៦៧៨៩០' // the real barcode's digits in Khmer numerals: not [0-9], so not a real barcode
const REAL = '8851234567890'
// Pairs: [first id, second id, name, barcode, barcode, tagged?]. Costs are 4 and 6 (distinct, non-zero): the merged cost the rule gives is 5.
const PAIRS = [
  [101, 102, 'Tw Real Empty', REAL, '', true],
  [103, 104, 'Tw Empty Empty', '', '', true],
  [105, 106, 'Tw Word Word', 'NoBox188', 'Mask', true],
  [107, 108, 'Tw Short Short', '12345', '12346', true],
  [109, 110, 'Tw Zero Zero', '0', '0', true],
  [111, 112, 'Tw Real Khmer', REAL, KHMER, true],
  [113, 114, 'Tw Real Word', '8851234567891', 'Mask', true],
  [115, 116, 'Tw Variants', '8851234567892', '8859999999999', false],
]
const SEED = `
  INSERT INTO branches (id, name) VALUES (1, 'shop');
  INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, stock_quantity, is_active) VALUES
${PAIRS.flatMap(([a, b, name, x, y]) => [`    (${a}, '${name}', '${x}', 4, 0, 10, 0, 1)`, `    (${b}, '${name}', '${y}', 6, 0, 10, 0, 1)`]).join(',\n')},
    (117, 'Tw Alone', '8850000000001', 3, 0, 8, 0, 1);
  INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (102, 1, 2), (104, 1, 3);
`
const ADMIN = { id: 1, username: 'admin', name: 'Admin', role_code: 'admin', permissions: '{}' }
const SEED_MARK = SEED
function fixtureWrite(write) {
  const db = state.native.db
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec("INSERT INTO system_flags(key,value,updated_at) VALUES('stock_transaction_permit','legacy-separate-pool-v1',CURRENT_TIMESTAMP)")
    const value = write()
    db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    db.exec('COMMIT')
    return value
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
function fresh() {
  state.native = openDb(loadAll())
  fixtureWrite(() => state.native.db.exec(SEED_MARK))
  state.native.db.limits.exprDepth = 100 // D1's SQLite parses with expression depth 100
  state.user = ADMIN
  state.audits = []
  state.beforeFold = null
  state.afterStockRead = null
  state.tier = 'paid'
}
const one = (sql, ...params) => { const row = state.native.db.prepare(sql).get(...params); return row ? { ...row } : row }
const rows = (sql, ...params) => state.native.db.prepare(sql).all(...params).map((row) => ({ ...row }))

async function request(method, url, body) {
  state.queries = 0
  planTier.__resetPlanTierCacheForTests()
  const init = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await app.request(url, init, { DB: {}, PLAN_TIER: state.tier }, { waitUntil: () => {}, passThroughOnException: () => {} })
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text), queries: state.queries } } catch { throw new Error(`${method} ${url} ${res.status}: ${text}`) }
}
const merge = (body) => request('POST', '/api/products/possible-duplicates/merge', body)
const preview = (keepId, mergeId, extra = '') => request('GET', `/api/products/possible-duplicates/merge-preview?keepId=${keepId}&mergeId=${mergeId}&keep=1${extra}`)
const conflicts = () => request('GET', '/api/products/possible-duplicates')

// The client's own twin rule over the rows this database holds (what Products, Inventory and Transfer tag).
async function clientTwinClusters() {
  const out = await esbuild({ entryPoints: [path.join(__dirname, '../../frontend/src/utils/productGrouping.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, mod, mod.exports)
  const items = rows('SELECT id, name, barcode, stock_quantity, is_active, is_group FROM products ORDER BY id')
  const keys = mod.exports.unmergedTwinKeys(items)
  const byKey = new Map()
  items.forEach((item, index) => { if (keys[index]) byKey.set(keys[index], [...(byKey.get(keys[index]) || []), item.id]) })
  return [...byKey.values()].map((ids) => ids.sort((a, b) => a - b))
}
const inOneCluster = (clusters, ids) => clusters.some((cluster) => ids.every((id) => cluster.products.some((p) => Number(p.id) === id)))

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 12).join('\n  ')}`) }
}

// The checks, reusable against a mutant sweep. Returns the failures instead of printing them.
async function listing() {
  fresh()
  const failures = []
  const tagged = await clientTwinClusters()
  const expected = PAIRS.filter((p) => p[5]).map((p) => [p[0], p[1]])
  try { assert.deepEqual(tagged, expected, 'the client tags exactly the seeded twin pairs') } catch (error) { failures.push(error.message.split('\n')[0]) }
  const listed = await conflicts()
  if (listed.status !== 200) return [`GET /possible-duplicates ${listed.status}`]
  for (const ids of tagged) if (!inOneCluster(listed.body.clusters, ids)) failures.push(`tagged cluster ${ids} is not listed by the Conflicts sweep`)
  const variants = PAIRS.find((p) => !p[5])
  if (!inOneCluster(listed.body.clusters, [variants[0], variants[1]])) failures.push('the variants pair (two real barcodes) is no longer listed')
  if (listed.body.clusters.some((c) => c.products.some((p) => p.id === 117))) failures.push('a lone product is listed')
  const preview0 = await preview(101, 102)
  if (preview0.status !== 200 || preview0.body.blocked !== null || preview0.body.cluster !== true) failures.push(`the real/empty pair preview is blocked: ${JSON.stringify(preview0.body.blocked)}`)
  return failures
}

async function main() {
  buildApp()

  await check('every cluster the Duplicate tag marks is listed by the Conflicts sweep, and a pair of two real barcodes is listed but not tagged', async () => {
    assert.deepEqual(await listing(), [])
  })

  await check('MUTANT, the old rule (only a shared code of 4+ characters is listed): the listing check goes red', async () => {
    buildApp([["    if (dismissed.has(dismissKey('name', nameKey))) continue\n", '    continue\n']])
    const failures = await listing()
    buildApp()
    assert.ok(failures.some((f) => /not listed/.test(f)), `expected the unlisted clusters to be reported, got ${JSON.stringify(failures)}`)
    assert.ok(failures.some((f) => /blocked/.test(f)), 'and Resolve to refuse the pair')
  })

  for (const [a, b, name, x, y] of PAIRS.filter((p) => p[5])) {
    for (const [keep, drop, keepCode, dropCode] of [[a, b, x, y], [b, a, y, x]]) {
      await check(`Resolve completes "${name}" keeping ${keep} (barcode ${JSON.stringify(keepCode)}) and merging ${drop} (${JSON.stringify(dropCode)})`, async () => {
        fresh()
        const seen = await preview(keep, drop, `&groupIds=${a},${b}`)
        assert.equal(seen.status, 200, JSON.stringify(seen.body))
        assert.equal(seen.body.cluster, true)
        assert.equal(seen.body.blocked, null, 'a listed pair is never refused')
        assert.equal(Number(seen.body.groupCost.cost_price_usd), 5, 'the cost the rule gives is the mean of the distinct non-zero costs (4 and 6)')
        const done = await merge({ keepId: keep, mergeId: drop, keep: true, stock: 'merge' })
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.equal(one('SELECT is_active FROM products WHERE id = ?', keep).is_active, 1)
        assert.equal(one('SELECT is_active FROM products WHERE id = ?', drop).is_active, 0)
        const realOf = (code) => /^[0-9]{6,}$/.test(code) && !/^0+$/.test(code)
        // N1 (owner, 23 Sep 2026, later than the 15 Sep identity rule): the merge FOLLOWS the kept product. A kept row with no barcode takes the other's real one
        // (real wins over empty, either way round); a kept row that carries any barcode, a word included, keeps it and the other code is recorded (the audit row and
        // the merged record), never lost. Two empty barcodes stay one empty barcode. The person picks the real row as Keep to have the real code win over a word.
        const wanted = keepCode.trim() ? keepCode : (realOf(dropCode) ? dropCode : keepCode)
        assert.equal(one('SELECT barcode FROM products WHERE id = ?', keep).barcode, wanted)
        assert.deepEqual(done.body.keeper.absorbed_barcodes, dropCode.trim() && wanted !== dropCode && !(realOf(keepCode) && realOf(dropCode)) ? [dropCode] : [], 'the barcode the kept row does not carry is recorded, not dropped')
        assert.equal(one('SELECT barcode FROM products WHERE id = ?', drop).barcode, dropCode, 'the merged record keeps its own code')
        // The route's own cost handling (the keeper's catalog cost follows recorded stock; a chosen cost is refused, N4) does not depend on the barcode class:
        // the control pair of two real barcodes, merged the same way with the same costs, ends on the same keeper cost.
        const ownCost = Number(one('SELECT cost_price_usd FROM products WHERE id = ?', keep).cost_price_usd)
        fresh()
        const [ck, cd] = keep === a ? [115, 116] : [116, 115]
        assert.equal((await merge({ keepId: ck, mergeId: cd, keep: true, stock: 'merge' })).status, 200)
        assert.equal(Number(one('SELECT cost_price_usd FROM products WHERE id = ?', ck).cost_price_usd), ownCost, 'same keeper cost as the real/real control')
        fresh()
        assert.equal((await merge({ keepId: keep, mergeId: drop, keep: true, stock: 'merge' })).status, 200)
        const stock = one('SELECT COALESCE(SUM(quantity), 0) AS q FROM branch_stock WHERE product_id = ?', keep).q
        assert.equal(stock, one('SELECT COALESCE(SUM(quantity), 0) AS q FROM branch_stock WHERE product_id IN (?, ?)', a, b).q, 'the stock was carried onto the kept product')
        const gone = await conflicts()
        assert.equal(gone.body.clusters.some((c) => c.products.some((p) => p.id === keep && c.products.some((q) => q.id === drop))), false, 'the pair leaves the Conflicts list')
      })
    }
  }

  await check('the variants pair (not tagged, listed) is still resolvable: Conflicts is the superset', async () => {
    fresh()
    const done = await merge({ keepId: 115, mergeId: 116, keep: true, stock: 'merge' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
  })

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
