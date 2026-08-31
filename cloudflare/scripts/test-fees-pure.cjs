// Unit tests for routes/fees.ts's pure normalization helpers:
//   - round2, toNumber, normalizeFeeType, normalizeText, normalizeDate
//
// Extracted via regex (not a full transpile+require of fees.ts) since that
// file constructs a real Hono app + imports getDb/auth/permissions at
// module load time -- same approach test-products-stock-clamp-pure.cjs
// already uses for products.ts. Kept byte-for-byte identical to the real
// functions by re-reading the source directly, not re-implementing them.
//
// Run: node scripts/test-fees-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'routes', 'fees.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

function extractFunction(name) {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\n`)
  const match = source.match(re)
  if (!match) throw new Error(`${name} not found in fees.ts -- source may have changed`)
  return match[0]
}

function extractConst(name) {
  const re = new RegExp(`const ${name} = [\\s\\S]*?\\)`)
  const match = source.match(re)
  if (!match) throw new Error(`${name} not found in fees.ts -- source may have changed`)
  return match[0]
}

// The label caps are plain numeric consts (no closing paren), so
// extractConst's `[\s\S]*?\)` pattern would overrun -- pull them by line.
function extractNumericConst(name) {
  const re = new RegExp(`const ${name} = \\d+`)
  const match = source.match(re)
  if (!match) throw new Error(`${name} not found in fees.ts -- source may have changed`)
  return match[0]
}

const combinedSource = extractConst('FEE_TYPES') + '\n'
  + extractNumericConst('FEE_LABEL_MAX_WORDS') + '\n'
  + extractNumericConst('FEE_LABEL_MAX_CHARS') + '\n'
  + extractFunction('round2') + '\n'
  + extractFunction('toNumber') + '\n'
  + extractFunction('normalizeFeeType') + '\n'
  + extractFunction('normalizeText') + '\n'
  + extractFunction('normalizeFeeLabel') + '\n'
  + extractFunction('normalizeDate') + '\n'
  + 'export { round2, toNumber, normalizeFeeType, normalizeText, normalizeFeeLabel, normalizeDate }\n'

const { outputText } = ts.transpileModule(combinedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'fees-pure.ts',
})
const moduleObj = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { round2, toNumber, normalizeFeeType, normalizeText, normalizeFeeLabel, normalizeDate } = moduleObj.exports

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('round2 rounds to cents, avoiding float drift', () => {
  assert.strictEqual(round2(1.005), 1.01)
  assert.strictEqual(round2(2.145), 2.15)
  assert.strictEqual(round2(0), 0)
})

check('toNumber falls back on non-numeric input', () => {
  assert.strictEqual(toNumber('12.5'), 12.5)
  assert.strictEqual(toNumber('abc', 7), 7)
  assert.strictEqual(toNumber(undefined, 0), 0)
  // Number(null) === 0, which is finite -- so toNumber(null, ...) returns 0,
  // not the fallback. Only non-numeric/non-coercible input (undefined, 'abc')
  // hits the fallback branch; null coerces cleanly to 0 like an empty amount.
  assert.strictEqual(toNumber(null, 3), 0)
})

check('normalizeFeeType only accepts the known set, else "other"', () => {
  assert.strictEqual(normalizeFeeType('tax'), 'tax')
  assert.strictEqual(normalizeFeeType('DELIVERY'), 'delivery')
  assert.strictEqual(normalizeFeeType('change'), 'change')
  assert.strictEqual(normalizeFeeType('bogus'), 'other')
  assert.strictEqual(normalizeFeeType(undefined), 'other')
})

check('normalizeText trims, empties to null, and caps length', () => {
  assert.strictEqual(normalizeText('  hello  '), 'hello')
  assert.strictEqual(normalizeText('   '), null)
  assert.strictEqual(normalizeText(undefined), null)
  assert.strictEqual(normalizeText('abcdef', 3), 'abc')
})

check('normalizeDate accepts valid dates, falls back to now on garbage', () => {
  assert.strictEqual(normalizeDate('2026-01-15'), '2026-01-15')
  const fallback = normalizeDate('not-a-date')
  assert.ok(!Number.isNaN(Date.parse(fallback)), 'fallback should be a valid ISO date')
  const fallbackEmpty = normalizeDate('')
  assert.ok(!Number.isNaN(Date.parse(fallbackEmpty)), 'empty input should fall back to a valid date')
})

check('normalizeFeeLabel trims, collapses whitespace, empties to null', () => {
  assert.strictEqual(normalizeFeeLabel('  Grab  '), 'Grab')
  assert.strictEqual(normalizeFeeLabel('Capital   Express'), 'Capital Express')
  assert.strictEqual(normalizeFeeLabel('   '), null)
  assert.strictEqual(normalizeFeeLabel(undefined), null)
  assert.strictEqual(normalizeFeeLabel(42), null)
})

check('normalizeFeeLabel caps at 6 words / 60 chars (sentences cannot be saved)', () => {
  assert.strictEqual(
    normalizeFeeLabel('one two three four five six seven eight'),
    'one two three four five six',
  )
  assert.strictEqual(normalizeFeeLabel('a'.repeat(200)), 'a'.repeat(60))
  // Khmer has no spaces, so only the char cap bounds it -- and short Khmer
  // labels round-trip untouched.
  assert.strictEqual(normalizeFeeLabel('ទឹកភ្លើង'), 'ទឹកភ្លើង')
})

console.log(`\n${passed} check(s) passed.`)
