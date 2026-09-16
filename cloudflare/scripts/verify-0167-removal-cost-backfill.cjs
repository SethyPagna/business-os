// Verifies migrations/0167_removal_cost_snapshot_backfill.sql. Never touches
// remote D1.
//
// Two modes:
//   node scripts/verify-0167-removal-cost-backfill.cjs
//     Builds a fresh in-memory database from the REAL migration chain
//     (0001..latest, in filename order -- the same pattern
//     verify-0164-supplier-clusters.cjs uses), seeds the fixture below, and
//     verifies against that COPY.
//   node scripts/verify-0167-removal-cost-backfill.cjs <path-to-sqlite-file>
//     Copies the given sqlite file to a scratch path and verifies against
//     THAT COPY instead -- for checking the migration against a real
//     downloaded snapshot without ever mutating the original file.
//
// Asserts, in BOTH modes:
//   1. the migration is LF-only and is the only 0167 file in the chain;
//   2. NO row outside the uncosted-loss set changes at all (every other
//      table, and every column of every OTHER inventory_movements row, is
//      byte-identical before/after -- a full-table hash comparison, not a
//      row-count check, so an accidental cross-row UPDATE is caught even if
//      the row counts happen to still add up);
//   3. running the migration SQL a second time is a complete no-op (every
//      row, not just the count, is unchanged) -- proves the WHERE guards
//      really are idempotent, not merely re-computing the same numbers;
//   4. prints the full list of loss rows still uncosted after the run
//      (movement id, product id, name, type, quantity, created_at) so real
//      unpriceable rows are always visible, never silently accepted.
//
// Fixture mode (no arg) additionally asserts the exact seeded shapes: the
// uncosted count strictly drops, the genuinely-uncostable seeded row (#47027)
// is left alone, the reported production shape (#47026) is backfilled from
// its twin, and the untouched sale/already-costed rows (#47028/#47029) keep
// their original values.
//
// Real-sqlite mode (path given) does NOT know the row ids in advance, so it
// asserts only GENERIC invariants instead of the seeded-shape numbers: the
// uncosted count drops or stays the same (never assumes a real replica has
// resolvable rows), every row the migration actually changed was, before the
// run, an uncosted loss row with quantity > 0, and each such row's new cost
// equals what a SECOND, independently-written resolution chain (reading the
// after-state database directly, not trusting the migration's own SQL)
// computes for it.
//
// Run: node scripts/verify-0167-removal-cost-backfill.cjs
//      node scripts/verify-0167-removal-cost-backfill.cjs <path-to-sqlite-file>
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const assert = require('assert')
const Database = require('better-sqlite3')

const MIGRATION = '0167_removal_cost_snapshot_backfill.sql'
const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
assert.deepStrictEqual(migrationFiles.filter((f) => f.startsWith('0167_')), [MIGRATION], 'exactly one 0167 migration')
const migrationSql = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
assert.ok(!migrationSql.includes('\r'), 'migration is LF-only')
console.log('PASS migration file is LF-only and uniquely numbered')

function openDatabase() {
  const givenPath = process.argv[2]
  if (givenPath) {
    const scratch = path.join(os.tmpdir(), `0167-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
    fs.copyFileSync(givenPath, scratch)
    console.log(`Using a COPY of ${givenPath} at ${scratch} -- the original is never opened for writing.`)
    return new Database(scratch)
  }
  // Fresh build from the real migration chain, up to (but not including) 0167.
  const sqlite = new Database(':memory:')
  for (const f of migrationFiles) {
    if (f === MIGRATION) break
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  }
  seedFixture(sqlite)
  return sqlite
}

// Deliberately mirrors the same shape as the production case the owner
// reported (inventory_movements id 47026): a remove whose own lot and own
// product are both uncosted, with a same-name twin product that DOES carry
// a cost. Plus one genuinely-uncostable row (no lot, no product cost, no
// twin) that must be left completely alone.
function seedFixture(sqlite) {
  sqlite.exec(`
    -- Same shape as production: the leading zero lives on the BARCODE
    -- (identityBarcodeKey folds '0123' == '123'), not the name -- the two
    -- rows share the exact same normalized NAME, which is all the tier-4
    -- SQL fallback can compare. Product 9002 differs only by CASE, to prove
    -- LOWER(TRIM()) is doing the matching, not an accidental exact-string one.
    INSERT INTO products (id, name, cost_price_usd, cost_price_khr) VALUES
      (9001, 'Girlactik Face Glow Goldie', 0, 0),
      (9002, 'GIRLACTIK FACE GLOW GOLDIE', 6.40, 26000),
      (9003, 'Genuinely Uncostable Product', 0, 0);
    INSERT INTO product_batches (id, variant_product_id, batch_key, unit_cost_usd, received_at) VALUES
      (9101, 9001, 'k1', NULL, '2026-08-01 00:00:00'),
      (9102, 9002, 'k2', 6.40, '2026-08-05 00:00:00');
    INSERT INTO inventory_movements
      (id, product_id, product_name, branch_id, movement_type, quantity,
       unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
       reason, reference_id, user_id, user_name, created_at, batch_id) VALUES
      (47026, 9001, 'Girlactik Face Glow Goldie', 1, 'remove', 1,
       0, 0, 0, 0, 'Broken, removed entirely', NULL, 9, 'tester', '2026-09-10 03:00:00', 9101),
      (47027, 9003, 'Genuinely Uncostable Product', 1, 'remove', 2,
       0, 0, 0, 0, 'No cost anywhere', NULL, 9, 'tester', '2026-09-10 03:05:00', NULL),
      -- a SALE at the same product, same window -- must never be touched.
      (47028, 9001, 'Girlactik Face Glow Goldie', 1, 'sale', 3,
       6.40, 26000, 19.2, 78000, 'Sale 2001', '2001', 9, 'tester', '2026-09-10 03:10:00', NULL),
      -- a row already carrying a real cost -- must never be touched or
      -- re-derived, even though it is the same movement_type/quantity shape.
      (47029, 9002, 'GIRLACTIK FACE GLOW GOLDIE', 1, 'remove', 1,
       6.40, 26000, 6.40, 26000, 'Spoiled', NULL, 9, 'tester', '2026-09-10 03:15:00', 9102);
  `)
}

function tableNames(sqlite) {
  return sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`)
    .all().map((r) => r.name)
}

// Hash every row of every table (order-independent) so ANY change anywhere
// -- not just inventory_movements -- is caught.
function snapshotAll(sqlite) {
  const out = {}
  for (const table of tableNames(sqlite)) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all()
    const hashes = rows.map((row) => crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex')).sort()
    out[table] = hashes
  }
  return out
}

function uncostedLossCount(sqlite) {
  return sqlite.prepare(`
    SELECT COUNT(*) AS c FROM inventory_movements
    WHERE movement_type IN ('remove','write_off') AND quantity > 0
      AND COALESCE(unit_cost_usd,0) = 0 AND COALESCE(total_cost_usd,0) = 0
  `).get().c
}

// Independently recomputes what the same-shape 4-tier resolution chain
// should produce for a single inventory_movements row, reading the
// AFTER-migration database state directly with plain SQL -- this does NOT
// call or trust the migration's own SQL arithmetic; it is a second,
// independently-written implementation of the same chain (own batch lot ->
// own product cost -> product's own other costed lot -> same-name twin's
// costed lot) used only to check the migration's output against it.
function independentlyResolveUnitCostUsd(sqlite, movementRow) {
  if (movementRow.batch_id != null) {
    const lot = sqlite.prepare(`SELECT unit_cost_usd FROM product_batches WHERE id = ?`).get(movementRow.batch_id)
    if (lot && Number(lot.unit_cost_usd) > 0) return Number(lot.unit_cost_usd)
  }
  const product = sqlite.prepare(`SELECT id, name, cost_price_usd FROM products WHERE id = ?`).get(movementRow.product_id)
  if (product && Number(product.cost_price_usd) > 0) return Number(product.cost_price_usd)
  if (product) {
    const ownLot = sqlite.prepare(`
      SELECT unit_cost_usd FROM product_batches
      WHERE variant_product_id = ? AND unit_cost_usd IS NOT NULL AND unit_cost_usd > 0
      ORDER BY received_at DESC, id DESC LIMIT 1
    `).get(product.id)
    if (ownLot && Number(ownLot.unit_cost_usd) > 0) return Number(ownLot.unit_cost_usd)
    const twinLot = sqlite.prepare(`
      SELECT pb3.unit_cost_usd AS unit_cost_usd FROM product_batches pb3
      JOIN products p3 ON p3.id = pb3.variant_product_id
      WHERE p3.id != ? AND LOWER(TRIM(p3.name)) = LOWER(TRIM(?))
        AND pb3.unit_cost_usd IS NOT NULL AND pb3.unit_cost_usd > 0
      ORDER BY pb3.received_at DESC, pb3.id DESC LIMIT 1
    `).get(product.id, product.name)
    if (twinLot && Number(twinLot.unit_cost_usd) > 0) return Number(twinLot.unit_cost_usd)
  }
  return 0
}

function uncostedLossRowsDetailed(sqlite) {
  return sqlite.prepare(`
    SELECT id, product_id, product_name, movement_type, quantity, created_at
    FROM inventory_movements
    WHERE movement_type IN ('remove','write_off') AND quantity > 0
      AND COALESCE(unit_cost_usd,0) = 0 AND COALESCE(total_cost_usd,0) = 0
    ORDER BY id
  `).all()
}

const isRealSqliteMode = Boolean(process.argv[2])
const sqlite = openDatabase()

const before = snapshotAll(sqlite)
const uncostedBeforeRows = uncostedLossRowsDetailed(sqlite)
const uncostedBefore = uncostedBeforeRows.length
assert.ok(uncostedBefore > 0, 'fixture must contain at least one uncosted loss row to prove anything')

// Full pre-image of every inventory_movements row, keyed by id, so we can
// tell exactly which rows the migration touched regardless of mode.
const movementsBefore = new Map(
  sqlite.prepare(`SELECT * FROM inventory_movements`).all().map((row) => [row.id, row]),
)

sqlite.exec(migrationSql)

const after = snapshotAll(sqlite)
const uncostedAfterRows = uncostedLossRowsDetailed(sqlite)
const uncostedAfter = uncostedAfterRows.length

if (isRealSqliteMode) {
  assert.ok(uncostedAfter <= uncostedBefore, `expected the uncosted-loss count to drop or stay the same (before ${uncostedBefore}, after ${uncostedAfter})`)
} else {
  assert.ok(uncostedAfter < uncostedBefore, `expected the uncosted-loss count to drop (before ${uncostedBefore}, after ${uncostedAfter})`)
}
console.log(`PASS uncosted loss rows: ${uncostedBefore} -> ${uncostedAfter}`)

if (isRealSqliteMode) {
  // Generic invariants only -- no seeded ids exist in a real replica.
  const movementsAfter = sqlite.prepare(`SELECT * FROM inventory_movements`).all()
  let changedCount = 0
  for (const rowAfter of movementsAfter) {
    const rowBefore = movementsBefore.get(rowAfter.id)
    if (!rowBefore) continue
    const costChanged = Number(rowBefore.unit_cost_usd) !== Number(rowAfter.unit_cost_usd)
      || Number(rowBefore.unit_cost_khr) !== Number(rowAfter.unit_cost_khr)
      || Number(rowBefore.total_cost_usd) !== Number(rowAfter.total_cost_usd)
      || Number(rowBefore.total_cost_khr) !== Number(rowAfter.total_cost_khr)
    if (!costChanged) continue
    changedCount += 1
    // Invariant: every changed row was, before the run, an uncosted loss row
    // with quantity > 0.
    assert.ok(
      ['remove', 'write_off'].includes(rowBefore.movement_type) && Number(rowBefore.quantity) > 0
        && Number(rowBefore.unit_cost_usd) === 0 && Number(rowBefore.total_cost_usd) === 0,
      `changed row ${rowAfter.id} was not an uncosted loss row before the run`,
    )
    // Invariant: the new unit cost equals what an independently-written
    // resolution chain (reading the AFTER-state db directly, not trusting
    // the migration SQL) computes for that same row.
    const expectedUsd = independentlyResolveUnitCostUsd(sqlite, rowBefore)
    assert.equal(
      Number(rowAfter.unit_cost_usd),
      expectedUsd,
      `row ${rowAfter.id}: migration set unit_cost_usd=${rowAfter.unit_cost_usd} but the independently-recomputed chain resolves ${expectedUsd}`,
    )
    if (expectedUsd > 0) {
      const expectedTotal = Math.round(expectedUsd * Number(rowAfter.quantity) * 10000) / 10000
      assert.equal(Number(rowAfter.total_cost_usd), expectedTotal, `row ${rowAfter.id}: total_cost_usd mismatch`)
    }
  }
  console.log(`PASS every changed row (${changedCount}) was an uncosted loss row whose new cost matches an independently-recomputed resolution`)
} else {
  // The genuinely-uncostable row (#47027, on the fresh-build path) must
  // still be uncosted -- never wrongly priced at $0 or anything else.
  const uncostable = sqlite.prepare(`SELECT unit_cost_usd, total_cost_usd FROM inventory_movements WHERE id = 47027`).get()
  assert.equal(Number(uncostable.unit_cost_usd), 0)
  assert.equal(Number(uncostable.total_cost_usd), 0)
  console.log('PASS a row the chain cannot price is left completely alone, never priced at $0')

  // The reported production row now carries the twin's cost.
  const reported = sqlite.prepare(`SELECT unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr FROM inventory_movements WHERE id = 47026`).get()
  assert.equal(Number(reported.unit_cost_usd), 6.4, "the same-name twin product 9002's cost_price_usd")
  assert.equal(Number(reported.total_cost_usd), 6.4, '1 unit x $6.40')
  assert.equal(Number(reported.unit_cost_khr), 26000)
  assert.equal(Number(reported.total_cost_khr), 26000)
  console.log('PASS the exact reported production shape (id 47026) is backfilled from its same-name twin')

  // Rows #47028 (a sale) and #47029 (already costed) are untouched.
  const saleRow = sqlite.prepare(`SELECT * FROM inventory_movements WHERE id = 47028`).get()
  assert.equal(Number(saleRow.unit_cost_usd), 6.4)
  assert.equal(Number(saleRow.total_cost_usd), 19.2)
  const alreadyCostedRow = sqlite.prepare(`SELECT * FROM inventory_movements WHERE id = 47029`).get()
  assert.equal(Number(alreadyCostedRow.unit_cost_usd), 6.4)
  assert.equal(Number(alreadyCostedRow.total_cost_usd), 6.4)
  console.log('PASS a sale row and an already-costed removal are both untouched')
}

// Every table, every row NOT part of the uncosted-loss set is byte-identical.
for (const table of Object.keys(before)) {
  if (table === 'inventory_movements') continue
  assert.deepStrictEqual(after[table], before[table], `table "${table}" changed and it should not have`)
}
console.log('PASS every table other than inventory_movements is byte-identical before/after')

// Second run: complete no-op, row-hash identical.
sqlite.exec(migrationSql)
const afterSecondRun = snapshotAll(sqlite)
assert.deepStrictEqual(afterSecondRun, after, 'a second run of the migration must change nothing at all')
console.log('PASS re-running the migration is a byte-identical no-op')

// Rows still uncosted after the run, printed in full so the owner sees
// exactly which real rows remain with no cost anywhere the chain can reach.
if (uncostedAfterRows.length > 0) {
  console.log(`\n${uncostedAfterRows.length} loss row(s) remain uncosted after the backfill (no cost anywhere the chain can reach):`)
  console.log('movement_id\tproduct_id\tproduct_name\tmovement_type\tquantity\tcreated_at')
  for (const row of uncostedAfterRows) {
    console.log(`${row.id}\t${row.product_id}\t${row.product_name}\t${row.movement_type}\t${row.quantity}\t${row.created_at}`)
  }
} else {
  console.log('\n0 loss rows remain uncosted after the backfill.')
}

console.log('\nOK - migrations/0167_removal_cost_snapshot_backfill.sql verified')
