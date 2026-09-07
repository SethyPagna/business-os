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
// Normalize checkout line endings before the source-shape regexes below.
// Fresh Windows worktrees are CRLF; the production TypeScript is identical.
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n')
const businessDateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8').replace(/\r\n/g, '\n')
// fee_date is a TYPED date, so normalizeDate delegates to the shared
// day-first kernel in lib/batchCode.ts. Pulled in the same regex-extraction
// way, so what runs below is the real kernel and not a copy of it.
const batchCodeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'batchCode.ts'), 'utf8').replace(/\r\n/g, '\n')

function extractFunction(name) {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\n`)
  const match = source.match(re)
  if (!match) throw new Error(`${name} not found in fees.ts -- source may have changed`)
  return match[0]
}


function extractBusinessDateSupport() {
  const offsetMatch = businessDateSource.match(/export const BUSINESS_UTC_OFFSET_MINUTES = \d+/)
  const functionMatch = businessDateSource.match(/export function businessToday\([\s\S]*?\n\}/)
  if (!offsetMatch || !functionMatch) throw new Error('businessToday support not found in businessDateWindow.ts')
  return `${offsetMatch[0].replace('export ', '')}\n${functionMatch[0].replace('export ', '')}`
}

function extractFromBatchCode(name) {
  const re = new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`)
  const match = batchCodeSource.match(re)
  if (!match) throw new Error(`${name} not found in batchCode.ts -- source may have changed`)
  return match[0].replace('export ', '')
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

const combinedSource = extractBusinessDateSupport() + '\n'
  + extractFromBatchCode('isValidCalendarDate') + '\n'
  + extractFromBatchCode('normalizeToIsoDate') + '\n'
  + extractFromBatchCode('normalizeTypedDate') + '\n'
  + extractConst('FEE_TYPES') + '\n'
  + extractNumericConst('FEE_LABEL_MAX_WORDS') + '\n'
  + extractNumericConst('FEE_LABEL_MAX_CHARS') + '\n'
  + extractFunction('round2') + '\n'
  + extractFunction('toNumber') + '\n'
  + extractFunction('normalizeFeeType') + '\n'
  + extractFunction('normalizeText') + '\n'
  + extractFunction('normalizeFeeLabel') + '\n'
  + extractFunction('normalizeDate') + '\n'
  + 'export { round2, toNumber, normalizeFeeType, normalizeText, normalizeFeeLabel, normalizeDate, businessToday }\n'

const { outputText } = ts.transpileModule(combinedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'fees-pure.ts',
})
const moduleObj = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { round2, toNumber, normalizeFeeType, normalizeText, normalizeFeeLabel, normalizeDate, businessToday } = moduleObj.exports

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

check('normalizeDate reads a typed expense date DAY-FIRST, and refuses instead of filing it on today', () => {
  // The Expenses date is typed into a day-first DateEntryInput
  // (frontend/src/components/fees/FeeForm.tsx). 03/09/2026 is the
  // discriminating input: both fields are <= 12, so BOTH orders name a real
  // date and only the answer separates them. What this function used to
  // call -- new Date('03/09/2026') -- reads it MONTH-first, filing a
  // 3 September expense on 9 March with nothing on screen to show it.
  assert.strictEqual(normalizeDate('03/09/2026'), '2026-09-03')
  // Past the 12th the old reading was not merely wrong, it was SILENT:
  // new Date('25/12/2026') is Invalid Date, so control fell through to
  // `return businessToday()` and the expense was filed on today instead.
  assert.strictEqual(normalizeDate('25/12/2026'), '2026-12-25')
  assert.notStrictEqual(
    normalizeDate('25/12/2026'), businessToday(),
    'a readable day-first date must never be swallowed by the today default',
  )
  // Exactly one order is accepted -- the other fails loudly rather than
  // being guessed -- and an unreadable value is REFUSED (null -> 400).
  assert.strictEqual(normalizeDate('12/25/2026'), null)
  assert.strictEqual(normalizeDate('not-a-date'), null)
  assert.strictEqual(normalizeDate(42), businessToday(), 'a non-string is treated as omitted, not as an unreadable date')
  // Kept, unchanged: an ISO calendar date is preserved literally, an
  // INSTANT still maps to the Cambodia business day it fell in, and an
  // omitted date still means today's business day.
  assert.strictEqual(normalizeDate('2026-01-15'), '2026-01-15')
  assert.strictEqual(normalizeDate('2026-08-31T17:30:00Z'), '2026-09-01', 'UTC evening maps to the next Cambodia calendar day')
  assert.strictEqual(normalizeDate(''), businessToday(), 'an omitted date still means today')
  assert.strictEqual(normalizeDate(undefined), businessToday())
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
