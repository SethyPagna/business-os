'use strict'
// Lane P1.2 (S4): contacts bulk delete (customers, suppliers, delivery contacts) on the Workers Free plan's limit of 50
// D1 calls per invocation. It used to loop every chunk inside ONE queue invocation (~6 calls a chunk), so 1,000 ids hit
// call 51, threw and were retried. Now a delivery does ONE chunk and re-enqueues the next, as the products path does.
//
// Runs the REAL lib/bulkDeleteEngine.ts against the full migrated schema in node:sqlite, every D1 call counted and
// call 51 refused as Cloudflare refuses it. Pinned: eight deliveries of a handful of calls for 1,000 ids on Free; the
// audit rows (same columns, same order, one per id); a duplicate or concurrent delivery applies a chunk once; Cancel
// stops a chunk read before it; the advisory and in-batch anonymous-customer guards; a failed chunk's ids; the Paid
// chunk; one cache bump for the whole job. Mutants (wrong implementations) at the end must each turn a check red.
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
function bulkWorld() {
  const raw = openDb(loadAll())
  const counter = countingDb(raw)
  const env = { DB: counter.db, PLAN_TIER: 'free', queue: [], bumps: [], broadcasts: [] }
  const load = makeLoader({
    './db': { getDb: (e) => e.DB, getImportFencedDb: async (e) => e.DB, isImportMaintenanceFenceError: () => false },
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

check('A6 a chunk whose batch fails is recorded as failed ids, nothing half-applied, and the job moves on', async () => {
  const w = bulkWorld(); w.useTier('free'); seedContacts(w, 'suppliers', 70001, 300)
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'suppliers', range(70001, 300), 'fail', w.actor)
  await w.drain(1)
  w.counter.state.beforeBatch = () => { w.counter.state.beforeBatch = null; throw new Error('D1_ERROR: simulated transient failure') }
  await w.drain(1)
  const mid = w.one('SELECT processed_count,failed_count,last_error FROM bulk_delete_jobs WHERE id=?', jobId)
  assert.equal(mid.processed_count, 250)
  assert.equal(mid.failed_count, 125)
  assert.match(mid.last_error, /simulated transient failure/)
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
]

runSuite(tests, MUTANTS).catch((error) => { console.error(error); process.exit(1) })
