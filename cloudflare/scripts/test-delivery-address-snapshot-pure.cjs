// A delivery contact's address column holds the Contact Options JSON, and the
// sale snapshot copied it raw, so receipts printed the JSON. Every snapshot
// writer and the CSV export now go through deliveryDisplayAddress.
//
// Run: node scripts/test-delivery-address-snapshot-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.join(__dirname, '..', 'src')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const mod = { exports: {} }
new Function('module', 'exports', ts.transpileModule(read('lib/contactOptions.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(mod, mod.exports)
const { deliveryDisplayAddress } = mod.exports

const EMPTY = '[{"label":"Default","name":"ta","phone":"","email":"","address":"","area":""}]'
assert.equal(deliveryDisplayAddress(EMPTY), '', 'the owner row: every entry empty prints nothing')
assert.equal(deliveryDisplayAddress(null), '')
assert.equal(deliveryDisplayAddress('[{"address":"","area":"Toul Kork"}]'), 'Toul Kork', 'area is the fallback')
assert.equal(deliveryDisplayAddress('[{"address":"","area":""},{"address":"St 271","area":"Toul Kork"}]'), 'St 271', 'first non-empty entry, address before area')
assert.equal(deliveryDisplayAddress('Street 9, Siem Reap'), 'Street 9, Siem Reap', 'a plain typed address is untouched')
assert.equal(deliveryDisplayAddress('[{"address":'), '', 'truncated JSON is never printed')

const writers = {
  'routes/sales.ts': [/delivery_contact_address: deliveryDisplayAddress\(deliveryContact\?\.address\)/, /const snapshotAddress = deliveryDisplayAddress\(contactRow\.address\) \|\| deliveryDisplayAddress\(contactRow\.area\)/, /address: snapshotAddress,/, /deliveryContactAddress: snapshotAddress,/, /index === 0 \? deliveryDisplayAddress\(sale\.delivery_contact_address\)/],
  'lib/saleBulkUpdate.ts': [/deliveryDisplayAddress\(targetContact\.address\)/],
  'lib/saleRecords.ts': [/deliveryDisplayAddress\(snapshot\.delivery_contact_address\)/],
  'lib/importEngine.ts': [/deliveryDisplayAddress\(str\(first\.delivery_contact_address\)\)/],
}
for (const [file, patterns] of Object.entries(writers)) {
  const source = read(file)
  for (const pattern of patterns) assert.match(source, pattern, `${file} must resolve the delivery address: ${pattern}`)
}
assert.doesNotMatch(read('routes/sales.ts'), /delivery_contact_address: deliveryContact\?\.address \|\|/, 'the raw column copy is gone')

const Database = require('better-sqlite3')
const censusSql = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'queries', 'report-sale-delivery-address-json.sql'), 'utf8')
assert.ok(censusSql.replaceAll('\r', '').startsWith('-- ops:min-rows 1\n-- ops:max-rows 1\n-- ops:max-rows-read 200000\n'), 'the census declares its read budget right after max-rows')
const db = new Database(':memory:')
db.exec('CREATE TABLE sales (id INTEGER PRIMARY KEY, delivery_contact_address TEXT)')
const insert = db.prepare('INSERT INTO sales (delivery_contact_address) VALUES (?)')
for (const value of [EMPTY, '["St 9"]', '[{"address":"St 1"}]', '[Bldg A] St 9', '[{"address":', 'St 5', '{"a":1}', null]) insert.run(value)
assert.deepEqual(
  { ...db.prepare(censusSql).get() },
  { sales_with_delivery_address: 7, sales_with_json_address: 6, json_addresses_with_nothing_to_print: 2 },
  'the census neither throws on a legacy string array or invalid JSON nor counts a printable legacy entry as empty',
)

console.log('test-delivery-address-snapshot-pure.cjs OK')
