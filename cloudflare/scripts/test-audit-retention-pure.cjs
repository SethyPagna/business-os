// Audit retention must preserve the only actor/time evidence for Return bulk
// undo/redo while continuing to delete every unrelated old audit row. Both the
// scheduled path and the legacy/manual clear route use the same SQL builder.
//
// Run (from cloudflare/): node scripts/test-audit-retention-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert/strict')
const Database = require('better-sqlite3')

const auditPath = path.join(__dirname, '..', 'src', 'lib', 'audit.ts')
const auditSource = fs.readFileSync(auditPath, 'utf8')
const output = ts.transpileModule(auditSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const moduleObj = { exports: {} }
const localRequire = (request) => {
  if (request === './db') return { getDb: () => { throw new Error('not used') } }
  if (request === './actorSnapshot') return { ACTOR_USERNAME_SQL: '', resolveActorUsername: () => null }
  return require(request)
}
new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
const { buildAuditLogRetentionDeleteSql } = moduleObj.exports

assert.equal(typeof buildAuditLogRetentionDeleteSql, 'function')
const sql = buildAuditLogRetentionDeleteSql()

const sqlite = new Database(':memory:')
sqlite.exec(`
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY,
    action TEXT,
    entity TEXT,
    details TEXT,
    entity_id TEXT,
    user_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT
  );
`)
const insert = sqlite.prepare('INSERT INTO audit_logs(id,action,entity,details,created_at) VALUES(?,?,?,?,?)')
const old = '2026-01-01 00:00:00'
insert.run(1, 'update', 'sale', '{}', old)
insert.run(2, 'action_undo', 'return', '{"kind":"something.else"}', old)
insert.run(3, 'return_fields_bulk', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(4, 'action_undo', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(5, 'action_redo', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(6, 'action_redo', 'product', '{"kind":"return.fields.bulk"}', old)
insert.run(7, 'update', 'sale', '{}', '2026-09-07 00:00:00')
const requestId = 'shift_request_123456'
const request = { id: requestId, target: 17, canonical: JSON.stringify({ client_request_id: requestId, expected_revision: 2 }) }
for (const [offset, action] of ['shift.close', 'shift.reopen', 'shift.amend', 'shift.cancel'].entries()) {
  insert.run(8 + offset, action, 'shift_session', JSON.stringify({ request }), old)
}
// The route accepts numeric-string revisions too. Retention recognizes its
// receipt envelope, not a stricter reimplementation of request validation.
insert.run(99, 'shift.close', 'shift_session', JSON.stringify({ request: { ...request,
  canonical: JSON.stringify({ client_request_id: requestId, expected_revision: '2' }),
} }), old)
const ordinaryShiftRows = [
  ['shift.close', 'shift_session', '{}'],
  ['shift.open', 'shift_session', JSON.stringify({ request })],
  ['shift.open_after_cancel', 'shift_session', JSON.stringify({ request })],
  ['shift.close', 'sale', JSON.stringify({ request })],
  ['shift.close', 'shift_session', '{broken'],
  ['shift.close', 'shift_session', null],
  ...[
    { ...request, id: 'short' },
    { ...request, id: 'invalid request id' },
    { ...request, target: null },
    { ...request, target: 0 },
    { ...request, canonical: null },
    { ...request, canonical: '{broken' },
    { ...request, canonical: '{}' },
    { ...request, canonical: JSON.stringify({ client_request_id: 'different_request_id', expected_revision: 2 }) },
    { ...request, canonical: JSON.stringify({ client_request_id: null }) },
  ].map(request => ['shift.close', 'shift_session', JSON.stringify({ request })]),
]
for (const [offset, row] of ordinaryShiftRows.entries()) insert.run(12 + offset, ...row, old)

const priceReceipt = { kind: 'product.bulk-price-adjust', version: 1, client_request_id: 'price_adjust_aged001',
  claim_nonce: '11111111-1111-1111-1111-111111111111', rowsTouched: 2,
  request: JSON.stringify({ direction: 'increase', amount: 1, fields: ['selling_price_usd'], skip_zero: false }) }
const insertPrice = (id, details, overrides = {}) => sqlite.prepare(`INSERT INTO audit_logs
  (id,action,entity,entity_id,user_id,details,old_value,new_value,created_at) VALUES(@id,@action,@entity,@entityId,@actor,@details,@before,@after,@created)`)
  .run({id,action:'update',entity:'product',entityId:'bulk-price-adjust',actor:21,details:JSON.stringify(details),before:'{"rows_touched":0}',after:'{"rows_touched":2}',created:old,...overrides})
insertPrice(100,priceReceipt)
const malformedPrices = [
  { ...priceReceipt, kind: 'other' }, { ...priceReceipt, version: 2 }, { ...priceReceipt, client_request_id: 'short' },
  { ...priceReceipt, client_request_id: 'bad id x' }, { ...priceReceipt, claim_nonce: 'short' },
  { ...priceReceipt, rowsTouched: null }, { ...priceReceipt, rowsTouched: -1 }, { ...priceReceipt, rowsTouched: 1.5 },
  { ...priceReceipt, request: '{broken' }, { ...priceReceipt, request: '{}' },
  ...[{direction:'sideways'},{amount:0},{amount:'1'},{fields:[]},{fields:['unsafe_field']},{fields:[1]},{skip_zero:1}]
    .map(change=>({...priceReceipt,request:JSON.stringify({direction:'increase',amount:1,fields:['selling_price_usd'],skip_zero:false,...change})})),
]
for (const [offset,details] of malformedPrices.entries()) insertPrice(101+offset,details)
const unrelatedPrices = [{entity:'sale'},{entityId:'another'},{action:'create'},{actor:0},{after:'{"rows_touched":3}'},{after:null},{before:'{broken'}]
for (const [offset,overrides] of unrelatedPrices.entries()) insertPrice(200+offset,priceReceipt,overrides)

const result = sqlite.prepare(sql).run({ cutoff: '2026-09-01 00:00:00' })
assert.equal(result.changes, 4 + ordinaryShiftRows.length + malformedPrices.length + unrelatedPrices.length, 'ordinary, legacy, malformed and unrelated operational audits still expire')
assert.deepEqual(
  sqlite.prepare('SELECT id FROM audit_logs ORDER BY id').all().map((row) => row.id),
  [4, 5, 7, 8, 9, 10, 11, 99, 100],
  'only Return replay, exact Shift receipts and validated completed price receipts bypass age retention',
)
for (const id of [8, 9, 10, 11]) {
  assert.deepEqual(JSON.parse(sqlite.prepare('SELECT details FROM audit_logs WHERE id=?').get(id).details).request, request,
    'retention preserves byte-equivalent request identity for later exact replay')
}
sqlite.close()

const compatSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
assert.match(auditSource, /prepare\(buildAuditLogRetentionDeleteSql\(\)\)/,
  'scheduled retention must use the shared narrow deletion SQL')
assert.match(compatSource, /import \{ audit, buildAuditLogRetentionDeleteSql \} from '\.\.\/lib\/audit'/,
  'manual retention must import the same policy')
assert.match(compatSource, /prepare\(buildAuditLogRetentionDeleteSql\(\)\)/,
  'manual retention must use the same narrow deletion SQL')
assert.doesNotMatch(compatSource, /DELETE FROM audit_logs WHERE id IN \(SELECT id FROM audit_logs WHERE created_at < @cutoff LIMIT 5000\)/,
  'manual retention must not retain its old blanket deletion path')

console.log('audit retention: Return bulk provenance and exact Shift lifecycle receipts preserved narrowly')
