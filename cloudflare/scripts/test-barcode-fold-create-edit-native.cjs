// P10-5 (owner ruling, 2026-09-16, verbatim): "some places did not apply the
// rules regarding the merge prompt etc... like barcodes leading zero (when
// add products if product is same but existing barcode has 0, remove the
// zero, etc." A same-name product whose barcode differs only by leading
// zeros (or is empty/broken on one side) is the SAME product -- the
// create/edit writers must FOLD into the existing row, never prompt or 409.
//
// This drives the REAL POST / and PUT /:id Hono routes from
// routes/products.ts against a real in-memory SQLite database (the full
// migration chain), the same technique test-merge-wholesale-price-pure.cjs
// established: unlisted relative imports resolve to the REAL sibling module
// by basename, and only genuinely Worker-runtime modules (D1 binding, auth,
// cache, broadcast, image upload, rate limiting) are stubbed.
//
// Run (from cloudflare/): node scripts/test-barcode-fold-create-edit-native.cjs

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
    if (items.every(({ sql }) => /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql))) {
      return items.map(({ sql, params }) => ({ success: true, results: db.prepare(sql).all(params || {}) }))
    }
    const out = []
    for (const item of items) out.push(db.prepare(item.sql).run(item.params || {}))
    return out
  },
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
  '../lib/audit': { audit: async () => {} },
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
  rawDb.exec(`DELETE FROM undo_snapshots; DELETE FROM branch_batch_stock; DELETE FROM product_batches;
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

async function main() {
  await check('create-fold: existing padded barcode "0123456" + incoming "123456" same name -> ONE product, stored barcode cleaned, no 409', async () => {
    seedBranch()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd, cost_price_khr, selling_price_usd)
      VALUES (1, 'Zero Fold Serum', '0123456', 1, 5, 0, 20)`).run()
    const res = await post('/', { name: 'Zero Fold Serum', barcode: '123456', cost_price_usd: 7, branch_id: 1 })
    assert.equal(res.status, 200, `create must return 200, not a 409 refusal -- got ${res.status}: ${JSON.stringify(res.json)}`)
    assert.equal(res.json.folded_into, 1, 'the fold reports which row it folded into')
    const rows = rawDb.prepare('SELECT id, is_active FROM products').all()
    assert.equal(rows.length, 1, 'no second row was minted')
    const row = rawDb.prepare('SELECT barcode, cost_price_usd FROM products WHERE id = 1').get()
    assert.equal(row.barcode, '123456', 'the stored barcode is cleaned to the real zero-stripped code')
    assert.equal(row.cost_price_usd, 6, 'the distinct costs (5 and 7) average to 6, same rule as every other fold')
  })

  await check('create-fold: a DIFFERENT real barcode stays a legitimate child row (negative control)', async () => {
    seedBranch()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd)
      VALUES (1, 'Two Real Codes', '1112223334445', 1, 5)`).run()
    const res = await post('/', { name: 'Two Real Codes', barcode: '9998887776665', cost_price_usd: 5, branch_id: 1 })
    assert.equal(res.status, 200, 'a genuine sibling still creates fine')
    assert.ok(res.json.id !== 1 && !res.json.folded_into, 'two different REAL barcodes must NOT fold together')
    const rows = rawDb.prepare('SELECT id FROM products').all()
    assert.equal(rows.length, 2, 'a new sibling row was created')
  })

  await check('create-fold: broken/wildcard existing barcode adopts the incoming REAL one', async () => {
    seedBranch()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd)
      VALUES (1, 'Wildcard Row', 'NoBox', 1, 0)`).run()
    const res = await post('/', { name: 'Wildcard Row', barcode: '3614274226546', cost_price_usd: 9, branch_id: 1 })
    assert.equal(res.status, 200)
    assert.equal(res.json.folded_into, 1)
    const row = rawDb.prepare('SELECT barcode, cost_price_usd FROM products WHERE id = 1').get()
    assert.equal(row.barcode, '3614274226546', 'the broken barcode is replaced by the real incoming one')
    assert.equal(row.cost_price_usd, 9, 'a previously-0 (unrecorded) cost is simply replaced, not averaged in')
  })

  await check('create-fold is IDEMPOTENT: folding twice never mints a third row nor re-double-counts cost', async () => {
    seedBranch()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd)
      VALUES (1, 'Repeat Fold', '00123456', 1, 6)`).run()
    const first = await post('/', { name: 'Repeat Fold', barcode: '123456', cost_price_usd: 9, branch_id: 1 })
    assert.equal(first.status, 200)
    const afterFirst = rawDb.prepare('SELECT barcode, cost_price_usd FROM products WHERE id = 1').get()
    assert.equal(afterFirst.barcode, '123456')
    assert.equal(afterFirst.cost_price_usd, 7.5, 'mean of 6 and 9')
    const second = await post('/', { name: 'Repeat Fold', barcode: '123456', cost_price_usd: 9, branch_id: 1 })
    assert.equal(second.status, 200)
    assert.equal(second.json.folded_into, 1)
    const rows = rawDb.prepare('SELECT id FROM products').all()
    assert.equal(rows.length, 1, 'still exactly one row after a second identical create')
  })

  await check('edit-fold: re-barcoding row 2 onto row 1\'s zero-stripped identity merges 2 INTO 1, never 409', async () => {
    seedBranch()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd, stock_quantity)
      VALUES (1, 'Edit Fold Cream', '3348901', 1, 5, 0)`).run()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd, stock_quantity)
      VALUES (2, 'Edit Fold Cream Two', '9998887', 1, 4, 0)`).run()
    const res = await put('/2', { name: 'Edit Fold Cream', barcode: '03348901' })
    assert.equal(res.status, 200, `edit must fold, not 409 -- got ${res.status}: ${JSON.stringify(res.json)}`)
    assert.equal(res.json.merged_into, 1, 'row 2 folded into row 1')
    const survivorActive = rawDb.prepare('SELECT is_active FROM products WHERE id = 1').get().is_active
    const dupActive = rawDb.prepare('SELECT is_active FROM products WHERE id = 2').get().is_active
    assert.equal(survivorActive, 1, 'the survivor stays active')
    assert.equal(dupActive, 0, 'the folded-away row is deactivated, not deleted -- old references stay valid')
  })

  await check('edit-fold moves the discarded row\'s STOCK onto the survivor (arithmetic must balance)', async () => {
    seedBranch()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd, stock_quantity)
      VALUES (1, 'Stocked Keeper', '555000', 1, 5, 2)`).run()
    rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, cost_price_usd, stock_quantity)
      VALUES (2, 'Stocked Dup', '00555000', 1, 5, 3)`).run()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 2)').run()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (2, 1, 3)').run()
    const res = await put('/2', { name: 'Stocked Keeper', barcode: '555000' })
    assert.equal(res.status, 200, `edit-fold with stock present must still fold (default merge disposition) -- got ${res.status}: ${JSON.stringify(res.json)}`)
    const keeperStock = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get()
    assert.equal(keeperStock.quantity, 5, 'the discarded row\'s stock (3) moved onto the keeper\'s (2) -- 5 total, nothing lost or double-counted')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((err) => {
  console.error('FAIL', err && err.stack ? err.stack : err)
  process.exitCode = 1
})
