// D1 (Part 415) -- the Stock Change ledger kernel (lib/stockLedgerQuery.ts):
// runs the COMPILED production module's real SQL against the REAL migration
// chain in node:sqlite, and pins the sign classification equal to the
// frontend's movementGroups.ts movementSign() so the two can never drift
// apart silently.
//
// Run: node scripts/test-stock-ledger-pure.cjs
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

// ---- compile the real kernel (local imports: businessDateWindow, ----------
// ---- stockInSessionsQuery's receipt-type vocabulary) ----------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-ledger-'))
fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', 'stockLedgerQuery.ts'), path.join(tmpDir, 'stockLedgerQuery.ts'))
// stockLedgerQuery.ts imports ./businessDateWindow (the UTC+7 helpers) and
// ./stockInSessionsQuery (STOCK_RECEIPT_MOVEMENT_TYPES, so the shared-lot
// receipt count and the Stock-in Sessions list agree on what a receipt is);
// copy those pure dependencies in so the isolated compile resolves and emits.
fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', 'businessDateWindow.ts'), path.join(tmpDir, 'businessDateWindow.ts'))
// N13: and ./movementBranchName, which resolves a movement row's branch
// through branch_id when the row carries no branch_name snapshot.
fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', 'movementBranchName.ts'), path.join(tmpDir, 'movementBranchName.ts'))
fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', 'stockInSessionsQuery.ts'), path.join(tmpDir, 'stockInSessionsQuery.ts'))
execSync(
  `npx tsc "${path.join(tmpDir, 'stockLedgerQuery.ts')}" "${path.join(tmpDir, 'businessDateWindow.ts')}" "${path.join(tmpDir, 'movementBranchName.ts')}" "${path.join(tmpDir, 'stockInSessionsQuery.ts')}" --outDir "${tmpDir}" --module commonjs --target es2022 --strict --skipLibCheck${ignoreConfigFlag}`,
  { cwd: cloudflareRoot, stdio: 'pipe' },
)
const kernel = require(path.join(tmpDir, 'stockLedgerQuery.js'))
ok(typeof kernel.buildStockLedgerQuery === 'function', 'kernel compiled and exports buildStockLedgerQuery')

// ---- pin: sign list mirrors frontend movementGroups.ts movementSign() -----
const movementGroupsSrc = fs.readFileSync(
  path.join(cloudflareRoot, '..', 'frontend', 'src', 'components', 'inventory', 'movementGroups.ts'),
  'utf8',
)
const signMatch = movementGroupsSrc.match(/function movementSign[\s\S]{0,400}?\[([^\]]+)\]\.includes\(key\)\) return -1/)
assert.ok(signMatch, 'frontend movementSign() down-type list located')
const frontendOutTypes = signMatch[1].split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean).sort()
const kernelOutTypes = [...kernel.LEDGER_OUT_TYPES].sort()
assert.deepEqual(kernelOutTypes, frontendOutTypes, 'LEDGER_OUT_TYPES === frontend movementSign() list')
ok(true, `sign classification pinned to frontend movementSign (${kernelOutTypes.length} down-types)`)

// ---- real DB: full migration chain ----------------------------------------
const db = openDb(loadAll())
ok(true, 'full migration chain applied')

function insertProduct(id, name, barcode, stock) {
  db.prepare('INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (@id, @name, @barcode, @unit, @stock, 1)')
    .bind({ id, name, barcode, unit: 'pcs', stock }).run()
}
function insertMovement(row) {
  db.prepare(`INSERT INTO inventory_movements
    (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at)
    VALUES (@id, @product_id, @product_name, @branch_id, @branch_name, @movement_type, @quantity, @reason, @user_name, @created_at)`)
    .bind(row).run()
}

// Product A: full recorded history. Signed walk: +10 -3 +1 +2 -4 -1 = +5,
// and current stock is set to that same 5, so every derived before/after
// is exact.
insertProduct(9001, 'Ledger Test Cream', '8800000000011', 5)
const A = (over) => ({ product_id: 9001, product_name: 'Ledger Test Cream', branch_id: 1, branch_name: 'Main Store', reason: '', user_name: 'tester', ...over })
insertMovement(A({ id: 1, movement_type: 'add', quantity: 10, reason: 'initial stock', created_at: '2026-08-20 10:00:00' }))
insertMovement(A({ id: 2, movement_type: 'sale', quantity: 3, created_at: '2026-08-21 11:00:00' }))
insertMovement(A({ id: 3, movement_type: 'return', quantity: 1, created_at: '2026-08-22 12:00:00' }))
insertMovement(A({ id: 4, movement_type: 'adjustment', quantity: 2, reason: 'stock count correction', created_at: '2026-08-23 13:00:00' }))
insertMovement(A({ id: 5, movement_type: 'transfer_out', quantity: 4, created_at: '2026-08-24 14:00:00' }))
insertMovement(A({ id: 6, movement_type: 'remove', quantity: 1, reason: 'damaged', created_at: '2026-08-25 15:00:00' }))

// Product B: snapshot-migrated -- current stock 7, but only ONE recorded
// movement (sale 2). The derived baseline before that sale must read 9:
// the number the recorded actions imply, not a fabricated zero.
insertProduct(9002, 'Snapshot 50%_Serum', '8800000000028', 7)
insertMovement({ id: 7, product_id: 9002, product_name: 'Snapshot 50%_Serum', branch_id: 1, branch_name: 'Main Store', movement_type: 'sale', quantity: 2, reason: '', user_name: 'tester', created_at: '2026-08-26 09:00:00' })

function runLedger(filters, page = 1, pageSize = 50) {
  const q = kernel.buildStockLedgerQuery(filters)
  const total = db.prepare(q.countSql).bind(q.params).get().total
  const rows = db.prepare(q.rowsSql).bind({ ...q.params, limit: pageSize, offset: (page - 1) * pageSize }).all()
  return { total, items: kernel.attachBeforeQty(rows) }
}

// ---- the running balance ---------------------------------------------------
const all = runLedger({ productId: 9001 })
assert.equal(all.total, 6)
ok(true, 'product A lists all 6 recorded actions')
// newest first: remove(after 5), transfer_out(after 6), adjustment(after 10), return(after 8), sale(after 7), add(after 10)
const seq = all.items.map((r) => [r.movement_type, r.before_qty, r.after_qty])
assert.deepEqual(seq, [
  ['remove', 6, 5],
  ['transfer_out', 10, 6],
  ['adjustment', 8, 10],
  ['return', 7, 8],
  ['sale', 10, 7],
  ['add', 0, 10],
], 'before/after walk back exactly from current stock to the zero baseline')
ok(true, 'derived before/after matches the hand-computed running balance')

// ---- buckets ---------------------------------------------------------------
// Part 553: two columns only -- Out when the type is an outflow, In otherwise.
// The former 'adjustment' bucket folded into In (a merge carry-in genuinely
// is stock in).
const buckets = Object.fromEntries(all.items.map((r) => [r.movement_type, r.ledger_bucket]))
assert.deepEqual(buckets, {
  add: 'in', sale: 'out', return: 'in', adjustment: 'in', transfer_out: 'out', remove: 'out',
}, 'each type lands in its ledger column')
ok(true, 'ledger buckets: add/return/adjustment=in, sale/transfer_out/remove=out (no separate adjustment column)')

// signed quantities carry direction, magnitudes stay positive
const signedByType = Object.fromEntries(all.items.map((r) => [r.movement_type, r.signed_quantity]))
assert.equal(signedByType.sale, -3)
assert.equal(signedByType.add, 10)
assert.equal(signedByType.return, 1)
ok(true, 'signed_quantity carries direction (sale -3, add +10, return +1)')

// ---- views -----------------------------------------------------------------
// Part 553: two views only. 'in' now includes the folded 'adjustment'; the
// retired 'adjustments' value falls through to 'all' (all six rows).
assert.deepEqual(runLedger({ productId: 9001, view: 'in' }).items.map((r) => r.movement_type).sort(), ['add', 'adjustment', 'return'])
assert.deepEqual(runLedger({ productId: 9001, view: 'out' }).items.map((r) => r.movement_type).sort(), ['remove', 'sale', 'transfer_out'])
assert.equal(runLedger({ productId: 9001, view: 'adjustments' }).total, 6, 'retired "adjustments" view falls back to all')
ok(true, 'views partition the six actions into in/out with no overlap; adjustment folds into in')

// ---- snapshot honesty ------------------------------------------------------
const snap = runLedger({ productId: 9002 })
assert.equal(snap.items.length, 1)
assert.equal(snap.items[0].after_qty, 7)
assert.equal(snap.items[0].before_qty, 9)
ok(true, 'snapshot-migrated product derives the implied baseline (before 9 -> after 7), never a fabricated zero')

// ---- filters ---------------------------------------------------------------
// LIKE escaping: "50%_" must match literally, not as wildcards.
const esc = runLedger({ search: '50%_Serum' })
assert.equal(esc.total, 1)
assert.equal(esc.items[0].product_id, 9002)
const wild = runLedger({ search: '50x_Serum' })
assert.equal(wild.total, 0, 'escaped _ does not wildcard-match')
ok(true, 'search LIKE escapes % and _ (literal match only)')

// barcode search reaches through the join
assert.equal(runLedger({ search: '8800000000011' }).total, 6)
ok(true, 'search matches barcode through the products join')

// date bounds inclusive on both ends
const day = runLedger({ productId: 9001, startDate: '2026-08-21', endDate: '2026-08-23' })
assert.deepEqual(day.items.map((r) => r.movement_type).sort(), ['adjustment', 'return', 'sale'])
ok(true, 'date bounds are calendar-day inclusive on both ends')

// pagination math
const paged = runLedger({ productId: 9001 }, 2, 4)
assert.equal(paged.total, 6)
assert.equal(paged.items.length, 2)
assert.deepEqual(paged.items.map((r) => r.movement_type), ['sale', 'add'], 'page 2 of 4-per-page holds the two oldest')
ok(true, 'pagination returns the correct slice with the full total')

// ---- 0084: movement <-> batch linkage + supplier filter --------------------
// Two suppliers; two lots on product A -- one id-attributed, one name-only
// (D5a's match-only free-text attribution). Movements: one stamped with each
// lot, the six existing rows stay batch-less (pre-0084 history).
db.prepare(`INSERT INTO suppliers (id, name) VALUES (61, 'Bong Long')`).run({})
db.prepare(`INSERT INTO suppliers (id, name) VALUES (62, 'Dane Japan')`).run({})
db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, supplier_id, supplier_name)
  VALUES (501, 9001, '08202026', '08202026', '2026-08-20 10:00:00', 1, 1, 61, 'Bong Long')`).run({})
db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, supplier_id, supplier_name)
  VALUES (502, 9001, 'LOT-CUSTOM', 'LOT-CUSTOM', '2026-08-27 10:00:00', 1, 2, NULL, 'dane  japan')`).run({})
// Normalize the name-only lot to the exact-name form the filter compares
// (lower/trim only -- the writers already collapse doubled spaces).
db.prepare(`UPDATE product_batches SET supplier_name = 'Dane Japan' WHERE id = 502`).run({})
db.prepare(`INSERT INTO inventory_movements
  (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at, batch_id)
  VALUES (8, 9001, 'Ledger Test Cream', 1, 'Main Store', 'add', 4, 'batch receipt', 'tester', '2026-08-27 10:00:00', 501)`).run({})
db.prepare(`INSERT INTO inventory_movements
  (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at, batch_id)
  VALUES (9, 9001, 'Ledger Test Cream', 1, 'Main Store', 'sale', 1, '', 'tester', '2026-08-28 10:00:00', 502)`).run({})
db.prepare(`UPDATE products SET stock_quantity = 8 WHERE id = 9001`).run({})

const withBatch = runLedger({ productId: 9001 })
assert.equal(withBatch.total, 8)
const stamped = withBatch.items.find((r) => r.id === 8)
assert.equal(stamped.batch_id, 501)
assert.equal(stamped.batch_lot_code, '08202026')
assert.equal(stamped.batch_supplier_name, 'Bong Long')
const unstamped = withBatch.items.find((r) => r.id === 1)
assert.equal(unstamped.batch_id, null)
assert.equal(unstamped.batch_lot_code, null)
ok(true, '0084: stamped rows surface their lot (code + supplier) through the join; pre-0084 rows stay NULL')

// supplier filter: id-attributed lot matches by supplier_id
const bySupplier = runLedger({ productId: 9001, supplierId: 61 })
assert.equal(bySupplier.total, 1)
assert.equal(bySupplier.items[0].id, 8)
ok(true, 'supplier filter (id-attributed lot) returns exactly the stamped movement')

// name-only attributed lot matches through the supplier-name identity rule
const byNameOnly = runLedger({ productId: 9001, supplierId: 62 })
assert.equal(byNameOnly.total, 1)
assert.equal(byNameOnly.items[0].id, 9)
ok(true, 'supplier filter matches a name-only attributed lot (D1b identity rule), unattributed rows honestly excluded')

// ---- 0084 backfill: dated stock-count provenance ---------------------------
// A pre-0084 world (chain up to 0083), seeded with the three provenance
// shapes, then the REAL 0084 file applied: single-lot full coverage
// backfills, multi-lot stays NULL, partial coverage (shortfall) stays NULL.
{
  const migrationsDir = path.join(cloudflareRoot, 'migrations')
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  const pre = files.filter((f) => !f.startsWith('0084'))
  const db2 = openDb(pre.map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')))
  db2.prepare(`INSERT INTO products (id, name, unit, stock_quantity, is_active) VALUES (9101, 'Backfill Test', 'pcs', 0, 1)`).run({})
  const mv = (id, qty) => db2.prepare(`INSERT INTO inventory_movements
    (id, product_id, product_name, branch_id, movement_type, quantity, reason, created_at)
    VALUES (@id, 9101, 'Backfill Test', 1, 'remove', @qty, 'stock count', '2026-08-01 00:00:00')`).run({ id, qty })
  mv(101, 5); mv(102, 6); mv(103, 5)
  const act = (movementId, batchId, qty) => db2.prepare(
    `INSERT INTO dated_stock_count_batch_actions (movement_id, batch_id, quantity) VALUES (@movementId, @batchId, @qty)`,
  ).run({ movementId, batchId, qty })
  act(101, 601, -5)              // one lot, full coverage -> backfilled
  act(102, 601, -4); act(102, 602, -2) // two lots -> NULL
  act(103, 601, -3)              // one lot, PARTIAL coverage (shortfall) -> NULL
  db2.exec(fs.readFileSync(path.join(migrationsDir, files.find((f) => f.startsWith('0084'))), 'utf8'))
  const got = Object.fromEntries(
    db2.prepare('SELECT id, batch_id FROM inventory_movements WHERE id IN (101, 102, 103)').all({}).map((r) => [r.id, r.batch_id]),
  )
  assert.deepEqual(got, { 101: 601, 102: null, 103: null })
  ok(true, '0084 backfill: single-lot full-coverage movements gain their batch_id; multi-lot and shortfall rows stay NULL')
}

// ---- Part 553: completed outflow list + stats summary ----------------------
// Every outflow string the backend actually writes must bucket as Out, not
// silently count as In (the reported In/Out imbalance was partly this bug).
insertProduct(9003, 'Outflow Types', '8800000000035', 0)
const C = (over) => ({ product_id: 9003, product_name: 'Outflow Types', branch_id: 1, branch_name: 'Main Store', reason: '', user_name: 'tester', ...over })
insertMovement(C({ id: 20, movement_type: 'move_out', quantity: 2, created_at: '2026-08-20 10:00:00' }))
insertMovement(C({ id: 21, movement_type: 'damage_out', quantity: 3, created_at: '2026-08-20 11:00:00' }))
insertMovement(C({ id: 22, movement_type: 'replacement_out', quantity: 1, created_at: '2026-08-20 12:00:00' }))
insertMovement(C({ id: 23, movement_type: 'out', quantity: 4, created_at: '2026-08-20 13:00:00' }))
insertMovement(C({ id: 24, movement_type: 'add', quantity: 5, created_at: '2026-08-20 09:00:00' }))
const cRows = runLedger({ productId: 9003 })
const cBuckets = Object.fromEntries(cRows.items.map((r) => [r.movement_type, r.ledger_bucket]))
assert.deepEqual(cBuckets, { move_out: 'out', damage_out: 'out', replacement_out: 'out', out: 'out', add: 'in' },
  'move_out/damage_out/replacement_out/out all bucket as Out (Part 553 completed list)')
ok(true, 'completed outflow list: move_out/damage_out/replacement_out/out are Out, not In')

const cSigned = Object.fromEntries(cRows.items.map((r) => [r.movement_type, r.signed_quantity]))
assert.equal(cSigned.damage_out, -3)
assert.equal(cSigned.out, -4)
assert.equal(cSigned.add, 5)
ok(true, 'newly-listed outflows carry a negative signed_quantity')

function runSummary(filters) {
  const q = kernel.buildStockLedgerQuery(filters)
  return db.prepare(q.summarySql).bind(q.params).get()
}
const cSummary = runSummary({ productId: 9003 })
assert.equal(cSummary.in_count, 1)          // the single 'add'
assert.equal(cSummary.out_count, 4)         // move_out, damage_out, replacement_out, out
assert.equal(cSummary.in_qty, 5)
assert.equal(cSummary.out_qty, 2 + 3 + 1 + 4)
assert.equal(cSummary.total, 5)
ok(true, 'summary reports In vs Out counts + magnitudes over the base scope')

// The summary ignores the view chip so the In/Out split is always visible.
const cSummaryOut = runSummary({ productId: 9003, view: 'out' })
assert.equal(cSummaryOut.in_count, 1)
assert.equal(cSummaryOut.out_count, 4)
ok(true, 'summary ignores the selected view (In/Out split always visible)')

console.log(`\nAll ${checks} stock-ledger kernel checks passed`)
