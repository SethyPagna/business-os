// Adapted from ops/old-archive/backend/test/contactOptions.test.ts (the
// original Docker/Postgres backend's test for this exact logic) to run
// against the REAL ported file, src/lib/contactOptions.ts -- which this
// project never had a test for despite lib/contactOptions.ts's own header
// comment claiming it's "kept behaviorally aligned" with that legacy
// version. Same transpile-in-memory approach as
// test-import-engine-pure.cjs (no bundler/esbuild/rollup needed -- those
// aren't Linux-compatible in this sandbox).
//
// One real API difference from the legacy version, adapted below rather
// than skipped: the legacy functions took an options OBJECT as their
// second argument (`{ mode: 'area' }`); this port takes the mode as a
// plain string (`'area'`) directly -- see this file's own header comment
// on why. The test bodies are otherwise unchanged from the original.
//
// Run: node scripts/test-contact-options.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'contactOptions.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'contactOptions.ts',
})

const moduleObj = { exports: {} }
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))

const {
  CONTACT_OPTION_LIMIT,
  buildImportedContactState,
  parseImportContactOptions,
  parseStoredContactOptions,
  serializeContactOptions,
} = moduleObj.exports

let failed = 0
function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('parseImportContactOptions caps imported contacts at three entries', () => {
  const options = parseImportContactOptions({
    contact_label_1: 'Primary',
    contact_name_1: 'A',
    contact_phone_1: '1',
    contact_label_2: 'Backup',
    contact_name_2: 'B',
    contact_phone_2: '2',
    contact_label_3: 'Warehouse',
    contact_name_3: 'C',
    contact_phone_3: '3',
    contact_label_4: 'Overflow',
    contact_name_4: 'D',
    contact_phone_4: '4',
  })

  assert.strictEqual(options.length, CONTACT_OPTION_LIMIT)
  assert.deepStrictEqual(options.map((option) => option.label), ['Primary', 'Backup', 'Warehouse'])
})

runTest('parseStoredContactOptions migrates legacy plain strings into structured contacts', () => {
  const options = parseStoredContactOptions('Main pickup office')
  assert.strictEqual(options.length, 1)
  assert.strictEqual(options[0].label, 'Default')
  assert.strictEqual(options[0].address, 'Main pickup office')
})

runTest('buildImportedContactState prefers imported structured options for supplier-style records', () => {
  const result = buildImportedContactState({
    name: 'Supplier One',
    contact_label_1: 'Sales',
    contact_name_1: 'Jane',
    contact_phone_1: '010',
    contact_email_1: 'jane@example.com',
    contact_address_1: 'Street 1',
  })

  assert.strictEqual(result.options.length, 1)
  assert.strictEqual(result.primary.name, 'Jane')
  assert.strictEqual(result.primary.email, 'jane@example.com')
  assert.match(String(result.serialized || ''), /jane@example\.com/)
})

runTest('buildImportedContactState labels the plain-column default option "Default"', () => {
  const result = buildImportedContactState({
    name: 'Customer One',
    phone: '012000111',
    email: 'customer@example.com',
    address: 'House 9, St 5',
    contact_label_2: 'Work',
    contact_name_2: 'Reception',
    contact_phone_2: '023000222',
  })

  assert.strictEqual(result.options.length, 2)
  assert.strictEqual(result.options[0].label, 'Default')
  assert.strictEqual(result.options[0].phone, '012000111')
  assert.strictEqual(result.options[1].label, 'Work')
})

runTest('buildImportedContactState does not fabricate a Default option when the row has no plain contact data', () => {
  const result = buildImportedContactState({
    name: 'Customer Two',
    contact_label_1: 'Warehouse',
    contact_name_1: 'Dock',
    contact_phone_1: '023111222',
  })

  assert.strictEqual(result.options.length, 1)
  assert.strictEqual(result.options[0].label, 'Warehouse')
})

// Adapted: legacy called this as serializeContactOptions(options, { mode: 'area' })
// / parseStoredContactOptions(encoded, { mode: 'area' }) -- this port takes the
// mode string directly, see this file's header comment.
runTest('serializeContactOptions keeps delivery area-only contacts compact', () => {
  const encoded = serializeContactOptions([
    { label: 'Zone A', name: 'Driver A', phone: '011', area: 'North' },
  ], 'area')

  const decoded = parseStoredContactOptions(encoded, 'area')
  assert.strictEqual(decoded.length, 1)
  assert.strictEqual(decoded[0].area, 'North')
  assert.strictEqual(decoded[0].email, null)
})

// New (not in the legacy test): the exact "multi-contact customer" shape
// from this backlog item -- one customer with two DIFFERENT addresses/
// phones, each round-tripping through serialize -> parse without merging
// or losing an entry.
runTest('a single contact can carry two distinct address/phone options round-trip', () => {
  const encoded = serializeContactOptions([
    { label: 'Home', name: 'Sok Dara', phone: '012345678', email: null, address: 'House 12, St 240' },
    { label: 'Work', name: 'Sok Dara', phone: '098765432', email: 'dara@example.com', address: 'Office Tower, St 51' },
  ])
  const decoded = parseStoredContactOptions(encoded)
  assert.strictEqual(decoded.length, 2)
  assert.strictEqual(decoded[0].address, 'House 12, St 240')
  assert.strictEqual(decoded[1].address, 'Office Tower, St 51')
  assert.strictEqual(decoded[1].phone, '098765432')
})

if (failed > 0) process.exitCode = 1
