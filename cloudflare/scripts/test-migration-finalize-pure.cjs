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
const { loadStockLifecycleFixture, nativeStockFixtureBinding } = require('./harness/load_stock_lifecycle_fixture.cjs')

const rawDbHandle = openDb(loadAll())
const db = rawDbHandle
const fakeEnv = { DB: nativeStockFixtureBinding(rawDbHandle.db, items => rawDbHandle.batch(items)), ASSETS: null, CACHE: { get: async () => null, put: async () => {} } }

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
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  ) } finally { Module._load = originalLoad }
  return moduleObj.exports
}

// backup_restore, not just backup (Part 513): destructive resets (incl.
// finalize-migration) now demand the restore/reset permission.
const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ backup: true, backup_restore: true }) }

let backupCallLog = []
let backupShouldFail = false
let sectionBackupTables = null
let backupBeforeReturn = null
let finalizationEffects = []

const permissions = loadReal('lib/permissions.ts')
const media = loadReal('lib/media.ts')

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const systemRoute = loadReal('routes/system.ts', {
  // planTier.ts is pure (only `import type`) and holds the free-vs-paid
  // image-delete cap the reset path now reads -- real, not an inert stub,
  // which would make that cap undefined and slice(0, undefined) empty.
  '../lib/planTier': loadReal('lib/planTier.ts'),
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/db': loadStockLifecycleFixture('lib/db.ts'),
  '../lib/stockLifecycle': loadStockLifecycleFixture(),
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => { finalizationEffects.push('audit') } },
  '../lib/permissions': permissions,
  '../lib/dataIntegrity': { runDataIntegrityCheck: async () => ({}) },
  '../lib/errorReporting': { reportError: async () => false },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/r2': {
    listObjects: async () => { finalizationEffects.push('r2-list'); return [] },
    deleteObject: async () => { finalizationEffects.push('r2-delete') },
    // K4: the prefix-wide sweeps delete through the chunked bulk helper now.
    deleteObjectsBulk: async (_bucket, keys) => { finalizationEffects.push('r2-delete-bulk'); return { deleted: keys.length, errors: [] } },
  },
  // K4: orphan-staging engine has its own pure test -- irrelevant here.
  '../lib/importRetention': { cleanOrphanImportStaging: async () => ({ applied: false, tables: {}, r2Keys: 0 }) },
  '../lib/coreDataInvariants': loadReal('lib/coreDataInvariants.ts', {
    './customTableName': loadReal('lib/customTableName.ts'),
    './db': loadStockLifecycleFixture('lib/db.ts'),
    './sqlBinding': loadReal('lib/sqlBinding.ts', {}),
  }),
  '../lib/backup': {
    createCloudflareBackup: async () => { backupCallLog.push('full'); if (backupShouldFail) throw new Error('simulated backup failure'); return { name: 'fake-backup' } },
    createSectionBackup: async (_env, tables) => {
      backupCallLog.push('section')
      sectionBackupTables = [...tables]
      if (backupShouldFail) throw new Error('simulated backup failure')
      if (backupBeforeReturn) await backupBeforeReturn()
      return { name: 'fake-section-backup' }
    },
  },
  '../lib/media': media,
  '../durable-objects/broadcastHub': { broadcast: async () => { finalizationEffects.push('broadcast') } },
  '../lib/cache': { bumpVersion: async () => { finalizationEffects.push('cache-version') } },
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

  await parkLotsBoundedQueries()
  await lifecycleFinalizeContract()
  console.log(`\n${passed} checks passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })

async function lifecycleFinalizeContract() {
  const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint'
    ? ['integer64', String(item)] : item instanceof Uint8Array ? ['blob', Buffer.from(item).toString('hex')] : item)
  for (const funding of [false, true]) for (const step of ['zero_stock', 'park_lots']) for (const late of [false, true]) {
    const handle = openDb(loadAll()), sql = handle.db, batchId = step === 'park_lots' ? 2 : 1
    sql.exec(`INSERT INTO users(id,username,name,password,permissions,is_active) SELECT 1,'fixture-actor','Fixture actor','admin123','{}',1 WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=1);
      INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Main',1,1);
      INSERT INTO suppliers(id,name) VALUES(31,'Linked supplier');
      INSERT INTO products(id,name,stock_quantity) VALUES(1,'Linked source',6);
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,notes,is_active,supplier_id,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd)
        VALUES(1,1,'OPEN','OPEN','Received via product import',1,31,'credit',3,3,1,1),(2,1,'HIST','HIST','Unified stock import fixture',1,31,'credit',3,3,1,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,3),(2,1,3);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,6);
      INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,unit_cost_usd,user_id) VALUES(701,1,1,${batchId},'add',3,0,3,1,1);`)
    const admit = () => {
      sql.exec(funding
        ? `INSERT INTO stock_funding_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,reconciliation_proof,actor_id,source_json) VALUES('linked',701,${batchId},1,1,31,'3','0',30000,0,30000,'Fixture proof',1,'{}');`
        : `INSERT INTO stock_disposition_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,funding_state) VALUES('linked',701,${batchId},1,1,31,'3','0',30000,0,30000,'reconciled_unpaid');`)
      assert.equal(Number(sql.prepare('SELECT batch_id FROM stock_lifecycle_dependencies WHERE movement_id=701').get().batch_id), batchId)
      assert.equal(sql.prepare('SELECT notes FROM product_batches WHERE id=?').get(batchId).notes.startsWith('Unified stock import'), step === 'park_lots')
    }
    const snapshot = () => encode(sql.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all().map(object => {
      if (object.type !== 'table') return [object, []]
      const statement = sql.prepare(`SELECT * FROM "${object.name.replaceAll('"', '""')}"`)
      statement.setReadBigInts(true)
      return [object, statement.all().map(encode).sort()]
    }))
    let before
    if (!late) { admit(); before = snapshot() }
    if (!late) {
      const lifecycle = loadStockLifecycleFixture()
      const guardDb = loadStockLifecycleFixture('lib/db.ts').getDb({ DB: nativeStockFixtureBinding(sql, items => handle.batch(items)) })
      const refuses = scope => assert.rejects(() => lifecycle.assertStockLifecycleMutable(guardDb, scope), error => error.code === 'stock_lifecycle_dependency')
      for (const ids of [[batchId], [999, batchId], [batchId, batchId]]) await refuses({ batchIds: ids })
      await refuses({ batchIds: [batchId], branchId: 1, productId: 1, movementId: 701, supplierIds: [31] })
      for (const scope of [
        { batchIds: [] }, { batchIds: [], allSources: true }, { batchIds: [999] },
        { batchIds: [batchId], batchId: 999 }, { batchIds: [batchId], branchId: 999 },
        { batchIds: [batchId], productId: 999 }, { batchIds: [batchId], movementId: 999 },
        { batchIds: [batchId], supplierId: 999 }, { batchIds: [batchId], supplierIds: [999] },
      ]) await lifecycle.assertStockLifecycleMutable(guardDb, scope)
      assert.equal(snapshot(), before)
    }
    const writes = { run: 0, batch: 0 }, cache = new Map([['refusal-sentinel', 'retained']]), cacheWrites = [], requests = [], waits = []
    const binding = nativeStockFixtureBinding(sql, items => handle.batch(items)), prepare = binding.prepare.bind(binding), batch = binding.batch.bind(binding)
    binding.prepare = text => { const statement = prepare(text), bind = statement.bind.bind(statement); statement.bind = (...values) => { const bound = bind(...values), run = bound.run.bind(bound); bound.run = async () => { writes.run++; return run() }; return bound }; return statement }
    binding.batch = async items => { writes.batch++; return batch(items) }
    const env = { DB: binding, CACHE: { get: async key => cache.get(key) ?? null, put: async (key,value) => { cacheWrites.push(['put',key,value]); cache.set(key,value) }, delete: async key => { cacheWrites.push(['delete',key]); cache.delete(key) } },
      ASSETS: { get: async key => { requests.push(['get',key]); return null }, put: async key => { requests.push(['put',key]) }, delete: async key => { requests.push(['delete',key]) } } }
    backupCallLog = []; backupShouldFail = false; finalizationEffects = []
    backupBeforeReturn = late ? async () => { admit(); before = snapshot() } : null
    const response = await app.request('/finalize-migration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step }) }, env,
      { waitUntil: value => { waits.push(Promise.resolve(value)) }, passThroughOnException: () => {} })
    await Promise.all(waits)
    const result = await response.json()
    assert.equal(response.status, 409, JSON.stringify(result))
    assert.equal(result.code, 'stock_lifecycle_dependency')
    assert.equal(snapshot(), before)
    assert.deepEqual(backupCallLog, late ? ['section'] : [])
    assert.deepEqual(writes, late ? (step === 'zero_stock' ? { run: 0, batch: 1 } : { run: 1, batch: 0 }) : { run: 0, batch: 0 })
    assert.deepEqual(cacheWrites, [['put','ratelimit:finalize_migration:1','1']])
    assert.deepEqual([...cache].sort(), [['ratelimit:finalize_migration:1','1'],['refusal-sentinel','retained']])
    assert.deepEqual(requests, [])
    assert.deepEqual(finalizationEffects, [])
    backupBeforeReturn = null
    if (step === 'zero_stock' && !late) {
      const positive = await app.request('/finalize-migration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'park_lots' }) }, env,
        { waitUntil: value => { waits.push(Promise.resolve(value)) }, passThroughOnException: () => {} })
      await Promise.all(waits)
      assert.equal(positive.status, 200, await positive.text())
      assert.equal(Number(sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1').get().quantity), 3)
      assert.equal(Number(sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=2').get().quantity), 0)
    }
    sql.close()
  }
  const realDb = loadStockLifecycleFixture('lib/db.ts'), fence = loadStockLifecycleFixture('lib/importMaintenanceFence.ts')
  assert.strictEqual(realDb.getImportFencedDb, fence.getImportFencedDb)
  assert.strictEqual(realDb, loadStockLifecycleFixture('lib/db.ts'))
  assert.equal(loadStockLifecycleFixture().StockLifecycleError.prototype instanceof require('hono/http-exception').HTTPException, true)
  console.log('PASS actual finalize linked disposition/funding preflight before backup/writes and late trigger rollback; unrelated opening lots admitted; only existing admission KV write')
}

async function parkLotsBoundedQueries() {
  const counts = []
  for (const count of [1, 10, 100, 1000]) {
    seed()
    for (let i = 1; i < count; i++) {
      rawDbHandle.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,notes,is_active) VALUES(?,1,?,'Unified stock import bounded fixture',1)").run(1000 + i, `BOUNDED${i}`)
      rawDbHandle.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,1)').run(1000 + i)
    }
    let prepares = 0
    const env = { ...fakeEnv, DB: { ...fakeEnv.DB, prepare: text => { prepares++; return fakeEnv.DB.prepare(text) } } }
    const response = await app.request('/finalize-migration', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'park_lots' }),
    }, env, fakeExecutionCtx)
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(body.affected.branch_batch_stock, count)
    assert.equal(row('SELECT quantity FROM branch_batch_stock WHERE batch_id=1').quantity, 5)
    assert.ok(prepares <= 6, `park_lots used ${prepares} prepares for ${count} lots`)
    counts.push(prepares)
  }
  assert.ok(counts.every(count => count === counts[0]), JSON.stringify(counts))
  console.log(`PASS park_lots query count is constant for 1/10/100/1000 lots: ${counts.join('/')}`)
}
