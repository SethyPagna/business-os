// Regression test for step (2) of the "Permissions UI redesign" item
// (progress.md): lib/reviewGate.ts's maybeQueueForReview actually queueing
// a write instead of applying it when the acting user's tier for a
// REVIEW_TIER_KEYS section is 'review', and lib/reviewApply.ts +
// routes/reviewQueue.ts's POST /:id/approve actually replaying that write
// once approved -- exercised end-to-end through the real
// routes/fees.ts DELETE /:id (the one write route currently wired) and
// routes/reviewQueue.ts, against a real in-memory SQLite database with
// the real migrations applied. Same transpile-the-real-source-and-run-it
// approach as test-returns-batch-restock-pure.cjs; only auth/audit/
// broadcast/conflict-control are stubbed to permissive no-ops.
//
// Run (from cloudflare/): node scripts/test-review-gate-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())

// lib/productWrites.ts (part 152) calls `env.DB.prepare(sql).all()`
// directly, bypassing getDb() -- correct against the real Cloudflare
// D1Database, whose raw PreparedStatement.all() returns
// `{ results, success, meta }`. This harness's own d1compat.cjs `.all()`
// deliberately returns a plain array instead (every other module in this
// codebase reaches it through getDb()'s own D1CompatStatement, which does
// that unwrapping itself) -- so `fakeEnv.DB` needs a thin adapter that
// re-wraps `.all()`'s return into the real shape for this one direct
// caller, without changing the shared rawDb any other stub in this file
// still uses unwrapped (the top-of-file `db` object below intentionally
// calls `rawDb.prepare(sql).all(params)` and expects a plain array).
function wrapAsRawD1(underlying) {
  return {
    prepare(sql) {
      const stmt = underlying.prepare(sql)
      const wrapper = {
        // Real D1's .bind(...values) is a rest-args call; d1compat.cjs's
        // own Stmt.bind(params) takes ONE argument but already knows how
        // to treat an array as positional params (see its own _args()) --
        // so pass the whole args array through as that one argument,
        // don't spread it (spreading would silently drop every value
        // after the first).
        bind(...args) { stmt.bind(args); return wrapper },
        async all(...args) { return { results: stmt.all(...args) } },
        async get(...args) { return stmt.get(...args) },
        async run(...args) { return stmt.run(...args) },
      }
      return wrapper
    },
    batch: (items) => underlying.batch(items),
    exec: (sql) => underlying.exec(sql),
  }
}
const fakeEnv = { DB: wrapAsRawD1(rawDb) }

// d1compat.cjs's `run()` mimics the RAW D1Database result shape (`{success,
// meta: {last_row_id, changes}}`) -- correct for a module handed a raw
// D1Database directly, but every module this test loads (pendingActions.ts,
// reviewApply.ts, routes/fees.ts, routes/reviewQueue.ts) imports `getDb`
// from `./db`/`../lib/db` (lib/db.ts), whose real D1Compat.run() already
// flattens that into `{changes, lastInsertRowid}` at the top level. Handing
// those modules the raw harness db directly (as an earlier version of this
// file did) skips that flattening, so e.g. pendingActions.ts's
// `result.changes > 0` silently reads `undefined` and always evaluates
// false -- caught by this file's own "approving a queued delete actually
// deletes the fee" check (markPendingActionApproved kept returning false
// even though the underlying UPDATE really did match and change the row).
// Same fix, same reasoning as test-pending-actions-pure.cjs's own
// `dbForPendingActions` wrapper -- applied here as the shared `db` every
// stub below points at, since this file (unlike that one) loads several
// modules that all need the identical flattening.
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: (params) => stmt.get(params),
      all: (params) => stmt.all(params) ?? [],
      run: (params) => {
        const r = stmt.run(params)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  async batch(items) {
    const results = []
    for (const item of items) {
      const stmt = rawDb.prepare(item.sql)
      const r = stmt.run(item.params || {})
      results.push({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) })
    }
    return results
  },
  exec(sql) {
    rawDb.exec(sql)
  },
}

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
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

// toDbBool is real, tiny, and pure (no DB access) -- transpiled and loaded
// directly here rather than re-typed by hand a third time, so this stub
// can't silently drift from lib/db.ts's real implementation the way the
// old routes/branches.ts-local copy drifted from lib/reviewApply.ts's own
// naive `value ? 1 : 0` before this session's fix.
const { toDbBool } = loadReal('lib/db.ts')
const dbStub = { './db': { getDb: () => db, toDbBool }, '../lib/db': { getDb: () => db, toDbBool } }
const auditStub = { './audit': { audit: async () => {} }, '../lib/audit': { audit: async () => {} } }
const broadcastStub = {
  './broadcastHub': { broadcast: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
}

// Real, pure -- loaded first since everything else depends on it.
const permissions = loadReal('lib/permissions.ts')
const pendingActions = loadReal('lib/pendingActions.ts', { ...dbStub, '../index': {} })
const reviewGate = loadReal('lib/reviewGate.ts', {
  './permissions': permissions,
  './pendingActions': pendingActions,
  '../index': {},
})
// batchCode.ts is pure (no D1/Env dependency) -- productWrites.ts's
// seedInitialBatchForNewProduct now derives lot_code through it
// (dateToBatchCode), so it needs to be the real transpiled module, not
// left to fall through to node's own require() (which can't resolve a
// bare .ts file).
const batchCode = loadReal('lib/batchCode.ts')
// businessDateWindow.ts is pure (no D1/Env dependency) -- routes/fees.ts now
// derives its default fee_date through it (businessToday), so it needs to be
// the real transpiled module, same treatment as batchCode.ts/searchMatch.ts
// below, not left to fall through to node's own require() (which resolves
// relative imports against this script's own directory, not the real
// src/routes/ location, and can't resolve a bare .ts file either way).
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
// searchMatch.ts is pure (no D1/Env dependency) -- productWrites.ts's
// insertRow/updateRow now derive name_normalized/unit_normalized/
// brand_compact through it (migrations/0037_product_search_compact_
// columns.sql), so it needs to be the real transpiled module, same
// treatment as batchCode.ts above, not left to fall through to node's
// own require() (which can't resolve a bare .ts file).
const searchMatch = loadReal('lib/searchMatch.ts')
const branchWrites = loadReal('lib/branchWrites.ts', { './db': { toDbBool } })
const productWrites = loadReal('lib/productWrites.ts', {
  ...dbStub,
  './media': { sanitizeMediaList: (list) => (Array.isArray(list) ? list : []) },
  './batchCode': batchCode,
  './searchMatch': searchMatch,
  // importImageMatch.ts is pure (no D1/Env dependency) -- productWrites.ts's
  // syncProductImageGallery now derives its slice cap through it
  // (MAX_IMAGES_PER_PRODUCT), same treatment as batchCode.ts/searchMatch.ts
  // above, not left to fall through to node's own require() (which can't
  // resolve a bare .ts file).
  './importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3 },
  '../index': {},
})
const reviewApply = loadReal('lib/reviewApply.ts', {
  ...dbStub,
  ...auditStub,
  ...broadcastStub,
  './pendingActions': pendingActions,
  './productWrites': productWrites,
  './branchWrites': branchWrites,
  './cache': { bumpVersion: async () => {} },
  '../index': {},
})

const feesRoute = loadReal('routes/fees.ts', {
  ...dbStub,
  ...auditStub,
  ...broadcastStub,
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', CURRENT_USER); return next() } },
  '../lib/permissions': permissions,
  '../lib/reviewGate': reviewGate,
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/telegram': { sendTelegramEvent: async () => false },
  '../lib/conflictControl': {
    assertUpdatedAtMatch: () => {},
    getExpectedUpdatedAt: () => undefined,
    writeConflictResponse: (err) => ({ body: { error: String(err) }, status: 409 }),
    WriteConflictError: class WriteConflictError extends Error {},
  },
})

const reviewQueueRoute = loadReal('routes/reviewQueue.ts', {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', CURRENT_USER); return next() } },
  '../lib/permissions': permissions,
  ...auditStub,
  ...broadcastStub,
  '../lib/pendingActions': pendingActions,
  '../lib/reviewApply': reviewApply,
})

const feesApp = feesRoute.default
const reviewApp = reviewQueueRoute.default

// Same reasoning as test-returns-batch-restock-pure.cjs's own comment:
// routes/fees.ts and routes/reviewQueue.ts both fire c.executionCtx-free
// side effects here (stubbed audit/broadcast take no real ExecutionContext),
// but Hono's own Context still requires SOMETHING to answer
// c.executionCtx if any code path reads it -- neither route does here, so
// no fake is strictly required, but passing one costs nothing and guards
// against a future edit that adds a waitUntil call the way returns.ts has.
const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

let CURRENT_USER = null
const FULL_USER = { id: 1, username: 'full', name: 'Full Access', permissions: JSON.stringify({ fees: true, review: true }) }
const REVIEW_TIER_USER = { id: 2, username: 'reviewtier', name: 'Review Tier', permissions: JSON.stringify({ fees: 'review' }) }
const REVIEWER_USER = { id: 3, username: 'reviewer', name: 'Reviewer', permissions: JSON.stringify({ review: true }) }

async function req(app, user, method, url, body) {
  CURRENT_USER = user
  const res = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function seedFee() {
  db.exec('DELETE FROM fees; DELETE FROM pending_actions;')
  const result = db.prepare(`
    INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date)
    VALUES ('other', 'Test fee', 5, 20000, '2026-08-18')
  `).run()
  return result.lastInsertRowid
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('a Full Access user deletes a fee directly, no pending row created', async () => {
    const feeId = seedFee()
    const { status, json } = await req(feesApp, FULL_USER, 'DELETE', `/${feeId}`)
    assert.strictEqual(status, 200, JSON.stringify(json))
    const stillExists = await db.prepare('SELECT id FROM fees WHERE id = @id').get({ id: feeId })
    assert.strictEqual(stillExists, undefined, 'fee should be gone -- Full Access deletes directly')
    const pendingCount = db.prepare('SELECT COUNT(*) AS n FROM pending_actions').get().n
    assert.strictEqual(pendingCount, 0, 'no pending row should exist for a Full Access delete')
  })

  await check('a Review Required user\'s delete is queued, NOT applied, and returns 202', async () => {
    const feeId = seedFee()
    const { status, json } = await req(feesApp, REVIEW_TIER_USER, 'DELETE', `/${feeId}`)
    assert.strictEqual(status, 202, JSON.stringify(json))
    assert.strictEqual(json.pending, true)
    assert.ok(Number.isFinite(json.pendingActionId), 'response should include the new pending_actions id')

    const stillExists = await db.prepare('SELECT id FROM fees WHERE id = @id').get({ id: feeId })
    assert.ok(stillExists, 'fee must NOT be deleted yet -- only queued')

    const pendingRow = await db.prepare('SELECT * FROM pending_actions WHERE id = @id').get({ id: json.pendingActionId })
    assert.strictEqual(pendingRow.section, 'fees')
    assert.strictEqual(pendingRow.action_type, 'delete')
    assert.strictEqual(pendingRow.entity_type, 'fee')
    assert.strictEqual(pendingRow.entity_id, feeId)
    assert.strictEqual(pendingRow.status, 'open')
    assert.strictEqual(pendingRow.requested_by, REVIEW_TIER_USER.id)
  })

  await check('approving a queued delete actually deletes the fee and marks the row approved', async () => {
    const feeId = seedFee()
    const queued = await req(feesApp, REVIEW_TIER_USER, 'DELETE', `/${feeId}`)
    const pendingId = queued.json.pendingActionId

    const { status, json } = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/approve`)
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.data.status, 'approved')
    assert.strictEqual(json.data.reviewed_by, REVIEWER_USER.id)

    const feeGone = await db.prepare('SELECT id FROM fees WHERE id = @id').get({ id: feeId })
    assert.strictEqual(feeGone, undefined, 'approval should have actually deleted the fee, not just changed the queue row')
  })

  await check('rejecting a queued delete leaves the fee untouched', async () => {
    const feeId = seedFee()
    const queued = await req(feesApp, REVIEW_TIER_USER, 'DELETE', `/${feeId}`)
    const pendingId = queued.json.pendingActionId

    const { status, json } = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/reject`, { reason: 'Not needed' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.data.status, 'rejected')
    assert.strictEqual(json.data.reject_reason, 'Not needed')

    const feeStillThere = await db.prepare('SELECT id FROM fees WHERE id = @id').get({ id: feeId })
    assert.ok(feeStillThere, 'a rejected pending delete must never have touched the real row')
  })

  await check('approving an already-approved row is rejected with 409, not double-applied', async () => {
    const feeId = seedFee()
    const queued = await req(feesApp, REVIEW_TIER_USER, 'DELETE', `/${feeId}`)
    const pendingId = queued.json.pendingActionId
    const first = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/approve`)
    assert.strictEqual(first.status, 200)
    const second = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/approve`)
    assert.strictEqual(second.status, 409, JSON.stringify(second.json))
  })

  await check('a section/action with no registered applier fails loudly (501), row stays open', async () => {
    // Simulate a genuinely not-yet-wired section (e.g. inventory, still
    // open per progress.md's gate+applier wiring item) reaching the queue
    // by inserting a pending row directly, bypassing lib/reviewGate.ts --
    // this is exactly the state the queue would be in if a route started
    // calling maybeQueueForReview before reviewApply.ts had a matching
    // entry. products/delete/product used to be this test's example but
    // now has a real registered applier (see the next check), so this
    // uses 'inventory' instead -- still unregistered as of part 152.
    const insertResult = db.prepare(`
      INSERT INTO pending_actions (section, action_type, entity_type, entity_id, payload_json, status)
      VALUES ('inventory', 'delete', 'inventory_item', 999, '{}', 'open')
    `).run()
    const pendingId = insertResult.lastInsertRowid

    const { status, json } = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/approve`)
    assert.strictEqual(status, 501, JSON.stringify(json))
    assert.strictEqual(json.code, 'no_review_applier')

    const row = await db.prepare('SELECT status FROM pending_actions WHERE id = @id').get({ id: pendingId })
    assert.strictEqual(row.status, 'open', 'a failed apply must never mark the row approved')
  })

  await check('products/create/product applier: approving actually inserts the row, not just marks it approved', async () => {
    // part 152: products' create/update/delete appliers, exercised
    // directly against pending_actions (no routes/products.ts route in
    // this pure harness -- that route needs Hono/auth/rate-limiting this
    // file deliberately doesn't load, same reasoning productWrites.ts was
    // split out for) rather than through a real POST /api/products.
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, is_active INTEGER,
        created_at TEXT, updated_at TEXT
      )
    `)
    const insertResult = db.prepare(`
      INSERT INTO pending_actions (section, action_type, entity_type, entity_id, payload_json, status)
      VALUES ('products', 'create', 'product', NULL, '{"name":"Test Lipstick"}', 'open')
    `).run()
    const pendingId = insertResult.lastInsertRowid

    const { status, json } = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/approve`)
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.data.status, 'approved')

    const created = await db.prepare(`SELECT name, is_active FROM products WHERE name = 'Test Lipstick'`).get()
    assert.ok(created, 'approving a pending product create must actually insert the row')
    assert.strictEqual(created.is_active, 1)
  })

  await check('products/create/product applier: seeds branch_stock at every active branch (0 elsewhere, real qty at the chosen branch) and a default batch -- regression for the bug found this session (chat), where this applier hand-rolled a single-branch INSERT instead of reusing seedBranchStockForNewProduct/seedInitialBatchForNewProduct like routes/products.ts POST / does', async () => {
    // Two active branches, one inactive (should be skipped, same as the
    // direct-create path) -- reuses the real `branches` table from
    // migrations, not a stub, so this exercises seedBranchStockForNewProduct's
    // real `WHERE is_active = 1` query.
    const branchA = db.prepare(`INSERT INTO branches (name, is_active) VALUES ('Branch A', 1)`).run().lastInsertRowid
    const branchB = db.prepare(`INSERT INTO branches (name, is_active) VALUES ('Branch B', 1)`).run().lastInsertRowid
    db.prepare(`INSERT INTO branches (name, is_active) VALUES ('Closed Branch', 0)`).run()

    const insertResult = db.prepare(`
      INSERT INTO pending_actions (section, action_type, entity_type, entity_id, payload_json, status)
      VALUES ('products', 'create', 'product', NULL, @payload, 'open')
    `).run({ payload: JSON.stringify({ name: 'Test Blush', branch_id: branchA, stock_quantity: 12 }) })
    const pendingId = insertResult.lastInsertRowid

    const { status, json } = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/approve`)
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.data.status, 'approved')

    const product = await db.prepare(`SELECT id FROM products WHERE name = 'Test Blush'`).get()
    assert.ok(product, 'approving a pending product create must actually insert the row')

    const chosenStock = await db.prepare(`SELECT quantity FROM branch_stock WHERE product_id = @id AND branch_id = @branchId`).get({ id: product.id, branchId: branchA })
    assert.ok(chosenStock, 'the chosen branch must get an explicit branch_stock row, not just be implied by products.stock_quantity')
    assert.strictEqual(chosenStock.quantity, 12)

    const otherBranchStock = await db.prepare(`SELECT quantity FROM branch_stock WHERE product_id = @id AND branch_id = @branchId`).get({ id: product.id, branchId: branchB })
    assert.ok(otherBranchStock, 'every OTHER active branch must also get an explicit tracked-at-0 row -- a missing row reads as "not tracked here" (see seedBranchStockForNewProduct\'s own comment), not as zero, which is exactly the "only showed up at the one branch it was created against" bug this fix closes')
    assert.strictEqual(otherBranchStock.quantity, 0)

    const defaultBatch = await db.prepare(`SELECT id FROM product_batches WHERE variant_product_id = @id AND batch_key = @batchKey`).get({ id: product.id, batchKey: `initial:${product.id}` })
    assert.ok(defaultBatch, 'a review-approved product must get the same "day added" default batch a directly-created product gets')
  })

  await check('inventory/update/inventory_reason applier: approving actually writes the settings row, not just marks it approved', async () => {
    // part 152: the first inventory write wired into the review queue --
    // see routes/inventory.ts's own comment for why adjust/transfer/
    // move-row are deliberately NOT wired yet (live batch/stock state at
    // apply time). Exercised directly against pending_actions, same
    // reasoning as the products check above.
    const insertResult = db.prepare(`
      INSERT INTO pending_actions (section, action_type, entity_type, entity_id, payload_json, status)
      VALUES ('inventory', 'update', 'inventory_reason', NULL, '{"items":[{"id":"r1","label":"Damaged"}]}', 'open')
    `).run()
    const pendingId = insertResult.lastInsertRowid

    const { status, json } = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/approve`)
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.data.status, 'approved')

    const row = await db.prepare(`SELECT value FROM settings WHERE key = 'inventory_saved_reasons'`).get()
    assert.ok(row, 'approving a pending inventory_reason update must actually write the settings row')
    const items = JSON.parse(row.value)
    assert.strictEqual(items.length, 1)
    assert.strictEqual(items[0].label, 'Damaged')
  })

  await check('branches/create/branch applier: is_default/is_active use the same toDbBool coercion as the direct-write route -- regression for the bug found this session (chat), where a plain `value ? 1 : 0` disagreed with toDbBool on a string "false"/"0" payload', async () => {
    // A payload shape that only shows up from a direct API call or a form
    // that (unlike today's BranchForm.tsx, which only ever sends real 0/1)
    // serializes booleans as strings -- exactly the input toDbBool exists
    // to normalize, and the input plain JS truthiness gets backwards.
    const insertResult = db.prepare(`
      INSERT INTO pending_actions (section, action_type, entity_type, entity_id, payload_json, status)
      VALUES ('branches', 'create', 'branch', NULL, @payload, 'open')
    `).run({ payload: JSON.stringify({ name: 'Test Branch', is_default: 'false', is_active: 'false' }) })
    const pendingId = insertResult.lastInsertRowid

    const { status, json } = await req(reviewApp, REVIEWER_USER, 'POST', `/${pendingId}/approve`)
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.data.status, 'approved')

    const created = await db.prepare(`SELECT is_default, is_active FROM branches WHERE name = 'Test Branch'`).get()
    assert.ok(created, 'approving a pending branch create must actually insert the row')
    assert.strictEqual(created.is_default, 0, 'a string "false" payload must resolve to 0, not to JS\'s own truthiness (a non-empty string is always truthy)')
    assert.strictEqual(created.is_active, 0, 'same coercion for is_active')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
