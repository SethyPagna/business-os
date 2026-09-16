const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/returnCreateAction.ts'), 'utf8')
const output = buildSync({ stdin: { contents: source, resolveDir: path.join(root, 'src/lib'), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022',
}).outputFiles[0].text
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
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
assert.deepEqual(canonical, {
  sale_id: 4, return_number: null, receipt_number: null, customer_id: null, customer_name: null,
  branch_id: null, reason: 'wrong size', return_type: 'restock', notes: null, exchange_rate: null,
  items: [{ sale_item_id: 8, product_id: 9, product_name: null, quantity: 2,
    applied_price_usd: 3.5, applied_price_khr: 0, cost_price_usd: 0, cost_price_khr: 0,
    stock_action: 'none', branch_id: null, batch_id: null }],
  replacement_items: [{ product_id: 10, product_name: null, branch_id: null, batch_id: null,
    quantity: 1, applied_price_usd: null, applied_price_khr: null }], replacement_payment_method: 'Cash',
}, 'absent-version v0 canonical bytes retain the legacy shape')

const expectedQuote = { money_precision_version: 1, sale_id: 4, sale_revision: 7,
  calculated_refund_usd: 1, rounding_adjustment_usd: 0, total_refund_usd: 1, total_refund_khr: 4000,
  items: [{ sale_item_id: 8, quantity: 1, total_usd: 1, total_khr: 4000,
    applied_price_usd: 1, applied_price_khr: 4000 }] }
const canonicalV1 = subject.canonicalReturnCreateIntent({ money_precision_version: 1, sale_id: 4,
  reason: ' exact refund ', items: [{ sale_item_id: 8, product_id: 99, product_name: 'untrusted', quantity: 1,
    applied_price_usd: 999, cost_price_usd: 999, stock_action: 'restock', branch_id: 2, batch_id: 3 }],
  expected_quote: expectedQuote })
assert.deepEqual(canonicalV1.items, [{ sale_item_id: 8, quantity: 1, stock_action: 'restock', branch_id: 2, batch_id: 3 }])
assert.deepEqual(canonicalV1.expected_quote, expectedQuote)
assert.equal(Object.hasOwn(canonicalV1.items[0], 'applied_price_usd'), false, 'client price is outside v1 intent')
assert.throws(() => subject.canonicalReturnCreateIntent({ money_precision_version: 0, reason: 'x', items: [{ quantity: 1 }] }), /unsupported/i)
assert.throws(() => subject.canonicalReturnCreateIntent({ money_precision_version: 1, sale_id: 4, reason: 'x',
  items: [{ sale_item_id: 8, quantity: 1 }], replacement_items: [{ product_id: 2, quantity: 1 }], expected_quote: expectedQuote }), /replacement/i)
assert.throws(() => subject.canonicalReturnCreateIntent({ money_precision_version: 1, sale_id: 4, reason: 'x',
  items: [{ sale_item_id: 9, quantity: 1 }], expected_quote: expectedQuote }), /does not match/i)
// P4-3: the damaged-line choice is IN the digest only when the client sent it,
// so a legacy request keeps its exact bytes while a changed tag/disposition is
// a different intent (never replayed as an exact repeat).
const tagged = subject.canonicalReturnCreateIntent({ sale_id: 4, reason: 'x',
  items: [{ sale_item_id: 8, quantity: 1, stock_action: 'damaged', condition_tag: ' broken ', damaged_disposition: 'remove' }] })
assert.deepEqual({ condition_tag: tagged.items[0].condition_tag, damaged_disposition: tagged.items[0].damaged_disposition },
  { condition_tag: 'broken', damaged_disposition: 'remove' }, 'damaged choice joins the v0 digest when sent')
assert.notDeepEqual(JSON.stringify(tagged), JSON.stringify(subject.canonicalReturnCreateIntent({ sale_id: 4, reason: 'x',
  items: [{ sale_item_id: 8, quantity: 1, stock_action: 'damaged', condition_tag: 'expired', damaged_disposition: 'remove' }] })),
  'a different tag is a different intent')
const taggedV1 = subject.canonicalReturnCreateIntent({ money_precision_version: 1, sale_id: 4, reason: 'x',
  items: [{ sale_item_id: 8, quantity: 1, stock_action: 'damaged', condition_tag: 'broken' }], expected_quote: expectedQuote })
assert.deepEqual(taggedV1.items, [{ sale_item_id: 8, quantity: 1, stock_action: 'damaged', branch_id: null, batch_id: null, condition_tag: 'broken' }],
  'v1 carries the tag only; an unsent disposition adds no key')
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
assert.equal(subject.projectedSaleStatusForReturnCreateV1(
  [{ id: 1, quantity: 0.3 }], [{ sale_item_id: 1, quantity: 0.1 }], [{ sale_item_id: 1, quantity: 0.2 }], 'completed',
), 'returned', 'v1 status uses exact decimal coverage instead of a binary-float epsilon')
assert.equal(subject.projectedSaleStatusForReturnCreateV1(
  [{ id: 1, quantity: 0.3 }], [], [{ sale_item_id: 1, quantity: 0.2 }], 'completed',
), 'partial_return')
assert.throws(() => subject.projectedSaleStatusForReturnCreateV1(
  [{ id: 1, quantity: 0.3 }], [{ sale_item_id: 1, quantity: 0.3 }], [{ sale_item_id: 1, quantity: 1e-20 }], 'completed',
), /exceeds/i, 'a positive exact excess cannot disappear in Number addition')
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
assert.throws(() => subject.assertReturnCreatePlanBounds([{ sql: 'SELECT 1', params: {} }], { value: 'x'.repeat(500000) }, 20000), /too large|fewer records/)

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
