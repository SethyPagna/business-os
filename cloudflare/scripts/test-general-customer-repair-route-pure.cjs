// Real Hono route/auth coverage for the fixed customer-24969 repair.
// Uses every real migration and the real helper; backup, KV cache and
// BroadcastHub are bounded in-memory fakes. No network or remote data.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  return {
    sourcePath,
    output: ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: sourcePath,
    }).outputText,
  }
}

function loadReal(relPath, overrides = {}) {
  const { sourcePath, output } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in overrides) return overrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      moduleObj.exports,
      Module.createRequire(sourcePath),
      moduleObj,
      sourcePath,
      path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const db = openDb(loadAll())
const dbKernel = { getDb: () => db }
const permissions = loadReal('lib/permissions.ts')
const actorSnapshot = loadReal('lib/actorSnapshot.ts')
const auth = loadReal('lib/auth.ts', { './db': dbKernel })
const requestBodyGuard = loadReal('lib/requestBodyGuard.ts')

let cacheVersion = 10
let cacheBumpFails = false
let backupFails = false
let atomicFails = false
let batchCalls = 0
let backupCalls = []
let broadcasts = []
let operationLog = []
const nativeBatch = db.batch.bind(db)
db.batch = async (statements) => {
  batchCalls += 1
  operationLog.push('d1-batch')
  if (atomicFails) throw new Error('private simulated D1 details')
  return nativeBatch(statements)
}

const cacheKernel = {
  getVersionWithFallback: async () => {
    operationLog.push(`cache-read:${cacheVersion}`)
    return `d2:${cacheVersion}`
  },
  bumpVersion: async () => {
    operationLog.push('cache-bump')
    if (cacheBumpFails) throw new Error('cache unavailable')
    cacheVersion += 1
  },
}
const broadcastKernel = {
  broadcast: async (_env, channel, payload) => {
    operationLog.push('broadcast')
    broadcasts.push({ channel, payload })
  },
}
const repair = loadReal('lib/generalCustomerRepair.ts', {
  './cache': cacheKernel,
  '../durable-objects/broadcastHub': broadcastKernel,
})

const kv = new Map()
const fakeEnv = {
  DB: db,
  CACHE: {
    get: async (key) => kv.get(key) ?? null,
    put: async (key, value) => { kv.set(key, String(value)) },
  },
  ASSETS: null,
}

const runtimeOverrides = {
  '../lib/generalCustomerRepair': repair,
}

const systemRoute = loadReal('routes/system.ts', {
  '../lib/auth': auth,
  '../lib/permissions': permissions,
  '../lib/db': dbKernel,
  '../lib/actorSnapshot': actorSnapshot,
  '../lib/audit': { audit: async () => { throw new Error('General repair route must not call the generic audit helper') } },
  '../lib/dataIntegrity': { runDataIntegrityCheck: async () => ({}) },
  '../lib/errorReporting': { reportError: async () => false },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/r2': { listObjects: async () => [], deleteObject: async () => {}, deleteObjectsBulk: async () => ({ deleted: 0, errors: [] }) },
  '../lib/importRetention': { cleanOrphanImportStaging: async () => ({ applied: false, tables: {}, r2Keys: 0 }) },
  '../lib/coreDataInvariants': { ensureCoreDataInvariants: async () => {}, dropAllCustomTables: async () => {}, FACTORY_RESET_TABLES: [], PRODUCTS_RESET_TABLES: [] },
  '../lib/backup': {
    createCloudflareBackup: async () => { throw new Error('full backup is outside this repair') },
    createSectionBackup: async (_env, tables) => {
      operationLog.push('backup')
      backupCalls.push([...tables])
      if (backupFails) throw new Error('private backup object key')
      return { name: 'bounded-test-backup' }
    },
  },
  '../lib/media': { sanitizeMediaList: (items) => items },
  '../durable-objects/broadcastHub': broadcastKernel,
  '../lib/cache': cacheKernel,
})

const app = new Hono()
// Match index.ts's authenticated/authorized admission boundary using the
// actual shared guard before the real system router parses the request.
app.use('/api/system/finalize-migration', async (c, next) => {
  const user = await auth.getSessionUser(c)
  if (!user || !permissions.hasPermission(user, 'backup_restore')) return next()
  const rejection = await requestBodyGuard.admitRequestBody(c, requestBodyGuard.MIGRATION_FINALIZE_BODY_BYTES)
  if (rejection) return rejection
  return next()
})
app.route('/api/system', systemRoute.default)
const pending = []
const executionCtx = {
  waitUntil: (promise) => { pending.push(Promise.resolve(promise).catch(() => {})) },
  passThroughOnException: () => {},
}

let adminToken
let deniedToken

function exec(sql) { db.exec(sql) }
function row(sql, params = {}) { return db.prepare(sql).get(params) }

async function withRuntimeOverrides(run) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in runtimeOverrides) return runtimeOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try { return await run() } finally { Module._load = originalLoad }
}

async function request(method, pathname, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.token) headers.Cookie = `bos_session=${options.token}`
  if (method === 'POST' && options.origin !== null) {
    headers.Origin = options.origin || 'https://admin.test'
    headers['Sec-Fetch-Site'] = options.fetchSite || 'same-origin'
  }
  let body = options.rawBody
  if (body === undefined && options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const response = await withRuntimeOverrides(() => app.request(
    `https://admin.test${pathname}`,
    { method, headers, body },
    fakeEnv,
    executionCtx,
  ))
  const json = await response.json().catch(() => null)
  return { response, status: response.status, json }
}

function seedRepair() {
  exec(`
    DELETE FROM audit_logs;
    DELETE FROM action_history;
    DELETE FROM portal_accounts;
    DELETE FROM returns;
    DELETE FROM sales;
    DELETE FROM customers;
    DELETE FROM system_flags WHERE key='maintenance';
  `)
  db.prepare(`INSERT INTO customers(
      id,name,phone,email,address,company,notes,created_at,membership_number,updated_at,gender,phone_normalized,is_anonymous)
    VALUES(@id,@name,@phone,@email,@address,@company,@notes,@created,@membership,@updated,@gender,@normalized,0)`).run({
    id: 24969,
    name: 'general',
    phone: '',
    email: 'private@example.test',
    address: 'private address',
    company: 'private company',
    notes: 'private notes',
    created: '2026-08-01 01:02:03',
    membership: 'LC-04971',
    updated: '2026-09-04 04:54:57',
    gender: 'other',
    normalized: '',
  })
  db.prepare("INSERT INTO customers(id,name,phone,updated_at,is_anonymous) VALUES(22305,'General Real','086897171','2026-09-04 04:54:57',0)").run()
  for (const id of [101, 102, 103, 104, 105]) {
    db.prepare("INSERT INTO sales(id,receipt_number,customer_id,customer_name,created_at) VALUES(@id,@receipt,24969,'general','2026-09-01 00:00:00')")
      .run({ id, receipt: `R-${id}` })
  }
  db.prepare("INSERT INTO returns(id,return_number,customer_id,customer_name,created_at) VALUES(201,'RET-201',24969,'general','2026-09-02 00:00:00')").run()
  kv.clear()
  cacheVersion = 10
  cacheBumpFails = false
  backupFails = false
  atomicFails = false
  batchCalls = 0
  backupCalls = []
  broadcasts = []
  operationLog = []
}

async function setupAuth() {
  exec('DELETE FROM user_sessions; DELETE FROM users WHERE id IN (901,902);')
  db.prepare("INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(901,'repair_operator','Repair Operator','x',@permissions,1)")
    .run({ permissions: JSON.stringify({ backup_restore: true }) })
  db.prepare("INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(902,'export_only','Export Only','x',@permissions,1)")
    .run({ permissions: JSON.stringify({ backup: true }) })
  adminToken = (await auth.createSession(fakeEnv, 901, { sessionDuration: '1d' })).token
  deniedToken = (await auth.createSession(fakeEnv, 902, { sessionDuration: '1d' })).token
}

let passed = 0
async function check(name, run) {
  await run()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await setupAuth()

  await check('real Hono auth returns 401 and backup_restore permission returns 403', async () => {
    seedRepair()
    const unauthenticated = await request('GET', '/api/system/shared-general-customer-repair/preview')
    assert.equal(unauthenticated.status, 401)
    assert.equal(unauthenticated.json.code, 'invalid_session')
    const denied = await request('GET', '/api/system/shared-general-customer-repair/preview', { token: deniedToken })
    assert.equal(denied.status, 403)
    assert.equal(batchCalls, 0)
    assert.equal(backupCalls.length, 0)
  })

  await check('preview is no-store, exact and redacted', async () => {
    seedRepair()
    const preview = await request('GET', '/api/system/shared-general-customer-repair/preview', { token: adminToken })
    assert.equal(preview.status, 200, JSON.stringify(preview.json))
    assert.equal(preview.response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(preview.json.target, {
      id: 24969,
      name: 'general',
      phone_state: 'known_empty',
      address_state: 'known_present',
      is_anonymous: 0,
      portal_account_count: 0,
      sale_count: 5,
      return_count: 1,
    })
    assert.deepEqual(Object.keys(preview.json.request).sort(), ['confirmation', 'expected_updated_at', 'manifest_sha256', 'step'])
    assert.match(preview.json.request.manifest_sha256, /^[a-f0-9]{64}$/)
    const serialized = JSON.stringify(preview.json)
    for (const secret of ['private@example.test', 'private address', 'private company', 'private notes', 'LC-04971', '086897171']) {
      assert.ok(!serialized.includes(secret), `preview leaked ${secret}`)
    }
  })

  await check('same-origin, exact-body and bounded-body guards reject before backup or mutation', async () => {
    seedRepair()
    const preview = await request('GET', '/api/system/shared-general-customer-repair/preview', { token: adminToken })
    const crossOrigin = await request('POST', '/api/system/finalize-migration', {
      token: adminToken,
      origin: 'https://evil.test',
      fetchSite: 'cross-site',
      body: preview.json.request,
    })
    assert.equal(crossOrigin.status, 403)
    const missingOrigin = await request('POST', '/api/system/finalize-migration', { token: adminToken, origin: null, body: preview.json.request })
    assert.equal(missingOrigin.status, 403)
    const extraKey = await request('POST', '/api/system/finalize-migration', {
      token: adminToken,
      body: { ...preview.json.request, customer_id: 24969 },
    })
    assert.equal(extraKey.status, 400)
    const oversized = await request('POST', '/api/system/finalize-migration', {
      token: adminToken,
      rawBody: 'x'.repeat(768 * 1024 + 1),
      headers: { 'Content-Type': 'application/json' },
    })
    assert.equal(oversized.status, 413)
    assert.equal(oversized.json.code, 'request_body_too_large')
    assert.equal(batchCalls, 0)
    assert.equal(backupCalls.length, 0)
  })

  await check('preview and finalize fixed-window limits return 429 without writes', async () => {
    seedRepair()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await request('GET', '/api/system/shared-general-customer-repair/preview', { token: adminToken })).status, 200)
    }
    const limited = await request('GET', '/api/system/shared-general-customer-repair/preview', { token: adminToken })
    assert.equal(limited.status, 429)
    assert.equal(batchCalls, 0)
    assert.equal(backupCalls.length, 0)

    seedRepair()
    const preview = await request('GET', '/api/system/shared-general-customer-repair/preview', { token: adminToken })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rejected = await request('POST', '/api/system/finalize-migration', {
        token: adminToken,
        body: { step: 'mark_shared_general_24969' },
      })
      assert.equal(rejected.status, 400)
    }
    const finalizeLimited = await request('POST', '/api/system/finalize-migration', {
      token: adminToken,
      body: preview.json.request,
    })
    assert.equal(finalizeLimited.status, 429)
    assert.equal(batchCalls, 0)
    assert.equal(backupCalls.length, 0)
  })

  await check('backup failure is redacted and prevents the atomic helper batch', async () => {
    seedRepair()
    const preview = await request('GET', '/api/system/shared-general-customer-repair/preview', { token: adminToken })
    backupFails = true
    const result = await request('POST', '/api/system/finalize-migration', { token: adminToken, body: preview.json.request })
    assert.equal(result.status, 500)
    assert.equal(result.json.success, false)
    assert.ok(!JSON.stringify(result.json).includes('private backup object key'))
    assert.deepEqual(backupCalls, [['customers']])
    assert.equal(batchCalls, 0)
    assert.equal(row('SELECT is_anonymous FROM customers WHERE id=24969').is_anonymous, 0)
  })

  await check('atomic failure is fixed/redacted and rolls back the repair surface', async () => {
    seedRepair()
    const preview = await request('GET', '/api/system/shared-general-customer-repair/preview', { token: adminToken })
    atomicFails = true
    const result = await request('POST', '/api/system/finalize-migration', { token: adminToken, body: preview.json.request })
    assert.equal(result.status, 500)
    assert.deepEqual(result.json, { success: false, error: 'General customer repair failed. The atomic batch changed no data.' })
    assert.deepEqual(backupCalls, [['customers']])
    assert.equal(batchCalls, 1)
    assert.equal(row('SELECT is_anonymous FROM customers WHERE id=24969').is_anonymous, 0)
    assert.equal(row("SELECT COUNT(*) count FROM action_history WHERE entity='customer_anonymous_repair'").count, 0)
    assert.equal(row("SELECT COUNT(*) count FROM audit_logs WHERE action='mark_anonymous_customer'").count, 0)
  })

  await check('apply reports pending refresh; exact replay heals cache without backup, D1 mutation or duplicate audit', async () => {
    seedRepair()
    const preview = await request('GET', '/api/system/shared-general-customer-repair/preview', { token: adminToken })
    cacheBumpFails = true
    const applied = await request('POST', '/api/system/finalize-migration', { token: adminToken, body: preview.json.request })
    assert.equal(applied.status, 200, JSON.stringify(applied.json))
    assert.deepEqual({
      success: applied.json.success,
      outcome: applied.json.outcome,
      affected: applied.json.affected,
      verification_pending: applied.json.verification_pending,
      cache_invalidated: applied.json.cache_invalidated,
      refresh_pending: applied.json.refresh_pending,
      broadcast_requested: applied.json.broadcast_requested,
    }, {
      success: true,
      outcome: 'applied',
      affected: { customers: 1 },
      verification_pending: false,
      cache_invalidated: false,
      refresh_pending: true,
      broadcast_requested: true,
    })
    assert.deepEqual(backupCalls, [['customers']])
    assert.ok(operationLog.indexOf('d1-batch') < operationLog.indexOf('cache-read:10'), operationLog.join(','))
    assert.equal(row('SELECT is_anonymous FROM customers WHERE id=24969').is_anonymous, 1)
    assert.equal(row("SELECT COUNT(*) count FROM action_history WHERE entity='customer_anonymous_repair'").count, 1)
    assert.equal(row("SELECT COUNT(*) count FROM audit_logs WHERE action='mark_anonymous_customer'").count, 1)
    assert.deepEqual(broadcasts, [{ channel: 'customers', payload: { action: 'update', id: 24969, reason: 'anonymous_marker_repair' } }])

    cacheBumpFails = false
    const replay = await request('POST', '/api/system/finalize-migration', { token: adminToken, body: preview.json.request })
    assert.equal(replay.status, 200, JSON.stringify(replay.json))
    assert.deepEqual({
      outcome: replay.json.outcome,
      affected: replay.json.affected,
      verification_pending: replay.json.verification_pending,
      cache_invalidated: replay.json.cache_invalidated,
      refresh_pending: replay.json.refresh_pending,
      broadcast_requested: replay.json.broadcast_requested,
    }, {
      outcome: 'already_applied',
      affected: { customers: 0 },
      verification_pending: false,
      cache_invalidated: true,
      refresh_pending: false,
      broadcast_requested: true,
    })
    assert.deepEqual(backupCalls, [['customers']], 'exact replay must not take a second backup')
    assert.equal(batchCalls, 1, 'exact replay must not execute a second D1 batch')
    assert.equal(row("SELECT COUNT(*) count FROM action_history WHERE entity='customer_anonymous_repair'").count, 1)
    assert.equal(row("SELECT COUNT(*) count FROM audit_logs WHERE action='mark_anonymous_customer'").count, 1)
    assert.equal(broadcasts.length, 2)
  })

  await Promise.all(pending)
  console.log(`\n${passed} General customer repair route groups passed.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
