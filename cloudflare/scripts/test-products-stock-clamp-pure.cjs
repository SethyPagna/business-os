// Unit tests for the negative-stock-quantity clamp in routes/products.ts:
//   - clampNegativeStockQuantity (generic create/update payload guard)
//   - cleanPayload (confirms the clamp is actually wired into the
//     create/update write path, not just defined and unused)
//
// Extracted via regex (not a full transpile+require) since both functions'
// home file historically had heavy module-load-time side effects -- same
// "lift the pure function verbatim, don't drag in the whole module's side
// effects" approach convert_xlsx.cjs already uses for csv.ts's
// escapeCsvValue. Kept byte-for-byte identical to the real functions by
// re-reading the source directly, not re-implementing them.
//
// Part 152: both functions moved from routes/products.ts to
// lib/productWrites.ts (so lib/reviewApply.ts's Products appliers can
// reuse them without lib/ importing from routes/) -- this test's source
// path moved with them. products.ts itself now just re-exports.
//
// Run: node scripts/test-products-stock-clamp-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'productWrites.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

function extractFunction(name) {
  // Matches "export function <name>(...) {" through its matching closing
  // brace at column 0 (both target functions are top-level, single-level
  // bodies with no nested top-level-indented braces).
  const re = new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`)
  const match = source.match(re)
  if (!match) throw new Error(`${name} not found in products.ts -- source may have changed`)
  return match[0]
}

function extractConst(name) {
  const re = new RegExp(`const ${name} = [\\s\\S]*?\\n\\]\\)`)
  const match = source.match(re)
  if (!match) throw new Error(`${name} not found in products.ts -- source may have changed`)
  return match[0]
}

const combinedSource = extractConst('PRODUCT_SKIP_KEYS') + '\n'
  + extractFunction('clampNegativeStockQuantity') + '\n' + extractFunction('cleanPayload')
const { outputText } = ts.transpileModule(combinedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'products-pure.ts',
})
const moduleObj = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { clampNegativeStockQuantity, cleanPayload } = moduleObj.exports

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

check('clampNegativeStockQuantity leaves non-stock_quantity keys untouched', () => {
  assert.strictEqual(clampNegativeStockQuantity('low_stock_threshold', -5), -5)
  assert.strictEqual(clampNegativeStockQuantity('name', 'Widget'), 'Widget')
})

check('clampNegativeStockQuantity clamps a negative stock_quantity to 0', () => {
  assert.strictEqual(clampNegativeStockQuantity('stock_quantity', -5), 0)
  assert.strictEqual(clampNegativeStockQuantity('stock_quantity', -0.5), 0)
})

check('clampNegativeStockQuantity leaves non-negative stock_quantity untouched', () => {
  assert.strictEqual(clampNegativeStockQuantity('stock_quantity', 0), 0)
  assert.strictEqual(clampNegativeStockQuantity('stock_quantity', 42), 42)
})

check('clampNegativeStockQuantity passes through non-numeric stock_quantity unchanged (columns are still validated elsewhere)', () => {
  assert.strictEqual(clampNegativeStockQuantity('stock_quantity', null), null)
  assert.strictEqual(clampNegativeStockQuantity('stock_quantity', undefined), undefined)
})

const columns = new Set(['id', 'name', 'stock_quantity', 'low_stock_threshold', 'is_active'])

check('cleanPayload clamps a negative stock_quantity in a real create/update body', () => {
  const out = cleanPayload({ name: 'Widget', stock_quantity: -12 }, columns)
  assert.strictEqual(out.stock_quantity, 0)
  assert.strictEqual(out.name, 'Widget')
})

check('cleanPayload leaves a non-negative stock_quantity in a real body untouched', () => {
  const out = cleanPayload({ name: 'Widget', stock_quantity: 7 }, columns)
  assert.strictEqual(out.stock_quantity, 7)
})

check('cleanPayload still drops non-column keys and normalizes booleans as before (regression check on the surrounding logic, not just the new clamp)', () => {
  const out = cleanPayload({ name: 'Widget', is_active: true, not_a_column: 'x', id: 999 }, columns)
  assert.strictEqual(out.is_active, 1)
  assert.strictEqual('not_a_column' in out, false)
  assert.strictEqual('id' in out, false) // PRODUCT_SKIP_KEYS-equivalent isn't part of this extract, but 'id' isn't in columns either way here
})

console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) {
  console.error('SOME CHECKS FAILED')
  process.exit(1)
}
