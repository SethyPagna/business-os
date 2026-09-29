// SCAN2 RT-10: when an import chunk is killed (CPU/memory limit, eviction)
// while it holds the 60 s job lease, Cloudflare redelivers its message at
// once. That redelivery found the lease held, returned, and queue.ts ACKED it,
// so no message was left and the job froze until the 20-minute reaper failed it.
//
// Drives the REAL queue.ts handleImportQueue against the real import_jobs
// schema (node:sqlite, migration chain). The runners take the lease with the
// exact acquire SQL read out of importEngine.ts, as the real ones do.
//
// Run: node scripts/test-import-lease-redelivery-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')
const { openDb } = require('./harness/d1compat.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')
const engineSource = fs.readFileSync(path.join(srcRoot, 'lib', 'importEngine.ts'), 'utf8')
const ACQUIRE_LEASE_SQL = /async function acquireImportLease[\s\S]*?db\.prepare\(`([\s\S]*?)`\)/.exec(engineSource)[1]
const IMPORT_LEASE_MS = Number(/const IMPORT_LEASE_MS = ([\d_]+)/.exec(engineSource)[1].replace(/_/g, ''))

function importQueueMaxRetries(tomlFile) {
  const toml = fs.readFileSync(path.join(cloudflareRoot, tomlFile), 'utf8').replace(/\r\n/g, '\n')
  const consumer = toml.split('[[queues.consumers]]').slice(1).find((block) => /^\s*queue = "business-os-import"\s*$/m.test(block))
  return Number(/^max_retries = (\d+)$/m.exec(consumer)[1])
}
const MAX_RETRIES = importQueueMaxRetries('wrangler.toml')

function load(relativePath, stubs) {
  const filePath = path.join(srcRoot, relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  })
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    loaded.exports,
    (request) => {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
      throw new Error(`${relativePath} required an unstubbed module: ${request}`)
    },
    loaded, filePath, path.dirname(filePath),
  )
  return loaded.exports
}

const db = openDb(loadAll())

function harness() {
  const state = { chunksRun: [], leaseSkips: 0, fencedDbReads: 0, bulkDeletes: 0 }
  async function runWithLease(jobId, kind, attempt) {
    const now = new Date()
    const taken = db.prepare(ACQUIRE_LEASE_SQL).run({
      id: jobId,
      token: crypto.randomUUID(),
      now: now.toISOString(),
      expires: new Date(now.getTime() + IMPORT_LEASE_MS).toISOString(),
    })
    if (taken.meta.changes !== 1) {
      state.leaseSkips++
      return kind === 'apply' ? { applied: 0, failed: 0 } : undefined
    }
    state.chunksRun.push({ jobId, kind, attempt })
    db.prepare(`UPDATE import_jobs SET lease_token = NULL, lease_expires_at = NULL WHERE id = @id`).run({ id: jobId })
    return kind === 'apply' ? { applied: 1, failed: 0 } : undefined
  }
  const stub = new Proxy({}, { get: () => async () => undefined })
  const queue = load('queue.ts', {
    './index': {},
    './lib/importMaintenanceFence': {
      getImportFencedDb: async () => { state.fencedDbReads++; return db },
      isImportMaintenanceFenceError: () => false,
    },
    './lib/importEngine': {
      runImportAnalyze: (_env, jobId, _latency, attempt) => runWithLease(jobId, 'analyze', attempt),
      runImportApply: (_env, jobId, _latency, attempt) => runWithLease(jobId, 'apply', attempt),
      markJobFailed: async () => {},
      isImportApplyAuthorizationError: () => false,
    },
    './lib/bulkDeleteEngine': { runBulkDeleteJob: async () => { state.bulkDeletes++ } },
    './lib/queueDispatch': { registerInlineImportRunner: () => {} },
    './lib/importIncomingFiles': { purgeImportIncomingFiles: async () => ({ deleted: 0, errors: [] }) },
    './lib/errorReporting': { reportError: async () => false },
    './lib/backup': stub,
    './lib/driveSyncQueue': stub,
    './lib/imageAudit': stub,
  })
  return { db, state, queue }
}

function seedJob(db, id, status, leaseExpiresInMs) {
  db.prepare(`
    INSERT INTO import_jobs (id, type, status, phase, lease_token, lease_expires_at, created_at, updated_at)
    VALUES (@id, 'products', @status, @status, @token, @expires, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run({
    id,
    status,
    token: leaseExpiresInMs == null ? null : 'killed-invocation',
    expires: leaseExpiresInMs == null ? null : new Date(Date.now() + leaseExpiresInMs).toISOString(),
  })
}

function advanceLeaseClock(db, id, seconds) {
  const row = db.prepare(`SELECT lease_expires_at FROM import_jobs WHERE id = @id`).get({ id })
  if (!row.lease_expires_at) return
  db.prepare(`UPDATE import_jobs SET lease_expires_at = @expires WHERE id = @id`)
    .run({ id, expires: new Date(Date.parse(row.lease_expires_at) - seconds * 1000).toISOString() })
}

async function deliver(queue, body, attempts) {
  const outcome = { acked: 0, retries: [] }
  await queue.handleImportQueue({ messages: [{
    body,
    attempts,
    timestamp: new Date(Date.now() - 1000),
    ack() { outcome.acked++ },
    retry(options) { outcome.retries.push(options ?? null) },
  }] }, {})
  return outcome
}

const tests = []
function check(name, fn) { tests.push({ name, fn }) }

check('a redelivery after a killed chunk waits out the lease instead of being acked and dropped', async () => {
  const { db, state, queue } = harness()
  seedJob(db, 'job-a', 'analyzing', 40_000)
  const first = await deliver(queue, { jobId: 'job-a', kind: 'analyze' }, 2)
  assert.equal(first.acked, 0, 'acking here leaves no message for the job: it stalls until the reaper fails it')
  assert.equal(first.retries.length, 1)
  const delaySeconds = first.retries[0]?.delaySeconds
  assert.ok(delaySeconds >= 41, `the retry must land after the lease expires, got ${delaySeconds}`)
  assert.ok(delaySeconds <= 40 + 10, `the retry must not wait far past the lease, got ${delaySeconds}`)
  assert.equal(state.chunksRun.length, 0)

  advanceLeaseClock(db, 'job-a', delaySeconds)
  const second = await deliver(queue, { jobId: 'job-a', kind: 'analyze' }, 3)
  assert.equal(second.acked, 1)
  assert.deepEqual(second.retries, [])
  assert.deepEqual(state.chunksRun, [{ jobId: 'job-a', kind: 'analyze', attempt: 3 }], 'the chunk resumes once, on the smaller-window attempt')
})

check('apply chunks get the same wait', async () => {
  const { db, queue } = harness()
  seedJob(db, 'job-b', 'applying', 20_000)
  const outcome = await deliver(queue, { jobId: 'job-b', kind: 'apply' }, 2)
  assert.equal(outcome.acked, 0)
  assert.ok(outcome.retries[0]?.delaySeconds >= 21)
})

check('a first delivery is untouched: no extra read, and a held lease still means a duplicate that acks', async () => {
  const { db, state, queue } = harness()
  seedJob(db, 'job-c', 'analyzing', 40_000)
  const outcome = await deliver(queue, { jobId: 'job-c', kind: 'analyze' }, 1)
  assert.equal(outcome.acked, 1)
  assert.deepEqual(outcome.retries, [])
  assert.equal(state.leaseSkips, 1)
  assert.equal(state.fencedDbReads, 0, 'the hot first-delivery path gains no D1 read')
})

check('a stray redelivery for a job that moved on is not kept alive', async () => {
  const { db, state, queue } = harness()
  seedJob(db, 'job-d', 'awaiting_review', 40_000)
  const outcome = await deliver(queue, { jobId: 'job-d', kind: 'analyze' }, 2)
  assert.equal(outcome.acked, 1)
  assert.deepEqual(outcome.retries, [])
  assert.equal(state.chunksRun.length, 0)
})

check('the last delivery never retries into the dead-letter queue (it would fail the job)', async () => {
  const { db, queue } = harness()
  seedJob(db, 'job-e', 'analyzing', 40_000)
  const lastAllowed = await deliver(queue, { jobId: 'job-e', kind: 'analyze' }, MAX_RETRIES)
  assert.equal(lastAllowed.retries.length, 1, 'one retry is still inside the budget')
  const exhausted = await deliver(queue, { jobId: 'job-e', kind: 'analyze' }, MAX_RETRIES + 1)
  assert.deepEqual(exhausted.retries, [])
  assert.equal(exhausted.acked, 1)
})

check('an expired lease runs the chunk straight away', async () => {
  const { db, state, queue } = harness()
  seedJob(db, 'job-f', 'analyzing', -1_000)
  const outcome = await deliver(queue, { jobId: 'job-f', kind: 'analyze' }, 2)
  assert.equal(outcome.acked, 1)
  assert.equal(state.chunksRun.length, 1)
})

check('bulk-delete messages keep their own path', async () => {
  const { state, queue } = harness()
  const outcome = await deliver(queue, { jobId: 'bulk-1', kind: 'bulk-delete' }, 2)
  assert.equal(outcome.acked, 1)
  assert.equal(state.bulkDeletes, 1)
  assert.equal(state.fencedDbReads, 0)
})

check('the retry budget and lease length match the deployed config and the engine', async () => {
  assert.equal(importQueueMaxRetries('wrangler.free.toml'), MAX_RETRIES)
  const { queue } = harness()
  assert.equal(queue.IMPORT_QUEUE_MAX_RETRIES, MAX_RETRIES)
  assert.equal(IMPORT_LEASE_MS, 60_000)
})

async function main() {
  let failed = 0
  const originalLog = console.log
  for (const test of tests) {
    console.log = () => {}
    try {
      await test.fn()
      console.log = originalLog
      console.log(`PASS ${test.name}`)
    } catch (error) {
      console.log = originalLog
      failed++
      console.error(`FAIL ${test.name}\n  ${error && error.message}`)
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
}

main()
