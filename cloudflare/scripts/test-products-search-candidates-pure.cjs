'use strict'
// The candidate-driven ranking of a typed product search (lib/productSearchQuery.ts ProductSearchCandidates, lib/familyPagination.ts candidateSql, migration 0307).
//
// A typed search used to rank EVERY matching family by testing its WHERE (an OR of index lookups and the exact-barcode catch-all over the stored column) on every active product,
// and the catch-all alone made the planner read the whole catalogue whatever the text matched. The ranking now starts from the ids the search names (the same sets, by seeks).
// This test proves, on real SQLite with every migration applied, that this is the SAME search:
//   1. DIFFERENTIAL: for every query, sort, page size and page (including a page past the end), the candidate form returns the same rows, order, total and pages as the predicate
//      form (the statement the Worker ran before), on a catalogue with ties, same-name families, parent-linked variants, inactive rows, Khmer names, stored barcodes with spaces,
//      hyphens, capitals and extra zeros, a UPC-A / UPC-E twin, and products that match through several sources at once;
//   2. PLAN: the candidate statement reads no catalogue scan (no SCAN p, no walk of the is_active index), and uses idx_products_barcode_key for the catch-all; without the index
//      the same rows come back (the control: the index only makes it a seek);
//   3. SHAPE: every compound SELECT stays within D1's 5-term cap; a search with a hybrid / short-word / partial-word term has no candidate list; ranked ids are driven by json_each;
//   4. THE ROUTE GLUE (searchCandidateRead) refuses anything but exactly one search term;
//   5. MUTANTS: each of fourteen deliberate breakages (a dropped tie-break, a miscounted total, a dropped source, a dropped catch-all, a lost rank, a dropped filter, a wrong
//      aggregate, a wrong past-the-end count, ...) turns at least one of the comparisons above red. A green run therefore proves something.
//
// Run (from cloudflare/): node scripts/test-products-search-candidates-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const moneyPrecision = require('../src/lib/moneyPrecision.ts')

const root = path.join(__dirname, '..')
const sources = (relPath) => fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n')

// Loads a real module, optionally with deliberate source breakages (a mutant): each anchor must occur exactly `count` times.
function loadModule(relPath, deps = {}, patches = []) {
  let text = sources(relPath)
  for (const patch of patches.filter((p) => p.file === relPath)) {
    const found = text.split(patch.from).length - 1
    assert.equal(found, patch.count || 1, `mutant anchor in ${relPath} occurs ${found} times: ${patch.from.slice(0, 70)}`)
    text = text.split(patch.from).join(patch.to)
  }
  const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: path.basename(relPath) })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => {
    if (id === './productStockGuard') return require('./harness/product_stock_guard.cjs')
    if (id.replace(/\.ts$/, '') === './moneyPrecision') return moneyPrecision
    if (Object.hasOwn(deps, id)) return deps[id]
    throw new Error(`unmapped require(${id}) from ${relPath}`)
  }, mod)
  return mod.exports
}
function loadSearch(patches = []) {
  const searchMatch = loadModule('src/lib/searchMatch.ts', {}, patches)
  const productSearchQuery = loadModule('src/lib/productSearchQuery.ts', { './searchMatch': searchMatch }, patches)
  const familyPagination = loadModule('src/lib/familyPagination.ts', {}, patches)
  return { searchMatch, ...productSearchQuery, ...familyPagination }
}

// ---- the catalogue ------------------------------------------------------------------------------------------------------------------------------------------------------------
const db = openDb(loadAll())
const raw = db.db
raw.exec("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)")
const base = loadSearch()
const insert = raw.prepare(`INSERT INTO products (id, name, sku, barcode, brand, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active, name_normalized, parent_id, discount_enabled, discount_type, discount_percent, created_at)
  VALUES (@id, @name, @sku, @barcode, @brand, @category, 'pcs', 0, 1, 0, @active, @norm, @parent, @disc, 'percent', 10, @created)`)
let nextId = 1000
function add(name, o = {}) {
  const id = o.id ?? nextId++
  seedStockFixture(raw, () => insert.run({ id, name, sku: o.sku ?? `SKU-${id}`, barcode: o.barcode === undefined ? `88000000${String(id).padStart(5, '0')}` : o.barcode, brand: o.brand ?? (id % 5 === 0 ? 'GlowCo' : 'Other'),
    category: o.category ?? (id % 2 ? 'Face' : 'Lip'), active: o.active ?? 1, norm: base.searchMatch.normalizeSearchText(name), parent: o.parent ?? null, disc: o.disc ?? 0, created: o.created ?? `2026-0${1 + (id % 9)}-1${id % 9} 03:00:00` }))
  return id
}
const words = ['Glow', 'Rose', 'Matte', 'Serum', 'Cream', 'Robust', 'Glowing', 'Rosa']
for (let i = 0; i < 120; i += 1) {
  const a = words[i % words.length], b = words[(i * 3 + 1) % words.length]
  add(`${a} ${b} ${i % 4 === 0 ? a : ''} Item ${Math.floor(i / 2)}`.replace(/\s+/g, ' '), { disc: i % 17 === 3 ? 1 : 0 })
}
add('Superglowx Balm')                                                           // matched by the name trigram only (a fused token)
add('Glow Zeta')                                                                 // short name: the best bm25 for "glow", last alphabetically
add('Glow Alpha Beta Gamma Delta Epsilon Theta')                                 // long name: a worse bm25, first alphabetically
add('Glow Lotion Spaced', { barcode: ' 885-000-4001 ' })                         // stored with spaces and hyphens: the catch-all finds it
add('Glow Lotion Capital', { barcode: 'ABC-123x' })                              // stored in capitals with a hyphen
add('Glow Lotion Padded', { barcode: '0000000000000000000885000301' })           // zero-padded past the 18 the literal probe tries
add('Glow Lotion Retired', { barcode: ' 885-000-4001 ', active: 0 })             // the same barcode on an inactive row: never returned
add('Upc Twin A', { barcode: '042100005264' })                                   // UPC-A ...
add('Upc Twin B', { barcode: '04252614' })
add('Upc Twin Spaced', { barcode: '0 42100 00526-4' })                             // the UPC-A written with spaces and a hyphen: only the normalized form finds it                                       // ... and its UPC-E: one scan finds both
add('Upc Short', { barcode: '42100005264' })                                    // the UPC-A without its leading zero: the normalized form equals the twin's, the stored form does not
add('Upc Ean', { barcode: '0042100005264' })                                     // the UPC-A as an EAN-13: same normalized form, different stored digits. A UPC scan never returned either of these two
add('zzbarcode', { barcode: 'ZZ-BARCODE' })                                      // matched by its name AND by the catch-all: two sources, one product
add('No Barcode Item', { barcode: null })
add('Blank Barcode Item', { barcode: '' })
const f1 = add('Mega Moisturizer', { barcode: '8850005000001' }); add('Mega Moisturizer', { barcode: '8850005000002' }); add('Mega Moisturizer', { barcode: '8850005000003' })
const parent = add('Lumi Parent'); add('Lumi Variant Different Name', { parent })  // a family keyed by its parent whose child is named differently
// created_desc: a family keyed by its PARENT whose child is newer than the parent competes with another family that ties on tier and rank. The family's newest date is the child's own
// created_at, never the parent's.
const zorbitParent = add('Zorbit Tonic', { created: '2026-01-01 03:00:00' }); add('Zorbit Tonic', { parent: zorbitParent, created: '2026-12-01 03:00:00' })
add('Zorbit Tonik', { created: '2026-06-01 03:00:00' })
// bm25 weights: hits in the name, the sku and the barcode compete (a weight scales every hit of a phrase alike, so one word alone cannot tell the weights apart; an OR of two words can).
add('Quill', { sku: 'XQ-1' }); add('Quill Lacquer Pen Set Deluxe Edition Gift Box Retail Pack', { sku: 'QUILL-2' }); add('Quill Brush Tip Nib', { sku: 'QUILLX-3' }); add('Quill Plain Ink', { sku: 'XQ-4' })
add('Quill Pot', { sku: 'QUILL-5' }); add('Quill Plume Silk Feather Stand Large Gift Box Retail Pack Deluxe Edition', { sku: 'XB-1' })   // OR of two words: the weighted term frequencies saturate differently, so the weights change the order
add('Plume Ink', { sku: 'PLUME-9', barcode: 'PLUME-9' }); add('Plume', { sku: 'XP-1', barcode: '77700001' }); add('Plume Silk Feather Quill Set Large Gift', { sku: 'XP-2', barcode: 'PLUME-2' })
const zeds = ['Zed Tonic Aa', 'Zed Tonic Ab', 'zed tonic ab', 'Zed Tonic Ac']; zeds.forEach((n) => add(n))   // equal bm25: only name and key decide
for (let i = 0; i < 12; i += 1) add('', { id: i < 6 ? 9990 + i : 10001 + i, barcode: `88800${i}` })                    // blank-named ties; 'id:10001' sorts before 'id:9990' as text
add('Dup Family', { barcode: '8851111111111' }); add('Dup Family', { barcode: '8851111111112', active: 0 })
seedStockFixture(raw, () => raw.exec("UPDATE products SET name_key = lower(trim(name)) WHERE COALESCE(name_key, '') = ''"))
const ACTIVE = raw.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active = 1').get().n
assert.ok(ACTIVE > 140, `fixture has ${ACTIVE} active products`)

// ---- the two statement forms ----------------------------------------------------------------------------------------------------------------------------------------------
const PROMOTED = 'CASE WHEN p.discount_enabled = 1 THEN 1 ELSE 0 END'
const TAILS = { name_asc: ['family_name ASC', 'lower(name) ASC, id ASC'], name_desc: ['family_name DESC', 'lower(name) DESC, id ASC'], created_desc: ['latest_created_at DESC, family_name ASC', 'created_at DESC, id DESC'] }
const SELECT = 'p.id, p.name, p.brand, p.parent_id, p.barcode, p.created_at'

async function run(mod, form, term, { page = 1, pageSize = 20, sort = 'name_asc', mode, titleOnly = false, extraWhere = [], rankIds, capture, override = {} } = {}) {
  const params = {}
  const q = mod.buildProductSearchQuery(term, params, { mode, titleOnly, catalogOnly: true, rankedIds: rankIds ? mod.parseRankedIds(rankIds.join(','), rankIds.map(() => '3').join('')) : undefined })
  const where = ['p.is_active = 1', ...extraWhere]
  if (q.activeWhereSql) where[0] = q.activeWhereSql
  if (q.whereClause) where.push(q.whereClause)
  const [tail, intra] = TAILS[sort]
  const familyMember = q.familyMemberWhereSql || 'p.is_active = 1'
  const candidate = form === 'candidates' && q.candidates ? q.candidates : undefined
  const rank = candidate ? candidate.matchRankSql : q.matchRankSql
  const opts = {
    db: capture ? { ...db, prepare: (sql) => { capture.push(sql); return db.prepare(sql) }, batch: (s) => { capture.push(...s.map((x) => x.sql)); return db.batch(s) } } : db,
    selectColumns: SELECT, joinSql: '', whereSql: `WHERE ${(candidate ? where.map((t) => (t === q.whereClause ? '1 = 1' : t)) : where).join(' AND ')}`, params, page, pageSize,
    familyOrderSql: mod.buildFamilyRelevanceOrderSql(tail, { hasTier: Boolean(q.matchTierSql), hasRank: Boolean(rank), promotedFirst: true }), intraFamilyOrderSql: intra,
    matchRankSql: rank, rankCteSql: candidate ? undefined : q.rankCteSql, matchTierSql: q.matchTierSql, promotedRankSql: PROMOTED,
    familyMemberBaseWhereSql: q.hasSearchTerm ? familyMember : undefined,
    seekPage: true, candidateSql: candidate ? candidate.idsSql : undefined, ...override,
  }
  return { result: await mod.paginateProductFamilies(opts), q }
}

const rankIdList = (n, step) => Array.from(new Set(Array.from({ length: n }, (_, i) => 1000 + ((i * step) % 140))))
// [term, options]: single-token searches take the candidate form; the rest must keep the predicate form (and still agree).
const QUERIES = [
  ['glow', {}], ['glow', { page: 2, pageSize: 7 }], ['glow', { sort: 'name_desc' }], ['glow', { sort: 'created_desc', pageSize: 5, page: 3 }], ['glow', { pageSize: 1, page: 4 }], ['glow', { page: 999 }], ['glow', { pageSize: 150 }],
  ['glow', { extraWhere: ["p.brand = 'GlowCo'"] }], ['glow', { extraWhere: ['p.discount_enabled = 1'] }], ['glow', { titleOnly: true }], ['glow', { mode: 'OR' }],
  ['cream', {}], ['cream', { page: 2, pageSize: 6 }], ['serum', { sort: 'created_desc' }], ['robust', {}], ['rosa', { pageSize: 3, page: 2 }], ['item', {}], ['item', { page: 3, pageSize: 9 }],
  ['ream', {}], ['lowx', {}], ['superglowx', {}],                                  // substring hits: the name trigram source
  ['8850004001', {}], ['885-000-4001', {}], ['abc123x', {}], ['ABC-123X', {}], ['885000301', {}], ['0000885000301', {}],   // the catch-all: spaces, hyphens, capitals, zeros
  ['042100005264', {}], ['04252614', {}], ['42100005264', {}], ['0042100005264', {}], ['00042100005264', {}],                      // the UPC twin, from either side
  ['8850005000002', {}], ['moisturizer', {}], ['variant', {}], ['lumi', {}],         // a family reached through one row
  ['zzbarcode', {}], ['zzbarcode', { titleOnly: true }], ['zz-barcode', {}],         // two sources for one product
  ['zed', {}], ['zed', { pageSize: 1, page: 2 }], ['zed', { pageSize: 2, page: 2 }], ['tonic ab', {}],
  ['8800000', {}], ['880000001', { pageSize: 50 }], ['88800', {}],                   // barcode fragments from the start (FTS) ...
  ['000100', {}], ['0001000', { pageSize: 50 }],                                     // ... and from the middle of a barcode: only the code trigram source finds these
  // twelve blank-named families tie on tier, rank, name and date: only the family key orders them, and the page boundaries cut through the tie
  ['88800', { pageSize: 5 }], ['88800', { pageSize: 5, page: 2 }], ['88800', { pageSize: 5, page: 3 }], ['88800', { pageSize: 5, page: 2, sort: 'name_desc' }], ['88800', { pageSize: 4, page: 3, sort: 'created_desc' }],
  ['zorbit', { sort: 'created_desc' }], ['zorbit', { sort: 'created_desc', titleOnly: true }], ['zorbit', { sort: 'name_asc' }],     // a parent-keyed family against another, by newest row
  ['quill', {}], ['quill', { sort: 'created_desc' }], ['plume', {}], ['plume', { page: 2, pageSize: 2 }], ['xq', {}], ['quill plume', {}], ['quill,plume', { mode: 'OR' }], ['quill,plume', { mode: 'OR', pageSize: 3, page: 2 }], ['quill', { pageSize: 2 }],   // weights: hits in the name, the sku and the barcode compete
  ['dup', {}], ['family', {}], ['zzzqqq', {}], ['zzzqqq', { page: 3 }], ['0', {}],
  ['glow lotion', {}], ['rose glow', {}], ['ro', {}], ['g', {}], ['ro ma', { mode: 'OR' }], ['glow rose item serum', {}],  // hybrid / short-word / partial-word: predicate form
  ['', { rankIds: rankIdList(40, 7) }], ['', { rankIds: rankIdList(140, 3), pageSize: 10, page: 4 }], ['', { rankIds: [1011, 1012, 1013].concat(rankIdList(30, 11)), sort: 'name_desc' }],
]

async function battery(mod, form, observe) {
  const out = []
  for (const [term, o] of QUERIES) {
    const { result, q } = await run(mod, form, term, o)
    if (observe) observe(term, o, q)
    out.push(JSON.stringify(result))
  }
  return out
}

let passed = 0
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`) }

;(async () => {
  const reference = await battery(base, 'predicate')
  const used = [], unused = []
  const candidates = await battery(base, 'candidates', (term, o, q) => (q.candidates ? used : unused).push(term))

  await check('DIFFERENTIAL: every query returns the same rows, order, total and pages in the candidate and the predicate form', async () => {
    assert.equal(candidates.length, QUERIES.length)
    candidates.forEach((json, index) => assert.equal(json, reference[index], `query ${JSON.stringify(QUERIES[index])} differs`))
  })

  await check('the comparison is not vacuous: most queries return rows, the candidate form is used for the single-token searches, and ties and families are present', async () => {
    const parsed = reference.map((json) => JSON.parse(json))
    assert.ok(parsed.filter((r) => r.items.length > 0).length >= QUERIES.length - 8, 'most probes return rows')
    assert.ok(used.length >= 35, `candidate form used for ${used.length} queries`)
    for (const term of ['glow lotion', 'rose glow', 'ro', 'g', 'glow rose item serum']) assert.ok(unused.includes(term), `${term} keeps the predicate form`)
    const zed = JSON.parse(reference[QUERIES.findIndex(([t, o]) => t === 'zed' && !o.page)])
    assert.equal(zed.total, 3, '"zed": four rows, one family sharing a name key (zed tonic ab twice)')
    const mega = JSON.parse(reference[QUERIES.findIndex(([t]) => t === '8850005000002')])
    assert.equal(mega.items.length, 3, 'a family reached through one barcode returns every row')
    const variant = JSON.parse(reference[QUERIES.findIndex(([t]) => t === 'variant')])
    assert.ok(variant.items.some((r) => r.name === 'Lumi Parent') && variant.items.some((r) => r.parent_id), 'a child match returns its parent family')
    const retired = JSON.parse(reference[QUERIES.findIndex(([t]) => t === '8850004001')])
    assert.deepEqual(retired.items.map((r) => r.name), ['Glow Lotion Spaced'], 'the inactive twin of a stored barcode is never returned')
    const twin = JSON.parse(reference[QUERIES.findIndex(([t]) => t === '04252614')])
    assert.deepEqual(twin.items.map((r) => r.name).sort(), ['Upc Twin A', 'Upc Twin B', 'Upc Twin Spaced'], 'a UPC-E scan finds the UPC-A rows too, however they are written')
    const glow = JSON.parse(reference[QUERIES.findIndex(([t, o]) => t === 'glow' && o.pageSize === 150)])
    const names = glow.items.map((r) => r.name)
    assert.ok(names.indexOf('Glow Zeta') >= 0 && names.indexOf('Glow Zeta') < names.indexOf('Glow Alpha Beta Gamma Delta Epsilon Theta'), 'bm25 puts the short name ahead of the long one although it sorts later: the rank decides')
  })

  await check('PLAN: the candidate statement reads no catalogue scan; the catch-all is a seek on idx_products_barcode_key; without that index the same rows come back', async () => {
    const statements = []
    await run(base, 'candidates', 'cream', { capture: statements })
    const text = statements.find((s) => /__cand/.test(s))
    assert.ok(text, 'a candidate statement ran')
    const names = [...new Set([...text.matchAll(/@(\w+)/g)].map((m) => m[1]))]
    const params = {}
    base.buildProductSearchQuery('cream', params, { catalogOnly: true })
    const bind = Object.fromEntries(names.map((n) => [n, params[n] ?? (n === '__familyPageSize' ? 20 : n === '__familyOffset' ? 0 : null)]))
    const plan = raw.prepare(`EXPLAIN QUERY PLAN ${text}`).all(bind).map((r) => r.detail)
    const joined = plan.join(' | ')
    assert.ok(/SEARCH p USING INDEX idx_products_barcode_key \(<expr>=\?\)/.test(joined), joined)
    assert.ok(!/SCAN p\b/.test(joined) && !/idx_products_active_grouped_pg/.test(joined) && !/SCAN products\b/.test(joined.replace(/SCAN products_fts\w*/g, '')), `the candidate statement scans the catalogue: ${joined}`)
    const old = []
    await run(base, 'predicate', 'cream', { capture: old })
    const oldPlan = raw.prepare(`EXPLAIN QUERY PLAN ${old.find((s) => /page_candidates/.test(s))}`).all(Object.fromEntries([...new Set([...old.find((s) => /page_candidates/.test(s)).matchAll(/@(\w+)/g)].map((m) => m[1]))].map((n) => [n, params[n] ?? (n === '__familyPageSize' ? 20 : n === '__familyOffset' ? 0 : null)]))).map((r) => r.detail).join(' | ')
    assert.ok(/SEARCH p USING INDEX idx_products_active_grouped_pg \(is_active=\?\)/.test(oldPlan) || /SCAN p/.test(oldPlan), `control: the predicate form walks the active products: ${oldPlan}`)
    // Control: drop the index; the answers are unchanged (the index only turns a scan into a seek).
    raw.exec('DROP INDEX idx_products_barcode_key')
    try {
      const without = await battery(base, 'candidates')
      without.forEach((json, index) => assert.equal(json, reference[index], `without the index, query ${JSON.stringify(QUERIES[index])} differs`))
    } finally {
      raw.exec("CREATE INDEX idx_products_barcode_key ON products (ltrim(lower(replace(replace(trim(COALESCE(barcode, '')), ' ', ''), '-', '')), '0'))")
    }
  })

  await check('SHAPE: compounds stay within 5 terms, the hybrid / short-word / partial-word searches have no candidate list, ranked ids are driven by json_each, the alias is pinned', async () => {
    assert.equal(base.PRODUCT_SEARCH_CANDIDATE_ALIAS, '__cand')
    assert.ok(/const CANDIDATE_ALIAS = '__cand'/.test(sources('src/lib/familyPagination.ts')), 'familyPagination spells the same alias')
    for (const term of ['glow', '8850004001', '042100005264', 'cream', 'zzbarcode']) {
      const q = base.buildProductSearchQuery(term, {}, { catalogOnly: true })
      assert.ok(q.candidates, `${term} has a candidate list`)
      assert.ok(!/__fts_rank/.test(q.candidates.idsSql) && !/__fts_rank/.test(q.candidates.matchRankSql || ''), 'no rank CTE in the candidate form')
      // every compound at the top level or in a parenthesis: count its UNION terms
      const depthTerms = (sql) => { let max = 0; let depth = 0; const counts = [0]; for (const part of sql.split(/(\(|\)|\bUNION ALL\b|\bUNION\b)/i)) { if (part === '(') { depth += 1; counts[depth] = 0 } else if (part === ')') { max = Math.max(max, counts[depth] + 1); depth -= 1 } else if (/^UNION/i.test(part)) counts[depth] += 1 } return Math.max(max, counts[0] + 1) }
      assert.ok(depthTerms(q.candidates.idsSql) <= 5, `${term}: a compound has more than 5 terms`)
    }
    for (const term of ['glow lotion', 'ro', 'g', 'rose glow item serum', 'ab']) assert.equal(base.buildProductSearchQuery(term, {}, { catalogOnly: true }).candidates, undefined, `${term}: unsourced`)
    const ranked = base.buildProductSearchQuery('', {}, { rankedIds: base.parseRankedIds('4,5,6', '013'), catalogOnly: true })
    assert.ok(/json_each\(@rankIdList\)/.test(ranked.candidates.idsSql) && ranked.candidates.matchRankSql === ranked.matchRankSql)
    assert.equal(base.buildProductSearchQuery('', {}, { rankedIds: { ids: [], tiers: [] }, catalogOnly: true }).candidates, undefined)
    assert.equal(base.buildProductSearchQuery('glow', {}, { catalogOnly: true, useSearchIndex: false }).candidates, undefined, 'the LIKE fallback keeps its predicate')
    const text = base.buildProductSearchQuery('glow', {}, { catalogOnly: true })
    assert.equal(Boolean(text.candidates.matchRankSql), Boolean(text.matchRankSql))
    assert.equal(base.buildProductSearchQuery('glow', {}, { catalogOnly: true, titleOnly: true }).candidates, undefined, 'a title-only text search keeps its predicate (the candidate form read more: its two sources overlap on every hit and there is no catch-all to avoid)')
  })

  // The ids the candidate list names, with their rank column, run on the fixture.
  const candidateRows = (mod, term) => {
    const params = {}
    const q = mod.buildProductSearchQuery(term, params, { catalogOnly: true })
    const bind = Object.fromEntries([...new Set([...q.candidates.idsSql.matchAll(/@(\w+)/g)].map((m) => m[1]))].map((n) => [n, params[n]]))
    const ftsIds = q.candidates.idsSql.includes('products_fts WHERE products_fts MATCH @ftsQuery') ? new Set(raw.prepare('SELECT rowid AS id FROM products_fts WHERE products_fts MATCH @ftsQuery').all({ ftsQuery: params.ftsQuery }).map((r) => r.id)) : new Set()
    return { rows: raw.prepare(q.candidates.idsSql).all(bind), ftsIds }
  }
  await check('CANDIDATES: a product the FTS term matches is listed once, with its bm25; every other row has no bm25 (rank exact by construction)', async () => {
    for (const term of ['glow', 'zzbarcode', 'quill', '88800', 'ream', '885000301', 'lowx']) {
      const { rows, ftsIds } = candidateRows(base, term)
      assert.ok(rows.length > 0, `${term}: candidates exist`)
      for (const id of ftsIds) {
        const mine = rows.filter((r) => r.id === id)
        assert.equal(mine.length, 1, `${term}: FTS product ${id} is listed ${mine.length} times`)
        assert.ok(typeof mine[0].r === 'number', `${term}: FTS product ${id} carries its bm25`)
      }
      for (const row of rows) if (!ftsIds.has(row.id)) assert.equal(row.r, null, `${term}: a product the FTS term does not match has no bm25`)
    }
    // zzbarcode is in the FTS table, the name trigram table AND the barcode catch-all: one row, the FTS rank
    const id = raw.prepare("SELECT id FROM products WHERE name = 'zzbarcode'").get().id
    const mine = candidateRows(base, 'zzbarcode').rows.filter((r) => r.id === id)
    assert.equal(mine.length, 1)
    assert.ok(mine[0].r < 0, 'the one row carries the FTS bm25')
  })

  // The route replaces the search term by 1 = 1 before the helper decides whether to honour the list: dropping the list there would run the statement without the search.
  const narrowOutcomes = async (mod) => {
    const attempts = [
      () => run(mod, 'candidates', 'cream', { override: { seekPage: false } }),
      () => run(mod, 'candidates', 'cream', { override: { familyMemberBaseWhereSql: undefined } }),
      () => mod.rankProductFamilies({ ...{ db, selectColumns: SELECT, joinSql: '', whereSql: 'WHERE 1 = 1', params: {}, page: 1, pageSize: 20, familyOrderSql: 'family_name ASC', intraFamilyOrderSql: 'id ASC' }, candidateSql: 'SELECT id, NULL AS r FROM products' }),
    ]
    const out = []
    for (const attempt of attempts) { try { const r = await attempt(); out.push(JSON.stringify(r.result || r).length > 0 ? 'ran' : 'ran') } catch (error) { out.push(/candidateSql needs a keyed page read/.test(String(error.message)) ? 'refused' : `failed: ${error.message}`) } }
    return out
  }
  await check('FAIL CLOSED: a candidate list the read cannot honour (no keyed page, no family members) is refused, never dropped', async () => {
    assert.deepEqual(await narrowOutcomes(base), ['refused', 'refused', 'refused'])
    const ok = await run(base, 'candidates', 'cream')
    assert.ok(ok.result.items.length > 0, 'the honoured form still runs')
  })

  // ---- the route glue ---------------------------------------------------------------------------------------------------------------------------------------------------
  const glueFor = (patches = []) => {
    let text = sources('src/routes/products.ts')
    const start = text.indexOf('export function searchCandidateRead'), end = text.indexOf('\n}\n', start) + 3
    assert.ok(start > 0 && end > start, 'searchCandidateRead found')
    let fn = text.slice(start, end).replace('export function', 'function')
    for (const patch of patches) { assert.equal(fn.split(patch.from).length - 1, 1, patch.from); fn = fn.replace(patch.from, patch.to) }
    const out = ts.transpileModule(fn, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } }).outputText
    return new Function(`${out}; return searchCandidateRead`)()
  }
  const glueCases = (read) => {
    const filters = { candidates: { idsSql: 'SELECT 1', matchRankSql: 'r' }, searchWhereClause: 'S', matchRankSql: 'm' }
    return [
      JSON.stringify(read(filters, ['a', 'S', 'b'])),
      String(read({ ...filters, candidates: undefined }, ['a', 'S'])),
      String(read(filters, ['a', 'b'])),
      String(read(filters, ['S', 'S'])),
      String(read({ ...filters, matchRankSql: undefined }, ['S'])),
      String(read({ ...filters, candidates: { idsSql: 'SELECT 1' } }, ['S'])),
      String(read({ ...filters, searchWhereClause: undefined }, ['S'])),
    ]
  }
  await check('ROUTE GLUE: searchCandidateRead replaces exactly one search term and refuses a missing term, a doubled term, a missing source and a rank that differs', async () => {
    assert.deepEqual(glueCases(glueFor()), ['{"idsSql":"SELECT 1","matchRankSql":"r","where":["a","1 = 1","b"]}', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined'])
  })

  // ---- mutants ----------------------------------------------------------------------------------------------------------------------------------------------------------
  const MUTANTS = [
    // (A plain drop of the terminal key is unobservable here: the grouped input already arrives in key order and SQLite sorts stably, so the reversed key is the mutant that can be caught.)
    ['reversed terminal tie-break of the page ranking', [{ file: 'src/lib/familyPagination.ts', from: 'ORDER BY ${familyOrderSql}, family_root_id ASC\n      LIMIT @__familyPageSize', to: 'ORDER BY ${familyOrderSql}, family_root_id DESC\n      LIMIT @__familyPageSize' }]],
    ['miscounted total', [{ file: 'src/lib/familyPagination.ts', from: 'SELECT *, COUNT(*) OVER () AS family_total', to: 'SELECT *, COUNT(*) OVER () + 1 AS family_total' }]],
    ['wrong count on a page past the end', [{ file: 'src/lib/familyPagination.ts', from: '${countCtes} SELECT COUNT(*) AS count FROM families', to: '${countCtes} SELECT COUNT(*) + 1 AS count FROM families', count: 2 }]],
    ['dropped code-trigram source', [{ file: 'src/lib/productSearchQuery.ts', from: "sources.push(`SELECT rowid AS id, NULL AS r FROM products_fts_code WHERE products_fts_code MATCH @${prefix}codeQuery`)", to: '' }]],
    ['dropped name-trigram source', [{ file: 'src/lib/productSearchQuery.ts', from: "sources.push(`SELECT rowid AS id, NULL AS r FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @${prefix}nameCodeQuery`)", to: '' }]],
    ['dropped normalized catch-all', [{ file: 'src/lib/productSearchQuery.ts', from: '@${paramName}Pair = 0 AND', to: '@${paramName}Pair = 7 AND' }]],
    ['UPC branch seeks the zero-preserving form', [{ file: 'src/lib/productSearchQuery.ts', from: "IN (ltrim(${upcA}, '0'), ltrim(${upcE}, '0'))", to: 'IN (${upcA}, ${upcE})' }]],
    ['lost bm25 rank', [{ file: 'src/lib/productSearchQuery.ts', from: 'candidateRankSql = `COALESCE(${PRODUCT_SEARCH_CANDIDATE_ALIAS}.r, 0)`', to: 'candidateRankSql = `0`' }]],
    ['dropped the other WHERE terms (active, brand, promo)', [{ file: 'src/lib/familyPagination.ts', from: '${opts.joinSql}\n      ${opts.whereSql}\n    ),', to: '${opts.joinSql}\n      WHERE 1 = 1\n    ),' }]],
    ['family rank takes the worst row instead of the best', [{ file: 'src/lib/familyPagination.ts', from: "', MIN(__match_rank) AS match_rank'", to: "', MAX(__match_rank) AS match_rank'" }]],
    ['ranked-id candidates ignore the list', [{ file: 'src/lib/productSearchQuery.ts', from: "idsSql: `SELECT CAST(value AS INTEGER) AS id, NULL AS r FROM json_each(@${prefix}rankIdList)`", to: 'idsSql: `SELECT id, NULL AS r FROM products`' }]],
    ['UPC pair drops the zero-preserving digits filter', [{ file: 'src/lib/productSearchQuery.ts', from: ' AND ${normalizedBarcodeDigitsSql(column)} IN (${upcA}, ${upcE})', to: '' }]],
    ["candidate branch orders by the parent's created date", [{ file: 'src/lib/familyPagination.ts', from: 'p.created_at AS __created_at${matchRankSelect}${matchTierSelect}${promotedSelect}${sortValueSelect}${numericSortSelect}\n      FROM (${opts.candidateSql})', to: 'COALESCE(parent.created_at, p.created_at) AS __created_at${matchRankSelect}${matchTierSelect}${promotedSelect}${sortValueSelect}${numericSortSelect}\n      FROM (${opts.candidateSql})' }]],
    ['candidate FTS source ranks with the default bm25 weights', [{ file: 'src/lib/productSearchQuery.ts', from: "${titleOnly ? 'NULL' : PRODUCTS_FTS_BM25_SQL} AS r FROM", to: "${titleOnly ? 'NULL' : 'bm25(products_fts)'} AS r FROM" }]],
  ]
  for (const [label, patches] of MUTANTS) {
    await check(`MUTANT is caught: ${label}`, async () => {
      let mutated
      try { mutated = await battery(loadSearch(patches), 'candidates') } catch (error) { return }   // a statement that no longer runs is also a red test
      assert.ok(mutated.some((json, index) => json !== reference[index]), `no comparison noticed the mutant "${label}"`)
    })
  }
  await check('MUTANT is caught: the non-FTS sources no longer skip the FTS ids', async () => {
    const patch = [{ file: 'src/lib/productSearchQuery.ts', from: "return ftsQueryParam ? ` ${idColumn} NOT IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @${ftsQueryParam})` : ''", to: "return ' 1 = 1'" }]
    const { rows, ftsIds } = candidateRows(loadSearch(patch), 'zzbarcode')
    const id = raw.prepare("SELECT id FROM products WHERE name = 'zzbarcode'").get().id
    assert.ok(ftsIds.has(id) && rows.filter((r) => r.id === id).length > 1, 'without the skip the product is listed more than once')
  })
  await check('MUTANT is caught: narrowRead fails open again', async () => {
    const patch = [{ file: 'src/lib/familyPagination.ts', from: "if (opts.candidateSql && (!keyedPage || !opts.familyMemberBaseWhereSql)) throw new Error('candidateSql needs a keyed page read (seekPage or the ranked scope) and familyMemberBaseWhereSql: the search term is already gone from whereSql')\n  return opts", to: 'return opts.candidateSql && (!keyedPage || !opts.familyMemberBaseWhereSql) ? { ...opts, candidateSql: undefined } : opts' }]
    assert.notDeepEqual(await narrowOutcomes(loadSearch(patch)), ['refused', 'refused', 'refused'])
  })
  await check('MUTANT is caught: searchCandidateRead accepts a doubled search term', async () => {
    assert.notDeepEqual(glueCases(glueFor([{ from: '!== 1) return undefined', to: '< 1) return undefined' }])), glueCases(glueFor()))
  })
  await check('MUTANT is caught: searchCandidateRead ignores a rank mismatch', async () => {
    assert.notDeepEqual(glueCases(glueFor([{ from: 'Boolean(candidates.matchRankSql) !== Boolean(filters.matchRankSql)', to: 'false' }])), glueCases(glueFor()))
  })

  console.log(`\n${passed} checks passed`)
})().catch((error) => { console.error(error); process.exit(1) })
