const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

const backupSchedule = transpile('lib/backupSchedule.ts')
const backupScheduleModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', backupSchedule.outputText)(
  backupScheduleModuleObj.exports, require, backupScheduleModuleObj, backupSchedule.sourcePath, path.dirname(backupSchedule.sourcePath),
)

const r2 = transpile('lib/r2.ts')
const r2ModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', r2.outputText)(
  r2ModuleObj.exports, require, r2ModuleObj, r2.sourcePath, path.dirname(r2.sourcePath),
)

// backup.ts also imports ./backupRestoreStream (the 10.1 streaming reader).
// Transpile and run it for real too -- restore's correctness depends on it, so
// this test exercises the actual scanner, not a stub.
const restoreStream = transpile('lib/backupRestoreStream.ts')
const restoreStreamModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', restoreStream.outputText)(
  restoreStreamModuleObj.exports, require, restoreStreamModuleObj, restoreStream.sourcePath, path.dirname(restoreStream.sourcePath),
)

// planTier.ts is pure and carries the tier-aware maxAssetsPerBackup this
// test's fixtures are sized against -- real, not stubbed.
const planTier = transpile('lib/planTier.ts')
const planTierModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', planTier.outputText)(
  planTierModuleObj.exports, require, planTierModuleObj, planTier.sourcePath, path.dirname(planTier.sourcePath),
)

// uploadSecurity.ts is the upload gate the restore re-checks files with -- real.
const uploadSecurity = transpile('lib/uploadSecurity.ts')
const uploadSecurityModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', uploadSecurity.outputText)(
  uploadSecurityModuleObj.exports, require, uploadSecurityModuleObj, uploadSecurity.sourcePath, path.dirname(uploadSecurity.sourcePath),
)

function loadAdmission(name, deps = {}) {
  const compiled = transpile('lib/' + name + '.ts')
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', compiled.outputText)(mod.exports, id => {
    if (Object.hasOwn(deps, id)) return deps[id]
    throw new Error('Unmapped admission dependency: ' + id)
  }, mod)
  return mod.exports
}
const stockTransaction = loadAdmission('stockTransaction')
const maintenance = loadAdmission('maintenance', { './stockTransaction': stockTransaction })

const backup = transpile('lib/backup.ts')
const customTableName = transpile('lib/customTableName.ts')
const customTableNameModule = { exports: {} }
new Function('exports', customTableName.outputText)(customTableNameModule.exports)
const Module = require('module')
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './stockTransaction') return stockTransaction
  if (request === './maintenance') return maintenance
  if (request === './planTier') return planTierModuleObj.exports // real limit tables
  if (request === './backupSchedule') return backupScheduleModuleObj.exports // real, pure schedule gate
  if (request === './customTableName') return customTableNameModule.exports
  if (request === './r2') return r2ModuleObj.exports // real module, actually exercised
  if (request === './backupRestoreStream') return restoreStreamModuleObj.exports // real scanner
  if (request === './uploadSecurity') return uploadSecurityModuleObj.exports // real upload gate
  return originalLoad.call(this, request, parent, isMain)
}
const backupModuleObj = { exports: {} }
// A restore of a pre-0270 backup loads lib/permissionExtras.ts on demand (a dynamic import); give it the real module and the real
// permissions helpers it reads, since this require outlives the one-off load patch above.
let permissionExtrasModule = null
function loadPermissionExtras() {
  if (permissionExtrasModule) return permissionExtrasModule
  const load = (relPath, requires) => {
    const compiled = transpile(relPath)
    const mod = { exports: {} }
    new Function('exports', 'require', 'module', compiled.outputText)(mod.exports, (id) => requires[id], mod)
    return mod.exports
  }
  permissionExtrasModule = load('lib/permissionExtras.ts', { './permissions': load('lib/permissions.ts', { './db': {} }) })
  return permissionExtrasModule
}
const backupRequire = (id) => (id === './permissionExtras' ? loadPermissionExtras() : require(id))
new Function('exports', 'require', 'module', '__filename', '__dirname', backup.outputText)(
  backupModuleObj.exports, backupRequire, backupModuleObj, backup.sourcePath, path.dirname(backup.sourcePath),
)
Module._load = originalLoad

const {
  createCloudflareBackup,
  restoreCloudflareBackup,
  pruneCloudflareBackups,
  listCloudflareBackups,
  validateCloudflareBackup,
  selectAssetsToCopy,
  continueCloudflareBackupAssetCopy,
  getCloudflareBackupState,
  linkCloudflareBackupJob,
  storeSystemJob,
  getSystemJob,
  CLOUDFLARE_BACKUP_PREFIX,
  MAX_ASSET_BYTES_PER_BACKUP,
  assetPoolKey,
} = backupModuleObj.exports

// A4: fixtures below seed RELATIVE to the real per-run copy cap, so a
// deliberate future re-base of the constant re-sizes the tests with it
// instead of silently pinning a stale number.
const ASSET_CAP = MAX_ASSET_BYTES_PER_BACKUP
assert.ok(Number.isInteger(ASSET_CAP) && ASSET_CAP > 0, 'MAX_ASSET_BYTES_PER_BACKUP export missing or invalid')

for (const fn of [createCloudflareBackup, restoreCloudflareBackup, pruneCloudflareBackups, listCloudflareBackups, validateCloudflareBackup, selectAssetsToCopy, continueCloudflareBackupAssetCopy, getCloudflareBackupState, linkCloudflareBackupJob, storeSystemJob, getSystemJob]) {
  assert.strictEqual(typeof fn, 'function', 'expected backup.ts export missing -- source may have changed')
}

// ---------------------------------------------------------------------
// Fake D1 -- covers exactly the four query shapes backup.ts issues:
//   SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (json_each(?))  (presentTableNames)
//   PRAGMA table_info("table")                                  (tableColumns)
//   SELECT * FROM "table"                                       (read all rows)
//   SELECT * FROM "table" ORDER BY rowid LIMIT ? OFFSET ?       (paged read)

function makeRestoreD1(schema) {
  const Database = require('better-sqlite3')
  const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
  const sql = new Database(':memory:')
  const quote = name => '"' + name.replaceAll('"', '""') + '"'
  for (const [name, table] of Object.entries(schema)) {
    sql.exec('CREATE TABLE ' + quote(name) + '(' + table.columns.map(quote).join(',') + ')')
    const insert = sql.prepare('INSERT INTO ' + quote(name) + ' VALUES(' + table.columns.map(() => '?').join(',') + ')')
    for (const row of table.rows) insert.run(...table.columns.map(column => row[column] ?? null))
  }
  sql.exec(`CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE import_jobs(id INTEGER PRIMARY KEY,status TEXT,lease_expires_at TEXT);
    CREATE TABLE bulk_delete_jobs(id INTEGER PRIMARY KEY,status TEXT);`)
  sql.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run('stock_schema_epoch', stockTransaction.STOCK_SCHEMA_EPOCH)
  const sync = () => {
    for (const [name, table] of Object.entries(schema)) table.rows = sql.prepare('SELECT * FROM ' + quote(name)).all()
  }
  const statement = (text, params = []) => ({
    bind: (...values) => statement(text, values),
    async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
    async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
    _exec() {
      const prepared = sql.prepare(text)
      if (prepared.reader) return { success: true, results: sqliteD1Call(prepared, 'all', params) }
      return { success: true, meta: sqliteD1Call(prepared, 'run', params) }
    },
    async run() { const result = this._exec(); sync(); return result },
  })
  return {
    prepare: text => statement(text),
    async batch(statements) {
      const results = sql.transaction(() => statements.map(item => item._exec()))()
      sync()
      return results
    },
  }
}

async function restoreOwned(env, key, onProgress) {
  const ownership = await maintenance.beginMaintenance(env, { backupKey: key, startedBy: 'backup restore fixture' })
  try {
    return await restoreCloudflareBackup(env, key, onProgress, ownership.token)
  } finally {
    assert.strictEqual((await env.DB.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").first()).n, 0)
    assert.strictEqual(await maintenance.endMaintenance(env, ownership.token), true)
  }
}

const { makeFakeR2 } = require('./harness/fake_r2.cjs')
const F = require('./harness/upload_fixtures.cjs')
// ---------------------------------------------------------------------
function makeFakeKV() {
  const store = new Map()
  return {
    _store: store,
    async get(key) { return store.has(key) ? store.get(key) : null },
    async put(key, value) { store.set(key, value) },
    async delete(key) { store.delete(key) },
  }
}

// ---------------------------------------------------------------------
// Fake Queue (env.BACKUP_QUEUE) -- captures .send() calls in memory
// instead of actually driving a separate consumer invocation. Tests that
// need to exercise a full multi-step continuation drive
// continueCloudflareBackupAssetCopy themselves in a loop, reading each
// ---------------------------------------------------------------------
function makeFakeQueue() {
  const sent = []
  return {
    sent,
    async send(message) { sent.push(message) },
  }
}

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}
async function checkAsync(name, fn) {
  try {
    await fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}


// ---------------------------------------------------------------------
// Gzip manifest: new backups on the paid tier are compressed as they stream into R2; restore / validate / Drive-stage
// inspection read plain AND gzip documents (sniffed from the first two bytes). Free never compresses.
// ---------------------------------------------------------------------
const zlib = require('node:zlib')
const { inspectCloudflareBackupStream } = backupModuleObj.exports
const { gunzipIfCompressed } = restoreStreamModuleObj.exports

function bigSchema(rows) {
  const data = []
  for (let i = 0; i < rows; i++) data.push({ key: `setting_${i}`, value: JSON.stringify({ id: 100000 + i, name: ['Rose Lip Balm', 'ក្រែមបន្ទន់ស្បែក', 'Vitamin C Serum'][i % 3], price: (3 + (i % 40)).toFixed(2), at: `2026-11-0${1 + (i % 9)}T10:${10 + (i % 49)}:00Z` }) })
  return { settings: { columns: ['key', 'value'], rows: data } }
}
function gzEnv(schema, tier) {
  const env = { DB: makeRestoreD1(schema), ASSETS: makeFakeR2({}), CACHE: makeFakeKV(), BACKUP_QUEUE: makeFakeQueue() }
  if (tier) env.PLAN_TIER = tier
  return env
}
const sourceOf = (bytes) => new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close() } }) // one byte per chunk

async function mainGzip() {
  if (process.argv[2] === 'free-child') {
    const env = gzEnv(bigSchema(50), 'free')
    const created = await createCloudflareBackup(env, 'manual')
    const stored = env.ASSETS._store.get(created.key)
    assert.strictEqual(stored.body[0], 123, 'Free writes plain JSON')
    assert.strictEqual(stored.customMetadata.encoding, undefined)
    await env.DB.prepare('DELETE FROM settings').run()
    await restoreOwned(env, created.name)
    assert.strictEqual((await env.DB.prepare('SELECT COUNT(*) n FROM settings').first()).n, 50)
    console.log('free ok')
    return
  }
  await checkAsync('a paid-tier manifest is gzip on disk, much smaller, and restores row for row', async () => {
    const schema = bigSchema(4000)
    const original = JSON.parse(JSON.stringify(schema.settings.rows))
    const env = gzEnv(schema, 'paid')
    const created = await createCloudflareBackup(env, 'manual')
    const stored = env.ASSETS._store.get(created.key)
    assert.strictEqual(stored.body[0], 0x1f); assert.strictEqual(stored.body[1], 0x8b)
    assert.strictEqual(stored.customMetadata.encoding, 'gzip')
    const plain = zlib.gunzipSync(stored.body)
    assert.ok(stored.body.length < plain.length / 4, `gzip ${stored.body.length} vs plain ${plain.length}`)
    assert.strictEqual(JSON.parse(plain.toString('utf8')).tables.settings.rows.length, 4000)
    console.log(`  manifest: plain ${plain.length} bytes -> gzip ${stored.body.length} bytes (ratio ${(plain.length / stored.body.length).toFixed(1)}) for 4000 patterned rows`)
    schema.settings.rows = []
    await env.DB.prepare('DELETE FROM settings').run()
    const validation = await validateCloudflareBackup(env, created.key)
    assert.ok(validation.tables >= 1)
    assert.strictEqual(validation.restorable, true)
    await restoreOwned(env, created.name)
    const back = (await env.DB.prepare('SELECT key, value FROM settings ORDER BY rowid').all()).results
    assert.deepStrictEqual(back, original)
  })

  await checkAsync('a Free-tier manifest stays plain JSON (child process: the tier is resolved once per process)', async () => {
    const run = require('node:child_process').spawnSync(process.execPath, [__filename, 'free-child'], { encoding: 'utf8', timeout: 60000 })
    assert.strictEqual(run.status, 0, run.stdout + run.stderr)
  })

  await checkAsync('a plain (pre-gzip) manifest still restores on a paid deployment', async () => {
    const schema = bigSchema(50)
    const env = gzEnv(schema, 'paid')
    const created = await createCloudflareBackup(env, 'manual')
    const stored = env.ASSETS._store.get(created.key)
    env.ASSETS._set(created.key, zlib.gunzipSync(stored.body), { customMetadata: { format: 'business-os-cloudflare-backup', source: 'manual', scope: 'full', lifecycle: 'sidecar-v1' } })
    assert.strictEqual(env.ASSETS._store.get(created.key).body[0], 123)
    await env.DB.prepare('DELETE FROM settings').run()
    await restoreOwned(env, created.name)
    assert.strictEqual((await env.DB.prepare('SELECT COUNT(*) n FROM settings').first()).n, 50)
  })

  await checkAsync('a multi-part gzip manifest (> 8 MiB compressed) round-trips', async () => {
    const big = require('node:crypto').randomBytes(11 * 1024 * 1024).toString('base64')
    const schema = { settings: { columns: ['key', 'value'], rows: [{ key: 'blob', value: big }, { key: 'tail', value: 'x' }] } }
    const env = gzEnv(schema, 'paid')
    const created = await createCloudflareBackup(env, 'manual')
    assert.ok(env.ASSETS._store.get(created.key).size > 8 * 1024 * 1024, 'forces more than one multipart part')
    await env.DB.prepare('DELETE FROM settings').run()
    await restoreOwned(env, created.name)
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'blob'").first()
    assert.strictEqual(row.value.length, big.length)
    assert.strictEqual(row.value, big)
  })

  await checkAsync('a failing part upload rejects the backup (no hang) and aborts the upload', async () => {
    const big = require('node:crypto').randomBytes(11 * 1024 * 1024).toString('base64')
    const schema = { settings: { columns: ['key', 'value'], rows: [{ key: 'blob', value: big }] } }
    const env = gzEnv(schema, 'paid')
    let aborted = false
    const realCreate = env.ASSETS.createMultipartUpload.bind(env.ASSETS)
    env.ASSETS.createMultipartUpload = async (key, opts) => {
      const upload = await realCreate(key, opts)
      return { ...upload, uploadPart: async () => { throw new Error('part upload failed') }, abort: async () => { aborted = true } }
    }
    const outcome = await Promise.race([
      createCloudflareBackup(env, 'manual').then(() => 'resolved', (error) => error.message),
      new Promise((resolve) => setTimeout(() => resolve('HUNG'), 20000)),
    ])
    assert.strictEqual(outcome, 'part upload failed')
    assert.strictEqual(aborted, true)
  })

  await checkAsync('gunzipIfCompressed sniffs the first two bytes even when they arrive one byte per chunk', async () => {
    const text = '{"format":"x","tables":{}}'
    const read = async (stream) => Buffer.from(await new Response(await stream).arrayBuffer()).toString('utf8')
    assert.strictEqual(await read(gunzipIfCompressed(sourceOf(Buffer.from(text)))), text)
    assert.strictEqual(await read(gunzipIfCompressed(sourceOf(zlib.gzipSync(text)))), text)
    assert.strictEqual(await read(gunzipIfCompressed(sourceOf(Buffer.alloc(0)))), '')
    assert.strictEqual(await read(gunzipIfCompressed(sourceOf(Buffer.from('{')))), '{')
  })

  await checkAsync('the Drive stage inspection accepts a gzip document and a plain one alike', async () => {
    const env = gzEnv(bigSchema(20), 'paid')
    const created = await createCloudflareBackup(env, 'manual')
    const gz = env.ASSETS._store.get(created.key).body
    const inspected = await inspectCloudflareBackupStream(sourceOf(gz))
    const plainInspected = await inspectCloudflareBackupStream(sourceOf(zlib.gunzipSync(gz)))
    assert.deepStrictEqual(inspected.tableNames, plainInspected.tableNames)
    assert.strictEqual(inspected.rowCount, 20)
    // a truncated gzip document is refused, not silently half-read
    await assert.rejects(() => inspectCloudflareBackupStream(sourceOf(gz.subarray(0, Math.floor(gz.length / 2)))))
  })

  console.log(`\n${passed} check(s) passed.`)
}
mainGzip().catch((e) => { console.log('FAIL', e.stack || e.message); process.exitCode = 1 })
