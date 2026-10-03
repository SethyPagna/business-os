const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function modules() {
  const cache = new Map()
  function load(name) {
    name = path.posix.normalize(name.endsWith('.ts') ? name : name + '.ts')
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }; cache.set(name, module)
    let source = fs.readFileSync(path.join(root, 'src', name), 'utf8')
    if (process.env.PARENT_WRONG_CONTROL === 'guards' && name === 'lib/branchCutoverParent.ts') {
      assert.ok(source.includes('return guards')); source = source.replace('return guards', 'return []')
    }
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', js)(request => {
      if (request === './importMaintenanceFence') return {}
      assert.ok(request.startsWith('.'), request)
      return load(path.posix.join(path.posix.dirname(name), request))
    }, module, module.exports)
    return module.exports
  }
  return { load, parent: load('lib/branchCutoverParent'), capture: load('lib/branchCutoverCapture'), D1Compat: load('lib/db').D1Compat }
}
function world(labels = true) {
  const { parent, capture, D1Compat, load } = modules()
  const raw = new DatabaseSync(':memory:'); raw.limits.exprDepth = 100; raw.limits.variableNumber = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  if (labels) raw.exec('ALTER TABLE stock_transfers ADD COLUMN from_branch_name TEXT; ALTER TABLE stock_transfers ADD COLUMN to_branch_name TEXT; ALTER TABLE stock_session_members ADD COLUMN branch_name TEXT')
  raw.exec(`INSERT INTO branches(id,name,is_active,is_default,canonical_key,role,created_at) VALUES(2,'Shop',1,1,'shop','shop','2026-10-03 00:00:00'),(1,'Warehouse',1,0,'warehouse','warehouse','2026-10-03 00:00:00');
    INSERT INTO users(id,username,password,name,organization_id,permissions,is_active) VALUES(7,'operator','fixture','Operator',1,'{"branches":true,"backup_restore":true}',1);
    INSERT INTO system_flags(key,value) VALUES('branch_cutover_control_incarnation','00000000-0000-4000-8000-000000000099')`)
  const stats = { reads: 0, batches: 0, statements: 0, maxBinds: 0, before: null, after: null }
  const prepared = (sql, values = []) => {
    assert.ok(values.length <= 100); stats.maxBinds = Math.max(stats.maxBinds, values.length)
    const execute = () => {
      const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((v, i) => [String(i + 1), v]))] : values
      const statement = raw.prepare(sql)
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { success: true, results: statement.all(...args), meta: { changes: 0 } }
      const r = statement.run(...args); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
    }
    return { bind: (...v) => prepared(sql, v), execute, all: async () => { stats.reads++; return execute() } }
  }
  const db = new D1Compat({ prepare: prepared, batch: async statements => {
    stats.batches++; stats.statements = statements.length
    if (stats.before) { const before = stats.before; stats.before = null; before(raw) }
    raw.exec('BEGIN IMMEDIATE')
    let result
    try { result = statements.map(s => s.execute()); raw.exec('COMMIT') } catch (e) { raw.exec('ROLLBACK'); throw e }
    if (stats.after) { const after = stats.after; stats.after = null; after(raw) }
    return result
  } })
  return { raw, db, stats, parent, capture, journal: load('lib/branchCutoverJournal') }
}
const actor = { id: 7, organization_id: 1, is_active: 1 }
const budget = { tier: 'paid', alreadyUsed: 0, remainingReads: 0, retryQueries: 0, completionQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
const identity = { sourceBranchId: 2, targetBranchId: 1 }
async function inspect(w) { return w.parent.inspectBranchCutover(w.db, actor, 1, identity, budget) }
async function begin(w, requestId = 'parent_request_001') {
  const plan = await inspect(w)
  return w.parent.beginBranchCutover(w.db, actor, 1, { ...identity, requestId, controlIncarnation: '00000000-0000-4000-8000-000000000099', expectedSourceJson: plan.sourcePreimageJson, expectedTargetJson: plan.targetPreimageJson, expectedSchemaDigest: plan.schemaDigest }, budget)
}
async function step(w, row, pageSize = 8) { return w.parent.continueBranchCutover(w.db, actor, 1, { operationId: row.operation_id, expectedRevision: row.revision, pageSize }, budget) }
async function main() {
  let checks = 0
  async function check(name, fn) { await fn(); console.log('PASS ' + name); checks++ }
  await check('dry-run is read-only and lists exactly32 scalar references', async () => {
    const w = world(); const p = await inspect(w); assert.equal(p.scalarReferences.length, 32); assert.equal(p.capabilities.length, 0); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  await check('missing historical label capability refuses acquisition', async () => {
    const w = world(false); const p = await inspect(w); assert.equal(p.capabilities.filter(v => v.code === 'historical_label_schema_required').length, 3)
    await assert.rejects(begin(w), e => e.code === 'branch_cutover_parent_capability'); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  await check('same begin request replays exact ownership; conflicting preimage refuses', async () => {
    const w = world(); const first = await begin(w); const batches = w.stats.batches; const second = await begin(w)
    assert.equal(second.row.operation_id, first.row.operation_id); assert.equal(second.replayed, true); assert.equal(w.stats.batches, batches)
    w.raw.exec("UPDATE branches SET notes='changed' WHERE id=2"); await assert.rejects(begin(w)); assert.equal(w.stats.batches, batches); w.raw.close()
  })
  await check('admission grant race refuses atomically', async () => {
    const w = world(); w.stats.before = raw => raw.exec("UPDATE users SET permissions='{}' WHERE id=7")
    await assert.rejects(begin(w)); assert.equal(w.raw.prepare('SELECT count(*) n FROM branch_cutovers').get().n, 0); assert.equal(w.raw.prepare("SELECT count(*) n FROM system_flags WHERE key='maintenance'").get().n, 0); w.raw.close()
  })
  await check('lost admission acknowledgement proves retained row without another write', async () => {
    const w = world(); w.stats.after = () => { throw Error('network lost after commit') }; const result = await begin(w)
    assert.equal(result.replayed, true); assert.equal(w.stats.batches, 1); w.raw.close()
  })
  await check('empty supported source captures and snapshots before verifying with no fake child', async () => {
    const w = world(); let { row } = await begin(w); let turns = 0
    while (row.phase !== 'verifying' && turns++ < 150) row = (await step(w, row, 2)).row
    assert.equal(row.phase, 'verifying'); assert.equal(row.next_sequence, 0); assert.equal(row.verification_records, 0); assert.equal(w.raw.prepare('SELECT count(*) n FROM transfer_operation_receipts').get().n, 0)
    assert.equal(JSON.parse(row.manifest_json).version, 2); assert.equal(JSON.parse(row.manifest_json).coverage.kind, 'scalar-reference-capture'); w.raw.close()
  })
  console.log(`${checks} branch cutover parent native groups passed`)
}
module.exports = { world, actor, budget, identity, inspect, begin, step }
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
