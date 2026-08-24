// One-off verification (not part of the regular test suite): loads a REAL
// products template xlsx, runs it through the REAL (merged) classifyProducts
// + summarizeImportWarnings against a real SQLite schema, and checks the
// grouped "row-number notation" warning report lines up with the known
// per-row figures from the reference file currently in use.
//
// Reference file as of Aug 14 2026 (part 73 upload): products-template-v2.xlsx
// (supplied by upload, not committed) -- 11,952 rows, 11,924 created / 28
// updated, 705 barcode-collision warnings, 12 negative-stock warnings. This
// superseded the previous same-named upload's 11,957-row/7,573-created/
// 4,384-updated/1,375-barcode-collision baseline (itself already a
// supersession of an even earlier 11,890-row file) -- the filename is
// reused across sessions but the actual uploaded content isn't guaranteed
// to be identical each time, so if a future session supplies a different
// reference file, re-derive and update these numbers rather than treating
// a mismatch as a regression; only re-running the SAME file and getting
// different counts would indicate an actual classifyProducts/
// summarizeImportWarnings regression. (The much higher create-vs-update
// ratio this time just reflects this file having far fewer within-file
// same-product/branch duplicate rows than the prior upload -- nothing in
// classifyProducts/importEngine.ts changed this session; only unrelated
// search-filter code (routes/products.ts's already-established
// normalizedHaystackSql pattern ported into routes/inventory.ts and
// routes/portal.ts) did.
//
// Note: the create/update split moved from an initially-recorded 7,467/4,490
// to 7,573/4,384 within this same session -- not a second regression, but
// this harness's OWN applyChunk (below) still writing pre-migration-0016
// purchase_price_usd/khr instead of cost_price_usd/khr, and missing the
// special-price/discount/expiry columns entirely, so classifyProducts' byName
// fallback match (which compares cost_price_usd/khr) was reading back a
// stuck-at-schema-default 0 for every previously-created product regardless
// of its real cost, corrupting some same-product-across-branches matches
// even within a single first pass. Fixed alongside the classifyProducts data-
// population bug (see importEngine.ts) since the two bugs were masking each
// other -- this harness's broken writes meant the missing-fields bug's own
// idempotency symptom never had a chance to surface cleanly.
//
// Run from cloudflare/: node scripts/harness/run_real_xlsx.cjs <path-to-xlsx>
const path = require('path')
const XLSX = require(path.join(__dirname, '..', '..', '..', 'frontend', 'node_modules', 'xlsx'))
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')
const { classifyProducts, summarizeImportWarnings } = require('./load_import_engine.cjs')

function nowIso() { return new Date().toISOString() }

// Same write shape as run.cjs's applyResults, plus real branch-on-demand
// creation for `branch_name_pending` (see classifyProducts' 3-case branch
// rule) -- the small hand-built harness dataset never needed it since its
// branches are pre-seeded, but a real-world file can and does reference
// branch names that don't exist yet.
const branchIdByName = new Map()
async function resolveBranchId(db, pendingName) {
  const key = pendingName.toLowerCase()
  if (branchIdByName.has(key)) return branchIdByName.get(key)
  const existingRow = await db.prepare(`SELECT id FROM branches WHERE lower(name) = @name`).get({ name: key })
  if (existingRow) { branchIdByName.set(key, existingRow.id); return existingRow.id }
  const insertResult = await db.prepare(`INSERT INTO branches (name, is_default, is_active) VALUES (@name, 0, 1)`).run({ name: pendingName })
  const id = insertResult.meta.last_row_id
  branchIdByName.set(key, id)
  return id
}

async function applyChunk(db, results) {
  for (const r of results) {
    if (r.action === 'error') continue
    const d = r.data
    if (d.branch_name_pending) {
      d.branch_id = await resolveBranchId(db, String(d.branch_name_pending))
    }
    if (r.action === 'update' && r.existingId) {
      // Mirrors the real materializeImportChunk UPDATE in importEngine.ts
      // (column list kept in sync with it -- see that file's own comment on
      // why stock_quantity is excluded). Was previously writing to the
      // pre-migration-0016 purchase_price_usd/khr columns and missing every
      // special-price/discount/expiry column entirely, which silently
      // masked the classifyProducts data-population bug fixed this session
      // (those columns bound as undefined either way, so the idempotency
      // check below couldn't tell the difference until classifyProducts
      // actually started supplying real values for them).
      await db.prepare(`UPDATE products SET name=@name, sku=@sku, barcode=@barcode, category=@category, unit=@unit, description=@description, brand=@brand, supplier=@supplier, selling_price_usd=@selling_price_usd, selling_price_khr=@selling_price_khr, special_price_usd=@special_price_usd, special_price_khr=@special_price_khr, cost_price_usd=@cost_price_usd, cost_price_khr=@cost_price_khr, low_stock_threshold=@low_stock_threshold, out_of_stock_threshold=@out_of_stock_threshold, discount_enabled=@discount_enabled, discount_type=@discount_type, discount_percent=@discount_percent, discount_amount_usd=@discount_amount_usd, discount_amount_khr=@discount_amount_khr, discount_label=@discount_label, discount_badge_color=@discount_badge_color, discount_starts_at=@discount_starts_at, discount_ends_at=@discount_ends_at, expiry_date=@expiry_date, expiry_alert_days=@expiry_alert_days, is_active=@is_active, updated_at=@updated_at WHERE id=@id`)
        .run({ ...d, id: r.existingId, updated_at: nowIso(), image_path: d.image_path ?? null })
      if (d.branch_id != null) {
        await db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity`)
          .run({ id: r.existingId, branchId: d.branch_id, qty: d.stock_quantity })
      }
      await db.prepare(`UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id`)
        .run({ id: r.existingId })
      r.__finalId = r.existingId
    } else if (r.action === 'create') {
      const insertResult = await db.prepare(`INSERT INTO products (name, sku, barcode, category, unit, description, brand, supplier, selling_price_usd, selling_price_khr, special_price_usd, special_price_khr, cost_price_usd, cost_price_khr, stock_quantity, low_stock_threshold, out_of_stock_threshold, discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr, discount_label, discount_badge_color, discount_starts_at, discount_ends_at, expiry_date, expiry_alert_days, is_active, image_path, created_at, updated_at) VALUES (@name, @sku, @barcode, @category, @unit, @description, @brand, @supplier, @selling_price_usd, @selling_price_khr, @special_price_usd, @special_price_khr, @cost_price_usd, @cost_price_khr, @stock_quantity, @low_stock_threshold, @out_of_stock_threshold, @discount_enabled, @discount_type, @discount_percent, @discount_amount_usd, @discount_amount_khr, @discount_label, @discount_badge_color, @discount_starts_at, @discount_ends_at, @expiry_date, @expiry_alert_days, @is_active, @image_path, @created_at, @updated_at)`)
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

async function main() {
  const xlsxPath = process.argv[2]
  if (!xlsxPath) throw new Error('Usage: node run_real_xlsx.cjs <path-to-xlsx>')

  const wb = XLSX.readFile(xlsxPath)
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  console.log(`Loaded ${raw.length} data rows from sheet "${sheetName}" (${wb.SheetNames.length} sheet(s) total)`)

  // Normalize headers the same way importCsv.ts's normalizeCsvHeaders does
  // (lowercase, trim, spaces/dashes -> underscore) since the real header
  // row uses display casing/spacing, not the column keys classifyProducts
  // reads (selling_price_usd, stock_quantity, etc).
  function normalizeKey(k) {
    return String(k || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  }
  const rows = raw.map((r, i) => {
    const row = { _rowNumber: i + 2 } // header is row 1
    for (const [k, v] of Object.entries(r)) row[normalizeKey(k)] = v
    return row
  })

  const db = openDb(loadAll())

  // Real imports never classify the whole file against one static
  // snapshot of `existing` -- runImportAnalyze processes ROWS_PER_IMPORT_CHUNK
  // (150) row windows and (for apply) writes each window before the next
  // one classifies, so a later row that reuses an earlier row's barcode
  // under a different name is comparing against a product THIS SAME FILE
  // already created a few windows back, not against a pre-existing DB. A
  // single classifyProducts() call against an empty DB would show 0
  // collisions (nothing to collide with yet) -- replicate the real
  // chunked analyze+apply flow here so the collision/negative-stock counts
  // are the genuine, chunk-faithful numbers, not an artifact of testing
  // methodology.
  const CHUNK = 150
  const allResults = []
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK)
    const chunkResults = await classifyProducts(db, chunk, 'harness-job', null)
    await applyChunk(db, chunkResults)
    allResults.push(...chunkResults)
  }
  const results = allResults
  const counts = { create: 0, update: 0, skip: 0, error: 0 }
  for (const r of results) counts[r.action] = (counts[r.action] || 0) + 1

  const summary = summarizeImportWarnings(results)
  console.log('\nCounts:', counts, `(total ${results.length})`)
  console.log('\nGrouped warning report (row-number notation):')
  for (const group of summary) {
    const preview = group.rows.slice(0, 8).join(', ') + (group.rows.length > 8 ? ', ...' : '')
    console.log(`  ${group.label} (${group.count}): rows ${preview}`)
  }

  // Sanity checks against products-template-v2.xlsx's known figures (see
  // header comment) -- re-derive and update these if a future session
  // supplies a genuinely different reference file.
  const assert = require('assert')
  assert.strictEqual(results.length, 11952, `expected 11952 total rows, got ${results.length}`)
  const barcodeGroup = summary.find((g) => g.kind === 'barcode_collision')
  const negStockGroup = summary.find((g) => g.kind === 'negative_stock')
  const skuGroup = summary.find((g) => g.kind === 'sku_collision')
  assert.strictEqual(barcodeGroup?.count || 0, 705, `expected 705 barcode-collision warnings, got ${barcodeGroup?.count || 0}`)
  assert.strictEqual(negStockGroup?.count || 0, 12, `expected 12 negative-stock warnings, got ${negStockGroup?.count || 0}`)
  console.log(`\ncreate/update split: ${counts.create}/${counts.update} (reference: 11924/28, sku_collision this run: ${skuGroup?.count || 0})`)
  // No row appears twice within one group's row list (grouping is by SET).
  for (const group of summary) {
    const unique = new Set(group.rows)
    assert.strictEqual(unique.size, group.rows.length, `${group.kind} group has duplicate row numbers`)
  }
  console.log('\nAll checks passed: counts and grouped-warning notation match the known real-file figures.')

  // Idempotency: re-running the identical file against the now-populated
  // DB should resolve every row back to an update, creating 0 new
  // products -- same check the prior session ran, re-verified here after
  // this session's SKU/barcode-policy and warning-notation changes.
  const beforeReimportCount = db.db.prepare('SELECT COUNT(*) AS n FROM products').get().n
  const reimportResults = []
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK)
    const chunkResults = await classifyProducts(db, chunk, 'harness-job-reimport', null)
    await applyChunk(db, chunkResults)
    reimportResults.push(...chunkResults)
  }
  const afterReimportCount = db.db.prepare('SELECT COUNT(*) AS n FROM products').get().n
  const reimportCounts = { create: 0, update: 0, skip: 0, error: 0 }
  for (const r of reimportResults) reimportCounts[r.action] = (reimportCounts[r.action] || 0) + 1
  console.log(`\nRe-import (idempotency): ${JSON.stringify(reimportCounts)}; products before=${beforeReimportCount} after=${afterReimportCount}`)
  assert.strictEqual(reimportCounts.create, 0, `expected 0 new products on re-import, got ${reimportCounts.create}`)
  assert.strictEqual(afterReimportCount, beforeReimportCount, 'product count should be unchanged after re-import')
  console.log('Idempotency check passed: 0 new products on re-import.')
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
