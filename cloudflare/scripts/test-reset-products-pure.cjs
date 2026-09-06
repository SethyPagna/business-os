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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
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

// backup_restore, not just backup (Part 513): destructive resets now demand
// the restore/reset permission -- the export-grade 'backup' alone no longer
// clears the gate this test drives.
const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ backup: true, backup_restore: true }) }

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
const permissions = loadReal('lib/permissions.ts')
const media = loadReal('lib/media.ts')

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const systemRoute = loadReal('routes/system.ts', {
  '../lib/actorSnapshot': actorSnapshotKernel,
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
    listObjects: async () => [],
    deleteObject: async (_bucket, key) => { deletedObjectKeys.push(key) },
    // K4: the prefix-wide sweeps now delete through the chunked bulk
    // helper -- same recording, same "R2 is empty here" stance.
    deleteObjectsBulk: async (_bucket, keys) => { deletedObjectKeys.push(...keys); return { deleted: keys.length, errors: [] } },
  },
  // K4: the orphan-staging endpoint's engine lives in its own lib with its
  // own pure test -- stubbed here, this test is about the reset contract.
  '../lib/importRetention': { cleanOrphanImportStaging: async () => ({ applied: false, tables: {}, r2Keys: 0 }) },
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

const ALL_IMPORT_RESET_TABLES = [
  'import_auto_merges', 'import_sales_commits', 'import_stock_action_guards',
  'import_stock_action_commits', 'import_stock_action_groups',
  'import_job_image_renames', 'import_job_image_matches',
  'import_job_row_signatures', 'import_job_source_rows', 'import_job_errors',
  'import_job_batches', 'import_job_rows', 'import_job_files', 'import_jobs',
]

let backupCallLog = []
let backupShouldFail = false
let sectionBackupTables = null

const app = systemRoute.default
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
    'stock_session_members', 'stock_session_operations', 'stock_session_guards',
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
  rawDbHandle.prepare("INSERT INTO stock_session_operations (id, actor_id, request_id, mode, request_json) VALUES ('reset-fixture', 1, 'reset-fixture', 'stock_in', '{}')").run()
  rawDbHandle.prepare("INSERT INTO stock_session_members (operation_id, line_id, command_kind, product_id, product_created, branch_id, batch_id, movement_id, quantity, unit_cost_usd) VALUES ('reset-fixture', 'line-1', 'receive', 1, 0, 1, 1, 1, 10, 2)").run()
  rawDbHandle.prepare('INSERT INTO stock_session_guards (id, guard_value) VALUES (1, 1)').run()

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
    assert.ok(count('stock_session_revisions') > 0, 'reset retains ABA revision tombstones')
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

  await check('mode=all clears every current import job ledger so a migration rerun starts clean', async () => {
    seed()
    rawDbHandle.prepare("INSERT INTO import_jobs (id, type) VALUES ('reset-job', 'products')").run()
    rawDbHandle.prepare("INSERT INTO import_job_batches (job_id, batch_index) VALUES ('reset-job', 0)").run()
    rawDbHandle.prepare("INSERT INTO import_job_errors (job_id, message) VALUES ('reset-job', 'old error')").run()
    rawDbHandle.prepare("INSERT INTO import_job_files (job_id, kind, stored_path) VALUES ('reset-job', 'csv', 'imports/old.csv')").run()
    rawDbHandle.prepare("INSERT INTO import_job_rows (job_id, phase, row_number, action, result_json) VALUES ('reset-job', 'analyze', 2, 'create', '{}')").run()
    rawDbHandle.prepare("INSERT INTO import_job_source_rows (job_id, sequence, row_number, data_json) VALUES ('reset-job', 0, 2, '{}')").run()
    rawDbHandle.prepare("INSERT INTO import_job_row_signatures (job_id, signature, row_number) VALUES ('reset-job', 'sig', 2)").run()
    rawDbHandle.prepare("INSERT INTO import_job_image_matches (job_id, row_number, image_path) VALUES ('reset-job', 2, '/uploads/old.jpg')").run()
    rawDbHandle.prepare("INSERT INTO import_job_image_renames (job_id, file_id, new_name) VALUES ('reset-job', 'file-1', 'old.jpg')").run()
    rawDbHandle.prepare("INSERT INTO import_stock_action_commits (job_id, action_key, action_kind) VALUES ('reset-job', 'action-1', 'add')").run()
    rawDbHandle.prepare("INSERT INTO import_stock_action_guards (job_id, action_key, guard_key, guard_value) VALUES ('reset-job', 'action-1', 'guard-1', 1)").run()
    rawDbHandle.prepare("INSERT INTO import_stock_action_groups (job_id, group_key, group_index) VALUES ('reset-job', 'group-1', 0)").run()
    rawDbHandle.prepare("INSERT INTO import_sales_commits (job_id, group_key, row_number) VALUES ('reset-job', 'sale-1', 2)").run()
    rawDbHandle.prepare("INSERT INTO import_auto_merges (product_id, row_number, losing_json) VALUES (1, 2, '{}')").run()
    for (const table of ALL_IMPORT_RESET_TABLES) assert.ok(count(table) > 0, `sanity: ${table} should be seeded before the reset`)

    const { status, json } = await req('POST', '/reset-data', { mode: 'all' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))
    for (const table of ALL_IMPORT_RESET_TABLES) assert.strictEqual(count(table), 0, `${table} should be empty after mode=all`)
  })

  console.log(`\n${passed} PASS, 0 FAIL`)
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
