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
    const controlFile = process.env.PARENT_CONTROL_SOURCE && path.join(process.env.PARENT_CONTROL_SOURCE, name)
    let source = fs.readFileSync(controlFile && fs.existsSync(controlFile) ? controlFile : path.join(root, 'src', name), 'utf8')
    if (process.env.PARENT_WRONG_CONTROL === 'guards' && name === 'lib/branchCutoverParent.ts') {
      assert.ok(source.includes('return guards')); source = source.replace('return guards', 'return []')
    }
    if (process.env.PARENT_WRONG_CONTROL === 'page' && name === 'lib/branchCutoverCapture.ts') {
      assert.ok(source.includes('(${fingerprintSql})=@fingerprint')); source = source.replace('(${fingerprintSql})=@fingerprint', '1=1')
    }
    if (process.env.PARENT_WRONG_CONTROL === 'families' && name === 'lib/branchCutoverCapture.ts') {
      assert.ok(source.includes('return UNCLASSIFIED_JSON_FAMILIES.map')); source = source.replace('return UNCLASSIFIED_JSON_FAMILIES.map', 'return [].map')
    }
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', js)(request => {
      if (request === './importMaintenanceFence') return new Proxy({}, { get() { throw Error('Unexpected maintenance dependency execution') } })
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
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql') && (labels || n !== '0226_branch_history_labels.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  raw.exec(`INSERT INTO branches(id,name,is_active,is_default,canonical_key,role,created_at) VALUES(2,'Shop',1,1,'shop','shop','2026-10-03 00:00:00'),(1,'Warehouse',1,0,'warehouse','warehouse','2026-10-03 00:00:00');
    INSERT INTO users(id,username,password,name,organization_id,permissions,is_active) VALUES(7,'operator','fixture','Operator',1,'{"branches":true,"backup_restore":true}',1);
    INSERT INTO system_flags(key,value) VALUES('branch_cutover_control_incarnation','00000000-0000-4000-8000-000000000099')`)
  raw.limits.functionArg = 100
  const stats = { reads: 0, batches: 0, statements: 0, maxBinds: 0, retryReads: false, before: null, after: null }
  const pendingReadRetries = new Set()
  const prepared = (sql, values = []) => {
    assert.ok(values.length <= 100); stats.maxBinds = Math.max(stats.maxBinds, values.length)
    const execute = () => {
      const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((v, i) => [String(i + 1), v]))] : values
      const statement = raw.prepare(sql)
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { success: true, results: statement.all(...args), meta: { changes: 0 } }
      const r = statement.run(...args); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
    }
    return { bind: (...v) => prepared(sql, v), execute, all: async () => {
      stats.reads++
      const retryKey = JSON.stringify([sql, values])
      if (stats.retryReads && !pendingReadRetries.has(retryKey)) { pendingReadRetries.add(retryKey); throw Error('D1_ERROR: transient network timeout') }
      pendingReadRetries.delete(retryKey)
      return execute()
    } }
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
function installLossyCaptureCost(w) {
  const native = w.raw.prepare("SELECT unit_cost_usd raw,printf('%!.15g',unit_cost_usd) encoded FROM product_batches WHERE id=101").get()
  assert.ok(Number.isFinite(native.raw) && Number.isFinite(Number(native.encoded)))
  assert.notEqual(Number(native.encoded), native.raw)
  const prepare = w.db.prepare
  let calls = 0
  w.db.prepare = sql => {
    const statement = prepare.call(w.db, sql)
    if (!sql.startsWith('WITH capture_rows AS MATERIALIZED') || !sql.includes('FROM "product_batches" WHERE')) return statement
    const all = statement.all.bind(statement)
    statement.all = async params => {
      const rows = await all(params)
      const unchangedSidecars = JSON.stringify(rows.slice(1))
      const records = JSON.parse(rows[0].value)
      const entry = records.find(([key]) => key === 101)
      assert.ok(entry)
      const record = JSON.parse(entry[1])
      assert.equal(record.unit_cost_usd[0], 'real')
      const sidecar = rows.find(row => row.row_kind === 1 && row.k === 101)
      assert.equal(sidecar?.['r' + Object.keys(record).indexOf('unit_cost_usd')], native.raw)
      record.unit_cost_usd[1] = native.encoded
      entry[1] = JSON.stringify(record)
      rows[0].value = JSON.stringify(records)
      assert.equal(JSON.stringify(rows.slice(1)), unchangedSidecars)
      calls++
      return rows
    }
    return statement
  }
  return { native, calls: () => calls, restore() { w.db.prepare = prepare } }
}
const actor = { id: 7, organization_id: 1, is_active: 1 }
const budget = { tier: 'paid', alreadyUsed: 0, remainingReads: 0, retryQueries: 0, completionQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
const identity = { sourceBranchId: 2, targetBranchId: 1 }
const names = { retiredName: 'Old Shop', successorName: 'LC Store' }
async function inspect(w) { return w.parent.inspectBranchCutover(w.db, actor, 1, identity, budget) }
async function begin(w, requestId = 'parent_request_001') {
  const plan = await inspect(w)
  return w.parent.beginBranchCutover(w.db, actor, 1, { ...identity, ...names, requestId, controlIncarnation: '00000000-0000-4000-8000-000000000099', expectedSourceJson: plan.sourcePreimageJson, expectedTargetJson: plan.targetPreimageJson, expectedSchemaDigest: plan.schemaDigest }, budget)
}
async function step(w, row, pageSize = 8) { return w.parent.continueBranchCutover(w.db, actor, 1, { operationId: row.operation_id, expectedRevision: row.revision, pageSize }, budget) }
async function main() {
  let checks = 0
  async function check(name, fn) { if (process.env.PARENT_TEST_FILTER && !name.includes(process.env.PARENT_TEST_FILTER)) return; await fn(); console.log('PASS ' + name); checks++ }
  await check('non-roundtrip REAL metadata refuses the checkpoint preserving its exact journal and hold', async () => {
    const w = world()
    w.raw.exec("INSERT INTO products(id,name,stock_quantity) VALUES(10,'Item',1); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,2,1); INSERT INTO product_batches(id,variant_product_id,batch_key,received_branch_id,unit_cost_usd) VALUES(101,10,'lot101',2,3); INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(101,2,1)")
    let { row } = await begin(w)
    const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
    while (w.capture.parseCaptureCursor(row.capture_cursor_json).index !== tables.indexOf('product_batches')) row = (await step(w, row)).row
    w.raw.prepare('UPDATE product_batches SET unit_cost_usd=? WHERE id=101').run(3.5702545241480925e141)
    const before = w.raw.prepare('SELECT * FROM branch_cutovers').get(), batches = w.stats.batches
    const hold = w.raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value
    const prepare = w.db.prepare, lossy = installLossyCaptureCost(w)
    try {
      await assert.rejects(step(w, row), e => e.code === 'branch_cutover_parent_capability')
      assert.equal(lossy.calls(), 1)
    } finally { lossy.restore(); assert.equal(w.db.prepare, prepare) }
    assert.equal(w.stats.batches, batches); assert.deepEqual(w.raw.prepare('SELECT * FROM branch_cutovers').get(), before)
    assert.equal(w.raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value, hold)
    assert.equal(w.raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=101').get().unit_cost_usd, 3.5702545241480925e141)
    assert.equal(w.raw.prepare('SELECT count(*) n FROM inventory_movements').get().n, 0); w.raw.close()
  })
  await check('old lossy capture registry cannot resume or silently rebase its held journal', async () => {
    const w = world(); const plan = await inspect(w)
    const registryDigest = '25c31b35e5c80204d5daff886a79872951f441dcd44937a461b00f65c8180cf8'
    assert.notEqual(plan.registryDigest, registryDigest)
    const { row } = await w.journal.beginBranchCutoverJournal(w.db, { operationId: '00000000-0000-4000-8000-000000000001', token: '00000000-0000-4000-8000-000000000002',
      actorId: 7, organizationId: '1', controlIncarnation: '00000000-0000-4000-8000-000000000099', beginRequestId: 'legacy_capture_001', ...identity,
      intentJson: JSON.stringify({ action: 'retire', parentVersion: 1, ...identity, registryDigest, schemaDigest: plan.schemaDigest }), sourcePreimageJson: plan.sourcePreimageJson, targetPreimageJson: plan.targetPreimageJson })
    const before = w.raw.prepare('SELECT * FROM branch_cutovers').get(), batches = w.stats.batches
    const hold = w.raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value
    await assert.rejects(step(w, row), e => e.code === 'branch_cutover_parent_capability')
    await assert.rejects(begin(w, 'legacy_capture_001'))
    assert.equal(w.stats.batches, batches); assert.deepEqual(w.raw.prepare('SELECT * FROM branch_cutovers').get(), before)
    assert.equal(w.raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value, hold); w.raw.close()
  })
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
  // CUTOVER-LC: nothing may silently close a shift. The admission refuses to start while ANY shift is open (at the
  // source or anywhere else), is atomic with the hold, and ordinary writes (opening a shift) are gated while it runs.
  const shiftRow = (id, branch, closed, cancelled) => `INSERT INTO shift_sessions(id,shift_code,user_id,branch_id,business_date,opened_at,closed_at,cancelled_at,cancelled_by_user_id,cancel_reason)
    VALUES(${id},'SH${id}',7,${branch},date('2026-01-01','+${id} day'),'2026-10-05 08:00:00',${closed},${cancelled},${cancelled === 'NULL' ? 'NULL' : 7},${cancelled === 'NULL' ? 'NULL' : "'entered in error'"})`
  await check('an open shift refuses the cutover start (source or other branch) and leaves no hold; closed and cancelled shifts do not', async () => {
    for (const branch of [2, 1]) {
      const w = world(); w.raw.exec(shiftRow(500 + branch, branch, 'NULL', 'NULL'))
      await assert.rejects(begin(w))
      assert.equal(w.raw.prepare('SELECT count(*) n FROM branch_cutovers').get().n, 0, 'no journal row')
      assert.equal(w.raw.prepare("SELECT count(*) n FROM system_flags WHERE key='maintenance'").get().n, 0, 'no maintenance hold')
      assert.equal(w.raw.prepare('SELECT count(*) n FROM shift_sessions WHERE closed_at IS NULL AND cancelled_at IS NULL').get().n, 1, 'the shift is untouched, never closed on the way')
      w.raw.close()
    }
    const done = world(); done.raw.exec(shiftRow(510, 2, "'2026-10-05 20:00:00'", 'NULL') + ';' + shiftRow(511, 2, 'NULL', "'2026-10-05 09:00:00'"))
    assert.equal((await begin(done)).replayed === true, false); done.raw.close()
  })
  await check('a shift opened between the read and the admission batch rolls the start back', async () => {
    const w = world(); w.stats.before = raw => raw.exec(shiftRow(520, 2, 'NULL', 'NULL')); await assert.rejects(begin(w))
    assert.equal(w.raw.prepare('SELECT count(*) n FROM branch_cutovers').get().n, 0); assert.equal(w.raw.prepare("SELECT count(*) n FROM system_flags WHERE key='maintenance'").get().n, 0); w.raw.close()
  })
  await check('lost admission acknowledgement proves retained row without another write', async () => {
    const w = world(); w.stats.after = () => { throw Error('network lost after commit') }; const result = await begin(w)
    assert.equal(result.replayed, true); assert.equal(w.stats.batches, 1); w.raw.close()
  })
  await check('empty supported source captures and snapshots before verifying with no fake child', async () => {
    const w = world(); let { row } = await begin(w); let turns = 0
    while (row.phase !== 'verifying' && turns++ < 150) row = (await step(w, row, 2)).row
    assert.equal(row.phase, 'verifying'); assert.equal(row.next_sequence, 0); assert.equal(row.verification_records, 0); assert.equal(w.raw.prepare('SELECT count(*) n FROM transfer_operation_receipts').get().n, 0)
    assert.equal(JSON.parse(row.manifest_json).version, 3); assert.equal(JSON.parse(row.manifest_json).coverage.kind, 'registry-v3-capture')
    assert.equal(JSON.parse(row.manifest_json).coverage.historicalReplayCertified, true); w.raw.close()
  })
  await check('unclassified new scalar schema and unsupported stock refuse before admission', async () => {
    for (const mutation of ["CREATE TABLE future_reference(id INTEGER PRIMARY KEY,branch_id INTEGER)",
      "INSERT INTO rfid_tags(epc_id,product_id,branch_id,status) VALUES('tag',1,2,'active')",
      "INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,1)"]) {
      const w = world(); w.raw.exec(mutation); assert.ok((await inspect(w)).capabilities.length)
      await assert.rejects(begin(w), e => e.code === 'branch_cutover_parent_capability'); assert.equal(w.stats.batches, 0); w.raw.close()
    }
  })
  await check('schema or unsupported stock arriving after admission reads rolls back owned hold', async () => {
    for (const mutation of ["CREATE TABLE future_reference(id INTEGER PRIMARY KEY,branch_id INTEGER)",
      "INSERT INTO rfid_tags(epc_id,product_id,branch_id,status) VALUES('tag',1,2,'active')"]) {
      const w = world(); w.stats.before = raw => raw.exec(mutation); await assert.rejects(begin(w))
      assert.equal(w.stats.batches, 1); assert.equal(w.raw.prepare('SELECT count(*) n FROM branch_cutovers').get().n, 0); w.raw.close()
    }
  })
  await check('v1 journal rows cannot enter parent execution; forged organization and exhausted budget refuse', async () => {
    const w = world(); const p = await inspect(w)
    const { row } = await w.journal.beginBranchCutoverJournal(w.db, { operationId: '00000000-0000-4000-8000-000000000001', token: '00000000-0000-4000-8000-000000000002',
      actorId: 7, organizationId: '1', controlIncarnation: '00000000-0000-4000-8000-000000000099', beginRequestId: 'legacy_request_001', ...identity,
      intentJson: JSON.stringify({ action: 'retire', ...identity }), sourcePreimageJson: p.sourcePreimageJson, targetPreimageJson: p.targetPreimageJson })
    const batches = w.stats.batches; await assert.rejects(step(w, row), e => e.code === 'branch_cutover_parent_capability')
    await assert.rejects(w.parent.inspectBranchCutover(w.db, { ...actor, organization_id: 2 }, 2, identity, budget))
    await assert.rejects(w.parent.inspectBranchCutover(w.db, actor, 1, identity, { ...budget, alreadyUsed: 999 }), /budget/)
    assert.equal(w.stats.batches, batches); w.raw.close()
  })
  await check('v3 manifest rejects invented coverage, history, families and baseline before write', async () => {
    const w = world(); let { row } = await begin(w)
    while (row.phase === 'capturing') row = (await step(w, row)).row
    const ownership = { operationId: row.operation_id, actorId: 7, organizationId: '1', controlIncarnation: row.control_incarnation, token: row.maintenance_token }
    const manifest = JSON.parse(row.manifest_json)
    const variants = [{ coverage: { ...manifest.coverage, historicalReplayCertified: false } }, { coverage: { ...manifest.coverage, schemaDigest: '0'.repeat(64) } },
      { coverage: { ...manifest.coverage, extra: 1 } }, { history: { ...manifest.history, close: manifest.history.close + 1 } },
      { history: { ...manifest.history, byApplier: { 'sale.add_items': [0, 1] } } }, { families: { ...manifest.families, pendingOpen: 1 } },
      { families: { ...manifest.families, actionHistoryMax: -1 } }, { baseline: { ...manifest.baseline, stockHash: 'xyz' } }, { baseline: { ...manifest.baseline, extra: 1 } }, { version: 2 }]
    for (const patch of variants) {
      const text = JSON.stringify({ ...manifest, ...patch })
      const db = new Proxy(w.db, { get(target, key, receiver) {
        if (key === 'prepare') return sql => ({ get: async params => {
          const value = await target.prepare(sql).get(params)
          return value?.operation_id ? { ...value, manifest_json: text, manifest_digest: await w.capture.cutoverDigest(text) } : value
        }, all: params => target.prepare(sql).all(params) })
        return Reflect.get(target, key, receiver)
      } })
      await assert.rejects(w.journal.readBranchCutoverJournal(db, ownership), /journal_conflict/)
    }
    w.raw.close()
  })
  await check('one actual READ retry and lost acknowledgement fit explicit budget; one-less budget stops before batch', async () => {
    const w = world(); const p = await inspect(w); const input = { ...identity, ...names, requestId: 'budget_request_001', controlIncarnation: '00000000-0000-4000-8000-000000000099',
      expectedSourceJson: p.sourcePreimageJson, expectedTargetJson: p.targetPreimageJson, expectedSchemaDigest: p.schemaDigest }
    const beforeReads = w.stats.reads; w.stats.retryReads = true; w.stats.after = () => { throw Error('lost acknowledgement') }
    const result = await w.parent.beginBranchCutover(w.db, actor, 1, input, { ...budget, alreadyUsed: 963 })
    assert.equal(result.replayed, true); assert.equal(w.stats.batches, 1); assert.equal(w.stats.reads - beforeReads, 18)
    assert.equal(w.stats.statements, 11); assert.ok(w.stats.reads - beforeReads + w.stats.statements <= 35); w.raw.close()
    const stopped = world(); const plan = await inspect(stopped)
    await assert.rejects(stopped.parent.beginBranchCutover(stopped.db, actor, 1, { ...input, expectedSchemaDigest: plan.schemaDigest,
      expectedSourceJson: plan.sourcePreimageJson, expectedTargetJson: plan.targetPreimageJson }, { ...budget, alreadyUsed: 964 }))
    assert.equal(stopped.stats.batches, 0); stopped.raw.close()
  })
  await check('REHEARSAL F2: an invocation-budget overrun is a coded refusal that is never retryable and never wrapped as an unknown outcome', async () => {
    const w = world(); const p = await inspect(w)
    const input = { ...identity, ...names, requestId: 'budget_request_f2', controlIncarnation: '00000000-0000-4000-8000-000000000099',
      expectedSourceJson: p.sourcePreimageJson, expectedTargetJson: p.targetPreimageJson, expectedSchemaDigest: p.schemaDigest }
    const row = (await w.parent.beginBranchCutover(w.db, actor, 1, input, budget)).row
    // a read that does not fit (before the batch) and a batch that does not fit (inside the commit) are both the same refusal
    for (const alreadyUsed of [999, 990, 985]) {
      const failure = await w.parent.continueBranchCutover(w.db, actor, 1, { operationId: row.operation_id, expectedRevision: row.revision, pageSize: 8 }, { ...budget, alreadyUsed }).catch(error => error)
      if (!(failure instanceof Error)) continue
      assert.equal(failure.capability, 'parent_invocation_budget_exceeded', 'alreadyUsed ' + alreadyUsed + ': ' + failure.message)
      assert.equal(w.parent.isBranchCutoverRetryable(failure), false, 'a deterministic overrun is not retried 25 times blind')
      assert.ok(!(failure instanceof w.parent.BranchCutoverParentOutcomeUnknown))
    }
    const failed = await w.parent.continueBranchCutover(w.db, actor, 1, { operationId: row.operation_id, expectedRevision: row.revision, pageSize: 8 }, { ...budget, alreadyUsed: 999 }).catch(error => error)
    assert.equal(failed.capability, 'parent_invocation_budget_exceeded')
    assert.equal(w.raw.prepare('SELECT revision FROM branch_cutovers').get().revision, row.revision, 'nothing was written')
    assert.equal(w.parent.isBranchCutoverRetryable(new Error('D1_ERROR: D1 DB is overloaded')), true, 'a transient D1 refusal stays retryable')
    w.raw.close()
  })
  assert.ok(checks > 0, 'test filter must select a group')
  console.log(`${checks} branch cutover parent native groups passed`)
}
module.exports = { world, actor, budget, identity, names, inspect, begin, step, installLossyCaptureCost }
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
