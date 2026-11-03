'use strict'
// P1.4 (6.0.1050): the report chain touched the exact-decimal arithmetic the totals are built from (lib/reportMoneyPrecision.ts: a safe-integer
// fast path in decimal() and a zero short-cut in plus()). Neither sits behind a switch, so this proves they cannot move a figure: the module at the
// slice base (cbff55c8e) and the current one are run side by side over a fixed-seed fuzz of every operand shape the readers feed them, and every
// result, rounded text and refusal code must be identical. A mutant of each change must be caught.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const BASE = 'cbff55c8e4a9fffe722f2be30618f7dbe64ee623'
const lf = (text) => text.replace(/\r\n/g, '\n')
const baseSource = lf(execFileSync('git', ['show', `${BASE}:cloudflare/src/lib/reportMoneyPrecision.ts`], { cwd: __dirname, encoding: 'utf8', maxBuffer: 1 << 24, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } }))
const currentSource = lf(fs.readFileSync(path.join(LIB, 'reportMoneyPrecision.ts'), 'utf8'))
const moneySource = lf(fs.readFileSync(path.join(LIB, 'moneyPrecision.ts'), 'utf8'))

function load(source, label) {
  const sibling = {}
  const run = (text, name) => {
    const out = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module_ = { exports: {} }
    new Function('module', 'exports', 'require', out)(module_, module_.exports, (request) => {
      if (request === './moneyPrecision') return sibling.money || (sibling.money = run(moneySource, 'moneyPrecision'))
      throw new Error(`${label}: unexpected require ${request} from ${name}`)
    })
    return module_.exports
  }
  return run(source, label)
}

const seam = (text, before, after) => { assert.equal(text.split(before).length, 2, 'MUTANT_SEAM_MISSING: ' + before); return text.replace(before, () => after) }
const MUTANTS = {
  'integer-path-skips-bound': (text) => seam(text, "if (abs(n) > MAX_ABS) throw new ReportMoneyPrecisionError(canonicalV1 ? refusal : 'aggregate_overflow')\n    return { n, d: 1n }", 'return { n, d: 1n }'),
  'plus-drops-right-sign': (text) => seam(text, 'if (right.n === 0n) return { n: left.n, d: left.d }\n  if (left.n === 0n) return { n: right.n, d: right.d }', 'if (right.n === 0n) return { n: left.n, d: left.d }\n  if (left.n === 0n) return { n: right.n < 0n ? -right.n : right.n, d: right.d }'),
}

// A fixed-seed generator: the same inputs on every run.
let seed = 20261102
const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
const pick = (list) => list[Math.floor(rand() * list.length)]
const digits = (n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('')
function operand() {
  switch (Math.floor(rand() * 14)) {
    case 0: return 0
    case 1: return Math.floor(rand() * 2000) - 1000
    case 2: return Math.trunc((rand() - 0.5) * 2 * Number.MAX_SAFE_INTEGER)
    case 3: return pick([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 1e15, -1e15, 9e12, 4503599627370496])
    case 4: return Math.round(rand() * 1e6) / 100
    case 5: return Math.round((rand() - 0.5) * 1e8) / 1e4
    case 6: return `${pick(['', '-', '+'])}${Math.floor(rand() * 5000)}.${digits(1 + Math.floor(rand() * 4))}`
    case 7: return `${pick(['', '-'])}${Math.floor(rand() * 100)}`
    case 8: return pick(['0', '-0', '0.0000', '00012.3400', ' 12.5 ', '1e3', '1.23456', '.5', '5.', '--1', 'abc', '', ' ', '1,5', '0x10', 'Infinity', 'NaN', '9'.repeat(40), '-' + '9'.repeat(30) + '.9999'])
    case 9: return pick([NaN, Infinity, -Infinity, 1.5e300, 1e21, 2 ** 60, -(2 ** 60), 0.1, 0.2, 0.30000000000000004, 1 / 3, -0])
    case 10: return `${digits(1 + Math.floor(rand() * 18))}.${digits(1 + Math.floor(rand() * 4))}`
    case 11: return null
    case 12: return undefined
    default: return pick([true, {}, [], [1], 'null'])
  }
}

function attempt(fn) {
  try { return { ok: fn() } } catch (error) { return { error: error && error.code ? `${error.name}:${error.code}` : `${error && error.name}:${String(error && error.message).slice(0, 60)}` } }
}
const show = (decimal) => attempt(() => ({ text2: decimal.toText(2), text4: decimal.toText(4), number: decimal.toNumber(2), positive: decimal.isPositive(), negative: decimal.isNegative() }))

function fuzz(api, rounds) {
  seed = 20261102
  const out = []
  const make = (kind, value) => attempt(() => kind === 'recorded' ? api.ReportExactDecimal.recorded(value) : kind === 'money0' ? api.ReportExactDecimal.money(value, 0) : kind === 'money1' ? api.ReportExactDecimal.money(value, 1) : api.ReportExactDecimal.quantity(value))
  for (let round = 0; round < rounds; round += 1) {
    const kind = pick(['recorded', 'money0', 'money1', 'quantity'])
    // every random draw of a round is made before any arithmetic, so a changed result can never shift the stream of later rounds
    const a = operand(), b = operand(), c = operand(), zKind = pick(['recorded', 'money0'])
    const draws = Array.from({ length: 8 }, () => [rand(), rand()])
    const x = make(kind, a), y = make(kind, b), z = make(zKind, c)
    const record = { kind, a: String(a), b: String(b), x: x.error ?? show(x.ok), y: y.error ?? show(y.ok) }
    if (x.ok && y.ok) {
      const zero = api.ReportExactDecimal.zero()
      record.add = attempt(() => show(x.ok.add(y.ok)))
      record.sub = attempt(() => show(x.ok.subtract(y.ok)))
      record.mul = attempt(() => show(x.ok.multiply(y.ok)))
      record.div = attempt(() => show(x.ok.divide(y.ok)))
      record.cmp = x.ok.compare(y.ok)
      record.exact = attempt(() => x.ok.toExactNumber())
      let sum = zero
      const chain = []
      for (let i = 0; i < 8; i += 1) {
        const operandValue = i === 0 ? x.ok : i === 1 ? y.ok : z.ok && draws[i][0] < 0.5 ? z.ok : zero
        sum = draws[i][1] < 0.35 ? sum.subtract(operandValue) : sum.add(operandValue)
        chain.push(show(sum))
      }
      record.chain = chain
    }
    out.push(JSON.stringify(record))
  }
  return out
}

const ROUNDS = 60000
const baseApi = load(baseSource, 'base')
const expected = fuzz(baseApi, ROUNDS)
const informative = expected.filter((line) => line.includes('"ok"') ).length
assert.ok(informative > ROUNDS * 0.3, 'the fuzz must reach real arithmetic, not only refusals: ' + informative)

const currentApi = load(currentSource, 'current')
const actual = fuzz(currentApi, ROUNDS)
let differing = 0, first = null
for (let i = 0; i < ROUNDS; i += 1) if (expected[i] !== actual[i]) { differing += 1; first = first ?? i }
assert.equal(differing, 0, `the current arithmetic differs from the base on ${differing} of ${ROUNDS} inputs, first: ${first === null ? '' : expected[first] + ' != ' + actual[first]}`)
console.log(`PASS base and current exact-decimal arithmetic agree on ${ROUNDS} fixed-seed operand sets (${informative} reach arithmetic; safe integers, decimals, strings, refusals, 8-step accumulations)`)

const killed = {}
for (const [name, edit] of Object.entries(MUTANTS)) {
  const mutantApi = load(edit(currentSource), name)
  const mutated = fuzz(mutantApi, ROUNDS)
  killed[name] = mutated.reduce((n, line, i) => n + (line !== expected[i] ? 1 : 0), 0)
  assert.ok(killed[name] > 0, `MUTANT ${name} survived the fuzz`)
  console.log(`PASS mutant ${name} is caught on ${killed[name]} inputs`)
}
console.log(JSON.stringify({ status: 'PASS', rounds: ROUNDS, mutants: killed, scope: 'Pure arithmetic differential against the slice base; no database.' }))
