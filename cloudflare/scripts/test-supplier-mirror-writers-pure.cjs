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
const PURCHASE_TOTALS_SQL = totalsMatch[1]
  // P3-10 (contacts lane) filters the totals by the Start->End range; with no
  // range set purchasesWhere IS supplierWhere, so both spellings resolve to it.
  .replace('${purchasesWhere}', supplierWhereMatch[1]).replace('${supplierWhere}', supplierWhereMatch[1])
assert.ok(!PURCHASE_TOTALS_SQL.includes('${'), 'the purchase totals query was extracted whole -- no template placeholder survived')
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
    is_active: 0, supplier_id: SUPPLIER.id, supplier_name: SUPPLIER.name, unit_cost_usd: 4, payment_status: 'credit', credit_due_date: '2026-10-01',
    received_quantity: 0, received_cost_usd: 0, received_branch_id: 1,
  }, 'W4: the row keeps its attribution (for an un-revert); the readers treat "nothing received, no money" as no purchase')
  ok(true, 'W4 revert of a receipt: purchase, credit reminder and invoice line all leave the supplier automatically')

  // A differently priced same-day receipt AFTER revert gets its own lot and
  // supplier; the historical emptied lot retains its original attribution.
  db.prepare(`INSERT INTO suppliers (id, name) VALUES (42, 'Other Trading')`).run({})
  const w4b = await productBatches.receiveBatchStock(db, {
    productId: 501, branchId: 1, quantity: 3, receivedDate: '2026-09-01', supplierId: 42, supplierName: 'Other Trading', unitCostUsd: 6, paymentStatus: 'paid',
  })
  assert.notEqual(w4b.batchId, w3.batchId, 'same date with a new price gets a separate lot')
  assert.equal(lotOf(w3.batchId).supplier_id, SUPPLIER.id, 'historical emptied lot retains original supplier')
  assert.equal(lotOf(w3.batchId).received_quantity, 0)
  const lot4b = lotOf(w4b.batchId)
  assert.deepEqual(
    { supplier_id: lot4b.supplier_id, payment_status: lot4b.payment_status, received_quantity: lot4b.received_quantity, received_cost_usd: lot4b.received_cost_usd, is_active: lot4b.is_active },
    { supplier_id: 42, payment_status: 'paid', received_quantity: 3, received_cost_usd: 18, is_active: 1 },
  )
  assert.deepEqual(read.totals(), { batches: 0, units: 0, cost: 0, creditOpen: 0, creditBatches: 0 }, 'Acme is not charged for Other Trading\'s receipt')
  ok(true, 'a later same-day differently priced receipt gets its own lot and supplier, never the reverted supplier')

  // W4-null: a lot zeroed with an OLD supplier, then a NEW receipt that
  // carries NO supplier at all, must NOT inherit the old one -- the zeroed
  // lot's attribution is not "sticky" once fully reverted (received_quantity
  // 0 AND is_active 0); only a still-live lot keeps first-attribution-sticks
  // (control block right after this one).
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (506, 'Toner Refill', 'T-2', 'pcs', 0, 1)`).run({})
  const w4n = await productBatches.receiveBatchStock(db, {
    productId: 506, branchId: 1, quantity: 5, receivedDate: '2026-09-01', supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, unitCostUsd: 3,
  })
  const w4nMovement = recordReceiptMovement(506, w4n.batchId, 5, 3)
  const r4n = await stockRevert.applyMovementRevert(db, movementById(w4nMovement), actor)
  assert.equal(r4n.ok, true, r4n.error)
  assert.deepEqual(
    { supplier_id: lotOf(w4n.batchId).supplier_id, received_quantity: lotOf(w4n.batchId).received_quantity, is_active: lotOf(w4n.batchId).is_active },
    { supplier_id: SUPPLIER.id, received_quantity: 0, is_active: 0 },
    'precondition: lot zeroed, still carrying OldSup\'s attribution',
  )
  const w4nNext = await productBatches.receiveBatchStock(db, {
    productId: 506, branchId: 1, quantity: 4, receivedDate: '2026-09-01', unitCostUsd: 3,
  })
  const w4nNextMovement = recordReceiptMovement(506, w4nNext.batchId, 4, 3)
  assert.equal(w4nNext.batchId, w4n.batchId, 'same date and price reuses the emptied lot row')
  const lot4n = lotOf(w4n.batchId)
  assert.deepEqual(
    { supplier_id: lot4n.supplier_id, supplier_name: lot4n.supplier_name, received_quantity: lot4n.received_quantity, unit_cost_usd: lot4n.unit_cost_usd },
    { supplier_id: null, supplier_name: null, received_quantity: 4, unit_cost_usd: 3 },
    'a NO-SUPPLIER receipt on a zeroed lot clears the old supplier entirely -- it does not inherit OldSup',
  )
  assert.deepEqual(read.totals(), { batches: 0, units: 0, cost: 0, creditOpen: 0, creditBatches: 0 }, 'OldSup is not charged for the unattributed receipt')
  ok(true, 'a no-supplier receipt landing on a zeroed lot clears the old supplier instead of inheriting it')
  // Clean up: revert this unattributed receipt too so it does not linger in
  // the shared "no supplier" invoice bucket the assertions below re-check.
  assert.equal((await stockRevert.applyMovementRevert(db, movementById(w4nNextMovement), actor)).ok, true)

  // Control: the SAME no-supplier top-up shape, but on a LIVE lot (never
  // zeroed) -- first attribution must still stick, proving the zeroed-only
  // carve-out above does not leak into ordinary top-ups.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (507, 'Toner Spare', 'T-3', 'pcs', 0, 1)`).run({})
  const w4c1 = await productBatches.receiveBatchStock(db, {
    productId: 507, branchId: 1, quantity: 5, receivedDate: '2026-09-01', supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, unitCostUsd: 3,
  })
  const w4c1Movement = recordReceiptMovement(507, w4c1.batchId, 5, 3)
  const w4c2 = await productBatches.receiveBatchStock(db, {
    productId: 507, branchId: 1, quantity: 2, receivedDate: '2026-09-01', unitCostUsd: 3,
  })
  const w4c2Movement = recordReceiptMovement(507, w4c2.batchId, 2, 3)
  assert.equal(w4c2.batchId, w4c1.batchId, 'same date and price tops up the live lot row')
  const lot4c = lotOf(w4c1.batchId)
  assert.deepEqual(
    { supplier_id: lot4c.supplier_id, supplier_name: lot4c.supplier_name, received_quantity: lot4c.received_quantity, unit_cost_usd: lot4c.unit_cost_usd },
    { supplier_id: SUPPLIER.id, supplier_name: SUPPLIER.name, received_quantity: 7, unit_cost_usd: 3 },
    'control: a top-up on a LIVE lot keeps first attribution (supplier AND unit_cost_usd untouched by the no-supplier top-up)',
  )
  ok(true, 'control: a live (never-zeroed) lot keeps first-attribution-sticks for a later no-supplier top-up')
  // Clean up: revert both of this control's receipts so the supplier's
  // running totals go back to baseline for the assertions below.
  assert.equal((await stockRevert.applyMovementRevert(db, movementById(w4c2Movement), actor)).ok, true)
  assert.equal((await stockRevert.applyMovementRevert(db, movementById(w4c1Movement), actor)).ok, true)

  // W5: two same-day, same-price receipts share one lot; reverting one leaves the other.
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (502, 'Mask', 'M-1', 'pcs', 0, 1)`).run({})
  const a = await productBatches.receiveBatchStock(db, { productId: 502, branchId: 1, quantity: 10, receivedDate: '2026-09-03', supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, unitCostUsd: 4, paymentStatus: 'credit', creditDueDate: '2026-10-03' })
  const aMovement = recordReceiptMovement(502, a.batchId, 10, 4)
  const b = await productBatches.receiveBatchStock(db, { productId: 502, branchId: 1, quantity: 5, receivedDate: '2026-09-03', supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, unitCostUsd: 4 })
  const bMovement = recordReceiptMovement(502, b.batchId, 5, 4)
  assert.equal(b.batchId, a.batchId)
  assert.deepEqual(read.totals(), { batches: 1, units: 15, cost: 60, creditOpen: 60, creditBatches: 1 })
  const r5 = await stockRevert.applyMovementRevert(db, movementById(bMovement), actor)
  assert.equal(r5.ok, true, r5.error)
  assert.deepEqual(read.totals(), { batches: 1, units: 10, cost: 40, creditOpen: 40, creditBatches: 1 }, 'W5: only B\'s 5 units / $20 leave; A stays on credit')
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

  // W8: revert, then revert of the revert -- the purchase, the credit reminder
  // and the invoice line come back under the SAME supplier (review pREAD
  // shape 1: on e3bf6fbf the un-revert re-received under "No supplier
  // recorded", key 'none'). A third revert takes it away again (shape 2).
  // Fourth reader: the product detail report's Suppliers rows
  // (routes/products.ts, "bought from"), extracted the same way
  // test-detail-report-supplier-split-pure.cjs does.
  const productsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8').replace(/\r\n/g, '\n')
  const resolvedIdSql = productsSource.match(/const RESOLVED_SUPPLIER_ID_SQL\s*=\s*`([\s\S]*?)`/)[1]
  const supplierKeySql = productsSource.match(/const SUPPLIER_KEY_SQL\s*=\s*`([\s\S]*?)`/)[1].replace('${RESOLVED_SUPPLIER_ID_SQL}', resolvedIdSql)
  const detailSuppliersSql = productsSource.match(/const suppliers = await db\.prepare\(`([\s\S]*?)`\)\.all</)[1]
    .split('${SUPPLIER_KEY_SQL}').join(supplierKeySql).split('${RESOLVED_SUPPLIER_ID_SQL}').join(resolvedIdSql)
  const detailSuppliers = (productId) => raw.prepare(detailSuppliersSql).all({ productId })
    .filter((r) => r.supplier_key === `id:${SUPPLIER.id}`).map((r) => ({ key: r.supplier_key, lots: Number(r.lot_count) }))
  const readAll = () => ({ totals: read.totals(), reminders: read.reminders(), invoice: read.invoiceLines(), detail: detailSuppliers(505) })
  // W7's sold-out lot is still Acme's purchase; W8 adds one receipt on top of it.
  const gone = readAll()
  const live = {
    totals: { batches: gone.totals.batches + 1, units: gone.totals.units + 10, cost: gone.totals.cost + 40, creditOpen: gone.totals.creditOpen + 40, creditBatches: gone.totals.creditBatches + 1 },
    reminders: gone.reminders + 1,
    invoice: [...gone.invoice, { key: `id:${SUPPLIER.id}`, qty: 10, cost: 40 }],
    detail: [{ key: `id:${SUPPLIER.id}`, lots: 1 }],
  }
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (505, 'Cream', 'C-1', 'pcs', 0, 1)`).run({})
  const w8 = await productBatches.receiveBatchStock(db, {
    productId: 505, branchId: 1, quantity: 10, receivedDate: '2026-09-05',
    supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, unitCostUsd: 4, paymentStatus: 'credit', creditDueDate: '2026-10-05',
  })
  const w8Movement = recordReceiptMovement(505, w8.batchId, 10, 4)
  assert.deepEqual(readAll(), live)
  const r8a = await stockRevert.applyMovementRevert(db, movementById(w8Movement), actor)
  assert.equal(r8a.ok, true, r8a.error)
  assert.deepEqual(readAll(), gone, 'W8: reverted -> gone from the supplier')
  const counter8 = db.prepare('SELECT * FROM inventory_movements WHERE reference_id = @ref').get({ ref: `revert:${w8Movement}` })
  const r8b = await stockRevert.applyMovementRevert(db, counter8, actor)
  assert.equal(r8b.ok, true, r8b.error)
  assert.deepEqual(readAll(), live, 'W8: un-reverted -> back under Acme with its credit, not under "no supplier"')
  const counter8b = db.prepare('SELECT * FROM inventory_movements WHERE reference_id = @ref').get({ ref: `revert:${counter8.id}` })
  const r8c = await stockRevert.applyMovementRevert(db, counter8b, actor)
  assert.equal(r8c.ok, true, r8c.error)
  assert.deepEqual(readAll(), gone, 'W8: level 3 -> gone again, no phantom line')
  ok(true, 'W8 revert-of-revert restores the purchase under the same supplier on all four readers; a third revert removes it again')

  console.log(`\nAll ${checks} supplier-mirror writer checks passed`)
})().catch((err) => { console.error(err); process.exitCode = 1 })
