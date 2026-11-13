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
// Shared asset pool: an asset is copied once per (key + etag) and every backup that references that version points at the
// same object. Retention deletes a pooled object only when no surviving sidecar references it. Fake R2 here is the
// realistic harness (md5 etags, pagination, delimiter), not the string-bodied fake of the older tests.
// ---------------------------------------------------------------------
const { BACKUP_ASSET_POOL_PREFIX } = backupModuleObj.exports
const POOL = BACKUP_ASSET_POOL_PREFIX
const DAY = 86400000
const baseMs = Date.now() // objects are 'fresh' to the 1 h orphan grace, as in a live run
const RealDate = Date
let clock = 0
class TickedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(baseMs + clock); else super(...args) }
  static now() { return baseMs + clock }
}

function makeEnv(assets, { pageLimit } = {}) {
  const queue = makeFakeQueue()
  const schema = { settings: { columns: ['key', 'value'], rows: [{ key: 'business_name', value: 'Leang' }] } }
  return { DB: makeRestoreD1(schema), ASSETS: makeFakeR2(assets, { pageLimit }), CACHE: makeFakeKV(), BACKUP_QUEUE: queue }
}
const png = (n) => F.png(F.pngChunk('IDAT', F.enc(`variant-${n}`)))
const IMG = { httpMetadata: { contentType: 'image/png' } }
function imageSet(count) {
  const assets = {}
  for (let i = 0; i < count; i++) assets[`uploads/img-${String(i).padStart(4, '0')}.png`] = { body: Buffer.from(png(i)), ...IMG }
  return assets
}
async function drain(env) {
  while (env.BACKUP_QUEUE.sent.length) {
    const message = env.BACKUP_QUEUE.sent.shift()
    await continueCloudflareBackupAssetCopy(env, message.backupName)
  }
}
async function withClock(day, fn) {
  clock = day * DAY
  global.Date = TickedDate
  try { return await fn() } finally { global.Date = RealDate }
}
// One backup at `day`, drained to the end. Returns the Class A/B operations it cost.
async function night(env, day, source = 'scheduled') {
  return withClock(day, async () => {
    env.ASSETS._resetOps()
    const created = await createCloudflareBackup(env, source)
    await drain(env)
    await pruneCloudflareBackups(env) // what maybeRunScheduledBackup does after a create
    return { created, name: created.name.replace(/\.json$/, ''), ops: { classA: env.ASSETS._ops.classA, classB: env.ASSETS._ops.classB, puts: [...env.ASSETS._ops.puts], gets: [...env.ASSETS._ops.gets] } }
  })
}
const poolKeys = (env) => [...env.ASSETS._store.keys()].filter((key) => key.startsWith(POOL)).sort()
const poolPuts = (ops) => ops.puts.filter((key) => key.startsWith(POOL))
const stateOf = (env, name) => getCloudflareBackupState(env, name)
const bytesOf = (env, key) => env.ASSETS._store.get(key).body

// Concurrency holes of the shared pool (reviewer round 5): a prune racing a backup must never leave a finalized set
// that names a pool object that is gone.
async function mainRaces() {
  await checkAsync('F1: prune concurrent with a new backup deletes a reused pool object (race)', async () => {
    const env = makeEnv(imageSet(3))
    const A = Buffer.from(png(0))
    await night(env, 0, 'manual') // M0 holds img-0000 = A
    env.ASSETS._set('uploads/img-0000.png', Buffer.from(png(777)), IMG)
    await night(env, 1, 'manual') // M1 holds img-0000 = B (prune keep 2 keeps both)
    env.ASSETS._set('uploads/img-0000.png', A, IMG) // reverted (e.g. a restore of M0's image): etag of A again
    // P: prune with keep=1 evicts M0; A@etag is now referenced only by M0. Interleave a new manual backup between
    // P's sidecar reads and P's pool delete.
    const realDelete = env.ASSETS.delete.bind(env.ASSETS)
    let fired = false
    let bName = null
    env.ASSETS.delete = async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys]
      if (!fired && list.some((k) => k.startsWith(POOL))) {
        fired = true
        const b = await withClock(2, () => createCloudflareBackup(env, 'manual'))
        bName = b.name.replace(/\.json$/, '')
        await drain(env)
      }
      return realDelete(keys)
    }
    await withClock(2, () => pruneCloudflareBackups(env, 1))
    env.ASSETS.delete = realDelete
    const bState = await stateOf(env, bName)
    console.log('  B status', bState.status, 'copied', bState.copiedKeys.length, '/', bState.assets.length)
    env.ASSETS._set('uploads/img-0000.png', Buffer.from('damaged'))
    const r = await restoreOwned(env, bName + '.json')
    console.log('  B restore: restored', r.restoredAssets, 'missing', JSON.stringify(r.missingAssets))
    assert.ok(!r.missingAssets, 'RACE: finalized backup B lost an image it reported as copied')
  })


  // The slice that finalizes a queue-driven set re-verifies the pool: an object deleted after it was counted as copied is
  // copied again from uploads/, and the set finalizes only when every named asset is present.
  await checkAsync('F1: continuation re-copies a copied key whose pool object vanished before the set finalized', async () => {
    const env = makeEnv(imageSet(150)) // > the 100-copy slice: the set is still copying after its first slice
    const created = await withClock(0, () => createCloudflareBackup(env, 'manual'))
    const name = created.name.replace(/\.json$/, '')
    assert.strictEqual(created.status, 'copying')
    const first = await stateOf(env, name)
    const victim = first.assets.find((a) => a.key === first.copiedKeys[3])
    await env.ASSETS.delete(assetPoolKey(victim)) // what a racing prune does
    await withClock(0, () => drain(env))
    const done = await stateOf(env, name)
    assert.strictEqual(done.status, 'finalized')
    assert.strictEqual(done.copiedKeys.length, 150)
    for (const asset of done.assets) assert.ok(env.ASSETS._store.has(assetPoolKey(asset)), 'finalized set names a missing pool object: ' + asset.key)
    const r = await withClock(0, () => restoreOwned(env, name + '.json'))
    assert.ok(!r.missingAssets, 'restore missing ' + JSON.stringify(r.missingAssets))
  })

  await checkAsync('F1: a vanished pool object whose source is gone too leaves the set failed, never finalized', async () => {
    const env = makeEnv(imageSet(150))
    const created = await withClock(0, () => createCloudflareBackup(env, 'manual'))
    const name = created.name.replace(/\.json$/, '')
    const first = await stateOf(env, name)
    const key = first.copiedKeys[3]
    await env.ASSETS.delete(assetPoolKey(first.assets.find((a) => a.key === key)))
    await env.ASSETS.delete(key) // the source is gone as well
    await withClock(0, () => drain(env))
    const done = await stateOf(env, name)
    assert.notStrictEqual(done.status, 'finalized')
    assert.ok(done.failedKeys.includes(key), 'the lost asset is reported')
    assert.ok(!done.copiedKeys.includes(key))
  })

  await checkAsync('F1: a manual set that finalizes at creation re-verifies the pool (object deleted during its own manifest write)', async () => {
    const env = makeEnv(imageSet(3))
    const realCreate = env.ASSETS.createMultipartUpload.bind(env.ASSETS)
    let deleted = false
    env.ASSETS.createMultipartUpload = async (k, o) => {
      if (!deleted) { deleted = true; await env.ASSETS.delete([...env.ASSETS._store.keys()].find((x) => x.startsWith(POOL))) }
      return realCreate(k, o)
    }
    const created = await withClock(0, () => createCloudflareBackup(env, 'manual'))
    env.ASSETS.createMultipartUpload = realCreate
    assert.strictEqual(created.status, 'copying', 'not finalized while a named object is gone')
    await withClock(0, () => drain(env))
    const done = await stateOf(env, created.name.replace(/\.json$/, ''))
    assert.strictEqual(done.status, 'finalized')
    for (const asset of done.assets) assert.ok(env.ASSETS._store.has(assetPoolKey(asset)))
  })
  console.log(`\n${passed} check(s) passed.`)
}
mainRaces().catch((e) => { console.log('FAIL', e.stack || e.message); process.exitCode = 1 })
