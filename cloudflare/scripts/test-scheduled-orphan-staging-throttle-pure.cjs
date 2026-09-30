// READS-CUT (7): the 6-hourly cron used to run cleanOrphanImportStaging with
// apply:true on EVERY tick -- ten NOT IN COUNTs, ten NOT IN DELETEs and two
// GROUP BYs over the staging tables, all full scans, four times a day, to find
// rows that only appear when a job is deleted mid-flight. The scheduler now
// goes through maybeRunScheduledOrphanStagingCleanup, which stamps a settings
// key and runs the sweep at most once per ~day.
//
// Real lib/importRetention.ts and the real scheduler module run against the
// real migration chain in SQLite; a counting wrapper meters D1 statements.
// node:sqlite has no rows_read meta, so scanned rows are the EXPLAIN QUERY PLAN
// model (each SCAN counted as the whole table) -- labelled as a model below.
//
// Run: node scripts/test-scheduled-orphan-staging-throttle-pure.cjs
'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { countingDb } = require('./harness/counting_d1.cjs')

function loadModule(relPath, requireShim) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', out)(module.exports, requireShim, module)
  return module.exports
}

const migrationSqls = loadAll()
const HOUR = 60 * 60 * 1000
let currentDb = null

const noImports = (id) => { throw new Error(`unexpected import ${id}`) }
const r2 = loadModule('lib/r2.ts', noImports)
const planTier = loadModule('lib/planTier.ts', noImports)
const retention = loadModule('lib/importRetention.ts', (id) => {
  if (id === './db') return { getDb: () => currentDb }
  if (id === './audit') return { audit: async () => {} }
  if (id === './r2') return r2
  if (id === './planTier') return planTier
  return require(id)
})

let cleanupOverride = null
const sweepPath = path.join(__dirname, '..', 'src', 'lib', 'orphanStagingSweep.ts')
assert.ok(fs.existsSync(sweepPath), 'lib/orphanStagingSweep.ts must exist')
const sweep = loadModule('lib/orphanStagingSweep.ts', (id) => {
  if (id === './db') return { getDb: () => currentDb }
  if (id === './importRetention') return { cleanOrphanImportStaging: (env, options) => (cleanupOverride || retention.cleanOrphanImportStaging)(env, options) }
  return require(id)
})

const bucket = { async delete() {} }
const env = { ASSETS: bucket }

function seed(raw) {
  raw.prepare(`INSERT INTO import_jobs (id, type, status, phase) VALUES ('live', 'products', 'completed', 'completed')`).run({})
  for (const job of ['live', 'ghost']) {
    raw.prepare(`INSERT INTO import_job_errors (job_id, row_number, message) VALUES (@job, 1, 'x')`).run({ job })
    raw.prepare(`INSERT INTO import_job_rows (job_id, phase, row_number, action, identifier, result_json) VALUES (@job, 'analyze', 1, 'create', 'x', '{}')`).run({ job })
    raw.prepare(`INSERT INTO import_job_source_rows (job_id, sequence, row_number, data_json) VALUES (@job, 0, 1, '{}')`).run({ job })
  }
}
const countWhere = (raw, table, job) => raw.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE job_id = '${job}'`).get().n
const ghostRows = (raw) => ['import_job_errors', 'import_job_rows', 'import_job_source_rows']
  .reduce((n, table) => n + countWhere(raw, table, 'ghost'), 0)

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

function fixture() {
  const raw = openDb(migrationSqls)
  seed(raw)
  const counted = countingDb(raw)
  currentDb = counted.db
  cleanupOverride = null
  return { raw, counted }
}

async function main() {
  // One unthrottled sweep = what every cron tick used to spend.
  let perSweep
  await check('baseline: one orphan sweep costs many statements and full scans', async () => {
    const { raw, counted } = fixture()
    await retention.cleanOrphanImportStaging(env, { apply: true })
    const scanRows = counted.stats.log.reduce((sum, sql) => sum + counted.scanModelRows(sql.replace(/@\w+/g, 'NULL')), 0)
    perSweep = { statements: counted.stats.statements, scanRows }
    assert.ok(perSweep.statements >= 14, `expected >=14 statements, got ${perSweep.statements}`)
    assert.strictEqual(ghostRows(raw), 0, 'orphans are deleted')
    assert.ok(counted.stats.log.some((sql) => /NOT IN \(SELECT id FROM import_jobs\)/.test(sql)), 'the NOT IN scans are what this lane throttles')
  })

  await check('first tick with no stamp runs the sweep and stamps the run', async () => {
    const { raw, counted } = fixture()
    const now = Date.parse('2026-10-01T00:00:00Z')
    const result = await sweep.maybeRunScheduledOrphanStagingCleanup(env, now)
    assert.strictEqual(result.skipped, false)
    assert.strictEqual(ghostRows(raw), 0, 'orphans still cleaned')
    assert.strictEqual(countWhere(raw, 'import_job_errors', 'live'), 1, 'live job untouched')
    const stamp = raw.db.prepare(`SELECT value FROM settings WHERE key = 'orphan_staging_last_run'`).get()
    assert.strictEqual(new Date(stamp.value).getTime(), now)
    assert.strictEqual(counted.stats.statements, perSweep.statements + 2, 'stamp read + sweep + stamp write')
  })

  await check('ticks inside the interval cost one statement and touch nothing', async () => {
    const { raw, counted } = fixture()
    const t0 = Date.parse('2026-10-01T00:00:00Z')
    await sweep.maybeRunScheduledOrphanStagingCleanup(env, t0)
    raw.prepare(`INSERT INTO import_job_errors (job_id, row_number, message) VALUES ('ghost2', 1, 'late orphan')`).run({})
    counted.reset()
    for (const hours of [6, 12, 18]) {
      const result = await sweep.maybeRunScheduledOrphanStagingCleanup(env, t0 + hours * HOUR)
      assert.deepStrictEqual(result, { skipped: true, reason: 'ran-recently' }, `tick +${hours}h`)
    }
    assert.strictEqual(counted.stats.statements, 3, 'one settings read per skipped tick')
    assert.ok(counted.stats.log.every((sql) => /FROM settings/.test(sql)), 'only the stamp is read')
    assert.strictEqual(countWhere(raw, 'import_job_errors', 'ghost2'), 1, 'not swept yet')
    const due = await sweep.maybeRunScheduledOrphanStagingCleanup(env, t0 + 24 * HOUR)
    assert.strictEqual(due.skipped, false, 'the fourth tick is due again')
    assert.strictEqual(countWhere(raw, 'import_job_errors', 'ghost2'), 0, 'swept when due')
  })

  await check('a day of ticks: statements and modelled scan rows drop to a quarter', async () => {
    const { counted } = fixture()
    const t0 = Date.parse('2026-10-01T00:00:00Z')
    for (let tick = 0; tick < 4; tick++) await sweep.maybeRunScheduledOrphanStagingCleanup(env, t0 + tick * 6 * HOUR)
    const throttled = counted.stats.statements
    const before = 4 * perSweep.statements
    assert.strictEqual(throttled, perSweep.statements + 2 + 3)
    assert.ok(throttled < before / 3, `throttled ${throttled} vs unthrottled ${before}`)
    console.log(`  statements per day: unthrottled ${before} -> throttled ${throttled}; modelled scan rows per day: ${4 * perSweep.scanRows} -> ${perSweep.scanRows} (fixture tables, plan model)`)
  })

  await check('a failed sweep does not stamp, so the next tick retries', async () => {
    const { raw } = fixture()
    const t0 = Date.parse('2026-10-01T00:00:00Z')
    cleanupOverride = async () => { throw new Error('staging db unavailable') }
    await assert.rejects(() => sweep.maybeRunScheduledOrphanStagingCleanup(env, t0), /staging db unavailable/)
    assert.strictEqual(raw.db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'orphan_staging_last_run'`).get().n, 0)
    cleanupOverride = null
    const retry = await sweep.maybeRunScheduledOrphanStagingCleanup(env, t0 + 6 * HOUR)
    assert.strictEqual(retry.skipped, false)
  })

  await check('an unreadable or future stamp never blocks the sweep', async () => {
    for (const value of ['not a date', '', '2099-01-01T00:00:00Z']) {
      const { raw } = fixture()
      raw.prepare(`INSERT INTO settings (key, value) VALUES ('orphan_staging_last_run', @value)`).run({ value })
      const result = await sweep.maybeRunScheduledOrphanStagingCleanup(env, Date.parse('2026-10-01T00:00:00Z'))
      assert.strictEqual(result.skipped, false, `stamp ${JSON.stringify(value)}`)
    }
  })

  await check('the cron calls the throttled entry point, not the raw sweep', async () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8')
    assert.ok(/runStep\('orphan-staging-cleanup', \(\) => maybeRunScheduledOrphanStagingCleanup\(env\)\)/.test(index))
    assert.ok(!/cleanOrphanImportStaging\(env, \{ apply: true \}\)/.test(index), 'no unthrottled apply in the cron')
    const system = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'system.ts'), 'utf8')
    assert.ok(system.includes('cleanOrphanImportStaging(c.env, { apply })'), 'the admin endpoint keeps the raw sweep')
  })

  console.log(`test-scheduled-orphan-staging-throttle-pure: ${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
