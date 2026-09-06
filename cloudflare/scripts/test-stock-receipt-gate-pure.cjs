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
// || 0` (BranchStockAdjuster), `product.purchase_price_usd || 0`
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
// of the three wires is not a gate at all.
const batchesRoute = read(path.join('src', 'routes', 'batches.ts'))
assert.match(batchesRoute, /stockReceiptGateCode/, 'POST /api/batches must enforce the same gate')
assert.match(batchesRoute, /lotSupplierName/, 'a top-up of an attributed lot must be allowed to inherit its supplier')

const session = read(path.join('src', 'lib', 'stockSession.ts'))
assert.match(session, /stockReceiptGateCode/, 'the unified stock-in session must enforce the same gate')
assert.doesNotMatch(session, /expanded\('unit_cost_usd'\) \?\? product\?\.cost_price_usd/,
  'the session parser must stop substituting the product cost price for a cost the operator never typed')
assert.match(session, /lotAttributionDeferred: batchId != null/,
  'a session line naming an existing lot defers the SUPPLIER half -- the picker sends null for an attributed lot, and refusing it would reject a complete receipt')

// The one create-products surface that builds its own lines. Its blank cost
// used to become 0 in the browser before the wire ever saw it, so the server
// gate above could not see a fabrication that had already happened.
const createModal = fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'components', 'products', 'CreateProductsSessionModal.tsx'), 'utf8')
assert.ok(!createModal.includes("cost_price_usd === '' ? 0"),
  'the Add/Create products session must not turn a blank cost into a free receipt before posting')
assert.ok(createModal.includes('stockReceiptGateCode('), 'both of its line paths run the same kernel the Worker runs')

console.log(`PASS stock-in receipt gate: ${table.cases.length} shared cases, supplier+cost required, $0 only as declared free goods, corrections exempt and enforced on both writers`)
