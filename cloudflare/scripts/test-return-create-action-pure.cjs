const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/returnCreateAction.ts'), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', output)(moduleObj.exports, (request) => {
  if (request === './saleRecordEvents') {
    return { assertSaleRecordBatchBounds: (count, request, eventBytes) => {
      if (Buffer.byteLength(JSON.stringify(request), 'utf8') + eventBytes > 512000) throw new Error('combined too large')
      if (count > 500) throw new Error('too many statements')
    } }
  }
  return require(request)
}, moduleObj)
const subject = moduleObj.exports

const canonical = subject.canonicalReturnCreateIntent({
  sale_id: '4', reason: ' wrong size ', total_refund_usd: 999,
  items: [{ sale_item_id: 8, product_id: 9, quantity: '2', applied_price_usd: '3.5', return_to_stock: false }],
  replacement_items: [{ product_id: 10, quantity: 1 }],
})
assert.equal(canonical.sale_id, 4)
assert.equal(canonical.reason, 'wrong size')
assert.equal(canonical.items[0].stock_action, 'none')
assert(!Object.hasOwn(canonical, 'total_refund_usd'), 'server-derived/posted refund totals are outside the digest')
assert.throws(() => subject.canonicalReturnCreateIntent({ reason: 'x', items: [] }), /items required/i)
assert.throws(() => subject.canonicalReturnCreateIntent({ reason: 'x'.repeat(501), items: [{ quantity: 1 }] }), /500 UTF-8 bytes/)

assert.equal(subject.projectedSaleStatusForReturnCreate(
  [{ id: 1, product_id: 5, quantity: 2 }, { id: 2, product_id: 5, quantity: 1 }],
  [{ sale_item_id: 1, product_id: 5, quantity: 2 }],
  [{ product_id: 5, quantity: 1 }],
  'completed',
), 'returned', 'legacy product fallback fills only remaining item capacity')
assert.equal(subject.projectedSaleStatusForReturnCreate(
  [{ id: 1, product_id: 5, quantity: 2 }], [], [{ sale_item_id: 1, quantity: 1 }], 'completed',
), 'partial_return')
assert.equal(subject.projectedSaleStatusForReturnCreate([], [], [], 'awaiting_payment'), 'awaiting_payment')
assert.doesNotThrow(() => subject.assertReturnCreateCapacity(
  [{ id: 1, product_id: 5, product_name: 'A', quantity: 2 }, { id: 2, product_id: 5, product_name: 'A', quantity: 1 }],
  [{ sale_item_id: 1, quantity: 1 }], [{ sale_item_id: 1, quantity: 1 }, { product_id: 5, quantity: 1 }],
))
assert.throws(() => subject.assertReturnCreateCapacity(
  [{ id: 1, product_id: 5, product_name: 'A', quantity: 2 }], [],
  [{ sale_item_id: 1, quantity: 2 }, { sale_item_id: 1, quantity: 1 }],
), /only 2 sold/, 'duplicate lines are aggregate-validated')
assert.throws(() => subject.assertReturnCreateCapacity(
  [{ id: 1, product_id: 5, product_name: 'A', quantity: 2 }], [],
  [{ sale_item_id: 1, quantity: 2 }, { product_id: 5, quantity: 1 }],
), /additional unit/, 'sale-line and product-fallback quantities share one capacity')

const guard = subject.returnCreateGuardStatement(crypto.randomUUID(), 'precondition', '1=1')
assert.match(guard.sql, /operation_id,phase,guard_value/)
assert.equal(guard.params.returnCreatePhase, 'precondition')
assert.match(subject.returnCreateIdSql(), /client_request_id=@returnClientRequestId/)
assert.match(subject.replacementSaleIdSql(), /client_request_id=@replacementClientRequestId/)
assert.throws(() => subject.assertReturnCreatePlanBounds(Array.from({ length: 501 }, () => ({ sql: 'SELECT 1', params: {} })), canonical, 0), /fewer items/)
assert.doesNotThrow(() => subject.assertReturnCreatePlanBounds(Array.from({ length: 500 }, () => ({ sql: 'SELECT 1', params: {} })), canonical, 0))
assert.throws(() => subject.assertReturnCreatePlanBounds([{ sql: 'SELECT 1', params: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`p${i}`, i])) }], canonical, 0), /too many inputs/)
assert.throws(() => subject.assertReturnCreatePlanBounds([{ sql: 'SELECT 1', params: {} }], { value: 'x'.repeat(500000) }, 20000), /combined too large/)

const migration = fs.readFileSync(path.join(root, 'migrations/0142_return_create_receipts.sql'), 'utf8')
assert(!migration.includes('\r'), '0142 trigger SQL must remain LF-only')
const db = new Database(':memory:')
for (const sql of loadAll()) db.exec(sql)
db.pragma('foreign_keys = ON')
db.prepare("INSERT INTO sales(id,receipt_number) VALUES(1,'S-1')").run()
db.prepare("INSERT INTO returns(id,return_number,sale_id,client_request_id) VALUES(2,'R-2',1,'req-2')").run()
const insert = db.prepare(`INSERT INTO return_create_receipts(
  id,actor_id,return_id,sale_id,request_id,request_digest,request_json,response_json,occurred_at
) VALUES(@id,@actor_id,@return_id,@sale_id,@request_id,@request_digest,@request_json,@response_json,@occurred_at)`)
const valid = (override = {}) => ({
  id: crypto.randomUUID(), actor_id: 3, return_id: 2, sale_id: 1, request_id: 'req-2',
  request_digest: 'a'.repeat(64), request_json: '{"sale_id":1}',
  response_json: '{"id":2,"returnNumber":"R-2","replacementSaleId":null,"replacementReceiptNumber":null}',
  occurred_at: '2026-09-09T01:02:03.004Z', ...override,
})
const row = valid()
insert.run(row)
for (const [label, override] of [
  ['uuid', { id: 'bad' }], ['actor', { actor_id: 0 }], ['return', { return_id: 0 }],
  ['sale mismatch', { request_json: '{"sale_id":2}' }], ['request whitespace', { request_id: ' req-x ' }],
  ['digest', { request_digest: 'G'.repeat(64) }], ['response extra', { response_json: '{"id":2,"returnNumber":"R-2","replacementSaleId":null,"replacementReceiptNumber":null,"private":true}' }],
  ['response pair', { response_json: '{"id":2,"returnNumber":"R-2","replacementSaleId":4,"replacementReceiptNumber":null}' }],
  ['timestamp', { occurred_at: '2026-09-09 01:02:03' }],
]) assert.throws(() => insert.run(valid({ request_id: `other-${label}`, ...override })), /constraint|foreign key/i, label)
assert.throws(() => db.prepare('UPDATE return_create_receipts SET occurred_at=? WHERE id=?').run('2026-09-10T01:02:03.004Z', row.id), /immutable/i)
assert.throws(() => db.prepare('DELETE FROM return_create_receipts WHERE id=?').run(row.id), /immutable/i)
assert.throws(() => db.prepare("INSERT INTO return_create_guards(operation_id,phase,guard_value) VALUES(?,?,0)").run(crypto.randomUUID(), 'precondition'), /constraint/i)
const operation = crypto.randomUUID()
db.prepare("INSERT INTO return_create_guards(operation_id,phase,guard_value) VALUES(?,?,1)").run(operation, 'precondition')
assert.throws(() => db.prepare("INSERT INTO return_create_guards(operation_id,phase,guard_value) VALUES(?,?,1)").run(operation, 'precondition'), /unique/i)
db.prepare("INSERT INTO system_flags(key,value) VALUES('sale_record_events_reset_guard','{\"mode\":\"reset\",\"token\":\"test\"}')").run()
db.prepare('DELETE FROM return_create_receipts WHERE id=?').run(row.id)
db.close()

console.log('PASS return-create canonical intent, projection, bounds, 0142 immutable receipt, and two-phase guard schema')
