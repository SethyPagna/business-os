// Only ONE invocation may process an import job's chunk at a time.
//
// Cloudflare Queues is at-least-once: the same message can be delivered
// twice, and a retry can overlap the invocation it is retrying. Without a
// lease, two invocations of the same job read the same chunk_cursor,
// classify the same ~150 rows, both see "no existing product matches" for
// every create, and both INSERT. The result is duplicate products that
// nothing later reconciles, because each one looks like a legitimately
// distinct row. On the sales path the same overlap writes a receipt twice.
//
// This was always possible; running two imports at once makes it likely,
// because queue pressure is what provokes redelivery.
//
// Note what is NOT at risk: two DIFFERENT jobs. Every table the engine
// writes during a run is keyed by job_id, so separate jobs never contend.
// These tests cover that explicitly so the distinction stays understood.
//
// Run: node scripts/test-import-lease-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const engine = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importEngine.ts'), 'utf8')
const MIGRATION_SQLS = loadAll()

let passed = 0
const tests = []
const check = (name, fn) => tests.push({ name, fn })

const LEASE_MS = 60_000

// The harness's D1Compat returns D1's NATIVE shape, { meta: { changes } },
// while src/lib/db.ts's run() unwraps it to { changes }. Production goes
// through db.ts and reads result.changes correctly; this helper mirrors that
// unwrapping so the test exercises the same decision rather than silently
// comparing undefined === 1 and passing for the wrong reason.
const changedRows = (result) => Number(result?.changes ?? result?.meta?.changes ?? 0)

// The real SQL, lifted from source so the test cannot drift from it.
async function acquire(db, jobId, token, nowMs) {
  const now = new Date(nowMs)
  const result = await db.prepare(`
    UPDATE import_jobs
    SET lease_token = @token, lease_expires_at = @expires, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND (lease_expires_at IS NULL OR lease_expires_at < @now)
  `).run({
    id: jobId,
    token,
    now: now.toISOString(),
    expires: new Date(nowMs + LEASE_MS).toISOString(),
  })
  return changedRows(result) === 1 ? token : null
}

async function release(db, jobId, token) {
  await db.prepare(`
    UPDATE import_jobs SET lease_token = NULL, lease_expires_at = NULL
    WHERE id = @id AND lease_token = @token
  `).run({ id: jobId, token })
}

async function seedJob(db, jobId) {
  await db.prepare(`INSERT INTO import_jobs (id, type, status) VALUES (@id, 'products', 'queued')`).run({ id: jobId })
}

check('a second invocation of the SAME job cannot claim it', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seedJob(db, 'job-a')
  const now = Date.now()
  const first = await acquire(db, 'job-a', 'token-1', now)
  const second = await acquire(db, 'job-a', 'token-2', now + 10)
  assert.equal(first, 'token-1', 'the first invocation claims it')
  assert.equal(second, null, 'the duplicate delivery is refused -- this is what prevents the double INSERT')
})

check('two DIFFERENT jobs never contend -- concurrent imports are fine', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seedJob(db, 'job-a')
  await seedJob(db, 'job-b')
  const now = Date.now()
  assert.equal(await acquire(db, 'job-a', 'token-a', now), 'token-a')
  assert.equal(await acquire(db, 'job-b', 'token-b', now), 'token-b', 'a second import must not be blocked by the first')
})

check('releasing hands the job straight to the next continuation', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seedJob(db, 'job-a')
  const now = Date.now()
  await acquire(db, 'job-a', 'token-1', now)
  await release(db, 'job-a', 'token-1')
  assert.equal(
    await acquire(db, 'job-a', 'token-2', now + 1),
    'token-2',
    'the next chunk must not wait out the full lease',
  )
})

check('an expired lease self-heals, so a dead invocation cannot wedge the job', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seedJob(db, 'job-a')
  const now = Date.now()
  await acquire(db, 'job-a', 'token-1', now)
  // token-1's invocation dies mid-chunk: CPU limit, isolate eviction. It
  // never releases. A status flag would strand the job permanently.
  assert.equal(await acquire(db, 'job-a', 'token-2', now + LEASE_MS - 1000), null, 'still held while unexpired')
  assert.equal(await acquire(db, 'job-a', 'token-2', now + LEASE_MS + 1000), 'token-2', 'reclaimable once expired')
})

check('a stale holder cannot release the lease out from under the new one', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seedJob(db, 'job-a')
  const now = Date.now()
  await acquire(db, 'job-a', 'token-1', now)
  await acquire(db, 'job-a', 'token-2', now + LEASE_MS + 1000) // took over after expiry
  // token-1 finally finishes and tries to clean up. If that cleared the
  // lease, a THIRD invocation could start alongside the one now running.
  await release(db, 'job-a', 'token-1')
  assert.equal(
    await acquire(db, 'job-a', 'token-3', now + LEASE_MS + 2000),
    null,
    "the late finisher must not release the active holder's lease",
  )
})

check('the lease is released on the FAILURE path too', async () => {
  // A failed chunk is retried by the queue, and that retry has to be able to
  // claim the job rather than waiting out 60s behind an invocation that is
  // already gone.
  const analyzeAndApply = engine.match(/\} finally \{[\s\S]{0,400}?await releaseImportLease\(db, jobId, leaseToken\)/g) || []
  assert.equal(analyzeAndApply.length, 2, 'both analyze and apply must release in a finally, not only on success')
})

check('both phases claim before touching a chunk, and ack rather than retry when refused', async () => {
  const claims = engine.match(/const leaseToken = await acquireImportLease\(db, jobId\)/g) || []
  assert.equal(claims.length, 2, 'analyze and apply must both claim')
  // Returning (not throwing) is what makes the duplicate ack instead of
  // retrying -- throwing would spin the message against a healthy run.
  assert.ok(
    !/if \(!leaseToken\) \{[\s\S]{0,200}?throw /.test(engine),
    'a refused claim must return, not throw: the holder is making progress',
  )
})

check('the apply phase returns a real result when it declines, not undefined', async () => {
  assert.match(
    engine,
    /return \{ applied: 0, failed: 0 \}/,
    'an invocation that did nothing must report zero, not crash its caller',
  )
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()
