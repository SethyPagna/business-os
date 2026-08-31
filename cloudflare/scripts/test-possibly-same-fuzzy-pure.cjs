// D6 (Part 578, item 5): the Products "Duplicates" review sweep must surface
// the "same item, re-typed under a slightly different name, each with its own
// barcode" case the user reported -- products that escape BOTH same_barcode
// (their barcodes differ) and same_name (their exact name_keys differ) but are
// clearly one item once diacritics / punctuation / word-order are ignored.
//
// findPossiblySameProductClusters now emits a third, weakest severity
// (similar_name / type 'similar') for products whose normalizeProductFuzzyName
// key collapses together across >=2 distinct name_keys. It must NOT re-surface
// groups the exact same_name or same_barcode clusters already cover, and a
// dismissal must persist by the fuzzy key.
//
// This loads the REAL lib/productIdentity.ts (+ its real productDetailRule.ts
// dep) transpiled, and runs findPossiblySameProductClusters against a real
// migrated in-memory SQLite (the actual name_key AFTER-INSERT trigger populates
// name_key, so the grouping is exactly production's).
//
// Run (from cloudflare/): node scripts/test-possibly-same-fuzzy-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

// --- Load the real lib modules (transpile + shimmed require) --------------
function loadTs(relPath, requireShim) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const mod = { exports: {} }
  const req = (id) => (requireShim && requireShim[id] !== undefined ? requireShim[id] : require(id))
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, req)
  return mod.exports
}

const detailRule = loadTs('lib/productDetailRule.ts', {})
check('productDetailRule exports normalizeProductFuzzyName', typeof detailRule.normalizeProductFuzzyName === 'function')

const identity = loadTs('lib/productIdentity.ts', {
  './db': {},
  './sqlBinding': { buildInClause: () => ({ sql: '', params: {} }), selectInChunks: async () => [] },
  './productDetailRule': detailRule,
})
const { findPossiblySameProductClusters, normalizeProductClusterKey } = identity
check('productIdentity exports findPossiblySameProductClusters', typeof findPossiblySameProductClusters === 'function')

// --- Seed a real DB with every path the sweep must distinguish -------------
const rawDb = openDb(loadAll())
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return { get: (p) => stmt.get(p), all: (p) => stmt.all(p) ?? [], run: (p) => stmt.run(p) }
  },
}

// name_key is left to the real AFTER-INSERT trigger (lower(trim(name))).
const products = [
  // similar_name: punctuation-only rename, different barcodes.
  { id: 1, name: 'Anastasia Setting Spray', barcode: 'BAR-AAA1' },
  { id: 2, name: 'Anastasia Setting-Spray', barcode: 'BAR-BBB2' },
  // same_name: identical name_key, different barcodes (must NOT also appear as similar).
  { id: 3, name: 'Face Cream', barcode: 'BAR-CCC3' },
  { id: 4, name: 'Face Cream', barcode: 'BAR-DDD4' },
  // same_barcode: fuzzy-equal names but ONE shared real barcode (must NOT also appear as similar).
  { id: 5, name: 'Blush Powder', barcode: 'SHARE-9999' },
  { id: 6, name: 'Blush-Powder', barcode: 'SHARE-9999' },
  // similar_name: diacritics + case rename, different barcodes.
  { id: 7, name: 'Café Crème', barcode: 'BAR-E111' },
  { id: 8, name: 'Cafe Creme', barcode: 'BAR-E222' },
  // negative: a lone product forms no cluster.
  { id: 9, name: 'Solo Item', barcode: 'BAR-SOLO' },
]
for (const p of products) {
  db.prepare(`INSERT INTO products (id, name, barcode, is_active, is_group) VALUES (@id, @name, @barcode, 1, 0)`)
    .run({ id: p.id, name: p.name, barcode: p.barcode })
}

const idsOf = (cluster) => cluster.products.map((x) => x.id).sort((a, b) => a - b).join(',')
const findCluster = (clusters, sev, ids) => clusters.find((c) => c.severity === sev && idsOf(c) === ids)

async function run() {
  const clusters = await findPossiblySameProductClusters(db)

  // The two genuine renames surface as similar_name.
  check('Anastasia punctuation rename surfaces as similar_name (ids 1,2)',
    !!findCluster(clusters, 'similar_name', '1,2'))
  check('Café/Cafe diacritic rename surfaces as similar_name (ids 7,8)',
    !!findCluster(clusters, 'similar_name', '7,8'))

  // Exact same_name pair stays same_name and is NOT duplicated as similar.
  check('Face Cream pair is a same_name cluster (ids 3,4)', !!findCluster(clusters, 'same_name', '3,4'))
  check('Face Cream pair is NOT also a similar_name cluster',
    !clusters.some((c) => c.severity === 'similar_name' && idsOf(c) === '3,4'))

  // Shared-barcode fuzzy pair stays same_barcode and is NOT duplicated as similar.
  check('Blush shared-barcode pair is a same_barcode cluster (ids 5,6)', !!findCluster(clusters, 'same_barcode', '5,6'))
  check('Blush shared-barcode pair is NOT also a similar_name cluster',
    !clusters.some((c) => c.severity === 'similar_name' && idsOf(c) === '5,6'))

  // The lone product forms no cluster of any kind.
  check('Solo product (id 9) appears in no cluster',
    !clusters.some((c) => c.products.some((x) => x.id === 9)))

  // Worst-first ordering holds across all three severities.
  const rank = { same_barcode: 0, same_name: 1, similar_name: 2 }
  const seq = clusters.map((c) => rank[c.severity])
  check('clusters sorted worst-first (barcode < name < similar)',
    seq.every((v, i) => i === 0 || seq[i - 1] <= v))

  // A similar cluster's value is a human-readable display name, not the raw key.
  const anastasia = findCluster(clusters, 'similar_name', '1,2')
  check("similar cluster value is a display name (one of the members' names)",
    products.some((p) => p.name === anastasia.value))

  // Dismissal keys by the FUZZY key and persists: dismissing 1,2 removes only it.
  const fuzzyKey = normalizeProductClusterKey('similar', 'Anastasia Setting-Spray')
  check("normalizeProductClusterKey('similar', name) yields the fuzzy key",
    fuzzyKey === detailRule.normalizeProductFuzzyName('Anastasia Setting Spray'))
  db.prepare(`INSERT INTO product_duplicate_dismissals (cluster_type, cluster_value) VALUES ('similar', @v)`).run({ v: fuzzyKey })

  const after = await findPossiblySameProductClusters(db)
  check('dismissing the Anastasia similar cluster removes it',
    !after.some((c) => c.severity === 'similar_name' && idsOf(c) === '1,2'))
  check('dismissing Anastasia does NOT remove the Café/Cafe similar cluster',
    after.some((c) => c.severity === 'similar_name' && idsOf(c) === '7,8'))

  // Regression guard for the shared dismissKey refactor: the pre-existing
  // same_name / same_barcode dismissals must still work through the same helper.
  db.prepare(`INSERT INTO product_duplicate_dismissals (cluster_type, cluster_value) VALUES ('name', @v)`)
    .run({ v: normalizeProductClusterKey('name', 'Face Cream') })
  db.prepare(`INSERT INTO product_duplicate_dismissals (cluster_type, cluster_value) VALUES ('barcode', @v)`)
    .run({ v: normalizeProductClusterKey('barcode', 'SHARE-9999') })
  const after2 = await findPossiblySameProductClusters(db)
  check('dismissing the Face Cream same_name cluster removes it',
    !after2.some((c) => c.severity === 'same_name' && idsOf(c) === '3,4'))
  check('dismissing the SHARE-9999 same_barcode cluster removes it',
    !after2.some((c) => c.severity === 'same_barcode' && idsOf(c) === '5,6'))

  console.log(`\nAll ${checks} checks passed.`)
}

run().catch((e) => { console.error(e); process.exit(1) })
