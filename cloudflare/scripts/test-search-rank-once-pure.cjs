// I4-1: the product-search bm25 rank is computed ONCE per statement.
//
// It used to be a correlated scalar subquery
//   COALESCE((SELECT bm25(...) FROM products_fts
//             WHERE products_fts.rowid = p.id AND products_fts MATCH @ftsQuery), 0)
// which re-ran the whole FTS MATCH for every candidate row -- 216-358 ms per
// statement for a common word on the seeded lab DB. lib/productSearchQuery.ts
// now emits `rankCteSql` (a MATERIALIZED CTE holding every hit's rank) and a
// per-row lookup into it; lib/familyPagination.ts places the CTE.
//
// This test proves, against real SQLite with every migration applied:
//   1. the SQL shape (no per-row MATCH; the CTE carries the only MATCH);
//   2. the plan (no correlated subquery touches products_fts);
//   3. IDENTICAL rows, in identical order, to the old correlated form across
//      a range of queries (common word, prefix, OR mode, barcode, trigram-only
//      hits that rank 0, multi-page);
//   4. every route that passes matchRankSql to paginateProductFamilies also
//      passes rankCteSql (the CTE is not optional: without it the statement
//      fails loudly, which is also asserted).
//
// Run: node scripts/test-search-rank-once-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const moneyPrecision = require('../src/lib/moneyPrecision.ts')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const cache = new Map()
function loadReal(relPath, deps = {}) {
  if (cache.has(relPath)) return cache.get(relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(root, relPath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => {
    if (id.replace(/\.ts$/, '') === './moneyPrecision') return moneyPrecision
    if (Object.prototype.hasOwnProperty.call(deps, id)) return deps[id]
    throw new Error(`unmapped require(${id}) from ${relPath}`)
  }, mod)
  cache.set(relPath, mod.exports)
  return mod.exports
}
const searchMatch = loadReal('src/lib/searchMatch.ts')
const { buildProductSearchQuery, buildFamilyRelevanceOrderSql, FTS_RANK_CTE_NAME } = loadReal('src/lib/productSearchQuery.ts', { './searchMatch': searchMatch })
const { paginateProductFamilies } = loadReal('src/lib/familyPagination.ts', {})
const { PRODUCTS_FTS_BM25_SQL, normalizeSearchText } = searchMatch

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

// --- fixture: many products sharing words, so bm25 genuinely differs ----
const db = openDb(loadAll())
const raw = db.db
raw.exec("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)")
const insert = raw.prepare(`INSERT INTO products
  (id, name, sku, barcode, brand, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active, name_normalized)
  VALUES (?, ?, ?, ?, ?, ?, 'pcs', 5, 1, 0, 1, ?)`)
const words = ['Glow', 'Rose', 'Matte', 'Serum', 'Cream', 'Robust', 'Glowing', 'Rosa']
let id = 1000
for (let i = 0; i < 120; i += 1) {
  // Deterministic, varied names: repeat counts and lengths differ per row so
  // bm25 scores differ, and several rows share a name (real families).
  const a = words[i % words.length], b = words[(i * 3 + 1) % words.length]
  const name = `${a} ${b} ${i % 4 === 0 ? a : ''} Item ${Math.floor(i / 2)}`.replace(/\s+/g, ' ')
  const brand = i % 5 === 0 ? 'GlowCo' : 'Other'
  insert.run(id, name, `SKU-${id}`, `88000000${String(id).padStart(5, '0')}`, brand, i % 2 ? 'Face' : 'Lip', normalizeSearchText(name))
  id += 1
}
// A trigram-only hit (fused token): matches "glow" by substring, not by FTS
// word, so its rank must COALESCE to 0 in both forms.
insert.run(id, 'Superglowx Balm', 'SKU-X', '8800000099999', 'Other', 'Face', normalizeSearchText('Superglowx Balm'))
raw.exec("UPDATE products SET name_key = lower(trim(name)) WHERE COALESCE(name_key, '') = ''")

const OLD_RANK = (prefix = '') => `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @${prefix}ftsQuery), 0)`

async function page(rawQuery, { pageNo = 1, pageSize = 15, mode, old = false } = {}) {
  const params = {}
  const q = buildProductSearchQuery(rawQuery, params, { mode })
  const where = ['p.is_active = 1']
  if (q.whereClause) where.push(q.whereClause)
  let matchRankSql = q.matchRankSql
  if (old && q.rankCteSql) matchRankSql = matchRankSql.replace(q.matchRankSql.match(/COALESCE\(\(SELECT __fts_rank[\s\S]*?\), 0\)/)[0], OLD_RANK())
  const result = await paginateProductFamilies({
    db,
    selectColumns: 'p.id, p.name, p.brand',
    joinSql: '',
    whereSql: `WHERE ${where.join(' AND ')}`,
    params,
    page: pageNo,
    pageSize,
    familyOrderSql: buildFamilyRelevanceOrderSql('family_name ASC', { hasTier: Boolean(q.matchTierSql), hasRank: Boolean(matchRankSql) }),
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
    matchRankSql,
    rankCteSql: old ? undefined : q.rankCteSql,
    matchTierSql: q.matchTierSql,
  })
  return { q, result }
}

;(async () => {
  await check('SQL shape: rank reads the CTE; the CTE holds the only products_fts MATCH', async () => {
    const q = buildProductSearchQuery('glow', {})
    assert.ok(q.rankCteSql, 'a ranked search must emit rankCteSql')
    assert.ok(!/products_fts\.rowid = p\.id/.test(q.matchRankSql), 'matchRankSql must not correlate products_fts to p.id')
    assert.ok(!/MATCH/.test(q.matchRankSql), 'matchRankSql must not carry a MATCH')
    assert.ok(new RegExp(`^${FTS_RANK_CTE_NAME} AS MATERIALIZED \\(SELECT rowid AS id, bm25\\(`).test(q.rankCteSql), q.rankCteSql)
    assert.equal((q.rankCteSql.match(/MATCH/g) || []).length, 1)
  })

  await check('SQL shape: unranked searches emit no CTE (title-only, barcode-only)', async () => {
    assert.equal(buildProductSearchQuery('glow', {}, { titleOnly: true }).rankCteSql, undefined)
    assert.equal(buildProductSearchQuery('', {}).rankCteSql, undefined)
  })

  await check('plan: no correlated subquery scans products_fts (old form does -- control)', async () => {
    const plansFor = async (old) => {
      const captured = []
      const spyDb = { ...db, batch: async (stmts) => { captured.push(...stmts); return db.batch(stmts) } }
      const params = {}
      const q = buildProductSearchQuery('glow', params)
      const rank = old ? OLD_RANK() : q.matchRankSql
      await paginateProductFamilies({ db: spyDb, selectColumns: 'p.id, p.name', joinSql: '', whereSql: `WHERE ${q.whereClause}`, params, page: 1, pageSize: 10, familyOrderSql: 'match_rank ASC, family_name ASC', intraFamilyOrderSql: 'id ASC', matchRankSql: rank, rankCteSql: old ? undefined : q.rankCteSql })
      const s = captured[0]
      const names = [...new Set([...s.sql.matchAll(/@(\w+)/g)].map((m) => m[1]))]
      const bind = Object.fromEntries(names.map((n) => [n, s.params[n] ?? null]))
      return raw.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).all(bind).map((r) => r.detail).join(' | ')
    }
    const oldPlan = await plansFor(true)
    const newPlan = await plansFor(false)
    assert.ok(/CORRELATED SCALAR SUBQUERY[^|]*\| SCAN products_fts VIRTUAL TABLE/.test(oldPlan), `control: old plan should correlate products_fts: ${oldPlan}`)
    assert.ok(!/CORRELATED SCALAR SUBQUERY[^|]*\| SCAN products_fts VIRTUAL TABLE/.test(newPlan), `new plan still correlates products_fts: ${newPlan}`)
    assert.ok(/MATERIALIZE __fts_rank/.test(newPlan), newPlan)
  })

  const probes = [
    ['glow', {}], ['ro', {}], ['rose glow', {}], ['glow rose', { mode: 'OR' }], ['cream', { pageNo: 2 }],
    ['robu', {}], ['8800000001005', {}], ['item 7', {}], ['glow', { pageNo: 3 }], ['matte serum item', {}],
  ]
  for (const [term, opts] of probes) {
    await check(`identical rows vs old correlated rank: "${term}" ${JSON.stringify(opts)}`, async () => {
      const a = await page(term, { ...opts, old: true })
      const b = await page(term, opts)
      assert.ok(a.result.items.length > 0, 'probe must return rows or it proves nothing')
      assert.equal(JSON.stringify(b.result), JSON.stringify(a.result))
    })
  }

  await check('discriminates: bm25 decides the order on this fixture (so identity is not vacuous)', async () => {
    // "item" is in every name but never its prefix: every family is tier 3,
    // so only the rank separates them from plain family_name order.
    const ranked = (await page('item')).result.items.map((r) => r.id)
    const params = {}
    const q = buildProductSearchQuery('item', params)
    const az = await paginateProductFamilies({ db, selectColumns: 'p.id, p.name, p.brand', joinSql: '', whereSql: `WHERE p.is_active = 1 AND ${q.whereClause}`, params, page: 1, pageSize: 15, familyOrderSql: buildFamilyRelevanceOrderSql('family_name ASC', { hasTier: true, hasRank: false }), intraFamilyOrderSql: 'lower(name) ASC, id ASC', matchTierSql: q.matchTierSql })
    assert.notEqual(JSON.stringify(ranked), JSON.stringify(az.items.map((r) => r.id)))
  })

  await check('trigram-only hit still returned with rank 0 (COALESCE path)', async () => {
    const all = await page('glow', { pageSize: 500 })
    assert.ok(all.result.items.some((r) => r.name === 'Superglowx Balm'))
  })

  await check('omitting rankCteSql fails loudly, never a silent wrong order', async () => {
    const params = {}
    const q = buildProductSearchQuery('glow', params)
    await assert.rejects(() => paginateProductFamilies({ db, selectColumns: 'p.id, p.name', joinSql: '', whereSql: `WHERE ${q.whereClause}`, params, page: 1, pageSize: 5, familyOrderSql: 'match_rank ASC', intraFamilyOrderSql: 'id ASC', matchRankSql: q.matchRankSql }), /__fts_rank/)
  })

  await check('every route passing matchRankSql to paginateProductFamilies also passes rankCteSql', async () => {
    const routes = ['products.ts', 'inventory.ts', 'branches.ts', 'portal.ts']
    for (const file of routes) {
      const src = fs.readFileSync(path.join(root, 'src/routes', file), 'utf8')
      // Each call's argument text, by paren balance from its opening "(".
      const calls = src.split('paginateProductFamilies').slice(1).map((chunk) => {
        const start = chunk.indexOf('(')
        let depth = 0
        for (let i = start; i < chunk.length; i += 1) {
          if (chunk[i] === '(') depth += 1
          if (chunk[i] === ')' && --depth === 0) return chunk.slice(start, i + 1)
        }
        return chunk
      })
      const ranked = calls.filter((c) => /matchRankSql/.test(c))
      assert.ok(ranked.length > 0, `${file}: expected a ranked paginateProductFamilies call`)
      for (const c of ranked) assert.ok(/rankCteSql/.test(c), `${file}: a paginateProductFamilies call passes matchRankSql without rankCteSql`)
    }
    const others = fs.readdirSync(path.join(root, 'src/routes')).filter((f) => !routes.includes(f) && /\.ts$/.test(f))
    for (const f of others) assert.ok(!/matchRankSql/.test(fs.readFileSync(path.join(root, 'src/routes', f), 'utf8')), `${f} uses matchRankSql: add it to this check`)
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
