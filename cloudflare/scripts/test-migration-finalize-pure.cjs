const { withProductStockGuard } = require('./harness/product_stock_guard.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
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
  // The route imports the current-password guard lazily, at request time, after the patch above is gone.
  const requireWithOverrides = (request) => (request in requireOverrides ? requireOverrides[request] : require(request))
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, withProductStockGuard(requireWithOverrides), moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

// backup_restore, not just backup (Part 513): destructive resets (incl.
// finalize-migration) now demand the restore/reset permission.
const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ backup: true, backup_restore: true }) }

const OWNER_PASSWORD = 'owner-current-password'
let passwordChecks = []

let backupCallLog = []
let backupShouldFail = false
let sectionBackupTables = null
let sideEffects = []

const permissions = loadReal('lib/permissions.ts')
const media = loadReal('lib/media.ts')

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const { withStepUp } = require('./harness/step_up_lib.cjs')
const systemRoute = withStepUp(loadReal, 'routes/system.ts', {
  // planTier.ts is pure (only `import type`) and holds the free-vs-paid
  // image-delete cap the reset path now reads -- real, not an inert stub,
  // which would make that cap undefined and slice(0, undefined) empty.
  '../lib/planTier': loadReal('lib/planTier.ts'),
  // routes/system.ts imports the pure variant-key helper for the products-reset image sweep (line ~392);
  // this suite does not assert on variant keys, so an empty-key stub is enough (the real helper is covered by test-image-variant-store-pure).
  '../lib/imageVariantStore': { variantKeysForUploadKeys: () => [] },
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async (_env, _id, _name, action, entity, route, details) => { sideEffects.push({ action, entity, route, reason: details?.reason }) } },
  '../lib/currentPasswordGuard': {
    CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'Too many wrong current-password attempts. Please try again later.',
    verifyCurrentPassword: async (_c, _who, plain, hash) => {
      passwordChecks.push(plain)
      return hash === `hash:${plain}` ? { ok: true } : { ok: false, rateLimited: false }
    },
  },
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
    './customTableName': loadReal('lib/customTableName.ts'),
    './db': { getDb: () => db },
    './sqlBinding': loadReal('lib/sqlBinding.ts', {}),
    './passwordHash': loadReal('lib/passwordHash.ts'),
    './passwordPolicy': loadReal('lib/passwordPolicy.ts'),
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
  '../durable-objects/broadcastHub': { broadcast: async () => { sideEffects.push('broadcast') } },
  '../lib/cache': { bumpVersion: async () => { sideEffects.push('cache') } },
})

const app = systemRoute.default
const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function req(method, url, body) {
  if (url === '/finalize-migration' && body && (body.step === 'zero_stock' || body.step === 'park_lots')) body = { currentPassword: OWNER_PASSWORD, ...body }
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
function seed(empty = false) {
  seedStockFixture(rawDbHandle.db, () => {
  exec(`INSERT OR IGNORE INTO roles(id,name,code,is_system,permissions) VALUES(901,'Default admin','admin',1,'{"all":true}'); INSERT OR REPLACE INTO users(id,username,name,password,role_id,is_active) VALUES(1,'tester','Tester','hash:${OWNER_PASSWORD}',901,1)`)
  passwordChecks = []
  exec('DELETE FROM damaged_stock_lots; DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; UPDATE products SET stock_quantity=0; DELETE FROM products; DELETE FROM branches;')

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
  sideEffects = []
  if (empty) exec('DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; UPDATE products SET stock_quantity=0; DELETE FROM products; DELETE FROM branches;')
  })
  assert.throws(() => rawDbHandle.db.prepare("INSERT INTO products(name) VALUES('unadmitted')").run(), /stock_transaction_required/)
  assert.strictEqual(row("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").n, 0)
}
function snapshot() {
  return JSON.stringify(rawDbHandle.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, rawDbHandle.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()]))
}
function noEffects(before, refusalCodes = []) {
  assert.strictEqual(snapshot(), before, 'all application rows, including physical stock and history, are unchanged')
  assert.deepStrictEqual(backupCallLog, [])
  assert.strictEqual(sectionBackupTables, null)
  assert.deepStrictEqual(sideEffects, refusalCodes.map(reason => ({ action: 'step_up_refused', entity: 'system', route: '/finalize-migration', reason })))
  assert.strictEqual(row("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").n, 0)
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  for (const step of ['zero_stock', 'park_lots']) for (const empty of [false, true]) {
    await check(`${step} is unavailable before backup or writes in a ${empty ? 'stock-empty' : 'populated guarded'} world`, async () => {
      seed(empty)
      backupShouldFail = true
      const before = snapshot()
      for (let attempt = 0; attempt < 2; attempt++) {
        const { status, json } = await req('POST', '/finalize-migration', { step })
        assert.strictEqual(status, 409, JSON.stringify(json))
        assert.strictEqual(json.success, false)
        assert.strictEqual(json.code, 'migration_stock_finalize_unavailable')
        assert.match(json.error, /No data was changed/)
        noEffects(before)
      }
      assert.deepStrictEqual(passwordChecks, [OWNER_PASSWORD, OWNER_PASSWORD], 'the existing password gate still runs')
    })
  }
  for (const step of ['zero_stock', 'park_lots']) {
    await check(`${step} still refuses an actor without restore permission before step-up`, async () => {
      seed()
      const original = FAKE_USER.permissions
      const before = snapshot()
      FAKE_USER.permissions = '{}'
      try {
        assert.strictEqual((await req('POST', '/finalize-migration', { step })).status, 403)
        assert.deepStrictEqual(passwordChecks, [])
        noEffects(before)
      } finally { FAKE_USER.permissions = original }
    })
  }

  for (const step of ['zero_stock', 'park_lots']) {
    await check(`${step} refuses a missing or wrong current password before any backup or write`, async () => {
      seed()
      const before = snapshot()
      const refusalCodes = []
      for (const [label, extra, code] of [['missing', { currentPassword: undefined }, 'current_password_required'], ['empty', { currentPassword: '' }, 'current_password_required'], ['not text', { currentPassword: 12345 }, 'current_password_required'], ['wrong', { currentPassword: 'not-the-password' }, 'incorrect_password']]) {
        const { status, json } = await req('POST', '/finalize-migration', { step, ...extra })
        assert.strictEqual(status, 403, `${label}: ${JSON.stringify(json)}`)
        assert.strictEqual(json.code, code, label)
        assert.strictEqual(json.success, false, label)
        refusalCodes.push(code)
        noEffects(before, refusalCodes)
      }
      assert.strictEqual(backupCallLog.length, 0, 'a refused step-up must not even take a backup')
      assert.strictEqual(row('SELECT COUNT(*) AS n FROM branch_stock WHERE quantity <> 0').n, 2, 'branch stock must be untouched')
      assert.strictEqual(row('SELECT COUNT(*) AS n FROM products WHERE stock_quantity <> 0').n, 2, 'product stock must be untouched')
      assert.strictEqual(row('SELECT quantity FROM branch_batch_stock WHERE id = 2').quantity, 8, 'the historical lot must be untouched')
      assert.deepStrictEqual(passwordChecks, ['not-the-password'], 'only a non-empty text password reaches the verifier')
    })
  }

  await check('an unknown step is rejected with 400 and changes nothing', async () => {
    seed()
    const before = snapshot()
    const { status, json } = await req('POST', '/finalize-migration', { step: 'nuke_everything' })
    assert.strictEqual(status, 400, JSON.stringify(json))
    noEffects(before)
    assert.ok(/unknown step/i.test(json.error || ''), `error should name the bad step, got: ${json.error}`)
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM branch_stock WHERE quantity <> 0').n, 2, 'a rejected step must not touch data')
    assert.strictEqual(backupCallLog.length, 0, 'a rejected step must not even take a backup')
  })

  console.log(`\n${passed} checks passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
