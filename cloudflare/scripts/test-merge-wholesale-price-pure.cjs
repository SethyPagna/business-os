// S4-32 regression: the WHOLESALE tier must survive a duplicate-product
// merge, and must survive undoing one.
//
// Migration 0111 moved the discounted tier out of special_price_usd/khr and
// into wholesale_price_usd/khr, zeroing the old pair and keeping it only as
// inert ballast for stale PWA till tabs. Every surface was re-pointed in that
// same change EXCEPT the merge path, which is owned by a different lane and
// still named the dead columns:
//
//   * routes/products.ts foldDuplicateProductInto SELECTed and MAX-merged
//     special_price_*, so the keeper's UPDATE carried the maximum of 0 and 0
//     and the duplicate's real wholesale price was simply deactivated away
//     with its row. Nothing threw; the money left the catalogue silently.
//   * lib/undoAppliers.ts restored special_price_* on undo, so once the fold
//     starts writing wholesale_price_* an undo that did not restore it would
//     leave the keeper holding the MERGED price forever.
//
// This test drives the REAL exported fold from routes/products.ts and the
// REAL undo applier from lib/undoAppliers.ts against the REAL migration chain
// (0001..0111 inclusive) in an in-memory SQLite database. It is deliberately
// behavioural, not source-shaped: the defect was invisible to every existing
// source guard precisely because the SQL was still valid.
//
// Run (from cloudflare/): node scripts/test-merge-wholesale-price-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC_DIR = path.join(__dirname, '..', 'src')

const migrations = loadAll()
const rawDb = openDb(migrations)

// The migration chain under test must genuinely include 0111 -- if a rename
// ever drops it this test would otherwise keep passing against a schema where
// special_price_* still holds the tier.
{
  const has0111 = fs.readdirSync(path.join(__dirname, '..', 'migrations'))
    .some((f) => /^0111_.*\.sql$/.test(f))
  assert.ok(has0111, 'migration 0111 must exist -- this test is about the schema it produces')
  const cols = rawDb.prepare('SELECT name FROM pragma_table_info(@t)').all({ t: 'products' }).map((r) => r.name)
  assert.ok(cols.includes('wholesale_price_usd') && cols.includes('wholesale_price_khr'), 'wholesale columns must exist')
  assert.ok(cols.includes('special_price_usd') && cols.includes('special_price_khr'), '0111 keeps the old pair as inert ballast')
}

// D1Compat-shaped adapter, same normalization lib/db.ts's real wrapper does.
const db = {
  prepare(sql) {
    const st = rawDb.prepare(sql)
    return {
      get: (p) => st.get(p == null ? {} : p),
      all: (p) => st.all(p == null ? {} : p) ?? [],
      run: (p) => {
        const r = st.run(p == null ? {} : p)
        return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  async batch(items) {
    const out = []
    for (const item of items) out.push(db.prepare(item.sql).run(item.params || {}))
    return out
  },
  async transaction(fn) { return fn(db) },
}
const fakeEnv = { DB: db }

function transpile(relPath) {
  const sourcePath = path.join(SRC_DIR, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

// routes/products.ts pulls in ~30 sibling modules, most of them pure. Rather
// than a 30-line stub wall that rots on every new import, unlisted relative
// specifiers are resolved by basename against src/lib, src/routes and
// src/durable-objects and transpiled for REAL (memoized). Only the modules
// that genuinely need the Worker runtime -- D1, auth, KV/cache, the broadcast
// DO -- are named in `requireOverrides`.
const realModuleCache = new Map()
function resolveSiblingSource(request) {
  const base = request.replace(/^.*\//, '')
  for (const dir of ['lib', 'routes', 'durable-objects', '']) {
    const candidate = path.join(SRC_DIR, dir, `${base}.ts`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(requireOverrides, request)) return requireOverrides[request]
    if (request.startsWith('.')) {
      const sibling = resolveSiblingSource(request)
      if (sibling) {
        if (!realModuleCache.has(sibling)) {
          // Seed the cache BEFORE evaluating so an import cycle resolves to a
          // (still-empty) exports object instead of recursing forever.
          const nested = { exports: {} }
          realModuleCache.set(sibling, nested)
          const { outputText: nestedOut } = ts.transpileModule(fs.readFileSync(sibling, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
            fileName: sibling,
          })
          new Function('exports', 'require', 'module', '__filename', '__dirname', nestedOut)(
            nested.exports, require, nested, sibling, path.dirname(sibling),
          )
        }
        return realModuleCache.get(sibling).exports
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

// ---------------------------------------------------------------------------
// REAL modules. productDetailRule is the merge rule itself, so it is never
// stubbed; undoAppliers is the module whose applier is under test.
// ---------------------------------------------------------------------------
const productDetailRule = loadReal('lib/productDetailRule.ts')

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const undoAppliers = loadReal('lib/undoAppliers.ts', {
  './actorSnapshot': actorSnapshotKernel,
  '../index': {},
  './auth': {},
  './db': { getDb: () => db },
  './audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  './branchWrites': { branchUpdateStatements: () => [] },
  './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
  './saleLineAddition': {
    buildAllocationStatements: () => [],
    planSaleLineAddition: () => ({ lines: [], statements: [], saleItemStatementIndexByLine: [], deductions: [], deductedUnits: 0, addedSubtotalUsd: 0 }),
    planSaleLineRemoval: () => ({ statements: [], restoredUnits: 0 }),
    plannedLineFromRecord: (record) => record,
    saleMoneyUpdateStatement: () => ({ sql: 'SELECT 1', params: {} }),
  },
})

// routes/products.ts is loaded for its EXPORTED foldDuplicateProductInto.
// Everything with no bearing on pricing (auth, audit, search, cache,
// broadcast, images, permissions) is stubbed inert; the fold's own SQL, the
// pricing/cost resolution and the reversal it returns are all real.
const inertSearch = {
  buildFtsMatchExpression: () => "''",
  buildHybridMatchClause: () => '1=1',
  buildIssueStateClauses: () => [],
  buildPartialWordMatchClause: () => '1=1',
  buildShortWordFallbackClause: () => '1=1',
  buildTrigramMatchExpression: () => "''",
  expandAliasCandidates: (value) => [value],
  normalizedHaystackSql: () => "''",
  PRODUCT_SEARCH_COLUMNS: 'id, name',
  PRODUCTS_FTS_BM25_SQL: '0',
  runFuzzyFallbackMatch: async () => [],
  tokenizeSearchTermGroups: () => [],
  tokenizeSearchWords: () => [],
}

const productsRoute = loadReal('routes/products.ts', {
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => next() },
  '../lib/audit': { audit: async () => {} },
  '../lib/cache': { cachedJsonResponse: async () => null, getVersionWithFallback: async () => 1, bumpVersion: async () => {} },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  '../lib/importImageMatch': { matchLibraryImagesStrict: async () => [], ADMIN_MAX_IMAGES_PER_PRODUCT: 20, MAX_IMAGES_PER_PRODUCT: 10 },
  '../lib/permissions': {
    hasPermission: () => true, getPermissionTier: () => 'full', getActionTier: () => 'full',
    getMergedPermissions: () => ({}), isAdminControlUser: () => true,
  },
  '../lib/searchMatch': inertSearch,
  '../lib/productSearchQuery': { buildProductSearchQuery: () => ({ hasSearchTerm: false, titleOnly: false }), buildFamilyRelevanceOrderSql: (tail) => tail },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../lib/salesAnalytics': { getProductSalesBreakdown: async () => ({}) },
  '../lib/bulkDeleteEngine': { createBulkDeleteJob: async () => ({}), getBulkDeleteJob: async () => null, reapStalledBulkDeleteJobs: async () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ ok: true }), getClientIp: () => '127.0.0.1' },
  '../lib/uploadSecurity': { validateUploadedBuffer: async () => ({ ok: true }) },
  // The undo recorders are the real module's, so a snapshot really lands in
  // undo_snapshots and the applier below reads what the fold actually wrote.
  '../lib/undoAppliers': undoAppliers,
  '../lib/productDetailRule': productDetailRule,
})

const foldDuplicateProductInto = productsRoute.foldDuplicateProductInto
assert.equal(typeof foldDuplicateProductInto, 'function', 'routes/products.ts must export foldDuplicateProductInto')

// ---------------------------------------------------------------------------
const NAME = 'MAC Matte Lipstick No Box 601'

function seed({ keeperWholesaleUsd, keeperWholesaleKhr, dupWholesaleUsd, dupWholesaleKhr }) {
  rawDb.exec('DELETE FROM undo_snapshots; DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM inventory_movements; DELETE FROM product_images; DELETE FROM products; DELETE FROM branches;')
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
  const insert = rawDb.prepare(`INSERT INTO products
      (id, name, barcode, is_active, stock_quantity, selling_price_usd, selling_price_khr,
       wholesale_price_usd, wholesale_price_khr, special_price_usd, special_price_khr,
       cost_price_usd, cost_price_khr)
    VALUES (@id, @name, @barcode, 1, @qty, @sellUsd, @sellKhr, @wUsd, @wKhr, 0, 0, @costUsd, 0)`)
  insert.run({ id: 1, name: NAME, barcode: '601', qty: 2, sellUsd: 17, sellKhr: 69700, wUsd: keeperWholesaleUsd, wKhr: keeperWholesaleKhr, costUsd: 10.5 })
  insert.run({ id: 2, name: NAME, barcode: '601', qty: 3, sellUsd: 17, sellKhr: 69700, wUsd: dupWholesaleUsd, wKhr: dupWholesaleKhr, costUsd: 10.5 })
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 2)').run()
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 3)').run()
}

function wholesaleOf(id) {
  return rawDb.prepare('SELECT wholesale_price_usd, wholesale_price_khr FROM products WHERE id = @id').get({ id })
}

async function merge() {
  return foldDuplicateProductInto(
    fakeEnv, db, { id: 1, username: 'tester', name: 'Test' },
    { id: 1, name: NAME },
    { id: 2, name: NAME, image_path: null },
    new Map([[1, 'Main']]),
    'merge_duplicates',
  )
}

// Undo runs through the REAL registry entry ('product.merge'), reading the
// reversal back out of undo_snapshots exactly as a reloaded page would --
// which is also what proves an OLD stored snapshot still undoes correctly.
async function undoMerge(reversal) {
  const { snapshotId } = await undoAppliers.recordMergeUndoSnapshot(fakeEnv, { id: 1, name: 'Test' }, reversal)
  const applier = undoAppliers.resolveUndoApplier({ applier: 'product.merge', snapshot_id: snapshotId })
  assert.ok(applier, "the 'product.merge' undo applier must be registered")
  await applier.run({ applier: 'product.merge', snapshot_id: snapshotId }, { env: fakeEnv, user: { id: 1, name: 'Test' }, direction: 'undo' })
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('merging carries the DUPLICATE\'s higher wholesale price onto the keeper (the money that was disappearing)', async () => {
    seed({ keeperWholesaleUsd: 0, keeperWholesaleKhr: 0, dupWholesaleUsd: 12.5, dupWholesaleKhr: 51250 })
    await merge()
    const after = wholesaleOf(1)
    assert.equal(after.wholesale_price_usd, 12.5,
      'the merged-away row\'s wholesale USD price must land on the keeper -- it was silently deactivated away with its row')
    assert.equal(after.wholesale_price_khr, 51250, 'same for KHR: both currencies of the tier must be carried')
    assert.equal(rawDb.prepare('SELECT is_active FROM products WHERE id = 2').get().is_active, 0, 'the duplicate really was folded away')
  })

  await check('merging never drops the KEEPER below its own wholesale price (MAX-wins, not last-write-wins)', async () => {
    seed({ keeperWholesaleUsd: 12.5, keeperWholesaleKhr: 51250, dupWholesaleUsd: 9, dupWholesaleKhr: 36900 })
    await merge()
    const after = wholesaleOf(1)
    assert.equal(after.wholesale_price_usd, 12.5, 'the higher of the two wholesale prices wins, exactly as selling price does')
    assert.equal(after.wholesale_price_khr, 51250)
  })

  await check('undoing the merge restores the keeper\'s ORIGINAL wholesale price, not the merged one', async () => {
    seed({ keeperWholesaleUsd: 9, keeperWholesaleKhr: 36900, dupWholesaleUsd: 12.5, dupWholesaleKhr: 51250 })
    const { reversal } = await merge()
    assert.equal(wholesaleOf(1).wholesale_price_usd, 12.5, 'precondition: the merge raised the keeper to the duplicate\'s price')
    await undoMerge(reversal)
    const after = wholesaleOf(1)
    assert.equal(after.wholesale_price_usd, 9, 'undo must put the keeper\'s own wholesale price back, not leave the merged maximum')
    assert.equal(after.wholesale_price_khr, 36900)
    assert.equal(wholesaleOf(2).wholesale_price_usd, 12.5, 'the reactivated duplicate keeps its own wholesale price')
  })

  await check('a PRE-RENAME undo snapshot (special_price_* only) must NOT zero a real wholesale price', async () => {
    // Snapshots written before this fix carry the tier under its old
    // special_price_* name -- and post-0111 those values ARE the wholesale
    // numbers, because 0111 moved them. Reading only wholesale_price_* would
    // find undefined, coerce it to 0 and wipe the keeper's price on undo:
    // the same silent loss, one layer down.
    seed({ keeperWholesaleUsd: 9, keeperWholesaleKhr: 36900, dupWholesaleUsd: 12.5, dupWholesaleKhr: 51250 })
    const { reversal } = await merge()
    const legacy = JSON.parse(JSON.stringify(reversal))
    legacy.keeperPricingBefore = {
      selling_price_usd: 17, selling_price_khr: 69700,
      special_price_usd: 9, special_price_khr: 36900,
      cost_price_usd: 10.5, cost_price_khr: 0,
    }
    await undoMerge(legacy)
    const after = wholesaleOf(1)
    assert.equal(after.wholesale_price_usd, 9, 'a legacy snapshot\'s special_price_usd is the wholesale price 0111 moved -- restore it, never 0')
    assert.equal(after.wholesale_price_khr, 36900)
  })

  await check('a snapshot carrying NEITHER spelling leaves the keeper\'s wholesale price alone', async () => {
    seed({ keeperWholesaleUsd: 9, keeperWholesaleKhr: 36900, dupWholesaleUsd: 12.5, dupWholesaleKhr: 51250 })
    const { reversal } = await merge()
    const ancient = JSON.parse(JSON.stringify(reversal))
    ancient.keeperPricingBefore = { selling_price_usd: 17, selling_price_khr: 69700 }
    await undoMerge(ancient)
    const after = wholesaleOf(1)
    assert.equal(after.wholesale_price_usd, 12.5,
      'with nothing recorded to restore, undo must leave the column untouched rather than write a 0 over it')
  })

  await check('the dead special_price_* ballast is never written a non-zero value again', async () => {
    seed({ keeperWholesaleUsd: 9, keeperWholesaleKhr: 36900, dupWholesaleUsd: 12.5, dupWholesaleKhr: 51250 })
    const { reversal } = await merge()
    await undoMerge(reversal)
    const rows = rawDb.prepare('SELECT id, special_price_usd, special_price_khr FROM products ORDER BY id').all()
    for (const row of rows) {
      assert.equal(Number(row.special_price_usd) || 0, 0, `product ${row.id} must leave the retired VIP column at 0`)
      assert.equal(Number(row.special_price_khr) || 0, 0, `product ${row.id} must leave the retired VIP column at 0`)
    }
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err)
  process.exitCode = 1
})
