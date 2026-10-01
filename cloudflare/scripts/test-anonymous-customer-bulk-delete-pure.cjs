const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const realLibModules = new Map()
function loadRealLib(relName) {
  relName = path.posix.normalize(relName)
  if (realLibModules.has(relName)) return realLibModules.get(relName).exports
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', `${relName}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const mod = { exports: {} }
  realLibModules.set(relName, mod)
  const localRequire = (id) => {
    // queueDispatch is pure and is what runBulkDeleteJob's self-continuation
    // enqueues through now; a {} stub makes dispatchImportWork undefined.
    if (id === './queueDispatch') return loadRealLib('queueDispatch')
    if (id === './planTier') return loadRealLib('planTier')
    if (id === './sqlBinding') return loadRealLib('sqlBinding')
    if (id === './anonymousCustomer') return loadRealLib('anonymousCustomer')
    if (id === './actorSnapshot') return loadRealLib('actorSnapshot')
    if (id === './importEngine') return { runD1BatchInChunks: async () => { throw new Error('unused') } }
    if (id === './cache') return { bumpVersion: async () => { throw new Error('unused') } }
    if (id === '../durable-objects/broadcastHub') return { broadcast: async () => { throw new Error('unused') } }
    if (id.startsWith('.')) return loadRealLib(path.posix.join(path.posix.dirname(relName), id).replace(/\.ts$/, ''))
    return require(id)
  }
  try { new Function('exports','require','module', outputText)(mod.exports, localRequire, mod) }
  catch (error) { realLibModules.delete(relName); throw error }
  return mod.exports
}

;(async () => {
const bulk = loadRealLib('bulkDeleteEngine')
const db = openDb(loadAll())
db.prepare("INSERT INTO customers (id,name,is_anonymous) VALUES (1,'Profile',0),(2,'Marker',1)").run()

const markerDelete = bulk.buildCoreDeleteStatements(bulk.ENTITY_CONFIGS.customers, [2])
assert.equal(markerDelete.length, 1)
assert.match(markerDelete[0].sql, /NOT \(COALESCE\(is_anonymous, 0\) = 1\)/)
assert.equal(db.prepare(markerDelete[0].sql).bind(...markerDelete[0].params).run().meta.changes, 0)
assert.ok(db.prepare('SELECT id FROM customers WHERE id=2').get())

const guard = bulk.buildAnonymousCustomerBulkDeleteGuard([1])
db.prepare('UPDATE customers SET is_anonymous=1 WHERE id=1').run()
await assert.rejects(() => db.batch([guard, ...bulk.buildCoreDeleteStatements(bulk.ENTITY_CONFIGS.customers, [1])]), /malformed JSON|anonymous_customer_immutable/)
assert.ok(db.prepare('SELECT id FROM customers WHERE id=1').get(), 'post-plan marker survives the queue execution batch')

assert.equal(guard.params.customerIds, '[1]')
assert.equal(Object.keys(guard.params).length, 1, 'guard uses one JSON bind regardless of chunk size')
assert.match(guard.sql, /json_each\(@customerIds\)/)

console.log('anonymous customer bulk delete: 8 checks passed')
await lifecycleQueueAdmission()
})().catch((error) => { console.error(error); process.exitCode = 1 })

async function lifecycleQueueAdmission() {
  const { HTTPException } = require('hono/http-exception')
  const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
  const lifecycle = loadRealLib('stockLifecycle')
  assert.strictEqual(lifecycle, loadRealLib('stockLifecycle'))
  assert.equal(typeof loadRealLib('db').getImportFencedDb, 'function')
  for (const table of ['stock_disposition_sources', 'stock_funding_dependencies']) {
    const sql = openDb([]).db
    sql.exec(`CREATE TABLE ${table}(movement_id INTEGER,batch_id INTEGER,product_id INTEGER,branch_id INTEGER,supplier_id INTEGER);
      INSERT INTO ${table} VALUES(701,501,100,1,77);
      CREATE TABLE bulk_delete_jobs(id TEXT PRIMARY KEY,entity_type TEXT,status TEXT DEFAULT 'pending',reason TEXT,ids_json TEXT,total_count INTEGER,created_by_id INTEGER,created_by_name TEXT);
      CREATE TABLE durable_marker(id INTEGER PRIMARY KEY,payload BLOB,amount INTEGER,label TEXT);
      INSERT INTO durable_marker VALUES(1,X'0001ff00',9007199254740993,'ខ្មែរ');`)
    const calls = { run: 0, batch: 0, queue: [] }
    const statement = (text, values = []) => ({
      bind: (...next) => statement(text, next),
      first: async () => sqliteD1Call(sql.prepare(text), 'get', values) ?? null,
      all: async () => ({ results: sqliteD1Call(sql.prepare(text), 'all', values) }),
      run: async () => { calls.run += 1; return { meta: { changes: Number(sqliteD1Call(sql.prepare(text), 'run', values).changes) } } },
    })
    const env = { DB: { prepare: text => statement(text), batch: async () => { calls.batch += 1; throw new Error('Unexpected job admission batch') } }, IMPORT_QUEUE: { send: async message => { calls.queue.push(message) } } }
    const state = () => {
      const marker = sql.prepare('SELECT hex(payload) AS blob,CAST(amount AS TEXT) AS integer,label FROM durable_marker').all()
      return JSON.stringify([sql.prepare(`SELECT * FROM ${table}`).all(), sql.prepare('SELECT * FROM bulk_delete_jobs').all(), marker])
    }
    const before = state()
    await assert.rejects(bulkJob(env, [78, 77]), error => error instanceof HTTPException && error.status === 409 && error.code === 'stock_lifecycle_dependency')
    assert.equal(state(), before)
    assert.deepEqual(calls, { run: 0, batch: 0, queue: [] })
    const unrelated = await bulkJob(env, [78])
    assert.deepEqual({ ...sql.prepare('SELECT entity_type,status,ids_json,total_count FROM bulk_delete_jobs WHERE id=?').get(unrelated.jobId) }, { entity_type: 'suppliers', status: 'pending', ids_json: '[78]', total_count: 1 })
    assert.deepEqual(calls.queue, [{ jobId: unrelated.jobId, kind: 'bulk-delete' }])
    assert.equal(calls.run, 1)
    assert.equal(calls.batch, 0)
    sql.exec(`DELETE FROM ${table}`)
    const empty = await bulkJob(env, [77])
    assert.equal(sql.prepare('SELECT COUNT(*) count FROM bulk_delete_jobs').get().count, 2)
    assert.equal(calls.queue[1].jobId, empty.jobId)
    assert.equal(calls.run, 2)
    sql.close()
  }
  for (let attempt = 0; attempt < 2; attempt += 1) assert.throws(() => loadRealLib('absent-customer-fixture'), /ENOENT/)
  console.log('PASS actual supplier queue admission refuses both linked source families before writes or dispatch; unrelated and empty positives enqueue')
}

async function bulkJob(env, ids) {
  return loadRealLib('bulkDeleteEngine').createBulkDeleteJob(env, 'suppliers', ids, 'Fixture admission', { id: 71, name: 'Fixture operator' })
}
