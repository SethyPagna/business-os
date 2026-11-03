'use strict'
// Lane P1.2 (S4): contacts bulk delete (customers, suppliers, delivery contacts) on the Workers Free plan's limit of 50
// D1 calls per invocation. It used to loop every chunk inside ONE queue invocation (~6 calls a chunk), so 1,000 ids hit
// call 51, threw and were retried. Now a delivery does ONE chunk and re-enqueues the next, as the products path does.
//
// Runs the REAL lib/bulkDeleteEngine.ts against the full migrated schema in node:sqlite, every D1 call counted and
// call 51 refused as Cloudflare refuses it. Pinned: eight deliveries of a handful of calls for 1,000 ids on Free; the
// audit rows (same columns, same order, one per id); a duplicate or concurrent delivery applies a chunk once; Cancel
// stops a chunk read before it; the advisory and in-batch anonymous-customer guards; a failed chunk's ids; the Paid
// chunk; one cache bump for the whole job. F1-F6 run the REAL db adapter (with its retry) and fence over a binding that loses
// acknowledgements AFTER a commit: the job must finish with one audit row per id, on Free and on Paid. Mutants (wrong
// implementations) at the end must each turn a check red.
//
// P12_SRC=<dir> runs the same checks against another src tree (the base commit via git archive): proof of red.
const assert = require('node:assert/strict')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { makeLoader, countingDb, plain, quietly, runSuite } = require('./harness/free_call_budget.cjs')

const tests = []
const check = (name, fn) => tests.push({ name, fn })

// ---------------------------------------------------------------------------------------------------------------
// A. contacts bulk delete
// ---------------------------------------------------------------------------------------------------------------
// The project's own transient-error classifier (lib/db.ts), shared by the stub world below.
const realDb = makeLoader({})('lib/db.ts')

function bulkWorld() {
  const raw = openDb(loadAll())
  const counter = countingDb(raw)
  const env = { DB: counter.db, PLAN_TIER: 'free', queue: [], bumps: [], broadcasts: [] }
  const load = makeLoader({
    './db': { getDb: (e) => e.DB, getImportFencedDb: async (e) => e.DB, isImportMaintenanceFenceError: () => false, isRetryableD1Error: realDb.isRetryableD1Error },
    './queueDispatch': { dispatchImportWork: async (e, message) => { e.queue.push(message); return 'queued' } },
    './cache': { bumpVersion: async (e, key) => { e.bumps.push(key) } },
    '../durable-objects/broadcastHub': { broadcast: async (e, key, payload) => { e.broadcasts.push({ key, payload }) } },
    // The base engine imports this; the new one does not. A single-batch stand-in is enough for the base run.
    './importEngine': { runD1BatchInChunks: async (db, statements) => { if (statements.length) await db.batch(statements) } },
  })
  const engine = load('lib/bulkDeleteEngine.ts')
  const planTier = load('lib/planTier.ts')
  const useTier = (tier) => { env.PLAN_TIER = tier; planTier.__resetPlanTierCacheForTests() }
  const actor = { id: 7, name: 'ana' }
  const rows = (sql, ...bind) => plain(raw.db.prepare(sql).all(...bind))
  const one = (sql, ...bind) => plain(raw.db.prepare(sql).get(...bind))
  const exec = (sql) => raw.db.exec(sql)
  async function drain(max = 60) {
    const deliveries = []
    while (env.queue.length && deliveries.length < max) {
      const message = env.queue.shift()
      counter.state.calls = 0
      let error = null
      try { await quietly(() => engine.runBulkDeleteJob(env, message.jobId)) } catch (e) { error = String(e && e.message || e) }
      deliveries.push({ calls: counter.state.calls, error })
      if (error) env.queue.push(message) // a thrown delivery is retried by the queue
    }
    return deliveries
  }
  return { raw, counter, env, engine, useTier, actor, rows, one, exec, drain }
}

const seedContacts = (world, table, from, count) => world.exec(`WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM n WHERE k<${count - 1})
  INSERT INTO ${table}(id,name) SELECT ${from}+k,'${table} '||(${from}+k) FROM n`)
const range = (from, count) => Array.from({ length: count }, (_, i) => from + i)
const auditOf = (world, entity, lo, hi) => world.rows(`SELECT user_id,user_name,action,entity,entity_id,typeof(entity_id) AS entity_id_type,details,table_name,record_id,new_value
  FROM audit_logs WHERE entity=? AND action='delete' AND CAST(entity_id AS INTEGER) BETWEEN ? AND ? ORDER BY id`, entity, lo, hi)
// What the base engine wrote for each deleted id: user_name is NULL because createBulkDeleteJob and the engine hand
// actorSnapshot() {id,name} (it reads .username); that is the shipped behaviour and is kept exactly.
const oracleAudit = (entity, ids, jobId, reason) => ids.map((id) => ({ user_id: 7, user_name: null, action: 'delete', entity, entity_id: String(id), entity_id_type: 'text',
  details: JSON.stringify({ reason, bulkJobId: jobId }), table_name: entity, record_id: String(id), new_value: null }))

check('A1 customers bulk delete of 1,000 on Free: eight deliveries, each far inside 50 calls, exact audit rows, one cache bump at the end', async () => {
  const w = bulkWorld(); w.useTier('free'); seedContacts(w, 'customers', 20001, 1000)
  const ids = range(20001, 1000)
  const { jobId, totalCount } = await w.engine.createBulkDeleteJob(w.env, 'customers', ids, 'cleanup', w.actor)
  assert.equal(totalCount, 1000)
  const deliveries = await w.drain()
  assert.deepEqual(deliveries.filter((d) => d.error), [], 'no delivery may throw (call 51 is refused on Free)')
  assert.equal(deliveries.length, 8, '1,000 ids / the Free chunk of 125')
  for (const d of deliveries) assert.ok(d.calls <= 8, `a delivery is a fixed handful of calls, saw ${d.calls}`)
  assert.deepEqual(w.one('SELECT status,processed_count,failed_count FROM bulk_delete_jobs WHERE id=?', jobId), { status: 'completed', processed_count: 1000, failed_count: 0 })
  assert.equal(w.one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 20001 AND 21000').n, 0)
  assert.deepEqual(auditOf(w, 'customer', 20001, 21000), oracleAudit('customer', ids, jobId, 'cleanup'), 'one audit row per id, same columns and order')
  assert.deepEqual(w.env.bumps, ['customers'], 'one cache bump for the whole job, not one per chunk')
  assert.equal(w.env.broadcasts.length, 1)
  assert.deepEqual(w.env.broadcasts[0].payload.ids, ids)
})

check('A2 the same message delivered to two consumers at once applies the chunk once and queues one continuation', async () => {
  const w = bulkWorld(); w.useTier('free'); seedContacts(w, 'customers', 30001, 400)
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'customers', range(30001, 400), 'race', w.actor)
  const message = w.env.queue.shift()
  await quietly(() => Promise.all([w.engine.runBulkDeleteJob(w.env, message.jobId), w.engine.runBulkDeleteJob(w.env, message.jobId)]))
  assert.equal(w.one('SELECT processed_count FROM bulk_delete_jobs WHERE id=?', jobId).processed_count, 125)
  assert.equal(w.one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 30001 AND 30400').n, 275)
  assert.deepEqual(auditOf(w, 'customer', 30001, 30400), oracleAudit('customer', range(30001, 125), jobId, 'race'), 'no duplicate audit rows')
  assert.equal(w.env.queue.length, 1, 'exactly one continuation, from the delivery that won the cursor')
})

check('A3 a redelivered first message after completion writes nothing', async () => {
  const w = bulkWorld(); w.useTier('free'); seedContacts(w, 'suppliers', 40001, 130)
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'suppliers', range(40001, 130), 'dup', w.actor)
  const first = { ...w.env.queue[0] }
  const deliveries = await w.drain()
  assert.equal(deliveries.length, 2)
  const before = auditOf(w, 'supplier', 40001, 40130)
  assert.equal(before.length, 130)
  w.env.queue.push(first)
  await w.drain()
  assert.deepEqual(auditOf(w, 'supplier', 40001, 40130), before)
  assert.equal(w.one('SELECT status,processed_count FROM bulk_delete_jobs WHERE id=?', jobId).status, 'completed')
})

check('A4 Cancel after one chunk keeps exactly that chunk; Cancel landing between the job read and the batch stops the chunk', async () => {
  const w = bulkWorld(); w.useTier('free'); seedContacts(w, 'delivery_contacts', 50001, 400)
  const a = await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', range(50001, 400), 'cancel', w.actor)
  await w.drain(1)
  assert.equal(w.one('SELECT processed_count FROM bulk_delete_jobs WHERE id=?', a.jobId).processed_count, 125)
  w.exec(`UPDATE bulk_delete_jobs SET cancel_requested=1 WHERE id='${a.jobId}'`)
  await w.drain()
  assert.deepEqual(w.one('SELECT status,processed_count FROM bulk_delete_jobs WHERE id=?', a.jobId), { status: 'cancelled', processed_count: 125 })
  assert.equal(w.one('SELECT COUNT(*) n FROM delivery_contacts WHERE id BETWEEN 50001 AND 50400').n, 275)
  assert.equal(auditOf(w, 'delivery_contact', 50001, 50400).length, 125)
  // Cancel arrives after this delivery read the job row but before its batch runs.
  const b = await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', range(51001, 10), 'cancel-late', w.actor)
  seedContacts(w, 'delivery_contacts', 51001, 10)
  w.counter.state.beforeBatch = () => { w.counter.state.beforeBatch = null; w.exec(`UPDATE bulk_delete_jobs SET cancel_requested=1 WHERE id='${b.jobId}'`) }
  await w.drain()
  assert.equal(w.one('SELECT status FROM bulk_delete_jobs WHERE id=?', b.jobId).status, 'cancelled')
  assert.equal(w.one('SELECT COUNT(*) n FROM delivery_contacts WHERE id BETWEEN 51001 AND 51010').n, 10, 'nothing deleted after the Cancel')
  assert.equal(auditOf(w, 'delivery_contact', 51001, 51010).length, 0)
})

check('A5 anonymous customers are never deleted: advisory read skips them, the in-batch guard refuses one marked after that read', async () => {
  const w = bulkWorld(); w.useTier('free'); seedContacts(w, 'customers', 60001, 20)
  w.exec('UPDATE customers SET is_anonymous=1 WHERE id=60005')
  const a = await w.engine.createBulkDeleteJob(w.env, 'customers', range(60001, 20), 'anon', w.actor)
  await w.drain()
  assert.equal(w.one('SELECT COUNT(*) n FROM customers WHERE id=60005').n, 1, 'the anonymous identity survives')
  assert.equal(w.one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 60001 AND 60020').n, 1)
  const job = w.one('SELECT status,processed_count,failed_count,failed_ids_json FROM bulk_delete_jobs WHERE id=?', a.jobId)
  assert.deepEqual([job.status, job.processed_count, job.failed_count, job.failed_ids_json], ['completed', 20, 1, '[60005]'])
  assert.equal(auditOf(w, 'customer', 60001, 60020).length, 19, 'no audit row for the id that was not deleted')
  // Marked between the advisory read and the batch: the whole chunk is refused and its ids reported failed, as before.
  seedContacts(w, 'customers', 61001, 10)
  const b = await w.engine.createBulkDeleteJob(w.env, 'customers', range(61001, 10), 'anon-late', w.actor)
  w.counter.state.beforeBatch = () => { w.counter.state.beforeBatch = null; w.exec('UPDATE customers SET is_anonymous=1 WHERE id=61003') }
  await w.drain()
  assert.equal(w.one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 61001 AND 61010').n, 10, 'the refused chunk deleted nothing')
  assert.equal(auditOf(w, 'customer', 61001, 61010).length, 0, 'and wrote no audit row')
  assert.equal(JSON.parse(w.one('SELECT failed_ids_json FROM bulk_delete_jobs WHERE id=?', b.jobId).failed_ids_json).length, 10)
})

check('A6 a chunk whose batch fails DETERMINISTICALLY is recorded as failed ids, nothing half-applied, and the job moves on', async () => {
  const w = bulkWorld(); w.useTier('free'); seedContacts(w, 'suppliers', 70001, 300)
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'suppliers', range(70001, 300), 'fail', w.actor)
  await w.drain(1)
  w.counter.state.beforeBatch = () => { w.counter.state.beforeBatch = null; throw new Error('D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT') }
  await w.drain(1)
  const mid = w.one('SELECT processed_count,failed_count,last_error FROM bulk_delete_jobs WHERE id=?', jobId)
  assert.equal(mid.processed_count, 250)
  assert.equal(mid.failed_count, 125)
  assert.match(mid.last_error, /FOREIGN KEY constraint failed/)
  assert.equal(w.one('SELECT COUNT(*) n FROM suppliers WHERE id BETWEEN 70126 AND 70250').n, 125, 'the failed chunk is whole, not half-deleted')
  assert.equal(auditOf(w, 'supplier', 70126, 70250).length, 0)
  await w.drain()
  assert.deepEqual(w.one('SELECT status,processed_count,failed_count FROM bulk_delete_jobs WHERE id=?', jobId), { status: 'completed', processed_count: 300, failed_count: 125 })
  assert.equal(auditOf(w, 'supplier', 70001, 70300).length, 175)
})

check('A7 the chunk is the plan field: Paid 500 means two deliveries for 1,000 ids, Free 125 means eight', async () => {
  const w = bulkWorld(); seedContacts(w, 'customers', 80001, 1000)
  w.useTier('paid')
  await w.engine.createBulkDeleteJob(w.env, 'customers', range(80001, 1000), 'paid', w.actor)
  const deliveries = await w.drain()
  assert.equal(deliveries.length, 2)
  assert.deepEqual(deliveries.filter((d) => d.error), [])
  assert.equal(w.one('SELECT COUNT(*) n FROM customers WHERE id BETWEEN 80001 AND 81000').n, 0)
  assert.equal(auditOf(w, 'customer', 80001, 81000).length, 1000)
})

check('A8 a job whose last chunk committed under the old whole-job loop is completed by the next delivery', async () => {
  const w = bulkWorld(); w.useTier('free')
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', range(90001, 5), 'legacy', w.actor)
  w.exec(`UPDATE bulk_delete_jobs SET status='processing', processed_count=5 WHERE id='${jobId}'`)
  await w.drain()
  assert.equal(w.one('SELECT status FROM bulk_delete_jobs WHERE id=?', jobId).status, 'completed')
})


// ---------------------------------------------------------------------------------------------------------------
// F. a lost acknowledgement must never stall a contacts job (review E1 of P1.2)
//
// The checks above run the engine over a stub db that has no retry. The REAL adapter retries a rejected db.batch() once
// (lib/db.ts withD1Retry), and a rejection does not say whether the batch committed. These checks run the REAL lib/db.ts
// adapter and the REAL import-maintenance fence over a D1 binding that can COMMIT a batch and then reject the call, as
// happens when the reply is lost. Before the fix the retried batch tripped the cursor guard, which the engine reads as
// "another delivery already did this chunk": the delivery returned with nothing queued and the job sat at 125 of 300 until
// the 20-minute reaper failed it. Each check runs on the Free chunk (125) and the Paid chunk (500), three chunks a job.
// ---------------------------------------------------------------------------------------------------------------
const TRANSIENT = 'D1_ERROR: Network connection lost'
// A D1Database over node:sqlite. A batch is one transaction. inject({ cursorBefore }) is asked about every chunk batch (the
// one that moves the job cursor) and may answer 'drop-ack' (commit, then reject) or 'fail-before' (reject, write nothing).
function fakeD1(sqlite, faults) {
  const make = (sql) => {
    let values = []
    const stmt = {
      sql,
      bind(...v) { values = v; return stmt },
      exec() {
        const s = sqlite.prepare(sql)
        if (s.columns().length) return { results: s.all(...values), success: true, meta: {} }
        const info = s.run(...values)
        return { results: [], success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
      },
      async all() { return stmt.exec() },
      async run() { return stmt.exec() },
    }
    return stmt
  }
  return {
    prepare: make,
    async batch(list) {
      // The chunk batch: it moves the cursor AND writes the audit rows. The single-statement write that records a failed chunk
      // moves the cursor too but is not the delete, so it is never faulted here.
      const isChunk = list.some((s) => /UPDATE bulk_delete_jobs SET processed_count/.test(s.sql)) && list.some((s) => /INSERT INTO audit_logs/.test(s.sql))
      const cursorBefore = isChunk ? sqlite.prepare('SELECT processed_count FROM bulk_delete_jobs').get().processed_count : null
      const action = isChunk && faults.inject ? faults.inject({ cursorBefore }) : null
      if (action === 'fail-before') { faults.fired += 1; throw new Error(TRANSIENT) }
      let results
      sqlite.exec('BEGIN')
      try { results = list.map((s) => s.exec()); sqlite.exec('COMMIT') } catch (error) { sqlite.exec('ROLLBACK'); throw error }
      if (action === 'drop-ack') { faults.fired += 1; throw new Error(TRANSIENT) }
      return results
    },
  }
}

function faultWorld(tier) {
  const raw = openDb(loadAll())
  const faults = { inject: null, fired: 0 }
  const env = { DB: fakeD1(raw.db, faults), PLAN_TIER: tier, queue: [], bumps: [], broadcasts: [] }
  // No './db' override: the engine gets the real adapter and the real fence.
  const load = makeLoader({
    './queueDispatch': { dispatchImportWork: async (e, message) => { e.queue.push(message); return 'queued' } },
    './cache': { bumpVersion: async (e, key) => { e.bumps.push(key) } },
    '../durable-objects/broadcastHub': { broadcast: async (e, key, payload) => { e.broadcasts.push({ key, payload }) } },
    './importEngine': { runD1BatchInChunks: async (db, statements) => { if (statements.length) await db.batch(statements) } },
  })
  const engine = load('lib/bulkDeleteEngine.ts')
  const planTier = load('lib/planTier.ts')
  planTier.__resetPlanTierCacheForTests()
  const chunk = planTier.getPlanLimits(env).bulkDeleteChunkSize
  const rows = (sql, ...bind) => plain(raw.db.prepare(sql).all(...bind))
  const one = (sql, ...bind) => plain(raw.db.prepare(sql).get(...bind))
  async function drain(max = 60) {
    const deliveries = []
    while (env.queue.length && deliveries.length < max) {
      const message = env.queue.shift()
      let error = null
      try { await quietly(() => engine.runBulkDeleteJob(env, message.jobId)) } catch (e) { error = String(e && e.message || e) }
      deliveries.push({ error })
      if (error) env.queue.push(message) // a thrown delivery is retried by the queue
    }
    return deliveries
  }
  return { raw, env, faults, engine, chunk, rows, one, drain, exec: (sql) => raw.db.exec(sql), actor: { id: 7, name: 'ana' } }
}

// Three chunks, the last one short: Free 125 + 125 + 50 = 300, Paid 500 + 500 + 200 = 1,200.
async function faultJob(tier, from, injectFor, drainMax = 60) {
  const w = faultWorld(tier)
  const n = 2 * w.chunk + Math.round(w.chunk * 0.4)
  seedContacts(w, 'customers', from, n)
  const ids = range(from, n)
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'customers', ids, 'fault', w.actor)
  w.faults.inject = injectFor(w.chunk, n)
  const deliveries = await w.drain(drainMax)
  return { w, n, from, ids, jobId, deliveries }
}
// P12_TIERS=paid runs the fault checks on one tier only (to show a tier red on its own).
const tiersUnderTest = (list) => list.filter(([tier]) => (process.env.P12_TIERS || 'free,paid').split(',').includes(tier))
const dropOnce = (when) => { let done = false; return (info) => (!done && when(info) ? ((done = true), 'drop-ack') : null) }
function assertFinishedOnce(r, label) {
  const { w } = r
  const job = w.one('SELECT status,processed_count,failed_count FROM bulk_delete_jobs WHERE id=?', r.jobId)
  assert.deepEqual(job, { status: 'completed', processed_count: r.n, failed_count: 0 }, `${label}: the job must finish, not stall (it is ${job.status} at ${job.processed_count} of ${r.n}, ${w.env.queue.length} messages queued)`)
  assert.equal(w.one(`SELECT COUNT(*) n FROM customers WHERE id BETWEEN ${r.from} AND ${r.from + r.n - 1}`).n, 0, `${label}: every customer deleted`)
  assert.deepEqual(auditOf(w, 'customer', r.from, r.from + r.n - 1), oracleAudit('customer', r.ids, r.jobId, 'fault'), `${label}: exactly one audit row per id, same columns, same order`)
}
const assertPublishedOnce = (r, label) => {
  assert.deepEqual(r.w.env.bumps, ['customers'], `${label}: the cache is invalidated once the job is finished`)
  assert.equal(r.w.env.broadcasts.length, 1, `${label}: one broadcast`)
  assert.deepEqual(r.w.env.broadcasts[0].payload.ids, r.ids, `${label}: it names the deleted ids`)
}

check('F1 the acknowledgement of the FIRST chunk is lost after it committed (Free and Paid): the job still finishes, one audit row per id', async () => {
  for (const [tier, from] of tiersUnderTest([['free', 100001], ['paid', 110001]])) {
    const r = await faultJob(tier, from, () => dropOnce((info) => info.cursorBefore === 0))
    assert.equal(r.w.faults.fired, 1, `${tier}: the fault fired`)
    assertFinishedOnce(r, tier)
    assertPublishedOnce(r, tier)
  }
})

check('F2 the acknowledgement of the LAST chunk is lost after it committed: the redelivery finishes the job (cache bump and broadcast), writes nothing twice', async () => {
  for (const [tier, from] of tiersUnderTest([['free', 120001], ['paid', 130001]])) {
    const r = await faultJob(tier, from, (chunk, n) => dropOnce((info) => info.cursorBefore + chunk >= n))
    assert.equal(r.w.faults.fired, 1, `${tier}: the fault fired`)
    assertFinishedOnce(r, tier)
    assertPublishedOnce(r, tier)
  }
})

check('F3 the acknowledgement of EVERY chunk is lost once: still one audit row per id and one cache bump', async () => {
  for (const [tier, from] of tiersUnderTest([['free', 140001], ['paid', 150001]])) {
    const seen = new Set()
    const r = await faultJob(tier, from, () => (info) => (seen.has(info.cursorBefore) ? null : (seen.add(info.cursorBefore), 'drop-ack')))
    assert.equal(r.w.faults.fired, 3, `${tier}: all three chunks lost their acknowledgement`)
    assertFinishedOnce(r, tier)
    assertPublishedOnce(r, tier)
  }
})

check('F4 a transient failure BEFORE the commit (nothing written) is retried, not recorded as failed ids', async () => {
  for (const [tier, from] of tiersUnderTest([['free', 160001], ['paid', 170001]])) {
    let done = false
    const r = await faultJob(tier, from, (chunk) => (info) => (!done && info.cursorBefore === chunk ? ((done = true), 'fail-before') : null))
    assert.equal(r.w.faults.fired, 1, `${tier}: the fault fired`)
    assertFinishedOnce(r, tier) // failed_count 0: no id was written off because of an infrastructure blip
  }
})

check('F5 a transient failure that never clears keeps the chunk pending: nothing is half-applied and no id is written off as failed', async () => {
  for (const [tier, from] of tiersUnderTest([['free', 180001], ['paid', 190001]])) {
    const r = await faultJob(tier, from, (chunk) => (info) => (info.cursorBefore === chunk ? 'fail-before' : null), 8)
    const { w } = r
    assert.deepEqual(w.one('SELECT status,processed_count,failed_count FROM bulk_delete_jobs WHERE id=?', r.jobId), { status: 'processing', processed_count: w.chunk, failed_count: 0 }, `${tier}: the cursor stays at the failing chunk, nothing recorded as failed`)
    assert.equal(w.one(`SELECT COUNT(*) n FROM customers WHERE id BETWEEN ${r.from} AND ${r.from + r.n - 1}`).n, r.n - w.chunk, `${tier}: the failing chunk is whole`)
    assert.equal(auditOf(w, 'customer', r.from, r.from + r.n - 1).length, w.chunk, `${tier}: and wrote no audit rows`)
    assert.equal(w.env.queue.length, 1, `${tier}: the message is still waiting for the next queue retry`)
    assert.ok(r.deliveries.filter((d) => d.error).length >= 2, `${tier}: every delivery threw so the queue keeps retrying`)
  }
})

check('F6 a redelivered message after the job finished deletes and audits nothing; it only repeats the cache invalidation', async () => {
  const r = await faultJob('free', 200001, () => () => null)
  assertFinishedOnce(r, 'free')
  assertPublishedOnce(r, 'free')
  const auditsBefore = auditOf(r.w, 'customer', r.from, r.from + r.n - 1)
  r.w.env.queue.push({ jobId: r.jobId, kind: 'bulk-delete' })
  const after = await r.w.drain()
  assert.deepEqual(after, [{ error: null }])
  assert.deepEqual(auditOf(r.w, 'customer', r.from, r.from + r.n - 1), auditsBefore)
  assert.equal(r.w.one(`SELECT COUNT(*) n FROM customers WHERE id BETWEEN ${r.from} AND ${r.from + r.n - 1}`).n, 0)
  assert.deepEqual(r.w.env.bumps, ['customers', 'customers'], 'the invalidation is repeated, nothing else')
})

const BULK = 'lib/bulkDeleteEngine.ts'
const CURSOR_GUARD = `
            AND processed_count=@cursor AND status='processing' AND cancel_requested=0)`
const MUTANTS = [
  { name: 'cursor guard removed from the chunk batch (duplicate delivery applies twice)', file: BULK, from: CURSOR_GUARD, to: `
            AND 1=1)`, world: 'bulk', catches: ['A2', 'A4'] },
  { name: 'audit statement left out of the atomic batch', file: BULK, from: '...deleteStatements, ...extraStatements, auditStatement, progress(failedIds, null),', to: '...deleteStatements, ...extraStatements, progress(failedIds, null),', world: 'bulk', catches: ['A1'] },
  { name: 'chunk size a literal 500 instead of the plan field', file: BULK, from: 'const chunk = allIds.slice(cursor, cursor + bulkDeleteChunkSize)\n    const next', to: 'const chunk = allIds.slice(cursor, cursor + 500)\n    const next', world: 'bulk', catches: ['A1', 'A7'] },
  { name: 'every delivery bumps and broadcasts instead of only the last', file: BULK, from: `await dispatchImportWork(env, { jobId, kind: 'bulk-delete' })\n      return\n    }\n  } else {`, to: `await dispatchImportWork(env, { jobId, kind: 'bulk-delete' })\n    }\n  } else {`, world: 'bulk', catches: ['A1'] },
  { name: 'in-batch anonymous-customer guard dropped', file: BULK, from: "...(job.entity_type === 'customers' && deleteChunk.length ? [buildAnonymousCustomerBulkDeleteGuard(deleteChunk)] : []),", to: '', world: 'bulk', catches: ['A5'] },
  { name: 'the chunk batch goes back to db.batch() (its retry turns a lost acknowledgement into a silent stall)', file: BULK, from: 'await db.batchOnce([', to: 'await db.batch([', world: 'fault', catches: ['F1', 'F3'] },
  { name: 'a transient failure is recorded as failed ids instead of thrown for the queue to retry', file: BULK, from: '      if (isRetryableD1Error(error)) throw error\n', to: '', world: 'fault', catches: ['F4', 'F5'] },
  { name: 'a redelivery after the last chunk returns without repeating the cache invalidation', file: BULK, from: 'if (ids) await publishContactsDelete(env, config, jobId, ids, failed)', to: 'if (ids) { /* tail dropped */ }', world: 'fault', catches: ['F2', 'F6'] },
]

runSuite(tests, MUTANTS).catch((error) => { console.error(error); process.exit(1) })
