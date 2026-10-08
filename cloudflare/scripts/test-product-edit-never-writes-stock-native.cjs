// RET-B F2 sibling writer (5 Oct 2026): a product EDIT never writes stock.
//
// ProductForm sends the stock figure it loaded (read-only in edit mode) with
// every Save, and PUT /products/:id wrote it straight into the
// products.stock_quantity rollup. Open the form while 10 are on hand, sell 3,
// Save a price change: the rollup read 10 again while branch_stock held 7.
// The same body reached the edit-fold writer and the review-queue apply
// (lib/reviewApply.ts), both through updateRow. Stock moves only through
// ledgered stock actions; the rollup is derived from branch_stock.
//
// The harness below is the one test-barcode-fold-create-edit-native.cjs
// established: the REAL routes/products.ts against the full migration chain.
//
// Run (from cloudflare/): node scripts/test-product-edit-never-writes-stock-native.cjs


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

const db = {
  // d1compat.cjs's Stmt.bind(params) takes exactly ONE argument (an object
  // or an array), matching this codebase's own @name-bound call sites. Real
  // D1's bind() is variadic positional (`.bind(a, b, c)`), which is how
  // productWrites.ts's insertRow/updateRow call it -- Stmt.bind(...args)
  // would silently capture only the FIRST arg as `params`, so every later
  // positional value read back as undefined -> bound as NULL (the "NOT NULL
  // constraint failed: products.name" this comment is here to stop someone
  // re-introducing). Collect the whole spread into one array here so it
  // reaches Stmt's own Array.isArray(p) positional-binding branch intact.
  prepare(sql) {
    const st = rawDb.prepare(sql)
    let bound
    const api = {
      bind: (...args) => { bound = args; return api },
      get: (p) => st.get(p !== undefined ? p : bound),
      all: (p) => st.all(p !== undefined ? p : bound) ?? [],
      run: (p) => st.run(p !== undefined ? p : bound),
    }
    return api
  },
  async batch(items) {
    return rawDb.batch(items)
  },
  async batchOnce(items) { return this.batch(items) },
  async transaction(fn) { return fn(db) },
}
const fakeEnv = { DB: db }

const realModuleCache = new Map()
function resolveSiblingSource(request) {
  const base = request.replace(/^.*\//, '')
  for (const dir of ['lib', 'routes', 'durable-objects', '']) {
    const candidate = path.join(SRC_DIR, dir, `${base}.ts`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function transpileFile(sourcePath) {
  return ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(SRC_DIR, relPath)
  const outputText = transpileFile(sourcePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(requireOverrides, request)) return requireOverrides[request]
    if (request.startsWith('.')) {
      const sibling = resolveSiblingSource(request)
      if (sibling) {
        if (!realModuleCache.has(sibling)) {
          const nested = { exports: {} }
          realModuleCache.set(sibling, nested)
          const nestedOut = transpileFile(sibling)
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

const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
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

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ products: true, product_cost_edit: true, product_cost_view: true }) }

const productsRoute = loadReal('routes/products.ts', {
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/db': { getDb: () => db },
  // Nested modules (productWrites.ts, productIdentity.ts, ...) import this
  // relative to lib/ as './db', a DIFFERENT literal specifier than
  // routes/products.ts's own '../lib/db' -- both must point at the same
  // simplified fake so every writer sees the same in-memory database
  // instead of the real D1CompatStatement expecting a genuine D1Database.
  './db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { ...loadReal('lib/audit.ts', { './db': { getDb: () => db } }), audit: async () => {} },
  '../lib/cache': { cachedJsonResponse: async () => null, getVersionWithFallback: async () => 1, bumpVersion: async () => {}, bumpVersions: async () => {} },
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
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/uploadSecurity': { validateUploadedBuffer: async () => ({ ok: true }) },
})

const app = productsRoute.default
assert.ok(app && typeof app.request === 'function', 'routes/products.ts must export the Hono app as default')

function seedBranch() {
  rawDb.exec(`UPDATE branch_stock SET quantity=0; UPDATE branch_batch_stock SET quantity=0;
    UPDATE damaged_stock_lots SET quantity_remaining=0; UPDATE products SET stock_quantity=0;
    DELETE FROM damaged_stock_lots;DELETE FROM undo_snapshots; DELETE FROM branch_batch_stock; DELETE FROM product_batches;
    DELETE FROM branch_stock; DELETE FROM inventory_movements; DELETE FROM product_images;
    DELETE FROM products; DELETE FROM branches;`)
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
}

const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function post(pathname, body) {
  const res = await app.request(pathname, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, fakeEnv, fakeExecutionCtx)
  return { status: res.status, json: await res.json().catch(() => null) }
}
async function put(pathname, body) {
  const res = await app.request(pathname, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, fakeEnv, fakeExecutionCtx)
  return { status: res.status, json: await res.json().catch(() => null) }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const rollup = (id) => rawDb.prepare('SELECT stock_quantity AS q FROM products WHERE id = @id').get({ id }).q
const onHand = (id) => rawDb.prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM branch_stock WHERE product_id = @id').get({ id }).q

async function main() {
  await check('edit opened at 10, sell 3, save a price change: stock stays 7 in both ledgers', async () => {
    seedBranch()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (1, 'Rouge', '880001', 1, 2, 5, 10)`).run()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 10)').run()
    // A sale between opening the form and saving it.
    rawDb.prepare('UPDATE branch_stock SET quantity = quantity - 3 WHERE product_id = 1').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 7 WHERE id = 1').run()
    const res = await put('/1', { name: 'Rouge', barcode: '880001', selling_price_usd: 6, stock_quantity: 10 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(rawDb.prepare('SELECT selling_price_usd AS p FROM products WHERE id = 1').get().p, 6, 'the field edit landed')
    assert.equal(onHand(1), 7)
    assert.equal(rollup(1), 7, 'the stale form figure must not overwrite the rollup')
    // Double apply: the same Save again changes nothing about stock.
    const again = await put('/1', { name: 'Rouge', barcode: '880001', selling_price_usd: 6, stock_quantity: 10 })
    assert.equal(again.status, 200)
    assert.equal(rollup(1), 7)
    assert.equal(onHand(1), 7)
  })

  await check('a stock-only body writes nothing to stock (zero, negative, or a raise)', async () => {
    for (const figure of [0, -4, 99]) {
      await put('/1', { stock_quantity: figure })
      assert.equal(rollup(1), 7, `stock_quantity ${figure} ignored`)
      assert.equal(onHand(1), 7)
    }
  })

  await check('an edit that folds into a same-name twin carries no stale figure onto the survivor', async () => {
    seedBranch()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd, stock_quantity)
      VALUES (1, 'Fold Keeper', '777000', 1, 5, 2)`).run()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd, stock_quantity)
      VALUES (2, 'Fold Dup', '00777000', 1, 5, 3)`).run()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 2)').run()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 3)').run()
    const res = await put('/2', { name: 'Fold Keeper', barcode: '777000', stock_quantity: 40 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(onHand(1), 5, 'the fold moved 3 onto 2')
    assert.notEqual(rollup(1), 40, 'the body figure never reaches the survivor rollup')
    assert.equal(rollup(1), 5, 'the survivor rollup equals its branch stock')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((err) => {
  console.error('FAIL', err && err.stack ? err.stack : err)
  process.exitCode = 1
})
