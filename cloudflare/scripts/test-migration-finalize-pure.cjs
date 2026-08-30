// Regression test for POST /finalize-migration (routes/system.ts) -- the
// in-app version of the old-system import runbook's last hand-run steps
// (Downloads/businessos-migration-aug28/IMPORT-MANIFEST.md, Steps 4d + 4e),
// which used to be typed into `wrangler d1 execute` by hand.
//
// Same approach as test-reset-products-pure.cjs: transpile the REAL route
// file, run it against a real in-memory SQLite database with every real
// migration applied, and call the actual Hono app.request() the same way
// the real Worker would. Auth/audit/broadcast/cache/R2 are stubbed to
// permissive fakes; the backup prerequisite is stubbed but its call and
// scoped-table list are asserted; everything about WHICH rows get zeroed vs.
// kept is the real, shipped SQL.
//
// Run (from cloudflare/): node scripts/test-migration-finalize-pure.cjs

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

// backup_restore, not just backup (Part 513): destructive resets (incl.
// finalize-migration) now demand the restore/reset permission.
const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ backup: true, backup_restore: true }) }

let backupCallLog = []
let backupShouldFail = false
let sectionBackupTables = null

const permissions = loadReal('lib/permissions.ts')
const media = loadReal('lib/media.ts')

const systemRoute = loadReal('routes/system.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': permissions,
  '../lib/dataIntegrity': { runDataIntegrityCheck: async () => ({}) },
  '../lib/errorReporting': { reportError: async () => false },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/r2': {
    listObjects: async () => [],
    deleteObject: async () => {},
    // K4: the prefix-wide sweeps delete through the chunked bulk helper now.
    deleteObjectsBulk: async (_bucket, keys) => ({ deleted: keys.length, errors: [] }),
  },
  // K4: orphan-staging engine has its own pure test -- irrelevant here.
  '../lib/importRetention': { cleanOrphanImportStaging: async () => ({ applied: false, tables: {}, r2Keys: 0 }) },
  '../lib/coreDataInvariants': loadReal('lib/coreDataInvariants.ts', {
    './db': { getDb: () => db },
    './sqlBinding': loadReal('lib/sqlBinding.ts', {}),
  }),
  '../lib/backup': {
    createCloudflareBackup: async () => { backupCallLog.push('full'); if (backupShouldFail) throw new Error('simulated backup failure'); return { name: 'fake-backup' } },
    createSectionBackup: async (_env, tables) => {
      backupCallLog.push('section')
      sectionBackupTables = [...tables]
      if (backupShouldFail) throw new Error('simulated backup failure')
      return { name: 'fake-section-backup' }
    },
  },
  '../lib/media': media,
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
})

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

// batch_id 1 = a 'Received via product import' OPENING lot (must survive
// park_lots, since migration 0081 reconciles the ledger onto it).
// batch_id 2 = a 'Unified stock import' HISTORICAL lot (must be parked).
function seed() {
  const wipe = ['branch_batch_stock', 'product_batches', 'branch_stock', 'products', 'branches']
  exec(wipe.map((t) => `DELETE FROM "${t}";`).join(' '))

  rawDbHandle.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
  rawDbHandle.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Warehouse', 1, 0)").run()

  rawDbHandle.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (1, 'Lipstick', 1, 12)").run()
  rawDbHandle.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (2, 'Mascara', 1, 7)").run()
  // A product already at zero -- proves affected-count reports only rows it
  // actually changed (the `<> 0` guard), not a blanket row count.
  rawDbHandle.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (3, 'Empty SKU', 1, 0)").run()

  rawDbHandle.prepare('INSERT INTO branch_stock (id, product_id, branch_id, quantity) VALUES (1, 1, 1, 12)').run()
  rawDbHandle.prepare('INSERT INTO branch_stock (id, product_id, branch_id, quantity) VALUES (2, 2, 1, 7)').run()
  rawDbHandle.prepare('INSERT INTO branch_stock (id, product_id, branch_id, quantity) VALUES (3, 1, 2, 0)').run()

  rawDbHandle.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, notes, is_active) VALUES (1, 1, 'BK-OPEN', 'LOT-OPEN', 'Received via product import', 1)").run()
  rawDbHandle.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, notes, is_active) VALUES (2, 1, 'BK-HIST', 'LOT-HIST', 'Unified stock import job-42, row 7', 1)").run()

  rawDbHandle.prepare('INSERT INTO branch_batch_stock (id, batch_id, branch_id, quantity) VALUES (1, 1, 1, 5)').run()
  rawDbHandle.prepare('INSERT INTO branch_batch_stock (id, batch_id, branch_id, quantity) VALUES (2, 2, 1, 8)').run()

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
  await check('zero_stock zeros every branch_stock quantity and products.stock_quantity', async () => {
    seed()
    const { status, json } = await req('POST', '/finalize-migration', { step: 'zero_stock' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))

    assert.strictEqual(row('SELECT COUNT(*) AS n FROM branch_stock WHERE quantity <> 0').n, 0, 'no branch_stock row may remain non-zero')
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM products WHERE stock_quantity <> 0').n, 0, 'no product may remain non-zero')
  })

  await check('zero_stock reports affected counts of only the rows it actually changed', async () => {
    seed()
    const { json } = await req('POST', '/finalize-migration', { step: 'zero_stock' })
    // 2 branch_stock rows were non-zero (ids 1,2); id 3 was already 0.
    assert.strictEqual(json.affected.branch_stock, 2, JSON.stringify(json.affected))
    // 2 products were non-zero (ids 1,2); id 3 was already 0.
    assert.strictEqual(json.affected.products, 2, JSON.stringify(json.affected))
  })

  await check('zero_stock backs up EXACTLY branch_stock + products before writing', async () => {
    seed()
    await req('POST', '/finalize-migration', { step: 'zero_stock' })
    assert.deepStrictEqual(sectionBackupTables, ['branch_stock', 'products'], 'the scoped backup must cover exactly what it is about to zero')
    assert.strictEqual(backupCallLog.length, 1, 'exactly one section backup must be taken')
    assert.strictEqual(backupCallLog[0], 'section', 'must use the scoped section backup, never the full backup')
  })

  await check('zero_stock aborts with zero rows changed if the backup fails', async () => {
    seed()
    backupShouldFail = true
    const { status, json } = await req('POST', '/finalize-migration', { step: 'zero_stock' })
    assert.strictEqual(status, 500, JSON.stringify(json))
    assert.strictEqual(json.success, false, JSON.stringify(json))
    assert.ok(/backup/i.test(json.error || ''), `error should mention the backup, got: ${json.error}`)
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM branch_stock WHERE quantity <> 0').n, 2, 'branch_stock must be UNCHANGED when the pre-op backup fails')
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM products WHERE stock_quantity <> 0').n, 2, 'products must be UNCHANGED when the pre-op backup fails')
  })

  await check('zero_stock is idempotent -- a second run reports 0 affected', async () => {
    seed()
    await req('POST', '/finalize-migration', { step: 'zero_stock' })
    const { json } = await req('POST', '/finalize-migration', { step: 'zero_stock' })
    assert.strictEqual(json.success, true, JSON.stringify(json))
    assert.strictEqual(json.affected.branch_stock, 0, 'nothing left to zero on the second run')
    assert.strictEqual(json.affected.products, 0, 'nothing left to zero on the second run')
  })

  await check("park_lots zeros ONLY the 'Unified stock import' lots, leaving the opening import lots untouched", async () => {
    seed()
    const { status, json } = await req('POST', '/finalize-migration', { step: 'park_lots' })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(json.success, true, JSON.stringify(json))
    assert.strictEqual(json.affected.branch_batch_stock, 1, 'exactly one historical lot row should be parked')

    assert.strictEqual(row('SELECT quantity FROM branch_batch_stock WHERE id = 1').quantity, 5, "the 'Received via product import' opening lot must be UNTOUCHED (0081 reconciles onto it)")
    assert.strictEqual(row('SELECT quantity FROM branch_batch_stock WHERE id = 2').quantity, 0, "the 'Unified stock import' historical lot must be parked to 0")
  })

  await check('park_lots backs up exactly branch_batch_stock, and is idempotent', async () => {
    seed()
    await req('POST', '/finalize-migration', { step: 'park_lots' })
    assert.deepStrictEqual(sectionBackupTables, ['branch_batch_stock'], 'park_lots scopes its backup to just the lot-stock table')
    const { json } = await req('POST', '/finalize-migration', { step: 'park_lots' })
    assert.strictEqual(json.affected.branch_batch_stock, 0, 'nothing left to park on the second run')
  })

  await check('an unknown step is rejected with 400 and changes nothing', async () => {
    seed()
    const { status, json } = await req('POST', '/finalize-migration', { step: 'nuke_everything' })
    assert.strictEqual(status, 400, JSON.stringify(json))
    assert.ok(/unknown step/i.test(json.error || ''), `error should name the bad step, got: ${json.error}`)
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM branch_stock WHERE quantity <> 0').n, 2, 'a rejected step must not touch data')
    assert.strictEqual(backupCallLog.length, 0, 'a rejected step must not even take a backup')
  })

  console.log(`\n${passed} checks passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
