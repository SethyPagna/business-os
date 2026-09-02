// Standalone unit tests for src/lib/barcodeAliases.ts's pure helpers
// (normalizeBarcode, isRealBarcode, buildAliasExactClause). DB-backed
// coverage of listAliases/addAliases against the real migrated schema
// (idempotency, ON DELETE CASCADE, the non-unique barcode_normalized
// index) lives in test-barcode-aliases-migration-pure.cjs, once
// migrations/0106_barcode_aliases.sql exists for it to run against.
//
// Same transpile-the-real-source method as the rest of this suite (see
// test-import-engine-pure.cjs's own note) -- no D1/wrangler test harness
// in this project, so the REAL source file is transpiled with the
// `typescript` package already in node_modules and its actual exported
// functions are called, not a re-implementation.
//
// Run: node scripts/test-barcode-aliases-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'barcodeAliases.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'barcodeAliases.ts',
})
const moduleObj = { exports: {} }
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
const { normalizeBarcode, isRealBarcode, buildAliasExactClause, MIN_REAL_BARCODE_LENGTH } = moduleObj.exports

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

check('MIN_REAL_BARCODE_LENGTH matches productIdentity.ts:173 (the value this whole contract is pinned to)', () => {
  assert.strictEqual(MIN_REAL_BARCODE_LENGTH, 4)
  const identitySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'productIdentity.ts'), 'utf8')
  const match = /const MIN_REAL_BARCODE_LENGTH = (\d+)/.exec(identitySource)
  assert.ok(match, 'productIdentity.ts must still define MIN_REAL_BARCODE_LENGTH as a literal number -- if this fails, the two files have drifted and barcodeAliases.ts needs updating to match')
  assert.strictEqual(Number(match[1]), MIN_REAL_BARCODE_LENGTH, 'barcodeAliases.ts and productIdentity.ts must agree on the placeholder-length threshold')
})

check('normalizeBarcode trims and lower-cases, does not strip leading zeros or digits', () => {
  assert.strictEqual(normalizeBarcode('  6923644012345  '), '6923644012345')
  assert.strictEqual(normalizeBarcode('08011003845132'), '08011003845132')
  assert.strictEqual(normalizeBarcode('ABC123'), 'abc123')
  assert.strictEqual(normalizeBarcode(null), '')
  assert.strictEqual(normalizeBarcode(undefined), '')
})

check('normalizeBarcode preserves the leading-zero distinction (the real recurring bug this contract guards)', () => {
  // product_mapping.csv row 1: old_barcode=8011003845132 vs
  // template_barcode=08011003845132 -- same physical code, old system
  // dropped the leading zero. Normalization must NOT collapse these --
  // that would silently treat two different alias values as one.
  assert.notStrictEqual(normalizeBarcode('8011003845132'), normalizeBarcode('08011003845132'))
})

check('isRealBarcode: "0" and anything under MIN_REAL_BARCODE_LENGTH is a placeholder, not real', () => {
  assert.strictEqual(isRealBarcode('0'), false)
  assert.strictEqual(isRealBarcode(''), false)
  assert.strictEqual(isRealBarcode(null), false)
  assert.strictEqual(isRealBarcode(undefined), false)
  assert.strictEqual(isRealBarcode('12'), false)
  assert.strictEqual(isRealBarcode('123'), false)
})

check('isRealBarcode: 4+ characters is real', () => {
  assert.strictEqual(isRealBarcode('1234'), true)
  assert.strictEqual(isRealBarcode('6923644012345'), true)
  assert.strictEqual(isRealBarcode('  1234  '), true) // trimmed before length check
})

check('buildAliasExactClause: real alias returns an EXISTS clause and binds a normalized param', () => {
  const bindings = {}
  const clause = buildAliasExactClause('6923644012345', bindings)
  assert.match(clause, /EXISTS \(SELECT 1 FROM barcode_aliases ba WHERE ba\.product_id = products\.id AND ba\.barcode_normalized = @barcode_alias_0\)/)
  assert.strictEqual(bindings.barcode_alias_0, '6923644012345')
})

check('buildAliasExactClause: a placeholder/blank alias returns empty SQL and touches no binding', () => {
  const bindings = { existing: 'kept' }
  assert.strictEqual(buildAliasExactClause('0', bindings), '')
  assert.strictEqual(buildAliasExactClause('', bindings), '')
  assert.strictEqual(buildAliasExactClause('12', bindings), '')
  assert.deepStrictEqual(bindings, { existing: 'kept' }, 'a rejected alias must not mutate the caller\'s bindings object')
})

check('buildAliasExactClause: successive calls against the same bindings object get distinct param names', () => {
  const bindings = {}
  const first = buildAliasExactClause('1111111111111', bindings)
  const second = buildAliasExactClause('2222222222222', bindings)
  assert.notStrictEqual(first, second)
  assert.strictEqual(Object.keys(bindings).length, 2)
})

console.log(`\n${passed} passed`)

check('buildAliasExactClause: productAlias/paramKey opts target the routes `p` alias and a caller-chosen key', () => {
  const bindings = { keep: 1 }
  const clause = buildAliasExactClause('6923644012345', bindings, { productAlias: 'p', paramKey: 'portalAliasExact' })
  assert.ok(clause.includes('ba.product_id = p.id AND ba.barcode_normalized = @portalAliasExact)'), clause)
  assert.strictEqual(bindings.portalAliasExact, '6923644012345')
})
