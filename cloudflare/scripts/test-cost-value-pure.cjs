const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '../..')
const text = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
const load = (file, requireMap = {}) => {
  const { outputText } = ts.transpileModule(text(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', outputText)((id) => {
    if (!(id in requireMap)) throw new Error(`Unexpected dependency: ${id}`)
    return requireMap[id]
  }, mod, mod.exports)
  return mod.exports
}

const money = load('cloudflare/src/lib/moneyPrecision.ts')
const { knownCost, sumKnown, COST_KNOWN_SUM, COST_UNKNOWN_COUNT } = load('cloudflare/src/lib/costValue.ts', { './moneyPrecision': money })

assert.equal(knownCost(0), 0, 'a recorded zero is a real zero')
assert.ok(Object.is(knownCost(-0), 0), 'negative zero is normalised')
assert.equal(knownCost('0'), 0)
assert.equal(knownCost('12.3456'), 12.3456)
assert.equal(knownCost(' 4 '), 4)
for (const bad of ['', '   ', undefined, null, NaN, Infinity, -1, '-1', 'abc', true, false, {}, [], 1e12]) {
  assert.equal(knownCost(bad), null, `knownCost(${String(bad)}) is unknown`)
}

assert.deepEqual(sumKnown([1, null, 0], (v) => v), { usd: 1, unknown: 1, complete: false })
assert.deepEqual(sumKnown([null, undefined, ''], (v) => v), { usd: 0, unknown: 3, complete: false }, 'all unknown leaves nothing known: the caller sees unknown === rows.length')
assert.deepEqual(sumKnown([0, 0], (v) => v), { usd: 0, unknown: 0, complete: true }, 'recorded zeros are complete')
assert.deepEqual(sumKnown([], (v) => v), { usd: 0, unknown: 0, complete: true })
assert.deepEqual(sumKnown([{ c: 0.1 }, { c: 0.2 }, { c: null }], (r) => r.c), { usd: 0.3, unknown: 1, complete: false }, 'known rows sum without float drift')
assert.deepEqual(sumKnown([{ c: '1.23456' }, { c: 1 }], (r) => r.c), { usd: 2.2346, unknown: 0, complete: true }, 'rounded once to 4 places by moneyPrecision')
assert.equal(sumKnown([{ c: 5 }, { c: 0 }, { c: null }], (r) => r.c).usd, 5, 'an unknown row is not valued at 0 AND not valued at anything else')

assert.equal(COST_KNOWN_SUM('m.cost'), 'SUM(CASE WHEN m.cost IS NOT NULL THEN m.cost END)')
assert.equal(COST_UNKNOWN_COUNT('m.cost'), 'SUM(CASE WHEN m.cost IS NULL THEN 1 ELSE 0 END)')

const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE lots (grp TEXT, cost REAL)')
const insert = db.prepare('INSERT INTO lots VALUES (?, ?)')
for (const [grp, cost] of [['mixed', 2], ['mixed', null], ['mixed', 0], ['zeros', 0], ['zeros', 0], ['none', null], ['none', null], ['none', null]]) insert.run(grp, cost)
const rows = Object.fromEntries(db.prepare(`SELECT grp, ${COST_KNOWN_SUM('cost')} AS known, ${COST_UNKNOWN_COUNT('cost')} AS unknown FROM lots GROUP BY grp`).all().map((r) => [r.grp, { known: r.known, unknown: r.unknown }]))
assert.deepEqual(rows.mixed, { known: 2, unknown: 1 })
assert.deepEqual(rows.zeros, { known: 0, unknown: 0 }, 'recorded zeros total a real 0, not NULL')
assert.deepEqual(rows.none, { known: null, unknown: 3 }, 'all unknown sums to NULL, never 0')
const naive = db.prepare('SELECT SUM(COALESCE(cost, 0)) AS total FROM lots WHERE grp = ?').get('none')
assert.equal(naive.total, 0, 'the COALESCE form this replaces cannot tell none from zeros')
db.close()

console.log('PASS cost value primitives: zero is real, null is unknown, sums skip unknown and say how many')
