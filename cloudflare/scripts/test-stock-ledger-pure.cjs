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

let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// ---- compile the real kernel (zero imports -- compiles verbatim) ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-ledger-'))
fs.copyFileSync(path.join(cloudflareRoot, 'src', 'lib', 'stockLedgerQuery.ts'), path.join(tmpDir, 'stockLedgerQuery.ts'))
execSync(
  `npx tsc "${path.join(tmpDir, 'stockLedgerQuery.ts')}" --outDir "${tmpDir}" --module commonjs --target es2022 --strict --skipLibCheck`,
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
const buckets = Object.fromEntries(all.items.map((r) => [r.movement_type, r.ledger_bucket]))
assert.deepEqual(buckets, {
  add: 'in', sale: 'out', return: 'in', adjustment: 'adjustment', transfer_out: 'out', remove: 'out',
}, 'each type lands in its ledger column')
ok(true, 'ledger buckets: add/return=in, sale/transfer_out/remove=out, adjustment=adjustment')

// signed quantities carry direction, magnitudes stay positive
const signedByType = Object.fromEntries(all.items.map((r) => [r.movement_type, r.signed_quantity]))
assert.equal(signedByType.sale, -3)
assert.equal(signedByType.add, 10)
assert.equal(signedByType.return, 1)
ok(true, 'signed_quantity carries direction (sale -3, add +10, return +1)')

// ---- views -----------------------------------------------------------------
assert.deepEqual(runLedger({ productId: 9001, view: 'adjustments' }).items.map((r) => r.movement_type), ['adjustment'])
assert.deepEqual(runLedger({ productId: 9001, view: 'in' }).items.map((r) => r.movement_type).sort(), ['add', 'return'])
assert.deepEqual(runLedger({ productId: 9001, view: 'out' }).items.map((r) => r.movement_type).sort(), ['remove', 'sale', 'transfer_out'])
ok(true, 'views partition the six actions into adjustments/in/out with no overlap')

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

console.log(`\nAll ${checks} stock-ledger kernel checks passed`)
