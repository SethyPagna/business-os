'use strict'
// Delivery person delete guard: a delivery_contacts row named by a sale (sales.delivery_contact_id) or a delivery fee
// (fees.delivery_contact_id) is never hard-deleted, on both writers: DELETE /delivery-contacts/:id
// (deleteDeliveryContactUnlessUsed) and the bulk-delete engine. Runs the REAL libs on the full migrated schema.
// Merge repointing of the same two columns is pinned by test-contact-merge-atomic-pure.cjs / -repoints-pure.cjs.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { makeLoader, countingDb, plain, quietly, runSuite, SRC } = require('./harness/free_call_budget.cjs')

const tests = []
const check = (name, fn) => tests.push({ name, fn })
const realDb = makeLoader({})('lib/db.ts')

function world() {
  const raw = openDb(loadAll())
  const counter = countingDb(raw)
  const env = { DB: counter.db, PLAN_TIER: 'free', queue: [], bumps: [], broadcasts: [] }
  const load = makeLoader({
    './db': { getDb: (e) => e.DB, getImportFencedDb: async (e) => e.DB, isImportMaintenanceFenceError: () => false, isRetryableD1Error: realDb.isRetryableD1Error },
    './queueDispatch': { dispatchImportWork: async (e, m) => { e.queue.push(m); return 'queued' } },
    './cache': { bumpVersion: async (e, k) => { e.bumps.push(k) } },
    '../durable-objects/broadcastHub': { broadcast: async (e, k, p) => { e.broadcasts.push({ k, p }) } },
    './importEngine': { runD1BatchInChunks: async (db, s) => { if (s.length) await db.batch(s) } },
  })
  const exec = (sql) => raw.db.exec(sql)
  const rows = (sql, ...b) => plain(raw.db.prepare(sql).all(...b))
  const one = (sql, ...b) => plain(raw.db.prepare(sql).get(...b))
  exec(`INSERT INTO delivery_contacts(id,name) VALUES (1,'On a sale'),(2,'On a fee'),(3,'Free driver'),(4,'On both'),(5,'Other free')`)
  exec(`INSERT INTO sales(id,delivery_contact_id,delivery_contact_name) VALUES (101,1,'On a sale'),(102,4,'On both')`)
  exec(`INSERT INTO fees(fee_type,amount_usd,amount_khr,fee_date,delivery_contact_id) VALUES ('delivery',2,8200,'2026-11-01',2),('delivery',2,8200,'2026-11-01',4)`)
  return { raw, counter, env, exec, rows, one, guard: load('lib/contactDeleteGuard.ts'), engine: load('lib/bulkDeleteEngine.ts'), actor: { id: 7, name: 'ana' } }
}
const live = (w) => w.rows('SELECT id FROM delivery_contacts ORDER BY id').map((r) => r.id)
async function drain(w) {
  const out = []
  while (w.env.queue.length && out.length < 20) { const m = w.env.queue.shift(); await quietly(() => w.engine.runBulkDeleteJob(w.env, m.jobId)); out.push(m) }
}

check('D1 single delete of a person on a sale is refused with contact_has_sales and the row stays', async () => {
  const w = world()
  const r = await w.guard.deleteDeliveryContactUnlessUsed(w.env.DB, 1, 'On a sale')
  assert.equal(r.deleted, false); assert.equal(r.body.code, 'contact_has_sales'); assert.equal(r.body.sales, 1); assert.equal(r.body.fees, 0)
  assert.match(r.body.error, /merge it in Conflicts/, 'a refusal says what to do instead, naming the real tab')
  assert.doesNotMatch(r.body.error, /Possible Duplicates/)
  assert.deepEqual(live(w), [1, 2, 3, 4, 5])
})
check('D2 single delete of a person on a delivery fee only is refused', async () => {
  const w = world()
  const r = await w.guard.deleteDeliveryContactUnlessUsed(w.env.DB, 2, 'On a fee')
  assert.equal(r.deleted, false); assert.equal(r.body.fees, 1); assert.equal(r.body.sales, 0)
  assert.ok(live(w).includes(2))
})
check('D3 single delete of an unreferenced person succeeds', async () => {
  const w = world()
  w.counter.state.calls = 0
  assert.deepEqual(await w.guard.deleteDeliveryContactUnlessUsed(w.env.DB, 3, 'Free driver'), { deleted: true })
  assert.equal(w.counter.state.calls, 1, 'a successful delete is one D1 call (no pre-read)')
  assert.deepEqual(live(w), [1, 2, 4, 5])
})
check('D4 a sale saved between the read and the delete aborts the delete (in-batch guard), still a refusal', async () => {
  const w = world()
  w.counter.state.beforeBatch = () => { w.exec(`INSERT INTO sales(id,delivery_contact_id,delivery_contact_name) VALUES (103,3,'Free driver')`) }
  const r = await w.guard.deleteDeliveryContactUnlessUsed(w.env.DB, 3, 'Free driver')
  assert.equal(r.deleted, false); assert.equal(r.body.code, 'contact_has_sales')
  assert.ok(live(w).includes(3), 'the row survives')
})
check('D4b the fees half of the in-batch guard: a delivery fee saved between the read and the delete still blocks it', async () => {
  const w = world()
  w.counter.state.beforeBatch = () => { w.exec(`INSERT INTO fees(fee_type,amount_usd,amount_khr,fee_date,delivery_contact_id) VALUES ('delivery',2,8200,'2026-11-02',3)`) }
  const r = await w.guard.deleteDeliveryContactUnlessUsed(w.env.DB, 3, 'Free driver')
  assert.equal(r.deleted, false); assert.equal(r.body.code, 'contact_has_sales'); assert.equal(r.body.fees, 1)
  assert.ok(live(w).includes(3))
})
check('D5 bulk delete of a mixed selection deletes the free ones, keeps the referenced ones, reports them, audits only deletions', async () => {
  const w = world()
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', [1, 2, 3, 4, 5], 'cleanup', w.actor)
  await drain(w)
  assert.deepEqual(live(w), [1, 2, 4])
  const job = w.one('SELECT status, processed_count, failed_count, failed_ids_json, last_error FROM bulk_delete_jobs WHERE id=?', jobId)
  assert.equal(job.status, 'completed'); assert.equal(job.failed_count, 3)
  assert.deepEqual(JSON.parse(job.failed_ids_json).sort(), [1, 2, 4])
  assert.match(job.last_error, /^contact_has_sales/)
  assert.deepEqual(w.rows(`SELECT entity_id FROM audit_logs WHERE entity='delivery_contact' AND action='delete' ORDER BY entity_id`).map((r) => r.entity_id), ['3', '5'])
})
check('D6 bulk delete of only unreferenced people deletes all and records no failure', async () => {
  const w = world()
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', [3, 5], 'cleanup', w.actor)
  await drain(w)
  assert.deepEqual(live(w), [1, 2, 4])
  const job = w.one('SELECT failed_count, last_error FROM bulk_delete_jobs WHERE id=?', jobId)
  assert.equal(job.failed_count, 0); assert.equal(job.last_error, null)
})
const oneShot = (w, sql) => { let fired = false; w.counter.state.beforeBatch = () => { if (!fired) { fired = true; w.exec(sql) } } }
check('D7 bulk: a sale saved after the chunk read trips the guard; the chunk is retried once without it, the free id still deletes, the code is contact_has_sales', async () => {
  const w = world()
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', [3, 5], 'cleanup', w.actor)
  oneShot(w, "INSERT INTO sales(id,delivery_contact_id,delivery_contact_name) VALUES (104,3,'Free driver')")
  await drain(w)
  assert.deepEqual(live(w).filter((id) => id === 3 || id === 5), [3], 'id 5 deleted, id 3 kept')
  assert.deepEqual(w.rows(`SELECT entity_id FROM audit_logs WHERE entity='delivery_contact' AND action='delete'`).map((r) => r.entity_id), ['5'], 'audit only for the deleted id')
  const job = w.one('SELECT status, failed_count, failed_ids_json, last_error FROM bulk_delete_jobs WHERE id=?', jobId)
  assert.equal(job.status, 'completed'); assert.equal(job.failed_count, 1); assert.deepEqual(JSON.parse(job.failed_ids_json), [3])
  assert.equal(job.last_error, 'contact_has_sales: [3]', 'the code, not the raw database message')
})
check('D7b bulk: a second trip in the retry records the chunk as kept under contact_has_sales (bounded: one retry only)', async () => {
  const w = world()
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', [3, 5], 'cleanup', w.actor)
  let n = 0
  w.counter.state.beforeBatch = () => { n += 1; w.exec(`INSERT INTO sales(id,delivery_contact_id,delivery_contact_name) VALUES (${900 + n},${n === 1 ? 3 : 5},'x')`) }
  await drain(w)
  assert.ok(live(w).includes(3) && live(w).includes(5), 'nothing deleted')
  assert.equal(n, 2, 'exactly one retry')
  const job = w.one('SELECT status, failed_count, last_error FROM bulk_delete_jobs WHERE id=?', jobId)
  assert.equal(job.status, 'completed'); assert.equal(job.failed_count, 2)
  assert.equal(job.last_error, 'contact_has_sales: [3,5]')
})
check('D7c bulk across chunks: last_error keeps the whole kept list, not only the last chunk', async () => {
  const w = world(); w.useFree = true
  for (let i = 0; i < 130; i += 1) w.exec(`INSERT INTO delivery_contacts(id,name) VALUES (${2000 + i},'bulk ${i}')`)
  w.exec("INSERT INTO sales(id,delivery_contact_id,delivery_contact_name) VALUES (801,2001,'x'),(802,2127,'x')")
  const { jobId } = await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', Array.from({ length: 130 }, (_, i) => 2000 + i), 'cleanup', w.actor)
  await drain(w)
  const job = w.one('SELECT status, failed_count, last_error FROM bulk_delete_jobs WHERE id=?', jobId)
  assert.equal(job.status, 'completed'); assert.equal(job.failed_count, 2)
  assert.equal(job.last_error, 'contact_has_sales: [2001,2127]')
  assert.equal(w.one('SELECT COUNT(*) n FROM delivery_contacts WHERE id >= 2000').n, 2)
})
check('D8 bulk chunk stays a fixed handful of D1 calls (one usage read per chunk, not per id)', async () => {
  const w = world()
  for (let i = 0; i < 100; i += 1) w.exec(`INSERT INTO delivery_contacts(id,name) VALUES (${1000 + i},'bulk ${i}')`)
  await w.engine.createBulkDeleteJob(w.env, 'delivery_contacts', Array.from({ length: 100 }, (_, i) => 1000 + i), 'cleanup', w.actor)
  const m = w.env.queue.shift(); w.counter.state.calls = 0
  await quietly(() => w.engine.runBulkDeleteJob(w.env, m.jobId))
  assert.ok(w.counter.state.calls <= 8, `calls ${w.counter.state.calls}`)
})
check('D9 the route delegates its delivery-contact delete to the guard', () => {
  const src = fs.readFileSync(path.join(SRC, 'routes', 'contacts.ts'), 'utf8')
  assert.match(src, /deleteDeliveryContactUnlessUsed\(db, Number\(id\), current\.name\)/)
  assert.match(src, /return c\.json\(outcome\.body, 409\)/)
})

const G = 'lib/contactDeleteGuard.ts'
const B = 'lib/bulkDeleteEngine.ts'
const MUTANTS = [
  { name: 'usage read ignores sales', file: G, from: `SELECT delivery_contact_id AS contact_id, 'sales' AS kind FROM sales`, to: `SELECT delivery_contact_id AS contact_id, 'sales' AS kind FROM sales WHERE 0`, catches: ['D1', 'D5'] },
  { name: 'usage read ignores fees', file: G, from: `SELECT delivery_contact_id AS contact_id, 'fees' AS kind FROM fees`, to: `SELECT delivery_contact_id AS contact_id, 'fees' AS kind FROM fees WHERE 0`, catches: ['D2', 'D5'] },
  { name: 'refusal loses its contact_has_sales code', file: G, from: 'code: CONTACT_HAS_SALES_CODE,', to: "code: 'conflict',", catches: ['D1', 'D4'] },
  { name: 'in-batch guard ignores fees', file: G, from: ' OR EXISTS (SELECT 1 FROM fees WHERE ${named})', to: '', catches: ['D4b'] },
  { name: 'in-batch guard removed from the single delete', file: G, from: 'await db.batch([buildDeliveryContactUsageGuard([id]), { sql', to: 'await db.batch([{ sql', catches: ['D4'] },
  { name: 'bulk engine deletes referenced people too', file: B, from: `deleteChunk = deleteChunk.filter((id) => !named.has(id))`, to: ``, catches: ['D5'] },
  { name: 'bulk in-batch guard removed', file: B, from: `...(job.entity_type === 'delivery_contacts' && deleteChunk.length ? [buildDeliveryContactUsageGuard(deleteChunk)] : []),`, to: '', catches: ['D7', 'D7b'] },
  { name: 'bulk race: no retry, the whole chunk is recorded failed', file: B, from: 'if (named.size) { keepNamed(named); continue }', to: '', catches: ['D7'] },
  { name: 'bulk race: unbounded retry', file: B, from: '&& !racedOnce) {', to: ') {', catches: ['D7b'] },
  { name: 'bulk: earlier chunks kept ids dropped', file: B, from: 'if (earlier) keptIds = (JSON.parse(earlier[1]) as number[]).map(Number)', to: '', catches: ['D7c'] },
  { name: 'bulk refusal not reported on the job', file: B, from: 'progress(failedIds, keptNote)', to: 'progress(failedIds, null)', catches: ['D5'] },
]
runSuite(tests, MUTANTS).catch((e) => { console.error(e); process.exit(1) })
