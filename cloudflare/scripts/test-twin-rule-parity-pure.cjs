'use strict'
// Owner, 16 Nov 2026 (lead decision, Option A): "twin" is ONE definition on both sides. A twin is a cluster of two or more same-name products
// under the owner's identity rule of 15 Sep 2026: same-name products are the SAME product unless they carry two genuinely different real barcodes
// (or a damage/condition tag separates them -- a tag lives in the product name or on a stock lot, so a tagged row is a different name or not a
// product row at all). An empty, word-like, short or placeholder barcode never separates them; codes that differ only in leading zeros are one.
//
// The Worker's definition is clusterRowsByBarcodeIdentity (lib/productDetailRule.ts), which the auto-merge detector uses. The client carries a
// byte-identical copy (frontend/src/utils/productDetailRule.ts, only the moneyPrecision import line differs) and builds the Duplicate tag, the open
// state of a name group and the scan hit from unmergedTwinKeys (frontend/src/utils/productGrouping.ts). This test runs BOTH over one table:
//   1. the two rule files are identical;
//   2. for every row of the table the Worker's clusters and the client's twin keys give the same partition, equal to the expected one. The Worker side
//      is its REAL auto-merge detector (findDuplicateProductGroups on a real migrated SQLite, one case at a time), next to a copy of the rule applied
//      the same way; a name is compared as the server's name_key, lower(trim(name)), so two names that differ only in inner spaces are two names;
//   3. every cluster the client tags is listed by the Conflicts sweep (findPossiblySameProductClusters on the same SQLite), so the tag's
//      "Merge it in the Conflicts tab" is always true; a pair that is not tagged is listed exactly as today (the inner-space pairs below);
//   3b. a scan never picks between two different real barcodes (two UPC-A and two UPC-E rows under one name are two clusters, so no hit);
//   4. under every input order the client places a tagged cluster side by side (the server ORDER BY is measured alongside, see ORDER below);
//   5. mutants: the old "same-name pairs sharing a code of 4 or more characters" sweep, the old real-barcode-only client rule, a name-only rule, a raw
//      name, and a drifted copy of the rule on either side each turn it red.
// Fixtures are synthetic.
//
// Run (from cloudflare/): node scripts/test-twin-rule-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { build } = require('esbuild')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const cloudflare = path.join(__dirname, '..')
const frontend = path.join(cloudflare, '..', 'frontend')
const norm = (p) => p.split(path.sep).join('/')

// ---- the table ------------------------------------------------------------------------------------------------------------------------------
// rows: [barcode, extra]; expect: per row, 0 for no twin, else the number of its cluster within the case. Each case is its own name so one database holds them all.
const REAL = '8851234567890'
const OTHER = '8859999999999'
const KHMER = '៨៨៥១២៣៤៥៦៧៨៩០' // the same digits in Khmer numerals: not [0-9], so not a real barcode
const UPCA = '012345000065'
const UPCE = '01234565' // the UPC-E form of the UPC-A code above: a scan of either finds both, yet they are two identities
const CASES = [
  { label: 'real/real same', rows: [[REAL], [REAL]], expect: [1, 1] },
  { label: 'real/real leading zero', rows: [[REAL], ['0' + REAL]], expect: [1, 1] },
  { label: 'real/real different', rows: [[REAL], [OTHER]], expect: [0, 0] },
  { label: 'real/empty', rows: [[REAL], ['']], expect: [1, 1] },
  { label: 'real/null', rows: [[REAL], [null]], expect: [1, 1] },
  { label: 'real/blank spaces', rows: [[REAL], ['   ']], expect: [1, 1] },
  { label: 'empty/empty', rows: [[''], ['']], expect: [1, 1] },
  { label: 'empty/null', rows: [[''], [null]], expect: [1, 1] },
  { label: 'word/word same', rows: [['NoBox188'], ['NoBox188']], expect: [1, 1] },
  { label: 'word/word different', rows: [['NoBox188'], ['BrowWizTaupe']], expect: [1, 1] },
  { label: '12345/12346', rows: [['12345'], ['12346']], expect: [1, 1] },
  { label: '12345/12345', rows: [['12345'], ['12345']], expect: [1, 1] },
  { label: 'real/word', rows: [[REAL], ['Mask']], expect: [1, 1] },
  { label: '0/0', rows: [['0'], ['0']], expect: [1, 1] },
  { label: '0/00 placeholders', rows: [['0'], ['00']], expect: [1, 1] },
  { label: 'real/0', rows: [[REAL], ['0']], expect: [1, 1] },
  { label: 'MAC shade 0601/601', rows: [['0601'], ['601']], expect: [1, 1] },
  { label: 'Khmer digits same', rows: [[KHMER], [KHMER]], expect: [1, 1] },
  { label: 'real vs Khmer digits', rows: [[REAL], [KHMER]], expect: [1, 1] },
  { label: 'damage tag in the name', rows: [[REAL, { name: 'Damage Tag (Damaged)' }], [REAL]], expect: [0, 0] },
  { label: 'same code, other name', rows: [[REAL, { name: 'Other Name Entirely' }], [REAL]], expect: [0, 0] },
  { label: 'name spelling (case, edge spaces)', rows: [[REAL, { name: 'Spell Check Name' }], [REAL, { name: '  spell CHECK name ' }]], expect: [1, 1] },
  // The server's name_key keeps inner spaces, so these are two names there. The Latin pair is still listed (the similar-name cluster), the Khmer pair is not (its
  // fuzzy key is empty), which is today's Conflicts; neither is a twin, so no tag is ever put on a pair Conflicts cannot list.
  { label: 'names differ only in inner spaces (Latin)', rows: [['8851111111111', { name: 'Inner  Space Latin' }], ['', { name: 'Inner Space Latin' }]], expect: [0, 0], listed: true },
  { label: 'names differ only in inner spaces (Khmer)', rows: [['8852222222222', { name: 'ក្រែម  លាប' }], ['', { name: 'ក្រែម លាប' }]], expect: [0, 0], listed: false },
  { label: 'the identical Khmer name with inner spaces is a twin', rows: [['8853333333333', { name: 'ក្រែម  លាប ម៉ាស' }], ['', { name: 'ក្រែម  លាប ម៉ាស' }]], expect: [1, 1], listed: true },
  // Two clusters of two under ONE name: the twin key must carry the barcode, or the four rows read as one cluster and a scan of either code would pick one.
  { label: 'two UPC-A rows and two UPC-E rows under one name are two clusters', rows: [[UPCA], [UPCA], [UPCE], [UPCE]], expect: [1, 1, 2, 2] },
  { label: 'a lone row', rows: [[REAL]], expect: [0] },
  { label: 'real A, real B, empty (A holds the stock): the empty row joins A', rows: [[REAL, { stock: 9 }], [OTHER, { stock: 1 }], ['', { stock: 0 }]], expect: [1, 0, 1] },
  { label: 'real A, real B, empty (B holds the stock): the empty row joins B', rows: [[REAL, { stock: 1 }], [OTHER, { stock: 9 }], ['', { stock: 0 }]], expect: [0, 1, 1] },
  { label: 'real A, real B, real A with a zero', rows: [[REAL], [OTHER], ['0' + REAL]], expect: [1, 0, 1] },
  { label: 'real A, real B, word, empty (A holds the stock)', rows: [[REAL, { stock: 9 }], [OTHER], ['Mask'], ['']], expect: [1, 0, 1, 1] },
  { label: 'two real A, one real B', rows: [[REAL], [OTHER], [REAL]], expect: [1, 0, 1] },
  { label: 'inactive twin is not listed by the sweep, so not tagged', rows: [[REAL], [REAL, { active: 0 }]], expect: [0, 0], scope: true },
]
const nameOf = (c, i) => (c.rows[i][1] && c.rows[i][1].name) || `Case ${CASES.indexOf(c)} ${c.label.replace(/[^a-z0-9 ]/gi, '')}`

function world() {
  let id = 0
  const items = []
  for (const c of CASES) {
    c.ids = c.rows.map(() => (id += 1))
    c.rows.forEach(([barcode, extra = {}], i) => {
      items.push({ id: c.ids[i], name: nameOf(c, i), barcode, stock_quantity: extra.stock ?? 0, is_active: extra.active ?? 1, is_group: 0 })
    })
  }
  return items
}
const ITEMS = world()
// The twin clusters a case expects, as sorted id lists.
const clustersOf = (kase) => {
  const byCluster = new Map()
  kase.ids.forEach((id, i) => { if (kase.expect[i]) byCluster.set(kase.expect[i], [...(byCluster.get(kase.expect[i]) || []), id]) })
  return [...byCluster.values()].map((ids) => ids.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0])
}

// ---- bundling with in-memory source patches (mutants) ----------------------------------------------------------------------------------------
async function bundle(entry, patches = [], extra = {}) {
  const applied = new Set()
  const plugin = { name: 'patches', setup(b) {
    b.onLoad({ filter: /\.ts$/ }, (args) => {
      let text = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
      const rel = norm(path.relative(path.join(cloudflare, '..'), args.path))
      for (const p of patches.filter((x) => rel.endsWith(x.file))) {
        if (text.split(p.from).length !== 2) throw new Error(`patch ${p.name}: anchor must occur exactly once in ${rel}`)
        text = text.replace(p.from, () => p.to)
        applied.add(p.name)
      }
      return { contents: text, loader: 'ts' }
    })
  } }
  const out = await build({ entryPoints: [entry], plugins: [plugin], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error', ...extra })
  for (const p of patches) if (!applied.has(p.name)) throw new Error(`patch ${p.name} was not applied`)
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports
}

// ---- the three subjects -----------------------------------------------------------------------------------------------------------------------
// The server's own name_key, computed by SQLite itself: lower(trim(name)) (migration 0010).
const sqliteNameKey = new DatabaseSync(':memory:')
const nameKey = (_api, value) => sqliteNameKey.prepare('SELECT lower(trim(?)) AS k').get(value).k
function workerPartition(rule) {
  // The Worker's rule, a copy of what the detector below runs: one exact-name group at a time, clusters of 2+. The detector itself runs on SQLite in sweepClusters.
  const byName = new Map()
  for (const item of ITEMS) {
    if (!item.is_active || item.is_group) continue
    const key = nameKey(rule, item.name)
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(item)
  }
  const partition = []
  for (const group of byName.values()) {
    if (group.length < 2) continue
    for (const cluster of rule.clusterRowsByBarcodeIdentity(group)) if (cluster.length > 1) partition.push(cluster.map((r) => r.id).sort((a, b) => a - b))
  }
  return partition.sort((a, b) => a[0] - b[0])
}
function clientPartition(grouping) {
  const keys = grouping.unmergedTwinKeys(ITEMS)
  const byKey = new Map()
  ITEMS.forEach((item, index) => { if (keys[index]) { if (!byKey.has(keys[index])) byKey.set(keys[index], []); byKey.get(keys[index]).push(item.id) } })
  return [...byKey.values()].map((ids) => ids.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0])
}
// What a person sees: the row flags the pages read, through the real buildProductGroups.
function clientFlags(grouping, items = ITEMS) {
  const flags = new Map()
  for (const group of grouping.buildProductGroups(items, new Map(), { preserveInputOrder: false })) for (const row of group.rows) flags.set(row.id, Boolean(row.__unmergedTwin))
  return flags
}

// One migrated SQLite holding the whole table. Returns what the Conflicts sweep lists, and, per case, what the REAL auto-merge detector
// (findDuplicateProductGroups) groups when it reads only that case's rows: the detector drops a row that shares a barcode with another exact name, and every case
// shares REAL, so the cases cannot be judged together.
async function sweepClusters(sweepPatches) {
  const identity = await bundle(path.join(cloudflare, 'src/lib/productIdentity.ts'), sweepPatches)
  const raw = openDb(loadAll())
  seedStockFixture(raw, () => raw.prepare("INSERT INTO branches (id, name, is_active) VALUES (1, 'Main', 1)").run({}))
  for (const item of ITEMS) {
    seedStockFixture(raw, () => raw.prepare('INSERT INTO products (id, name, barcode, cost_price_usd, is_active, is_group) VALUES (@id, @name, @barcode, 0, @active, 0)')
      .run({ id: item.id, name: item.name, barcode: item.barcode, active: item.is_active }))
    if (item.stock_quantity > 0) seedStockFixture(raw, () => raw.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, 1, @quantity)').run({ id: item.id, quantity: item.stock_quantity }))
  }
  const db = { prepare(sql) { const stmt = raw.prepare(sql); return { get: (p) => stmt.get(p), all: (p) => stmt.all(p) ?? [], run: (p) => stmt.run(p) } } }
  const clusters = await identity.findPossiblySameProductClusters(db)
  const detector = new Map()
  for (const kase of CASES) {
    // The detector's own SELECT runs on the database; only the rows of other cases are left out of what it reads, because a stocked product cannot be deactivated.
    const only = { prepare(sql) { const stmt = raw.prepare(sql); return { all: (p) => (stmt.all(p) ?? []).filter((row) => kase.ids.includes(Number(row.id))) } } }
    const groups = await identity.findDuplicateProductGroups(only)
    detector.set(kase.label, groups.map((group) => [group.canonical, ...group.duplicates].map((row) => Number(row.id)).sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]))
  }
  return { clusters, detector }
}

// A listed cluster "holds" a twin cluster when it contains every id of it (the Resolve flow's own test, productIdsInOneCluster).
const listed = (clusters, ids) => clusters.some((cluster) => ids.every((id) => cluster.products.some((p) => Number(p.id) === id)))

// ---- one pass of every check, returns the failures --------------------------------------------------------------------------------------------
async function pass({ workerPatches = [], clientPatches = [], sweepPatches = [] } = {}) {
  const failures = []
  const check = async (name, fn) => { try { await fn() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0]}`) } }
  const workerRule = await bundle(path.join(cloudflare, 'src/lib/productDetailRule.ts'), workerPatches)
  const grouping = await bundle(path.join(frontend, 'src/utils/productGrouping.ts'), clientPatches)
  const { clusters, detector } = await sweepClusters([...workerPatches.filter((p) => p.file.endsWith('productDetailRule.ts')), ...sweepPatches])
  const scan = await bundle(path.join(frontend, 'src/utils/scanExactHit.ts'))

  const expected = CASES.flatMap(clustersOf).sort((a, b) => a[0] - b[0])

  await check('the client\'s serverNameKey is SQLite\'s lower(trim(name)) for every name of the table and for the edge cases that tell them apart', () => {
    const names = [...new Set([...ITEMS.map((item) => item.name), '  Glow  Serum ', 'GLOW', 'Crème Éclat', 'crème éclat', '\tglow', 'glow\u00a0', ' ', '', 'ក្រែម  លាប'])]
    for (const name of names) assert.equal(grouping.serverNameKey(name), nameKey(null, name), JSON.stringify(name))
  })
  await check('the Worker clusters give the table\'s partition', () => assert.deepEqual(workerPartition(workerRule), expected))
  await check('the Worker\'s real auto-merge detector (findDuplicateProductGroups on SQLite) gives the table\'s clusters, case by case', () => {
    for (const kase of CASES) assert.deepEqual(detector.get(kase.label), clustersOf(kase), `case "${kase.label}"`)
  })
  await check('the client twin keys give the table\'s partition', () => assert.deepEqual(clientPartition(grouping), expected))
  await check('Worker and client agree row by row, case by case', () => {
    const w = workerPartition(workerRule)
    const c = clientPartition(grouping)
    for (const kase of CASES) {
      const mine = (part) => part.filter((ids) => ids.some((id) => kase.ids.includes(id)))
      assert.deepEqual(mine(c), mine(w), `case "${kase.label}"`)
    }
  })
  await check('the row flags a person sees (buildProductGroups) are the table\'s', () => {
    const flags = clientFlags(grouping)
    for (const kase of CASES) kase.ids.forEach((id, i) => assert.equal(flags.get(id), Boolean(kase.expect[i]), `case "${kase.label}" row ${i}`))
  })
  await check('every tagged cluster is listed by the Conflicts sweep, so "Merge it in the Conflicts tab" is true', () => {
    for (const ids of clientPartition(grouping)) assert.ok(listed(clusters, ids), `tagged ${ids} is not in any Conflicts cluster`)
  })
  await check('a pair the table pins as listed or not listed is exactly that in today\'s Conflicts (inner spaces: the Latin pair through the similar-name cluster, the Khmer pair not at all)', () => {
    for (const kase of CASES.filter((candidate) => 'listed' in candidate)) assert.equal(listed(clusters, kase.ids), kase.listed, `case "${kase.label}"`)
  })
  await check('a scan never picks between two different real barcodes, and a twin cluster is one hit', () => {
    const groupsOf = (kase) => grouping.buildProductGroups(ITEMS.filter((item) => kase.ids.includes(item.id)), new Map(), { preserveInputOrder: false })
    const hit = (kase, code) => scan.findScanHit(groupsOf(kase), (group) => group.rows, code)
    const upc = CASES.find((c) => c.label.startsWith('two UPC-A'))
    assert.equal(hit(upc, UPCA), null, 'a scan of the UPC-A code finds both clusters')
    assert.equal(hit(upc, UPCE), null, 'a scan of the UPC-E code finds both clusters')
    const ab = CASES.find((c) => c.label === 'two real A, one real B')
    assert.equal(hit(ab, REAL)?.row.id, ab.ids[0], 'the two rows of code A are one product: the first is the hit')
    assert.equal(hit(ab, OTHER)?.row.id, ab.ids[1], 'code B has one row')
    const variants = CASES.find((c) => c.label === 'real/real different')
    assert.equal(hit(variants, REAL)?.row.id, variants.ids[0])
    assert.equal(hit(variants, OTHER)?.row.id, variants.ids[1])
  })
  await check('a case the table says is NOT a twin may still be listed (real/real different is a variant pair the sweep also shows)', () => {
    const variants = CASES.find((c) => c.label === 'real/real different')
    assert.ok(listed(clusters, variants.ids), 'the sweep lists the variant pair for a human')
    assert.equal(clientFlags(grouping).get(variants.ids[0]), false, 'but the tag never marks it')
  })
  await check('open state: a group holding a twin cluster starts open, a variants-only group starts folded', () => {
    const visibility = null
    void visibility
    const groups = grouping.buildProductGroups(ITEMS, new Map(), { preserveInputOrder: false })
    const open = (name) => groups.find((g) => g.name.toLowerCase().trim().replace(/\s+/g, ' ') === name.toLowerCase().trim().replace(/\s+/g, ' '))
    const hasTwin = (g) => g.rows.some((r) => r.__unmergedTwin)
    assert.equal(hasTwin(open(nameOf(CASES[3], 0))), true)
    assert.equal(hasTwin(open(nameOf(CASES[2], 0))), false)
  })
  await check('under every input order the client puts a tagged cluster side by side', () => {
    for (const kase of CASES) {
      if (kase.rows.length < 2) continue
      const items = ITEMS.filter((item) => kase.ids.includes(item.id))
      const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((rest) => [x, ...rest])))
      for (const twinIds of clustersOf(kase)) {
        for (const order of perms(items)) {
          const ids = grouping.buildProductGroups(order, new Map(), { preserveInputOrder: false }).flatMap((g) => g.rows.map((r) => r.id))
          const at = twinIds.map((id) => ids.indexOf(id)).sort((a, b) => a - b)
          assert.deepEqual(at, at.map((_, i) => at[0] + i), `case "${kase.label}", input ${order.map((r) => r.id)}: ${ids}`)
        }
      }
    }
  })
  return failures
}

// ---- ORDER: the server's intra-family ORDER BY against the same table --------------------------------------------------------------------------
// The Worker orders the rows of one family in SQL (name, empty barcode last, then the identity key). A twin cluster is side by side there whenever
// nothing sorts between its members, which holds for every two-row case and for any group whose barcodes are one real code plus non-real ones. The one
// shape SQL cannot place is a non-real row beside a real winner that is not the last real code of its name, because the winner is chosen by stock and
// SQL's key cannot see stock. The grouped client re-sorts and gathers every cluster (checked above), and every list the client shows goes through it.
async function orderReport() {
  const familyPagination = await bundle(path.join(cloudflare, 'src/lib/familyPagination.ts'), [], { external: ['cloudflare:*'] })
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, barcode TEXT)')
  const add = db.prepare('INSERT INTO products(id,name,barcode) VALUES(?,?,?)')
  for (const item of ITEMS) add.run(item.id, item.name, item.barcode)
  const sorted = db.prepare(`SELECT id FROM products ORDER BY ${familyPagination.INTRA_FAMILY_NAME_BARCODE_SQL}, id`).all().map((r) => r.id)
  const split = []
  for (const kase of CASES) {
    for (const twinIds of clustersOf(kase)) {
      const at = twinIds.map((id) => sorted.indexOf(id)).sort((a, b) => a - b)
      if (at[at.length - 1] - at[0] !== at.length - 1) split.push(kase.label)
    }
  }
  return split
}

// ---- mutants ----------------------------------------------------------------------------------------------------------------------------------
const RULE_COPIES_DIFFER = 'the two copies of productDetailRule.ts differ'
const MUTANTS = [
  // The old sweep: same-name pairs are only listed when they share a code of 4 or more characters (no same-name cluster at all).
  { name: 'old rule in the Conflicts sweep: only a shared code of 4+ characters is listed', sweepPatches: [{ name: 'no name clusters', file: 'cloudflare/src/lib/productIdentity.ts', from: "    if (dismissed.has(dismissKey('name', nameKey))) continue\n", to: "    continue\n" }] },
  { name: 'Conflicts sweep skips a name group with an empty barcode', sweepPatches: [{ name: 'skip empty', file: 'cloudflare/src/lib/productIdentity.ts', from: "    const barcodes = new Set(group.map((row) => String(row.barcode || '').trim()))\n    if (barcodes.size === 1 && [...barcodes][0].length >= MIN_REAL_BARCODE_LENGTH) continue\n    // ...and a name group", to: "    const barcodes = new Set(group.map((row) => String(row.barcode || '').trim()))\n    if (barcodes.has('')) continue\n    if (barcodes.size === 1 && [...barcodes][0].length >= MIN_REAL_BARCODE_LENGTH) continue\n    // ...and a name group" }] },
  { name: 'old client rule: an empty, word or short barcode is nobody\'s twin', clientPatches: [{ name: 'real only', file: 'frontend/src/utils/productGrouping.ts', from: 'for (const cluster of clusterRowsByBarcodeIdentity(rows)) {', to: 'for (const cluster of clusterRowsByBarcodeIdentity(rows.filter((row) => isRealBarcode(row.barcode)))) {' }] },
  { name: 'client twin = same name, whatever the barcodes', clientPatches: [{ name: 'name only', file: 'frontend/src/utils/productGrouping.ts', from: 'for (const cluster of clusterRowsByBarcodeIdentity(rows)) {', to: 'for (const cluster of [rows]) {' }] },
  { name: 'client compares the raw name', clientPatches: [{ name: 'raw name', file: 'frontend/src/utils/productGrouping.ts', from: 'const name = serverNameKey(item?.name)', to: "const name = String(item?.name ?? '')" }] },
  { name: 'client sorts but never gathers a cluster (a third real code stands between the twins)', clientPatches: [{ name: 'no gather', file: 'frontend/src/utils/productGrouping.ts', from: '  if (!keys.some(Boolean)) return sorted', to: '  return sorted' }] },
  { name: 'client twin key drops the barcode (two clusters of two under one name read as one)', clientPatches: [{ name: 'key without barcode', file: 'frontend/src/utils/productGrouping.ts', from: "const key = `${name}|${real ? identityBarcodeKey(real.barcode) : ''}`", to: 'const key = `${name}|`' }] },
  { name: 'client collapses inner spaces in the name (the Worker\'s name_key keeps them)', clientPatches: [{ name: 'collapsed name', file: 'frontend/src/utils/productGrouping.ts', from: 'const name = serverNameKey(item?.name)', to: 'const name = normalizeProductGroupName(item?.name)' }] },
  { name: 'the Worker\'s auto-merge detector buckets by name only (two real barcodes are one product)', sweepPatches: [{ name: 'detector by name', file: 'cloudflare/src/lib/productIdentity.ts', from: '    const buckets = clusterRowsByBarcodeIdentity(eligible)\n', to: '    const buckets = [eligible]\n' }] },
  { name: 'client forgets the scope (inactive and group rows count)', clientPatches: [{ name: 'scope', file: 'frontend/src/utils/productGrouping.ts', from: 'if (!name || Number(group || 0) || active === 0 || active === false) return', to: 'if (!name) return' }] },
  { name: 'client copy of the rule drifts: all-empty rows are not one cluster', clientPatches: [{ name: 'drift client', file: 'frontend/src/utils/productDetailRule.ts', from: 'if (!real.length) return [[...rows]]', to: 'if (!real.length) return rows.map((row) => [row])' }] },
  { name: 'Worker copy of the rule drifts: leading zeros not folded', workerPatches: [{ name: 'drift worker', file: 'cloudflare/src/lib/productDetailRule.ts', from: 'const key = identityBarcodeKey(row.barcode)\n    if (!byKey.has(key)) byKey.set(key, [])', to: 'const key = String(row.barcode)\n    if (!byKey.has(key)) byKey.set(key, [])' }] },
]

// The two copies of the rule differ in one line only: the moneyPrecision import specifier (the Worker's bundler wants '.ts', the client's does not).
const normaliseCopy = (text) => text.replace(/\r\n/g, '\n').replace("from './moneyPrecision.ts'", "from './moneyPrecision'")
const sameCopy = (workerText, clientText) => normaliseCopy(workerText) === normaliseCopy(clientText)
const readCopy = (p) => fs.readFileSync(p, 'utf8')
const copiesIdentical = () => sameCopy(readCopy(path.join(cloudflare, 'src/lib/productDetailRule.ts')), readCopy(path.join(frontend, 'src/utils/productDetailRule.ts')))

;(async () => {
  assert.ok(copiesIdentical(), RULE_COPIES_DIFFER)
  const base = await pass()
  assert.deepEqual(base, [], `the real code is red:\n${base.join('\n')}`)
  const split = await orderReport()
  // Pin what the server order does with the table so a change is noticed: only shapes with a real winner that is not the last real code can split.
  assert.deepEqual(split, ['real A, real B, empty (A holds the stock): the empty row joins A', 'real A, real B, word, empty (A holds the stock)'].filter((label) => split.includes(label)),
    `the server order splits a cluster it should not: ${split}`)
  for (const mutant of MUTANTS) {
    const failures = await pass(mutant)
    assert.ok(failures.length > 0, `mutant survived: ${mutant.name}`)
  }
  // The two-copies guard is itself discriminating: it takes the real files (equal), the specifier and line-ending differences it must tolerate (equal), and a copy
  // drifted by one rule line, by one comment character or by one more line (each must be seen as different).
  const workerText = readCopy(path.join(cloudflare, 'src/lib/productDetailRule.ts'))
  const clientText = readCopy(path.join(frontend, 'src/utils/productDetailRule.ts'))
  assert.equal(sameCopy(workerText, clientText), true, 'the real copies are one rule')
  assert.equal(sameCopy(workerText, clientText.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')), true, 'a CRLF checkout is not drift')
  assert.equal(sameCopy(workerText.replace("from './moneyPrecision.ts'", "from './moneyPrecision'"), clientText), true, 'the import specifier is not drift')
  const drift = (text, from, to) => { assert.equal(text.split(from).length, 2, `drift anchor must occur once: ${from}`); return text.replace(from, () => to) }
  assert.equal(sameCopy(workerText, drift(clientText, 'if (!real.length) return [[...rows]]', 'if (!real.length) return []')), false, 'a changed rule line on the client is drift')
  assert.equal(sameCopy(drift(workerText, 'if (!real.length) return [[...rows]]', 'if (!real.length) return []'), clientText), false, 'a changed rule line on the Worker is drift')
  assert.equal(sameCopy(workerText, clientText + '\n// stray'), false, 'one extra line is drift')
  assert.equal(sameCopy(workerText, drift(clientText, 'Clusters a set of SAME-NAME rows', 'Clusters a set of SAME-NAME  rows')), false, 'a comment character is drift')
  console.log(`PASS twin rule parity: ${CASES.length} cases (${ITEMS.length} rows) give one partition on the Worker (its real auto-merge detector on SQLite, and the rule) and the client, the name compared as SQLite's lower(trim(name)); every tagged cluster is listed by the Conflicts sweep; a scan never picks between two real barcodes; clusters sit side by side under every input order; server order splits only ${split.length ? JSON.stringify(split) : 'nothing'}; ${MUTANTS.length} mutants killed`)
})().catch((error) => { console.error(error); process.exit(1) })
