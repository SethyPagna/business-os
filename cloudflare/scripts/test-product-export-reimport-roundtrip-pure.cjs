// SCAN2 U12: export the product catalog, open it in a spreadsheet, import it
// back. An unchanged file must move no stock and no cost; an edited one must
// land its edits and still move no stock; a row whose cost really changed may
// add stock only after an explicit reviewer decision.
//
// Both halves are the shipping code: the frontend exporter (productExport.ts),
// the CSV and XLSX writers and readers, the planner every upload passes
// through, the Worker's CSV parser, classifyProducts, the review gate SQL and
// the product write loop of runImportApply (extracted, as
// test-typed-cost-holds-native.cjs does) on the full migrated schema.
//
// Run (from cloudflare/): node scripts/test-product-export-reimport-roundtrip-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const workerSrc = path.join(ROOT, 'cloudflare', 'src')
const frontendSrc = path.join(ROOT, 'frontend', 'src')
const frontendModule = (relative) => import(pathToFileURL(path.join(frontendSrc, relative)).href)

const transpile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
}).outputText
const asyncNoop = async () => {}
const WORKER_STUBS = {
  './db': { getDb: (env) => env.DB },
  './cache': new Proxy({}, { get: () => asyncNoop }),
  '../durable-objects/broadcastHub': new Proxy({}, { get: () => asyncNoop }),
  '../index': {},
}
const workerCache = new Map()
function workerRequire(fromDir) {
  return (request) => {
    if (Object.prototype.hasOwnProperty.call(WORKER_STUBS, request)) return WORKER_STUBS[request]
    if (!request.startsWith('.')) return require(request)
    return loadWorker(path.resolve(fromDir, `${request}.ts`))
  }
}
function loadWorker(file) {
  if (workerCache.has(file)) return workerCache.get(file).exports
  const mod = { exports: {} }
  workerCache.set(file, mod)
  new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(file))(
    mod.exports, workerRequire(path.dirname(file)), mod, file, path.dirname(file),
  )
  return mod.exports
}
function compileWorkerSource(source, fileName) {
  const mod = { exports: {} }
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName,
  }).outputText
  new Function('exports', 'require', 'module', out)(mod.exports, workerRequire(path.join(workerSrc, 'lib')), mod)
  return mod.exports
}

const engineFile = path.join(workerSrc, 'lib', 'importEngine.ts')
const { classifyProducts } = loadWorker(engineFile)
const { parseCsvRows } = loadWorker(path.join(workerSrc, 'lib', 'importCsv.ts'))
const { buildUnresolvedProductReviewWhere } = loadWorker(path.join(workerSrc, 'lib', 'importReviewQuery.ts'))

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start > 0 && end > start, `locate ${startMarker.slice(0, 50)}`)
  return source.slice(start, end + endMarker.length)
}
const engineSource = fs.readFileSync(engineFile, 'utf8').replace(/\r\n/g, '\n')
const productLoop = extract(engineSource,
  '      // U-cost: the rows of this chunk that RECEIVE stock into an existing\n',
  '\n        finishProductRowWriteGroup()\n      }\n')
const { composeProducts } = compileWorkerSource(`
  import { planReconcileBranchSnapshot, resolveReceiptLotTarget } from './productBatches'
  import { catalogCostRecomputeStatement, typedCostEntryBeforeWriteStatement } from './catalogCostRecompute'
  import { multiplyMoney4 } from './moneyPrecision'
  import { normalizeSearchText, compactSearchText } from './searchMatch'
  export function composeProducts(ctx: any) {
    let { actionable, receiptCosts, autoMergeRecords, jobId, nowIso, productImportMode, productReplaceColumns,
      appliedRowGuards, rowGuardStatement, receiptLots, receiptBaselines, nextBatchId, productSeedBranchIds, importCostActor } = ctx
    const productStatementGroups: any[] = [], guardedGroups: any[] = [], statements: any[] = []
    ${productLoop}
    return [...productStatementGroups, ...statements.map((s: any) => [s]), ...guardedGroups]
  }
`, 'importRoundtripComposer.ts')

// The modal uploads the planner's rows, minus every '_' key, as a new CSV
// (BulkImportModal.buildCsvForServerReview). Mirrored here; pinned below.
const modalSource = fs.readFileSync(path.join(frontendSrc, 'components/products/import/BulkImportModal.tsx'), 'utf8').replace(/\r\n/g, '\n')
const uploadBuilder = extract(modalSource, 'const buildCsvForServerReview = (): string => {', '\n  }\n')
assert.match(uploadBuilder, /analyzeProductImportText\(csvData\?\.content \|\| '', \[\]\)\.rows/, 'the upload still starts from the planner rows')
assert.match(uploadBuilder, /filter\(\(\[key\]\) => !key\.startsWith\('_'\)\)/, 'the upload still drops client-only keys')
const csvEscape = (value) => {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
function modalUploadCsv(analyzeProductImportText, fileText) {
  const instructions = analyzeProductImportText(fileText, []).rows.map((row) => ({
    ...Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_'))),
    image_conflict_mode: row.image_conflict_mode || 'keep_existing',
    _field_rules: JSON.stringify({}),
  }))
  const headers = Array.from(instructions.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key))
    return set
  }, new Set(['name', 'sku', 'barcode', '_field_rules', 'image_conflict_mode'])))
  return [headers.join(','), ...instructions.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')
}

const SHOP = 1
const PRODUCTS = [
  // Sub-cent averaged costs: the export ceils them (1.2345 -> "1.24",
  // 1.2341 -> "1.24" where nearest would print "1.23"), the riel cost too.
  { name: 'Serum A', barcode: '8850001000017', cost: 1.2345, costKhr: 5061.4523, price: 3.5, qty: 24 },
  { name: 'Cream B', barcode: '8850001000024', cost: 1.2341, costKhr: 5059.81, price: 4, qty: 10 },
  { name: 'Toner C', barcode: '8850001000031', cost: 2.5, costKhr: 10250, price: 6, qty: 5 },
  // Khmer name and a leading-zero barcode must survive the trip unchanged.
  { name: 'ក្រែម​លាប​មុខ', barcode: '0885000100002', cost: 0.3333, costKhr: 1366.53, price: 1.25, qty: 7,
    discountStarts: '2026-10-05', discountEnds: '2026-12-31' },
]

function seedCatalog() {
  const database = openDb(loadAll())
  const raw = database.db
  raw.prepare("INSERT INTO branches(id, name, is_default, is_active) VALUES (?, 'Shop', 1, 1)").run(SHOP)
  let lotKey = 0
  for (const p of PRODUCTS) {
    const id = Number(raw.prepare(`INSERT INTO products(name, barcode, selling_price_usd, is_active, discount_enabled, discount_percent,
        discount_starts_at, discount_ends_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, NULL)`)
      .run(p.name, p.barcode, p.price, p.discountEnds ? 1 : 0, p.discountEnds ? 10 : 0, p.discountStarts || null, p.discountEnds || null).lastInsertRowid)
    const lotId = Number(raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at, received_quantity, received_branch_id)
      VALUES (?, ?, 1, ?, '2026-09-01', ?, ?)`).run(id, `seed-${++lotKey}`, p.cost, p.qty, SHOP).lastInsertRowid)
    raw.prepare('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, ?, ?)').run(lotId, SHOP, p.qty)
    raw.prepare('INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (?, ?, ?)').run(id, SHOP, p.qty)
    raw.prepare('UPDATE products SET stock_quantity = ?, cost_price_usd = ?, cost_price_khr = ?, purchase_price_usd = ? WHERE id = ?')
      .run(p.qty, p.cost, p.costKhr, p.cost, id)
  }
  return database
}

// What the Products page holds for each row: the product plus its branch list.
function catalogForExport(raw) {
  return raw.prepare('SELECT * FROM products ORDER BY id').all().map((product) => ({
    ...product,
    branch_stock: raw.prepare(`SELECT bs.branch_id, b.name AS branch_name, bs.quantity FROM branch_stock bs
      JOIN branches b ON b.id = bs.branch_id WHERE bs.product_id = ? ORDER BY bs.branch_id`).all(product.id),
  }))
}

function snapshot(raw) {
  return {
    products: raw.prepare(`SELECT id, name, barcode, stock_quantity, cost_price_usd, cost_price_khr, selling_price_usd,
      discount_starts_at, discount_ends_at FROM products ORDER BY id`).all(),
    branchStock: raw.prepare('SELECT product_id, branch_id, quantity FROM branch_stock ORDER BY product_id, branch_id').all(),
    lotStock: raw.prepare('SELECT batch_id, branch_id, quantity FROM branch_batch_stock ORDER BY batch_id, branch_id').all(),
    batches: raw.prepare('SELECT COUNT(*) AS n FROM product_batches').get().n,
    movements: raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,
    costEntries: raw.prepare('SELECT COUNT(*) AS n FROM product_cost_entries').get().n,
  }
}

async function analyze(database, uploadCsv, jobId) {
  const rows = parseCsvRows(uploadCsv)
  const results = await classifyProducts(database, rows, jobId, null, new Map())
  const insert = database.db.prepare(`INSERT INTO import_job_rows(job_id, phase, row_number, action, identifier, result_json)
    VALUES (?, 'analyze', ?, ?, ?, ?)`)
  for (const result of results) insert.run(jobId, result.rowNumber, result.action, result.identifier ?? null, JSON.stringify(result))
  return results
}

function unresolvedRows(database, jobId, decisions = {}) {
  const where = buildUnresolvedProductReviewWhere(jobId, JSON.stringify(decisions))
  return database.db.prepare(`SELECT row_number FROM import_job_rows WHERE ${where.sql} ORDER BY row_number`).all(where.params)
    .map((row) => row.row_number)
}

async function apply(database, results) {
  const raw = database.db
  const actionable = results.filter((row) => row.action === 'create' || row.action === 'update')
  const productIds = [...new Set(actionable.map((row) => Number(row.existingId)).filter(Boolean))]
  const receiptLots = new Map(productIds.map((id) => [id,
    raw.prepare('SELECT id, variant_product_id, batch_key, received_at, unit_cost_usd FROM product_batches WHERE variant_product_id = ?').all(id)]))
  const groups = composeProducts({
    actionable,
    receiptCosts: new Map(actionable.map((row) => [row.rowNumber,
      Number(row.data.__costPriceUsdProvided) === 1 ? (row.data.__receiptCostUsd ?? row.data.cost_price_usd) : null])),
    autoMergeRecords: [], jobId: 'job-roundtrip', nowIso: '2026-09-29T08:00:00.000Z', productImportMode: 'merge',
    productReplaceColumns: [], appliedRowGuards: new Set(), rowGuardStatement: () => ({ sql: 'SELECT 1', params: {} }),
    receiptLots, receiptBaselines: new Map(), nextBatchId: Number(raw.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM product_batches').get().n),
    productSeedBranchIds: [SHOP], importCostActor: { id: 1, name: 'admin' },
  })
  for (const group of groups) await database.batch(group)
}

let checks = 0
async function check(name, fn) {
  try { await fn(); checks += 1; console.log(`PASS ${name}`) }
  catch (error) { console.log(`FAIL ${name} - ${error.stack}`); process.exitCode = 1 }
}

async function main() {
  const { buildProductExportRows } = await frontendModule('components/products/helpers/productExport.ts')
  const { buildCSV, UTF8_BOM } = await frontendModule('utils/csv.ts')
  const { buildWorksheet } = await frontendModule('utils/xlsxExport.ts')
  const { parseImportFile } = await frontendModule('utils/spreadsheetImport.ts')
  const { analyzeProductImportText } = await frontendModule('components/products/import/productImportPlanner.ts')
  const XLSX = await import(pathToFileURL(require.resolve('xlsx', { paths: [path.join(ROOT, 'frontend')] })).href)

  const csvFile = (rows) => new File([UTF8_BOM, buildCSV(rows)], 'products.csv', { type: 'text/csv' })
  const xlsxFile = (rows) => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, buildWorksheet(rows), 'Products')
    return new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' })], 'products.xlsx')
  }
  const exportRows = (raw) => buildProductExportRows(catalogForExport(raw), { canViewCosts: true })
  const uploadOf = async (file) => modalUploadCsv(analyzeProductImportText, (await parseImportFile(file)).content)

  for (const [format, toFile] of [['CSV', csvFile], ['XLSX', xlsxFile]]) {
    await check(`${format}: re-importing an unchanged export adds no stock and moves no cost`, async () => {
      const database = seedCatalog()
      const before = snapshot(database.db)
      const results = await analyze(database, await uploadOf(toFile(exportRows(database.db))), `job-same-${format}`)
      assert.deepEqual(results.map((row) => row.action), PRODUCTS.map(() => 'update'), 'every row matches its own product')
      assert.deepEqual(results.map((row) => row.plannedMode ?? null), PRODUCTS.map(() => null), 'no row is read as a stock receipt')
      assert.deepEqual(unresolvedRows(database, `job-same-${format}`), [], 'nothing is held for a decision')
      await apply(database, results)
      assert.deepEqual(snapshot(database.db), before, 'stock, lots, cost, dates, names and barcodes are exactly as before')
    })

    await check(`${format}: an edited price on a sub-cent-cost product lands and the stock stays`, async () => {
      const database = seedCatalog()
      const before = snapshot(database.db)
      const rows = exportRows(database.db)
      rows[0].Selling_Price_USD = '3.75'
      const results = await analyze(database, await uploadOf(toFile(rows)), `job-edit-${format}`)
      assert.equal(results[0].plannedMode ?? null, null, 'a price edit is not a receipt')
      await apply(database, results)
      const after = snapshot(database.db)
      assert.equal(after.products[0].selling_price_usd, 3.75, 'the edit is applied, not dropped')
      assert.deepEqual({ ...after, products: after.products.map(({ selling_price_usd, ...rest }) => rest) },
        { ...before, products: before.products.map(({ selling_price_usd, ...rest }) => rest) },
        'nothing else moved')
    })
  }

  await check('a row whose cost really changed is a receipt that waits for an explicit decision', async () => {
    const database = seedCatalog()
    const rows = exportRows(database.db)
    rows[2].Cost_Price_USD = '2.80'
    const jobId = 'job-new-cost'
    const results = await analyze(database, await uploadOf(csvFile(rows)), jobId)
    const receipt = results[2]
    assert.equal(receipt.plannedMode, 'merge_stock', 'a genuinely different cost still reads as a new receipt')
    const warning = (receipt.warnings || []).find((w) => w.kind === 'stock_receipt')
    assert.ok(warning, 'the receipt row carries a stock_receipt warning')
    assert.match(warning.message, /\b5\b/, 'the warning names the quantity it would add')
    assert.match(warning.message, /Shop/, 'and the branch it would add it to')
    assert.deepEqual(results.filter((row) => row !== receipt).map((row) => row.plannedMode ?? null), [null, null, null])
    assert.deepEqual(unresolvedRows(database, jobId), [receipt.rowNumber], 'approval is refused until that row has a decision')
    assert.deepEqual(unresolvedRows(database, jobId, { [receipt.rowNumber]: { action: 'apply', field_overrides: { _action: 'override_replace' } } }), [])
  })

  await check('a four-decimal cost change reaches the server intact and is held as a receipt', async () => {
    const database = seedCatalog()
    const rows = exportRows(database.db)
    rows[0].Cost_Price_USD = '1.2301'
    const results = await analyze(database, await uploadOf(csvFile(rows)), 'job-4dp-cost')
    assert.equal(results[0].plannedMode, 'merge_stock', 'the upload must not round 1.2301 up to a cent that restates 1.2345')
    assert.ok((results[0].warnings || []).some((w) => w.kind === 'stock_receipt'))
  })

  await check('the reviewer\'s "update details; keep stock" decision lands the cost edit without adding stock', async () => {
    const database = seedCatalog()
    const before = snapshot(database.db)
    const rows = exportRows(database.db)
    rows[2].Cost_Price_USD = '2.80'
    const upload = await uploadOf(csvFile(rows))
    const parsed = parseCsvRows(upload).map((row) => (row._rowNumber === 4 ? { ...row, _action: 'override_replace' } : row))
    const results = await classifyProducts(database, parsed, 'job-keep-stock', null, new Map())
    assert.equal(results[2].plannedMode, 'override_replace')
    await apply(database, results)
    const after = snapshot(database.db)
    assert.deepEqual(after.branchStock, before.branchStock, 'no branch gained stock')
    assert.equal(after.movements, before.movements, 'no stock movement was written')
    assert.equal(after.batches, before.batches, 'no receipt lot was created')
    assert.equal(after.products[2].cost_price_usd, 2.65, 'the stated cost merged into the product (mean of 2.50 and 2.80)')
  })

  console.log(`\n${checks} product export round-trip checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
