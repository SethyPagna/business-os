// products_typed_order_js (default OFF): the family order of a till's typed search (GET /api/products/search with rankIds) is computed in the Worker. The exactness rests on three facts and this
// file pins each one, with a mutant that must go red:
//   1. the SQL order of a ranked-id read is  match_tier ASC, family_promoted DESC, match_rank ASC, <tail>, family_root_id  (buildFamilyRelevanceOrderSql); the JS order is the same three keys;
//   2. match_rank is the id's position in the DEDUPLICATED csv (parseRankedIds), so two families never tie and the tail never decides; a tie (impossible) returns null and the SQL path runs;
//   3. families group by the exact key string (BINARY, like the SQL GROUP BY).
// Plus: which reads may take the path (typedOrderEligible), the driving WHERE (typedOrderDrivenRead, fail closed), the query builder's driver fragments and a coarse CPU guard.
//
// Run: node scripts/test-typed-order-js-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const moneyPrecision = require('../src/lib/moneyPrecision.ts')
function loadReal(relPath, deps = {}, edit = (text) => text) {
  const src = edit(fs.readFileSync(path.join(root, relPath), 'utf8'))
  const { outputText } = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: path.basename(relPath) })
  const mod = { exports: {} }
  const req = (id) => {
    if (id === './productStockGuard') return require('./harness/product_stock_guard.cjs')
    if (id.replace(/\.ts$/, '') === './moneyPrecision') return moneyPrecision
    if (Object.hasOwn(deps, id)) return deps[id]
    throw new Error(`unmapped require(${id}) from ${relPath}`)
  }
  new Function('exports', 'require', 'module', outputText)(mod.exports, req, mod)
  return mod.exports
}
const seam = (text, from, to) => { assert.equal(text.split(from).length, 2, `mutant anchor must occur once: ${from.slice(0, 50)}`); return text.replace(from, () => to) }

const searchMatch = loadReal('src/lib/searchMatch.ts')
const psq = loadReal('src/lib/productSearchQuery.ts', { './searchMatch': searchMatch })
const fp = loadReal('src/lib/familyPagination.ts')
const MUTANTS = {
  // the analyst's control: forgets promoted-first
  'promoted-first-forgotten': (t) => seam(t, '(a.t - b.t) || (b.pr - a.pr) || (a.r - b.r)', '(a.t - b.t) || (a.r - b.r)'),
  // a key map that lower-cases keys would merge 'Twin Cream ' / 'twin cream' (the SQL GROUP BY is BINARY)
  'keys-lower-cased': (t) => seam(t, 'const k = String(row.k), r = Number(row.r)', 'const k = String(row.k).toLowerCase(), r = Number(row.r)'),
  'tie-ignored': (t) => seam(t, 'if (a.t === b.t && a.pr === b.pr && a.r === b.r) return null', ''),
  'rank-not-checked': (t) => seam(t, 'if (!Number.isInteger(r) || r <= 0 || !Number.isFinite(t)) return null', ''),
  'eligible-ignores-restricted': (t) => seam(t, 'return !read.restricted && read.seekPageRead', 'return read.seekPageRead'),
  'eligible-ignores-image-only': (t) => seam(t, '&& !read.imageOnly && !read.byId', '&& !read.byId'),
  'eligible-ignores-by-id': (t) => seam(t, '&& !read.imageOnly && !read.byId', '&& !read.imageOnly'),
  'eligible-any-order': (t) => seam(t, '&& read.orderSql.startsWith(TYPED_ORDER_PREFIX)', ''),
  'driven-read-replaces-all': (t) => seam(t, 'if (where.filter((term) => term === driver.listedWhereSql).length !== 1) return undefined', ''),
}

let checks = 0
const RUNS = []
function run(mod, label) {
  const { orderRankedIdFamilies, typedOrderEligible, typedOrderDrivenRead, TYPED_ORDER_PREFIX } = mod
  const failures = []
  const check = (name, fn) => { try { fn(); checks += 1 } catch (error) { failures.push(`${label}: ${name}: ${String(error.message).split('\n')[0]}`) } }
  const row = (k, t, pr, r) => ({ k, t, pr, r })

  check('order: tier first, then promoted before unpromoted within a tier, then best rank', () => {
    const rows = [row('a', 3, 0, 1), row('b', 3, 1, 9), row('c', 1, 0, 40), row('d', 1, 1, 50), row('e', 3, 1, 4)]
    assert.deepEqual(orderRankedIdFamilies(rows), ['d', 'c', 'e', 'b', 'a'])
  })
  check('a family takes MIN tier, MIN rank and MAX promoted over its rows', () => {
    const rows = [row('f', 3, 0, 20), row('f', 2, 0, 30), row('f', 3, 1, 25), row('g', 2, 0, 10), row('h', 3, 0, 5)]
    // f: tier 2, promoted 1, rank 20 ; g: tier 2, promoted 0, rank 10 ; h: tier 3
    assert.deepEqual(orderRankedIdFamilies(rows), ['f', 'g', 'h'])
  })
  check('a promoted header whose child alone is listed: promotion comes from the rows given, no others', () => {
    assert.deepEqual(orderRankedIdFamilies([row('x', 3, 0, 7), row('y', 3, 0, 2)]), ['y', 'x'])
  })
  check('keys group by the exact string (BINARY): case and spacing keep families apart', () => {
    const rows = [row('twin cream', 3, 0, 5), row('Twin Cream ', 3, 0, 6), row('twin  cream', 3, 0, 7)]
    assert.deepEqual(orderRankedIdFamilies(rows), ['twin cream', 'Twin Cream ', 'twin  cream'])
  })
  check('NULL promoted reads as 0, a numeric string rank is accepted', () => {
    assert.deepEqual(orderRankedIdFamilies([{ k: 'a', t: 3, pr: null, r: '4' }, { k: 'b', t: 3, pr: 1, r: '9' }]), ['b', 'a'])
  })
  check('tie fallback: two families equal on tier, promoted and rank return null (the SQL path runs)', () => {
    assert.equal(orderRankedIdFamilies([row('a', 3, 0, 5), row('b', 3, 0, 5)]), null)
    assert.equal(orderRankedIdFamilies([row('a', 3, 1, 5), row('b', 3, 1, 5), row('c', 1, 0, 9)]), null)
    assert.notEqual(orderRankedIdFamilies([row('a', 3, 1, 5), row('b', 3, 0, 5)]), null, 'differing promotion is not a tie')
  })
  check('fail closed on a rank that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, null, undefined, 'x', NaN]) assert.equal(orderRankedIdFamilies([row('a', 3, 0, bad)]), null, `rank ${String(bad)}`)
  })
  check('no rows, no families', () => assert.deepEqual(orderRankedIdFamilies([]), []))

  const base = { restricted: false, seekPageRead: true, rankedIdCount: 400, imageOnly: false, byId: false, orderSql: `${TYPED_ORDER_PREFIX}, family_name ASC` }
  check('eligible: an unrestricted ranked-id seek-page read with the typed order', () => assert.equal(typedOrderEligible(base), true))
  check('skipped for a restricted read (Inventory Check keeps the ranked scope)', () => assert.equal(typedOrderEligible({ ...base, restricted: true }), false))
  check('skipped for imageOnly', () => assert.equal(typedOrderEligible({ ...base, imageOnly: true }), false))
  check('skipped for byId', () => assert.equal(typedOrderEligible({ ...base, byId: true }), false))
  check('skipped below the seek-page threshold (short lists keep the one-batch statements)', () => assert.equal(typedOrderEligible({ ...base, seekPageRead: false }), false))
  check('skipped without ranked ids', () => assert.equal(typedOrderEligible({ ...base, rankedIdCount: 0 }), false))
  check('skipped when the order string differs', () => {
    for (const orderSql of ['family_name ASC', 'match_tier ASC, match_rank ASC, family_name ASC', 'family_promoted DESC, match_tier ASC, match_rank ASC', 'match_tier ASC, family_promoted DESC, family_name ASC']) {
      assert.equal(typedOrderEligible({ ...base, orderSql }), false, orderSql)
    }
  })

  const driver = { listParam: 'rankIdList', listedWhereSql: 'p.id IN (SELECT CAST(value AS INTEGER) FROM json_each(@rankIdList))', csvMemberWhereSql: 'CSV' }
  check('driven read replaces exactly the listing term by 1 = 1 and keeps every other term', () => {
    const read = typedOrderDrivenRead(['a = 1', driver.listedWhereSql, 'b = 2'], driver)
    assert.deepEqual(read, { listParam: 'rankIdList', drivenWhereSql: 'WHERE a = 1 AND 1 = 1 AND b = 2', csvMemberWhereSql: 'CSV' })
  })
  check('driven read fails closed when the listing term is absent or repeated', () => {
    assert.equal(typedOrderDrivenRead(['a = 1'], driver), undefined)
    assert.equal(typedOrderDrivenRead([driver.listedWhereSql, driver.listedWhereSql], driver), undefined)
  })
  return failures
}

// ---- real module, then every mutant -----------------------------------------------------------------------------------------------------------------------------------
const realFailures = run(fp, 'real')
assert.deepEqual(realFailures, [], `the real module passes every check:\n${realFailures.join('\n')}`)
for (const [name, edit] of Object.entries(MUTANTS)) {
  const mutated = loadReal('src/lib/familyPagination.ts', {}, edit)
  const failures = run(mutated, name)
  assert.ok(failures.length > 0, `mutant ${name} must go red`)
  console.log(`PASS mutant ${name} killed by ${failures.length} check(s)`)
}

// ---- the order keys the JS order mirrors ------------------------------------------------------------------------------------------------------------------------------
assert.equal(psq.buildFamilyRelevanceOrderSql('family_name ASC', { hasTier: true, hasRank: true, promotedFirst: true }), `${fp.TYPED_ORDER_PREFIX}, family_name ASC`,
  'a change to buildFamilyRelevanceOrderSql must change the JS order too: the ranked-id order starts with TYPED_ORDER_PREFIX')
assert.equal(fp.TYPED_ORDER_PREFIX, 'match_tier ASC, family_promoted DESC, match_rank ASC')
checks += 2
console.log('PASS the ranked-id order keys are tier ASC, promoted DESC, rank ASC')

// ---- parseRankedIds invariant: rank positions are unique ------------------------------------------------------------------------------------------------------------------
{
  const positionsOf = (params) => { const csv = params.rankCsv; return (id) => csv.indexOf(`,${id},`) + 1 }
  const lists = {
    duplicates: '5,6,5,7,6,8',
    garbage: '5,abc,-1,0,,6.5,7, 8 ,0012,99999999999999999999,9',
    zeros: '0,0,1,2',
    overCap: Array.from({ length: 1700 }, (_, i) => i + 1).join(','),
    dupAcrossTiers: '10,20,10,30,20',
  }
  for (const [label, raw] of Object.entries(lists)) {
    const tiers = label === 'dupAcrossTiers' ? '03140' : '3'.repeat(40)
    const parsed = psq.parseRankedIds(raw, tiers)
    assert.ok(parsed, label)
    assert.equal(new Set(parsed.ids).size, parsed.ids.length, `${label}: ids deduplicated`)
    assert.ok(parsed.ids.every((id) => Number.isSafeInteger(id) && id > 0), `${label}: positive integers only`)
    assert.ok(parsed.ids.length <= psq.RANKED_ID_LIMIT, `${label}: capped`)
    const params = {}
    psq.buildProductSearchQuery('', params, { rankedIds: parsed, catalogOnly: true })
    const position = positionsOf(params)
    const seen = new Set()
    for (const id of parsed.ids) {
      const at = position(id)
      assert.ok(at > 0, `${label}: id ${id} has a position`)
      assert.ok(!seen.has(at), `${label}: position ${at} is unique`)
      seen.add(at)
    }
    assert.equal(JSON.parse(params.rankIdList).length, parsed.ids.length, `${label}: the json list and the csv hold the same ids`)
    checks += 1
  }
  assert.equal(psq.parseRankedIds('1500,1,1500', '').ids.length, 2)
  assert.equal(psq.parseRankedIds('', ''), undefined)
  console.log('PASS parseRankedIds: positions stay unique with duplicates, garbage, 0 and an over-cap list')
}

// ---- the query builder emits the driver fragments ---------------------------------------------------------------------------------------------------------------------
{
  const params = {}
  const query = psq.buildProductSearchQuery('', params, { rankedIds: psq.parseRankedIds('4,5,6', '013'), catalogOnly: true })
  assert.ok(query.rankedIdDriver, 'a ranked-id read carries the driver')
  assert.equal(query.rankedIdDriver.listedWhereSql, query.whereClause, 'the listing term is exactly the WHERE the caller pushes')
  assert.equal(query.rankedIdDriver.listParam, 'rankIdList')
  assert.ok(Object.hasOwn(params, 'rankIdList') && Object.hasOwn(params, 'rankCsv'))
  const member = query.rankedIdDriver.csvMemberWhereSql
  assert.ok(member.startsWith(query.activeWhereSql + ' AND ('), 'same visibility term as familyMemberWhereSql')
  assert.ok(member.includes("instr(@rankCsv, ',' || p.id || ',') > 0") && member.includes("instr(@rankCsv, ',' || p.parent_id || ',') > 0") && /EXISTS \(SELECT 1 FROM products listed WHERE listed\.parent_id = p\.id AND instr\(@rankCsv, ',' \|\| listed\.id \|\| ','\) > 0\)/.test(member),
    'the three member terms: the row is listed, its parent is, it is the parent of a listed row')
  assert.ok(!/json_each/.test(member), 'no IN-list over the whole id list')
  const prefixed = {}
  const other = psq.buildProductSearchQuery('', prefixed, { rankedIds: psq.parseRankedIds('4', ''), paramPrefix: 'x', catalogOnly: true })
  assert.equal(other.rankedIdDriver.listParam, 'xrankIdList')
  assert.ok(other.rankedIdDriver.csvMemberWhereSql.includes('@xrankCsv'))
  const none = psq.buildProductSearchQuery('', {}, { rankedIds: { ids: [], tiers: [] }, catalogOnly: true })
  assert.equal(none.rankedIdDriver, undefined, 'an unusable list has no driver (it resolves to no rows)')
  assert.equal(psq.buildProductSearchQuery('cream', {}, { catalogOnly: true }).rankedIdDriver, undefined, 'a text search has no driver')
  checks += 1
  console.log('PASS the query builder emits the driving list, the listing term and the CSV member filter')
}

// ---- CPU guard (coarse): 1,500 matched rows, 40-character Khmer keys ---------------------------------------------------------------------------------------------------
{
  const rows = []
  for (let i = 0; i < 1500; i += 1) rows.push({ k: `ក្រែមលាបមុខ${String(i % 700).padStart(34, 'x')}`, t: i % 4, pr: i % 11 === 0 ? 1 : 0, r: i + 1 })
  for (let i = 0; i < 30; i += 1) fp.orderRankedIdFamilies(rows)
  const samples = []
  for (let i = 0; i < 200; i += 1) { const t0 = process.hrtime.bigint(); fp.orderRankedIdFamilies(rows); samples.push(Number(process.hrtime.bigint() - t0) / 1e6) }
  samples.sort((a, b) => a - b)
  const p95 = samples[Math.floor(samples.length * 0.95)]
  assert.ok(p95 < 2, `grouping and ordering 1,500 rows stays under 2 ms p95 (saw ${p95.toFixed(2)} ms); an accidental O(n^2) goes red here`)
  checks += 1
  console.log(`PASS CPU guard: 1,500 rows p95 ${p95.toFixed(2)} ms`)
}
console.log(`${checks} checks passed`)
