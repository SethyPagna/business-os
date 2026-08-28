// Regression test for reset-data's new mode='products' path (routes/
// system.ts), the user's Aug 21 2026 ask: delete products plus their own
// branch/batch stock, KEEP sales/returns/inventory-movement/contact/
// customer/supplier data untouched. Same approach as test-returns-batch-
// restock-pure.cjs: transpile the REAL route file and lib/coreDataInvariants.ts,
// run them against a real in-memory SQLite database with every real
// migration applied, and call the actual Hono app.request() the same way
// the real Worker would. Auth/audit/broadcast/cache/R2 are stubbed to
// permissive fakes (there's no real R2/D1 in this sandbox); everything
// about which rows get deleted vs. kept is the real, shipped logic.
//
// Part 412 widened this file to also cover the CAPPED blanket-prefix R2
// sweeps (reset-data mode='all' and factory-reset): one shared
// MAX_IMAGE_DELETES_PER_RESET budget across uploads/ + imports/,
// sequential deletes, and an honest leftover/failure report in the
// response instead of an uncapped Promise.all that implied a full wipe.
//
// Run (from cloudflare/): node scripts/test-reset-products-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDbHandle = openDb(loadAll())
const db = rawDbHandle
const fakeEnv = { DB: db, ASSETS: null, CACHE: { get: async () => null, put: async () => {} } }

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    // esModuleInterop mirrors what wrangler's esbuild bundling does in
    // production: without it, coreDataInvariants' `import bcrypt from
    // 'bcryptjs'` (a CJS package) transpiles to `.default.hashSync` and
    // the factory-reset reseed dies on undefined.
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  return outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const outputText = transpile(relPath)
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ backup: true }) }

// Real table list under test -- if PRODUCTS_RESET_TABLES in the shipped
// source drifts (a table added/removed), this import picks up the change
// automatically instead of this test silently checking a stale copy.
const coreDataInvariants = loadReal('lib/coreDataInvariants.ts', {
  './db': { getDb: () => db },
  // Real helper: coreDataInvariants routes its previous-identity IN-lists
  // through sqlBinding (the one place the 100-param rule lives).
  './sqlBinding': loadReal('lib/sqlBinding.ts', {}),
})
const { PRODUCTS_RESET_TABLES } = coreDataInvariants
assert.ok(Array.isArray(PRODUCTS_RESET_TABLES) && PRODUCTS_RESET_TABLES.length > 0, 'PRODUCTS_RESET_TABLES must be a real, non-empty exported list')

let deletedObjectKeys = []
// Configurable R2 listing/failure fixtures for the CAPPED blanket-prefix
// sweeps (mode='all' + factory-reset, Part 412): each sweep lists a whole
// prefix and used to fire one uncapped Promise.all over it -- these
// fixtures let the tests below hand the route more objects than
// MAX_IMAGE_DELETES_PER_RESET allows and prove the route deletes only up
// to the cap and REPORTS the remainder instead of claiming a full wipe.
let listedObjectsByPrefix = {}
let listShouldFailFor = new Set()
let deleteShouldFailFor = new Set()
const permissions = loadReal('lib/permissions.ts')
const media = loadReal('lib/media.ts')

const systemRoute = loadReal('routes/system.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': permissions,
  '../lib/dataIntegrity': { runDataIntegrityCheck: async () => ({}) },
  // Error reporting is fire-and-forget and irrelevant to reset logic --
  // stubbed so this test never reaches the network.
  '../lib/errorReporting': { reportError: async () => false },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/r2': {
    listObjects: async (_bucket, prefix) => {
      if (listShouldFailFor.has(prefix)) throw new Error('simulated R2 list failure')
      return (listedObjectsByPrefix[prefix] || []).map((key) => ({ key }))
    },
    deleteObject: async (_bucket, key) => {
      if (deleteShouldFailFor.has(key)) throw new Error('simulated R2 delete failure')
      deletedObjectKeys.push(key)
    },
  },
  '../lib/coreDataInvariants': coreDataInvariants,
  '../lib/backup': {
    // Real prerequisite under test: every mode must call one of these
    // BEFORE touching any data, and abort cleanly if it throws. Tracked
    // via module-level flags so tests can assert call order, failure
    // handling, and -- for the products mode -- WHICH tables the backup
    // was scoped to.
    createCloudflareBackup: async () => { backupCallLog.push('called'); if (backupShouldFail) throw new Error('simulated backup failure'); return { name: 'fake-backup' } },
    // mode='products' uses the scoped backup instead: the full one walks
    // every backup table and lists the whole R2 bucket, which is what
    // produced the reported `Exceeded CPU Limit` before the reset could
    // run at all.
    createSectionBackup: async (_env, tables) => {
      backupCallLog.push('called')
      sectionBackupTables = [...tables]
      if (backupShouldFail) throw new Error('simulated backup failure')
      return { name: 'fake-section-backup' }
    },
  },
  '../lib/media': media,
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
})

// Every table any products-mode toggle can clear. Written out here rather
// than imported so this test fails if the route quietly starts clearing
// something new without it being noticed.
const ALL_RESET_CANDIDATE_TABLES = [
  'product_images', 'rfid_tags', 'branch_batch_stock', 'product_batches', 'branch_stock', 'products',
  'inventory_movements', 'stock_row_moves', 'stock_transfers',
  'return_item_batch_allocations', 'sale_item_batch_allocations', 'return_items', 'returns', 'sale_items', 'sales',
  'action_history',
]

let backupCallLog = []
let backupShouldFail = false
let sectionBackupTables = null

const app = systemRoute.default
// The REAL cap and sweep helper, so every fixture below seeds relative to
// the shipped number instead of welding itself to a copy of it (the A4
// lesson recorded in wrangler.toml's decision ledger).
const { MAX_IMAGE_DELETES_PER_RESET, sweepPrefixCapped } = systemRoute
assert.ok(Number.isInteger(MAX_IMAGE_DELETES_PER_RESET) && MAX_IMAGE_DELETES_PER_RESET > 0, 'MAX_IMAGE_DELETES_PER_RESET must be a real, exported positive integer')
assert.strictEqual(typeof sweepPrefixCapped, 'function', 'sweepPrefixCapped must be exported for direct testing')
const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function req(method, url, body) {
  const res = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function exec(sql) { rawDbHandle.exec(sql) }
function row(sql) { return rawDbHandle.prepare(sql).get() }
function count(table) { return row(`SELECT COUNT(*) AS n FROM "${table}"`).n }

function seed() {
  // Wipe every table this test touches so each check() starts clean,
  // regardless of run order.
  const wipe = [
    'return_item_batch_allocations', 'sale_item_batch_allocations', 'return_items', 'returns',
    'sale_items', 'sales', 'inventory_movements', 'stock_transfers', 'stock_row_moves',
    'rfid_tags', 'product_images', 'branch_batch_stock', 'product_batches', 'branch_stock',
    'products', 'branches', 'customers', 'suppliers', 'delivery_contacts', 'action_history',
    'file_assets',
  ]
  exec(wipe.map((t) => `DELETE FROM "${t}";`).join(' '))

  rawDbHandle.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
  rawDbHandle.prepare("INSERT INTO products (id, name, is_active, stock_quantity, image_path) VALUES (1, 'Eye Shadow Palette', 1, 10, '/uploads/product-1-main.jpg')").run()
  rawDbHandle.prepare("INSERT INTO product_images (id, product_id, image_path) VALUES (1, 1, '/uploads/product-1-gallery-a.jpg')").run()
  rawDbHandle.prepare("INSERT INTO product_images (id, product_id, image_path) VALUES (2, 1, 'uploads/product-1-gallery-b.jpg')").run()
  rawDbHandle.prepare('INSERT INTO branch_stock (id, product_id, branch_id, quantity) VALUES (1, 1, 1, 10)').run()
  const batch = rawDbHandle.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code) VALUES (1, 1, 'BK-1', 'LOT-A')").run()
  rawDbHandle.prepare('INSERT INTO branch_batch_stock (id, batch_id, branch_id, quantity) VALUES (1, 1, 1, 10)').run()
  rawDbHandle.prepare("INSERT INTO rfid_tags (id, epc_id, product_id, branch_id, status) VALUES (1, 'EPC-1', 1, 1, 'active')").run()

  // Sales/returns/movements -- denormalized, must survive with a dangling
  // product_id, per this session's spec.
  rawDbHandle.prepare('INSERT INTO sales (id, branch_id) VALUES (1, 1)').run()
  rawDbHandle.prepare("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, applied_price_usd, batch_id) VALUES (1, 1, 1, 'Eye Shadow Palette', 2, 12.5, 1)").run()
  rawDbHandle.prepare("INSERT INTO returns (id, sale_id, branch_id) VALUES (1, 1, 1)").run()
  rawDbHandle.prepare("INSERT INTO return_items (id, return_id, sale_item_id, product_id, product_name, quantity) VALUES (1, 1, 1, 1, 'Eye Shadow Palette', 1)").run()
  rawDbHandle.prepare("INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, lot_code) VALUES (1, 1, 1, 1, 2, 'LOT-A')").run()
  rawDbHandle.prepare("INSERT INTO inventory_movements (id, product_id, product_name, branch_id, movement_type, quantity) VALUES (1, 1, 'Eye Shadow Palette', 1, 'sale', -2)").run()

  // Untouched-by-products-reset control rows, to prove the "keep
  // everything else" half of the spec, not just the "delete products"
  // half.
  rawDbHandle.prepare("INSERT INTO customers (id, name) VALUES (1, 'Repeat Customer')").run()
  rawDbHandle.prepare("INSERT INTO suppliers (id, name) VALUES (1, 'Acme Supplier')").run()

  // Library asset row, unrelated to any product -- exists to prove
  // mode='all' clears file_assets (Part 248 fix) since it also blanket-
  // wipes the 'uploads/' R2 prefix those rows point at.
  rawDbHandle.prepare("INSERT INTO file_assets (id, original_name, stored_name, public_path) VALUES (1, 'logo.png', 'logo-abc123.png', '/uploads/logo-abc123.png')").run()

  deletedObjectKeys = []
  listedObjectsByPrefix = {}
  listShouldFailFor = new Set()
  deleteShouldFailFor = new Set()
  backupCallLog = []
  backupShouldFail = false
  sectionBackupTables = null
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('mode=products deletes every table in PRODUCTS_RESET_TABLES', async () => {
    seed()
    for (const table of PRODUCTS_RESET_TABLES) assert.ok(count(table) > 0, `sanity: ${table} should be seeded before the reset`)

    const { status, json } = await req('POST', '/reset-data', { mode: 'products' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))

    for (const table of PRODUCTS_RESET_TABLES) assert.strictEqual(count(table), 0, `${table} should be empty after mode='products'`)
  })

  await check('mode=products keeps sales, returns, movements, and batch allocations (dangling ids are fine, rows are not)', async () => {
    seed()
    await req('POST', '/reset-data', { mode: 'products' })

    assert.strictEqual(count('sales'), 1, 'sales must survive a products reset')
    assert.strictEqual(count('sale_items'), 1, 'sale_items must survive a products reset')
    assert.strictEqual(count('returns'), 1, 'returns must survive a products reset')
    assert.strictEqual(count('return_items'), 1, 'return_items must survive a products reset')
    assert.strictEqual(count('sale_item_batch_allocations'), 1, 'batch allocations must survive a products reset')
    assert.strictEqual(count('inventory_movements'), 1, 'inventory_movements must survive a products reset')

    const saleItem = row('SELECT * FROM sale_items WHERE id = 1')
    assert.strictEqual(saleItem.product_name, 'Eye Shadow Palette', 'sale_items keeps its own product_name snapshot even once the product row is gone')
    assert.strictEqual(saleItem.applied_price_usd, 12.5, 'sale_items keeps its own price snapshot')
  })

  await check('mode=products keeps customers, suppliers, and branches entirely untouched', async () => {
    seed()
    await req('POST', '/reset-data', { mode: 'products' })

    assert.strictEqual(count('customers'), 1, 'customers must be untouched by a products reset')
    assert.strictEqual(count('suppliers'), 1, 'suppliers must be untouched by a products reset')
    assert.strictEqual(count('branches'), 1, 'branches must be untouched by a products reset')
  })

  await check('mode=products forces a backup BEFORE deleting anything, and aborts with zero rows changed if the backup fails', async () => {
    seed()
    backupShouldFail = true
    const beforeProducts = count('products')
    assert.strictEqual(beforeProducts, 1, 'sanity')

    const { status, json } = await req('POST', '/reset-data', { mode: 'products' })
    assert.strictEqual(status, 500, JSON.stringify(json))
    assert.strictEqual(json.success, false, JSON.stringify(json))
    assert.ok(/backup/i.test(json.error || ''), `error message should mention the backup failure, got: ${json.error}`)
    assert.strictEqual(backupCallLog.length, 1, 'backup must have been attempted')
    assert.strictEqual(count('products'), 1, 'products must be UNCHANGED when the pre-reset backup fails -- this is the whole point of the prerequisite')
  })

  // The failure a scoped backup can introduce, guarded directly: a backup
  // that misses a table the reset then clears is a backup that cannot undo
  // the reset it was taken for. The route derives both lists from one
  // array precisely so these two can never drift.
  await check('mode=products backs up EXACTLY the tables it is about to clear -- no table is deleted without being backed up first', async () => {
    for (const toggles of [{}, { includeMovements: true }, { includeSales: true }, { includeMovements: true, includeSales: true }]) {
      seed()
      const before = new Map()
      for (const table of ALL_RESET_CANDIDATE_TABLES) before.set(table, count(table))

      await req('POST', '/reset-data', { mode: 'products', ...toggles })

      assert.ok(Array.isArray(sectionBackupTables), `the scoped backup must have been called for toggles ${JSON.stringify(toggles)}`)
      const backedUp = new Set(sectionBackupTables)
      for (const table of ALL_RESET_CANDIDATE_TABLES) {
        const wasCleared = before.get(table) > 0 && count(table) === 0
        if (wasCleared) {
          assert.ok(backedUp.has(table), `${table} was cleared by toggles ${JSON.stringify(toggles)} but was NOT in the scoped backup -- the backup could not undo this reset`)
        }
      }
    }
  })

  await check('the scoped backup for mode=products does not quietly widen into a full-database dump', async () => {
    seed()
    await req('POST', '/reset-data', { mode: 'products' })
    // The point of scoping: the expensive tables a full backup walks
    // (and the reason the request exceeded the CPU limit) must not be in
    // a default products backup, because a default products reset does
    // not touch them.
    for (const table of ['sales', 'sale_items', 'inventory_movements', 'customers', 'audit_logs']) {
      assert.ok(!sectionBackupTables.includes(table), `${table} must not be in a default products-reset backup -- that reset does not delete it`)
    }
  })

  await check('mode=products keeps stored image files by default', async () => {
    seed()
    await req('POST', '/reset-data', { mode: 'products' })

    assert.strictEqual(deletedObjectKeys.length, 0, `image files should be retained unless explicitly selected, got: ${JSON.stringify(deletedObjectKeys)}`)
  })

  await check('mode=products with includeImages=true only deletes the specific selected product image keys, not a blanket prefix wipe', async () => {
    seed()
    await req('POST', '/reset-data', { mode: 'products', includeImages: true })

    // 3 real image paths were seeded: products.image_path + 2 product_images
    // rows, one already-slashed and one bare (both sanitizeMediaPath forms).
    assert.strictEqual(deletedObjectKeys.length, 3, `expected exactly the 3 seeded image keys, got: ${JSON.stringify(deletedObjectKeys)}`)
    assert.ok(deletedObjectKeys.includes('uploads/product-1-main.jpg'), JSON.stringify(deletedObjectKeys))
    assert.ok(deletedObjectKeys.includes('uploads/product-1-gallery-a.jpg'), JSON.stringify(deletedObjectKeys))
    assert.ok(deletedObjectKeys.includes('uploads/product-1-gallery-b.jpg'), JSON.stringify(deletedObjectKeys))
  })

  await check('mode=products, includeMovements=true also deletes movement/audit tables but keeps sales/returns/contacts', async () => {
    seed()
    const { status, json } = await req('POST', '/reset-data', { mode: 'products', includeMovements: true })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))

    assert.strictEqual(count('inventory_movements'), 0, 'inventory_movements should be cleared when includeMovements=true')
    assert.strictEqual(count('stock_transfers'), 0, 'stock_transfers should be cleared when includeMovements=true')
    assert.strictEqual(count('stock_row_moves'), 0, 'stock_row_moves should be cleared when includeMovements=true')

    // Sales/returns/contacts are a SEPARATE toggle -- includeMovements
    // alone must not also clear these.
    assert.strictEqual(count('sales'), 1, 'sales must survive includeMovements=true alone')
    assert.strictEqual(count('returns'), 1, 'returns must survive includeMovements=true alone')
    assert.strictEqual(count('customers'), 1, 'customers must always survive mode=products regardless of toggles')
  })

  await check('mode=products, includeSales=true also deletes sales/returns/allocations but keeps movements/contacts', async () => {
    seed()
    const { status, json } = await req('POST', '/reset-data', { mode: 'products', includeSales: true })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))

    assert.strictEqual(count('sales'), 0, 'sales should be cleared when includeSales=true')
    assert.strictEqual(count('sale_items'), 0, 'sale_items should be cleared when includeSales=true')
    assert.strictEqual(count('returns'), 0, 'returns should be cleared when includeSales=true')
    assert.strictEqual(count('return_items'), 0, 'return_items should be cleared when includeSales=true')
    assert.strictEqual(count('sale_item_batch_allocations'), 0, 'sale_item_batch_allocations should be cleared when includeSales=true')

    // Movements/contacts are a SEPARATE toggle/always-kept set --
    // includeSales alone must not also clear these.
    assert.strictEqual(count('inventory_movements'), 1, 'inventory_movements must survive includeSales=true alone')
    assert.strictEqual(count('customers'), 1, 'customers must always survive mode=products regardless of toggles')
  })

  await check('mode=products, both toggles true clears products, movements, AND sales/returns in one atomic call, but never contacts', async () => {
    seed()
    const { status, json } = await req('POST', '/reset-data', { mode: 'products', includeMovements: true, includeSales: true })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))

    for (const table of PRODUCTS_RESET_TABLES) assert.strictEqual(count(table), 0, `${table} should be empty`)
    assert.strictEqual(count('inventory_movements'), 0)
    assert.strictEqual(count('sales'), 0)
    assert.strictEqual(count('returns'), 0)
    assert.strictEqual(count('customers'), 1, 'customers must never be touched by mode=products, even with both toggles on')
    assert.strictEqual(count('suppliers'), 1, 'suppliers must never be touched by mode=products, even with both toggles on')
  })

  await check('includeMovements/includeSales are ignored outside mode=products (mode=sales/all keep their own existing behavior)', async () => {
    seed()
    // mode='sales' already deletes movements/sales itself by its own
    // existing logic -- this just confirms passing the products-only
    // toggle fields alongside a different mode doesn't error or change
    // anything about that mode's own contract.
    const { status, json } = await req('POST', '/reset-data', { mode: 'sales', includeMovements: true, includeSales: true })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))
    assert.strictEqual(count('products'), 1, 'mode=sales must never delete products, regardless of stray products-only fields')
    assert.strictEqual(count('customers'), 1, 'mode=sales must never touch customers')
  })

  await check('mode=sales now also forces a backup first (Part 248 fix -- previously only mode=products had this gate) and aborts with zero rows changed if it fails', async () => {
    seed()
    backupShouldFail = true
    const { status, json } = await req('POST', '/reset-data', { mode: 'sales' })
    assert.strictEqual(status, 500, JSON.stringify(json))
    assert.strictEqual(json.success, false, JSON.stringify(json))
    assert.ok(/backup/i.test(json.error || ''), `error message should mention the backup failure, got: ${json.error}`)
    assert.strictEqual(count('sales'), 1, 'sales must be UNCHANGED when the pre-reset backup fails')
    assert.strictEqual(count('inventory_movements'), 1, 'inventory_movements must be UNCHANGED when the pre-reset backup fails')
  })

  await check('mode=all now also forces a backup first (Part 248 fix) and aborts with zero rows changed if it fails', async () => {
    seed()
    backupShouldFail = true
    const { status, json } = await req('POST', '/reset-data', { mode: 'all' })
    assert.strictEqual(status, 500, JSON.stringify(json))
    assert.strictEqual(json.success, false, JSON.stringify(json))
    assert.strictEqual(count('products'), 1, 'products must be UNCHANGED when the pre-reset backup fails')
    assert.strictEqual(count('customers'), 1, 'customers must be UNCHANGED when the pre-reset backup fails')
  })

  await check('mode=all deletes file_assets rows too (Part 248 fix -- previously left dangling rows pointing at R2 objects the uploads/ wipe below had already deleted)', async () => {
    seed()
    assert.strictEqual(count('file_assets'), 1, 'sanity: file_assets should be seeded before the reset')

    const { status, json } = await req('POST', '/reset-data', { mode: 'all' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))
    assert.strictEqual(count('file_assets'), 0, 'file_assets should be empty after mode=all, matching the R2 uploads/ wipe it runs alongside')
  })

  // -------------------------------------------------------------------------
  // Part 412 (K4 slice): the blanket-prefix R2 sweeps in mode='all' and
  // factory-reset are CAPPED and honest. Until then each was one uncapped
  // Promise.all over the full listing -- a subrequest burst that could kill
  // the request after the D1 wipe had already committed, while the response
  // implied every stored file was gone.
  // -------------------------------------------------------------------------

  await check('mode=all spends ONE shared delete budget across uploads/ then imports/, stops at the cap, and reports the remainder instead of claiming a full wipe', async () => {
    seed()
    listedObjectsByPrefix = {
      'uploads/': Array.from({ length: MAX_IMAGE_DELETES_PER_RESET - 1 }, (_, i) => `uploads/f-${i}.jpg`),
      'imports/': ['imports/i-0.csv', 'imports/i-1.csv', 'imports/i-2.csv'],
    }

    const { status, json } = await req('POST', '/reset-data', { mode: 'all' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, 'hitting the sweep cap must never fail the reset itself')
    assert.strictEqual(count('products'), 0, 'the D1 wipe must have run')

    assert.strictEqual(deletedObjectKeys.length, MAX_IMAGE_DELETES_PER_RESET, `exactly the capped number of deletes must be issued, got ${deletedObjectKeys.length}`)
    assert.strictEqual(deletedObjectKeys[deletedObjectKeys.length - 1], 'imports/i-0.csv', 'the budget left over from uploads/ (1) must carry into imports/ -- one shared budget, not one per prefix')
    assert.strictEqual(json.r2FilesDeleted, MAX_IMAGE_DELETES_PER_RESET, JSON.stringify(json))
    assert.strictEqual(json.r2FilesLeftOverCap, 2, `the two imports/ objects the budget could not cover must be reported, got: ${JSON.stringify(json)}`)
    assert.ok(/left in storage/.test(json.message), `the response message must state the remainder, got: ${json.message}`)
  })

  await check('mode=all under the cap sweeps both prefixes completely and reports no leftover', async () => {
    seed()
    listedObjectsByPrefix = {
      'uploads/': ['uploads/a.jpg', 'uploads/b.jpg'],
      'imports/': ['imports/c.csv'],
    }

    const { status, json } = await req('POST', '/reset-data', { mode: 'all' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))
    assert.deepStrictEqual(deletedObjectKeys, ['uploads/a.jpg', 'uploads/b.jpg', 'imports/c.csv'], 'every listed object must be deleted when the cap is not hit')
    assert.strictEqual(json.r2FilesDeleted, 3, JSON.stringify(json))
    assert.strictEqual(json.r2FilesLeftOverCap, undefined, 'no leftover may be reported when everything was deleted')
    assert.ok(!/left in storage/.test(json.message), `no leftover note when nothing was left, got: ${json.message}`)
  })

  await check('mode=all: a failing R2 delete stays non-fatal for the reset but is reported, and the sweep continues past it', async () => {
    seed()
    listedObjectsByPrefix = { 'uploads/': ['uploads/ok-1.jpg', 'uploads/bad.jpg', 'uploads/ok-2.jpg'] }
    deleteShouldFailFor = new Set(['uploads/bad.jpg'])

    const { status, json } = await req('POST', '/reset-data', { mode: 'all' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, 'R2 cleanup failures must never fail the D1 reset that already committed')
    assert.deepStrictEqual(deletedObjectKeys, ['uploads/ok-1.jpg', 'uploads/ok-2.jpg'], 'the keys after the failing one must still be attempted')
    assert.strictEqual(json.r2FilesDeleted, 2, JSON.stringify(json))
    assert.ok(/failed to delete/.test(json.message), `the delete failure must surface in the message, got: ${json.message}`)
  })

  await check('mode=all: a failed uploads/ listing is reported (the old catch(_){} swallowed it silently) and imports/ is still swept', async () => {
    seed()
    listShouldFailFor = new Set(['uploads/'])
    listedObjectsByPrefix = { 'imports/': ['imports/a.csv'] }

    const { status, json } = await req('POST', '/reset-data', { mode: 'all' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, 'a listing failure stays non-fatal for the reset')
    assert.deepStrictEqual(deletedObjectKeys, ['imports/a.csv'], 'the healthy prefix must still be swept')
    assert.ok(/failed to delete/.test(json.message), `the cleanup shortfall must surface in the message, got: ${json.message}`)
  })

  await check('factory-reset caps its sweep with the same shared budget and only claims "All data and images wiped" when it is true', async () => {
    seed()
    listedObjectsByPrefix = {
      'uploads/': Array.from({ length: MAX_IMAGE_DELETES_PER_RESET + 3 }, (_, i) => `uploads/f-${i}.jpg`),
      'imports/': ['imports/i-0.csv'],
    }

    const { status, json } = await req('POST', '/factory-reset')
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))
    assert.strictEqual(json.admin?.username, 'admin', 'the reseed must still hand back the admin account')
    assert.strictEqual(count('products'), 0, 'the D1 wipe must have run')

    assert.strictEqual(deletedObjectKeys.length, MAX_IMAGE_DELETES_PER_RESET, `deletes must stop at the cap, got ${deletedObjectKeys.length}`)
    assert.strictEqual(json.r2FilesDeleted, MAX_IMAGE_DELETES_PER_RESET, JSON.stringify(json))
    assert.strictEqual(json.r2FilesLeftOverCap, 4, `3 uploads/ + 1 imports/ objects over budget must be reported, got: ${JSON.stringify(json)}`)
    assert.ok(!/All data and images wiped/.test(json.message), `the unconditional full-wipe claim must be gone when files remain, got: ${json.message}`)
    assert.ok(/left in storage/.test(json.message), `the message must state the remainder, got: ${json.message}`)
  })

  await check('factory-reset under the cap still reports the full "All data and images wiped" message', async () => {
    seed()
    listedObjectsByPrefix = { 'uploads/': ['uploads/only.jpg'] }

    const { status, json } = await req('POST', '/factory-reset')
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))
    assert.ok(/All data and images wiped/.test(json.message), `the honest full-wipe message must survive when it IS true, got: ${json.message}`)
    assert.strictEqual(json.r2FilesLeftOverCap, undefined, JSON.stringify(json))
  })

  await check('sweepPrefixCapped (direct): a failed listing fabricates no counts, and a zero budget deletes nothing while reporting the whole listing as leftover', async () => {
    seed()
    listShouldFailFor = new Set(['uploads/'])
    const failed = await sweepPrefixCapped(null, 'uploads/', 10)
    assert.deepStrictEqual(
      { deleted: failed.deleted, attempted: failed.attempted, leftover: failed.leftover, errorCount: failed.errors.length },
      { deleted: 0, attempted: 0, leftover: 0, errorCount: 1 },
      'a failed listing must report the error and nothing else -- the honest leftover count is unknown',
    )

    seed()
    listedObjectsByPrefix = { 'imports/': ['imports/a.csv', 'imports/b.csv'] }
    const exhausted = await sweepPrefixCapped(null, 'imports/', 0)
    assert.deepStrictEqual(
      { deleted: exhausted.deleted, attempted: exhausted.attempted, leftover: exhausted.leftover, errorCount: exhausted.errors.length },
      { deleted: 0, attempted: 0, leftover: 2, errorCount: 0 },
      'an exhausted budget must delete nothing and count the entire listing as leftover',
    )
    assert.strictEqual(deletedObjectKeys.length, 0, 'a zero budget must not delete anything')
  })

  console.log(`\n${passed} PASS, 0 FAIL`)
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
