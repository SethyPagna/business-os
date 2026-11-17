'use strict'
// cost-4dp r7: halfUp4dpJs (src/lib/catalogCostRecompute.ts) is the exact JS twin of the SQL text HALF_UP_4DP that migration 0313 rounds with. A guard
// that asks "is the live cost the saved cost rounded?" accepts roundStoredCost's form OR this one, so the twin must equal SQLite's own evaluation of the
// real HALF_UP_4DP text with 0 differences. Property over 100,000+ values: near-ties (ULPs either side of every tie), k/n divisions, weighted means,
// riel-sized values, negatives, 4-place values, shortest-repr 5-6 place literals. Positive control: the twin with the 3.6e-16 nudge removed must differ.
//
// Run: node scripts/test-half-up-4dp-js-twin-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

function compile(file, dependencies = {}) {
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', file + '.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('exports', 'require', 'module', js)(module.exports, (name) => { assert.ok(name in dependencies, `unexpected dependency ${name}`); return dependencies[name] }, module)
  return module.exports
}
const money = compile('moneyPrecision')
const catalog = compile('catalogCostRecompute', { './moneyPrecision': money })
const db = new DatabaseSync(':memory:')
const statement = db.prepare(`SELECT ${catalog.HALF_UP_4DP('?')} AS r`)
const sql = (value) => statement.get(value).r

let seed = 20261117
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const ulp = (x, n) => { const b = new Float64Array([x]); const u = new BigInt64Array(b.buffer); u[0] += BigInt(n) * (x < 0 ? -1n : 1n); return b[0] }
const values = []
// near-ties: every tie (k + 0.5) / 1e4 nudged by up to 40 ULPs each way, at nine magnitudes
for (const magnitude of [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8]) {
  for (let i = 0; i < 4000; i += 1) {
    const tie = (Math.floor(random() * magnitude * 1e4) + 0.5) / 1e4
    const n = Math.floor(random() * 81) - 40
    values.push(ulp(tie, n), -ulp(tie, n))
  }
}
// divisions and weighted means: received cost / quantity, two-lot means
for (let i = 0; i < 40000; i += 1) {
  const a = Math.round(random() * 500000) / 1e4, q = 1 + Math.floor(random() * 60), b = Math.round(random() * 500000) / 1e4, q2 = 1 + Math.floor(random() * 60)
  values.push(a / q, (a * q + b * q2) / (q + q2), -(a / q))
}
// riel-sized and USD x rate
for (let i = 0; i < 20000; i += 1) values.push((Math.round(random() * 1e8) / 100) * 1.0, Math.round(random() * 4e8) / 1e4 * 4100, random() * 5e6)
// 4-place values and shortest-repr 5-6 place literals
for (let i = 0; i < 15000; i += 1) { const k = Math.floor(random() * 1e9); values.push(k / 1e4, -k / 1e4, Number((k / 1e5).toFixed(5)), Number((k / 1e6).toFixed(6))) }
values.push(0, -0, 1e-9, -1e-9, 0.00005, -0.00005, 21.398249999999997, 0.6551499999999999, 4.343249999999999, 57310.638249999996, 1e11, -1e11, 0.49999999999999994)
assert.ok(values.length >= 100000, `${values.length} values`)

const differences = []
for (const value of values) {
  const expected = sql(value)
  const actual = catalog.halfUp4dpJs(value)
  if (!Object.is(expected, actual) && !(expected === actual)) differences.push([value, expected, actual])
}
assert.equal(differences.length, 0, `Hjs differs from SQLite on ${differences.length} of ${values.length}: ${JSON.stringify(differences.slice(0, 5))}`)

// the near-tie example the review found: the two rules disagree, so a guard must accept both
assert.equal(catalog.roundStoredCost(21.398249999999997), 21.3982)
assert.equal(catalog.halfUp4dpJs(21.398249999999997), 21.3983)
assert.deepEqual(catalog.costRoundingForms(21.398249999999997).sort(), [21.3982, 21.3983])
assert.equal(catalog.isCostRoundingOf(21.398249999999997, 21.3982), true)
assert.equal(catalog.isCostRoundingOf(21.398249999999997, 21.3983), true)
assert.equal(catalog.isCostRoundingOf(21.398249999999997, 21.3984), false)
assert.equal(catalog.isCostRoundingOf(21.398249999999997, 21.398249999999997), false, 'the saved figure itself is not rounding')
assert.equal(catalog.isCostRoundingOf(null, 1), false)
assert.equal(catalog.isCostRoundingOf(1.23456, null), false)
assert.equal(catalog.isCostRoundingOf(1.23456, '1.2346'), false, 'a text live value is not a number')
assert.equal(catalog.isCostRoundingOf(NaN, 1), false)
assert.equal(catalog.halfUp4dpJs(null), null)
assert.equal(catalog.halfUp4dpJs(Infinity), null)
assert.equal(Object.is(catalog.halfUp4dpJs(-0.00001), 0), true, 'no negative zero')

// positive control: without the 3.6e-16 nudge the twin is wrong somewhere, so the property above separates the right twin from a near one
const noNudge = (value) => { const scaled = value * 10000; const units = scaled < 0 ? -Math.trunc(-scaled + 0.5) : Math.trunc(scaled + 0.5); return units / 10000 + 0 }
let controlDifferences = 0
for (const value of values) if (noNudge(value) !== sql(value)) controlDifferences += 1
assert.ok(controlDifferences > 0, 'the property must tell the nudge-free twin apart')
console.log(`PASS Hjs equals SQLite HALF_UP_4DP on ${values.length} values (0 differences); nudge-free control differs on ${controlDifferences}`)

// source equality: lib/catalogCostRecompute.ts holds the one exported twin; productDelete.ts, stockInLineEdit.ts and stockSession.ts carry a local copy (they
// are loaded by many harnesses with a fixed import map, so they cannot take a new import). The four texts must be identical, byte for byte.
const twinText = (file) => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', file), 'utf8').split('\r\n').join('\n')
  const start = source.indexOf('function halfUp4dpJs(')
  assert.ok(start >= 0, file + ' holds halfUp4dpJs')
  const end = source.indexOf('\n}\n', start)
  return source.slice(start, end + 3)
}
const canonical = twinText('catalogCostRecompute.ts')
for (const file of ['productDelete.ts', 'stockInLineEdit.ts', 'stockSession.ts']) assert.equal(twinText(file), canonical, file + ': its copy of halfUp4dpJs is identical to the exported one')
console.log('PASS halfUp4dpJs copies in productDelete.ts, stockInLineEdit.ts and stockSession.ts are identical to catalogCostRecompute.ts')
