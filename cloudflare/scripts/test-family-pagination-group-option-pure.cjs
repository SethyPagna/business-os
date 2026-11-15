'use strict'
// familyGroupSql (lib/familyPagination.ts): the grouped ranking statement.
//   G7: with the option omitted every statement is the text it always was (sha256 recorded before the option existed).
//   G2/G3: the group totals come from windows over every family, so they do not depend on page or pageSize, and a group that spans pages reports the same totals on each.
// Runs the real helper on node:sqlite over a small products table. Fixtures are synthetic.
//
// Run: node scripts/test-family-pagination-group-option-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')

const bundle = file => {
  const code = buildSync({ entryPoints: [path.join(__dirname, '../src/lib', file)], bundle: true, platform: 'node', format: 'cjs', write: false, target: 'es2022', external: ['cloudflare:*'] }).outputFiles[0].text
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports)
  return loaded.exports
}
const fp = bundle('familyPagination.ts')
let passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }

const base = { selectColumns: 'p.id, p.name', joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, page: 2, pageSize: 20, familyOrderSql: 'family_name ASC', intraFamilyOrderSql: 'id ASC' }
const SETS = {
  default: { ...base },
  numeric: { ...base, familyNumericSortSql: 'p.x', familyOrderSql: '(family_num_sort IS NULL) ASC, family_num_sort DESC, family_name ASC' },
  members: { ...base, familyMemberBaseWhereSql: 'p.is_active = 1', familySortValueSql: 'p.category', promotedRankSql: 'p.pr' },
  seek: { ...base, seekPage: true, familyMemberBaseWhereSql: 'p.is_active = 1', parentSeek: true },
  seekNumeric: { ...base, seekPage: true, familyNumericSortSql: 'p.x', matchRankSql: 'p.r' },
}
// Hashes of the statements these option sets produced BEFORE familyGroupSql existed (default path, count, ranked scope, page by keys).
const GOLDEN = { default: '8d5aa63319c343cd', numeric: 'e5eb82c65dee90b2', members: '3b690d9388ede4fe', seek: '3163b70264bb001b', seekNumeric: '2b198a7f947d3a1c' }

async function capture(options) {
  const seen = []
  const db = { prepare: sql => ({ all: async () => { seen.push(sql); return [] }, get: async () => { seen.push(sql); return { count: 0 } } }),
    batch: async statements => { statements.forEach(statement => seen.push(statement.sql)); return [{ results: [{ count: 0 }] }, { results: [] }] } }
  await fp.paginateProductFamilies({ ...options, db })
  await fp.rankProductFamilies({ ...options, db, seekPage: undefined, candidateSql: undefined })
  await fp.pageFamiliesByKeys({ ...options, db }, ['a'])
  return seen
}

function world() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, name_key TEXT, parent_id INTEGER, created_at TEXT, is_active INTEGER DEFAULT 1, is_group INTEGER DEFAULT 0, category TEXT, x TEXT)`)
  const add = db.prepare('INSERT INTO products(id,name,name_key,parent_id,created_at,category,x) VALUES(?,?,?,?,?,?,?)')
  let seed = 7
  const rand = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  const days = ['2026-11-01T01:00:00.000Z', '2026-11-02T20:00:00.000Z', '2026-11-03T03:00:00.000Z', null, null]
  // 47 families of one to four rows (same name_key), one parent family; the date and category repeat so groups hold many families.
  let id = 1
  for (let f = 0; f < 47; f++) {
    const name = `Family ${String(f).padStart(2, '0')}`
    const rows = 1 + rand(4)
    for (let r = 0; r < rows; r++) add.run(id++, name, name.toLowerCase(), null, '2026-01-01', ['Skin', 'Hair', null][rand(3)], days[rand(days.length)])
  }
  add.run(id, 'Header', 'header', null, '2026-01-01', null, null); const header = id++
  for (let r = 0; r < 3; r++) add.run(id++, `Shade ${r}`, `shade ${r}`, header, '2026-01-01', 'Skin', days[rand(days.length)])
  return db
}
const adapter = db => ({
  prepare: sql => ({ all: async params => { const p = db.prepare(sql); p.setAllowUnknownNamedParameters(true); return p.all(params || {}) },
    get: async params => { const p = db.prepare(sql); p.setAllowUnknownNamedParameters(true); return p.get(params || {}) } }),
  batch: async statements => statements.map(({ sql, params }) => { const p = db.prepare(sql); p.setAllowUnknownNamedParameters(true); return { success: true, results: p.all(params || {}) } }),
})
const KEY = "CASE WHEN family_num_sort IS NULL THEN 'never' ELSE 'd:'||date(family_num_sort,'+7 hours') END"
const ORDER = '(family_num_sort IS NULL) ASC, family_num_sort DESC, family_name ASC'

async function main() {
  await check('G7: with familyGroupSql omitted every statement is the text it always was', async () => {
    for (const [name, options] of Object.entries(SETS)) {
      const seen = await capture(options)
      assert.equal(createHash('sha256').update(seen.join('\n--\n')).digest('hex').slice(0, 16), GOLDEN[name], `${name} statements changed`)
      assert.ok(!seen.some(sql => sql.includes('__group_key') || sql.includes('__members')), `${name}: no group column in an ungrouped statement`)
    }
    // Positive control: the grouped option really changes the text.
    const grouped = await capture({ ...SETS.numeric, familyGroupSql: { keySql: KEY } })
    assert.ok(grouped.some(sql => sql.includes('__group_key')))
    assert.notEqual(createHash('sha256').update(grouped.join('\n--\n')).digest('hex').slice(0, 16), GOLDEN.numeric)
  })

  for (const seekPage of [false, true]) await check(`${seekPage ? 'seek' : 'ranked'} path: group totals are whole-scope, equal the oracle and do not depend on page or pageSize`, async () => {
    const raw = world(), db = adapter(raw)
    const options = { ...SETS.numeric, selectColumns: 'p.id, p.name, p.x', familyMemberBaseWhereSql: 'p.is_active = 1', seekPage, familyOrderSql: ORDER, db }
    const parentSeekFree = { ...options, parentSeek: false }
    // Oracle: families by name_key (a child belongs to its parent's key), the family date is the MAX of its rows, the key the UTC+7 day.
    const rows = raw.prepare('SELECT p.id, p.x, COALESCE(NULLIF(COALESCE(parent.name_key,p.name_key),\'\'),\'id:\'||COALESCE(parent.id,p.id)) AS k, lower(trim(COALESCE(parent.name,p.name))) AS n FROM products p LEFT JOIN products parent ON parent.id=p.parent_id').all()
    const families = new Map()
    for (const row of rows) { const f = families.get(row.k) || { k: row.k, n: row.n, max: null, members: 0 }; f.members++; if (row.x !== null && (f.max === null || row.x > f.max)) f.max = row.x; families.set(row.k, f) }
    const keyOf = max => max === null ? 'never' : `d:${new Date(Date.parse(max) + 7 * 3600000).toISOString().slice(0, 10)}`
    const ordered = [...families.values()].sort((a, b) => (a.max === null) - (b.max === null) || (a.max === b.max ? 0 : a.max < b.max ? 1 : -1) || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) || (a.k < b.k ? -1 : 1))
    const expected = new Map()
    ordered.forEach((f, index) => { const g = expected.get(keyOf(f.max)) || { families: 0, products: 0, first: index + 1, last: index + 1 }; g.families++; g.products += f.members; g.last = index + 1; expected.set(keyOf(f.max), g) })
    const spanning = [...expected.values()].some(g => g.families > 3)
    assert.ok(spanning && expected.size >= 3 && expected.has('never'), 'positive control: groups hold more families than a page of 3 and a never group exists')
    for (const pageSize of [3, 7, 20, 100]) {
      const seenRows = []
      for (let page = 1; page <= Math.ceil(ordered.length / pageSize) + 1; page++) {
        const result = await fp.paginateProductFamilies({ ...parentSeekFree, familyGroupSql: { keySql: KEY }, page, pageSize })
        assert.equal(result.total, ordered.length, 'total is the family count on every page')
        const pageKeys = new Set(result.items.map(item => item.group_key))
        assert.deepEqual(new Set(result.groups.map(g => g.key)), pageKeys, 'groups listed are exactly the groups present on the page')
        for (const g of result.groups) {
          const want = expected.get(g.key)
          assert.equal(g.families, want.families, `${g.key} families (page ${page}/${pageSize})`)
          assert.equal(g.products, want.products, `${g.key} products (page ${page}/${pageSize})`)
          assert.equal(g.first, want.first); assert.equal(g.last, want.last)
        }
        for (const item of result.items) assert.equal(Object.keys(item).filter(key => key.startsWith('__')).length, 0, 'no internal column leaks')
        seenRows.push(...result.items.map(item => item.id))
      }
      assert.equal(new Set(seenRows).size, seenRows.length, 'no row twice')
      assert.equal(seenRows.length, rows.length, 'every row once')
      // The ungrouped read returns the same rows in the same order.
      const plain = []
      for (let page = 1; page <= Math.ceil(ordered.length / pageSize) + 1; page++) plain.push(...(await fp.paginateProductFamilies({ ...parentSeekFree, page, pageSize })).items.map(item => item.id))
      assert.deepEqual(seenRows, plain, `grouped rows equal ungrouped rows at pageSize ${pageSize}`)
    }
    assert.equal([...expected.values()].reduce((n, g) => n + g.products, 0), rows.length)
  })
  console.log(`${passed} passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
