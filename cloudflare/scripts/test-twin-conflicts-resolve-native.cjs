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
//     the cost the grid preview shows and the merge applies, the weighted cost of the received lots (owner, 5 Oct 2026: 2 at $4 and 3 at $6 is $5.2);
//   * a pair the tag does not mark (two genuinely different real barcodes) is still listed and still resolvable: Conflicts is the superset;
//   * "Keep both" is a ruling (round 3/4 review, finding (a)): the real dismiss route stores it, the real GET /duplicate-dismissals ships it, and the real client
//     rule drops a dismissed cluster, so at EVERY step of a dismissal a twin cluster is tagged exactly when the Conflicts sweep lists it (a tag on a pair the tab
//     no longer lists was a dead end: Resolve refuses it with product_merge_not_duplicates). Every kind of pair, and a cluster listed by two Conflicts clusters
//     that needs both dismissed. Mutants: the client ignores the rulings, the route ships none.
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
// It must never reach JSON: a stand-in is a function, and JSON.stringify drops a function silently, so a JSON-bound SQL parameter
// loses the field and binds NULL. That is how the lot match of merge-by-date (lib/productMergeLots, unwired here) became a NULL batch_id
// and the 0154 trigger refused the merge. A module whose values are written must be wired in for real below.
let inertKeys = 0
const INERT_IN_JSON = 'an inert stand-in reached JSON (a bound SQL parameter or a stored payload): wire the real module into this test'
function inert() {
  const key = `inert-${inertKeys += 1}`
  return new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => key : prop === 'toJSON' ? () => { throw new Error(INERT_IN_JSON) } : inert()),
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
  // Merge-by-date: the one lot match (received date) the fold, its read plan and the cost preview share. Wired as
  // test-product-resolve-keep-merge-native.cjs wires it.
  const productMergeLots = load('lib/productMergeLots.ts', { './moneyPrecision': moneyPrecision, './businessDateWindow': load('lib/businessDateWindow.ts') })
  const permissions = load('lib/permissions.ts')
  planTier = load('lib/planTier.ts')
  const requestBodyGuard = load('lib/requestBodyGuard.ts')
  const actorSnapshot = load('lib/actorSnapshot.ts')
  const sqlBinding = load('lib/sqlBinding.ts')
  const detailRule = load('lib/productDetailRule.ts', { './moneyPrecision': moneyPrecision })
  const productIdentity = load('lib/productIdentity.ts', { './db': {}, './sqlBinding': sqlBinding, './productDetailRule': detailRule }, sweepPatches)
  const productMerge = load('lib/productMerge.ts', { './moneyPrecision': moneyPrecision })
  const productStockGuard = load('lib/productStockGuard.ts')
  const productMergeSnapshot = load('lib/productMergeSnapshot.ts', { './db': {}, './productMergeLots': productMergeLots })
  const acquisitionCostAccess = load('lib/acquisitionCostAccess.ts', { './permissions': permissions })
  const noAudit = { audit: async (_env, _uid, _uname, action, entity, id, detail) => { state.audits.push({ action, entity, id, detail }) } }
  const broadcastHub = { broadcast: async () => {} }
  const catalogCost = load('lib/catalogCostRecompute.ts', { './moneyPrecision': moneyPrecision })
  const costReview = load('lib/productCostReview.ts', { './catalogCostRecompute': catalogCost })
  const costPreview = load('lib/productMergeCostPreview.ts', { './productMergeLots': productMergeLots, './catalogCostRecompute': catalogCost, './productCostReview': costReview, './productConflictActionGroups': load('lib/productConflictActionGroups.ts') })
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
    '../lib/productMergeLots': productMergeLots,
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
// Pairs: [first id, second id, name, barcode, barcode, tagged?]. Every row holds one received lot: the first of a pair 2 units at $4, the second 3 units at $6, so the
// merged cost is (2 x 4 + 3 x 6) / 5 = 5.2, which is what the grid's preview shows and the merge applies (the mean of the distinct costs, 5, is the superseded rule).
const PAIRS = [
  [101, 102, 'Tw Real Empty', REAL, '', true],
  [103, 104, 'Tw Empty Empty', '', '', true],
  [105, 106, 'Tw Word Word', 'NoBox188', 'Mask', true],
  [107, 108, 'Tw Short Short', '12345', '12346', true],
  [109, 110, 'Tw Zero Zero', '0', '0', true],
  [111, 112, 'Tw Real Khmer', REAL, KHMER, true],
  [113, 114, 'Tw Real Word', '8851234567891', 'Mask', true],
  [115, 116, 'Tw Variants', '8851234567892', '8859999999999', false],
  // Each of these owns its code: a barcode cluster spans names (the Worker groups it by the code alone), so a shared code would tie two pairs' rulings together.
  [118, 119, 'Tw Real Real', '8851234567801', '8851234567801', true],
  [120, 121, 'Tw Leading Zero', '8851234567802', '08851234567802', true],
  [122, 123, 'Tw Word Same', 'NoBox777', 'NoBox777', true],
  // Names the dismissal key must agree on with the sweep's name_key, which is SQLite lower(trim(name)) (review r5, M1): an inner run of spaces, an accented capital
  // (lower() folds A-Z only) and the same in Khmer. A key that collapsed the spaces or folded the accent stored a ruling the sweep never matched, so the tag stayed for ever.
  [127, 128, 'Tw  Inner Space', '8851234567821', '', true],
  [129, 130, 'Tw Crème Éclat', '', '', true],
  [131, 132, 'ក្រែម  លាប ម៉ាស', '', '', true],
]
// A twin cluster beside a real variant of its own name: held by the barcode cluster of its code AND by the name cluster, two rulings that must both be made.
const BESIDE = { name: 'Tw Beside Variant', ids: [124, 125, 126], twin: [124, 125], codes: ['8851234567811', '8851234567811', '8851234567812'] }
const TAGGED_CLUSTERS = [...PAIRS.filter((p) => p[5]).map((p) => [p[0], p[1]]), BESIDE.twin].sort((left, right) => left[0] - right[0])
const SEED = `
  INSERT INTO branches (id, name) VALUES (1, 'shop');
  INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, stock_quantity, is_active) VALUES
${PAIRS.flatMap(([a, b, name, x, y]) => [`    (${a}, '${name}', '${x}', 4, 0, 10, 0, 1)`, `    (${b}, '${name}', '${y}', 6, 0, 10, 0, 1)`]).join(',\n')},
    (117, 'Tw Alone', '8850000000001', 3, 0, 8, 0, 1),
${BESIDE.ids.map((id, i) => `    (${id}, '${BESIDE.name}', '${BESIDE.codes[i]}', 4, 0, 10, 0, 1)`).join(',\n')};
${PAIRS.flatMap(([a, b]) => [[a, 2, 4], [b, 3, 6]]).map(([id, quantity, cost]) => `
  INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, unit_cost_usd, received_at) VALUES (${1000 + id}, ${id}, 'lot-${id}', 1, ${cost}, '2026-09-01');
  INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (${1000 + id}, 1, ${quantity});
  INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (${id}, 1, ${quantity});
  UPDATE products SET stock_quantity = ${quantity} WHERE id = ${id};`).join('')}
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

// The client's own twin rule over the rows this database holds (what Products, Inventory and Transfer tag), with the "Keep both" rulings the real route shipped
// (null: none loaded, the rule as it stood before the rulings). clientPatches edit the real client source (mutants).
const clientModules = new Map()
async function clientApi(clientPatches = []) {
  const key = JSON.stringify(clientPatches)
  if (clientModules.has(key)) return clientModules.get(key)
  const frontend = path.join(__dirname, '../../frontend/src')
  const patcher = { name: 'client-patches', setup(b) {
    b.onLoad({ filter: /\.ts$/ }, (args) => {
      let text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
      for (const [from, to] of clientPatches) if (text.includes(from)) text = text.replace(from, () => to)
      return { contents: text, loader: 'ts' }
    })
  } }
  const entry = "export * from './utils/productGrouping.ts'\nexport * from './utils/productTwinDismissals.ts'\n"
  const out = await esbuild({ stdin: { contents: entry, resolveDir: frontend, loader: 'ts' }, plugins: [patcher], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, mod, mod.exports)
  clientModules.set(key, mod.exports)
  return mod.exports
}
async function clientTwinClusters(payload = null, clientPatches = []) {
  const api = await clientApi(clientPatches)
  api.setTwinDismissals(payload ? api.parseTwinDismissals(payload) : api.NO_TWIN_DISMISSALS)
  const items = rows('SELECT id, name, barcode, stock_quantity, is_active, is_group FROM products ORDER BY id')
  const keys = api.unmergedTwinKeys(items)
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
  const expected = TAGGED_CLUSTERS
  try { assert.deepEqual(tagged, expected, 'the client tags exactly the seeded twin clusters') } catch (error) { failures.push(error.message.split('\n')[0]) }
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
        // The cost the grid shows is the authority's (rendered from POST resolve/cost-preview; the preview carries the same one): the weighted cost of the received lots.
        // groupCost and identity.costAfter still hold the superseded mean of the distinct costs (5) and no client renders either, so neither is asserted.
        assert.equal(Number(seen.body.costAuthority.cost_price_usd), 5.2, 'the cost the grid applies is the weighted cost of the lots: (2 x 4 + 3 x 6) / 5')
        assert.equal(seen.body.costAuthority.source, 'received_lot')
        const done = await merge({ keepId: keep, mergeId: drop, keep: true, stock: 'merge' })
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.equal(Number(one('SELECT cost_price_usd AS c FROM products WHERE id = ?', keep).c), 5.2, 'the merge applies the cost the preview showed')
        // Merge-by-date (owner, 16 Nov 2026): both lots were received on 2026-09-01, so the discarded lot's stock is ADDED into the kept lot,
        // which then carries the quantity-weighted cost; no lot is created, and the discarded lot stays on its own record, inactive, empty and
        // marked by the merge (merge_deactivated_at keeps its payable counted once).
        const keptLot = 1000 + keep
        const droppedLot = 1000 + drop
        const lotShelf = () => rows('SELECT batch_id, branch_id, quantity FROM branch_batch_stock WHERE batch_id IN (?, ?) ORDER BY batch_id', keptLot, droppedLot)
        const lotState = (id) => one('SELECT variant_product_id AS product, is_active, unit_cost_usd, merge_deactivated_at IS NOT NULL AS marked FROM product_batches WHERE id = ?', id)
        assert.deepEqual(lotShelf(), [{ batch_id: keptLot, branch_id: 1, quantity: 5 }], 'the discarded lot\'s stock is added into the kept lot of the same received date')
        assert.deepEqual({ ...lotState(keptLot), unit_cost_usd: Number(lotState(keptLot).unit_cost_usd) }, { product: keep, is_active: 1, unit_cost_usd: 5.2, marked: 0 }, 'the kept lot carries the weighted cost (2 x 4 + 3 x 6) / 5')
        assert.deepEqual({ ...lotState(droppedLot), unit_cost_usd: Number(lotState(droppedLot).unit_cost_usd) }, { product: drop, is_active: 0, unit_cost_usd: drop === a ? 4 : 6, marked: 1 }, 'the discarded lot stays on its own record, inactive and marked')
        assert.equal(one('SELECT COUNT(*) AS n FROM product_batches WHERE variant_product_id = ?', keep).n, 1, 'one lot per received date: none is created')
        assert.equal(one('SELECT is_active FROM products WHERE id = ?', keep).is_active, 1)
        assert.equal(one('SELECT is_active FROM products WHERE id = ?', drop).is_active, 0)
        const realOf = (code) => /^[0-9]{6,}$/.test(code) && !/^0+$/.test(code)
        // N1 (owner, 23 Sep 2026, later than the 15 Sep identity rule): the merge FOLLOWS the kept product. A kept row with no barcode takes the other's real one
        // (real wins over empty, either way round); a kept row that carries any barcode, a word included, keeps it and the other code is recorded (the audit row and
        // the merged record), never lost. Two empty barcodes stay one empty barcode. The person picks the real row as Keep to have the real code win over a word.
        // Two spellings of one real code (leading zeros) are one barcode, and the already-clean spelling survives whichever row is kept (the auto-merge's own rule).
        const stripZeros = (code) => code.replace(/^0+/, '')
        const oneCode = realOf(keepCode) && realOf(dropCode) && keepCode !== dropCode && stripZeros(keepCode) === stripZeros(dropCode)
        const wanted = oneCode ? stripZeros(keepCode) : keepCode.trim() ? keepCode : (realOf(dropCode) ? dropCode : keepCode)
        assert.equal(one('SELECT barcode FROM products WHERE id = ?', keep).barcode, wanted)
        assert.deepEqual(done.body.keeper.absorbed_barcodes, dropCode.trim() && wanted !== dropCode && !(realOf(keepCode) && realOf(dropCode)) ? [dropCode] : [], 'the barcode the kept row does not carry is recorded, not dropped')
        assert.equal(one('SELECT barcode FROM products WHERE id = ?', drop).barcode, dropCode, 'the merged record keeps its own code')
        // The same Resolve sent again (a double tap, a retried request) must not add the stock a second time.
        const again = await merge({ keepId: keep, mergeId: drop, keep: true, stock: 'merge' })
        assert.deepEqual([again.status, again.body.code], [409, 'product_merge_inactive'], 'the repeat is refused: the discarded product is already merged')
        assert.deepEqual(lotShelf(), [{ batch_id: keptLot, branch_id: 1, quantity: 5 }], 'a repeated merge leaves the kept lot at 5')
        assert.equal(one('SELECT COALESCE(SUM(quantity), 0) AS q FROM branch_stock WHERE product_id IN (?, ?)', a, b).q, 5, 'a repeated merge leaves the shelf at 5')
        assert.equal(Number(lotState(keptLot).unit_cost_usd), 5.2, 'and the kept lot\'s cost where the first merge left it')
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

  // ---- "Keep both" (finding (a)) ------------------------------------------------------------------------------------------------------------------
  // What the client is told, through the real route, and what it then tags, against what the real sweep lists, with every ruling made through the real dismiss route
  // the way the Conflicts tab makes it (the cluster's own type and value).
  const dismissals = () => request('GET', '/api/products/duplicate-dismissals')
  const dismiss = (type, value) => request('POST', '/api/products/possible-duplicates/dismiss', { type, value })
  const holding = (clusters, ids) => clusters.filter((cluster) => ids.every((id) => cluster.products.some((p) => Number(p.id) === id)))
  async function rulingFailures(label, clientPatches = []) {
    const failures = []
    const shipped = await dismissals()
    if (shipped.status !== 200) return [`${label}: GET /duplicate-dismissals ${shipped.status}`]
    const all = await clientTwinClusters(null, clientPatches)
    const tagged = await clientTwinClusters(shipped.body, clientPatches)
    const listed = await conflicts()
    for (const ids of all) {
      const isTagged = tagged.some((candidate) => candidate.join() === ids.join())
      const isListed = holding(listed.body.clusters, ids).length > 0
      if (isTagged && !isListed) failures.push(`${label}: cluster ${ids} is tagged but Conflicts does not list it (a dead end)`)
      if (!isTagged && isListed) failures.push(`${label}: cluster ${ids} is listed by Conflicts but not tagged`)
      if (isTagged) {
        const seen = await preview(ids[0], ids[1], `&groupIds=${ids.join(',')}`)
        if (seen.status !== 200 || seen.body.blocked !== null || seen.body.cluster !== true) failures.push(`${label}: tagged cluster ${ids} cannot be resolved: ${JSON.stringify(seen.body.blocked)}`)
      }
    }
    return failures
  }
  // A person "Keeps both" of one cluster: every Conflicts cluster that lists it is dismissed in turn, and at every step the tag and the listing agree.
  async function keepBothSteps(ids, clientPatches = [], label = ids.join('+')) {
    fresh()
    const failures = await rulingFailures(`${label} before`, clientPatches)
    const steps = holding((await conflicts()).body.clusters, ids)
    if (!steps.length) failures.push(`${label}: no Conflicts cluster lists the pair to begin with`)
    for (const [index, cluster] of steps.entries()) {
      const answer = await dismiss(cluster.type, cluster.value)
      if (answer.status !== 200) failures.push(`${label}: dismiss ${cluster.type} answered ${answer.status}`)
      failures.push(...await rulingFailures(`${label} after dismissing ${index + 1} of ${steps.length} (${cluster.type})`, clientPatches))
    }
    return { failures, steps }
  }

  const TAGGED_PAIRS = PAIRS.filter((p) => p[5])
  await check('GET /duplicate-dismissals ships what the dismiss route stored, nothing the twin rule cannot use, and answers a person without product access with 403', async () => {
    fresh()
    assert.deepEqual((await dismissals()).body, { success: true, dismissals: [] })
    for (const [type, value] of [['name', 'Some Name'], ['barcode', '  8851234567801 '], ['leadingzero', '08851234567802'], ['similar', 'Some Name']]) assert.equal((await dismiss(type, value)).status, 200)
    assert.deepEqual((await dismissals()).body.dismissals, [['barcode', '8851234567801'], ['leadingzero', '8851234567802'], ['name', 'some name']], 'normalised keys, the three cluster types a twin sits in, sorted')
    state.user = { id: 9, username: 'nobody', name: 'Nobody', role_code: 'custom', role_permissions: JSON.stringify({ contacts: true }), permissions: '{}' }
    assert.equal((await dismissals()).status, 403)
    state.user = ADMIN
  })
  // Round 5, L3: the shell asks for every account that can open Products, Inventory, Branches or POS, and the route answers exactly the roles that may run a product search (the
  // search index's audience). A role it refuses gets no Duplicate tag in the client (frontend/tests/twinDismissalsDenied.test.ts); a role it serves reads names and barcodes of
  // dismissed clusters only, which a person who can search the catalogue sees anyway. The route is not widened to the two refused roles that open a list with the tag.
  await check('GET /duplicate-dismissals answers every role that may search products and refuses a branches-only role and an image-only Products reader (the client then shows no tag)', async () => {
    fresh()
    assert.equal((await dismiss('barcode', '8851234567801')).status, 200)
    const role = (permissions) => ({ id: 9, username: 'role', name: 'Role', role_code: 'custom', role_permissions: JSON.stringify(permissions), permissions: '{}' })
    const expected = [
      ['products', { products: true }, 200],
      ['pos', { pos: true }, 200],
      ['inventory', { inventory: true }, 200],
      ['sales (view)', { sales: true }, 200],
      ['products with the image-only grant too', { products: true, products_image_only: true }, 200],
      ['branches only', { branches: true }, 403],
      ['image-only Products only', { products_image_only: true }, 403],
      ['contacts only', { contacts: true }, 403],
    ]
    for (const [label, permissions, status] of expected) {
      state.user = role(permissions)
      const answer = await dismissals()
      assert.equal(answer.status, status, `${label}: ${JSON.stringify(answer.body)}`)
      if (status === 403) {
        assert.equal(answer.body.dismissals, undefined, `${label}: a refused role is shown no names or barcodes`)
        assert.equal(answer.body.code, 'twin_dismissals_denied', `${label}: the refusal carries the code the client latches on (any other 403 is transient)`)
      } else assert.deepEqual(answer.body.dismissals, [['barcode', '8851234567801']], label)
    }
    state.user = ADMIN
  })
  for (const [a, b, name] of TAGGED_PAIRS) {
    await check(`"Keep both" on "${name}": the tag and the Conflicts listing agree at every step, the pair ends untagged and unlisted, Resolve refuses it, every other cluster keeps its tag`, async () => {
      const { failures, steps } = await keepBothSteps([a, b], [], name)
      assert.deepEqual(failures, [])
      const tagged = await clientTwinClusters((await dismissals()).body)
      assert.equal(tagged.some((ids) => ids.includes(a)), false, 'the pair lost its tag')
      assert.equal(holding((await conflicts()).body.clusters, [a, b]).length, 0, 'and Conflicts lists it no more')
      assert.equal(tagged.length, TAGGED_CLUSTERS.length - 1, 'only this pair lost its tag')
      const refused = await merge({ keepId: a, mergeId: b, keep: true, stock: 'merge' })
      assert.equal(refused.status, 409)
      assert.equal(refused.body.code, 'product_merge_not_duplicates', 'the dead end the tag used to lead to')
      assert.ok(steps.length >= 1)
    })
  }
  await check('a twin cluster beside a real variant is listed by two Conflicts clusters: it keeps its tag until both are dismissed, in either order', async () => {
    for (const order of [['barcode', 'name'], ['name', 'barcode']]) {
      fresh()
      const listed = holding((await conflicts()).body.clusters, BESIDE.twin)
      assert.deepEqual(listed.map((cluster) => cluster.type).sort(), ['barcode', 'name'], 'a barcode cluster and a name cluster list it')
      assert.deepEqual(await rulingFailures('start'), [])
      const first = listed.find((cluster) => cluster.type === order[0])
      assert.equal((await dismiss(first.type, first.value)).status, 200)
      assert.deepEqual(await rulingFailures(`after ${order[0]}`), [])
      assert.ok((await clientTwinClusters((await dismissals()).body)).some((ids) => ids.join() === BESIDE.twin.join()), `still tagged after only the ${order[0]} cluster: the ${order[1]} cluster still lists it`)
      const second = listed.find((cluster) => cluster.type === order[1])
      assert.equal((await dismiss(second.type, second.value)).status, 200)
      assert.deepEqual(await rulingFailures(`after ${order[1]}`), [])
      assert.equal((await clientTwinClusters((await dismissals()).body)).some((ids) => ids.join() === BESIDE.twin.join()), false, 'untagged once both are dismissed')
    }
  })
  await check('MUTANT, the client ignores the rulings: the tagged-but-unlisted dead end is found', async () => {
    const { failures } = await keepBothSteps([118, 119], [["if (cluster.length < 2 || twinDismissalRule?.(cluster, name, rows)) continue", 'if (cluster.length < 2) continue']], 'Tw Real Real')
    assert.ok(failures.some((f) => /tagged but Conflicts does not list it/.test(f)), `expected the dead end, got ${JSON.stringify(failures)}`)
  })
  await check('MUTANT, the route ships no rulings: the same dead end is found', async () => {
    buildApp([["    .all<{ cluster_type: string; cluster_value: string }>({})\n  return rows.map((row) => [row.cluster_type, row.cluster_value])", "    .all<{ cluster_type: string; cluster_value: string }>({})\n  return rows.slice(0, 0).map((row) => [row.cluster_type, row.cluster_value])"]])
    const { failures } = await keepBothSteps([118, 119], [], 'Tw Real Real')
    buildApp()
    assert.ok(failures.some((f) => /tagged but Conflicts does not list it/.test(f)), `expected the dead end, got ${JSON.stringify(failures)}`)
  })
  await check('MUTANT, the client waits for one cluster only (some, not every): a pair a second cluster still lists loses its tag', async () => {
    const { failures } = await keepBothSteps(BESIDE.twin, [['holders.every((key) => dismissals.has(key))', 'holders.some((key) => dismissals.has(key))']], 'Tw Beside Variant')
    assert.ok(failures.some((f) => /listed by Conflicts but not tagged/.test(f)), `expected the lost tag, got ${JSON.stringify(failures)}`)
  })
  await check('the dismissal read is one covering-index SELECT: the plan names idx_product_dup_dismissals_key and no table scan', async () => {
    fresh()
    const plan = rows("EXPLAIN QUERY PLAN SELECT cluster_type, cluster_value FROM product_duplicate_dismissals WHERE cluster_type IN ('name', 'barcode', 'leadingzero') ORDER BY cluster_type, cluster_value").map((row) => row.detail).join(' | ')
    assert.match(plan, /USING COVERING INDEX idx_product_dup_dismissals_key/, plan)
    assert.doesNotMatch(plan, /SCAN product_duplicate_dismissals(?! USING)/, plan)
    state.queries = 0
    await dismissals()
    assert.equal(state.queries, 1, 'one statement per answer (the shipped route reads nothing else)')
  })

  // Products' "Keep both" over the REAL routes (round 7 review, B2): the real handler (frontend keepBothDuplicate, compiled from its source) reads the real Conflicts route, stores
  // its rulings through the real dismiss route, and another pair that shares no row with the pair must keep its Duplicate tag AND its Conflicts listing. The leading-zero ruling is
  // keyed by the folded code alone, across every product name, so a ruling made for one name's cluster used to silence another name's pair (Tw Lz B, Tw Lz F), depending on row order.
  const KEEP_BOTH_SHAPES = [
    ['r6 B1: blank, real A, then the pair on real B in one name', [[151, 'Tw Collateral', ''], [152, 'Tw Collateral', '8851234567861'], [153, 'Tw Collateral', '8851234567862'], [154, 'Tw Collateral', '8851234567862']], 153, ['barcode:8851234567862'], 'product_duplicate_kept_still_listed'],
    ['Tw Lz A 0601,0601,601 beside Tw Lz B 601,00601 (A first)', [[161, 'Tw Lz A', '0601'], [162, 'Tw Lz A', '0601'], [163, 'Tw Lz A', '601'], [164, 'Tw Lz B', '601'], [165, 'Tw Lz B', '00601']], 161, ['barcode:0601'], 'product_duplicate_kept_still_listed'],
    ['Tw Lz B 601,00601 before Tw Lz A 0601,0601,601 (B has the lower ids)', [[161, 'Tw Lz B', '601'], [162, 'Tw Lz B', '00601'], [163, 'Tw Lz A', '0601'], [164, 'Tw Lz A', '0601'], [165, 'Tw Lz A', '601']], 163, ['barcode:0601'], 'product_duplicate_kept_still_listed'],
    ['long codes: Tw Lz C R,R,0R beside Tw Lz D 0R,00R', [[171, 'Tw Lz C', '8851234567870'], [172, 'Tw Lz C', '8851234567870'], [173, 'Tw Lz C', '08851234567870'], [174, 'Tw Lz D', '08851234567870'], [175, 'Tw Lz D', '008851234567870']], 171, ['barcode:8851234567870'], 'product_duplicate_kept_still_listed'],
    ['Tw Lz F 601,601 beside Tw Lz E 0601,0601,601', [[181, 'Tw Lz E', '0601'], [182, 'Tw Lz E', '0601'], [183, 'Tw Lz E', '601'], [186, 'Tw Lz F', '601'], [187, 'Tw Lz F', '601']], 181, ['barcode:0601'], 'product_duplicate_kept_still_listed'],
    ['whitespace 2+1: Tw Ws R,R beside Tw  Ws R (one display group of three; the whole group is the click)', [[201, 'Tw Ws', '8851234567880'], [202, 'Tw Ws', '8851234567880'], [203, 'Tw  Ws', '8851234567880']], 201, ['barcode:8851234567880'], 'product_duplicate_kept_both', [201, 202, 203]],
    ['whitespace 2+2 (round 8 review E1): Tw Ws R,R beside Tw  Ws R,R (one display group of four, so no separate twin is ruled behind the person)', [[201, 'Tw Ws', '8851234567880'], [202, 'Tw Ws', '8851234567880'], [203, 'Tw  Ws', '8851234567880'], [204, 'Tw  Ws', '8851234567880']], 201, ['barcode:8851234567880'], 'product_duplicate_kept_both', [201, 202, 203, 204]],
    ['whitespace 2+2 with a blank-barcode row of the first spelling: the name cluster lists two of the group, so the toast says still listed', [[201, 'Tw Ws', '8851234567880'], [202, 'Tw Ws', '8851234567880'], [203, 'Tw  Ws', '8851234567880'], [204, 'Tw  Ws', '8851234567880'], [205, 'Tw Ws', '']], 201, ['barcode:8851234567880'], 'product_duplicate_kept_still_listed', [201, 202, 203, 204]],
  ]
  for (const [title, spec, pick, expectedRulings, expectedToast, expectedGroup] of KEEP_BOTH_SHAPES) await check(`Keep both on a pair over the real routes: ${title}`, async () => {
    fresh()
    fixtureWrite(() => state.native.db.exec('INSERT INTO products (id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, stock_quantity, is_active) VALUES ' + spec.map(([id, name, code]) => `(${id}, '${name}', '${code}', 4, 0, 10, 0, 1)`).join(', ')))
    const out = await esbuild({ stdin: { contents: "export * from './utils/productGrouping.ts'\nexport * from './utils/productTwinDismissals.ts'\nexport * as exact from './utils/exactDuplicateProducts.ts'\n", resolveDir: path.join(__dirname, '../../frontend/src'), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' })
    const pm = { exports: {} }
    new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, pm, pm.exports)
    const fe = pm.exports
    const transportSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/shared/twinDismissalsTransport.ts'), 'utf8').replace(/\r\n/g, '\n')
    const tm = { exports: {} }
    new Function('require', 'module', 'exports', require('esbuild').transformSync(transportSource, { loader: 'ts', format: 'cjs' }).code)((id) => {
      if (id.endsWith('http.ts')) return { apiFetch: async (method, url) => { const a = await request(method, url); if (a.status !== 200) throw Object.assign(new Error(`HTTP ${a.status}`), { status: a.status, code: a.body && a.body.code }); return a.body } }
      if (id.endsWith('productWriteTransport.ts')) return { dismissProductDuplicateCluster: async (type, value) => { const a = await dismiss(type, value); if (a.status !== 200) throw new Error(`dismiss ${a.status} ${JSON.stringify(a.body)}`); return a.body } }
      if (id.endsWith('productTwinDismissals.ts')) return fe
      if (id.endsWith('exactDuplicateProducts.ts')) return fe.exact
      throw new Error(`unexpected require ${id}`)
    }, tm, tm.exports)
    const tags = () => {
      const items = rows('SELECT id, name, barcode, stock_quantity, is_active, is_group FROM products ORDER BY id')
      const keys = fe.unmergedTwinKeys(items)
      const byKey = new Map()
      items.forEach((item, i) => { if (keys[i]) byKey.set(keys[i], [...(byKey.get(keys[i]) || []), item.id]) })
      return [...byKey.values()].map((ids) => ids.sort((a, b) => a - b))
    }
    fe.setTwinDismissals(fe.parseTwinDismissals((await dismissals()).body))
    const before = await conflicts()
    const T0 = tags()
    const info = fe.exact.buildExactDuplicateIndex(fe.exact.extractDuplicateClusters(before.body)).get(pick)
    assert.ok(info, 'the pair is offered Keep both')
    const ids = info.members.map((m) => Number(m.id))
    if (expectedGroup) assert.deepEqual([...ids].sort((x, y) => x - y), expectedGroup, 'the group Keep both is offered on is every row the Products list shows as that name with that code (it groups names with the collapsing key)')
    const listedBefore = new Set(before.body.clusters.flatMap((c) => c.products.map((p) => Number(p.id))))
    const toasts = []
    await tm.exports.keepBothDuplicate(fe.exact.extractDuplicateClusters(before.body), info, (m) => toasts.push(m), (k) => k, async () => {})
    const ruled = rows('SELECT cluster_type, cluster_value FROM product_duplicate_dismissals ORDER BY cluster_type, cluster_value').map((r) => `${r.cluster_type}:${r.cluster_value}`)
    const after = await conflicts()
    const listedAfter = new Set(after.body.clusters.flatMap((c) => c.products.map((p) => Number(p.id))))
    for (const id of listedBefore) if (!listedAfter.has(id)) assert.ok(ids.includes(id), `row ${id} lost its Conflicts listing although it is not in the group the person clicked`)
    const T1 = tags()
    assert.deepEqual(ruled, expectedRulings, 'only the rulings this pair is owed are stored')
    assert.deepEqual(toasts, [expectedToast], 'the toast says whether the pair is still listed')
    const listedTogether = after.body.clusters.some((c) => c.type !== 'barcode' && c.type !== 'similar' && c.products.filter((p) => ids.includes(Number(p.id))).length >= 2)
    assert.equal(listedTogether, expectedToast === 'product_duplicate_kept_still_listed', 'the toast is true: two or more of the group are listed together exactly when it says so')
    let separate = 0
    for (const T of T0) {
      if (T.some((id) => ids.includes(id))) continue
      separate += 1
      assert.ok(T1.some((t) => t.join() === T.join()), `the separate pair ${T} keeps its Duplicate tag`)
      assert.ok(inOneCluster(after.body.clusters, T), `the separate pair ${T} keeps its Conflicts listing`)
    }
    if (/Lz|Collateral/.test(title)) assert.ok(separate >= 1, 'the shape has a separate pair to protect')
  })
  await check('the variants pair (not tagged, listed) is still resolvable: Conflicts is the superset', async () => {
    fresh()
    const done = await merge({ keepId: 115, mergeId: 116, keep: true, stock: 'merge' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
  })

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
