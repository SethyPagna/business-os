// A never-started import job is reaped after 24 hours, not 20 minutes
// (S-uploads3 fix 2, refuter R-uploads2, 2026-09-27).
//
// routes/importJobs.ts's reapStalledImportJobs failed every job idle for 20
// minutes in an active status, 'pending' included. A 'pending' job is one
// nobody has started (created, its CSV maybe still being chosen): reaping it
// made it terminal, and lib/importIncomingFiles.ts's sweep, which gives a
// terminal job's file only a 1-hour grace, then deleted the uploaded CSV
// about 80 minutes after the person last touched the job -- although the same
// sweep deliberately keeps a never-started job's file for 24 hours. Owner
// rule (27 Sep 2026): a never-started import is reaped after 24 hours.
//
//   - pending, idle 21 minutes: still pending;
//   - pending, idle 24 hours and 1 minute: failed, with its own message;
//   - running (started) and stalled 21 minutes: failed, as before;
//   - end to end with the real sweep: a pending job's CSV idle 3 hours is
//     still in R2 two hours after the reaper ran; at 24 hours the job is
//     reaped and its file swept, as the owner rule says;
//   - the reaper's 24 hours equals the sweep's STALE_INCOMING_MAX_AGE_HOURS.
//
// Fails on 0d7493589a. To run it against an older route:
// IMPORT_JOBS_TS=/path/to/old/importJobs.ts node test-import-job-reaper-never-started-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { D1Compat } = require('./harness/d1compat.cjs')

const srcRoot = path.join(__dirname, '..', 'src')
const routePath = process.env.IMPORT_JOBS_TS || path.join(srcRoot, 'routes', 'importJobs.ts')
const incomingPath = path.join(srcRoot, 'lib', 'importIncomingFiles.ts')

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText
}
function loadWith(file, resolve) {
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(file))(
    mod.exports, (name) => resolve(name) || require(name), mod, file, path.dirname(file),
  )
  return mod.exports
}

let activeDb = null
const fallback = new Proxy({}, {
  get(target, property) {
    if (!(property in target)) target[property] = () => undefined
    return target[property]
  },
})

// The route, with its Worker-only dependencies stubbed (as in
// test-import-job-reaper-pure.cjs); the reaper SQL runs on node:sqlite.
let route
{
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../lib/db') return { getDb: () => activeDb }
    if (request === '../lib/importMaintenanceFence') return { getImportFencedDb: async () => activeDb, isImportMaintenanceFenceError: () => false }
    if (request === '../index') return {}
    if (request.startsWith('../lib/') || request.startsWith('../durable-objects/')) return fallback
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    route = loadWith(routePath, () => null)
  } finally {
    Module._load = originalLoad
  }
}
const { reapStalledImportJobs } = route

// The real incoming-file sweep, over the same database and a fake R2.
const sqlBinding = loadWith(path.join(srcRoot, 'lib', 'sqlBinding.ts'), () => null)
const incoming = loadWith(incomingPath, (name) => {
  if (name === './db') return { getDb: () => activeDb, isImportMaintenanceFenceError: () => false }
  if (name === './sqlBinding') return sqlBinding
  if (name === './r2') {
    return {
      async deleteObjectsBulk(bucket, keys) {
        for (const key of keys) bucket.objects.delete(key)
        return { deleted: keys.length, errors: [] }
      },
    }
  }
  return null
})

function newDb() {
  const raw = new DatabaseSync(':memory:')
  raw.exec(`
    CREATE TABLE import_jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, phase TEXT, last_error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT,
      policy_json TEXT DEFAULT '{}', summary_json TEXT DEFAULT '{}', materialize_done INTEGER DEFAULT 0
    );
    CREATE TABLE import_job_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, kind TEXT, stored_path TEXT, file_asset_id INTEGER,
      status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return { raw, db: asyncDb(new D1Compat(raw)) }
}
// D1's statements are async (the reaper chains .catch on them).
function asyncDb(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        async get(params) { return statement.get(params) },
        async all(params) { return statement.all(params) },
        async run(params) { return statement.run(params) },
      }
    },
  }
}
// SQLite's own clock, in its CURRENT_TIMESTAMP form.
const ago = (raw, modifier) => raw.prepare(`SELECT datetime('now', '${modifier}') AS at`).get().at
function insertJob(raw, id, status, updatedAt) {
  raw.prepare(`INSERT INTO import_jobs (id, type, status, phase, updated_at) VALUES (?, 'products', ?, ?, ?)`).run(id, status, status === 'pending' ? 'created' : status, updatedAt)
}
const job = (raw, id) => raw.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id)

function fakeBucket() {
  const objects = new Map()
  return {
    objects,
    async list({ prefix }) {
      return { objects: [...objects.values()].filter((object) => object.key.startsWith(prefix)), truncated: false }
    },
  }
}

const failures = []
let checks = 0
async function check(label, fn) {
  checks += 1
  try { await fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}

async function main() {
  await check('a pending job idle 21 minutes stays pending; a running job stalled 21 minutes is failed', async () => {
    const { raw, db } = newDb()
    insertJob(raw, 'pending-21m', 'pending', ago(raw, '-21 minutes'))
    insertJob(raw, 'running-21m', 'running', ago(raw, '-21 minutes'))
    insertJob(raw, 'queued-21m', 'queued', ago(raw, '-21 minutes'))
    activeDb = db
    await reapStalledImportJobs({})
    assert.equal(job(raw, 'pending-21m').status, 'pending', 'a never-started job is not stalled')
    assert.equal(job(raw, 'pending-21m').finished_at, null)
    assert.equal(job(raw, 'running-21m').status, 'failed', 'a started job keeps the 20-minute rule')
    assert.match(job(raw, 'running-21m').last_error, /Stalled: no progress/)
    assert.equal(job(raw, 'queued-21m').status, 'failed')
  })

  await check('pending idle 23h59m stays pending; pending idle 24h01m is failed with a never-started message', async () => {
    const { raw, db } = newDb()
    insertJob(raw, 'pending-almost', 'pending', ago(raw, '-1439 minutes'))
    insertJob(raw, 'pending-24h1m', 'pending', ago(raw, '-1441 minutes'))
    activeDb = db
    await reapStalledImportJobs({})
    assert.equal(job(raw, 'pending-almost').status, 'pending')
    const reaped = job(raw, 'pending-24h1m')
    assert.equal(reaped.status, 'failed')
    assert.equal(reaped.phase, 'failed')
    assert.ok(reaped.finished_at, 'finished_at stamped')
    assert.match(reaped.last_error, /Never started/)
    assert.match(reaped.last_error, /24 hours/)
  })

  await check('end to end: a pending job\'s CSV is not swept before 24 hours; at 24 hours job and file go', async () => {
    const { raw, db } = newDb()
    const bucket = fakeBucket()
    const env = { ASSETS: bucket }
    const threeHoursAgo = ago(raw, '-3 hours')
    insertJob(raw, 'job-3h', 'pending', threeHoursAgo)
    raw.prepare(`INSERT INTO import_job_files (job_id, kind, stored_path, created_at) VALUES ('job-3h', 'csv', 'imports/job-3h/stock.csv', ?)`).run(threeHoursAgo)
    bucket.objects.set('imports/job-3h/stock.csv', { key: 'imports/job-3h/stock.csv', uploaded: new Date(Date.now() - 3 * 3600e3) })
    activeDb = db
    await reapStalledImportJobs({})
    // The next sweep ticks, up to two hours later (past the 1-hour terminal grace).
    for (const laterMs of [0, 70 * 60e3, 2 * 3600e3]) await incoming.sweepStaleImportIncomingFiles(env, Date.now() + laterMs)
    assert.ok(bucket.objects.has('imports/job-3h/stock.csv'), 'the uploaded CSV is still there 5 hours after the last touch')
    assert.equal(job(raw, 'job-3h').status, 'pending', 'still pending')
    assert.notEqual(raw.prepare(`SELECT status FROM import_job_files WHERE job_id = 'job-3h'`).get().status, 'purged')

    // A day after the last touch: reaped, and its file swept.
    raw.prepare(`UPDATE import_jobs SET updated_at = ? WHERE id = 'job-3h'`).run(ago(raw, '-1441 minutes'))
    raw.prepare(`UPDATE import_job_files SET created_at = ? WHERE job_id = 'job-3h'`).run(ago(raw, '-1441 minutes'))
    bucket.objects.get('imports/job-3h/stock.csv').uploaded = new Date(Date.now() - 1441 * 60e3)
    await reapStalledImportJobs({})
    assert.equal(job(raw, 'job-3h').status, 'failed')
    await incoming.sweepStaleImportIncomingFiles(env, Date.now() + 2 * 3600e3)
    assert.ok(!bucket.objects.has('imports/job-3h/stock.csv'), 'swept once the never-started job is a day old')
  })

  await check('the reaper\'s never-started age equals the sweep\'s STALE_INCOMING_MAX_AGE_HOURS', async () => {
    const source = fs.readFileSync(routePath, 'utf8')
    const match = /const NEVER_STARTED_IMPORT_JOB_REAP_HOURS = (\d+)/.exec(source)
    assert.ok(match, 'NEVER_STARTED_IMPORT_JOB_REAP_HOURS defined in the route')
    assert.equal(Number(match[1]), incoming.STALE_INCOMING_MAX_AGE_HOURS)
  })

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: a never-started import is reaped at 24 hours (its file kept until then); a started one that stalls at 20 minutes`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
