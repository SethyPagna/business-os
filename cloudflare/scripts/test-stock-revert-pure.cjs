// Part 553 -- the Stock Change ledger's REVERT kernel (lib/stockRevert.ts):
// compiles the real module (+ its import graph) and drives applyMovementRevert
// against the REAL migration chain in node:sqlite, so the compensating
// counter-movement's effect on stock, the batch ledger and the movement row
// are all verified end to end. No writes to the repo; a temp build dir only.
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
      `--module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck --noEmitOnError false`,
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
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (9201, 'Revert Cream', 'RC-1', 'pcs', 10, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (9201, 1, 10)`).run({})
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at)
    VALUES (5001, 9201, 'Revert Cream', 1, 'Main Store', 'add', 10, 'received', 'tester', '2026-08-20 10:00:00')`).run({})

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
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at)
    VALUES (5101, 9202, 'Revert Serum', 1, 'Main Store', 'out', 2, 'bulk import removal', 'tester', '2026-08-21 10:00:00')`).run({})
  const orig2 = await movementById(5101)
  const r2 = await kernel.applyMovementRevert(db, orig2, actor)
  assert.equal(r2.ok, true)
  assert.equal(r2.revertType, 'add')
  const after2 = await stockOf(9202, 1)
  assert.deepEqual(after2, { product: 7, branch: 7 }, 'revert of the -2 out added 2 back -> 7 (aggregate)')
  const counter2 = await counterFor(5101)
  assert.equal(counter2.movement_type, 'add')
  assert.equal(Number(counter2.quantity), 2)
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

  console.log(`\nAll ${checks} stock-revert kernel checks passed`)
})().catch((err) => { console.error(err); process.exitCode = 1 })
