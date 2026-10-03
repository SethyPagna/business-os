const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(name) {
  if (cache.has(name)) return cache.get(name)
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', compiled)(request => {
    if (request === './importMaintenanceFence') return {}
    if (request.startsWith('./')) return load(request.slice(2))
    throw Error('Unexpected import: ' + request)
  }, module, module.exports)
  cache.set(name, module.exports)
  return module.exports
}
const migration = path.join(root, 'migrations/0224_branch_cutover_journal.sql')
assert(fs.existsSync(migration), '0224 journal schema must exist')
const activeInsertMigration = path.join(root, 'migrations/0225_branch_cutover_active_insert_guard.sql')
assert(fs.existsSync(activeInsertMigration), '0225 active insert guard must exist')
const journal = load('branchCutoverJournal')
const { D1Compat } = load('db')
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function world({ activeGuard = true } = {}) {
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.exec(fs.readFileSync(path.join(root, 'migrations/0089_system_flags.sql'), 'utf8'))
  raw.exec(fs.readFileSync(migration, 'utf8'))
  if (activeGuard) raw.exec(fs.readFileSync(activeInsertMigration, 'utf8'))
  raw.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run('branch_cutover_control_incarnation', uuid(99))
  const control = { batches: 0, before: null, after: null, failAt: -1, statements: [] }
  function prepared(sql, values = []) {
    const args = () => /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))] : values
    const execute = () => {
      const statement = raw.prepare(sql)
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) return { success: true, results: statement.all(...args()), meta: { changes: 0 } }
      const result = statement.run(...args())
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return { bind: (...bound) => prepared(sql, bound), all: async () => execute(), run: async () => execute(), execute, sql, values }
  }
  const db = new D1Compat({ prepare: prepared, batch: async statements => {
    control.batches++
    control.statements.push(statements.map(statement => ({ sqlBytes: Buffer.byteLength(statement.sql), binds: statement.values.length })))
    if (control.before) { const hook = control.before; control.before = null; hook(raw) }
    raw.exec('BEGIN IMMEDIATE')
    let results
    try {
      results = statements.map((statement, index) => { if (index === control.failAt) throw Error('D1_ERROR: internal error before commit'); return statement.execute() })
      raw.exec('COMMIT')
    } catch (error) { raw.exec('ROLLBACK'); throw error }
    if (control.after) { const hook = control.after; control.after = null; hook(raw) }
    return results
  } })
  return { raw, db, control }
}
const input = (patch = {}) => ({ operationId: uuid(1), beginRequestId: 'cutover_begin_001', actorId: 7, organizationId: 'fixture-org',
  controlIncarnation: uuid(99), token: uuid(2), sourceBranchId: 1, targetBranchId: 2,
  intentJson: '{"action":"retire","sourceBranchId":1,"targetBranchId":2}',
  sourcePreimageJson: '{"id":1,"name":"Shop"}', targetPreimageJson: '{"id":2,"name":"Warehouse"}', ...patch })
const proof = (row, patch = {}) => ({ operationId: row.operation_id, actorId: row.actor_id, organizationId: row.organization_id,
  controlIncarnation: row.control_incarnation, token: row.maintenance_token, ...patch })
const digest = 'a'.repeat(64)
async function start(w, patch) { return (await journal.beginBranchCutoverJournal(w.db, input(patch))).row }
function insertNewIdentity(w, row, replace) {
  const flag = JSON.stringify({ ...JSON.parse(row.maintenance_flag_json), operationId: uuid(70), beginRequestId: 'cutover_begin_070' })
  w.raw.prepare(`INSERT ${replace ? 'OR REPLACE ' : ''}INTO branch_cutovers(operation_id,begin_request_id,actor_id,organization_id,
    control_incarnation,maintenance_token,source_branch_id,target_branch_id,intent_json,intent_digest,source_preimage_json,
    target_preimage_json,maintenance_flag_json,capture_digest,snapshot_digest,verification_digest,created_at,updated_at)
    SELECT ?,?,actor_id,organization_id,control_incarnation,maintenance_token,source_branch_id,target_branch_id,intent_json,
    intent_digest,source_preimage_json,target_preimage_json,?,capture_digest,snapshot_digest,verification_digest,created_at,updated_at
    FROM branch_cutovers WHERE operation_id=?`).run(uuid(70), 'cutover_begin_070', flag, row.operation_id)
}
async function phaseWorld(phase, recursive) {
  const w = world()
  w.raw.exec(`PRAGMA recursive_triggers=${recursive}`)
  let row = await start(w)
  if (phase === 'moving') {
    row = await journal.checkpointBranchCutoverJournal(w.db, proof(row), row.revision, { phase: 'capturing', cursorJson: '{"id":1}', records: 1, digest })
    row = await journal.sealBranchCutoverManifest(w.db, proof(row), row.revision, JSON.stringify({ version: 1, sourceBranchId: 1, targetBranchId: 2,
      capturedRecords: 1, movingProducts: 1, sourceQuantityText: '1', sourceLotQuantityText: '1', anomalies: 0, captureDigest: digest }))
    row = await journal.finishBranchCutoverSnapshots(w.db, proof(row), row.revision)
  } else if (phase !== 'capturing') row = await seal(w, row)
  if (phase === 'verifying' || phase === 'ready') {
    row = await journal.finishBranchCutoverSnapshots(w.db, proof(row), row.revision)
    if (phase === 'ready') w.raw.prepare("UPDATE branch_cutovers SET phase='ready',revision=revision+1 WHERE operation_id=?").run(row.operation_id)
  }
  return { w, row: w.raw.prepare('SELECT * FROM branch_cutovers WHERE operation_id=?').get(row.operation_id) }
}
async function seal(w, row, movingProducts = 0) {
  return journal.sealBranchCutoverManifest(w.db, proof(row), row.revision, JSON.stringify({ version: 1, sourceBranchId: 1,
    targetBranchId: 2, capturedRecords: 0, movingProducts, sourceQuantityText: movingProducts ? '1' : '0',
    sourceLotQuantityText: movingProducts ? '1' : '0', anomalies: 0, captureDigest: row.capture_digest }))
}
let failures = 0
async function check(name, run) {
  try { await run(); console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name, error) }
}
async function main() {
  await check('schema is LF-only, one new table, no mutable-row foreign keys, native depth100', () => {
    assert(!fs.readFileSync(migration, 'utf8').includes('\r'))
    assert(!fs.readFileSync(activeInsertMigration, 'utf8').includes('\r'))
    const w = world()
    assert.deepEqual(w.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name), ['branch_cutovers', 'system_flags'])
    assert.equal(w.raw.prepare('PRAGMA foreign_key_list(branch_cutovers)').all().length, 0); w.raw.close()
  })
  await check('new operation and begin identities cannot replace or insert over any active phase at recursive0 or1', async () => {
    for (const recursive of [0, 1]) for (const phase of ['capturing', 'snapshots', 'moving', 'verifying', 'ready']) {
      const { w, row } = await phaseWorld(phase, recursive)
      try {
        const before = JSON.stringify(w.raw.prepare('SELECT * FROM branch_cutovers ORDER BY operation_id').all())
        for (const replace of [false, true]) {
          let rejected = false
          try { insertNewIdentity(w, row, replace) } catch { rejected = true }
          const after = JSON.stringify(w.raw.prepare('SELECT * FROM branch_cutovers ORDER BY operation_id').all())
          assert.equal(after, before, `active ${phase} must survive new-ID ${replace ? 'REPLACE' : 'INSERT'} at recursive=${recursive}`)
          assert.equal(rejected, true)
          assert.equal(w.raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value, row.maintenance_flag_json)
        }
        const replay = await journal.beginBranchCutoverJournal(w.db, input())
        assert.equal(replay.replayed, true); assert.equal(replay.row.phase, phase)
      } finally { w.raw.close() }
    }
  })
  await check('wrong identity-only insert guard permits the original new-ID replacement at recursive0', async () => {
    const { w, row } = await phaseWorld('capturing', 0)
    try {
      w.raw.exec(`DROP TRIGGER branch_cutovers_no_active_insert;
        CREATE TRIGGER branch_cutovers_no_active_insert BEFORE INSERT ON branch_cutovers
        WHEN EXISTS (SELECT 1 FROM branch_cutovers WHERE operation_id=NEW.operation_id OR begin_request_id=NEW.begin_request_id)
        BEGIN SELECT RAISE(ABORT, 'wrong_identity_only_guard'); END;`)
      insertNewIdentity(w, row, true)
      assert.equal(w.raw.prepare('SELECT operation_id FROM branch_cutovers').get().operation_id, uuid(70))
      assert.equal(w.raw.prepare('SELECT COUNT(*) AS n FROM branch_cutovers WHERE operation_id=?').get(row.operation_id).n, 0)
    } finally { w.raw.close() }
  })
  await check('0225 installs over an existing active0224 journal without rewriting journal or flags', async () => {
    const w = world({ activeGuard: false })
    try {
      w.raw.exec('PRAGMA recursive_triggers=0')
      const row = await start(w)
      const snapshot = () => JSON.stringify([w.raw.prepare('SELECT * FROM branch_cutovers').all(), w.raw.prepare('SELECT * FROM system_flags ORDER BY key').all()])
      const before = snapshot()
      w.raw.exec(fs.readFileSync(activeInsertMigration, 'utf8'))
      assert.equal(snapshot(), before)
      assert.throws(() => insertNewIdentity(w, row, true), /branch_cutover_active_insert_refused/)
      assert.equal(snapshot(), before)
    } finally { w.raw.close() }
  })
  await check('terminal abort history and exact replay remain immutable while a fresh begin is admitted at recursive0 or1', async () => {
    for (const recursive of [0, 1]) {
      const w = world(); w.raw.exec(`PRAGMA recursive_triggers=${recursive}`)
      try {
        const first = await start(w)
        const terminal = await journal.abortEffectFreeBranchCutoverJournal(w.db, proof(first), 0, 'before any effects')
        const before = JSON.stringify(w.raw.prepare('SELECT * FROM branch_cutovers WHERE operation_id=?').get(first.operation_id))
        assert.equal((await journal.beginBranchCutoverJournal(w.db, input())).replayed, true)
        assert.throws(() => w.raw.exec('INSERT OR REPLACE INTO branch_cutovers SELECT * FROM branch_cutovers'), /branch_cutover_invalid_initial_state/)
        assert.equal(JSON.stringify(w.raw.prepare('SELECT * FROM branch_cutovers WHERE operation_id=?').get(first.operation_id)), before)
        const next = await journal.beginBranchCutoverJournal(w.db, input({ operationId: uuid(70), beginRequestId: 'cutover_begin_070', token: uuid(71) }))
        assert.equal(next.replayed, false); assert.equal(next.row.phase, 'capturing')
        assert.equal(w.raw.prepare('SELECT COUNT(*) AS n FROM branch_cutovers').get().n, 2)
        assert.equal(JSON.stringify(w.raw.prepare('SELECT * FROM branch_cutovers WHERE operation_id=?').get(first.operation_id)), before)
        const replay = await journal.beginBranchCutoverJournal(w.db, input())
        assert.equal(replay.replayed, true); assert.equal(replay.row.terminal_json, terminal.terminal_json)
        assert.throws(() => w.raw.prepare('DELETE FROM branch_cutovers WHERE operation_id=?').run(first.operation_id), /branch_cutover_no_delete/)
        assert.throws(() => w.raw.prepare('UPDATE branch_cutovers SET revision=revision+1 WHERE operation_id=?').run(first.operation_id), /branch_cutover_terminal_immutable/)
      } finally { w.raw.close() }
    }
  })
  await check('begin binds exact durable identity and replay survives lost acknowledgment without retry', async () => {
    const w = world(); w.control.after = () => { throw Error('D1_ERROR: internal error lost acknowledgement') }
    await assert.rejects(start(w)); assert.equal(w.control.batches, 1)
    const replay = await journal.beginBranchCutoverJournal(w.db, input())
    assert.equal(replay.replayed, true); assert.equal(w.control.batches, 1); assert.equal(replay.row.revision, 0)
    assert.equal(w.raw.prepare('SELECT COUNT(*) AS n FROM branch_cutovers').get().n, 1)
    for (const patch of [{ intentJson: '{ "action":"retire","sourceBranchId":1,"targetBranchId":2}' }, { actorId: 8 }, { organizationId: 'other' }, { token: uuid(3) }, { operationId: uuid(4) }]) {
      await assert.rejects(journal.beginBranchCutoverJournal(w.db, input(patch)))
    }
    w.raw.close()
  })
  await check('begin rollback and occupied flag/control reject without partial journal or retry', async () => {
    for (const mode of ['failure', 'flag', 'control']) {
      const w = world()
      if (mode === 'failure') w.control.failAt = 2
      if (mode === 'flag') w.raw.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','foreign')")
      if (mode === 'control') w.control.before = db => db.prepare("UPDATE system_flags SET value=? WHERE key='branch_cutover_control_incarnation'").run(uuid(88))
      await assert.rejects(start(w)); assert.equal(w.control.batches, 1)
      assert.equal(w.raw.prepare('SELECT COUNT(*) AS n FROM branch_cutovers').get().n, 0)
      assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='maintenance'").get().n, mode === 'flag' ? 1 : 0)
      w.raw.close()
    }
  })
  await check('checkpoints reject wrong owner/token/phase/revision and same-read competing mutation', async () => {
    const w = world(); const row = await start(w)
    const update = (p = proof(row), revision = 0, phase = 'capturing') => journal.checkpointBranchCutoverJournal(w.db, p, revision,
      { phase, cursorJson: '{"id":1}', records: 1, digest })
    for (const p of [proof(row, { actorId: 8 }), proof(row, { organizationId: 'other' }), proof(row, { token: uuid(4) }), proof(row, { controlIncarnation: uuid(88) })]) await assert.rejects(update(p))
    await assert.rejects(update(proof(row), 1)); await assert.rejects(update(proof(row), 0, 'moving'))
    w.control.before = db => db.prepare('UPDATE branch_cutovers SET revision=revision+1 WHERE operation_id=?').run(row.operation_id)
    await assert.rejects(update()); assert.equal(w.raw.prepare('SELECT capture_records FROM branch_cutovers').get().capture_records, 0)
    const changed = await journal.readBranchCutoverJournal(w.db, proof(row))
    const next = await journal.checkpointBranchCutoverJournal(w.db, proof(row), changed.revision, { phase: 'capturing', cursorJson: '{"id":1}', records: 1, digest })
    assert.equal(next.capture_records, 1); assert.equal(next.revision, 2); w.raw.close()
  })
  await check('exact raw flag and installation marker are checked inside the transition transaction', async () => {
    for (const key of ['maintenance', 'branch_cutover_control_incarnation']) {
      const w = world(); const row = await start(w)
      w.control.before = db => {
        db.exec('DROP TRIGGER branch_cutovers_flag_update')
        db.prepare('UPDATE system_flags SET value=? WHERE key=?').run(key === 'maintenance' ? 'corrupt' : uuid(88), key)
      }
      await assert.rejects(journal.checkpointBranchCutoverJournal(w.db, proof(row), 0, { phase: 'capturing', cursorJson: '{}', records: 1, digest }))
      assert.equal(w.raw.prepare('SELECT revision FROM branch_cutovers').get().revision, 0); w.raw.close()
    }
  })
  await check('active journal prevents flag delete/update/replace/rename even with malformed raw flag; ordinary flags remain usable', async () => {
    const w = world()
    w.raw.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','ordinary'); DELETE FROM system_flags WHERE key='maintenance'")
    const row = await start(w)
    for (const key of ['maintenance', 'branch_cutover_control_incarnation']) {
      for (const statement of [
        `DELETE FROM system_flags WHERE key='${key}'`,
        `UPDATE system_flags SET value='broken' WHERE key='${key}'`,
        `UPDATE system_flags SET key='other' WHERE key='${key}'`,
        `INSERT OR REPLACE INTO system_flags(key,value) VALUES('${key}','broken')`,
      ]) assert.throws(() => w.raw.exec(statement), /branch_cutover_active_control_protected/)
    }
    w.raw.exec("INSERT INTO system_flags(key,value) VALUES('unrelated','value'); UPDATE system_flags SET value='next' WHERE key='unrelated'; DELETE FROM system_flags WHERE key='unrelated'")
    w.raw.exec('DROP TRIGGER branch_cutovers_flag_update')
    w.raw.exec("UPDATE system_flags SET value='malformed' WHERE key='maintenance'")
    assert.throws(() => w.raw.exec("DELETE FROM system_flags WHERE key='maintenance'"), /branch_cutover_active_control_protected/)
    assert.throws(() => w.raw.exec("INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance','replacement')"), /branch_cutover_active_control_protected/)
    await assert.rejects(journal.abortEffectFreeBranchCutoverJournal(w.db, proof(row), 0, 'corrupt refusal'))
    w.raw.close()
  })
  await check('empty manifest reaches verifying without planned child or fake receipt; ready/completion mutators absent', async () => {
    const w = world(); let row = await start(w); row = await seal(w, row)
    assert.equal(row.phase, 'snapshots')
    row = await journal.finishBranchCutoverSnapshots(w.db, proof(row), row.revision)
    assert.equal(row.phase, 'verifying'); assert.equal(row.next_sequence, 0); assert.equal(row.planned_child_json, null)
    assert.equal(journal.completeBranchCutoverJournal, undefined); assert.equal(journal.commitBranchCutoverChild, undefined)
    await assert.rejects(journal.sealBranchCutoverChild(w.db, proof(row), row.revision, '{}')); w.raw.close()
  })
  await check('nonempty manifest seals one deterministic child and cannot advance or abort effects by assertion', async () => {
    const w = world(); let row = await start(w)
    row = await journal.checkpointBranchCutoverJournal(w.db, proof(row), 0, { phase: 'capturing', cursorJson: '{"id":1}', records: 1, digest })
    row = await journal.sealBranchCutoverManifest(w.db, proof(row), row.revision, JSON.stringify({ version: 1, sourceBranchId: 1, targetBranchId: 2,
      capturedRecords: 1, movingProducts: 1, sourceQuantityText: '1', sourceLotQuantityText: '1', anomalies: 0, captureDigest: digest }))
    row = await journal.finishBranchCutoverSnapshots(w.db, proof(row), row.revision)
    assert.equal(row.phase, 'moving')
    const body = JSON.stringify({ operationId: row.operation_id, sequence: 0, actorId: 7, organizationId: 'fixture-org', controlIncarnation: uuid(99), sourceBranchId: 1, targetBranchId: 2, transfer: { productId: 19, quantity: 1 } })
    row = await journal.sealBranchCutoverChild(w.db, proof(row), row.revision, body)
    assert.equal(row.planned_child_key, `bc_${uuid(1)}_0`); assert.equal(row.next_sequence, 0)
    await assert.rejects(journal.sealBranchCutoverChild(w.db, proof(row), row.revision, body))
    await assert.rejects(journal.abortEffectFreeBranchCutoverJournal(w.db, proof(row), row.revision, 'abort'))
    assert.equal(w.raw.prepare('SELECT planned_child_json FROM branch_cutovers').get().planned_child_json, body); w.raw.close()
  })
  await check('effect-free abort atomically retains self-contained terminal evidence and clears only owned flag', async () => {
    const w = world(); const row = await start(w)
    const aborted = await journal.abortEffectFreeBranchCutoverJournal(w.db, proof(row), 0, 'operator stopped before effects')
    assert.equal(aborted.phase, 'aborted'); assert.equal(JSON.parse(aborted.terminal_json).operationId, row.operation_id)
    assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='maintenance'").get().n, 0)
    for (const sql of ["UPDATE branch_cutovers SET phase='capturing',revision=revision+1", "UPDATE branch_cutovers SET terminal_json='{}'", 'DELETE FROM branch_cutovers']) assert.throws(() => w.raw.exec(sql))
    assert.equal((await journal.readBranchCutoverJournal(w.db, proof(row))).terminal_json, aborted.terminal_json)
    assert.equal((await journal.beginBranchCutoverJournal(w.db, input())).replayed, true); w.raw.close()
  })
  await check('identity, manifest and terminal evidence cannot be rewritten through raw SQL', async () => {
    const w = world(); let row = await start(w)
    const before = JSON.stringify(w.raw.prepare('SELECT * FROM branch_cutovers').all())
    assert.throws(() => w.raw.exec('INSERT OR REPLACE INTO branch_cutovers SELECT * FROM branch_cutovers'), /branch_cutover_(invalid_initial_state|active_insert_refused)/)
    assert.equal(JSON.stringify(w.raw.prepare('SELECT * FROM branch_cutovers').all()), before)
    for (const [key, value] of [['actor_id','8'], ['intent_json',"'{}'"], ['maintenance_token',`'${uuid(4)}'`]]) assert.throws(() => w.raw.exec(`UPDATE branch_cutovers SET ${key}=${value},revision=revision+1`))
    row = await seal(w, row)
    assert.throws(() => w.raw.exec("UPDATE branch_cutovers SET manifest_json='{}',revision=revision+1"))
    assert.throws(() => w.raw.exec("UPDATE branch_cutovers SET phase='completed',terminal_json='{}',revision=revision+1")); w.raw.close()
  })
  await check('checkpoint lost acknowledgment retains committed revision and rejects stale retry; abort failure rolls back both records', async () => {
    const w = world(); const row = await start(w)
    w.control.after = () => { throw Error('D1_ERROR: internal error lost acknowledgement') }
    const update = () => journal.checkpointBranchCutoverJournal(w.db, proof(row), 0, { phase: 'capturing', cursorJson: '{"id":1}', records: 1, digest })
    await assert.rejects(update()); assert.equal(w.control.batches, 2)
    const committed = await journal.readBranchCutoverJournal(w.db, proof(row))
    assert.equal(committed.revision, 1); assert.equal(committed.capture_records, 1)
    await assert.rejects(update()); assert.equal(w.control.batches, 2)
    w.control.failAt = 2
    await assert.rejects(journal.abortEffectFreeBranchCutoverJournal(w.db, proof(row), 1, 'abort failure'))
    assert.equal(w.control.batches, 3)
    assert.equal(w.raw.prepare('SELECT phase FROM branch_cutovers').get().phase, 'capturing')
    assert.equal(w.raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value, row.maintenance_flag_json)
    w.raw.close()
  })
  await check('manifest and child malformed linkage cannot seal, and snapshot/verification checkpoints retain independent counters', async () => {
    const w = world(); let row = await start(w)
    const base = { version: 1, sourceBranchId: 1, targetBranchId: 2, capturedRecords: 0, movingProducts: 0,
      sourceQuantityText: '0', sourceLotQuantityText: '0', anomalies: 0, captureDigest: row.capture_digest }
    for (const patch of [{ capturedRecords: 1 }, { movingProducts: 1 }, { sourceQuantityText: '1' }, { anomalies: 1 }, { captureDigest: digest }, { other: [] }]) {
      await assert.rejects(journal.sealBranchCutoverManifest(w.db, proof(row), 0, JSON.stringify({ ...base, ...patch })))
    }
    row = await seal(w, row)
    row = await journal.checkpointBranchCutoverJournal(w.db, proof(row), row.revision, { phase: 'snapshots', cursorJson: '{"id":3}', records: 3, digest })
    row = await journal.finishBranchCutoverSnapshots(w.db, proof(row), row.revision)
    row = await journal.checkpointBranchCutoverJournal(w.db, proof(row), row.revision, { phase: 'verifying', cursorJson: '{"id":2}', records: 2, digest })
    assert.equal(row.capture_records, 0); assert.equal(row.snapshot_records, 3); assert.equal(row.verification_records, 2)
    w.raw.close()
    const moving = world(); let planned = await start(moving)
    planned = await journal.checkpointBranchCutoverJournal(moving.db, proof(planned), 0, { phase: 'capturing', cursorJson: '{"id":1}', records: 1, digest })
    planned = await journal.sealBranchCutoverManifest(moving.db, proof(planned), planned.revision, JSON.stringify({ ...base, capturedRecords: 1, movingProducts: 1, sourceQuantityText: '1', sourceLotQuantityText: '1', captureDigest: digest }))
    planned = await journal.finishBranchCutoverSnapshots(moving.db, proof(planned), planned.revision)
    const body = { operationId: planned.operation_id, sequence: 0, actorId: 7, organizationId: 'fixture-org', controlIncarnation: uuid(99), sourceBranchId: 1, targetBranchId: 2, transfer: { productId: 19, quantity: 1 } }
    for (const patch of [{ operationId: uuid(7) }, { sequence: 1 }, { actorId: 8 }, { organizationId: 'other' }, { controlIncarnation: uuid(88) }, { targetBranchId: 3 }, { transfer: { productId: 19, quantity: -1 } }]) {
      await assert.rejects(journal.sealBranchCutoverChild(moving.db, proof(planned), planned.revision, JSON.stringify({ ...body, ...patch })))
    }
    assert.equal(moving.raw.prepare('SELECT planned_child_json FROM branch_cutovers').get().planned_child_json, null)
    moving.raw.close()
  })
  await check('malformed/oversized inputs fail before writes and batches remain inside D1 envelopes', async () => {
    const w = world()
    for (const patch of [{ operationId: 'not-a-uuid' }, { actorId: 0 }, { targetBranchId: 1 }, { intentJson: '[]' },
      { intentJson: JSON.stringify({ value: 'ខ'.repeat(6000) }) }, { sourcePreimageJson: '{"id":9}' }, { intentJson: '{"list":' + JSON.stringify(Array(201).fill(1)) + '}' }]) await assert.rejects(start(w, patch))
    assert.equal(w.control.batches, 0)
    const row = await start(w)
    for (const progress of [{ phase: 'capturing', cursorJson: '[]', records: 1, digest }, { phase: 'capturing', cursorJson: '{}', records: -1, digest },
      { phase: 'capturing', cursorJson: '{}', records: 1, digest: 'bad' }]) await assert.rejects(journal.checkpointBranchCutoverJournal(w.db, proof(row), 0, progress))
    for (const batch of w.control.statements) for (const statement of batch) { assert(statement.binds <= 100); assert(statement.sqlBytes < 100000) }
    w.raw.close()
  })
  if (failures) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
