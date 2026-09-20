const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const crypto = require('node:crypto')
const directory = path.join(__dirname, '../migrations')
const name = '0185_transfer_runs.sql'
const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < name).sort()) {
  db.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
}
const source = fs.readFileSync(path.join(__dirname, '../src/lib/transferRunStore.ts'), 'utf8')
const moduleObj = { exports: {} }
new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText)(moduleObj, moduleObj.exports)
const store = moduleObj.exports
const digest = text => crypto.createHash('sha256').update(text).digest('hex')
const owner = { actual: { actorId: 7, organizationId: 4 }, expected: { actorId: 7, organizationId: 4 } }
const position = (runId, revision = 0, sequence = 0) => ({ ...owner, runId, revision, sequence })
const request = requestId => { const requestJson = JSON.stringify({ productId: 1, quantity: 1, reason: requestId }); return { requestId, requestJson, digest: digest(requestJson) } }
const execute = statements => db.transaction(() => {
  for (const statement of statements) db.prepare(statement.sql).run(statement.params || {})
})()
const register = (runId, requestId) => execute(store.registerTransferRunStatements({ ...owner, runId, ...request(requestId), scope: 'branches' }))
const seal = (runId, child, revision = 0, sequence = 0, final = true) => execute(store.sealTransferRunChunkStatements({
  ...position(runId, revision, sequence), ...request(child), cursorBefore: sequence ? JSON.stringify({ done: sequence }) : '{}',
  cursorAfter: JSON.stringify({ done: sequence + 1 }), final,
}))
// Synthetic transfer effects use REAL receipt/history schema. These verify the
// store envelope, not existing transferOperation allocation/undo behavior.
function effects(key, actor = 7) {
  const intent = request(key)
  const params = { key, actor, body: intent.requestJson, digest: intent.digest }
  return [
    { sql: 'UPDATE products SET stock_quantity=stock_quantity-1 WHERE id=900001' },
    { sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status)
      VALUES('branches','stock_transfer',@key,'test',1,'undoable')`, params },
    { sql: `INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,response_json,status,
        operation_id,provenance_version,action_history_id,replay_state,generation)
      VALUES(@actor,@key,@digest,@body,'{"success":true}','committed',@key,1,last_insert_rowid(),'applied',0)`, params },
  ]
}
db.exec("INSERT INTO products(id,name,stock_quantity,cost_price_usd) VALUES(900001,'unchanged economics',20,3.123456)")
execute(effects('legacy-committed'))
const before = {
  product: db.prepare('SELECT * FROM products WHERE id=900001').get(),
  receipts: db.prepare('SELECT * FROM transfer_operation_receipts').all(),
  history: db.prepare('SELECT * FROM action_history').all(),
}
const migration = fs.readFileSync(path.join(directory, name), 'utf8')
assert.equal(migration.includes('\r'), false, 'append-only trigger SQL must be LF-only')
db.exec(migration)
assert.deepEqual(db.prepare('SELECT * FROM products WHERE id=900001').get(), before.product)
assert.deepEqual(db.prepare('SELECT * FROM transfer_operation_receipts').all(), before.receipts)
assert.deepEqual(db.prepare('SELECT * FROM action_history').all(), before.history)
console.log('PASS full-chain additive migration preserves historical money, receipts and history')

// Both serialized race orderings: SQLite commits one writer at a time. A failed
// competing transaction must roll back its preceding synthetic stock write too.
assert.throws(() => register('legacy-loser', 'legacy-committed'), /reserved/)
register('registered-winner', 'original-reserved')
const stockBeforeRace = db.prepare('SELECT stock_quantity n FROM products WHERE id=900001').get().n
assert.throws(() => execute(effects('original-reserved')), /reserved/)
assert.equal(db.prepare('SELECT stock_quantity n FROM products WHERE id=900001').get().n, stockBeforeRace)
assert.throws(() => register('duplicate-run', 'original-reserved'), /UNIQUE/)
console.log('PASS both original-receipt/registration race orderings and duplicate reservation')

register('run-main', 'original-main')
seal('run-main', 'child-main-000', 0, 0, false)
assert.throws(() => db.exec("UPDATE transfer_runs SET request_json='{}' WHERE id='run-main'"), /transition/)
assert.throws(() => db.exec("UPDATE transfer_run_chunks SET request_json='{}' WHERE run_id='run-main'"), /immutable/)
assert.throws(() => register('child-collision', 'child-main-000'), /reserved/)
assert.throws(() => seal('registered-winner', 'original-main'), /reserved/)
const baseline = db.prepare('SELECT stock_quantity n FROM products WHERE id=900001').get().n
const commit = store.commitTransferRunChunkStatements(position('run-main'), effects('child-main-000'))
const mismatched = effects('child-main-000').map(statement => statement.params
  ? { ...statement, params: { ...statement.params, body: '{"quantity":999}' } } : statement)
assert.throws(() => execute(store.commitTransferRunChunkStatements(position('run-main'), mismatched)), /active intent/)
assert.throws(() => execute(store.commitTransferRunChunkStatements(position('run-main'), effects('unrelated-child'))), /immutable|CHECK/)
assert.equal(db.prepare('SELECT stock_quantity n FROM products WHERE id=900001').get().n, baseline)
assert.throws(() => execute([...commit, { sql: 'INSERT INTO branches(name) VALUES(NULL)' }]), /NOT NULL/)
assert.equal(db.prepare('SELECT stock_quantity n FROM products WHERE id=900001').get().n, baseline)
assert.equal(db.prepare("SELECT status FROM transfer_run_chunks WHERE run_id='run-main'").get().status, 'planned')
assert.equal(db.prepare("SELECT revision FROM transfer_runs WHERE id='run-main'").get().revision, 0)
assert.equal(db.prepare("SELECT COUNT(*) n FROM transfer_operation_receipts WHERE request_id='child-main-000'").get().n, 0)
execute(commit)
assert.equal(db.prepare('SELECT stock_quantity n FROM products WHERE id=900001').get().n, baseline - 1)
assert.deepEqual(db.prepare("SELECT revision,next_sequence,status,cursor_json FROM transfer_runs WHERE id='run-main'").get(),
  { revision: 1, next_sequence: 1, status: 'active', cursor_json: '{"done":1}' })
assert.throws(() => execute(commit), /NOT NULL/)
assert.equal(db.prepare('SELECT stock_quantity n FROM products WHERE id=900001').get().n, baseline - 1)
console.log('PASS atomic rollback of stock/history/receipt/chunk/progress; duplicate commit blocked')

const adapter = { prepare(sql) { return { async get(params) { return db.prepare(sql).get(params) } } } }
async function main() {
  const ack = await store.committedTransferRunChunk(adapter, { ...owner, runId: 'run-main', sequence: 0 })
  assert.ok(ack.receipt_id)
  assert.equal(ack.request_id, 'child-main-000')
  assert.deepEqual(await store.committedTransferRunChunk(adapter, { ...owner, runId: 'run-main', sequence: 0 }), ack)
  assert.equal(db.prepare('SELECT stock_quantity n FROM products WHERE id=900001').get().n, baseline - 1)
  for (const changed of [{ actorId: 8, organizationId: 4 }, { actorId: 7, organizationId: 5 }, { actorId: 7, organizationId: null }]) {
    assert.throws(() => store.transitionTransferRunStatements({ ...position('run-main', 1, 1), actual: changed, status: 'paused' }), /actor or organization/)
    await assert.rejects(store.committedTransferRunChunk(adapter, { ...owner, actual: changed, runId: 'run-main', sequence: 0 }), /actor or organization/)
    // A new caller whose own expected identity matches still cannot access owner7/org4.
    assert.equal(await store.committedTransferRunChunk(adapter, { actual: changed, expected: changed, runId: 'run-main', sequence: 0 }), undefined)
    assert.throws(() => execute(store.transitionTransferRunStatements({ ...position('run-main', 1, 1), actual: changed, expected: changed, status: 'paused' })), /NOT NULL/)
  }
  console.log('PASS lost-ack reads same receipt; actor/org/null-org fences')

  seal('run-main', 'child-main-001', 1, 1)
  execute(store.transitionTransferRunStatements({ ...position('run-main', 1, 1), status: 'paused' }))
  assert.throws(() => execute(store.commitTransferRunChunkStatements(position('run-main', 2, 1), effects('child-main-001'))), /NOT NULL/)
  execute(store.transitionTransferRunStatements({ ...position('run-main', 2, 1), status: 'active' }))
  execute(store.commitTransferRunChunkStatements(position('run-main', 3, 1), effects('child-main-001')))
  assert.equal(db.prepare("SELECT status FROM transfer_runs WHERE id='run-main'").get().status, 'completed')
  assert.throws(() => execute(store.transitionTransferRunStatements({ ...position('run-main', 4, 2), status: 'active' })), /transition/)
  execute(store.transitionTransferRunStatements({ ...position('registered-winner'), status: 'abandoned' }))
  assert.throws(() => execute(effects('original-reserved')), /reserved/)
  assert.throws(() => db.exec("DELETE FROM transfer_runs WHERE id='registered-winner'"), /retained/)
  assert.throws(() => db.exec("DELETE FROM transfer_run_chunks WHERE run_id='run-main'"), /retained/)
  assert.throws(() => execute(store.transitionTransferRunStatements({ ...position('registered-winner', 1), status: 'active' })), /transition/)
  assert.equal(db.prepare('SELECT cost_price_usd FROM products WHERE id=900001').get().cost_price_usd, 3.123456)
  assert.deepEqual(db.prepare("SELECT * FROM transfer_operation_receipts WHERE request_id='legacy-committed'").get(), before.receipts[0])
  const reservations = db.prepare('SELECT * FROM transfer_runs ORDER BY id').all()
  assert.throws(() => db.exec(migration), /already exists/)
  assert.deepEqual(db.prepare('SELECT * FROM transfer_runs ORDER BY id').all(), reservations)
  console.log('PASS pause/resume/final status CAS; abandonment never releases original key; historical precision untouched')
  db.close()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
