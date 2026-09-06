// Pins the 2026-09-06 owner report, verbatim:
//
//   "I see that barcode scanner cannot scan the beginning with zero the
//    leading zero for products that actually have barcode with leading 0."
//
// Runs the REAL lib/productSearchQuery.ts + lib/searchMatch.ts (transpiled,
// not a hand-copied replica) against the REAL migrations in better-sqlite3
// -- the same FTS5 build D1 runs.
//
// The lane's finding is that "leading zero" covers TWO different failures,
// and only the first was folded before:
//
//   A. PADDING. '0123456789012' and '123456789012' are one article written
//      at two widths. lib/searchMatch.ts already folded this on the INDEXED
//      path... but the COMPATIBILITY path (useSearchIndex:false, taken when
//      a database has not received the FTS migrations) built a pure
//      LIKE '%<code>%' WHERE and bound the barcode parameter for the tier
//      ONLY -- never adding the equality clause. Substring containment is
//      asymmetric: '0123456789012' LIKE '%123456789012%' is TRUE, but
//      '123456789012' LIKE '%0123456789012%' is FALSE. So on that path a
//      scan carrying MORE leading zeros than the catalog stores found
//      nothing at all, which is exactly the reported direction.
//
//   B. UPC-E. The 8-digit compressed symbol printed on small packages
//      ALWAYS begins with the number-system digit 0, and it is NOT a padded
//      form of its UPC-A: '01234565' stands for '012345000065' by
//      re-inserting a run of zeros whose POSITION is encoded in the last
//      payload digit. The two spellings share no substring and no ltrim()
//      brings them together, so neither path could ever match one from the
//      other. Decoders disagree about which form they hand back (ZXing and
//      the native BarcodeDetector both report UPC_E as its own 8 digits),
//      so this is reachable from a plain camera scan.
//
// What this asserts (each case fails on base 01f0c93c):
//   1. indexed path: stored padded, scanned bare  -> found
//   2. indexed path: stored bare, scanned padded  -> found
//   3. indexed path: UPC-E scan finds the UPC-A row, and vice versa
//   4. compat path (useSearchIndex:false): all of the above
//   5. NO COLLISION: two codes differing by anything other than leading
//      zeros never match each other, the '0' placeholder is never an
//      identity, and a GTIN-8 that is not a valid UPC-E keeps its own id
//   6. the exact-barcode row still RANKS ahead of a mere substring hit
//
// Run: node scripts/test-barcode-leading-zero-scan-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const moduleCache = new Map()
function loadTs(relPath) {
  const resolved = path.join(__dirname, '..', relPath)
  if (moduleCache.has(resolved)) return moduleCache.get(resolved)
  const src = fs.readFileSync(resolved, 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  moduleCache.set(resolved, mod.exports)
  const localRequire = (spec) => {
    if (spec.startsWith('.')) {
      const dir = path.dirname(relPath)
      let next = path.posix.join(dir.split(path.sep).join('/'), spec)
      if (!next.endsWith('.ts')) next = `${next}.ts`
      return loadTs(next)
    }
    return require(spec)
  }
  new Function('exports', 'require', outputText)(mod.exports, localRequire)
  return mod.exports
}

const searchMatch = loadTs('src/lib/searchMatch.ts')
const { buildProductSearchQuery } = loadTs('src/lib/productSearchQuery.ts')
const { barcodeKeysMatch, normalizeBarcodeKey } = searchMatch

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8')
  try {
    db.exec(sql)
  } catch (err) {
    console.log(`MIGRATION FAILED: ${f}: ${err.message}`)
    process.exit(1)
  }
}
console.log(`Applied ${files.length} migrations cleanly.`)

const insert = db.prepare(`INSERT INTO products
  (id, name, sku, barcode, brand, category, supplier, description, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active)
  VALUES (@id, @name, @sku, @barcode, @brand, @category, @supplier, @description, @unit, 50, 10, 0, 1)`)
const row = (id, name, barcode) => insert.run({
  id, name, barcode, sku: null,
  brand: '', category: '', supplier: '', description: '', unit: 'pcs',
})

// --- the catalog -------------------------------------------------------
// A. padding pair, stored ONLY in the zero-padded spelling.
const PADDED_STORED = '0748485110011'
const PADDED_BARE = '748485110011'
row(101, 'Padded Only Serum', PADDED_STORED)

// A'. the mirror: stored ONLY bare, scanned with an extra zero.
const BARE_STORED = '885909950805'
const BARE_SCANNED_PADDED = '0885909950805'
row(102, 'Bare Only Cleanser', BARE_STORED)

// B. UPC-E pair. '01234565' <-> '012345000065' (verified by the check digit
// and by round-tripping the expansion).
const UPCE = '01234565'
const UPCA = '012345000065'
row(103, 'Small Package Balm', UPCA)   // stored expanded, scanned compressed
// Stored compressed, scanned expanded. '04963406' is a real UPC-E; the
// zero run it re-inserts puts its UPC-A at '049000006346' (its own check
// digit, 6, is what proves the expansion is the right one).
const TIN_UPCE = '04963406'
const TIN_UPCA = '049000006346'
row(104, 'Compressed Tin', TIN_UPCE)

// Controls that must NEVER be dragged in.
row(201, 'Different Article One Digit Off', '0748485110012')
row(202, 'Contains The Digits Somewhere', `99${PADDED_BARE}`)
row(203, 'Legacy Placeholder A', '0')
row(204, 'Legacy Placeholder B', '0')
// A GTIN-8 whose check digit does NOT make it a valid UPC-E.
row(205, 'In Store Eight Digit', '20123458')

// Mirrors how routes/products.ts consumes buildProductSearchQuery.
function search(rawQuery, { useSearchIndex = true } = {}) {
  const params = {}
  const q = buildProductSearchQuery(rawQuery, params, { useSearchIndex })
  if (!q.hasSearchTerm || !q.whereClause) {
    return db.prepare('SELECT id FROM products WHERE is_active = 1 ORDER BY id').all().map((r) => r.id)
  }
  const order = q.matchTierSql ? `${q.matchTierSql} ASC, p.id ASC` : 'p.id ASC'
  const sql = `SELECT p.id FROM products p WHERE p.is_active = 1 AND ${q.whereClause} ORDER BY ${order}`
  return db.prepare(sql).all(params).map((r) => r.id)
}

for (const pathName of ['indexed', 'compat']) {
  const useSearchIndex = pathName === 'indexed'
  const find = (code) => search(code, { useSearchIndex })

  check(`${pathName}: stored zero-padded, scanned bare -> found`, () => {
    assert.ok(find(PADDED_BARE).includes(101),
      `scan ${PADDED_BARE} did not find the row stored as ${PADDED_STORED}`)
  })

  check(`${pathName}: stored zero-padded, scanned WITH the zero -> found`, () => {
    assert.ok(find(PADDED_STORED).includes(101))
  })

  // The reported direction: the scanner emits the leading zero, the catalog
  // does not store it. Pure substring containment cannot do this.
  check(`${pathName}: stored bare, scanned WITH a leading zero -> found`, () => {
    assert.ok(find(BARE_SCANNED_PADDED).includes(102),
      `scan ${BARE_SCANNED_PADDED} did not find the row stored as ${BARE_STORED}`)
  })

  check(`${pathName}: UPC-E scan finds the row stored as its UPC-A`, () => {
    assert.ok(find(UPCE).includes(103),
      `scan ${UPCE} did not find the row stored as ${UPCA}`)
  })

  check(`${pathName}: UPC-A scan finds the row stored compressed as UPC-E`, () => {
    assert.ok(find(TIN_UPCA).includes(104),
      `scan ${TIN_UPCA} did not find the row stored as ${TIN_UPCE}`)
  })

  // --- the guarantee that keeps the fold honest ------------------------
  check(`${pathName}: a code differing by more than leading zeros never collides`, () => {
    const hits = find(PADDED_BARE)
    assert.ok(!hits.includes(201), 'one-digit-different article was matched')
    assert.ok(!hits.includes(103) && !hits.includes(104), 'unrelated UPC rows matched')
  })

  check(`${pathName}: the "0" placeholder is never an identity`, () => {
    const hits = find('0')
    assert.ok(!(hits.includes(203) && hits.includes(204) && hits.length === 2),
      'the placeholder clustered its rows as one barcode identity')
  })

  check(`${pathName}: a GTIN-8 that is not a valid UPC-E keeps its own identity`, () => {
    // 20123458 must not be expanded into some UPC-A and must not pull in
    // any other row.
    const hits = find('20123458')
    assert.deepStrictEqual(hits.filter((id) => id !== 205), [],
      'a non-UPC-E eight-digit code matched foreign rows')
  })
}

// Ranking is only meaningful on the indexed path's tier, which both paths
// now compute; assert it where the substring rival actually co-occurs.
check('indexed: the exact-barcode row leads a mere substring hit', () => {
  const hits = search(PADDED_BARE)
  assert.ok(hits.includes(101), 'exact row missing')
  if (hits.includes(202)) {
    assert.ok(hits.indexOf(101) < hits.indexOf(202),
      'the substring-only row outranked the scanned article')
  }
})

// --- kernel-level identity, independent of SQL -------------------------
check('kernel: barcodeKeysMatch folds padding in both directions', () => {
  assert.ok(barcodeKeysMatch(PADDED_BARE, PADDED_STORED))
  assert.ok(barcodeKeysMatch(PADDED_STORED, PADDED_BARE))
  assert.ok(barcodeKeysMatch(BARE_SCANNED_PADDED, BARE_STORED))
})

check('kernel: barcodeKeysMatch folds the UPC-E/UPC-A pair both ways', () => {
  assert.ok(barcodeKeysMatch(UPCE, UPCA), `${UPCE} should be ${UPCA}`)
  assert.ok(barcodeKeysMatch(UPCA, UPCE))
  // ...and through the 13-digit EAN-13 spelling of the same UPC-A.
  assert.ok(barcodeKeysMatch(UPCE, `0${UPCA}`))
})

check('kernel: the fold never invents an identity', () => {
  assert.ok(!barcodeKeysMatch(PADDED_STORED, '0748485110012'))
  assert.ok(!barcodeKeysMatch('0', '0'))
  assert.ok(!barcodeKeysMatch(UPCE, '20123458'))
  // A one-digit change in the UPC-E payload must land on a different
  // article, not the same one.
  assert.ok(!barcodeKeysMatch('01234565', '01234665'))
})

check('kernel: normalizeBarcodeKey still returns the STORED-form key', () => {
  // The display/storage contract: nothing here rewrites what is shown.
  assert.strictEqual(normalizeBarcodeKey(PADDED_STORED), PADDED_BARE)
})

console.log(`\nOK - ${passed} checks passed.`)
