// N14-D: a stock-in must name its supplier and its unit cost, and nothing may
// invent either one.
//
// The rule the owner set: supplier + unit cost are REQUIRED on a stock-in (an
// 'add', and a 'set' that raises the on-hand figure -- routes/inventory.ts
// converts exactly that case into an 'add'), not on a remove; a $0.00 cost is
// accepted only when the operator explicitly says the goods were free.
//
// This file evaluates the real kernel against the shared case table in
// scripts/fixtures/stock-receipt-gate-cases.json. frontend/tests/
// stockReceiptFields.test.ts runs the SAME table through the browser-side
// implementation and asserts the same codes, so the two sides cannot drift.
//
// The table is discriminating by construction: every prior implementation
// answered "" for the whole of it (there was no gate at all), and the three
// fabricating implementations this change removes -- `product.cost_price_usd
// || 0` (the old per-branch adjust form), `product.purchase_price_usd || 0`
// (BulkAddStockModal) and `expanded('unit_cost_usd') ?? product?.
// cost_price_usd` (lib/stockSession.ts) -- would each turn the four
// cost_required rows into a silent 0, i.e. into free goods nobody declared.
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.join(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-receipt-gate-'))
fs.copyFileSync(path.join(root, 'src', 'lib', 'stockReceiptGate.ts'), path.join(tmp, 'stockReceiptGate.ts'))
const version = execSync('npx tsc --version', { cwd: root, encoding: 'utf8' }).trim()
const ignore = /^Version\s+(?:[6-9]|\d{2,})\./.test(version) ? ' --ignoreConfig' : ''
execSync(`npx tsc "${path.join(tmp, 'stockReceiptGate.ts')}" --outDir "${tmp}" --module commonjs --target es2022 --strict --skipLibCheck${ignore}`, { cwd: root })
const kernel = require(path.join(tmp, 'stockReceiptGate.js'))

const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'stock-receipt-gate-cases.json'), 'utf8'))
assert.ok(table.cases.length >= 15, 'the shared table must actually exercise the rule')

for (const testCase of table.cases) {
  assert.equal(kernel.stockReceiptGateCode(testCase.input), testCase.code, testCase.name)
}

// Every refusal the kernel can produce has a sentence. A code with no message
// reaches the operator as an empty 400 body.
for (const code of kernel.STOCK_RECEIPT_GATE_CODES) {
  assert.ok(typeof kernel.stockReceiptGateMessage(code) === 'string' && kernel.stockReceiptGateMessage(code).length > 10,
    `code ${code} has no message`)
}
assert.equal(kernel.stockReceiptGateMessage(''), null, 'a pass has no message')
const codesInTable = new Set(table.cases.map((entry) => entry.code).filter(Boolean))
for (const code of kernel.STOCK_RECEIPT_GATE_CODES) {
  assert.ok(codesInTable.has(code), `the shared table never produces ${code}, so the frontend parity test never checks it`)
}

// A 'set' is only a receipt when it RAISES stock. Same rule as the frontend's
// isStockInSubmission -- kept here because the route re-derives it server-side
// from the branch's live quantity, not from whatever the browser believed.
assert.equal(kernel.isStockReceiptType('add', 5, 0), true)
assert.equal(kernel.isStockReceiptType('remove', 5, 99), false)
assert.equal(kernel.isStockReceiptType('set', 12, 4), true, 'a set above the on-hand figure becomes an add server-side')
assert.equal(kernel.isStockReceiptType('set', 4, 12), false, 'a set below the on-hand figure becomes a remove and carries no receipt facts')
assert.equal(kernel.isStockReceiptType('set', 4, 4), false, 'a set to the same figure moves nothing')

// ---- the enforcement points -----------------------------------------------
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const inventoryRoute = read(path.join('src', 'routes', 'inventory.ts'))
assert.match(inventoryRoute, /stockReceiptGateCode/, 'POST /adjust must enforce the gate, not just let the browser check it')
assert.match(inventoryRoute, /attribution/, 'the route must read the correction attribution explicitly rather than inferring an exemption')

// The third receipt wire. FastStockInModal's ordinary lines and
// ReceiveBatchModal post here, not to /api/inventory/adjust, so a gate on two
// of the four wires is not a gate at all.
const batchesRoute = read(path.join('src', 'routes', 'batches.ts'))
assert.match(batchesRoute, /stockReceiptGateCode/, 'POST /api/batches must enforce the same gate')
assert.match(batchesRoute, /lotSupplierName/, 'a top-up of an attributed lot must be allowed to inherit its supplier')

const session = read(path.join('src', 'lib', 'stockSession.ts'))
assert.match(session, /stockReceiptGateCode/, 'the unified stock-in session must enforce the same gate')
assert.doesNotMatch(session, /expanded\('unit_cost_usd'\) \?\? product\?\.cost_price_usd/,
  'the session parser must stop substituting the product cost price for a cost the operator never typed')
assert.match(session, /lotAttributionDeferred: batchId != null/,
  'a session line naming an existing lot defers the SUPPLIER half -- the picker sends null for an attributed lot, and refusing it would reject a complete receipt')

// The FOURTH wire, and the one that had no gate at all until sibling:F13: the
// stock-action FILE import. lib/stockActionCommit.ts INSERTs a product_batches
// row carrying supplier_id, supplier_name and unit_cost_usd, so a sheet with
// neither column filled minted exactly the receipt the three wires above
// refuse -- and a lot left with a blank cost is read downstream as goods that
// cost nothing, which nobody declared.
const importCommit = read(path.join('src', 'lib', 'stockActionCommit.ts'))
assert.match(importCommit, /stockReceiptGateCode/, 'the stock-action import writer must enforce the same gate')
assert.match(importCommit, /lot_supplier_name/,
  "the import add reads the target lot's supplier, so a top-up of an attributed lot is not asked to retype it")
const importDispatch = read(path.join('src', 'lib', 'importEngine.ts'))
assert.match(importDispatch, /unifiedStockReceiptRefusal/,
  'the import dispatcher asks the gate BEFORE it creates a product for a row the writer will refuse')

// ---- the census -----------------------------------------------------------
// The four surfaces that decide "a stock-in is happening" and must therefore
// ask the gate. Listed on purpose: the import spent its whole life off this
// list, and a fifth surface added without a line here is that same omission.
const RECEIPT_WIRES = [
  ['src/routes/inventory.ts', inventoryRoute],
  ['src/routes/batches.ts', batchesRoute],
  ['src/lib/stockSession.ts', session],
  ['src/lib/stockActionCommit.ts', importCommit],
]
assert.equal(RECEIPT_WIRES.length, 4, 'four wires decide a stock receipt; all four are gated')
for (const [name, source] of RECEIPT_WIRES) {
  assert.match(source, /stockReceiptGateCode/, `${name} lost its receipt gate`)
}
assert.doesNotMatch(read(path.join('src', 'lib', 'returnsStock.ts')), /stockReceiptGateCode/,
  'positive control: a stock writer that is NOT a receipt wire must not match, or this census proves nothing')

// A hand-kept list is only as good as the day it was written, so derive the
// candidates from the source instead: every file that INSERTs a
// product_batches row is a place a receipt can be minted. Each one must be
// CLASSIFIED below -- gated, or explicitly declared not-a-receipt with the
// reason. A new writer fails this until someone answers the question, which
// is exactly the step that was skipped for the import.
function tsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) return tsFiles(abs)
    return entry.isFile() && entry.name.endsWith('.ts') ? [abs] : []
  })
}
const LOT_INSERT_RE = /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+product_batches/i
const lotWriters = tsFiles(path.join(root, 'src'))
  .filter((abs) => LOT_INSERT_RE.test(fs.readFileSync(abs, 'utf8')))
  .map((abs) => path.relative(root, abs).split(path.sep).join('/'))
  .sort()
const LOT_WRITER_CLASSIFICATION = {
  // Gated here: this lane (sibling:F13).
  'src/lib/stockActionCommit.ts': 'gated',
  // Two unrelated things live in this file. The stock-action dispatcher is
  // gated (unifiedStockReceiptRefusal, asserted above). The PRODUCTS CSV
  // import's merge_stock/override lots are NOT: they record a unit cost only
  // when the sheet supplied one and never record a supplier at all, so that
  // path can still mint the both-blank receipt this gate refuses everywhere
  // else. Declared, not overlooked -- gating it is a separate change with its
  // own blast radius across the product importer.
  'src/lib/importEngine.ts': 'known-ungated: products CSV stock import',
  // The shared low-level receive writer, not a surface. Its receipt-originating
  // callers (routes/batches.ts, routes/inventory.ts POST /adjust) run the gate
  // before calling it; its other callers -- returns restock, stock revert,
  // branch transfer -- are corrections, the kernel's one declared exemption.
  'src/lib/productBatches.ts': 'gated-by-its-receipt-callers',
  // The `initial:<id>` lot stamped when a product is created. It writes no
  // supplier_id, no supplier_name and no unit_cost_usd, so it states nothing
  // the gate could check and invents nothing either.
  'src/lib/productWrites.ts': 'not-a-receipt: records no supplier and no cost',
}
assert.deepEqual(lotWriters, Object.keys(LOT_WRITER_CLASSIFICATION).sort(),
  'a file that INSERTs a product_batches row appeared or vanished -- classify it in LOT_WRITER_CLASSIFICATION (gated, or declared not-a-receipt with the reason) before this census can be believed again')

// The one create-products surface that builds its own lines. Its blank cost
// used to become 0 in the browser before the wire ever saw it, so the server
// gate above could not see a fabrication that had already happened.
const createModal = fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'components', 'products', 'CreateProductsSessionModal.tsx'), 'utf8')
assert.ok(!createModal.includes("cost_price_usd === '' ? 0"),
  'the Add/Create products session must not turn a blank cost into a free receipt before posting')
assert.ok(createModal.includes('stockReceiptGateCode('), 'both of its line paths run the same kernel the Worker runs')

// The unified stock-action import's own review screen. It raises a
// 'receipt_gate' issue per row carrying the kernel's own code (gateCode), but
// until sibling:F13's verifier round 2 that code was a zombie field: the
// renderer showed ONE sentence ('fill the cost column') for every code,
// including supplier_required and free_goods_required rows whose cost column
// IS filled and whose real remedy is a different column entirely. Every
// sibling gate surface (FastStockInModal, ReceiveBatchModal, Inventory.tsx,
// StockAdjustModal, CreateProductsSessionModal, BulkAddStockModal,
// BranchStockAdjuster) shows the refusal's OWN reason; this import review
// must too.
const stockActionImportModal = fs.readFileSync(
  path.join(root, '..', 'frontend', 'src', 'components', 'products', 'import', 'StockActionImportModal.tsx'),
  'utf8',
)
assert.match(stockActionImportModal, /STOCK_RECEIPT_GATE_KEYS/,
  'the stock-action import review must translate each receipt-gate issue through its OWN code, not one sentence for every refusal')

console.log(`PASS stock-in receipt gate: ${table.cases.length} shared cases, supplier+cost required, $0 only as declared free goods, corrections exempt, and all FOUR receipt wires enforced`)
