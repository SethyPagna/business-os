// Real-SQLite (node:sqlite via the shared harness) test of the K4 Phase-1
// import-artifact retention slice -- lib/importRetention.ts run as the REAL
// transpiled source (not a reimplementation) against the REAL migration
// chain (through 0085_import_job_details_pruned), plus the chunked R2 bulk
// delete helper (lib/r2.ts's deleteObjectsBulk) with a fake bucket, and
// source-locks proving the routes/scheduled chain actually use all of it.
//
// The policy under test is the locked execution plan's: detailed import
// artifacts (source/result rows, errors, chunk bookkeeping, signatures,
// image plans, grouping state, unlinked raw files in R2) live 24 hours
// after a job reaches a terminal status; the compact summary (the
// import_jobs row + idempotency ledgers + file-name rows) lives 7 days.
// awaiting_review and in-flight jobs are never touched. import_auto_merges
// is product-keyed merge EVIDENCE and must survive everything.
//
// Run: node scripts/test-import-retention-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')
const { openDb } = require('./harness/d1compat.cjs')

// --- load real TS modules with a controlled require shim -------------------

function transpile(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim, module)
  return module.exports
}

// lib/r2.ts has no runtime imports -- loaded for REAL so deleteObjectsBulk's
// chunking is the actual code under test.
const r2 = loadModule('lib/r2.ts', (id) => {
  throw new Error(`unexpected import in r2.ts: ${id}`)
})

const auditEvents = []
let currentDb = null
const retention = loadModule('lib/importRetention.ts', (id) => {
  if (id === './db') return { getDb: () => currentDb }
  if (id === './audit') return { audit: async (_env, _uid, _uname, action, _entity, _entityId, details) => { auditEvents.push({ action, details }) } }
  if (id === './r2') return r2
  return require(id)
})

const migrationSqls = loadAll()

function makeBucket() {
  return {
    calls: [],
    deletedKeys: [],
    async delete(keys) {
      const arr = Array.isArray(keys) ? keys : [keys]
      this.calls.push(arr)
      this.deletedKeys.push(...arr)
    },
  }
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// Same rendering the lib uses: SQLite CURRENT_TIMESTAMP format, UTC.
function agoTs(ms) {
  return new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' ')
}

function seedJob(db, id, status, finishedAgoMs) {
  const t = agoTs(finishedAgoMs)
  db.prepare(`
    INSERT INTO import_jobs (id, type, status, phase, finished_at, created_at, updated_at, chunk_state_json, materialize_state_json, summary_json)
    VALUES (@id, 'products', @status, @status, @finished, @t, @t, '{"cursor":42}', '{"rows":9}', '{"created":1}')
  `).run({ id, status, finished: status === 'cancelled' ? null : t, t })
}

function seedDetail(db, id) {
  db.prepare(`INSERT INTO import_job_rows (job_id, phase, row_number, action, identifier, result_json) VALUES (@id, 'analyze', 1, 'create', 'x', '{"big":"payload"}')`).run({ id })
  db.prepare(`INSERT INTO import_job_source_rows (job_id, sequence, row_number, data_json) VALUES (@id, 0, 1, '{"name":"row"}')`).run({ id })
  db.prepare(`INSERT INTO import_job_errors (job_id, row_number, message) VALUES (@id, 1, 'boom')`).run({ id })
  db.prepare(`INSERT INTO import_job_batches (job_id, batch_index) VALUES (@id, 0)`).run({ id })
  db.prepare(`INSERT INTO import_job_row_signatures (job_id, signature, row_number) VALUES (@id, 'sig', 1)`).run({ id })
  db.prepare(`INSERT INTO import_job_image_matches (job_id, row_number, image_path) VALUES (@id, 1, 'uploads/x.jpg')`).run({ id })
  db.prepare(`INSERT INTO import_job_image_renames (job_id, file_id, new_name) VALUES (@id, 'f1', 'x_1.jpg')`).run({ id })
  db.prepare(`INSERT INTO import_stock_action_groups (job_id, group_key, group_index) VALUES (@id, 'g', 0)`).run({ id })
  db.prepare(`INSERT INTO import_sales_commits (job_id, group_key, row_number) VALUES (@id, 'g', 1)`).run({ id })
  db.prepare(`INSERT INTO import_stock_action_commits (job_id, action_key, action_kind) VALUES (@id, 'a', 'add')`).run({ id })
  db.prepare(`INSERT INTO import_stock_action_guards (job_id, action_key, guard_key, guard_value) VALUES (@id, 'a', 'k', 1)`).run({ id })
  db.prepare(`INSERT INTO import_job_files (job_id, kind, stored_path, file_asset_id) VALUES (@id, 'csv', 'imports/' || @id || '/raw.csv', NULL)`).run({ id })
  db.prepare(`INSERT INTO import_job_files (job_id, kind, stored_path, file_asset_id) VALUES (@id, 'csv', 'uploads/library-copy-' || @id || '.csv', 7)`).run({ id })
}

function count(db, table, id) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE job_id = @id`).get({ id }).n
}

const DETAIL_TABLES = ['import_job_rows', 'import_job_source_rows', 'import_job_errors', 'import_job_batches', 'import_job_row_signatures', 'import_job_image_matches', 'import_job_image_renames', 'import_stock_action_groups']
const SUMMARY_TABLES = ['import_sales_commits', 'import_stock_action_commits', 'import_stock_action_guards', 'import_job_files']

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  await check('0085 column exists on the real chain', async () => {
    const db = openDb(migrationSqls)
    const cols = db.prepare(`SELECT name FROM pragma_table_info('import_jobs')`).all({}).map((r) => r.name)
    assert.ok(cols.includes('details_pruned_at'), 'import_jobs.details_pruned_at missing')
  })

  await check('detail purge: >24h terminal job loses bulk detail, keeps summary + ledgers; only unlinked R2 key deleted', async () => {
    const db = openDb(migrationSqls)
    currentDb = db
    auditEvents.length = 0
    const bucket = makeBucket()
    seedJob(db, 'old-done', 'completed', 2 * DAY)
    seedDetail(db, 'old-done')
    seedJob(db, 'fresh-done', 'completed', 1 * HOUR)
    seedDetail(db, 'fresh-done')
    seedJob(db, 'review-old', 'awaiting_review', 10 * DAY)
    seedDetail(db, 'review-old')

    const result = await retention.maybeRunScheduledImportRetention({ ASSETS: bucket })
    assert.strictEqual(result.skipped, false)
    assert.strictEqual(result.detailPruned, 1, `expected exactly old-done pruned, got ${result.detailPruned}`)
    assert.strictEqual(result.summaryDeleted, 0, 'nothing is 7d old with a terminal status')

    for (const table of DETAIL_TABLES) {
      assert.strictEqual(count(db, table, 'old-done'), 0, `${table} not purged for old-done`)
      assert.ok(count(db, table, 'fresh-done') > 0, `${table} wrongly purged for fresh-done`)
      assert.ok(count(db, table, 'review-old') > 0, `${table} wrongly purged for awaiting_review`)
    }
    for (const table of SUMMARY_TABLES) {
      assert.ok(count(db, table, 'old-done') > 0, `${table} must survive the 24h tier`)
    }
    const job = db.prepare(`SELECT details_pruned_at, chunk_state_json, materialize_state_json, summary_json FROM import_jobs WHERE id = 'old-done'`).get({})
    assert.ok(job, 'summary row must survive the 24h tier')
    assert.ok(job.details_pruned_at, 'details_pruned_at not stamped')
    assert.strictEqual(job.chunk_state_json, null, 'chunk_state_json not cleared')
    assert.strictEqual(job.materialize_state_json, null, 'materialize_state_json not cleared')
    assert.strictEqual(job.summary_json, '{"created":1}', 'summary_json must be untouched')
    assert.deepStrictEqual(bucket.deletedKeys, ['imports/old-done/raw.csv'], 'only the UNLINKED raw file may be deleted')
    assert.strictEqual(auditEvents.length, 1)
    assert.strictEqual(auditEvents[0].action, 'import_retention_auto_clean')
  })

  await check('throttle: an immediate second run skips as ran-recently', async () => {
    // currentDb still holds the previous scenario's settings marker.
    const bucket = makeBucket()
    const result = await retention.maybeRunScheduledImportRetention({ ASSETS: bucket })
    assert.strictEqual(result.skipped, true)
    assert.strictEqual(result.reason, 'ran-recently')
    assert.strictEqual(bucket.deletedKeys.length, 0)
  })

  await check('summary purge: >7d terminal job fully deleted (cancelled without finished_at included); auto-merge evidence survives', async () => {
    const db = openDb(migrationSqls)
    currentDb = db
    auditEvents.length = 0
    const bucket = makeBucket()
    seedJob(db, 'ancient', 'completed', 10 * DAY)
    seedDetail(db, 'ancient')
    // cancelled via the tracker's /cancel path: finished_at stays NULL, the
    // sweep must fall back to updated_at (COALESCE) or this job lives forever.
    seedJob(db, 'ancient-cancelled', 'cancelled', 9 * DAY)
    seedDetail(db, 'ancient-cancelled')
    db.prepare(`INSERT INTO import_auto_merges (product_id, import_job_id, row_number, losing_json) VALUES (1, 999, 3, '{"name":"loser"}')`).run({})

    const result = await retention.maybeRunScheduledImportRetention({ ASSETS: bucket })
    assert.strictEqual(result.skipped, false)
    assert.strictEqual(result.summaryDeleted, 2, `expected both ancient jobs deleted, got ${result.summaryDeleted}`)
    for (const id of ['ancient', 'ancient-cancelled']) {
      for (const table of [...DETAIL_TABLES, ...SUMMARY_TABLES]) {
        assert.strictEqual(count(db, table, id), 0, `${table} left rows for ${id}`)
      }
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM import_jobs WHERE id = @id`).get({ id }).n, 0, `import_jobs row left for ${id}`)
    }
    assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM import_auto_merges`).get({}).n, 1, 'merge evidence must never be touched')
    assert.ok(bucket.deletedKeys.includes('imports/ancient/raw.csv'))
    assert.ok(!bucket.deletedKeys.some((k) => k.startsWith('uploads/library-copy-')), 'Library-linked files must never be deleted')
  })

  await check('settings override: import_detail_retention_hours=1 prunes a 2h-old job', async () => {
    const db = openDb(migrationSqls)
    currentDb = db
    auditEvents.length = 0
    const bucket = makeBucket()
    db.prepare(`INSERT INTO settings (key, value) VALUES ('import_detail_retention_hours', '1')`).run({})
    seedJob(db, 'two-hours', 'failed', 2 * HOUR)
    seedDetail(db, 'two-hours')
    const result = await retention.maybeRunScheduledImportRetention({ ASSETS: bucket })
    assert.strictEqual(result.detailPruned, 1)
    assert.strictEqual(result.detailHours, 1)
    assert.strictEqual(count(db, 'import_job_source_rows', 'two-hours'), 0)
  })

  await check('orphan cleanup: dry-run reports without deleting; apply deletes orphans only', async () => {
    const db = openDb(migrationSqls)
    currentDb = db
    const bucket = makeBucket()
    seedJob(db, 'live', 'completed', 1 * HOUR)
    seedDetail(db, 'live')
    // Orphans: job-scoped rows whose import_jobs row is gone.
    seedDetail(db, 'ghost')

    const dry = await retention.cleanOrphanImportStaging({ ASSETS: bucket }, { apply: false })
    assert.strictEqual(dry.applied, false)
    assert.strictEqual(dry.tables.import_job_source_rows, 1)
    assert.strictEqual(dry.tables.import_job_files, 2)
    assert.strictEqual(dry.r2Keys, 1, 'only the unlinked ghost file is an orphan R2 key')
    assert.strictEqual(count(db, 'import_job_rows', 'ghost'), 1, 'dry-run must not delete')
    assert.strictEqual(bucket.deletedKeys.length, 0, 'dry-run must not touch R2')

    const applied = await retention.cleanOrphanImportStaging({ ASSETS: bucket }, { apply: true })
    assert.strictEqual(applied.applied, true)
    for (const table of [...DETAIL_TABLES, ...SUMMARY_TABLES]) {
      assert.strictEqual(count(db, table, 'ghost'), 0, `${table} orphans not deleted`)
      assert.ok(count(db, table, 'live') > 0, `${table} live rows wrongly deleted`)
    }
    assert.deepStrictEqual(bucket.deletedKeys, ['imports/ghost/raw.csv'])
  })

  await check('deleteObjectsBulk: 1000-key chunks, a failing chunk is reported while the rest proceed', async () => {
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`)
    const calls = []
    let failNext = false
    const bucket = {
      async delete(chunk) {
        calls.push(chunk.length)
        if (failNext && calls.length === 2) throw new Error('chunk down')
      },
    }
    const ok = await r2.deleteObjectsBulk(bucket, keys)
    assert.deepStrictEqual(calls, [1000, 1000, 500])
    assert.strictEqual(ok.deleted, 2500)
    assert.strictEqual(ok.errors.length, 0)

    calls.length = 0
    failNext = true
    const partial = await r2.deleteObjectsBulk(bucket, keys)
    assert.deepStrictEqual(calls, [1000, 1000, 500], 'every chunk must still be attempted')
    assert.strictEqual(partial.deleted, 1500)
    assert.strictEqual(partial.errors.length, 1)
    assert.ok(partial.errors[0].includes('chunk down'))
  })

  await check('source-lock: routes + scheduled chain actually use this slice', async () => {
    const importJobsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'importJobs.ts'), 'utf8')
    assert.ok(importJobsSrc.includes('importJobFullDeleteStatements(id)'), 'deleteJobData must run the shared delete list')
    assert.ok(!/DELETE FROM import_job_rows/.test(importJobsSrc), 'no inline per-job delete list may remain in the route')
    assert.ok(importJobsSrc.includes('import_details_pruned'), 'retry must refuse a pruned job with the explicit code')
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8')
    assert.ok(indexSrc.includes('maybeRunScheduledImportRetention(env)'), 'scheduled chain must run the retention sweep')
    const systemSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'system.ts'), 'utf8')
    assert.ok(!systemSrc.includes('Promise.all(objects.map'), 'the unbounded per-object R2 sweeps must be gone')
    assert.ok(systemSrc.includes('deleteObjectsBulk'), 'system.ts sweeps must use the chunked bulk delete')
    assert.ok(systemSrc.includes('cleanOrphanImportStaging'), 'orphan cleanup endpoint must exist')
  })

  console.log(`\nAll ${passed} checks passed.`)
}

main().catch((error) => {
  console.error('FAIL', error && error.stack ? error.stack : error)
  process.exit(1)
})
