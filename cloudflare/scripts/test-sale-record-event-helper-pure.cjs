const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const fields = JSON.parse(fs.readFileSync(path.join(__dirname, '../../outputs/takeover-20260908/f74-sales-records-backend-contract.json'), 'utf8')).fields
const kinds = JSON.parse(fs.readFileSync(path.join(__dirname, '../../outputs/takeover-20260908/f74-sales-records-backend-contract.json'), 'utf8')).kinds
const sourcePath = path.join(__dirname, '../src/lib/saleRecordEvents.ts')
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', output)(moduleObj.exports, (request) => {
  if (request === './saleRecords') return { SALE_RECORD_FIELDS: fields, SALE_RECORD_KINDS: kinds }
  return require(request)
}, moduleObj)
const subject = moduleObj.exports

const change = (field, before, after) => ({ field, before, after })
const known = (value) => ({ state: 'known_value', value })
const none = { state: 'known_none' }
const base = (overrides = {}) => ({
  saleId: 1,
  sourceKind: 'sale_status',
  sourceId: `actor:1:request:${crypto.randomUUID()}`,
  generation: 0,
  kind: 'status_changed',
  via: 'apply',
  actorId: 1,
  actorUsername: 'admin',
  occurredAt: '2026-09-08T00:00:00.000Z',
  changes: [change('sale_status', known('completed'), known('returned'))],
  ...overrides,
})

const built = subject.buildSaleRecordEventsInsert([base()])
assert.equal(built.eventsBytes, Buffer.byteLength(built.statement.params.events, 'utf8'))
assert.equal(Object.keys(built.statement.params).length, 1, 'one json_each bind carries the whole event set')

const db = new Database(':memory:')
for (const migration of loadAll()) db.exec(migration)
db.prepare("INSERT INTO sales(id,receipt_number) VALUES(1,'S-1')").run()
db.prepare(built.statement.sql).run(built.statement.params)
const row = db.prepare('SELECT * FROM sale_record_events').get()
assert.equal(row.sale_id, 1)
assert.deepEqual(JSON.parse(row.changes_json), base().changes)

assert.equal(subject.buildSaleRecordEventsInsert([]), null)
assert.throws(() => subject.buildSaleRecordEventsInsert([base({ kind: 'legacy_sale_change', changes: [] })]), /kind is invalid/)
assert.throws(() => subject.buildSaleRecordEventsInsert([base({ changes: [] })]), /require 1-12/)
assert.throws(() => subject.buildSaleRecordEventsInsert([base({ changes: [change('sale_status', known('completed'), known('completed'))] })]), /did not change/)
assert.throws(() => subject.buildSaleRecordEventsInsert([base({ changes: [change('customer', known({ id: null, name: 'Dara', phone: '012' }), none)], kind: 'customer_changed' })]), /unsupported shape/)
assert.throws(() => subject.buildSaleRecordEventsInsert([base({ changes: [change('payment_method', known(null), known('Cash'))], kind: 'payment_changed' })]), /known_none/)
assert.throws(() => subject.buildSaleRecordEventsInsert([base({ response: { success: true, raw: 'forbidden' } })]), /unsupported keys/)
assert.throws(() => subject.buildSaleRecordEventsInsert(Array.from({ length: 26 }, () => base())), /limited to 25/)
assert.throws(() => subject.buildSaleRecordEventsInsert([base({
  kind: 'items_replaced',
  changes: [change('added_items', known(Array.from({ length: 160 }, (_, index) => ({
    sale_item_id: index + 1, product_id: index + 1, name: 'ក'.repeat(150), sku: null, unit_price_usd: 1, line_total_usd: 1,
  }))), none)],
})]), /65536 UTF-8 bytes/)
assert.throws(() => subject.assertSaleRecordBatchBounds(10, { value: 'x'.repeat(400_000) }, 120_001), /too large/)
subject.assertSaleRecordBatchBounds(500, { value: 'x'.repeat(300_000) }, 120_000)
assert.throws(() => subject.assertSaleRecordBatchBounds(501, {}, 1), /too large/)

subject.sha256Hex('exact request').then((digest) => {
  assert.match(digest, /^[0-9a-f]{64}$/)
  db.close()
  console.log('PASS closed Sales Records event validation, one-statement insert, privacy, UTF-8 and combined bounds')
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
