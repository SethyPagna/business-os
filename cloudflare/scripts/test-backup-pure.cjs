// Regression tests for src/lib/backup.ts (create / restore / prune), the
// gap flagged in progress.md ("No regression test exists for lib/backup.ts
// -- this project's test coverage has never included backup/restore").
//
// Same approach as the other *-pure.cjs scripts: transpile the REAL source
// (typescript package already in node_modules, no bundler needed) and call
// the actual exported functions -- not a re-implementation of the backup
// logic. backup.ts's only runtime dependency is ./r2 (copyObject/
// listObjects), which is itself pure enough to transpile for real too, so
// nothing backup-specific is stubbed out. What IS stubbed is the D1/R2/KV
// *bindings themselves* (env.DB/env.ASSETS/env.CACHE) -- there's no local
// D1/R2 to run against in this sandbox, so this test provides small
// in-memory fakes that implement exactly the query/operation shapes
// backup.ts actually issues (checked against the real source below), not a
// general SQL engine.
//
// Run: node scripts/test-backup-pure.cjs

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

const r2 = transpile('lib/r2.ts')
const r2ModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', r2.outputText)(
  r2ModuleObj.exports, require, r2ModuleObj, r2.sourcePath, path.dirname(r2.sourcePath),
)

const backup = transpile('lib/backup.ts')
const Module = require('module')
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './r2') return r2ModuleObj.exports // real module, actually exercised
  return originalLoad.call(this, request, parent, isMain)
}
const backupModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', backup.outputText)(
  backupModuleObj.exports, require, backupModuleObj, backup.sourcePath, path.dirname(backup.sourcePath),
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
  CLOUDFLARE_BACKUP_PREFIX,
} = backupModuleObj.exports

for (const fn of [createCloudflareBackup, restoreCloudflareBackup, pruneCloudflareBackups, listCloudflareBackups, validateCloudflareBackup, selectAssetsToCopy, continueCloudflareBackupAssetCopy]) {
  assert.strictEqual(typeof fn, 'function', 'expected backup.ts export missing -- source may have changed')
}

// ---------------------------------------------------------------------
// Fake D1 -- covers exactly the four query shapes backup.ts issues:
//   SELECT name FROM sqlite_master WHERE type = ? AND name = ?  (tableExists)
//   PRAGMA table_info("table")                                  (tableColumns)
//   SELECT * FROM "table"                                       (read all rows)
//   DELETE FROM "table"  /  INSERT INTO "table" (...) VALUES (...) (restore, via .batch)
// ---------------------------------------------------------------------
function makeFakeD1(schema) {
  // schema: { tableName: { columns: string[], rows: Record<string, unknown>[] } }
  function run(sql, values) {
    let m
    if ((m = sql.match(/^SELECT name FROM sqlite_master WHERE type = \? AND name = \?$/))) {
      const [, tableName] = values
      return { first: () => (schema[tableName] ? { name: tableName } : null) }
    }
    if ((m = sql.match(/^PRAGMA table_info\("([^"]+)"\)$/))) {
      const table = schema[m[1]]
      return { all: () => ({ results: table ? table.columns.map((name) => ({ name })) : [] }) }
    }
    if ((m = sql.match(/^SELECT \* FROM "([^"]+)"$/))) {
      const table = schema[m[1]]
      return { all: () => ({ results: table ? table.rows.slice() : [] }) }
    }
    if ((m = sql.match(/^DELETE FROM "([^"]+)"$/))) {
      const table = schema[m[1]]
      return { exec: () => { if (table) table.rows = [] } }
    }
    if ((m = sql.match(/^INSERT INTO "([^"]+)" \(([^)]+)\) VALUES \(([^)]+)\)$/))) {
      const [, tableName, colsRaw] = m
      const cols = colsRaw.split(', ').map((c) => c.replace(/^"|"$/g, ''))
      return {
        exec: () => {
          const table = schema[tableName]
          if (!table) return
          const row = {}
          cols.forEach((col, i) => { row[col] = values[i] })
          table.rows.push(row)
        },
      }
    }
    throw new Error(`fake D1: unrecognized query shape: ${sql}`)
  }

  return {
    prepare(sql) {
      return {
        bind(...values) {
          const bound = run(sql, values)
          return {
            all: async () => (bound.all ? bound.all() : { results: [] }),
            first: async () => (bound.first ? bound.first() : null),
            _exec: () => (bound.exec ? bound.exec() : undefined),
          }
        },
        // .all()/.first() called directly with no .bind() (tableExists/tableColumns/read-all all bind() first in real code, but PRAGMA/SELECT * calls in backup.ts do prepare(...).all() with no bind -- support that shape too)
        all: async () => run(sql, []).all ? run(sql, []).all() : { results: [] },
        first: async () => run(sql, []).first ? run(sql, []).first() : null,
      }
    },
    async batch(statements) {
      // Real D1's batch takes an array of already-bound statement objects
      // (env.DB.prepare(sql).bind(...values)); backup.ts's restore builds
      // exactly that shape. Execute sequentially, same effect as a batch.
      for (const statement of statements) statement._exec()
      return statements.map(() => ({ success: true }))
    },
  }
}

// ---------------------------------------------------------------------
// Fake R2 (env.ASSETS) -- in-memory key/value store covering get/put/
// delete/list(prefix,cursor,limit), matching what r2.ts's helpers and
// backup.ts itself call directly.
// ---------------------------------------------------------------------
function makeFakeR2(seed = {}) {
  const store = new Map()
  for (const [key, value] of Object.entries(seed)) {
    store.set(key, { body: value.body ?? key, httpMetadata: value.httpMetadata, size: value.size ?? String(value.body ?? key).length, uploaded: value.uploaded ?? new Date() })
  }
  return {
    _store: store,
    async get(key) {
      const object = store.get(key)
      if (!object) return null
      return {
        body: object.body,
        httpMetadata: object.httpMetadata,
        json: async () => JSON.parse(object.body),
      }
    },
    async put(key, data, opts) {
      store.set(key, { body: data, httpMetadata: opts?.httpMetadata, customMetadata: opts?.customMetadata, size: String(data ?? '').length, uploaded: new Date() })
    },
    async delete(key) {
      store.delete(key)
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const allKeys = [...store.keys()].filter((key) => key.startsWith(prefix)).sort()
      const start = cursor ? allKeys.indexOf(cursor) + 1 : 0
      const page = allKeys.slice(start, start + limit)
      const truncated = start + limit < allKeys.length
      return {
        objects: page.map((key) => ({ key, size: store.get(key).size, uploaded: store.get(key).uploaded })),
        truncated,
        cursor: truncated ? page[page.length - 1] : undefined,
      }
    },
  }
}

// ---------------------------------------------------------------------
// Fake KV (env.CACHE) -- covers the get/put/delete shape the asset-copy
// cursor (getAssetCopyCursor/setAssetCopyCursor) uses. storeSystemJob/
// getSystemJob also use env.CACHE elsewhere in backup.ts but aren't
// exercised by these tests, so list()/expirationTtl aren't needed here.
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
// captured message the way the real handleBackupQueue consumer would.
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

function makeEnv({ schema, assets, queue }) {
  const env = { DB: makeFakeD1(schema), ASSETS: makeFakeR2(assets), CACHE: makeFakeKV() }
  if (queue) env.BACKUP_QUEUE = queue
  return env
}

async function main() {
  // -- Test 1: create backs up table rows and, under the asset cap,
  // copies every asset's bytes (not just lists keys).
  await checkAsync('createCloudflareBackup backs up table rows and copies asset bytes under the cap', async () => {
    const schema = {
      settings: { columns: ['key', 'value'], rows: [{ key: 'business_name', value: 'Acme' }] },
      branches: { columns: ['id', 'name'], rows: [{ id: 1, name: 'Main' }, { id: 2, name: 'Annex' }] },
    }
    const assets = {
      'uploads/a.png': { body: 'A' },
      'uploads/b.png': { body: 'B' },
      'uploads/c.png': { body: 'C' },
    }
    const env = makeEnv({ schema, assets })
    const result = await createCloudflareBackup(env, 'manual')
    assert.strictEqual(result.summary.tableCount, 2)
    assert.strictEqual(result.summary.rowCount, 3)
    assert.strictEqual(result.summary.assetCount, 3)
    assert.strictEqual(result.summary.assetsBackedUp, 3, 'all 3 assets are under the 40-asset cap, all should be copied')
    assert.strictEqual(result.summary.assetsSkipped, 0)
    assert.ok(result.key.startsWith(CLOUDFLARE_BACKUP_PREFIX) && result.key.endsWith('.json'))

    const manifestObject = await env.ASSETS.get(result.key)
    const payload = JSON.parse(manifestObject.body)
    assert.deepStrictEqual(payload.tables.branches.rows, schema.branches.rows)
    assert.strictEqual(payload.r2.copiedKeys.length, 3)
    // Bytes were actually copied into the backup's own assets/ prefix, not
    // just listed -- read one back and confirm it round-trips.
    const copied = await env.ASSETS.get(`${payload.r2.assetsPrefix}a.png`)
    assert.strictEqual(copied.body, 'A')
  })

  // -- Test 2: the MAX_ASSET_BYTES_PER_BACKUP cap (40) is respected --
  // assets beyond it are listed in the manifest but not byte-copied.
  await checkAsync('createCloudflareBackup caps asset byte-copies at 40 and reports the skip count', async () => {
    const schema = { settings: { columns: ['key', 'value'], rows: [] } }
    const assets = {}
    for (let i = 0; i < 45; i++) assets[`uploads/img-${String(i).padStart(2, '0')}.png`] = { body: `img${i}` }
    const env = makeEnv({ schema, assets })
    const result = await createCloudflareBackup(env, 'manual')
    assert.strictEqual(result.summary.assetCount, 45)
    assert.strictEqual(result.summary.assetsBackedUp, 40, 'copy count should be capped at MAX_ASSET_BYTES_PER_BACKUP')
    assert.strictEqual(result.summary.assetsSkipped, 5)
  })

  // -- Test 2b: selectAssetsToCopy (the cursor-resume slicer, unit-tested
  // directly) picks the first N with no cursor, resumes right after the
  // cursor when one is set, and wraps back to the front of the list when
  // the tail doesn't have a full cap's worth left.
  check('selectAssetsToCopy picks the first N when there is no prior cursor', () => {
    const assets = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}` }))
    const picked = selectAssetsToCopy(assets, null, 4)
    assert.deepStrictEqual(picked.map((a) => a.key), ['k0', 'k1', 'k2', 'k3'])
  })
  check('selectAssetsToCopy resumes right after the persisted cursor', () => {
    const assets = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}` }))
    const picked = selectAssetsToCopy(assets, 'k3', 4)
    assert.deepStrictEqual(picked.map((a) => a.key), ['k4', 'k5', 'k6', 'k7'])
  })
  check('selectAssetsToCopy wraps around to the front once the tail runs short of a full cap', () => {
    const assets = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}` }))
    const picked = selectAssetsToCopy(assets, 'k7', 4) // only k8,k9 left in the tail
    assert.deepStrictEqual(picked.map((a) => a.key), ['k8', 'k9', 'k0', 'k1'])
  })
  check('selectAssetsToCopy falls back to the front if the cursor key no longer exists', () => {
    const assets = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}` }))
    const picked = selectAssetsToCopy(assets, 'no-longer-in-the-list', 4)
    assert.deepStrictEqual(picked.map((a) => a.key), ['k0', 'k1', 'k2', 'k3'])
  })

  // -- Test 2c: end-to-end through createCloudflareBackup -- consecutive
  // runs against the same env (same persisted KV cursor) make genuine
  // cumulative progress instead of every run re-copying the same first
  // 40, which is the actual gap this was closing.
  await checkAsync('createCloudflareBackup resumes asset copying across consecutive runs instead of repeating the same first 40', async () => {
    const schema = { settings: { columns: ['key', 'value'], rows: [] } }
    const assets = {}
    for (let i = 0; i < 50; i++) assets[`uploads/img-${String(i).padStart(2, '0')}.png`] = { body: `img${i}` }
    const env = makeEnv({ schema, assets })

    const first = await createCloudflareBackup(env, 'manual')
    assert.strictEqual(first.summary.assetsBackedUp, 40)
    const firstManifest = JSON.parse((await env.ASSETS.get(first.key)).body)

    const second = await createCloudflareBackup(env, 'manual')
    assert.strictEqual(second.summary.assetsBackedUp, 40)
    const secondManifest = JSON.parse((await env.ASSETS.get(second.key)).body)

    // The two runs' copied sets should differ (real progress was made),
    // and together they should cover every one of the 50 assets at least
    // once -- the actual guarantee this cursor exists to provide.
    const firstKeys = new Set(firstManifest.r2.copiedKeys)
    const secondKeys = new Set(secondManifest.r2.copiedKeys)
    assert.notDeepStrictEqual([...firstKeys].sort(), [...secondKeys].sort(), 'second run should not just repeat the first run\'s exact set')
    const union = new Set([...firstKeys, ...secondKeys])
    assert.strictEqual(union.size, 50, 'two runs together should cover all 50 assets at least once')
  })

  // -- Test 3: restore replaces live table contents with the backup's,
  // and restores whichever asset bytes were actually copied.
  await checkAsync('restoreCloudflareBackup replaces table rows and restores copied asset bytes', async () => {
    const backupSchema = {
      settings: { columns: ['key', 'value'], rows: [{ key: 'business_name', value: 'Acme' }] },
      branches: { columns: ['id', 'name'], rows: [{ id: 1, name: 'Main' }] },
    }
    const backupEnv = makeEnv({ schema: backupSchema, assets: { 'uploads/logo.png': { body: 'LOGO' } } })
    const created = await createCloudflareBackup(backupEnv, 'manual')

    // Simulate a live environment that has since diverged: different rows,
    // and the original asset bytes gone (as if re-uploaded/lost).
    const liveSchema = {
      settings: { columns: ['key', 'value'], rows: [{ key: 'business_name', value: 'SOMETHING ELSE' }] },
      branches: { columns: ['id', 'name'], rows: [{ id: 9, name: 'Stale Branch' }] },
    }
    const liveEnv = makeEnv({ schema: liveSchema, assets: {} })
    // Restore reads the manifest by key from ASSETS -- reuse backupEnv's
    // stored manifest+copied-asset bytes by copying them into liveEnv's
    // fake R2 store first (stands in for both backups sharing one real
    // bucket in production).
    for (const [key, value] of backupEnv.ASSETS._store) liveEnv.ASSETS._store.set(key, value)

    const restoreResult = await restoreCloudflareBackup(liveEnv, created.key)
    assert.strictEqual(restoreResult.tables, 2)
    assert.deepStrictEqual(liveSchema.settings.rows, [{ key: 'business_name', value: 'Acme' }])
    assert.deepStrictEqual(liveSchema.branches.rows, [{ id: 1, name: 'Main' }])
    assert.strictEqual(restoreResult.restoredAssets, 1)
    assert.strictEqual((await liveEnv.ASSETS.get('uploads/logo.png')).body, 'LOGO', 'asset bytes should be copied back to their original key')
  })

  // -- Test 4: restore only writes columns that exist in the CURRENT live
  // schema -- a backup taken before a column was dropped shouldn't fail or
  // try to insert into a column that's gone.
  await checkAsync('restoreCloudflareBackup drops backup columns no longer present in the live schema', async () => {
    const backupSchema = {
      settings: { columns: ['key', 'value', 'legacy_col'], rows: [{ key: 'x', value: 'y', legacy_col: 'gone' }] },
    }
    const backupEnv = makeEnv({ schema: backupSchema, assets: {} })
    const created = await createCloudflareBackup(backupEnv, 'manual')

    // Live schema has dropped legacy_col.
    const liveSchema = { settings: { columns: ['key', 'value'], rows: [] } }
    const liveEnv = makeEnv({ schema: liveSchema, assets: {} })
    for (const [key, value] of backupEnv.ASSETS._store) liveEnv.ASSETS._store.set(key, value)

    await restoreCloudflareBackup(liveEnv, created.key)
    assert.deepStrictEqual(liveSchema.settings.rows, [{ key: 'x', value: 'y' }], 'legacy_col should be silently dropped, not cause a failure')
  })

  // -- Test 5: prune keeps the newest N manifests and deletes the rest,
  // including each removed backup's own copied-asset subfolder (not just
  // its manifest .json).
  await checkAsync('pruneCloudflareBackups keeps the newest N and cleans up removed backups\' asset subfolders', async () => {
    const schema = { settings: { columns: ['key', 'value'], rows: [] } }
    const env = makeEnv({ schema, assets: { 'uploads/x.png': { body: 'X' } } })

    // backup.ts's manifest key includes a to-the-second timestamp
    // (stamp()), so four real-clock calls made back-to-back inside one
    // test would collide on the same key and silently overwrite each
    // other -- not a bug in backup.ts, just a resolution mismatch with a
    // synchronous test loop. Advance the clock by a full second between
    // each call so every backup gets a distinct key, same as it would in
    // production spread over real time.
    const RealDate = Date
    const baseMs = RealDate.now()
    let tick = 0
    class TickedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(baseMs + tick * 1000)
        else super(...args)
      }
      static now() { return baseMs + tick * 1000 }
    }
    global.Date = TickedDate
    const created = []
    try {
      for (let i = 0; i < 4; i++) {
        tick = i
        const result = await createCloudflareBackup(env, 'manual')
        created.push(result)
      }
    } finally {
      global.Date = RealDate
    }

    const before = await listCloudflareBackups(env)
    assert.strictEqual(before.length, 4)

    const { kept, removed } = await pruneCloudflareBackups(env, 2)
    assert.strictEqual(kept.length, 2)
    assert.strictEqual(removed.length, 2)
    // The two oldest (index 0 and 1 in creation order) should be the ones removed.
    const removedKeys = new Set(removed)
    assert.ok(removedKeys.has(created[0].key) && removedKeys.has(created[1].key))
    assert.ok(!removedKeys.has(created[2].key) && !removedKeys.has(created[3].key))

    const after = await listCloudflareBackups(env)
    assert.strictEqual(after.length, 2)

    // Each removed backup's assets/ subfolder should be gone too, not just its manifest.
    for (const result of [created[0], created[1]]) {
      const backupName = result.name.replace(/\.json$/, '')
      const assetsPrefix = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}/assets/`
      const remaining = [...env.ASSETS._store.keys()].filter((key) => key.startsWith(assetsPrefix))
      assert.strictEqual(remaining.length, 0, `removed backup ${backupName} should have no leftover copied-asset objects`)
    }
    // The two kept backups' copied assets should still be there.
    for (const result of [created[2], created[3]]) {
      const backupName = result.name.replace(/\.json$/, '')
      const assetsPrefix = `${CLOUDFLARE_BACKUP_PREFIX}${backupName}/assets/`
      const remaining = [...env.ASSETS._store.keys()].filter((key) => key.startsWith(assetsPrefix))
      assert.strictEqual(remaining.length, 1)
    }
  })

  // -- Test 6: validateCloudflareBackup reports format/summary without
  // touching D1 at all (dry-run/preview use case).
  await checkAsync('validateCloudflareBackup reports summary and restorable flag from the manifest alone', async () => {
    const schema = { settings: { columns: ['key', 'value'], rows: [{ key: 'a', value: 'b' }] } }
    const env = makeEnv({ schema, assets: { 'uploads/x.png': { body: 'X' } } })
    const created = await createCloudflareBackup(env, 'manual')
    const validation = await validateCloudflareBackup(env, created.key)
    assert.strictEqual(validation.restorable, true)
    assert.strictEqual(validation.tables, 1)
    assert.strictEqual(validation.assetsBackedUp, 1)
    assert.strictEqual(validation.assetCount, 1)
  })

  // -- Part 122, Test 7: with no BACKUP_QUEUE bound, createCloudflareBackup
  // takes exactly the pre-existing Part 48 rotating-cursor path -- no
  // assetCopyProgress field, no queue interaction, same summary shape as
  // every test above this point (which all ran with no queue).
  await checkAsync('createCloudflareBackup with no BACKUP_QUEUE bound is unchanged from the pre-Part-122 no-queue path', async () => {
    const schema = { settings: { columns: ['key', 'value'], rows: [] } }
    const assets = {}
    for (let i = 0; i < 45; i++) assets[`uploads/nq-${String(i).padStart(2, '0')}.png`] = { body: `img${i}` }
    const env = makeEnv({ schema, assets }) // no queue option -- env.BACKUP_QUEUE is undefined
    const result = await createCloudflareBackup(env, 'manual')
    assert.strictEqual(result.summary.assetsBackedUp, 40)
    assert.strictEqual(result.summary.assetsSkipped, 5)
    const payload = JSON.parse((await env.ASSETS.get(result.key)).body)
    assert.strictEqual(payload.r2.assetCopyProgress, undefined, 'no-queue path should not set assetCopyProgress at all')
  })

  // -- Part 122, Test 8: with BACKUP_QUEUE bound, a run under the cap
  // completes with no continuation enqueued; a run over the cap copies
  // exactly the first slice and enqueues exactly one correct continuation
  // message.
  await checkAsync('createCloudflareBackup with BACKUP_QUEUE bound enqueues a continuation message when assets exceed the cap', async () => {
    const schema = { settings: { columns: ['key', 'value'], rows: [] } }
    const assets = {}
    for (let i = 0; i < 55; i++) assets[`uploads/q-${String(i).padStart(2, '0')}.png`] = { body: `img${i}` }
    const queue = makeFakeQueue()
    const env = makeEnv({ schema, assets, queue })
    const result = await createCloudflareBackup(env, 'manual')
    assert.strictEqual(result.summary.assetsBackedUp, 40)
    assert.strictEqual(result.summary.assetsSkipped, 15)
    assert.strictEqual(queue.sent.length, 1, 'exactly one continuation message should be enqueued')
    assert.deepStrictEqual(queue.sent[0], { kind: 'backup-continue', backupName: result.name.replace(/\.json$/, ''), nextIndex: 40 })
    const payload = JSON.parse((await env.ASSETS.get(result.key)).body)
    assert.deepStrictEqual(payload.r2.assetCopyProgress, { nextIndex: 40, complete: false })

    // Under-the-cap run: no continuation should be enqueued at all.
    const smallAssets = { 'uploads/one.png': { body: 'X' } }
    const smallQueue = makeFakeQueue()
    const smallEnv = makeEnv({ schema, assets: smallAssets, queue: smallQueue })
    const smallResult = await createCloudflareBackup(smallEnv, 'manual')
    assert.strictEqual(smallQueue.sent.length, 0, 'a run that covers every asset in one pass should not enqueue a continuation')
    const smallPayload = JSON.parse((await smallEnv.ASSETS.get(smallResult.key)).body)
    assert.deepStrictEqual(smallPayload.r2.assetCopyProgress, { nextIndex: 1, complete: true })
  })

  // -- Part 122, Test 9: driving a 95-asset backup through repeated
  // continueCloudflareBackupAssetCopy calls the way the real
  // handleBackupQueue consumer would (reading each enqueued message and
  // calling the function again) reaches full coverage and stops
  // re-enqueueing once done -- the core claim this feature makes,
  // exercised end-to-end rather than just at the unit level.
  await checkAsync('continueCloudflareBackupAssetCopy driven through a real message loop reaches 100% coverage and stops re-enqueueing', async () => {
    const schema = { settings: { columns: ['key', 'value'], rows: [] } }
    const assets = {}
    for (let i = 0; i < 95; i++) assets[`uploads/big-${String(i).padStart(3, '0')}.png`] = { body: `img${i}` }
    const queue = makeFakeQueue()
    const env = makeEnv({ schema, assets, queue })

    const created = await createCloudflareBackup(env, 'manual')
    const backupName = created.name.replace(/\.json$/, '')

    // Drive the queue the way the real consumer would: pop each enqueued
    // message and call continueCloudflareBackupAssetCopy for it, which
    // may itself enqueue further messages, until the queue drains.
    let iterations = 0
    while (queue.sent.length) {
      const message = queue.sent.shift()
      assert.strictEqual(message.kind, 'backup-continue')
      assert.strictEqual(message.backupName, backupName)
      await continueCloudflareBackupAssetCopy(env, message.backupName, message.nextIndex)
      iterations += 1
      assert.ok(iterations < 20, 'should not take anywhere near this many continuation steps for 95 assets at 40/step')
    }

    const finalPayload = JSON.parse((await env.ASSETS.get(created.key)).body)
    assert.strictEqual(finalPayload.summary.assetsBackedUp, 95, 'all 95 assets should be copied across the full run')
    assert.strictEqual(finalPayload.summary.assetsSkipped, 0)
    assert.deepStrictEqual(finalPayload.r2.assetCopyProgress, { nextIndex: 95, complete: true })
    assert.strictEqual(new Set(finalPayload.r2.copiedKeys).size, 95, 'no duplicate copies, every asset covered exactly once')
    // Every asset's bytes should be genuinely readable back from the
    // backup's own assets/ prefix, not just listed in copiedKeys.
    const sample = await env.ASSETS.get(`${finalPayload.r2.assetsPrefix}big-094.png`)
    assert.strictEqual(sample.body, 'img94')
  })

  // -- Part 122, Test 10: a redundant continuation call against an
  // already-complete backup (a duplicate queue delivery, or a stray
  // message that raced a later one) is a safe no-op -- no re-copy, no
  // re-enqueue, manifest unchanged.
  await checkAsync('continueCloudflareBackupAssetCopy on an already-complete backup is a safe no-op', async () => {
    const schema = { settings: { columns: ['key', 'value'], rows: [] } }
    const assets = { 'uploads/only.png': { body: 'ONLY' } }
    const queue = makeFakeQueue()
    const env = makeEnv({ schema, assets, queue })
    const created = await createCloudflareBackup(env, 'manual')
    assert.strictEqual(queue.sent.length, 0, 'single-asset backup should already be complete after the initial run')

    const before = JSON.parse((await env.ASSETS.get(created.key)).body)
    assert.strictEqual(before.r2.assetCopyProgress.complete, true)

    const result = await continueCloudflareBackupAssetCopy(env, created.name.replace(/\.json$/, ''), before.r2.assetCopyProgress.nextIndex)
    assert.strictEqual(result.skipped, true)
    assert.strictEqual(result.reason, 'already-complete')
    assert.strictEqual(queue.sent.length, 0, 'no continuation should be enqueued for an already-complete backup')

    const after = JSON.parse((await env.ASSETS.get(created.key)).body)
    assert.deepStrictEqual(after, before, 'manifest should be byte-for-byte unchanged by the no-op')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exitCode = 1
})
