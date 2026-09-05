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
const { findPossiblySameProductClusters, findDuplicateProductGroups, normalizeProductClusterKey, normalizeLeadingZeroBarcodeForCleanup } = identity
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
  // Safe cleanup pair: same exact name/cost, one extra barcode zero. The
  // extra-zero row has stock, but the clean-barcode row must still survive;
  // the fold moves the stock. Selling price is not identity.
  { id: 10, name: 'Zero Prefix Mascara', barcode: '0123456789' },
  { id: 11, name: 'Zero Prefix Mascara', barcode: '123456789' },
  // Same barcode under different names stays manual and never auto-merges.
  { id: 12, name: 'Manual Shade A', barcode: 'MANUAL-42' },
  { id: 13, name: 'Manual Shade B', barcode: 'MANUAL-42' },
  // Overlap guard: 14/15 look auto-safe, but 14's raw barcode is also used by
  // a different name, so the entire decision must stay manual.
  { id: 14, name: 'Overlap Product', barcode: '077777' },
  { id: 15, name: 'Overlap Product', barcode: '77777' },
  { id: 16, name: 'Different Name Sharing Raw Barcode', barcode: '077777' },
  // N15: the owner's case. One exact name, one real barcode written twice --
  // once with an extra leading zero -- and two DIFFERENT costs. Before the
  // leading_zero class existed this arrived as an ordinary same_name cluster,
  // indistinguishable from ids 19/20 below, and the tab's bulk gate then
  // refused it because the costs differ.
  { id: 17, name: 'Zero Twin Diff Cost', barcode: '03614274226546', cost: 5 },
  { id: 18, name: 'Zero Twin Diff Cost', barcode: '3614274226546', cost: 7.9 },
  // NEGATIVE CONTROL, same shape: one exact name, two genuinely different
  // barcodes. Must stay same_name and must never become leading_zero.
  { id: 19, name: 'Real Two Skus', barcode: '1111111111111' },
  { id: 20, name: 'Real Two Skus', barcode: '2222222222222' },
  // The MAC shade pair: raw '0601' is 4 chars so the RAW barcode bucket sees
  // it, but the folded form is 3 -- below MIN_REAL_BARCODE_LENGTH. The sweep
  // must still class it, which is why the leading-zero bucket uses the fold's
  // own 3-digit floor and not the raw one.
  { id: 21, name: 'Mac Shade', barcode: '0601' },
  { id: 22, name: 'Mac Shade', barcode: '601' },
  // Placeholder guard: '0' and '00' must NEVER cluster with each other or
  // with the unbarcoded row -- 238 production rows carry the placeholder.
  { id: 23, name: 'Placeholder Row', barcode: '0' },
  { id: 24, name: 'Placeholder Row', barcode: '00' },
  { id: 25, name: 'Placeholder Row', barcode: null },
]
for (const p of products) {
  db.prepare(`INSERT INTO products (id, name, barcode, cost_price_usd, is_active, is_group) VALUES (@id, @name, @barcode, @cost, 1, 0)`)
    .run({ id: p.id, name: p.name, barcode: p.barcode, cost: p.cost ?? 0 })
}
db.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Main', 1)`).run({})
db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 7)`).run({})

const idsOf = (cluster) => cluster.products.map((x) => x.id).sort((a, b) => a - b).join(',')
const findCluster = (clusters, sev, ids) => clusters.find((c) => c.severity === sev && idsOf(c) === ids)

async function run() {
  check('cleanup normalization removes every numeric leading zero (idempotent)',
    normalizeLeadingZeroBarcodeForCleanup('0123456789') === '123456789')
  check('placeholder barcode 0 is not normalized into a blank barcode',
    normalizeLeadingZeroBarcodeForCleanup('0') === '0')

  const duplicateGroups = await findDuplicateProductGroups(db)
  const zeroPrefix = duplicateGroups.find((group) => [group.canonical.id, ...group.duplicates.map((x) => x.id)].sort((a, b) => a - b).join(',') === '10,11')
  check('same-name/same-cost pair differing only by one leading barcode zero is auto-mergeable', !!zeroPrefix)
  check('clean-barcode row is selected as keeper and will receive stock from the typo row', zeroPrefix?.canonical.id === 11)
  check('same barcode under different names remains manual',
    !duplicateGroups.some((group) => [group.canonical.id, ...group.duplicates.map((x) => x.id)].some((id) => id === 12 || id === 13)))
  check('manual classification wins when a leading-zero pair overlaps a same-barcode/different-name conflict',
    !duplicateGroups.some((group) => [group.canonical.id, ...group.duplicates.map((x) => x.id)].some((id) => id === 14 || id === 15)))

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

  // --- N15: the leading-zero class -------------------------------------
  // DISCRIMINATING. Before this class the sweep bucketed by the RAW barcode,
  // so 17/18 and 19/20 both came back `same_name` and the reviewer had no way
  // to tell the owner's merge case from two genuinely different SKUs.
  check('a leading-zero twin under one name is its own class, whatever the costs',
    !!findCluster(clusters, 'leading_zero', '17,18'))
  check('the leading-zero cluster is keyed by the FOLDED barcode',
    findCluster(clusters, 'leading_zero', '17,18').value === '3614274226546')
  check('the same decision is not ALSO shown as a same_name cluster',
    !clusters.some((c) => c.severity === 'same_name' && idsOf(c) === '17,18'))
  check('NEGATIVE CONTROL: two genuinely different barcodes stay same_name',
    !!findCluster(clusters, 'same_name', '19,20'))
  check('NEGATIVE CONTROL: two genuinely different barcodes are never leading_zero',
    !clusters.some((c) => c.severity === 'leading_zero' && idsOf(c) === '19,20'))
  check('the MAC shade pair is visible even though the folded code is 3 digits',
    !!findCluster(clusters, 'leading_zero', '21,22'))
  check('placeholder 0/00/blank barcodes never form a leading-zero cluster',
    !clusters.some((c) => c.severity === 'leading_zero' && c.products.some((x) => x.id >= 23)))
  check('an exact-barcode pair is left to same_barcode, not re-reported as leading_zero',
    !clusters.some((c) => c.severity === 'leading_zero' && idsOf(c) === '5,6'))

  // Worst-first ordering holds across all four severities.
  const rank = { leading_zero: 0, same_barcode: 1, same_name: 2, similar_name: 3 }
  const seq = clusters.map((c) => rank[c.severity])
  check('clusters sorted worst-first (leading zero < barcode < name < similar)',
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
  // A leading-zero dismissal keys by the FOLDED barcode, so it can be recorded
  // from EITHER twin's spelling and still match. Keying it raw would have
  // repeated the detector's own defect one layer down.
  db.prepare(`INSERT INTO product_duplicate_dismissals (cluster_type, cluster_value) VALUES ('leadingzero', @v)`)
    .run({ v: normalizeProductClusterKey('leadingzero', '03614274226546') })
  check("normalizeProductClusterKey('leadingzero', ...) folds either spelling to one key",
    normalizeProductClusterKey('leadingzero', '03614274226546') === normalizeProductClusterKey('leadingzero', '3614274226546'))
  const after2 = await findPossiblySameProductClusters(db)
  check('dismissing the leading-zero cluster from the zero-padded spelling removes it',
    !after2.some((c) => c.severity === 'leading_zero' && idsOf(c) === '17,18'))
  check('dismissing it does NOT remove the MAC shade leading-zero cluster',
    after2.some((c) => c.severity === 'leading_zero' && idsOf(c) === '21,22'))
  check('dismissing the Face Cream same_name cluster removes it',
    !after2.some((c) => c.severity === 'same_name' && idsOf(c) === '3,4'))
  check('dismissing the SHARE-9999 same_barcode cluster removes it',
    !after2.some((c) => c.severity === 'same_barcode' && idsOf(c) === '5,6'))

  console.log(`\nAll ${checks} checks passed.`)
}

run().catch((e) => { console.error(e); process.exit(1) })
