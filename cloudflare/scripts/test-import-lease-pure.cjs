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
const ts = require('typescript')
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

function productionLeaseSql(name) {
  const parsed = ts.createSourceFile('importEngine.ts', engine, ts.ScriptTarget.Latest, true)
  const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(fn, name)
  const queries = []
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'prepare' && ts.isNoSubstitutionTemplateLiteral(node.arguments[0])) {
      queries.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(fn)
  assert.equal(queries.length, 1, name + ' must have one atomic lease query')
  return queries[0]
}
const acquireSql = productionLeaseSql('acquireImportLease')
const releaseSql = productionLeaseSql('releaseImportLease')

async function acquire(db, jobId, token, nowMs, status = 'queued', activeStatus = 'applying') {
  const now = new Date(nowMs)
  const result = await db.prepare(acquireSql).run({
    id: jobId,
    status,
    activeStatus,
    token,
    now: now.toISOString(),
    expires: new Date(nowMs + LEASE_MS).toISOString(),
  })
  return changedRows(result) === 1 ? token : null
}

async function release(db, jobId, token) {
  await db.prepare(releaseSql).run({ id: jobId, token })
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

check('terminal jobs cannot be claimed even when an earlier status read was stale', async () => {
  const db = openDb(MIGRATION_SQLS)
  for (const status of ['completed', 'completed_with_errors', 'cancelled']) {
    const id = 'terminal-' + status
    await seedJob(db, id)
    await db.prepare('UPDATE import_jobs SET status=@status WHERE id=@id').run({ id, status })
    const before = await db.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id })
    assert.equal(await acquire(db, id, 'late-token', Date.now(), status), null, status + ' must not restart')
    assert.deepEqual(await db.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id }), before)
    await db.prepare("UPDATE import_jobs SET status='queued' WHERE id=@id").run({ id })
    assert.equal(await acquire(db, id, 'retry-token', Date.now()), 'retry-token', 'explicit Retry re-admits ' + status)
  }
})

check('authorized starts, failed recovery and pending cancellation remain eligible', async () => {
  const db = openDb(MIGRATION_SQLS)
  for (const phase of ['analyzing', 'applying']) {
    const statuses = ['queued', 'failed', 'cancelling', phase, ...(phase === 'applying' ? ['approved'] : [])]
    for (const status of statuses) {
      const id = 'eligible-' + phase + '-' + status
      await seedJob(db, id)
      await db.prepare('UPDATE import_jobs SET status=@status,cancel_requested=@cancel WHERE id=@id')
        .run({ id, status, cancel: status === 'cancelling' ? 1 : 0 })
      assert.equal(await acquire(db, id, 'active-token', Date.now(), status, phase), 'active-token', id + ' must remain eligible')
    }
  }
})

check('review, pending and wrong-phase deliveries cannot change a job or claim its lease', async () => {
  const db = openDb(MIGRATION_SQLS)
  for (const [phase, statuses] of [
    ['analyzing', ['pending', 'awaiting_review', 'approved', 'applying']],
    ['applying', ['pending', 'awaiting_review', 'analyzing']],
  ]) {
    for (const status of statuses) {
      const id = phase + '-refuses-' + status
      await seedJob(db, id)
      await db.prepare('UPDATE import_jobs SET status=@status WHERE id=@id').run({ id, status })
      const before = await db.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id })
      assert.equal(await acquire(db, id, 'wrong-phase', Date.now(), status, phase), null, id)
      assert.deepEqual(await db.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id }), before)
    }
  }
})

check('an eligible status change between read and claim cannot reuse the earlier fresh-run decision', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seedJob(db, 'changed-before-claim')
  const observed = await db.prepare('SELECT status FROM import_jobs WHERE id=@id').get({ id: 'changed-before-claim' })
  await db.prepare("UPDATE import_jobs SET status='analyzing',chunk_cursor=37 WHERE id=@id").run({ id: 'changed-before-claim' })
  const before = await db.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id: 'changed-before-claim' })
  assert.equal(await acquire(db, 'changed-before-claim', 'stale-read', Date.now(), observed.status, 'analyzing'), null)
  assert.deepEqual(await db.prepare('SELECT * FROM import_jobs WHERE id=@id').get({ id: 'changed-before-claim' }), before)
  assert.equal(await acquire(db, 'changed-before-claim', 'current-read', Date.now(), 'analyzing', 'analyzing'), 'current-read')
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
  const parsed = ts.createSourceFile('importEngine.ts', engine, ts.ScriptTarget.Latest, true)
  for (const name of ['runImportAnalyze', 'runImportApply']) {
    const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(fn, name)
    const finalizers = []
    const walk = node => {
      if (ts.isTryStatement(node) && node.finallyBlock) finalizers.push(node.finallyBlock.getText(parsed))
      ts.forEachChild(node, walk)
    }
    walk(fn)
    assert.equal(finalizers.filter(block => /await releaseImportLease\(db, jobId, leaseToken\)/.test(block)).length, 1,
      `${name} releases its token in a finally even when budget cleanup precedes it`)
  }
})

check('both phases claim before touching a chunk, and ack rather than retry when refused', async () => {
  const claims = engine.match(/const leaseToken = await acquireImportLease\(db, jobId, jobRow\.status, '(analyzing|applying)'\)/g) || []
  assert.equal(claims.length, 2, 'analyze and apply must both claim')
  assert.match(claims[0], /'analyzing'/)
  assert.match(claims[1], /'applying'/)
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
