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
    if (id === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
    if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'))
    return require(id)
  }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports)
  return mod.exports
}
const { runBulkDeleteJob, createBulkDeleteJob } = load(path.join(root, 'lib/bulkDeleteEngine.ts'))
const tier = load(path.join(root, 'lib/planTier.ts'))
function fixture(plan, total) {
  const raw = new DatabaseSync(':memory:')
  for (const sql of loadAll()) raw.exec(sql)
  const ids = Array.from({ length: total }, (_, i) => 10000 + i)
  const insert = raw.prepare('INSERT INTO products(id,name,barcode,is_active,stock_quantity) VALUES(?,?,?,1,0)')
  for (const id of ids) insert.run(id, `fixture ${id}`, `BUDGET${id}`)
  raw.prepare("INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count) VALUES('budget','products','pending','fixture',?,?)").run(JSON.stringify(ids), total)
  const state = { statements: 0, ceiling: plan === 'free' ? 50 : 1000, beforeBatch: null, afterBatch: null, queued: [] }
  const count = n => { state.statements += n; if (state.statements > state.ceiling) throw new Error('fixture invocation query budget exceeded') }
  const prepare = sql => {
    let values = []
    const exec = () => {
      const stmt = raw.prepare(sql)
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) return { results: stmt.all(...values), meta: { changes: 0 } }
      const result = stmt.run(...values)
      return { results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    }
    const stmt = { bind(...args) { values = args; return stmt }, async first() { count(1); return raw.prepare(sql).get(...values) ?? null }, async all() { count(1); return exec() }, async run() { count(1); return exec() }, _exec: exec, sql }
    return stmt
  }
  const DB = { prepare, async batch(list) {
    count(list.length)
    const hook = state.beforeBatch; state.beforeBatch = null; if (hook) hook(list)
    raw.exec('BEGIN IMMEDIATE')
    let out
    try { out = list.map(s => s._exec()); raw.exec('COMMIT') } catch (error) { raw.exec('ROLLBACK'); throw error }
    const after = state.afterBatch; state.afterBatch = null; if (after) after()
    return out
  } }
  const kv = new Map()
  const env = { DB, PLAN_TIER: plan, CACHE: { get: async k => kv.get(k) ?? null, put: async (k,v) => kv.set(k,v) }, IMPORT_QUEUE: { send: async body => state.queued.push(body) } }
  const run = async (reset = true) => { if (reset) state.statements = 0; tier.__resetPlanTierCacheForTests(); await runBulkDeleteJob(env, 'budget'); return state.statements }
  const job = () => raw.prepare("SELECT * FROM bulk_delete_jobs WHERE id='budget'").get()
  const audits = () => raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='product' AND action='delete'").get().n
  return { raw, ids, state, env, run, job, audits }
}
async function main() {
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
