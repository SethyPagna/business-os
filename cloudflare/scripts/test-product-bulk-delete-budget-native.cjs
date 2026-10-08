const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')
const root = path.join(__dirname, '..', 'src')
const modules = new Map()
function load(file) {
  if (modules.has(file)) return modules.get(file)
  const mod = { exports: {} }
  modules.set(file, mod.exports)
  const resolve = id => {
    if (id === './importEngine') return { runD1BatchInChunks: async () => { throw new Error('non-product path') } }
    if (id === '../durable-objects/broadcastHub') return { broadcast: async (env, channel, payload) => {
      if (env.failBroadcast) { env.failBroadcast = false; throw new Error('broadcast unavailable') }
      env.broadcasts.push({ channel, payload })
    } }
    if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'))
    return require(id)
  }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports)
  return mod.exports
}
const { runBulkDeleteJob, createBulkDeleteJob } = load(path.join(root, 'lib/bulkDeleteEngine.ts'))
const tier = load(path.join(root, 'lib/planTier.ts'))
const cache = load(path.join(root, 'lib/cache.ts'))
const productSource = ts.createSourceFile('products.ts', fs.readFileSync(path.join(root, 'routes/products.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const indexNames = new Set(['SEARCH_INDEX_FORMAT', 'SEARCH_INDEX_PAGE_IDS', 'fnv1aHex', 'buildProductSearchIndexPage'])
const indexSource = productSource.statements.filter(node => indexNames.has(node.name?.text)
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => indexNames.has(item.name.text))))
  .map(node => node.getText(productSource)).join('\n')
const indexModule = { exports: {} }
new Function('getDb', 'catalogProductSql', 'module', 'exports', ts.transpileModule(indexSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(load(path.join(root, 'lib/db.ts')).getDb, load(path.join(root, 'lib/productStockGuard.ts')).catalogProductSql, indexModule, indexModule.exports)
const { buildProductSearchIndexPage } = indexModule.exports
function fixture(plan, total) {
  const raw = new DatabaseSync(':memory:')
  for (const sql of loadAll()) raw.exec(sql)
  const ids = Array.from({ length: total }, (_, i) => 10000 + i)
  const insert = raw.prepare('INSERT INTO products(id,name,barcode,is_active,stock_quantity) VALUES(?,?,?,1,0)')
  for (const id of ids) insert.run(id, `fixture ${id}`, `BUDGET${id}`)
  raw.prepare("INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count) VALUES('budget','products','pending','fixture',?,?)").run(JSON.stringify(ids), total)
  const state = { statements: 0, ceiling: plan === 'free' ? 50 : 1000, beforeBatch: null, afterBatch: null, queued: [], failOnce: new Set(), faults: [], failKvPut: false }
  const count = n => { state.statements += n; if (state.statements > state.ceiling) throw new Error('fixture invocation query budget exceeded') }
  const fault = sql => {
    const kind = /SELECT namespace, version FROM cache_versions/.test(sql) ? 'cache-read'
      : /INSERT INTO quota_usage/.test(sql) ? 'quota-write'
      : /INSERT INTO cache_versions/.test(sql) ? 'cache-batch' : null
    if (state.failOnce.delete(kind)) { state.faults.push(kind); throw new Error(`D1_ERROR: internal error ${kind}`) }
  }
  const prepare = sql => {
    let values = []
    const exec = () => {
      const stmt = raw.prepare(sql)
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) return { results: stmt.all(...values), meta: { changes: 0 } }
      const result = stmt.run(...values)
      return { results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    }
    const stmt = { bind(...args) { assert.ok(args.length <= 100, 'native D1 binding ceiling'); values = args; return stmt }, async first() { count(1); fault(sql); return raw.prepare(sql).get(...values) ?? null }, async all() { count(1); fault(sql); return exec() }, async run() { count(1); fault(sql); return exec() }, _exec: exec, sql }
    return stmt
  }
  const DB = { prepare, async batch(list) {
    count(list.length)
    for (const stmt of list) fault(stmt.sql)
    const hook = state.beforeBatch; state.beforeBatch = null; if (hook) hook(list)
    raw.exec('BEGIN IMMEDIATE')
    let out
    try { out = list.map(s => s._exec()); raw.exec('COMMIT') } catch (error) { raw.exec('ROLLBACK'); throw error }
    const after = state.afterBatch; state.afterBatch = null; if (after) after()
    return out
  } }
  const kv = new Map()
  const env = { DB, PLAN_TIER: plan, broadcasts: [], CACHE: { get: async k => kv.get(k) ?? null, put: async (k,v) => { if (state.failKvPut) throw new Error('KV unavailable'); kv.set(k,v) }, delete: async k => kv.delete(k) }, IMPORT_QUEUE: { send: async body => state.queued.push(body) } }
  const run = async (reset = true) => { if (reset) state.statements = 0; tier.__resetPlanTierCacheForTests(); await runBulkDeleteJob(env, 'budget'); return state.statements }
  const job = () => raw.prepare("SELECT * FROM bulk_delete_jobs WHERE id='budget'").get()
  const audits = () => raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='product' AND action='delete'").get().n
  return { raw, ids, state, env, kv, run, job, audits }
}
async function terminalRecovery() {
  const previousCaches = globalThis.caches
  const entries = new Map()
  globalThis.caches = { default: { match: async req => entries.get(req.url)?.clone(), put: async (req, response) => entries.set(req.url, response.clone()) } }
  try {
    for (const plan of ['free', 'paid']) for (const outcome of ['completed', 'cancelled', 'cancelled-race', 'failed']) {
      entries.clear()
      const cap = plan === 'free' ? 125 : 500
      const f = fixture(plan, outcome === 'completed' ? 2 : cap + 3)
      f.raw.exec("UPDATE bulk_delete_jobs SET status='processing'")
      if (outcome !== 'completed') f.raw.prepare('UPDATE products SET stock_quantity=1 WHERE id=?').run(f.ids[0])
      f.kv.set('v2:products', '9')
      const tasks = []
      const request = new Request('https://fixture.test/api/products/search-index?page=5&format=1')
      const read = async () => {
        const version = await cache.getVersionWithFallback(f.env, 'products')
        const value = await cache.cachedJsonResponse(request, { waitUntil: task => tasks.push(task) }, version, 3600,
          () => buildProductSearchIndexPage(f.env, 5, version))
        await Promise.all(tasks.splice(0))
        return value
      }
      assert.equal((await read()).rows.length, f.ids.length, 'actual search index is warm before removal')
      f.state.afterBatch = () => { throw new Error('D1_ERROR: internal error after committed chunk') }
      await assert.rejects(f.run(), /after committed chunk/)
      assert.equal(f.env.broadcasts.length, 0, 'lost acknowledgement skipped tail')
      const processed = f.job().processed_count
      const failed = new Set(JSON.parse(f.job().failed_ids_json))
      const removed = f.ids.slice(0, processed).filter(id => !failed.has(id))
      const remaining = f.ids.filter(id => !removed.includes(id))
      assert.equal(f.audits(), removed.length, 'lost acknowledgement commits one audit per removed product')
      if (outcome === 'cancelled') f.raw.exec('UPDATE bulk_delete_jobs SET cancel_requested=1')
      if (outcome === 'cancelled-race') f.state.beforeBatch = () => f.raw.exec('UPDATE bulk_delete_jobs SET cancel_requested=1')
      if (outcome === 'failed') f.raw.exec("UPDATE bulk_delete_jobs SET status='failed',last_error='fixture partial failure'")
      await f.run()
      assert.equal(f.job().status, outcome === 'cancelled-race' ? 'cancelled' : outcome)
      const saved = JSON.stringify(f.job())
      const audits = f.raw.prepare('SELECT * FROM audit_logs ORDER BY id').all()
      const products = f.raw.prepare('SELECT * FROM products ORDER BY id').all()
      assert.deepEqual((await read()).rows.map(row => row[0]), remaining, `${plan}/${outcome}: replay invalidates actual warm 3600s index`)
      assert.equal(f.env.broadcasts.length, 1)
      assert.deepEqual(f.env.broadcasts[0], { channel: 'products', payload: { action: 'bulk-delete', jobId: 'budget' } })
      for (let repeat = 0; repeat < 2; repeat++) {
        await f.run()
        assert.equal(JSON.stringify(f.job()), saved, 'cache-only replay leaves cursor/status/error/timestamps unchanged')
        assert.deepEqual(f.raw.prepare('SELECT * FROM audit_logs ORDER BY id').all(), audits)
        assert.deepEqual(f.raw.prepare('SELECT * FROM products ORDER BY id').all(), products, 'membership and quantity are never rewritten')
      }
      f.env.failBroadcast = true
      await assert.rejects(f.run(), /broadcast unavailable/)
      await f.run()
      assert.equal(JSON.stringify(f.job()), saved)
      assert.deepEqual(f.raw.prepare('SELECT * FROM audit_logs ORDER BY id').all(), audits, 'failed recovery broadcast cannot replay business writes')
      f.kv.clear()
      f.state.failKvPut = true
      const expectedFaults = plan === 'free' ? ['cache-read', 'quota-write', 'cache-batch'] : ['cache-read', 'cache-batch']
      f.state.failOnce = new Set(expectedFaults)
      const attempts = await f.run()
      assert.deepEqual(f.state.faults, expectedFaults, 'actual D1Compat retries count all cold cache attempts')
      assert.ok(attempts <= f.state.ceiling)
      assert.deepEqual((await read()).rows.map(row => row[0]), remaining, 'D1 fallback cache also invalidates')
      console.log(`PASS ${plan}/${outcome} final/partial acknowledgement recovery, repeated cache-only replay and cold retries (${attempts} attempts)`)
      f.raw.close()
    }
    for (const status of ['completed', 'cancelled', 'failed']) for (const allFailed of [false, true]) {
      const f = fixture('free', 2)
      f.raw.prepare('UPDATE bulk_delete_jobs SET status=?,processed_count=?,failed_count=?,failed_ids_json=?').run(status, allFailed ? 2 : 0, allFailed ? 2 : 0, allFailed ? JSON.stringify(f.ids) : '[]')
      await f.run()
      assert.equal(f.kv.size, 0, 'zero successful progress has no invalidation')
      assert.equal(f.env.broadcasts.length, 0)
      assert.equal(f.audits(), 0)
      f.raw.close()
    }
    for (const plan of ['free', 'paid']) {
      const f = fixture(plan, (plan === 'free' ? 125 : 500) + 3)
      f.state.failKvPut = true
      const expectedFaults = plan === 'free' ? ['cache-read', 'quota-write', 'cache-batch'] : ['cache-read', 'cache-batch']
      f.state.failOnce = new Set(expectedFaults)
      const attempts = await f.run()
      assert.deepEqual(f.state.faults, expectedFaults)
      assert.ok(attempts <= f.state.ceiling)
      assert.equal(f.state.queued.length, 1)
      console.log(`PASS ${plan} full chunk cold cache/fallback/retry budget (${attempts} attempted statements)`)
      f.raw.close()
    }
    const pending = fixture('free', 2)
    pending.state.beforeBatch = () => { throw new Error('pending admission failed') }
    await assert.rejects(pending.run(), /pending admission failed/)
    assert.equal(pending.job().status, 'pending')
    assert.equal(pending.env.broadcasts.length, 0)
    assert.equal(pending.kv.size, 0)
    pending.raw.close()
    const absent = fixture('free', 2)
    absent.raw.exec('UPDATE products SET is_active=0')
    await absent.run()
    await absent.run()
    assert.equal(absent.audits(), 0, 'already absent ids never gain fabricated business effects')
    absent.raw.close()
    const contact = fixture('free', 2)
    contact.raw.exec("UPDATE bulk_delete_jobs SET entity_type='customers',status='completed',processed_count=2")
    await contact.run()
    assert.equal(contact.kv.size, 0, 'legacy non-product terminal flow is unchanged')
    assert.equal(contact.env.broadcasts.length, 0)
    contact.raw.exec('DELETE FROM bulk_delete_jobs')
    await contact.run()
    assert.equal(contact.kv.size, 0, 'missing job remains a no-op')
    contact.raw.close()
    const large = fixture('free', 2)
    large.raw.prepare("UPDATE bulk_delete_jobs SET status='completed',processed_count=50000,total_count=50000,ids_json=?").run(JSON.stringify(Array.from({ length: 50000 }, (_, i) => i + 1)))
    await large.run()
    assert.ok(JSON.stringify(large.env.broadcasts[0]).length < 100, 'terminal recovery broadcasts a bounded namespace event for 50k ids')
    assert.equal(large.audits(), 0)
    large.raw.close()
    console.log('PASS pending failure, zero progress, all-failed, absent ids, legacy contact and missing-job no-op controls')
  } finally { globalThis.caches = previousCaches }
}
async function main() {
  await terminalRecovery()
  for (const plan of ['free', 'paid']) {
    const cap = plan === 'free' ? 125 : 500
    const f = fixture(plan, cap + 3)
    const queries = await f.run()
    assert.equal(f.job().processed_count, cap, `${plan}: bounded first invocation`)
    assert.equal(f.job().status, 'processing')
    assert.equal(f.audits(), cap)
    assert.equal(f.state.queued.length, 1)
    assert.ok(queries <= f.state.ceiling)
    await f.run()
    assert.equal(f.job().status, 'completed')
    assert.equal(f.audits(), cap + 3)
    await f.run()
    assert.equal(f.audits(), cap + 3, 'terminal delivery replay has no duplicate audits')
    console.log(`PASS ${plan} bounded continuation and replay (${queries} first-invocation statements)`)
    f.raw.close()
  }
  const f = fixture('free', 128)
  await f.run()
  f.state.beforeBatch = () => { throw new Error('late delivery failure') }
  await assert.rejects(f.run(), /late delivery failure/)
  assert.equal(f.job().processed_count, 125)
  assert.equal(f.job().failed_count, 0, 'earlier successful chunk is not mislabeled failed')
  assert.equal(f.audits(), 125)
  await f.run()
  assert.equal(f.audits(), 128)
  console.log('PASS later failure preserves truthful committed progress')
  f.raw.close()
  for (const ledger of ['cache', 'branch', 'batch', 'damaged']) {
    const g = fixture('free', 2)
    const id = g.ids[0]
    if (ledger === 'cache') g.raw.prepare('UPDATE products SET stock_quantity=1 WHERE id=?').run(id)
    if (ledger === 'branch') g.raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,1)').run(id)
    if (ledger === 'batch') {
      g.raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,is_active) VALUES(9000,?,'budget','budget',1)").run(id)
      g.raw.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9000,1,1)')
    }
    if (ledger === 'damaged') g.raw.prepare("INSERT INTO damaged_stock_lots(product_id,branch_id,quantity,quantity_remaining,condition_tag) VALUES(?,1,1,1,'damaged')").run(id)
    await g.run()
    assert.equal(g.job().status, 'completed')
    assert.equal(g.job().failed_count, 1)
    assert.deepEqual(JSON.parse(g.job().failed_ids_json), [id])
    assert.match(g.job().last_error, /product_has_stock/)
    assert.equal(g.raw.prepare('SELECT is_active FROM products WHERE id=?').get(id).is_active, 1)
    assert.equal(g.audits(), 1, 'only empty sibling has an audit')
    const audit = g.raw.prepare("SELECT entity_id,details FROM audit_logs WHERE entity='product'").get()
    assert.equal(Number(audit.entity_id), g.ids[1])
    assert.equal(JSON.parse(audit.details).productName, `fixture ${g.ids[1]}`)
    assert.equal(JSON.parse(audit.details).bulkJobId, 'budget')
    g.raw.close()
  }
  console.log('PASS each ledger alone refuses stocked product; empty sibling and per-product audit preserved')
  const race = fixture('free', 2)
  race.raw.exec("UPDATE bulk_delete_jobs SET status='processing'")
  race.state.beforeBatch = () => race.raw.prepare('UPDATE products SET stock_quantity=1 WHERE id=?').run(race.ids[0])
  await assert.rejects(race.run(), /product_has_stock/)
  assert.equal(race.job().processed_count, 0)
  assert.equal(race.audits(), 0)
  await race.run()
  assert.equal(race.job().failed_count, 1)
  assert.equal(race.audits(), 1)
  race.raw.close()
  console.log('PASS stock race rolls back audit/delete/progress; next delivery repartitions')
  const lost = fixture('free', 128)
  lost.raw.exec("UPDATE bulk_delete_jobs SET status='processing'")
  lost.state.afterBatch = () => { throw new Error('commit acknowledgement lost') }
  await assert.rejects(lost.run(), /acknowledgement lost/)
  assert.equal(lost.job().processed_count, 125)
  assert.equal(lost.audits(), 125)
  await lost.run()
  assert.equal(lost.audits(), 128)
  assert.equal(lost.job().status, 'completed')
  lost.raw.close()
  console.log('PASS commit acknowledgement loss resumes atomic cursor without duplicate audits')
  for (const mutation of ['cancel', 'cursor']) {
    const g = fixture('free', 2)
    g.raw.exec("UPDATE bulk_delete_jobs SET status='processing'")
    g.state.beforeBatch = () => g.raw.exec(mutation === 'cancel'
      ? 'UPDATE bulk_delete_jobs SET cancel_requested=1'
      : "UPDATE bulk_delete_jobs SET processed_count=2,status='completed'")
    await g.run()
    assert.equal(g.audits(), 0)
    assert.equal(g.job().status, mutation === 'cancel' ? 'cancelled' : 'completed')
    assert.equal(g.state.queued.length, 0)
    g.raw.close()
  }
  console.log('PASS concurrent cancellation and cursor winner refuse stale entire chunk')
  const concurrent = fixture('free', 128)
  await Promise.all([concurrent.run(false), concurrent.run(false)])
  assert.equal(concurrent.job().processed_count, 125)
  assert.equal(concurrent.audits(), 125)
  assert.equal(concurrent.state.queued.length, 1, 'only cursor winner dispatches continuation')
  await concurrent.run()
  assert.equal(concurrent.audits(), 128)
  concurrent.raw.close()
  console.log('PASS concurrent real deliveries share one atomic cursor winner and one continuation')
  const paid = fixture('paid', 2503)
  for (let i = 0; i < 5; i++) await paid.run(i === 0)
  assert.equal(paid.job().processed_count, 2500)
  assert.ok(paid.state.statements < 1000)
  console.log(`PASS Paid five-message consumer batch: ${paid.state.statements} statements`)
  paid.raw.close()
  const missing = fixture('free', 128)
  delete missing.env.IMPORT_QUEUE
  tier.__resetPlanTierCacheForTests()
  await assert.rejects(createBulkDeleteJob(missing.env, 'products', missing.ids, 'fixture', {}), error => error.code === 'bulk_delete_queue_unavailable' && /No products were deleted/.test(error.message))
  assert.equal(missing.raw.prepare('SELECT COUNT(*) n FROM bulk_delete_jobs').get().n, 1)
  assert.equal(missing.audits(), 0)
  await assert.rejects(missing.run(), error => error.code === 'bulk_delete_queue_resume_required' && /Select the remaining products/.test(error.message))
  assert.equal(missing.job().status, 'failed')
  assert.equal(missing.job().processed_count, 125)
  assert.equal(missing.job().failed_count, 0)
  assert.equal(missing.job().last_error, 'bulk_delete_queue_resume_required')
  assert.equal(missing.audits(), 125)
  assert.equal(missing.state.queued.length, 0)
  missing.raw.close()
  const small = fixture('free', 2)
  delete small.env.IMPORT_QUEUE
  await small.run()
  assert.equal(small.job().status, 'completed')
  assert.equal(small.audits(), 2)
  small.raw.close()
  console.log('PASS missing queue prewrite admission, truthful partial failure, and small no-queue completion')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
