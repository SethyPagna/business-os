// Focused regression for the allowlisted Sep 2-3 legacy subtotal repair.
// It exercises the real Hono route and runtime helper against the repository's
// full migration set in an in-memory SQLite database. No network or remote D1
// binding is available to this test.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const planner = require('../../ops/scripts/migration/repair-sep23-subtotals.cjs')

function transpileFile(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
}

// system.ts intentionally lazy-loads the one-off helper. Teach this isolated
// Node harness how to transpile that single .ts dependency when the repair
// branch is reached; production uses the normal Worker bundler.
const originalTsLoader = require.extensions['.ts']
require.extensions['.ts'] = (moduleObj, filename) => {
  moduleObj._compile(transpileFile(filename), filename)
}

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const outputText = transpileFile(sourcePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  const sourceRequire = Module.createRequire(sourcePath)
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, sourceRequire, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const rawDbHandle = openDb(loadAll())
const db = rawDbHandle
const nativeBatch = db.batch.bind(db)
const cache = new Map()
const fakeEnv = {
  DB: db,
  ASSETS: null,
  CACHE: {
    get: async (key) => cache.get(key) ?? null,
    put: async (key, value) => { cache.set(key, value) },
  },
}

const RESTORE_USER = {
  id: 71,
  username: 'repair-owner',
  name: 'Authenticated Repair Owner',
  permissions: JSON.stringify({ backup: true, backup_restore: true }),
}
const EXPORT_ONLY_USER = {
  id: 72,
  username: 'export-only',
  name: 'Export Only',
  permissions: JSON.stringify({ backup: true, backup_restore: false }),
}

let backupShouldFail = false
let injectLateBatchFailure = false
let backupTables = null
let backupCalls = 0
let batchCalls = 0
let eventLog = []

db.batch = async (statements) => {
  batchCalls += 1
  eventLog.push('batch')
  const submitted = injectLateBatchFailure
    ? [...statements, { sql: 'INSERT INTO sale_bulk_guards(guard_value) VALUES(0)', params: {} }]
    : statements
  return nativeBatch(submitted)
}

const permissions = loadReal('lib/permissions.ts')
const media = loadReal('lib/media.ts')
const systemRoute = loadReal('routes/system.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/auth': {
    requireAuth: async (c, next) => {
      const access = c.req.header('x-test-access')
      if (access === 'unauthenticated') return c.json({ error: 'Authentication required' }, 401)
      c.set('user', access === 'export-only' ? EXPORT_ONLY_USER : RESTORE_USER)
      return next()
    },
  },
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': permissions,
  '../lib/dataIntegrity': { runDataIntegrityCheck: async () => ({}) },
  '../lib/errorReporting': { reportError: async () => false },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/r2': { listObjects: async () => [], deleteObject: async () => {}, deleteObjectsBulk: async (_bucket, keys) => ({ deleted: keys.length, errors: [] }) },
  '../lib/importRetention': { cleanOrphanImportStaging: async () => ({ applied: false, tables: {}, r2Keys: 0 }) },
  '../lib/coreDataInvariants': loadReal('lib/coreDataInvariants.ts', {
    './db': { getDb: () => db },
    './sqlBinding': loadReal('lib/sqlBinding.ts', {}),
  }),
  '../lib/backup': {
    createCloudflareBackup: async () => ({ name: 'unused-full-backup' }),
    createSectionBackup: async (_env, tables) => {
      backupCalls += 1
      backupTables = [...tables]
      eventLog.push('backup')
      if (backupShouldFail) throw new Error('simulated backup failure')
      return { name: 'fresh-scoped-backup' }
    },
  },
  '../lib/media': media,
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
})

const legacyRepair = require('../src/lib/legacySubtotalRepair.ts')
const app = systemRoute.default
const fakeExecutionCtx = { waitUntil: (promise) => { promise?.catch?.(() => {}) }, passThroughOnException: () => {} }

function exec(sql) { rawDbHandle.exec(sql) }
function all(sql) { return rawDbHandle.prepare(sql).all() }
function row(sql) { return rawDbHandle.prepare(sql).get() }

function amountFor(id) {
  if (id === 16842) return '1454.0000'
  if (id <= 16858) return '1.0000'
  if (id === 16859) return '1988.0000'
  return '1.0000'
}

function discountFor(id) {
  if (id === 16842) return '61.0000'
  if (id === 16859) return '5.0000'
  return '0.0000'
}

function saleSnapshot(id) {
  const sep3 = id <= 16858
  const total = amountFor(id)
  return {
    id,
    receipt_number: `202609-${id}`,
    created_at: sep3 ? '2026-09-02 18:00:00' : '2026-09-01 18:00:00',
    updated_at: null,
    business_date: sep3 ? '2026-09-03' : '2026-09-02',
    notes: `legacy import ${id}`,
    sale_status: 'completed',
    expected_subtotal_usd: '0.0000',
    expected_subtotal_khr: '0.0000',
    target_subtotal_usd: total,
    total_usd: total,
    total_khr: '0.0000',
    amount_paid_usd: total,
    amount_paid_khr: '0.0000',
    discount_usd: '0.0000',
    discount_khr: '0.0000',
    tax_usd: '0.0000',
    tax_khr: '0.0000',
    delivery_fee_usd: '0.0000',
    delivery_fee_khr: '0.0000',
    exchange_rate: '4100.0000',
    stock_skipped: 0,
    payment_method: 'Cash',
    payment_details: null,
    expected_revision: null,
    item_count: 1,
    item_total_usd: total,
    item_total_khr: '0.0000',
    item_discount_usd: discountFor(id),
    item_discount_khr: '0.0000',
  }
}

function fixtureManifest() {
  return {
    schema_version: 1,
    plan_id: 'sep23-subtotal-runtime-fixture-20260905',
    generated_at_utc: '2026-09-05T04:00:00.000Z',
    operator_name: 'Manifest Generator',
    source_note: 'Fresh exact preflight fixture for the fixed 22-sale cohort.',
    sales: planner.EXPECTED_IDS.map(saleSnapshot),
  }
}

function requestFor(manifest = fixtureManifest()) {
  const canonical = planner.canonicalizeManifest(manifest)
  return {
    step: legacyRepair.LEGACY_SUBTOTAL_REPAIR_STEP,
    apply: true,
    confirmation: legacyRepair.LEGACY_SUBTOTAL_REPAIR_CONFIRMATION,
    manifest_sha256: planner.manifestDigest(canonical),
    manifest,
  }
}

async function request(body, access = 'restore') {
  const response = await app.request('/finalize-migration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-access': access },
    body: JSON.stringify(body),
  }, fakeEnv, fakeExecutionCtx)
  const json = await response.json().catch(() => null)
  return { status: response.status, json }
}

function resetHarness() {
  exec(`
    DELETE FROM sale_bulk_guards;
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM sale_write_revisions;
    DELETE FROM action_history;
    DELETE FROM audit_logs;
    DELETE FROM branch_stock;
    DELETE FROM branch_batch_stock;
    DELETE FROM system_flags WHERE key='maintenance';
  `)
  const insertSale = rawDbHandle.prepare(`
    INSERT INTO sales(
      id,receipt_number,payment_method,exchange_rate,subtotal_usd,subtotal_khr,
      discount_usd,discount_khr,tax_usd,tax_khr,total_usd,total_khr,
      amount_paid_usd,amount_paid_khr,delivery_fee_usd,delivery_fee_khr,
      sale_status,notes,created_at,updated_at,payment_details,stock_skipped
    ) VALUES(
      @id,@receipt_number,@payment_method,@exchange_rate,@subtotal_usd,@subtotal_khr,
      @discount_usd,@discount_khr,@tax_usd,@tax_khr,@total_usd,@total_khr,
      @amount_paid_usd,@amount_paid_khr,@delivery_fee_usd,@delivery_fee_khr,
      @sale_status,@notes,@created_at,@updated_at,@payment_details,@stock_skipped
    )
  `)
  const insertItem = rawDbHandle.prepare(`
    INSERT INTO sale_items(
      sale_id,product_name,quantity,applied_price_usd,total_usd,total_khr,
      product_discount_usd,product_discount_khr,manual_discount_usd,manual_discount_khr
    ) VALUES(@id,@product_name,1,@applied_price_usd,@total_usd,0,@discount_usd,0,0,0)
  `)
  for (const sale of fixtureManifest().sales) {
    insertSale.run({ ...sale, subtotal_usd: sale.expected_subtotal_usd })
    insertItem.run({ id: sale.id, product_name: `Item ${sale.id}`, applied_price_usd: String(Number(sale.total_usd) + Number(sale.item_discount_usd)), total_usd: sale.item_total_usd, discount_usd: sale.item_discount_usd })
  }
  // The historical rows predate revision tracking. Seeding through the current
  // schema fires revision triggers, so remove those synthetic test revisions.
  exec('DELETE FROM sale_write_revisions;')
  exec('INSERT INTO branch_stock(id,product_id,branch_id,quantity) VALUES(9001,9001,9001,17);')
  exec('INSERT INTO branch_batch_stock(id,batch_id,branch_id,quantity) VALUES(9001,9001,9001,9);')
  cache.clear()
  backupShouldFail = false
  injectLateBatchFailure = false
  backupTables = null
  backupCalls = 0
  batchCalls = 0
  eventLog = []
}

function protectedSnapshot() {
  const sales = all('SELECT * FROM sales ORDER BY id').map((record) => {
    const copy = { ...record }
    delete copy.subtotal_usd
    return copy
  })
  return {
    sales,
    items: all('SELECT * FROM sale_items ORDER BY id'),
    branchStock: all('SELECT * FROM branch_stock ORDER BY id'),
    batchStock: all('SELECT * FROM branch_batch_stock ORDER BY id'),
  }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('live preview is read-only, permission-gated, uncached and yields a canonical immutable request', async () => {
    resetHarness()
    const before = protectedSnapshot()
    for (const [access, expected] of [['unauthenticated', 401], ['export-only', 403], ['restore', 200]]) {
      const response = await app.request('/legacy-subtotal-repair/preview', { headers: { 'x-test-access': access } }, fakeEnv, fakeExecutionCtx)
      assert.strictEqual(response.status, expected)
      if (expected !== 401) assert.strictEqual(response.headers.get('cache-control'), 'no-store')
      const preview = await response.json()
      if (expected !== 200) { assert.ok(!preview.request); continue }
      assert.strictEqual(preview.state, 'ready')
      assert.deepStrictEqual(preview.summary, { sale_count: 22, subtotal_usd: '3462.0000', item_discount_usd: '66.0000' })
      assert.strictEqual(preview.request.manifest_sha256, planner.manifestDigest(preview.request.manifest))
      assert.strictEqual(preview.request.manifest.operator_name, RESTORE_USER.name)
      assert.deepStrictEqual(preview.request.manifest.sales, planner.canonicalizeManifest(fixtureManifest()).sales)
      assert.strictEqual(backupCalls, 0)
      assert.strictEqual(batchCalls, 0)
      assert.deepStrictEqual(protectedSnapshot(), before)
      const applied = await request(preview.request)
      assert.strictEqual(applied.status, 200, JSON.stringify(applied))
      assert.strictEqual(applied.json.affected.sales, 22)
      assert.deepStrictEqual(protectedSnapshot(), before)
      const retried = await request(preview.request)
      assert.strictEqual(retried.status, 200)
      assert.strictEqual(retried.json.outcome, 'already_applied')
      assert.strictEqual(retried.json.affected.sales, 0)
    }
  })

  await check('preview refuses mixed, changed, overlong and maintenance snapshots without mutations', async () => {
    for (const change of [
      'UPDATE sales SET subtotal_usd=1 WHERE id=16842',
      'DELETE FROM sales WHERE id=16842',
      'UPDATE sale_items SET total_usd=total_usd+1 WHERE sale_id=16842',
      "UPDATE sales SET notes=printf('%02001d',0) WHERE id=16842",
      `INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`,
    ]) {
      resetHarness()
      exec(change)
      const before = protectedSnapshot()
      const response = await app.request('/legacy-subtotal-repair/preview', {}, fakeEnv, fakeExecutionCtx)
      assert.strictEqual(response.status, 409, change)
      assert.ok(!(await response.json()).request)
      assert.strictEqual(backupCalls, 0)
      assert.strictEqual(batchCalls, 0)
      assert.deepStrictEqual(protectedSnapshot(), before)
    }
  })

  await check('preview cohort lookup uses primary keys and never scans unrelated sales', async () => {
    resetHarness()
    const plan = rawDbHandle.prepare(`EXPLAIN QUERY PLAN ${legacyRepair.LEGACY_SUBTOTAL_PREVIEW_SQL}`).all({ ids: JSON.stringify(planner.EXPECTED_IDS) })
    assert.ok(plan.some((entry) => /SEARCH s USING INTEGER PRIMARY KEY/.test(entry.detail)), JSON.stringify(plan))
    assert.ok(!plan.some((entry) => /SCAN s$/.test(entry.detail)), JSON.stringify(plan))
  })

  await check('runtime canonical digest and guarded SQL stay in parity with the local planner', async () => {
    resetHarness()
    const body = requestFor()
    const runtime = await legacyRepair.prepareLegacySubtotalRepair(body, RESTORE_USER)
    const planned = planner.buildPayload(body.manifest)
    assert.strictEqual(runtime.manifestSha256, planned.manifest_sha256)
    assert.strictEqual(runtime.statements.length, planned.apply.statements.length)
    for (const index of [...Array(24).keys(), 26, 27]) {
      assert.strictEqual(runtime.statements[index].sql, planned.apply.statements[index].sql, `statement ${index} drifted from planner`)
      assert.deepStrictEqual(runtime.statements[index].params, planned.apply.statements[index].params, `statement ${index} params drifted from planner`)
    }
  })

  await check('authentication and backup_restore permission fail before backup or batch', async () => {
    for (const [access, expectedStatus] of [['unauthenticated', 401], ['export-only', 403]]) {
      resetHarness()
      const result = await request(requestFor(), access)
      assert.strictEqual(result.status, expectedStatus, JSON.stringify(result.json))
      assert.strictEqual(backupCalls, 0)
      assert.strictEqual(batchCalls, 0)
      assert.strictEqual(row('SELECT SUM(subtotal_usd) AS n FROM sales').n, 0)
    }
  })

  await check('explicit apply confirmation, exact digest, and exact request scope are mandatory', async () => {
    resetHarness()
    const noApply = requestFor()
    noApply.apply = false
    assert.strictEqual((await request(noApply)).status, 400)

    const badDigest = requestFor()
    badDigest.manifest_sha256 = '0'.repeat(64)
    assert.strictEqual((await request(badDigest)).status, 400)

    const forgedId = requestFor()
    forgedId.manifest.sales[0].id = 16827
    assert.strictEqual((await request(forgedId)).status, 400)

    const rawSql = { ...requestFor(), sql: 'UPDATE sales SET subtotal_usd=999' }
    assert.strictEqual((await request(rawSql)).status, 400)
    assert.strictEqual(backupCalls, 0)
    assert.strictEqual(batchCalls, 0)
    assert.strictEqual(row('SELECT SUM(subtotal_usd) AS n FROM sales').n, 0)
  })

  await check('a failed fresh backup prevents the native batch and every database change', async () => {
    resetHarness()
    const before = protectedSnapshot()
    backupShouldFail = true
    const result = await request(requestFor())
    assert.strictEqual(result.status, 500, JSON.stringify(result.json))
    assert.match(result.json.error, /backup/i)
    assert.strictEqual(backupCalls, 1)
    assert.strictEqual(batchCalls, 0)
    assert.deepStrictEqual(protectedSnapshot(), before)
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM action_history').n, 0)
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM audit_logs').n, 0)
  })

  await check('healthy apply uses one post-backup atomic batch and mutates only subtotal plus revision/audit/history', async () => {
    resetHarness()
    const before = protectedSnapshot()
    const result = await request(requestFor())
    assert.strictEqual(result.status, 200, JSON.stringify(result.json))
    assert.strictEqual(result.json.outcome, 'applied')
    assert.deepStrictEqual(result.json.affected, { sales: 22 })
    assert.deepStrictEqual(eventLog, ['backup', 'batch'])
    assert.strictEqual(backupCalls, 1)
    assert.strictEqual(batchCalls, 1)
    assert.deepStrictEqual(backupTables, ['sales', 'sale_write_revisions', 'action_history', 'audit_logs', 'sale_bulk_guards'])
    assert.strictEqual(row("SELECT printf('%.4f',SUM(subtotal_usd)) AS n FROM sales").n, '3462.0000')
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM sale_write_revisions WHERE revision=1').n, 22)
    assert.strictEqual(row("SELECT COUNT(*) AS n FROM action_history WHERE entity='sep23_subtotal_repair' AND reversible=0 AND status='recorded'").n, 1)
    assert.strictEqual(row("SELECT COUNT(*) AS n FROM audit_logs WHERE action='repair_subtotal_usd'").n, 1)
    assert.strictEqual(row("SELECT user_id FROM audit_logs WHERE action='repair_subtotal_usd'").user_id, RESTORE_USER.id)
    assert.strictEqual(row("SELECT user_name FROM audit_logs WHERE action='repair_subtotal_usd'").user_name, RESTORE_USER.name)
    assert.deepStrictEqual(protectedSnapshot(), before)
  })

  await check('lost-ack retry is idempotent with one history/audit and no second revision', async () => {
    resetHarness()
    const body = requestFor()
    assert.strictEqual((await request(body)).status, 200)
    eventLog = []
    backupCalls = 0
    batchCalls = 0
    const replay = await request(body)
    assert.strictEqual(replay.status, 200, JSON.stringify(replay.json))
    assert.strictEqual(replay.json.outcome, 'already_applied')
    assert.deepStrictEqual(replay.json.affected, { sales: 0 })
    assert.deepStrictEqual(eventLog, ['backup', 'batch'])
    assert.strictEqual(backupCalls, 1)
    assert.strictEqual(batchCalls, 1)
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM sale_write_revisions WHERE revision=1').n, 22)
    assert.strictEqual(row("SELECT COUNT(*) AS n FROM action_history WHERE entity='sep23_subtotal_repair'").n, 1)
    assert.strictEqual(row("SELECT COUNT(*) AS n FROM audit_logs WHERE action='repair_subtotal_usd'").n, 1)
  })

  await check('stale or mixed cohort state rejects atomically without completing any other sale', async () => {
    resetHarness()
    exec('UPDATE sales SET subtotal_usd=1454 WHERE id=16842;')
    const before = all('SELECT id,subtotal_usd FROM sales ORDER BY id')
    const result = await request(requestFor())
    assert.strictEqual(result.status, 409, JSON.stringify(result.json))
    assert.deepStrictEqual(eventLog, ['backup', 'batch'])
    assert.deepStrictEqual(all('SELECT id,subtotal_usd FROM sales ORDER BY id'), before)
    assert.strictEqual(row("SELECT COUNT(*) AS n FROM action_history WHERE entity='sep23_subtotal_repair'").n, 0)
    assert.strictEqual(row("SELECT COUNT(*) AS n FROM audit_logs WHERE action='repair_subtotal_usd'").n, 0)
  })

  await check('a failure after every repair statement still rolls the in-memory transaction back', async () => {
    resetHarness()
    const before = protectedSnapshot()
    injectLateBatchFailure = true
    const result = await request(requestFor())
    assert.strictEqual(result.status, 409, JSON.stringify(result.json))
    assert.deepStrictEqual(eventLog, ['backup', 'batch'])
    assert.strictEqual(batchCalls, 1)
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM sales WHERE subtotal_usd <> 0').n, 0)
    assert.strictEqual(row('SELECT COUNT(*) AS n FROM sale_write_revisions').n, 0)
    assert.strictEqual(row("SELECT COUNT(*) AS n FROM action_history WHERE entity='sep23_subtotal_repair'").n, 0)
    assert.strictEqual(row("SELECT COUNT(*) AS n FROM audit_logs WHERE action='repair_subtotal_usd'").n, 0)
    assert.deepStrictEqual(protectedSnapshot(), before)
  })

  console.log(`\n${passed} checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  if (originalTsLoader) require.extensions['.ts'] = originalTsLoader
  else delete require.extensions['.ts']
})
