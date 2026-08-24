// Synthetic end-to-end harness: real schema (actual migrations), real
// classifyProducts (transpiled from the merged src/lib/importEngine.ts),
// real SQLite (node:sqlite). Not the actual products-template-merged.xlsx
// file (that file and its row-derived rows.json were never part of either
// upload this harness was built from, so the 11,890-row/7,480-created
// numbers in progress.md's Done section could not be reproduced here) -- a
// small hand-built dataset instead, targeting exactly the collision rules
// under discussion: SKU-first match, barcode-collision-by-name flagging,
// branch-mismatch create, price-mismatch create, and negative-stock
// clamping. Also re-runs pass 2 a second time to check idempotency (no
// duplicate rows on re-import).
//
// Run from cloudflare/: node scripts/harness/run.cjs
//
// Worth knowing: a matching barcode resolves a match directly (once the
// existing product's name is compatible) and never reaches the name+cost+
// price+barcode fallback check below -- that fallback only fires for
// barcode-less rows matched by name. rows_variations.json's branch/price
// test rows are deliberately barcode-less for this reason; a variation row
// that reused an existing barcode would short-circuit straight to a merge
// instead.
//
// Branch is NOT part of that fallback's identity check (see importEngine.ts's
// classifyProducts comment) -- a barcode-less row with the same name+cost+
// price as an existing product now UPDATEs that product (adding a
// branch_stock row for its own branch) regardless of which branch the
// existing product already carries stock at. Only a genuine cost/price
// difference (or a different name) still forks a separate product row.
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')
const { classifyProducts } = require('./load_import_engine.cjs')

function nowIso() { return new Date().toISOString() }

async function applyResults(db, results) {
  for (const r of results) {
    if (r.action === 'error') continue
    const d = r.data
    if (r.action === 'update' && r.existingId) {
      await db.prepare(`UPDATE products SET name=@name, sku=@sku, barcode=@barcode, category=@category, unit=@unit, description=@description, brand=@brand, supplier=@supplier, selling_price_usd=@selling_price_usd, selling_price_khr=@selling_price_khr, purchase_price_usd=@purchase_price_usd, purchase_price_khr=@purchase_price_khr, low_stock_threshold=@low_stock_threshold, is_active=@is_active, updated_at=@updated_at WHERE id=@id`)
        .run({ ...d, id: r.existingId, updated_at: nowIso(), image_path: d.image_path ?? null })
      if (d.branch_id_explicit && d.branch_id != null) {
        await db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity`)
          .run({ id: r.existingId, branchId: d.branch_id, qty: d.stock_quantity })
      }
      await db.prepare(`UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id`)
        .run({ id: r.existingId })
      r.__finalId = r.existingId
    } else if (r.action === 'create') {
      const insertResult = await db.prepare(`INSERT INTO products (name, sku, barcode, category, unit, description, brand, supplier, selling_price_usd, selling_price_khr, purchase_price_usd, purchase_price_khr, stock_quantity, low_stock_threshold, is_active, image_path, created_at, updated_at) VALUES (@name, @sku, @barcode, @category, @unit, @description, @brand, @supplier, @selling_price_usd, @selling_price_khr, @purchase_price_usd, @purchase_price_khr, @stock_quantity, @low_stock_threshold, @is_active, @image_path, @created_at, @updated_at)`)
        .run({ ...d, image_path: d.image_path ?? null, created_at: nowIso(), updated_at: nowIso() })
      const newId = insertResult.meta.last_row_id
      r.__finalId = newId
      if (d.branch_id != null) {
        await db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity`)
          .run({ id: newId, branchId: d.branch_id, qty: d.stock_quantity })
        await db.prepare(`UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id`)
          .run({ id: newId })
      }
    }
  }
}

function loadRows(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'))
}

function printResults(label, results) {
  console.log(`\n--- ${label} ---`)
  for (const r of results) {
    console.log(`row ${r.rowNumber} [${r.identifier}] -> ${r.action}${r.existingId ? ` (existingId=${r.existingId})` : ''}${r.message ? `  WARNING: ${r.message}` : ''}`)
  }
}

async function main() {
  const db = openDb(loadAll())
  db.exec(`INSERT INTO branches (name, is_default, is_active) VALUES ('shop', 1, 1), ('warehouse', 0, 1)`)

  console.log('=== PASS 1: baseline import (empty DB) ===')
  const baselineRows = loadRows('rows_baseline.json')
  const baselineResults = await classifyProducts(db, baselineRows, 'job-baseline')
  printResults('baseline classify', baselineResults)
  assert.ok(baselineResults.every((r) => r.action === 'create'), 'all baseline rows should classify as create')
  await applyResults(db, baselineResults)
  const afterBaselineCount = db.db.prepare('SELECT COUNT(*) AS n FROM products').get().n
  console.log(`products after baseline: ${afterBaselineCount}`)
  assert.strictEqual(afterBaselineCount, 4, 'expected 4 baseline products')

  console.log('\n=== PASS 2: variation rows (each exercises one collision rule) ===')
  const variationRows = loadRows('rows_variations.json')
  const variationResults = await classifyProducts(db, variationRows, 'job-variations')
  printResults('variation classify', variationResults)

  const byRow = Object.fromEntries(variationResults.map((r) => [r.rowNumber, r]))

  // Row 2: Green Widget, same barcode as Red Widget, different name.
  console.log('\n[check] same barcode + different name -> flagged, separate product:')
  assert.strictEqual(byRow[2].action, 'create', 'Green Widget should CREATE (not merge into Red Widget)')
  assert.ok(byRow[2].message && byRow[2].message.includes('already used by a different product'), 'Green Widget should carry the barcode-collision warning')
  console.log('  PASS')

  // Row 3: Teal Widget, same name/cost/price/barcode as baseline, different branch.
  console.log('[check] same name/cost/price/barcode + different branch -> merges into existing product:')
  assert.strictEqual(byRow[3].action, 'update', 'Teal Widget (warehouse) should UPDATE the existing shop-branch Teal Widget, not fork a new product')
  assert.strictEqual(byRow[3].existingId, baselineResults.find((r) => r.data.name === 'Teal Widget').__finalId, 'should resolve to the actual baseline Teal Widget row')
  console.log('  PASS')

  // Row 4: Pink Widget, same name/branch/barcode as baseline, different price.
  console.log('[check] same name/branch/barcode + different price -> separate row:')
  assert.strictEqual(byRow[4].action, 'create', 'Pink Widget ($6) should CREATE, not merge into the $5 Pink Widget')
  console.log('  PASS')

  // Row 5: Renamed Widget, SKU-001 (matches Blue Widget), different name+barcode.
  // A matched SKU is no longer trusted blindly (see importEngine.ts's
  // classifyProducts sku_collision guard) -- a name mismatch on an SKU
  // match now flags and creates a separate product instead of silently
  // renaming/overwriting Blue Widget, the same guard a barcode match
  // already had. This replaces an earlier version of this test that
  // asserted the pre-guard behavior (SKU match always wins) and no longer
  // matches the code.
  console.log('[check] SKU match with a different name -> flagged, separate product (not silently merged):')
  assert.strictEqual(byRow[5].action, 'create', 'SKU-001/Renamed Widget should CREATE (not silently overwrite Blue Widget)')
  assert.ok(byRow[5].message && byRow[5].message.includes('already used by a different product'), 'Renamed Widget should carry the SKU-collision warning')
  console.log('  PASS')

  // Row 6: Orange Widget, negative stock.
  console.log('[check] negative stock -> clamped to 0 with a visible warning:')
  assert.strictEqual(byRow[6].data.stock_quantity, 0, 'negative stock should be clamped to 0 in the row data')
  assert.ok(byRow[6].message && byRow[6].message.includes('is negative; imported as 0'), 'negative stock should carry a visible warning')
  console.log('  PASS')

  await applyResults(db, variationResults)
  const afterVariationCount = db.db.prepare('SELECT COUNT(*) AS n FROM products').get().n
  console.log(`\nproducts after variations: ${afterVariationCount} (baseline 4 + 4 new creates [Green/Pink-$6/Renamed-sku-collision/Orange] + 1 update [Teal-warehouse merge] = 8 expected)`)
  assert.strictEqual(afterVariationCount, 8, 'expected 8 products total after variations pass')

  const negRows = db.db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock_quantity < 0').get().n
  assert.strictEqual(negRows, 0, 'no product should have negative stock_quantity in the DB')
  console.log(`products with negative stock in DB: ${negRows}`)

  console.log('\n=== PASS 3: idempotency re-import (same variation rows again) ===')
  const beforeReimportCount = db.db.prepare('SELECT COUNT(*) AS n FROM products').get().n
  const reimportResults = await classifyProducts(db, variationRows, 'job-reimport')
  printResults('re-import classify', reimportResults)
  await applyResults(db, reimportResults)
  const afterReimportCount = db.db.prepare('SELECT COUNT(*) AS n FROM products').get().n
  console.log(`\nproduct count before re-import: ${beforeReimportCount}, after: ${afterReimportCount} (new products created: ${afterReimportCount - beforeReimportCount})`)
  assert.strictEqual(afterReimportCount, beforeReimportCount, 'idempotency: re-importing identical rows should create 0 new products')
  assert.ok(reimportResults.every((r) => r.action === 'update'), 'idempotency: every row should now resolve to update, not create')

  console.log('\nALL SYNTHETIC HARNESS CHECKS PASSED')
}

main().catch((e) => {
  console.error('HARNESS FAILED:', e)
  process.exit(1)
})
