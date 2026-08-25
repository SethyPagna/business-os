// PRODUCT CENSUS -- the "did we lose or hide anything?" harness.
//
// Not part of the regular suite (it needs a real CSV supplied on the command
// line). This is the tool the grouping work is verified against: it runs a
// REAL products CSV through the REAL parseCsvRows + classifyProducts against
// a REAL migrated SQLite schema, then reports, in one place:
//
//   * rows in    -> products out, and every row that produced neither
//   * how many products merged into an existing row, and which ones
//   * the NAME-GROUP census: how many groups, how many are multi-row, and
//     the biggest ones
//   * within each multi-row group, whether the rows differ by DETAILS
//     (barcode / selling / special / cost) -- i.e. legitimate child rows --
//     or are pure duplicates that should have merged
//   * branch_stock coverage: every product must have a row for EVERY active
//     branch, 0 where absent ("no exceptions")
//
// The point is that "8,727 rows in, 8,6xx products out" is only acceptable
// if the difference is fully explained. This prints the explanation instead
// of asking anyone to trust the number.
//
// Run from cloudflare/:
//   node scripts/harness/run_product_census.cjs "/path/to/products-template.csv"
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')
const { classifyProducts, productImportRowSignature } = require('./load_import_engine.cjs')

// The real CSV parser, transpiled rather than reimplemented -- BOM handling,
// delimiter detection and RFC4180 multi-line quoted fields (this file's
// descriptions genuinely span lines) all have to behave exactly as they do
// in production or the census measures the wrong thing.
const importCsvPath = path.join(__dirname, '..', '..', 'src', 'lib', 'importCsv.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(importCsvPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'importCsv.ts',
})
const importCsvModule = { exports: {} }
new Function('exports', 'require', 'module', outputText)(importCsvModule.exports, require, importCsvModule)
const { parseCsvRows, detectCsvDelimiter } = importCsvModule.exports

const nowIso = () => new Date().toISOString()

const branchIdByName = new Map()
async function resolveBranchId(db, pendingName) {
  const key = String(pendingName).toLowerCase()
  if (branchIdByName.has(key)) return branchIdByName.get(key)
  const existing = await db.prepare(`SELECT id FROM branches WHERE lower(name) = @name`).get({ name: key })
  if (existing) { branchIdByName.set(key, existing.id); return existing.id }
  const inserted = await db.prepare(`INSERT INTO branches (name, is_default, is_active) VALUES (@name, 0, 1)`).run({ name: String(pendingName) })
  const newBranchId = inserted.meta.last_row_id
  // Mirrors importEngine.ts's backfillBranchStockForNewBranch: a branch
  // created part-way through an import must give every ALREADY-created
  // product an explicit 0 row, or those products are invisible to any
  // branch-filtered view instead of showing an honest zero.
  await db.prepare(`
    INSERT INTO branch_stock (product_id, branch_id, quantity)
    SELECT p.id, @branchId, 0 FROM products p
    WHERE p.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = @branchId)
  `).run({ branchId: newBranchId })
  branchIdByName.set(key, newBranchId)
  return newBranchId
}

// Same write shape as run_real_xlsx.cjs's applyChunk (which mirrors
// materializeImportChunk). Deliberately NOT deduplicated with that file:
// this harness must keep working even if that one is changed for its own
// xlsx-specific reasons.
async function applyChunk(db, results) {
  // IN-BATCH DEDUPE. runImportApply converts a `create` row into an update
  // against an earlier create in the SAME chunk when their
  // productImportRowSignature matches (importEngine.ts:3306-3319) -- because
  // classifyProducts loads `existing` once per chunk, so two identical rows
  // inside one chunk both see "no match" and would each create a product.
  // Omitting this made the census report ~2,000 groups of "duplicates that
  // should have merged" that the real pipeline never actually creates. The
  // census has to model the real pipeline or it measures the harness.
  const inBatchSignatureToId = new Map()

  for (const r of results) {
    if (r.action === 'error' || r.action === 'skip') continue
    const d = r.data
    if (d.branch_name_pending) d.branch_id = await resolveBranchId(db, d.branch_name_pending)
    if (r.action === 'create') {
      const signature = productImportRowSignature(d)
      const earlierId = inBatchSignatureToId.get(signature)
      if (earlierId != null) { r.action = 'update'; r.existingId = earlierId; r.__dedupedInBatch = true }
      else r.__pendingSignature = signature
    }
    if (r.action === 'update' && r.existingId) {
      await db.prepare(`UPDATE products SET name=@name, sku=@sku, barcode=@barcode, category=@category, unit=@unit, description=@description, brand=@brand, supplier=@supplier, selling_price_usd=@selling_price_usd, selling_price_khr=@selling_price_khr, special_price_usd=@special_price_usd, special_price_khr=@special_price_khr, cost_price_usd=@cost_price_usd, cost_price_khr=@cost_price_khr, low_stock_threshold=@low_stock_threshold, out_of_stock_threshold=@out_of_stock_threshold, discount_enabled=@discount_enabled, discount_type=@discount_type, discount_percent=@discount_percent, discount_amount_usd=@discount_amount_usd, discount_amount_khr=@discount_amount_khr, discount_label=@discount_label, discount_badge_color=@discount_badge_color, discount_starts_at=@discount_starts_at, discount_ends_at=@discount_ends_at, expiry_date=@expiry_date, expiry_alert_days=@expiry_alert_days, is_active=@is_active, updated_at=@updated_at WHERE id=@id`)
        .run({ ...d, id: r.existingId, updated_at: nowIso(), image_path: d.image_path ?? null })
      if (d.branch_id != null) {
        await db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty) ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity`)
          .run({ id: r.existingId, branchId: d.branch_id, qty: d.stock_quantity })
      }
      await db.prepare(`UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id`).run({ id: r.existingId })
    } else if (r.action === 'create') {
      const inserted = await db.prepare(`INSERT INTO products (name, sku, barcode, category, unit, description, brand, supplier, selling_price_usd, selling_price_khr, special_price_usd, special_price_khr, cost_price_usd, cost_price_khr, stock_quantity, low_stock_threshold, out_of_stock_threshold, discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr, discount_label, discount_badge_color, discount_starts_at, discount_ends_at, expiry_date, expiry_alert_days, is_active, image_path, created_at, updated_at) VALUES (@name, @sku, @barcode, @category, @unit, @description, @brand, @supplier, @selling_price_usd, @selling_price_khr, @special_price_usd, @special_price_khr, @cost_price_usd, @cost_price_khr, @stock_quantity, @low_stock_threshold, @out_of_stock_threshold, @discount_enabled, @discount_type, @discount_percent, @discount_amount_usd, @discount_amount_khr, @discount_label, @discount_badge_color, @discount_starts_at, @discount_ends_at, @expiry_date, @expiry_alert_days, @is_active, @image_path, @created_at, @updated_at)`)
        .run({ ...d, image_path: d.image_path ?? null, created_at: nowIso(), updated_at: nowIso() })
      const newId = inserted.meta.last_row_id
      if (d.branch_id != null) {
        await db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty) ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity`)
          .run({ id: newId, branchId: d.branch_id, qty: d.stock_quantity })
        await db.prepare(`UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id`).run({ id: newId })
      }
      if (r.__pendingSignature) inBatchSignatureToId.set(r.__pendingSignature, newId)
      // Seed EVERY other active branch at 0, exactly as runImportApply does
      // (importEngine.ts:3633-3640). Without this the coverage check below
      // reports the harness's own omission as a product defect.
      const activeBranches = await db.prepare(`SELECT id FROM branches WHERE is_active = 1`).all({})
      for (const b of activeBranches) {
        if (b.id === d.branch_id) continue
        await db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 0) ON CONFLICT(product_id, branch_id) DO NOTHING`)
          .run({ id: newId, branchId: b.id })
      }
    }
  }
}

// THE detail set, read from the real rule module so this census can never
// measure a different rule than the code applies: barcode + cost.
const detailRulePath = path.join(__dirname, '..', '..', 'src', 'lib', 'productDetailRule.ts')
const { outputText: detailRuleOut } = ts.transpileModule(fs.readFileSync(detailRulePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'productDetailRule.ts',
})
const detailRuleModule = { exports: {} }
new Function('exports', 'require', 'module', detailRuleOut)(detailRuleModule.exports, require, detailRuleModule)
const detailSignature = detailRuleModule.exports.productDetailSignature

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) throw new Error('Usage: node run_product_census.cjs <path-to-products-csv>')

  const text = fs.readFileSync(csvPath, 'utf8')
  const delimiter = detectCsvDelimiter(text)
  const rows = parseCsvRows(text, { delimiter })
  console.log(`\n=== SOURCE ===`)
  console.log(`file        : ${path.basename(csvPath)}`)
  console.log(`delimiter   : ${JSON.stringify(delimiter)}`)
  console.log(`data rows   : ${rows.length}`)

  const db = openDb(loadAll())
  await db.prepare(`INSERT INTO branches (name, is_default, is_active) VALUES ('Main', 1, 1)`).run({})

  const CHUNK = 150
  let created = 0, updated = 0, errored = 0, skipped = 0
  const errors = []
  const mergedInto = []
  for (let i = 0; i < rows.length; i += CHUNK) {
    const window = rows.slice(i, i + CHUNK)
    const results = await classifyProducts(db, window, 'census-job', null)
    for (const r of results) {
      if (r.action === 'create') created++
      else if (r.action === 'update') { updated++; mergedInto.push({ row: r.rowNumber, id: r.existingId, name: String(r.data?.name || '') }) }
      else if (r.action === 'error') { errored++; if (errors.length < 10) errors.push(`row ${r.rowNumber}: ${r.message}`) }
      else if (r.action === 'skip') skipped++
    }
    await applyChunk(db, results)
  }

  const productCount = (await db.prepare(`SELECT COUNT(*) AS c FROM products`).get({})).c
  console.log(`\n=== ROWS -> PRODUCTS ===`)
  console.log(`created     : ${created}`)
  console.log(`merged      : ${updated}   (matched an existing product)`)
  console.log(`errors      : ${errored}`)
  console.log(`skipped     : ${skipped}`)
  console.log(`products    : ${productCount}`)
  const accounted = created + updated + errored + skipped
  console.log(`accounted   : ${accounted} / ${rows.length} ${accounted === rows.length ? 'OK -- every row is explained' : '*** MISMATCH: rows vanished without a verdict ***'}`)
  if (errors.length) { console.log(`\nfirst errors:`); errors.forEach((e) => console.log(`  ${e}`)) }

  // ---- name-group census -------------------------------------------------
  const groups = await db.prepare(`
    SELECT name_key, COUNT(*) AS rows_in_group
    FROM products WHERE is_active = 1 AND name_key <> ''
    GROUP BY name_key ORDER BY rows_in_group DESC, name_key ASC
  `).all({})
  const multi = groups.filter((g) => g.rows_in_group > 1)
  console.log(`\n=== NAME GROUPS (the paging/display unit) ===`)
  console.log(`distinct groups   : ${groups.length}`)
  console.log(`multi-row groups  : ${multi.length}`)
  console.log(`rows in those     : ${multi.reduce((s, g) => s + g.rows_in_group, 0)}`)
  console.log(`largest group     : ${groups.length ? groups[0].rows_in_group : 0} rows`)

  // Within each multi-row group: do the rows differ by DETAILS (legitimate
  // child rows) or are they duplicates that should have merged?
  let legitimateChildGroups = 0
  let duplicateGroups = 0
  const samples = []
  // WHICH detail actually forces each split. This is the decision-support
  // output: cost counts as a detail by explicit decision, so a group that
  // splits ONLY on cost exists because of that choice and would collapse to
  // a single product if cost were dropped from the detail set.
  const splitCause = { barcode: 0, selling: 0, special: 0, cost: 0, 'cost only': 0, 'special only': 0 }
  const differs = (members, pick) => new Set(members.map(pick)).size > 1
  const cents = (v) => Math.round((Number(v) || 0) * 100)
  for (const g of multi) {
    const members = await db.prepare(`SELECT id, name, barcode, selling_price_usd, selling_price_khr, special_price_usd, special_price_khr, cost_price_usd, cost_price_khr FROM products WHERE name_key = @k AND is_active = 1 ORDER BY id ASC`).all({ k: g.name_key })
    const sigs = new Set(members.map(detailSignature))
    if (sigs.size === members.length) legitimateChildGroups++
    else duplicateGroups++

    const barcodeDiff = differs(members, (m) => String(m.barcode || '').trim().toLowerCase())
    const sellingDiff = differs(members, (m) => `${cents(m.selling_price_usd)}|${cents(m.selling_price_khr)}`)
    const specialDiff = differs(members, (m) => `${cents(m.special_price_usd)}|${cents(m.special_price_khr)}`)
    const costDiff = differs(members, (m) => `${cents(m.cost_price_usd)}|${cents(m.cost_price_khr)}`)
    if (barcodeDiff) splitCause.barcode++
    if (sellingDiff) splitCause.selling++
    if (specialDiff) splitCause.special++
    if (costDiff) splitCause.cost++
    if (costDiff && !barcodeDiff && !sellingDiff && !specialDiff) splitCause['cost only']++
    if (specialDiff && !barcodeDiff && !sellingDiff && !costDiff) splitCause['special only']++

    if (samples.length < 4 && barcodeDiff) {
      samples.push({ name: members[0].name, members: members.map((m) => ({ id: m.id, barcode: m.barcode, usd: m.selling_price_usd, cost: m.cost_price_usd })) })
    }
  }
  console.log(`\ngroups whose rows all differ by details (real child rows) : ${legitimateChildGroups}`)
  console.log(`groups still containing identical-detail duplicates       : ${duplicateGroups} ${duplicateGroups === 0 ? 'OK' : '*** these should have merged ***'}`)
  console.log(`
what forces each split (a group can appear under more than one cause):`)
  for (const [cause, count] of Object.entries(splitCause)) console.log(`  ${cause.padEnd(12)}: ${count}`)
  if (samples.length) {
    console.log(`\nsample child-row groups (same name, different barcode -- these must NOT be lost):`)
    for (const s of samples) {
      console.log(`  "${s.name}"`)
      for (const m of s.members) console.log(`      id=${m.id} barcode=${m.barcode || '(none)'} usd=${m.usd} cost=${m.cost}`)
    }
  }

  // ---- branch_stock coverage --------------------------------------------
  const branches = await db.prepare(`SELECT id, name FROM branches WHERE is_active = 1`).all({})
  const missing = await db.prepare(`
    SELECT COUNT(*) AS c FROM products p
    CROSS JOIN branches b
    WHERE p.is_active = 1 AND b.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = b.id)
  `).get({})
  console.log(`\n=== BRANCH STOCK COVERAGE ("all rows, no exceptions") ===`)
  console.log(`active branches            : ${branches.length} (${branches.map((b) => b.name).join(', ')})`)
  console.log(`expected product x branch  : ${productCount * branches.length}`)
  console.log(`MISSING branch_stock rows  : ${missing.c} ${missing.c === 0 ? 'OK' : '*** every product must have a row per branch, 0 where absent ***'}`)
  if (missing.c > 0) {
    const offenders = await db.prepare(`
      SELECT p.id, p.name, b.name AS branch FROM products p CROSS JOIN branches b
      WHERE p.is_active = 1 AND b.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = b.id)
      LIMIT 10
    `).all({})
    console.log(`offending product x branch pairs:`)
    for (const o of offenders) console.log(`  id=${o.id} "${o.name}" has no row for branch "${o.branch}"`)
  }

  console.log('')
}

main().catch((e) => { console.error(e); process.exit(1) })
