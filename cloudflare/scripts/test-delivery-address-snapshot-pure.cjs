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
  'routes/sales.ts': [/delivery_contact_address: deliveryDisplayAddress\(deliveryContact\?\.address\)/, /address: deliveryDisplayAddress\(contactRow\.delivery_address\)/, /deliveryContactAddress: deliveryDisplayAddress\(/, /index === 0 \? deliveryDisplayAddress\(sale\.delivery_contact_address\)/],
  'lib/saleBulkUpdate.ts': [/deliveryDisplayAddress\(targetContact\.address\)/],
  'lib/saleRecords.ts': [/deliveryDisplayAddress\(snapshot\.delivery_contact_address\)/],
  'lib/importEngine.ts': [/deliveryDisplayAddress\(str\(first\.delivery_contact_address\)\)/],
}
for (const [file, patterns] of Object.entries(writers)) {
  const source = read(file)
  for (const pattern of patterns) assert.match(source, pattern, `${file} must resolve the delivery address: ${pattern}`)
}
assert.doesNotMatch(read('routes/sales.ts'), /delivery_contact_address: deliveryContact\?\.address \|\|/, 'the raw column copy is gone')

console.log('test-delivery-address-snapshot-pure.cjs OK')
