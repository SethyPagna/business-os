'use strict'
// cost-4dp lane: HALF_UP_4DP (src/lib/catalogCostRecompute.ts), the SQL text every catalog-cost trigger, the merge authority, the bulk cost adjust and
// held repair 0313 round with, must equal roundMoney4 (src/lib/moneyPrecision.ts: nearest 4 places, half away from zero, on the decimal the double
// prints as) over the real range of USD and KHR values, in the SQLite engines this machine has. A property test, 0 mismatches required:
//   ties        every 5-place decimal tie (m + 0.5) / 10^4, positive and negative, in windows from 0.00005 up to 99,999,999.99995
//   random      300,000 random decimals with 5 to 9 places, either sign, magnitude 0.001 to 100,000,000 (expected value by exact BigInt arithmetic)
//   doubles     200,000 arbitrary 17-digit doubles against roundMoney4
//   idempotent  every value that already has 4 places stays unchanged, at 0, 1,000, 5,000,000 and 99,999,900
//   symmetry    f(-x) = -f(x); NULL stays NULL; no negative zero
// Positive control: the form that was replaced (CAST(x * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0) is wrong on negatives and on riel-sized ties
// (16,384 and above); the same property run must count mismatches for it, so a green run means something.
// Exact range of the form: ties at every magnitude up to 1e10 (the nudge is 3.6e-16 of the scaled value, which stays under half a unit up to 1.4e11);
// the one disagreement possible is a double within 2 ulps of a decimal tie that is not the double nearest to it (arithmetic noise, 17-digit input).
//
// Run: node scripts/test-half-up-4dp-property-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function compile(file, dependencies = {}) {
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', file + '.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('exports', 'require', 'module', js)(module.exports, (name) => { assert.ok(name in dependencies, `unexpected dependency ${name}`); return dependencies[name] }, module)
  return module.exports
}
const money = compile('moneyPrecision')
const catalog = compile('catalogCostRecompute', { './moneyPrecision': money })
const OLD = (v) => `(CAST(${v} * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0)`

const engines = []
try { const Database = require('better-sqlite3'); const d = new Database(':memory:'); engines.push({ name: 'better-sqlite3', db: d, version: d.prepare('SELECT sqlite_version() v').get().v }) } catch { /* not installed */ }
try { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(':memory:'); engines.push({ name: 'node:sqlite', db: d, version: d.prepare('SELECT sqlite_version() v').get().v }) } catch { /* old node */ }
assert.ok(engines.length > 0, 'no SQLite engine available')

// Exact expected value from decimal text (what roundMoney4 means), by BigInt: nearest 4 places, ties away from zero.
function expandExponent(text) {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text)
  if (!m) return text
  const [, sign, whole, frac = '', exp] = m
  const digits = whole + frac
  const point = whole.length + Number(exp)
  return sign + (point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point))
}
function exact(text) {
  const t0 = expandExponent(text)
  const negative = t0.startsWith('-')
  const [whole, frac = ''] = (negative ? t0.slice(1) : t0).split('.')
  const units = BigInt(whole) * 1000000000n + BigInt((frac + '000000000').slice(0, 9))
  const q = units / 100000n, r = units % 100000n
  return (negative ? -1 : 1) * Number(r * 2n >= 100000n ? q + 1n : q) / 10000
}
let seed = 987654321
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

function run(engine, form) {
  const { db } = engine
  const E = form('x')
  const bad = { ties: 0, tiesNeg: 0, random: 0, doubles: 0, idempotent: 0, symmetry: 0 }
  const examples = []
  // ties: 20,000 ties per window; windows start where the scaled value is 0, 10^3, 10^5, 10^6, 3 x 10^6, 1.6 x 10^7, 1.7 x 10^8, 10^9 ... 10^12
  for (const lo of [0, 1e3, 1e5, 1e6, 3e6, 1.6e7, 1.7e8, 1e9, 1e10, 1e11, 5e11, 1e12 - 2e5]) {
    const r = db.prepare(`WITH RECURSIVE s(m) AS (SELECT ${lo} UNION ALL SELECT m + 1 FROM s WHERE m < ${lo + 19999}), v AS (SELECT m, (m * 10 + 5) / 100000.0 AS x FROM s)
      SELECT COALESCE(SUM((${E}) IS NOT ((m + 1) / 10000.0)), 0) pos, COALESCE(SUM((${form('(-x)')}) IS NOT (-(m + 1) / 10000.0)), 0) neg FROM v`).get()
    bad.ties += Number(r.pos); bad.tiesNeg += Number(r.neg)
  }
  const mags = [0.001, 0.1, 1, 10, 100, 1000, 20000, 50000, 1e6, 1e7, 1e8]
  db.exec('DROP TABLE IF EXISTS t_half; CREATE TABLE t_half(s TEXT, x REAL)')
  const insert = db.prepare('INSERT INTO t_half VALUES (?, ?)')
  db.exec('BEGIN')
  for (let k = 0; k < 300000; k++) {
    const x = (k % 3 === 0 ? -1 : 1) * Number((rand() * mags[k % mags.length]).toFixed(5 + (k % 5)))
    insert.run(String(x), x)
  }
  for (let k = 0; k < 200000; k++) { const x = (rand() < 0.5 ? -1 : 1) * rand() * mags[k % mags.length]; insert.run(`d${k}`, x) }
  db.exec('COMMIT')
  for (const row of db.prepare(`SELECT s, x, ${E} r, ${form('(-x)')} n FROM t_half`).all()) {
    const want = row.s.startsWith('d') ? money.roundMoney4(row.x) : exact(row.s)
    if (row.r !== want) { bad[row.s.startsWith('d') ? 'doubles' : 'random']++; if (examples.length < 3) examples.push([row.x, row.r, want]) }
    if (row.n !== (want === 0 ? 0 : -want) && !(row.n === 0 && want === 0)) bad.symmetry++
  }
  for (const lo of [0, 1e7, 5e10, 9.99999e11]) {
    const r = db.prepare(`WITH RECURSIVE s(k) AS (SELECT ${lo} UNION ALL SELECT k + 1 FROM s WHERE k < ${lo + 99999}), v AS (SELECT k / 10000.0 AS x FROM s) SELECT COALESCE(SUM((${E}) IS NOT x), 0) w FROM v`).get()
    bad.idempotent += Number(r.w)
  }
  return { bad, examples }
}

for (const engine of engines) {
  const { bad, examples } = run(engine, catalog.HALF_UP_4DP)
  assert.deepEqual(bad, { ties: 0, tiesNeg: 0, random: 0, doubles: 0, idempotent: 0, symmetry: 0 }, `HALF_UP_4DP differs from roundMoney4 on ${engine.name} ${engine.version}: ${JSON.stringify(examples)}`)
  const control = run(engine, OLD).bad
  assert.ok(control.ties > 1000 && control.tiesNeg > 200000 && control.random > 1000, `positive control: the replaced form must miss riel-sized ties and every negative tie on ${engine.name}: ${JSON.stringify(control)}`)
  const one = (sql, ...args) => engine.db.prepare(sql).get(...args)
  const f = (x) => one(`SELECT ${catalog.HALF_UP_4DP('x')} r FROM (SELECT ? x)`, x).r
  assert.equal(f(-1.00015), -1.0002, 'a negative tie goes away from zero')
  assert.equal(f(1.00015), 1.0002)
  assert.equal(f(0.00005), 0.0001)
  assert.equal(f(-0.00004), 0)
  assert.ok(!Object.is(f(-0.00004), -0), 'no negative zero')
  assert.equal(f(41000.00005), 41000.0001, 'a riel-sized tie')
  assert.equal(f(99999999.99995), 100000000)
  assert.equal(one(`SELECT ${catalog.HALF_UP_4DP('x')} r FROM (SELECT NULL x)`).r, null, 'NULL stays NULL')
  console.log(`PASS HALF_UP_4DP equals roundMoney4 on ${engine.name} (SQLite ${engine.version}); the replaced form is wrong on ${control.ties} positive and ${control.tiesNeg} negative ties of 240,000`)
}
assert.equal(catalog.HALF_UP_4DP('a + b'), '(CAST(ROUND((a + b) * 10000.0000000000036) AS INTEGER) / 10000.0)', 'the text every migration inlines (an operand is wrapped once)')
console.log('test-half-up-4dp-property-pure: ok')
