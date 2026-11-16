'use strict'
// Round 6, item 8: proof-twin-order-only.cjs compared the lane's D1 statements with the base-order world's BY INDEX, but harness/read-cost-world.cjs logs each statement when it
// completes, and a Promise.all in a route (bootstrap_pos runs products, filters and branches together) lets the same statements complete in a different order in two worlds:
// "bootstrap_pos: statement 10 differs outside an ORDER BY statement" for statements that were the same set. The proof now matches them as a multiset
// (harness/statement-multiset.cjs). This is the shuffled-order control: the old index comparison fails on a reordering of equal statements, the multiset match passes it, and the
// match still refuses what the proof exists to refuse (a missing, an extra or a changed statement, outside an ORDER BY clause).
//
// Run (from cloudflare/scripts): node test-statement-multiset-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { matchStatements } = require('./harness/statement-multiset.cjs')

const STATEMENTS = [
  'SELECT value FROM settings WHERE key = ?',
  'SELECT id, name FROM products WHERE is_active = 1 ORDER BY lower(name) ASC, id ASC LIMIT 50',
  'SELECT DISTINCT category FROM products WHERE is_active = 1',
  'SELECT id, name FROM branches ORDER BY id',
  'SELECT COUNT(*) AS n FROM products WHERE is_active = 1',
  'SELECT product_id, SUM(quantity) FROM branch_stock GROUP BY product_id',
  'SELECT brand FROM products WHERE is_active = 1 GROUP BY brand',
  'SELECT value FROM settings WHERE key = ?', // a repeated statement: a multiset keeps both
  'SELECT id FROM products WHERE barcode = ?',
  'SELECT id, name FROM products WHERE family_root_id IN (1,2,3) ORDER BY family_root_id, lower(name) ASC, id ASC',
  'SELECT unit FROM products GROUP BY unit',
  'SELECT id FROM categories',
]
// The base-order world's text of the two ORDER BY statements (the patches replace exactly those clauses).
const BASE = STATEMENTS.map((sql) => sql.replace('ORDER BY family_root_id, lower(name) ASC, id ASC', 'ORDER BY family_root_id, lower(name) ASC'))

// The old comparison, kept as the control: by position.
function byIndex(lane, base) {
  lane.forEach((sql, i) => { if (sql !== base[i]) assert.ok(/ORDER BY/.test(sql) && /ORDER BY/.test(base[i]) && sql.replace(/\s+/g, ' ').slice(0, 60) === base[i].replace(/\s+/g, ' ').slice(0, 60), `statement ${i} differs outside an ORDER BY statement`) })
}

let seed = 16112026
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const shuffled = (list) => { const out = [...list]; for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] } return out }
const refuses = (fn, pattern) => assert.throws(fn, pattern)

assert.deepEqual(matchStatements(STATEMENTS, STATEMENTS), { differing: 0 }, 'identical lists')
assert.deepEqual(matchStatements(STATEMENTS, BASE), { differing: 1 }, 'ORDER BY text that differs is counted, once')

// The control: reorder equal statements the way a Promise.all can complete them.
let oldFailed = 0
for (let n = 0; n < 200; n += 1) {
  const lane = shuffled(STATEMENTS)
  const base = shuffled(BASE)
  assert.ok(matchStatements(lane, base).differing >= 0, 'the multiset match passes every reordering of the same statements')
  assert.equal(matchStatements(lane, base).differing, 1, 'and still counts the one ORDER BY difference')
  try { byIndex(lane, base) } catch { oldFailed += 1 }
}
assert.ok(oldFailed > 150, `the old index comparison must fail on most reorderings (it failed ${oldFailed} of 200); if it did not, this control cannot show the flake`)
assert.doesNotThrow(() => byIndex(STATEMENTS, BASE), 'and the old comparison does pass when the order happens to agree (the flake only shows on a reordering)')

// What the proof exists to refuse is still refused, in any order.
for (let n = 0; n < 20; n += 1) {
  const lane = shuffled(STATEMENTS)
  refuses(() => matchStatements(lane.slice(1), shuffled(BASE)), /statements in the lane/, 'a statement missing')
  refuses(() => matchStatements([...lane, 'SELECT 1'], shuffled(BASE)), /statements in the lane/, 'a statement added')
  refuses(() => matchStatements(lane.map((sql) => sql.replace('FROM categories', 'FROM categories WHERE 1')), shuffled(BASE)), /no counterpart outside an ORDER BY/, 'a changed statement without an ORDER BY clause')
  refuses(() => matchStatements(lane.map((sql) => sql.replace('FROM branches ORDER BY id', 'FROM branches ORDER BY name')), shuffled(BASE)), /no counterpart outside an ORDER BY/, 'a changed ORDER BY statement whose head differs is not accepted: the base has none at that head')
  refuses(() => matchStatements(lane.map((sql, i, all) => (i === all.indexOf('SELECT id FROM categories') ? 'SELECT id FROM categories2' : sql)), shuffled(BASE)), /no counterpart/, 'a renamed statement')
  // A statement present twice in the lane and once in the base (with another in its place) is a real difference, not a reordering.
  refuses(() => matchStatements(lane.map((sql) => (sql === 'SELECT id FROM categories' ? 'SELECT value FROM settings WHERE key = ?' : sql)), shuffled(BASE)), /no counterpart/, 'a statement duplicated instead of another')
}

// Wiring: the proof matches by text, and the index comparison is gone.
const proof = fs.readFileSync(path.join(__dirname, 'proof-twin-order-only.cjs'), 'utf8').replace(/\r\n/g, '\n')
assert.match(proof, /require\('\.\/harness\/statement-multiset\.cjs'\)/, 'the proof uses the multiset match')
assert.match(proof, /matchStatements\(own\(lane\[label\]\)\.map\(\(e\) => e\.sql\), own\(base\[label\]\)\.map\(\(e\) => e\.sql\), label\)/, 'on each shape')
assert.ok(!/own\(base\[label\]\)\[i\]\.sql/.test(proof), 'and no statement is looked up by its index in the other world')

console.log(`PASS statement multiset: ${STATEMENTS.length} statements match in any order (200 shuffles; the old index comparison failed ${oldFailed} of them), an ORDER BY-only change is counted, a missing, extra, renamed or duplicated statement is refused`)
