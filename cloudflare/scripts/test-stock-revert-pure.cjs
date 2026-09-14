// Part 553 -- the Stock Change ledger's REVERT kernel (lib/stockRevert.ts):
// compiles the real module (+ its import graph) and drives applyMovementRevert
// against the REAL migration chain in node:sqlite, so the compensating
// counter-movement's effect on stock, the batch ledger and the movement row
// are all verified end to end. No writes to the repo; a temp build dir only.
//
// P3-L1 (supplier mirror): cases 5-9 pin what a revert does to the lot's
// supplier-facing columns (received_quantity/received_cost_usd/payment_status/
// credit_due_date/supplier/is_active) -- the figures Contacts derives
// purchases, "not paid" balances and credit reminders from. Each case is one
// on which the pre-fix kernel (stock only, lot figures untouched or inflated)
// and the fixed kernel disagree. Cases 10-14 pin the adversarial review's
// findings on e3bf6fbf (its probes J, A, CHAIN, I, H): a quantity correction
// is not a purchase, a full revert keeps the supplier so the un-revert brings
// the purchase back under it, revert chains classify by the root movement, a
// session-undo counter is refused, a single-lot FIFO drain is mirrored.
//
// Run: node scripts/test-stock-revert-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const tscVersion = execSync('npx tsc --version', { cwd: cloudflareRoot, encoding: 'utf8' }).trim()
const ignoreConfigFlag = /^Version\s+(?:[6-9]|\d{2,})\./.test(tscVersion) ? ' --ignoreConfig' : ''

let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// ---- compile the real kernel + its import graph ---------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-revert-'))
// The lib graph references Cloudflare-only TYPES (db.ts uses D1Database) that
// aren't in a standalone compile, so tsc reports type errors and exits non-zero
// -- but those names are erased at runtime, so the emitted JS is correct
// (db.js isn't even required at runtime; stockRevert imports it type-only).
// Emit anyway and proceed once the entry file is present.
try {
  execSync(
    `npx tsc "${path.join(cloudflareRoot, 'src', 'lib', 'stockRevert.ts')}" ` +
      `--outDir "${tmpDir}" --rootDir "${path.join(cloudflareRoot, 'src', 'lib')}" ` +
      `--module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck --noEmitOnError false${ignoreConfigFlag}`,
    { cwd: cloudflareRoot, stdio: 'pipe' },
  )
} catch (err) {
  if (!fs.existsSync(path.join(tmpDir, 'stockRevert.js'))) {
    console.error('tsc did not emit stockRevert.js:', String(err && err.stdout || err))
    throw err
  }
}
const kernel = require(path.join(tmpDir, 'stockRevert.js'))
ok(typeof kernel.applyMovementRevert === 'function', 'kernel compiled and exports applyMovementRevert')

// ---- pure decision --------------------------------------------------------
assert.deepEqual(kernel.planMovementRevert({ movement_type: 'add', quantity: 5 }), { revertible: true, revertType: 'remove', magnitude: 5 })
assert.deepEqual(kernel.planMovementRevert({ movement_type: 'out', quantity: 3 }), { revertible: true, revertType: 'add', magnitude: 3 })
assert.deepEqual(kernel.planMovementRevert({ movement_type: 'sale', quantity: 3 }), { revertible: false, reason: 'not_revertible' })
assert.deepEqual(kernel.planMovementRevert({ movement_type: 'transfer_out', quantity: 3 }), { revertible: false, reason: 'not_revertible' })
assert.deepEqual(kernel.planMovementRevert({ movement_type: 'set', quantity: 0 }), { revertible: false, reason: 'no_stock' })
ok(true, 'planMovementRevert: add->remove, out->add, sale/transfer non-revertible, zero-qty no-op')

// Purchase-side truth table: only the receipt allowlist shared with the
// ledger, the sessions list and the frontend (stockInSessionsQuery.ts) is a
// purchase; a correction, an adjustment, a removal or a legacy import row
// pointing at a lot is stock only. Counter-movements are classified by their
// ROOT (case 12), never by their own type.
for (const type of ['add', 'stock_in']) assert.equal(kernel.isReceiptMovementType(type), true, type)
for (const type of ['remove', 'set', 'adjustment', 'in', 'out', 'csv_import', 'sale']) assert.equal(kernel.isReceiptMovementType(type), false, type)
ok(true, 'isReceiptMovementType: add/stock_in are purchases; set/adjustment/remove/in/out/csv_import are stock-only')

// ---- real DB --------------------------------------------------------------
const db = openDb(loadAll())
ok(true, 'full migration chain applied')

db.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Main Store', 1)`).run({})
const actor = { userId: 7, userName: 'tester' }

async function stockOf(productId, branchId) {
  const p = await db.prepare('SELECT stock_quantity FROM products WHERE id = @id').get({ id: productId })
  const b = await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @p AND branch_id = @b').get({ p: productId, b: branchId })
  return { product: Number(p ? p.stock_quantity : 0), branch: Number(b ? b.quantity : 0) }
}
async function movementById(id) {
  return db.prepare('SELECT * FROM inventory_movements WHERE id = @id').get({ id })
}
async function counterFor(originalId) {
  return db.prepare('SELECT * FROM inventory_movements WHERE reference_id = @ref').get({ ref: `revert:${originalId}` })
}

;(async () => {
  // ---- case 1: revert a batch-less ADD (revert removes the stock) ----------
  // Batch-less because the batch primitives (receiveBatchStock /
  // removeStockFromBatch) are covered by their own pure tests; this test
  // pins the NEW orchestration -- direction, aggregate move, counter-movement,
  // double-revert guard -- against the real schema.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, cost_price_usd, cost_price_khr, is_active) VALUES (9201, 'Revert Cream', 'RC-1', 'pcs', 10, 99, 396000, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (9201, 1, 10)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, user_name, created_at)
    VALUES (5001, 9201, 'Revert Cream', 1, 'Main Store', 'add', 10, 4.25, 17000, 42.5, 170000, 'received', 'tester', '2026-08-20 10:00:00')`).run({})
  db.prepare(`UPDATE products SET cost_price_usd=123, cost_price_khr=492000 WHERE id=9201`).run({})

  const before1 = await stockOf(9201, 1)
  assert.deepEqual(before1, { product: 10, branch: 10 }, 'seeded add left 10 in stock (aggregate) before revert')
  const orig1 = await movementById(5001)
  const r1 = await kernel.applyMovementRevert(db, orig1, actor)
  assert.equal(r1.ok, true)
  assert.equal(r1.revertType, 'remove')
  assert.equal(r1.quantity, 10)
  const after1 = await stockOf(9201, 1)
  assert.deepEqual(after1, { product: 0, branch: 0 }, 'revert of the +10 add removed 10 -> back to 0 (aggregate)')
  const counter1 = await counterFor(5001)
  assert.ok(counter1, 'a counter-movement was recorded')
  assert.equal(counter1.movement_type, 'remove')
  assert.equal(Number(counter1.quantity), 10)
  assert.deepEqual(
    { unitUsd: counter1.unit_cost_usd, unitKhr: counter1.unit_cost_khr, totalUsd: counter1.total_cost_usd, totalKhr: counter1.total_cost_khr },
    { unitUsd: 4.25, unitKhr: 17000, totalUsd: 42.5, totalKhr: 170000 },
    'revert copies the original movement cost snapshot after catalog cost changes',
  )
  assert.match(String(counter1.reason), /Revert of #5001/)
  assert.equal(String(counter1.reference_id), 'revert:5001')
  ok(true, 'add reverts by removing the same quantity; aggregate and counter-movement all correct')

  // double-revert is refused
  const r1b = await kernel.applyMovementRevert(db, orig1, actor)
  assert.equal(r1b.ok, false)
  assert.equal(r1b.status, 409)
  ok(true, 'double-revert of the same movement is refused (409)')

  // ---- case 2: revert a batch-less OUT (revert adds the stock back) ---------
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (9202, 'Revert Serum', 'RS-1', 'pcs', 5, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (9202, 1, 5)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, user_name, created_at)
    VALUES (5101, 9202, 'Revert Serum', 1, 'Main Store', 'out', 2, NULL, NULL, NULL, NULL, 'bulk import removal', 'tester', '2026-08-21 10:00:00')`).run({})
  const orig2 = await movementById(5101)
  const r2 = await kernel.applyMovementRevert(db, orig2, actor)
  assert.equal(r2.ok, true)
  assert.equal(r2.revertType, 'add')
  const after2 = await stockOf(9202, 1)
  assert.deepEqual(after2, { product: 7, branch: 7 }, 'revert of the -2 out added 2 back -> 7 (aggregate)')
  const counter2 = await counterFor(5101)
  assert.equal(counter2.movement_type, 'add')
  assert.equal(Number(counter2.quantity), 2)
  assert.equal(counter2.unit_cost_usd, null)
  assert.equal(counter2.total_cost_usd, null)
  ok(true, 'batch-less outflow reverts by adding the stock back to the aggregate')

  // ---- case 3: non-revertible transactional type is refused ----------------
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at)
    VALUES (5201, 9202, 'Revert Serum', 1, 'Main Store', 'sale', 1, '', 'tester', '2026-08-22 10:00:00')`).run({})
  const r3 = await kernel.applyMovementRevert(db, await movementById(5201), actor)
  assert.equal(r3.ok, false)
  assert.equal(r3.status, 400)
  assert.match(r3.error, /sale, return, transfer or move/)
  const noCounter3 = await counterFor(5201)
  assert.equal(noCounter3, undefined, 'a refused revert writes no counter-movement')
  ok(true, 'a sale movement cannot be reverted from the stock ledger (refused, no stock moved)')

  // ---- case 4: revert-remove blocked when stock has since been consumed -----
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (9203, 'Revert Balm', 'RB-1', 'pcs', 0, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (9203, 1, 0)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at)
    VALUES (5301, 9203, 'Revert Balm', 1, 'Main Store', 'add', 4, 'received', 'tester', '2026-08-23 10:00:00')`).run({})
  const r4 = await kernel.applyMovementRevert(db, await movementById(5301), actor)
  assert.equal(r4.ok, false)
  assert.equal(r4.status, 400)
  assert.match(r4.error, /only 0 in stock/)
  ok(true, 'revert-remove is refused when the stock to remove is no longer there (never goes negative)')

  // ---- supplier mirror (P3-L1) ------------------------------------------
  const lotOf = async (id) => ({ ...(await db.prepare(`SELECT is_active, supplier_id, supplier_name, unit_cost_usd, payment_status, credit_due_date,
    received_quantity, received_cost_usd, received_branch_id FROM product_batches WHERE id = @id`).get({ id })) })
  const lotStock = async (id) => Number((await db.prepare('SELECT COALESCE(SUM(quantity), 0) AS q FROM branch_batch_stock WHERE batch_id = @id').get({ id })).q)

  // ---- case 5: two same-day receipts share ONE lot; reverting one subtracts
  // its OWN units and money and leaves the other receipt's purchase (and the
  // lot's supplier/credit state) intact. Pre-fix: 15 / 65 stayed as they were.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (9301, 'Mirror Toner', 'MT-1', 'pcs', 15, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (9301, 1, 15)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, credit_due_date, received_quantity, received_branch_id, received_cost_usd)
    VALUES (8301, 9301, '09032026', '09032026', '2026-03-09', 1, 1, 41, 'Acme Supply', 4, 'credit', '2026-10-01', 15, 1, 65)`).run({})
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (8301, 1, 15)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
    VALUES (6001, 9301, 'Mirror Toner', 1, 'Main Store', 'add', 10, 4, 40, 'Stock-in session A', 'tester', '2026-03-09 09:00:00', 8301),
           (6002, 9301, 'Mirror Toner', 1, 'Main Store', 'add', 5, 5, 25, 'Stock-in session B', 'tester', '2026-03-09 15:00:00', 8301)`).run({})
  const r5 = await kernel.applyMovementRevert(db, await movementById(6002), actor)
  assert.equal(r5.ok, true, r5.error)
  assert.equal(r5.usedBatchId, 8301)
  assert.deepEqual(await stockOf(9301, 1), { product: 10, branch: 10 })
  assert.equal(await lotStock(8301), 10)
  assert.deepEqual(await lotOf(8301), {
    is_active: 1, supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 4, payment_status: 'credit', credit_due_date: '2026-10-01',
    received_quantity: 10, received_cost_usd: 40, received_branch_id: 1,
  }, 'shared lot keeps the OTHER receipt: 10 units / $40, still on credit, still Acme')
  assert.equal(Number((await counterFor(6002)).batch_id), 8301, 'counter-movement is stamped with the lot')
  ok(true, 'reverting one of two same-day receipts subtracts only its own units and money from the shared lot')

  // ---- case 6: reverting the last receipt empties the lot: nothing is owed
  // (payment/credit cleared, money 0), the attribution that belonged to the
  // reverted receipt is cleared and the lot leaves the pickers. Pre-fix: the
  // lot stayed active, on credit, with 10 units / $40 "received".
  const r6 = await kernel.applyMovementRevert(db, await movementById(6001), actor)
  assert.equal(r6.ok, true, r6.error)
  assert.deepEqual(await stockOf(9301, 1), { product: 0, branch: 0 })
  assert.deepEqual(await lotOf(8301), {
    is_active: 0, supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 4, payment_status: 'credit', credit_due_date: '2026-10-01',
    received_quantity: 0, received_cost_usd: 0, received_branch_id: 1,
  }, 'fully reverted lot: nothing received, no money, supplier and credit state kept for an un-revert, inactive')
  ok(true, 'reverting the last receipt on a lot zeroes its figures and deactivates it; supplier and payment state stay on the row')

  // ---- case 7: reverting the revert of a receipt puts the purchase back on
  // the same lot -- units, money, and the supplier/credit state the row kept.
  const counter6001 = await counterFor(6001)
  const r7 = await kernel.applyMovementRevert(db, await movementById(counter6001.id), actor)
  assert.equal(r7.ok, true, r7.error)
  assert.equal(r7.revertType, 'add')
  assert.deepEqual(await stockOf(9301, 1), { product: 10, branch: 10 })
  assert.equal(await lotStock(8301), 10)
  assert.deepEqual(await lotOf(8301), {
    is_active: 1, supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 4, payment_status: 'credit', credit_due_date: '2026-10-01',
    received_quantity: 10, received_cost_usd: 40, received_branch_id: 1,
  }, 'revert of a revert re-receives 10 units / $40 on the same lot, still Acme on credit')
  ok(true, 'reverting a revert counter-movement re-receives the purchase on the same lot under the same supplier')

  // ---- case 8: reverting a PLAIN removal (consumption, not a receipt) puts
  // the stock back without counting it as received again. The lot was
  // emptied by the removal and deactivated (the schema forbids positive stock
  // on an inactive lot), so the revert must also reactivate it. Pre-fix: the
  // lot's received_quantity went 20 -> 40 (receiveBatchStock top-up).
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (9302, 'Mirror Mask', 'MM-1', 'pcs', 0, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (9302, 1, 0)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, received_quantity, received_branch_id, received_cost_usd)
    VALUES (8302, 9302, '09022026', '09022026', '2026-02-09', 0, 1, 41, 'Acme Supply', 5, 'paid', 20, 1, 100)`).run({})
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (8302, 1, 0)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
    VALUES (6101, 9302, 'Mirror Mask', 1, 'Main Store', 'remove', 20, 5, 100, 'damaged', 'tester', '2026-02-10 09:00:00', 8302)`).run({})
  const r8 = await kernel.applyMovementRevert(db, await movementById(6101), actor)
  assert.equal(r8.ok, true, r8.error)
  assert.equal(r8.usedBatchId, 8302)
  assert.deepEqual(await stockOf(9302, 1), { product: 20, branch: 20 })
  assert.equal(await lotStock(8302), 20)
  assert.deepEqual(await lotOf(8302), {
    is_active: 1, supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 5, payment_status: 'paid', credit_due_date: null,
    received_quantity: 20, received_cost_usd: 100, received_branch_id: 1,
  }, 'restored removal: lot active again, received figures unchanged (20 / $100)')
  ok(true, 'reverting a plain removal restores lot stock without inflating what was received')

  // ---- case 9: a lot that never tracked receipts (pre-0067 NULL) is not
  // guessed to 0 and its payment state is left alone.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (9303, 'Legacy Lotion', 'LL-1', 'pcs', 8, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (9303, 1, 8)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, credit_due_date, received_quantity, received_cost_usd)
    VALUES (8303, 9303, '01012026', '01012026', '2026-01-01', 1, 1, 41, 'Acme Supply', 2, 'credit', '2026-12-01', NULL, NULL)`).run({})
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (8303, 1, 8)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
    VALUES (6201, 9303, 'Legacy Lotion', 1, 'Main Store', 'add', 3, 2, 6, 'received', 'tester', '2026-01-02 09:00:00', 8303)`).run({})
  const r9 = await kernel.applyMovementRevert(db, await movementById(6201), actor)
  assert.equal(r9.ok, true, r9.error)
  assert.deepEqual(await stockOf(9303, 1), { product: 5, branch: 5 })
  assert.deepEqual(await lotOf(8303), {
    is_active: 1, supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 2, payment_status: 'credit', credit_due_date: '2026-12-01',
    received_quantity: null, received_cost_usd: null, received_branch_id: null,
  }, 'untracked legacy lot: received stays NULL, credit state untouched')
  ok(true, 'a pre-0067 lot with NULL received figures is never guessed to 0 by a revert')

  // ---- case 10: a lot QUANTITY CORRECTION ('set', routes/batches.ts) is not
  // a purchase. Reverting it moves stock only; the received figures and the
  // supplier's credit stay -- partial and whole-lot alike. Review probe J: on
  // e3bf6fbf the partial revert took received 10 -> 8 and the whole-lot
  // revert wiped the supplier, the credit and the $50 invoice line.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (7011, 'Probe J', 'PJ-1', 'pcs', 12, 1), (7012, 'Probe J2', 'PJ-2', 'pcs', 10, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (7011, 1, 12), (7012, 1, 10)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, credit_due_date, received_quantity, received_branch_id, received_cost_usd)
    VALUES (7111, 7011, '01132026', '01132026', '2026-01-13', 1, 1, 41, 'Acme Supply', 5, 'credit', '2026-11-01', 10, 1, 50),
           (7112, 7012, '01142026', '01142026', '2026-01-14', 1, 1, 41, 'Acme Supply', 5, 'credit', '2026-11-01', 10, 1, 50)`).run({})
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (7111, 1, 12), (7112, 1, 10)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, movement_type, quantity, reason, user_id, user_name, created_at, batch_id)
    VALUES (6301, 7011, 'Probe J', 1, 'set', 2, 'Quantity correction (received date #7111)', 7, 'tester', '2026-01-14 09:00:00', 7111),
           (6302, 7012, 'Probe J2', 1, 'set', 10, 'Quantity correction (received date #7112)', 7, 'tester', '2026-01-15 09:00:00', 7112)`).run({})
  const creditLot = { supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 5, payment_status: 'credit', credit_due_date: '2026-11-01', received_quantity: 10, received_cost_usd: 50, received_branch_id: 1 }
  const r10 = await kernel.applyMovementRevert(db, await movementById(6301), actor)
  assert.equal(r10.ok, true, r10.error)
  assert.deepEqual(await stockOf(7011, 1), { product: 10, branch: 10 })
  assert.deepEqual(await lotOf(7111), { is_active: 1, ...creditLot }, 'partial correction reverted: stock 12 -> 10, purchase figures untouched')
  const r10b = await kernel.applyMovementRevert(db, await movementById(6302), actor)
  assert.equal(r10b.ok, true, r10b.error)
  assert.deepEqual(await stockOf(7012, 1), { product: 0, branch: 0 })
  assert.deepEqual(await lotOf(7112), { is_active: 1, ...creditLot }, 'whole-lot correction reverted: stock 0, the $50 credit purchase is still the supplier\'s')
  ok(true, 'reverting a lot quantity correction (set) moves stock only; received figures and credit stay')

  // ---- case 11: revert, then revert of the revert: the supplier and the
  // credit state ride through both. Review probe A / pREAD shape 1: on
  // e3bf6fbf the full revert cleared the attribution, so the un-revert put
  // the $40 credit back under "No supplier recorded".
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (7001, 'Probe A', 'PA-1', 'pcs', 10, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (7001, 1, 10)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, credit_due_date, received_quantity, received_branch_id, received_cost_usd)
    VALUES (7101, 7001, '03092026', '03092026', '2026-03-09', 1, 1, 41, 'Acme Supply', 4, 'credit', '2026-10-01', 10, 1, 40)`).run({})
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (7101, 1, 10)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
    VALUES (6401, 7001, 'Probe A', 1, 'Main Store', 'add', 10, 4, 40, 'Stock-in A', 'tester', '2026-03-09 09:00:00', 7101)`).run({})
  const acmeCredit = { supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 4, payment_status: 'credit', credit_due_date: '2026-10-01', received_branch_id: 1 }
  const r11 = await kernel.applyMovementRevert(db, await movementById(6401), actor)
  assert.equal(r11.ok, true, r11.error)
  assert.deepEqual(await lotOf(7101), { is_active: 0, received_quantity: 0, received_cost_usd: 0, ...acmeCredit }, 'reverted: figures zero, attribution kept, inactive')
  const r11b = await kernel.applyMovementRevert(db, await counterFor(6401), actor)
  assert.equal(r11b.ok, true, r11b.error)
  assert.deepEqual(await stockOf(7001, 1), { product: 10, branch: 10 })
  assert.deepEqual(await lotOf(7101), { is_active: 1, received_quantity: 10, received_cost_usd: 40, ...acmeCredit }, 'un-reverted: the $40 credit purchase is Acme\'s again')
  ok(true, 'revert then revert-of-revert keeps the supplier and credit state on the lot throughout')

  // ---- case 12: a revert chain classifies by the ROOT movement's type, not
  // by the counter's own type. Review probe CHAIN: level 3 is an 'add' whose
  // root is the receipt -- on e3bf6fbf it was read as "revert of a removal"
  // and left an active lot with 10 / $40, zero stock and a phantom invoice.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (7007, 'Probe Chain', 'PCH-1', 'pcs', 10, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (7007, 1, 10)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, received_quantity, received_branch_id, received_cost_usd)
    VALUES (7107, 7007, '09092026', '09092026', '2026-09-09', 1, 1, 41, 'Acme Supply', 4, 'paid', 10, 1, 40)`).run({})
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (7107, 1, 10)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
    VALUES (6501, 7007, 'Probe Chain', 1, 'Main Store', 'add', 10, 4, 40, 'receipt', 'tester', '2026-09-09 09:00:00', 7107)`).run({})
  const acmePaid = { supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 4, payment_status: 'paid', credit_due_date: null, received_branch_id: 1 }
  const chain = [
    { level: 1, type: 'add', is_active: 0, received_quantity: 0, received_cost_usd: 0, stock: 0 },
    { level: 2, type: 'remove', is_active: 1, received_quantity: 10, received_cost_usd: 40, stock: 10 },
    { level: 3, type: 'add', is_active: 0, received_quantity: 0, received_cost_usd: 0, stock: 0 },
  ]
  let chainCursor = 6501
  for (const { level, type, stock, ...lotExpect } of chain) {
    const row = await movementById(chainCursor)
    assert.equal(row.movement_type, type, `level ${level} reverts a '${type}'`)
    const root = await kernel.revertRootMovement(db, row)
    assert.equal(root && root.id, 6501, `level ${level} resolves to the receipt`)
    const res = await kernel.applyMovementRevert(db, row, actor)
    assert.equal(res.ok, true, res.error)
    assert.deepEqual(await lotOf(7107), { ...acmePaid, ...lotExpect }, `level ${level}: lot`)
    assert.equal(await lotStock(7107), stock, `level ${level}: lot stock`)
    chainCursor = (await counterFor(chainCursor)).id
  }
  // The removal chain: the counter of case 8's plain removal is an 'add'
  // whose root is a removal -- reverting it takes the stock out again and
  // leaves the purchase (20 / $100) alone.
  const removalCounter = await counterFor(6101)
  assert.equal((await kernel.revertRootMovement(db, removalCounter)).movement_type, 'remove')
  const r12 = await kernel.applyMovementRevert(db, removalCounter, actor)
  assert.equal(r12.ok, true, r12.error)
  assert.deepEqual(await stockOf(9302, 1), { product: 0, branch: 0 })
  const lot12 = await lotOf(8302)
  assert.deepEqual(
    { received_quantity: lot12.received_quantity, received_cost_usd: lot12.received_cost_usd, supplier_id: lot12.supplier_id, payment_status: lot12.payment_status },
    { received_quantity: 20, received_cost_usd: 100, supplier_id: 41, payment_status: 'paid' },
  )
  ok(true, 'revert chains classify by the root: receipt -> un-receive -> re-receive -> un-receive; a removal chain stays stock-only')

  // ---- case 13: the counter-movement a stock-in session's UNDO wrote
  // (reference_id = the operation's rowid, no stock_session_members row) is
  // refused with a 409 naming the session; the session's original receipt
  // row (a member) stays revertible. Review probe I: on e3bf6fbf the undo
  // row reverted as a plain removal -- stock back, purchase not.
  db.prepare(`INSERT INTO stock_session_operations (id, actor_id, request_id, mode, request_json) VALUES ('op-13', 7, 'req-13', 'stock_in', '{}')`).run({})
  const opRowid = Number((await db.prepare(`SELECT rowid AS r FROM stock_session_operations WHERE id = 'op-13'`).get({})).r)
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (7010, 'Probe I', 'PI-1', 'pcs', 5, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (7010, 1, 5)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, received_quantity, received_branch_id, received_cost_usd)
    VALUES (7110, 7010, '12092026', '12092026', '2026-12-09', 1, 1, 41, 'Acme Supply', 3, 'paid', 5, 1, 15)`).run({})
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (7110, 1, 5)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, reference_id, user_id, user_name, created_at, batch_id)
    VALUES (6601, 7010, 'Probe I', 1, 'Main Store', 'add', 5, 3, 15, 'Stock-in session op-13', @op, 7, 'tester', '2026-12-09 09:00:00', 7110),
           (6602, 7010, 'Probe I', 1, 'Main Store', 'remove', 5, 3, 15, 'Stock session op-13 undo generation 1', @op, 7, 'tester', '2026-12-09 10:00:00', 7110)`).run({ op: opRowid })
  db.prepare(`INSERT INTO stock_session_members (operation_id, line_id, command_kind, product_id, branch_id, batch_id, movement_id, quantity, unit_cost_usd)
    VALUES ('op-13', 'l1', 'receive', 7010, 1, 7110, 6601, 5, 3)`).run({})
  const lotBefore13 = await lotOf(7110)
  const r13 = await kernel.applyMovementRevert(db, await movementById(6602), actor)
  assert.equal(r13.ok, false)
  assert.equal(r13.status, 409)
  assert.match(r13.error, /stock-in session op-13/)
  assert.equal(await counterFor(6602), undefined, 'refused: no counter-movement')
  assert.deepEqual(await stockOf(7010, 1), { product: 5, branch: 5 }, 'refused: no stock moved')
  assert.deepEqual(await lotOf(7110), lotBefore13, 'refused: lot untouched')
  const r13b = await kernel.applyMovementRevert(db, await movementById(6601), actor)
  assert.equal(r13b.ok, true, r13b.error)
  assert.deepEqual(await lotOf(7110), { ...lotBefore13, is_active: 0, received_quantity: 0, received_cost_usd: 0 }, 'the session\'s own receipt row is still revertible')
  ok(true, 'a stock-session undo counter-movement is refused (409, session named); the session receipt itself stays revertible')

  // ---- case 14: a pre-0084 receipt (no lot stamp) whose FIFO drain resolves
  // to exactly ONE lot covering all of it is mirrored on that lot (review
  // probe H); spread across two lots there is no honest target and only the
  // stock moves.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (7009, 'Probe H', 'PH-1', 'pcs', 5, 1), (7019, 'Probe H2', 'PH-2', 'pcs', 6, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (7009, 1, 5), (7019, 1, 6)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, credit_due_date, received_quantity, received_branch_id, received_cost_usd)
    VALUES (7109, 7009, '11092026', '11092026', '2026-11-09', 1, 1, 41, 'Acme Supply', 2, 'credit', '2026-12-01', 5, 1, 10),
           (7119, 7019, '01012026', '01012026', '2026-01-01', 1, 1, 41, 'Acme Supply', 2, 'paid', NULL, 3, 1, 6),
           (7129, 7019, '01022026', '01022026', '2026-01-02', 1, 2, 41, 'Acme Supply', 2, 'paid', NULL, 3, 1, 6)`).run({})
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (7109, 1, 5), (7119, 1, 3), (7129, 1, 3)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
    VALUES (6701, 7009, 'Probe H', 1, 'Main Store', 'add', 5, 2, 10, 'legacy receipt, no stamp', 'tester', '2026-11-09 09:00:00', NULL),
           (6702, 7019, 'Probe H2', 1, 'Main Store', 'add', 6, 2, 12, 'legacy receipt, no stamp', 'tester', '2026-01-02 09:00:00', NULL)`).run({})
  const r14 = await kernel.applyMovementRevert(db, await movementById(6701), actor)
  assert.equal(r14.ok, true, r14.error)
  assert.equal(r14.usedBatchId, 7109)
  assert.deepEqual(await stockOf(7009, 1), { product: 0, branch: 0 })
  assert.deepEqual(await lotOf(7109), {
    is_active: 0, supplier_id: 41, supplier_name: 'Acme Supply', unit_cost_usd: 2, payment_status: 'credit', credit_due_date: '2026-12-01',
    received_quantity: 0, received_cost_usd: 0, received_branch_id: 1,
  }, 'single-lot drain: the lot is un-received')
  assert.equal(Number((await counterFor(6701)).batch_id), 7109)
  const r14b = await kernel.applyMovementRevert(db, await movementById(6702), actor)
  assert.equal(r14b.ok, true, r14b.error)
  assert.equal(r14b.usedBatchId, null)
  assert.deepEqual(await stockOf(7019, 1), { product: 0, branch: 0 })
  for (const id of [7119, 7129]) {
    const lot = await lotOf(id)
    assert.deepEqual({ received_quantity: lot.received_quantity, received_cost_usd: lot.received_cost_usd, supplier_id: lot.supplier_id }, { received_quantity: 3, received_cost_usd: 6, supplier_id: 41 }, `lot ${id} untouched`)
  }
  ok(true, 'a batch-less receipt is mirrored only when its FIFO drain resolves to exactly one lot')

  console.log(`\nAll ${checks} stock-revert kernel checks passed`)
})().catch((err) => { console.error(err); process.exitCode = 1 })
