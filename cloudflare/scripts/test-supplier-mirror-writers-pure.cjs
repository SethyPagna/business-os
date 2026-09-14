// P3-L1: stock-in <-> supplier mirror. Every writer that receives, reverts,
// undoes or deactivates a lot must leave product_batches' supplier-facing
// columns (received_quantity 0067, received_cost_usd 0080, payment_status/
// credit_due_date 0065, supplier 0062, is_active) telling the truth, because
// Contacts DERIVES the supplier's purchases, stock-in invoices, "not paid"
// balance and credit reminders from those columns live -- nothing is stored
// per supplier. Owner: "when revert, edit, etc, for stockin, I want you to
// make it also edit automatically in the contacts supplier".
//
// The writers are the REAL modules compiled from source (tsc emit of
// lib/stockRevert.ts + lib/stockActionCommit.ts and their import graphs;
// lib/stockSession.ts through the shared session fixture), driven against the
// REAL migration chain. The readers are the REAL SQL extracted verbatim from
// routes/contacts.ts (per-supplier purchase totals, STOCK_IN_REPORT_SOURCE),
// routes/notifications.ts (credit reminders) and routes/batches.ts (DELETE
// deactivation) -- if a route's SQL drifts this fails loudly instead of
// testing a stale copy.
//
// Writer matrix pinned here:
//   W1 stock-session commit  -> lib/stockSession.ts       (purchase appears)
//   W2 stock-session undo    -> lib/stockSession.ts       (purchase gone)
//   W3 manual receive        -> lib/productBatches.ts receiveBatchStock
//                               (behind POST /api/inventory/adjust add and
//                               POST /api/batches)      (purchase appears)
//   W4 revert of a receipt   -> lib/stockRevert.ts        (purchase gone,
//                               credit reminder gone, invoice gone) -- the
//                               path behind StockInSessionsSection's "remove
//                               line"/"Remove session" and StockChangeSection's
//                               revert, POST /api/inventory/movements/:id/revert
//   W5 shared-lot revert     -> lib/stockRevert.ts        (only its own units
//                               and money leave; the sibling receipt stays)
//   W6 unified import add    -> lib/stockActionCommit.ts  (purchase appears)
//      + revert of it        -> lib/stockRevert.ts        (purchase gone)
//   W7 DELETE /api/batches/:id deactivation of a sold-out lot -> the purchase
//                               STAYS (deactivation is picker visibility, not
//                               an un-purchase; the sold units were bought)
//
// Discriminating inputs: before this lane, W4/W5/W6-revert left the lot's
// received figures and credit state untouched (a reverted stock-in kept
// showing as a purchase with an open "not paid" reminder), so every "gone"
// assertion below was red on the pre-fix kernel.
//
// Run: node scripts/test-supplier-mirror-writers-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')

let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// ---- compile the real writers ----------------------------------------------
const tscVersion = execSync('npx tsc --version', { cwd: cloudflareRoot, encoding: 'utf8' }).trim()
const ignoreConfigFlag = /^Version\s+(?:[6-9]|\d{2,})\./.test(tscVersion) ? ' --ignoreConfig' : ''
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supplier-mirror-'))
try {
  execSync(
    `npx tsc "${path.join(cloudflareRoot, 'src', 'lib', 'stockRevert.ts')}" "${path.join(cloudflareRoot, 'src', 'lib', 'stockActionCommit.ts')}" ` +
      `--outDir "${tmpDir}" --rootDir "${path.join(cloudflareRoot, 'src', 'lib')}" ` +
      `--module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck --noEmitOnError false${ignoreConfigFlag}`,
    { cwd: cloudflareRoot, stdio: 'pipe' },
  )
} catch (err) {
  // Cloudflare-only TYPES make the standalone compile exit non-zero; the
  // emitted JS is still correct (see test-stock-revert-pure.cjs).
  if (!fs.existsSync(path.join(tmpDir, 'stockRevert.js')) || !fs.existsSync(path.join(tmpDir, 'stockActionCommit.js'))) {
    console.error('tsc did not emit the writers:', String(err && err.stdout || err))
    throw err
  }
}
const stockRevert = require(path.join(tmpDir, 'stockRevert.js'))
const productBatches = require(path.join(tmpDir, 'productBatches.js'))
const stockActionCommit = require(path.join(tmpDir, 'stockActionCommit.js'))
ok(typeof stockRevert.applyMovementRevert === 'function' && typeof productBatches.receiveBatchStock === 'function'
  && typeof stockActionCommit.applyUnifiedStockAdd === 'function', 'real writers compiled')

// ---- extract the real readers ---------------------------------------------
const readSource = (rel) => fs.readFileSync(path.join(cloudflareRoot, 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const contactsSource = readSource('routes/contacts.ts')
const supplierWhereMatch = contactsSource.match(/const supplierWhere = `(\([\s\S]*?\))`/)
const totalsMatch = contactsSource.match(/const totalsRow = await db\.prepare\(`([\s\S]*?)`\)\.get</)
const reportSourceMatch = contactsSource.match(/const STOCK_IN_REPORT_SOURCE = `\n([\s\S]*?)`/)
assert.ok(supplierWhereMatch && totalsMatch && reportSourceMatch, 'contacts.ts still defines supplierWhere, the purchase totals query and STOCK_IN_REPORT_SOURCE')
const PURCHASE_TOTALS_SQL = totalsMatch[1].replace('${supplierWhere}', supplierWhereMatch[1])
const REPORT_SOURCE = reportSourceMatch[1]
const notificationsSource = readSource('routes/notifications.ts')
const creditSection = notificationsSource.slice(notificationsSource.indexOf('async function buildSupplierCreditSection'))
const creditMatch = creditSection.match(/db\.prepare\(`([\s\S]*?)`\)\.all</)
assert.ok(creditMatch, 'notifications.ts still defines the supplier credit reminder query')
const CREDIT_REMINDER_SQL = creditMatch[1]
const batchesSource = readSource('routes/batches.ts')
const deactivateMatch = batchesSource.match(/const deactivated = await db\.prepare\(`([\s\S]*?)`\)\.run/)
assert.ok(deactivateMatch, 'batches.ts still defines the DELETE deactivation update')
const DEACTIVATE_SQL = deactivateMatch[1]
ok(true, 'real reader SQL extracted from routes/contacts.ts, routes/notifications.ts, routes/batches.ts')

// Readers over any sqlite handle exposing prepare(sql).get/all(params) that
// returns plain rows synchronously -- both the node:sqlite harness and the
// better-sqlite3 session fixture do. Invoice lines are scoped to the supplier
// under test plus the "no supplier recorded" bucket a cleared lot could
// otherwise fall into.
const SUPPLIER = { id: 41, name: 'Acme Supply' }
function readers(sql) {
  const totals = () => {
    const row = sql.prepare(PURCHASE_TOTALS_SQL).get({ id: SUPPLIER.id, name: SUPPLIER.name.toLowerCase() })
    return {
      batches: Number(row.batches) || 0, units: Number(row.units_received) || 0,
      cost: Math.round((Number(row.cost_usd) || 0) * 100) / 100,
      creditOpen: Math.round((Number(row.credit_open_usd) || 0) * 100) / 100, creditBatches: Number(row.credit_batches) || 0,
    }
  }
  const reminders = () => sql.prepare(CREDIT_REMINDER_SQL).all({ days: 100000 }).length
  const invoiceLines = () => sql.prepare(`SELECT t.supplier_key AS key, t.received_quantity AS qty, t.received_cost_usd AS cost
    FROM (${REPORT_SOURCE}) t WHERE t.supplier_key IN (@key, 'none') ORDER BY t.id`).all({ key: `id:${SUPPLIER.id}` }).map((r) => ({ key: r.key, qty: r.qty, cost: r.cost }))
  return { totals, reminders, invoiceLines }
}

// ---- W1 / W2: stock-session commit and undo --------------------------------
;(async () => {
  {
    const api = loadStockSession()
    const f = fixture()
    f.sql.prepare('INSERT INTO suppliers (id, name) VALUES (?, ?)').run(SUPPLIER.id, SUPPLIER.name)
    const read = readers({ prepare: (s) => ({ get: (p) => f.sql.prepare(s).get(p), all: (p) => f.sql.prepare(s).all(p) }) })
    assert.deepEqual(read.totals(), { batches: 0, units: 0, cost: 0, creditOpen: 0, creditBatches: 0 })
    const receipt = await api.commitStockSession(f.env, user, {
      client_request_id: 'mirror-session-001', mode: 'stock_in',
      defaults: { supplier_id: SUPPLIER.id, supplier_name: SUPPLIER.name, branch_id: 1, received_date: '2026-09-05', payment_status: 'credit', credit_due_date: '2026-10-01' },
      items: [{ line_id: 'line-001', kind: 'receive', product_id: 1, quantity: 5, unit_cost_usd: 2 }],
    })
    assert.deepEqual(read.totals(), { batches: 1, units: 5, cost: 10, creditOpen: 10, creditBatches: 1 }, 'W1: the session is the supplier purchase')
    assert.equal(read.reminders(), 1, 'W1: the credit reminder exists')
    assert.deepEqual(read.invoiceLines(), [{ key: `id:${SUPPLIER.id}`, qty: 5, cost: 10 }], 'W1: one invoice line under the supplier')
    ok(true, 'W1 stock-session commit: purchase totals, credit reminder and invoice line all show the receipt')

    const payload = JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(receipt.actionHistoryId).undo_payload)
    await api.replayStockSession(f.env, user, 'undo', receipt.actionHistoryId, 0, payload)
    assert.deepEqual(read.totals(), { batches: 0, units: 0, cost: 0, creditOpen: 0, creditBatches: 0 }, 'W2: nothing left on the supplier')
    assert.equal(read.reminders(), 0, 'W2: the credit reminder is gone')
    assert.deepEqual(read.invoiceLines(), [], 'W2: the undone lot is not an invoice line (not even under "no supplier")')
    ok(true, 'W2 stock-session undo: purchase, credit reminder and invoice line all leave the supplier')
  }

  // ---- W3 / W4 / W5 / W6 / W7 on the node:sqlite harness -------------------
  const db = openDb(loadAll())
  const raw = { prepare: (s) => ({ get: (p) => ({ ...db.prepare(s).get(p) }), all: (p) => db.prepare(s).all(p).map((r) => ({ ...r })) }) }
  const read = readers(raw)
  db.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Main Store', 1)`).run({})
  db.prepare(`INSERT INTO suppliers (id, name) VALUES (@id, @name)`).run(SUPPLIER)
  const actor = { userId: 7, userName: 'tester' }
  const lotOf = (id) => ({ ...db.prepare(`SELECT is_active, supplier_id, supplier_name, unit_cost_usd, payment_status, credit_due_date,
    received_quantity, received_cost_usd, received_branch_id FROM product_batches WHERE id = @id`).get({ id }) })
  const stockOf = (productId) => ({
    product: Number(db.prepare('SELECT stock_quantity FROM products WHERE id = @id').get({ id: productId }).stock_quantity),
    branch: Number((db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @id AND branch_id = 1').get({ id: productId }) || { quantity: 0 }).quantity),
  })
  // POST /api/inventory/adjust (add) and POST /api/batches receive through
  // receiveBatchStock and then insert the movement stamped with the lot and
  // its own money -- this mirrors that insert (routes/inventory.ts ~:1790).
  function recordReceiptMovement(productId, batchId, quantity, unitCostUsd) {
    const inserted = db.prepare(`INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
      VALUES (@productId, 'p', 1, 'Main Store', 'add', @quantity, @unitCostUsd, @totalCostUsd, 'received', 'tester', CURRENT_TIMESTAMP, @batchId)`)
      .run({ productId, quantity, unitCostUsd, totalCostUsd: unitCostUsd == null ? null : unitCostUsd * quantity, batchId })
    return Number(inserted.meta.last_row_id)
  }
  const movementById = (id) => db.prepare('SELECT * FROM inventory_movements WHERE id = @id').get({ id })

  // W3: manual receive on credit.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (501, 'Toner', 'T-1', 'pcs', 0, 1)`).run({})
  const w3 = await productBatches.receiveBatchStock(db, {
    productId: 501, branchId: 1, quantity: 10, receivedDate: '2026-09-01',
    supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, unitCostUsd: 4, paymentStatus: 'credit', creditDueDate: '2026-10-01',
  })
  const w3Movement = recordReceiptMovement(501, w3.batchId, 10, 4)
  assert.deepEqual(read.totals(), { batches: 1, units: 10, cost: 40, creditOpen: 40, creditBatches: 1 })
  assert.equal(read.reminders(), 1)
  assert.deepEqual(read.invoiceLines(), [{ key: `id:${SUPPLIER.id}`, qty: 10, cost: 40 }])
  ok(true, 'W3 manual receive (adjust add / POST batches): purchase, credit reminder and invoice line show the receipt')

  // W4: revert that receipt from the ledger (remove line / remove session / revert).
  const r4 = await stockRevert.applyMovementRevert(db, movementById(w3Movement), actor)
  assert.equal(r4.ok, true, r4.error)
  assert.deepEqual(stockOf(501), { product: 0, branch: 0 })
  assert.deepEqual(read.totals(), { batches: 0, units: 0, cost: 0, creditOpen: 0, creditBatches: 0 }, 'W4: nothing left on the supplier')
  assert.equal(read.reminders(), 0, 'W4: the "not paid to supplier" reminder is gone')
  assert.deepEqual(read.invoiceLines(), [], 'W4: no invoice line, not even under "no supplier"')
  assert.deepEqual(lotOf(w3.batchId), {
    is_active: 0, supplier_id: null, supplier_name: null, unit_cost_usd: null, payment_status: null, credit_due_date: null,
    received_quantity: 0, received_cost_usd: 0, received_branch_id: null,
  })
  ok(true, 'W4 revert of a receipt: purchase, credit reminder and invoice line all leave the supplier automatically')

  // A same-day receipt AFTER the revert reuses the row and carries ITS OWN
  // supplier -- the cleared attribution is what makes that possible.
  db.prepare(`INSERT INTO suppliers (id, name) VALUES (42, 'Other Trading')`).run({})
  const w4b = await productBatches.receiveBatchStock(db, {
    productId: 501, branchId: 1, quantity: 3, receivedDate: '2026-09-01', supplierId: 42, supplierName: 'Other Trading', unitCostUsd: 6, paymentStatus: 'paid',
  })
  assert.equal(w4b.batchId, w3.batchId, 'same date, same lot row')
  const lot4b = lotOf(w3.batchId)
  assert.deepEqual(
    { supplier_id: lot4b.supplier_id, payment_status: lot4b.payment_status, received_quantity: lot4b.received_quantity, received_cost_usd: lot4b.received_cost_usd, is_active: lot4b.is_active },
    { supplier_id: 42, payment_status: 'paid', received_quantity: 3, received_cost_usd: 18, is_active: 1 },
  )
  assert.deepEqual(read.totals(), { batches: 0, units: 0, cost: 0, creditOpen: 0, creditBatches: 0 }, 'Acme is not charged for Other Trading\'s receipt')
  ok(true, 'a later same-day receipt on the emptied lot is attributed to ITS supplier, never the reverted one')

  // W5: two same-day receipts share one lot; reverting one leaves the other.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (502, 'Mask', 'M-1', 'pcs', 0, 1)`).run({})
  const a = await productBatches.receiveBatchStock(db, { productId: 502, branchId: 1, quantity: 10, receivedDate: '2026-09-03', supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, unitCostUsd: 4, paymentStatus: 'credit', creditDueDate: '2026-10-03' })
  const aMovement = recordReceiptMovement(502, a.batchId, 10, 4)
  const b = await productBatches.receiveBatchStock(db, { productId: 502, branchId: 1, quantity: 5, receivedDate: '2026-09-03', supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, unitCostUsd: 5 })
  const bMovement = recordReceiptMovement(502, b.batchId, 5, 5)
  assert.equal(b.batchId, a.batchId)
  assert.deepEqual(read.totals(), { batches: 1, units: 15, cost: 65, creditOpen: 65, creditBatches: 1 })
  const r5 = await stockRevert.applyMovementRevert(db, movementById(bMovement), actor)
  assert.equal(r5.ok, true, r5.error)
  assert.deepEqual(read.totals(), { batches: 1, units: 10, cost: 40, creditOpen: 40, creditBatches: 1 }, 'W5: only B\'s 5 units / $25 left; A stays on credit')
  assert.equal(read.reminders(), 1, 'W5: A\'s credit reminder stays')
  assert.deepEqual(read.invoiceLines(), [{ key: `id:${SUPPLIER.id}`, qty: 10, cost: 40 }])
  const r5b = await stockRevert.applyMovementRevert(db, movementById(aMovement), actor)
  assert.equal(r5b.ok, true, r5b.error)
  assert.deepEqual(read.totals(), { batches: 0, units: 0, cost: 0, creditOpen: 0, creditBatches: 0 })
  assert.equal(read.reminders(), 0)
  assert.deepEqual(stockOf(502), { product: 0, branch: 0 })
  ok(true, 'W5 shared lot: reverting one receipt removes only its own share; reverting the other empties the supplier')

  // W6: the unified stock import's add writer, then its revert.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (503, 'Serum', 'S-1', 'pcs', 0, 1)`).run({})
  await stockActionCommit.applyUnifiedStockAdd(db, {
    jobId: 'job-mirror', rowNumber: 2, productId: 503, productName: 'Serum', branchId: 1, branchName: 'Main Store',
    quantity: 6, date: '2026-09-04', batchLabel: '', supplierName: SUPPLIER.name, supplierId: SUPPLIER.id, costPriceUsd: 5,
  })
  assert.deepEqual(read.totals(), { batches: 1, units: 6, cost: 30, creditOpen: 0, creditBatches: 0 }, 'W6: the import receipt is the supplier purchase (no payment state on the sheet)')
  assert.deepEqual(read.invoiceLines(), [{ key: `id:${SUPPLIER.id}`, qty: 6, cost: 30 }])
  const importMovement = db.prepare(`SELECT * FROM inventory_movements WHERE product_id = 503 AND movement_type = 'add'`).get({})
  assert.ok(importMovement && importMovement.batch_id != null, 'the import stamps its movement with the lot (0084)')
  const r6 = await stockRevert.applyMovementRevert(db, importMovement, actor)
  assert.equal(r6.ok, true, r6.error)
  assert.deepEqual(read.totals(), { batches: 0, units: 0, cost: 0, creditOpen: 0, creditBatches: 0 }, 'W6: reverting the import receipt clears the purchase')
  assert.deepEqual(read.invoiceLines(), [])
  assert.deepEqual(stockOf(503), { product: 0, branch: 0 })
  ok(true, 'W6 unified import add + revert: the purchase appears and then leaves the supplier')

  // W7: DELETE /api/batches/:id deactivates a SOLD-OUT lot; the purchase stays.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (504, 'Balm', 'B-1', 'pcs', 0, 1)`).run({})
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
      supplier_id, supplier_name, unit_cost_usd, payment_status, received_quantity, received_branch_id, received_cost_usd)
    VALUES (8504, 504, '08012026', '08012026', '2026-01-08', 1, 1, @id, @name, 5, 'paid', 100, 1, 500)`).run(SUPPLIER)
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (8504, 1, 0)`).run({})
  assert.deepEqual(read.totals(), { batches: 1, units: 100, cost: 500, creditOpen: 0, creditBatches: 0 })
  const deactivated = db.prepare(DEACTIVATE_SQL).run({ id: 8504 })
  assert.equal(deactivated.meta.changes, 1, 'an empty lot can be deactivated')
  assert.equal(lotOf(8504).is_active, 0)
  assert.deepEqual(read.totals(), { batches: 1, units: 100, cost: 500, creditOpen: 0, creditBatches: 0 }, 'W7: the 100 units bought and sold are still a purchase')
  assert.deepEqual(read.invoiceLines(), [{ key: `id:${SUPPLIER.id}`, qty: 100, cost: 500 }], 'W7: the invoice line stays')
  ok(true, 'W7 DELETE deactivation of a sold-out lot keeps its purchase: is_active is picker visibility, not an un-purchase')

  console.log(`\nAll ${checks} supplier-mirror writer checks passed`)
})().catch((err) => { console.error(err); process.exitCode = 1 })
