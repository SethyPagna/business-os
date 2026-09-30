// Owner, 1 Oct 2026: stock a sale or a return moved is changed from that
// record (cancel the sale, change its status, edit the return), never
// reverted from Stock Changes. Every movement type, table-driven, through the
// real applyMovementRevert on the real migration chain: the ones a sale or a
// return wrote are refused with a code that names the record, the other
// record-bound types with the generic code, and nothing moves on a refusal.
// The ambiguous types ('return', 'damage_in', 'damage_out' are written by
// both families) are told apart by which record holds the product, with a
// sales.id and a returns.id that collide on purpose.
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')
const { applyMovementRevert, REVERTIBLE_MOVEMENT_TYPES } = loadStockSession('lib/stockRevert.ts')
const { getDb } = loadStockSession('lib/db.ts')

const actor = { userId: user.id, userName: user.name }

const SALE_ID = 70
const RETURN_ID = 71
const COLLIDING_ID = 72 // a sale AND a return carry this id; only the return holds product 1

const cases = [
  // Standalone stock changes: revertible here.
  ...['add', 'remove', 'set', 'adjustment', 'in', 'out', 'csv_import'].map((type) => ({ type, ref: null, code: null })),
  // Sale family.
  { type: 'sale', ref: SALE_ID, code: 'revert_from_sale' },
  { type: 'sale', ref: null, code: 'revert_from_sale' },
  { type: 'sale_from_damaged', ref: SALE_ID, code: 'revert_from_sale' },
  { type: 'return', ref: SALE_ID, code: 'revert_from_sale' }, // cancel / status restock
  { type: 'damage_in', ref: SALE_ID, code: 'revert_from_sale' },
  { type: 'damage_out', ref: SALE_ID, code: 'revert_from_sale' },
  // Return family.
  { type: 'return', ref: RETURN_ID, code: 'revert_from_return' },
  { type: 'return', ref: COLLIDING_ID, code: 'revert_from_return' },
  { type: 'damage_in', ref: RETURN_ID, code: 'revert_from_return' },
  ...['supplier_return', 'supplier_return_reversal', 'return_reversal', 'replacement_out', 'damage_reversal']
    .map((type) => ({ type, ref: RETURN_ID, code: 'revert_from_return' })),
  // Bound to another record that is neither: the generic refusal.
  { type: 'return', ref: 999, code: 'revert_not_revertible' },
  { type: 'damage_out', ref: null, code: 'revert_not_revertible' },
  ...['transfer_in', 'transfer_out', 'move_in', 'move_out', 'row_move_in', 'row_move_out', 'write_off', 'delete', 'stock_in', 'stock_out']
    .map((type) => ({ type, ref: null, code: 'revert_not_revertible' })),
]

async function main() {
  // The table covers every revertible type, so a type added to the allowlist
  // without a row here turns this file red.
  const revertible = cases.filter((c) => c.code === null).map((c) => c.type).sort()
  assert.deepEqual(revertible, [...REVERTIBLE_MOVEMENT_TYPES].sort(), 'every revertible type is in the table')

  for (const c of cases) {
    const f = fixture()
    try {
      f.sql.exec(`
        UPDATE products SET stock_quantity=20 WHERE id=1; UPDATE branch_stock SET quantity=20 WHERE product_id=1 AND branch_id=1;
        INSERT INTO products(id, name, barcode, stock_quantity, is_active) VALUES(2, 'Other', 'OTH-2', 0, 1);
        INSERT INTO sales(id) VALUES(${SALE_ID}), (${COLLIDING_ID});
        INSERT INTO sale_items(sale_id, product_id) VALUES(${SALE_ID}, 1), (${COLLIDING_ID}, 2);
        INSERT INTO returns(id) VALUES(${RETURN_ID}), (${COLLIDING_ID});
        INSERT INTO return_items(return_id, product_id) VALUES(${RETURN_ID}, 1), (${COLLIDING_ID}, 1);`)
      const id = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id, branch_id, branch_name, movement_type, quantity, reason, reference_id, created_at)
        VALUES(1, 1, 'Shop', @type, 2, 'probe', @ref, '2026-09-20 03:00:00')`).run({ type: c.type, ref: c.ref == null ? null : String(c.ref) }).lastInsertRowid)
      const before = JSON.stringify(f.sql.prepare('SELECT (SELECT quantity FROM branch_stock WHERE product_id=1) b, (SELECT stock_quantity FROM products WHERE id=1) p, (SELECT COUNT(*) FROM inventory_movements) n').get())
      const result = await applyMovementRevert(getDb(f.env), f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(id), actor)
      const label = `${c.type}${c.ref == null ? '' : ` -> record ${c.ref}`}`
      if (c.code === null) {
        assert.equal(result.ok, true, `${label}: revertible here ${JSON.stringify(result)}`)
        continue
      }
      assert.equal(result.ok, false, `${label}: refused`)
      assert.equal(result.code, c.code, `${label}: ${JSON.stringify(result)}`)
      if (c.code === 'revert_from_sale') assert.match(result.error, /Change it from the sale: cancel it or change its status/)
      if (c.code === 'revert_from_return') assert.match(result.error, /Change it from the return/)
      assert.equal(JSON.stringify(f.sql.prepare('SELECT (SELECT quantity FROM branch_stock WHERE product_id=1) b, (SELECT stock_quantity FROM products WHERE id=1) p, (SELECT COUNT(*) FROM inventory_movements) n').get()), before, `${label}: nothing moved`)
    } finally { f.sql.close() }
  }
  console.log(`PASS ${cases.length} movement shapes: sale-made stock points to the sale, return-made stock to the return, other record-bound types refused, standalone changes revertible`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
