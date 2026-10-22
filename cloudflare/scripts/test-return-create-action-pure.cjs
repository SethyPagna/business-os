const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
function seedFixture(raw, seed) {
  const value = seedStockFixture(raw, seed)
  assert.throws(() => raw.exec("INSERT INTO products(name) VALUES('unadmitted fixture probe')"), /stock_transaction_required/)
  return value
}
function seedMarker(raw, key, seed) {
  const value = seedFixture(raw, seed)
  assert.ok(raw.prepare('SELECT value FROM system_flags WHERE key=?').get(key))
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  return value
}
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
// 6.0.958: a money-v1 return may carry replacement lines (the one-step exchange). They travel with the replacement quote the till reviewed and the
// customer's payment, or not at all; a plain v1 return keeps the exact digest keys it always had.
assert.deepEqual(Object.keys(canonicalV1), ['money_precision_version', 'sale_id', 'return_number', 'receipt_number', 'customer_id', 'customer_name', 'branch_id', 'reason',
  'return_type', 'notes', 'items', 'expected_quote', 'replacement_items'], 'a plain v1 return keeps the exact digest keys (and so bytes) it had before the exchange existed')
assert.deepEqual(canonicalV1.replacement_items, [])
assert.equal(Object.hasOwn(canonicalV1, 'expected_exchange') || Object.hasOwn(canonicalV1, 'exchange_payment'), false)
const exchangeQuote = { version: 1, sale_id: 4, exchange_rate: 4000, not_paid: false,
  lines: [{ product_id: 2, product_name: 'Gloss', branch_id: 2, batch_id: null, quantity: 1, unit_price_usd: 6.48, unit_price_khr: 25920, total_usd: 6.48, total_khr: 25920 }],
  calculated_total_usd: 6.48, rounding_adjustment_usd: 0, total_usd: 6.48, total_khr: 25920, refund_usd: 1, owed_reduction_usd: 0, credit_usd: 1, net_usd: 5.48 }
const exchangeBody = { money_precision_version: 1, sale_id: 4, reason: 'x', items: [{ sale_item_id: 8, quantity: 1 }],
  replacement_items: [{ product_id: 2, quantity: 1, branch_id: 2, batch_id: 14002, applied_price_usd: 6.48, name: 'untrusted' }], expected_quote: expectedQuote,
  expected_exchange: exchangeQuote, exchange_payment: { details: [{ method: ' ABA ', amount_usd: '5.48', amount_khr: 0 }], change_currency: 'khr' } }
const canonicalExchange = subject.canonicalReturnCreateIntent(exchangeBody)
assert.deepEqual(canonicalExchange.replacement_items, [{ product_id: 2, branch_id: 2, batch_id: 14002, quantity: 1, applied_price_usd: 6.48 }], 'only accepted client intent: no names')
assert.deepEqual(canonicalExchange.expected_exchange, exchangeQuote)
assert.deepEqual(canonicalExchange.exchange_payment, { details: [{ method: 'ABA', amount_usd: 5.48, amount_khr: 0 }], change_currency: 'KHR' })
assert.notEqual(JSON.stringify(canonicalExchange), JSON.stringify(subject.canonicalReturnCreateIntent({ ...exchangeBody, exchange_payment: { details: [{ method: 'ABA', amount_usd: 5.48, amount_khr: 0 }], change_currency: 'USD' } })),
  'the change currency is part of the intent: a retry with another currency is not an exact repeat')
for (const [name, body, code] of [
  ['no reviewed quote', { ...exchangeBody, expected_exchange: undefined }, 'return_exchange_quote_invalid'],
  ['an unknown quote field', { ...exchangeBody, expected_exchange: { ...exchangeQuote, extra: 1 } }, 'return_exchange_quote_invalid'],
  ['a bad payment row', { ...exchangeBody, exchange_payment: { details: [{ method: 'ABA', amount_usd: -1, amount_khr: 0 }], change_currency: 'USD' } }, 'return_exchange_payment_invalid'],
  ['a riel refund row with replacement lines', { ...exchangeBody, refund_currency: 'KHR' }, 'return_exchange_refund_currency'],
]) assert.throws(() => subject.canonicalReturnCreateIntent(body), (error) => error.code === code, name)
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

// 6.0.905: the projection is the return TAG (owner, 20 Oct 2026); the payment state is not its business.
assert.equal(subject.projectedReturnStateForReturnCreate(
  [{ id: 1, product_id: 5, quantity: 2 }, { id: 2, product_id: 5, quantity: 1 }],
  [{ sale_item_id: 1, product_id: 5, quantity: 2 }],
  [{ product_id: 5, quantity: 1 }],
), 'full', 'legacy product fallback fills only remaining item capacity')
assert.equal(subject.projectedReturnStateForReturnCreate(
  [{ id: 1, product_id: 5, quantity: 2 }], [], [{ sale_item_id: 1, quantity: 1 }],
), 'partial')
assert.equal(subject.projectedReturnStateForReturnCreate([], [], []), null)
assert.equal(subject.projectedReturnStateForReturnCreateV1(
  [{ id: 1, quantity: 0.3 }], [{ sale_item_id: 1, quantity: 0.1 }], [{ sale_item_id: 1, quantity: 0.2 }],
), 'full', 'v1 tag uses exact decimal coverage instead of a binary-float epsilon')
assert.equal(subject.projectedReturnStateForReturnCreateV1(
  [{ id: 1, quantity: 0.3 }], [], [{ sale_item_id: 1, quantity: 0.2 }],
), 'partial')
assert.throws(() => subject.projectedReturnStateForReturnCreateV1(
  [{ id: 1, quantity: 0.3 }], [{ sale_item_id: 1, quantity: 0.3 }], [{ sale_item_id: 1, quantity: 1e-20 }],
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
// FX-exc1 item 4 (28 Sep 2026): the refusal also carries its product and its
// counts as data (`params`), so POST /api/returns/bulk can hand them to the
// till, which restates the refusal in the operator's language. The English
// sentences stay exactly as they were.
{
  const refusal = (sold, committed, requested) => {
    try { subject.assertReturnCreateCapacity(sold, committed, requested) } catch (error) { return error }
    return null
  }
  const byLine = refusal([{ id: 1, product_id: 5, product_name: 'A', quantity: 2 }], [{ sale_item_id: 1, quantity: 2 }], [{ sale_item_id: 1, quantity: 1 }])
  assert.equal(byLine.message, 'Cannot return 3 of A — only 2 sold', 'the sale-line sentence is unchanged')
  assert.deepEqual(byLine.params, { product: 'A', returned: 3, sold: 2 }, 'a sale-line overflow names the line and its counts')
  // Line 1 is full (2 of 2), so the product-matched 3 fills line 2's 1 and
  // overflows by 2: 5 counted as returned against the 3 the sale sold of it.
  const byProduct = refusal(
    [{ id: 1, product_id: 5, product_name: 'A', quantity: 2 }, { id: 2, product_id: 5, product_name: 'A', quantity: 1 }],
    [{ sale_item_id: 1, quantity: 2 }], [{ product_id: 5, quantity: 3 }])
  assert.equal(byProduct.message, 'Cannot return 2 additional unit(s) of product #5 — only the unreturned sold quantity is eligible', 'the product sentence is unchanged')
  assert.deepEqual(byProduct.params, { product: 'A', returned: 5, sold: 3 }, 'a product-matched overflow names the product by its sale line and totals it')
  assert.deepEqual(refusal([{ id: 1, product_id: 5, product_name: 'A', quantity: 2 }], [], [{ product_id: 9, quantity: 1 }]).params,
    { product: '#9', returned: 1, sold: 0 }, 'a product the sale never sold is named by its id')
  assert.deepEqual(refusal([{ id: 1, product_id: 5, product_name: null, quantity: 1 }], [], [{ sale_item_id: 1, quantity: 2 }]).params,
    { product: '#5', returned: 2, sold: 1 }, 'an unnamed line is named by its product id')
  // 0.1 + 0.1 + 0.1 sums to 0.30000000000000004 in binary floats.
  assert.deepEqual(refusal([{ id: 1, product_id: 5, product_name: 'A', quantity: 0.2 }], [{ sale_item_id: 1, quantity: 0.1 }],
    [{ sale_item_id: 1, quantity: 0.1 }, { sale_item_id: 1, quantity: 0.1 }]).params,
  { product: 'A', returned: 0.3, sold: 0.2 }, 'the counts carry no binary-float noise')
  assert.equal(refusal([{ id: 1, product_id: null, product_name: null, quantity: 1 }], [], [{ sale_item_id: 1, quantity: 2 }]).params, null,
    'a line with neither name nor product carries no params, so the till keeps its plain sentence')
}

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
seedMarker(db, "sale_record_events_reset_guard", () => db.prepare("INSERT INTO system_flags(key,value) VALUES('sale_record_events_reset_guard','{\"mode\":\"reset\",\"token\":\"test\"}')").run())
db.prepare('DELETE FROM return_create_receipts WHERE id=?').run(row.id)
db.close()

console.log('PASS return-create canonical intent, projection, bounds, 0142 immutable receipt, and two-phase guard schema')
