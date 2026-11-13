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

async function mainPool() {
  const N = 250

  await checkAsync('7 nights with no image changes store ONE copy of each asset', async () => {
    const env = makeEnv(imageSet(N), { pageLimit: 100 }) // list pagination really paginates
    const nights = []
    for (let day = 0; day < 7; day++) nights.push(await night(env, day))
    assert.strictEqual(poolKeys(env).length, N, 'one pooled object per asset after seven nights')
    assert.strictEqual(poolPuts(nights[0].ops).length, N, 'night 1 copies every asset once')
    for (const later of nights.slice(1)) {
      assert.strictEqual(poolPuts(later.ops).length, 0, 'an unchanged night copies nothing')
      assert.strictEqual(later.ops.gets.filter((key) => key.startsWith('uploads/')).length, 0, 'an unchanged asset is not even read')
      assert.ok(!later.ops.puts.some((key) => key.includes('/assets/')), 'no per-backup asset folder any more')
    }
    for (const n of nights) assert.strictEqual((await stateOf(env, n.name)).status, 'finalized')
    assert.strictEqual((await listCloudflareBackups(env)).length, 7)
    const state = await stateOf(env, nights[6].name)
    assert.strictEqual(state.assetLayout, 'pool-v1')
    for (const asset of state.assets) assert.ok(env.ASSETS._store.has(assetPoolKey(asset)))
    console.log(`  ops per night for ${N} assets (class A/B): night 1 ${nights[0].ops.classA}/${nights[0].ops.classB}, nights 2-7 ${nights[1].ops.classA}/${nights[1].ops.classB}`)
  })

  await checkAsync('a changed image keeps old and new versions while both are referenced; each backup restores its own bytes', async () => {
    const env = makeEnv(imageSet(5))
    await night(env, 0)
    const n1 = await night(env, 1)
    env.ASSETS._set('uploads/img-0002.png', Buffer.from(png(999)), IMG)
    const n2 = await night(env, 2)
    assert.strictEqual(poolPuts(n2.ops).length, 1, 'only the changed image is copied')
    assert.strictEqual(poolKeys(env).length, 6, 'old and new version of the changed image both held')
    const oldEntry = (await stateOf(env, n1.name)).assets.find((a) => a.key === 'uploads/img-0002.png')
    const newEntry = (await stateOf(env, n2.name)).assets.find((a) => a.key === 'uploads/img-0002.png')
    assert.notStrictEqual(assetPoolKey(oldEntry), assetPoolKey(newEntry))
    env.ASSETS._set('uploads/img-0002.png', Buffer.from('live-garbage'))
    const result = await restoreOwned(env, n1.name + '.json')
    assert.strictEqual(result.restoredAssets, 5)
    assert.ok(Buffer.compare(bytesOf(env, 'uploads/img-0002.png'), Buffer.from(png(2))) === 0, 'the older backup holds the original bytes')
    await restoreOwned(env, n2.name + '.json')
    assert.ok(Buffer.compare(bytesOf(env, 'uploads/img-0002.png'), Buffer.from(png(999))) === 0)
  })

  await checkAsync('pruning the oldest backup removes only assets no other backup references', async () => {
    const env = makeEnv(imageSet(4))
    const first = await night(env, 0)
    env.ASSETS._set('uploads/img-0001.png', Buffer.from(png(500)), IMG) // only the first backup references the original
    const names = [first.name]
    for (let day = 1; day <= 7; day++) names.push((await night(env, day)).name)
    const left = (await listCloudflareBackups(env)).map((b) => b.name.replace(/\.json$/, ''))
    assert.ok(!left.includes(names[0]) && left.length === 7, 'eight nights, keep 7: the first is evicted')
    const keys = poolKeys(env)
    assert.strictEqual(keys.length, 4, 'the original img-0001 is gone; the 3 unchanged assets and the new img-0001 remain')
    assert.deepStrictEqual(keys, (await stateOf(env, names[7])).assets.map(assetPoolKey).sort())
    assert.strictEqual([...env.ASSETS._store.keys()].filter((k) => k.startsWith('uploads/')).length, 4, 'live uploads untouched')
  })

  await checkAsync('a backup in progress pins what it references even when its older owner is evicted', async () => {
    const env = makeEnv(imageSet(300))
    const n0 = await night(env, 0, 'manual')
    for (let i = 0; i < 150; i++) env.ASSETS._set(`uploads/img-${String(i).padStart(4, '0')}.png`, Buffer.from(png(7000 + i)), IMG) // > one slice of new copies
    const started = await withClock(1, () => createCloudflareBackup(env, 'manual'))
    const inflight = await stateOf(env, started.name.replace(/\.json$/, ''))
    assert.strictEqual(inflight.status, 'copying', 'second set has not been drained')
    await pruneCloudflareBackups(env, 0) // keep no finalized manual backup: night 0 is evicted
    assert.ok(!env.ASSETS._store.has(`${CLOUDFLARE_BACKUP_PREFIX}${n0.name}.json`), 'night 0 really was evicted')
    for (const asset of inflight.assets) {
      if (Number(asset.key.slice(-8, -4)) < 150) continue // new versions still pending in the queue
      assert.ok(env.ASSETS._store.has(assetPoolKey(asset)), `pinned by the in-progress set: ${asset.key}`)
    }
    await drain(env) // the in-progress set can still finish and restore
    assert.strictEqual((await stateOf(env, started.name.replace(/\.json$/, ''))).status, 'finalized')
  })

  await checkAsync('a manifest-less folder (create mid-copy) pins; a managed backup without a sidecar stops the sweep', async () => {
    const env = makeEnv(imageSet(3))
    await night(env, 0)
    const n1 = await night(env, 1)
    await env.ASSETS.delete(`${CLOUDFLARE_BACKUP_PREFIX}${n1.name}.json`) // sidecar exists, manifest not (yet) written
    await pruneCloudflareBackups(env, 0, 0)
    assert.strictEqual(poolKeys(env).length, 3, 'the sidecar of the set being written still pins the pooled versions')

    const env2 = makeEnv(imageSet(3))
    await night(env2, 0)
    const b = await night(env2, 1)
    env2.ASSETS._set('uploads/img-0000.png', Buffer.from(png(1)), IMG)
    await night(env2, 2)
    await env2.ASSETS.delete(`${CLOUDFLARE_BACKUP_PREFIX}${b.name}/state.json`)
    const result = await pruneCloudflareBackups(env2, 0, 0)
    assert.strictEqual(result.poolSweepSkipped, 'sidecar-missing')
    assert.ok(poolKeys(env2).length >= 3, 'the sweep refused to guess')
  })

  await checkAsync('restore of an OLD-format backup (per-backup assets folder) still works; retention prunes its folder; the pool is untouched', async () => {
    const env = makeEnv(imageSet(2))
    const a = await night(env, 0, 'manual')
    const manifestKey = `${CLOUDFLARE_BACKUP_PREFIX}${a.name}.json`
    const folder = `${CLOUDFLARE_BACKUP_PREFIX}${a.name}/`
    const manifest = JSON.parse(env.ASSETS._text(manifestKey))
    manifest.r2.assetsPrefix = `${folder}assets/`
    delete manifest.r2.assetLayout
    env.ASSETS._set(manifestKey, JSON.stringify(manifest), { customMetadata: { format: 'business-os-cloudflare-backup', lifecycle: 'sidecar-v1', source: 'manual', scope: 'full' } })
    const legacy = JSON.parse(env.ASSETS._text(`${folder}state.json`))
    legacy.assetsPrefix = `${folder}assets/`
    delete legacy.assetLayout
    env.ASSETS._set(`${folder}state.json`, JSON.stringify(legacy), { customMetadata: { format: 'business-os-cloudflare-backup-state', status: 'finalized' } })
    legacy.assets.forEach((asset, i) => env.ASSETS._set(`${folder}assets/${asset.key.replace(/^uploads\//, '')}`, Buffer.from(png(i)), IMG))
    for (const key of poolKeys(env)) await env.ASSETS.delete(key) // a legacy set never had a pool
    env.ASSETS._set('uploads/img-0000.png', Buffer.from('damaged'))
    const result = await restoreOwned(env, a.name + '.json')
    assert.strictEqual(result.restoredAssets, 2)
    assert.ok(Buffer.compare(bytesOf(env, 'uploads/img-0000.png'), Buffer.from(png(0))) === 0)
    const prune = await pruneCloudflareBackups(env, 0)
    assert.strictEqual(prune.removed.length, 1)
    assert.strictEqual([...env.ASSETS._store.keys()].filter((k) => k.startsWith(folder)).length, 0)
    assert.strictEqual(prune.poolRemoved, 0)
  })

  await checkAsync('the sweep only deletes inside the pool and never touches uploads/ or other prefixes', async () => {
    const env = makeEnv(imageSet(3))
    env.ASSETS._set('backups/other/keep.bin', 'x')
    env.ASSETS._set('private/portal-submissions/s.png', Buffer.from(png(3)))
    await night(env, 0)
    await night(env, 1)
    await withClock(3, () => pruneCloudflareBackups(env, 0, 0)) // the pool grace (24 h) has passed for every object
    assert.ok(env.ASSETS._store.has('backups/other/keep.bin'))
    assert.ok(env.ASSETS._store.has('private/portal-submissions/s.png'))
    assert.strictEqual([...env.ASSETS._store.keys()].filter((k) => k.startsWith('uploads/')).length, 3)
    assert.strictEqual(poolKeys(env).length, 0, 'with no backup left the pool is empty')
  })

  console.log(`\n${passed} check(s) passed.`)
}
mainPool().catch((e) => { console.log('FAIL', e.stack || e.message); process.exitCode = 1 })
