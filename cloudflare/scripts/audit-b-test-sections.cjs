// The per-query planted-defect sections of test-audit-b-queries-pure.cjs (kept apart so that file stays readable;
// not a test itself: the sweep runs test-*.cjs only). Each section registers itself on the shared runner.
'use strict'
const { section, planted, run, violations, cleanWorld, activeWorld, SHOP, WAREHOUSE, LEGACY, assert } = require('./test-audit-b-queries-pure.cjs')

// ---------------------------------------------------------------------------------------------------------------------
// 1. audit-b-stock-ledger-agreement
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-stock-ledger-agreement: each orphan, identity and info column fires on its own plant', async () => {
  const Q = 'audit-b-stock-ledger-agreement'
  // control: the info columns are measurable and the clean world has no till fork
  const w = cleanWorld()
  const clean = (await run(w, Q)).rows[0]
  assert.equal(clean.tracked_pairs_branch_exceeds_lots, 0)
  assert.equal(clean.rollup_drift_active, 0)
  assert.equal(clean.examples_till_fork, '[]')
  w.raw.close()

  await planted(Q, 'branch_stock row of a deleted product', (x) => x.raw.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(999,2,0)'), { branch_stock_orphan_product: 1 })
  await planted(Q, 'branch_stock row of a missing branch', (x) => x.raw.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,99,0)'), { branch_stock_orphan_branch: 1 })
  await planted(Q, 'lot stock of a deleted lot', (x) => x.raw.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9999,2,0)'), { lot_stock_orphan_lot: 1 })
  await planted(Q, 'lot stock at a missing branch', (x) => x.raw.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(100,99,0)'), { lot_stock_orphan_branch: 1 })
  await planted(Q, 'lot of a deleted product', (x) => x.raw.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(9000,999,'orphan',0)"), { lots_orphan_product: 1 })
  await planted(Q, 'branch stock held at the disabled legacy branch', (x) => x.raw.exec(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,${LEGACY},3)`), { stock_at_inactive_branch: 1 })
  await planted(Q, 'lot stock held at the disabled legacy branch', (x) => x.raw.exec(`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(100,${LEGACY},2)`), { stock_at_inactive_branch: 1 })
  await planted(Q, 'positive lot stock in an inactive lot (the 0154 triggers are dropped to plant it)', (x) => {
    x.raw.exec('DROP TRIGGER positive_lot_reject_inactive_update_0154')
    x.raw.exec('UPDATE product_batches SET is_active=0 WHERE id=101')
  }, { positive_stock_in_inactive_lot: 1 })
  await planted(Q, 'active product with a rollup and no branch_stock row', (x) => x.raw.exec('DELETE FROM branch_stock WHERE product_id=7'), { active_stock_without_branch_row: 1 })
  await planted(Q, 'negative rollup', (x) => x.raw.exec('UPDATE products SET stock_quantity=-2 WHERE id=7'), { rollup_negative: 1 })
  // the info columns: a till fork is a lot total below the shelf at a tracked pair; an emptied-lots pair reads zero at the till
  const fork = await planted(Q, 'branch stock above the lots (shelf 15, lots 12)', (x) => x.raw.exec('UPDATE branch_stock SET quantity=quantity+3 WHERE product_id=2 AND branch_id=2'), {})
  assert.equal(fork.rows[0].tracked_pairs_branch_exceeds_lots, 1)
  assert.equal(fork.rows[0].tracked_pairs_till_shows_zero, 0)
  assert.equal(fork.rows[0].tracked_units_hidden_from_till, 3)
  assert.equal(fork.rows[0].rollup_drift_active, 1)
  assert.deepEqual(JSON.parse(fork.rows[0].examples_till_fork), [[2, 2, 43, 40]])
  const zero = await planted(Q, 'every lot of a pair drained while the shelf keeps stock (28 here, 0 there)', (x) => x.raw.exec('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=(SELECT id FROM product_batches WHERE variant_product_id=7)'), {})
  assert.equal(zero.rows[0].tracked_pairs_till_shows_zero, 1)
  assert.equal(zero.rows[0].tracked_units_hidden_from_till, 9)
  // an UNTRACKED pair (no lot row at that branch at all) is not a fork: the till reads the shelf
  const untracked = await planted(Q, 'branch stock with no lots at that branch is legitimate untracked stock', (x) => x.raw.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,5)'), {})
  assert.equal(untracked.rows[0].tracked_pairs_branch_exceeds_lots, 0)
  // a product whose only lot is inactive and empty is not tracked either (getTrackedProductIds: active, or holding stock)
  const inactiveEmpty = await planted(Q, 'an inactive empty lot does not make a branch tracked', (x) => {
    x.raw.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(9100,3,'dead',0)")
    x.raw.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9100,2,0)')
    x.raw.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(3,2,4)')
  }, {})
  assert.equal(inactiveEmpty.rows[0].tracked_pairs_branch_exceeds_lots, 0)
})

// ---------------------------------------------------------------------------------------------------------------------
// 2. audit-b-negative-and-shape
// ---------------------------------------------------------------------------------------------------------------------
// A world with one row of every kind the query reads, so each plant changes exactly one column.
function shapeWorld() {
  const w = cleanWorld()
  const s = w.sale('completed', [{ product: 2, branch: SHOP, qty: 3, lot: w.get('SELECT id FROM product_batches WHERE variant_product_id=2').id }])
  w.customerReturn(s, [{ saleItem: s.itemIds[0], product: 2, branch: SHOP, qty: 1, action: 'restock', lot: w.get('SELECT id FROM product_batches WHERE variant_product_id=2').id }])
  w.customerReturn(s, [{ saleItem: s.itemIds[0], product: 2, branch: SHOP, qty: 1, action: 'damaged', lot: w.get('SELECT id FROM product_batches WHERE variant_product_id=2').id }])
  w.transfer(3, WAREHOUSE, SHOP, 5, { lot: w.get('SELECT id FROM product_batches WHERE variant_product_id=3').id })
  w.run("INSERT INTO stock_row_moves(source_product_id,destination_product_id,branch_id,quantity) VALUES(1,2,2,1)")
  return w
}
section('audit-b-negative-and-shape: every negative / missing / non-numeric column fires on its own plant', async () => {
  const Q = 'audit-b-negative-and-shape'
  const plant = (label, sql, expected, extra) => planted(Q, label, (w) => {
    w.raw.exec('PRAGMA ignore_check_constraints=ON')
    w.raw.exec(sql)
    w.raw.exec('PRAGMA ignore_check_constraints=OFF')
  }, expected, { base: shapeWorld, ...extra })
  const w0 = shapeWorld()
  const control = await run(w0, Q)
  assert.deepEqual(violations(control), {})
  const c = control.rows[0]
  assert.equal(c.products_stock_null, 0); assert.equal(c.movements_zero_quantity, 0); assert.equal(c.movements_without_product_or_branch, 0)
  assert.deepEqual(Object.values(JSON.parse(c.first_ids)).filter((v) => v !== null), [], 'the clean world has no offending id')
  w0.raw.close()

  await plant('negative rollup', 'UPDATE products SET stock_quantity=-1 WHERE id=3', { products_stock_negative: 1 })
  await plant('rollup stored as text', "UPDATE products SET stock_quantity='5x' WHERE id=3", { products_stock_text: 1 })
  await plant('negative branch stock', 'UPDATE branch_stock SET quantity=-1 WHERE product_id=2 AND branch_id=2', { branch_stock_negative: 1, branch_stock_not_number: 0 })
  await plant('NULL branch stock (a CHECK lets NULL through)', 'UPDATE branch_stock SET quantity=NULL WHERE product_id=2 AND branch_id=2', { branch_stock_not_number: 1 })
  await plant('negative lot stock', 'UPDATE branch_batch_stock SET quantity=-2 WHERE rowid=1', { lot_stock_negative: 1 })
  await plant('text lot stock', "UPDATE branch_batch_stock SET quantity='x' WHERE rowid=1", { lot_stock_not_number: 1 })
  await plant('negative received quantity', 'UPDATE product_batches SET received_quantity=-1 WHERE id=101', { lots_received_quantity_negative: 1 })
  await plant('negative unit cost', 'UPDATE product_batches SET unit_cost_usd=-1 WHERE id=101', { lots_cost_negative: 1 })
  await plant('text unit cost', "UPDATE product_batches SET unit_cost_usd='free' WHERE id=101", { lots_cost_not_number: 1 })
  await plant('sale line of 0 units', 'UPDATE sale_items SET quantity=0 WHERE id=1', { sale_items_quantity_not_positive: 1, sale_items_returned_out_of_range: 1 })
  await plant('returned above sold', 'UPDATE sale_items SET returned_quantity=9 WHERE id=1', { sale_items_returned_out_of_range: 1 })
  await plant('allocation of 0', 'UPDATE sale_item_batch_allocations SET quantity=0 WHERE id=1', { sale_allocations_not_positive: 1, sale_allocations_released_out_of_range: 0 })
  await plant('released above drawn', 'UPDATE sale_item_batch_allocations SET released_quantity=9 WHERE id=1', { sale_allocations_released_out_of_range: 1 })
  await plant('return line of 0', 'UPDATE return_items SET quantity=0 WHERE id=1', { return_items_quantity_not_positive: 1 })
  await plant('return lot row of -1', 'UPDATE return_item_batch_allocations SET quantity=-1 WHERE id=1', { return_allocations_not_positive: 1 })
  await plant('transfer of 0', 'UPDATE stock_transfers SET quantity=0', { transfers_quantity_not_positive: 1 })
  await plant('row move of -1', 'UPDATE stock_row_moves SET quantity=-1', { transfers_quantity_not_positive: 1 })
  await plant('transfer to the same branch', 'UPDATE stock_transfers SET to_branch_id=from_branch_id', { transfers_same_branch: 1 })
  await plant('transfer with no destination', 'UPDATE stock_transfers SET to_branch_id=NULL', { transfers_branch_missing: 1 })
  await plant('damaged lot remaining above its quantity', 'UPDATE damaged_stock_lots SET quantity_remaining=quantity+1', { damaged_lots_out_of_range: 1 })
  await plant('damaged lot remaining below zero', 'UPDATE damaged_stock_lots SET quantity_remaining=-1', { damaged_lots_out_of_range: 1 })
  await plant('movement with NULL quantity', "UPDATE inventory_movements SET quantity=NULL WHERE id=1", { movements_quantity_not_number: 1 })
  await plant('movement with text quantity', "UPDATE inventory_movements SET quantity='two' WHERE id=1", { movements_quantity_not_number: 1 })
  await plant('a sale movement stored positive', "UPDATE inventory_movements SET quantity=3 WHERE movement_type='sale'", { movements_sign_flipped: 1 })
  await plant('a transfer leg stored negative', "UPDATE inventory_movements SET quantity=-5 WHERE movement_type='transfer_in'", { movements_sign_flipped: 1 })
  // negatives that are LEGITIMATE must not fire: a stock-in line edit writes a signed delta on an add
  await plant('a signed stock-in-edit delta on an add is not a flip', "UPDATE inventory_movements SET quantity=-2, reference_id='stock-in-edit:1:op:1' WHERE id=1", {})
  const infoWorld = shapeWorld()
  infoWorld.raw.exec('UPDATE products SET stock_quantity=NULL WHERE id=3')
  infoWorld.raw.exec('UPDATE inventory_movements SET quantity=0 WHERE id=2')
  infoWorld.raw.exec('UPDATE inventory_movements SET branch_id=NULL WHERE id=3')
  const info = (await run(infoWorld, Q)).rows[0]
  assert.deepEqual([info.products_stock_null, info.movements_zero_quantity, info.movements_without_product_or_branch], [1, 1, 1])
  assert.equal(JSON.parse(info.first_ids).products, null, 'NULL is info, not an offending id')
  infoWorld.raw.close()
  // first_ids names the offending row
  const ids = await planted(Q, 'first_ids', (x) => x.raw.exec('UPDATE products SET stock_quantity=-1 WHERE id=4'), { products_stock_negative: 1 }, { base: shapeWorld })
  assert.equal(JSON.parse(ids.rows[0].first_ids).products, 4)
})

// ---------------------------------------------------------------------------------------------------------------------
// 3. audit-b-movement-replay
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-movement-replay: the opening balance separates a silent drain from legacy opening stock, and ambiguous pairs are not replayed', async () => {
  const Q = 'audit-b-movement-replay'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.equal(clean.replay_pairs_opening_negative, 0)
  assert.equal(clean.replay_pairs_opening_positive, 0)
  assert.equal(clean.stock_pairs_without_movements, 0)
  assert.equal(clean.movement_pairs_without_stock_row, 0)
  assert.equal(clean.unreplayable_pairs, 1, 'only (product 2, Shop) holds a damage_in')
  assert.equal(clean.replay_pairs, clean.movement_pairs - 1)
  assert.equal(clean.replay_pairs_exact, clean.replay_pairs, 'every replayable pair of the clean world replays exactly')
  assert.equal(clean.examples_opening_negative, '[]')
  w0.raw.close()

  const add = (w, product, qty, type = 'add', extra = {}) => w.movement({ product, branch: SHOP, type, quantity: qty, reason: 'plant', ...extra })
  const r1 = await plant('an inflow logged that never reached the shelf', (w) => add(w, 7, 3), { replay_pairs_opening_negative: 1 })
  assert.equal(r1.rows[0].replay_opening_negative_units, 3)
  assert.deepEqual(JSON.parse(r1.rows[0].examples_opening_negative), [[7, SHOP, -3, 9, 12]])
  const r2 = await plant('a silent drain: the shelf lost 2 with no movement', (w) => w.run('UPDATE branch_stock SET quantity=quantity-2 WHERE product_id=3 AND branch_id=?', WAREHOUSE), { replay_pairs_opening_negative: 1 })
  assert.deepEqual(JSON.parse(r2.rows[0].examples_opening_negative), [[3, WAREHOUSE, -2, 26, 28]])
  await plant('a deleted outflow row (the S1 shape)', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', w.named.removed), { replay_pairs_opening_negative: 1 })
  const r3 = await plant('a branch_stock row deleted under live movements', (w) => w.run('DELETE FROM branch_stock WHERE product_id=7 AND branch_id=?', SHOP), { replay_pairs_opening_negative: 1 })
  assert.equal(r3.rows[0].movement_pairs_without_stock_row, 1)
  // legitimate or informational shapes: no zero-expected violation
  const r4 = await plant('stock the log does not explain is an opening, not a defect', (w) => w.run('UPDATE branch_stock SET quantity=quantity+5 WHERE product_id=3 AND branch_id=?', WAREHOUSE), {})
  assert.deepEqual([r4.rows[0].replay_pairs_opening_positive, r4.rows[0].replay_opening_positive_units], [1, 5])
  const r5 = await plant('shelf stock with no movement at all', (w) => w.raw.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(4,1,5)'), {})
  assert.deepEqual([r5.rows[0].stock_pairs_without_movements, r5.rows[0].stock_units_without_movements], [1, 5])
  const r6 = await plant('an ambiguous pair (a legacy set) is counted, not replayed, even with a phantom inflow', (w) => { add(w, 7, 0, 'set'); add(w, 7, 3) }, {})
  assert.equal(r6.rows[0].unreplayable_pairs, 2)
  assert.equal(r6.rows[0].replay_pairs_opening_negative, 0)
  await plant('a stock-in line edit writes a signed delta: -2 against a shelf that lost 2 replays exactly', (w) => {
    w.run('UPDATE branch_stock SET quantity=quantity-2 WHERE product_id=7 AND branch_id=?', SHOP)
    add(w, 7, -2, 'add', { reference: 'stock-in-edit:1:op:1' })
  }, {})
  await plant('the same -2 without the edit reference is an inflow of 2 (direction comes from the type)', (w) => {
    w.run('UPDATE branch_stock SET quantity=quantity-2 WHERE product_id=7 AND branch_id=?', SHOP)
    add(w, 7, -2, 'add')
  }, { replay_pairs_opening_negative: 1 })
})

// ---------------------------------------------------------------------------------------------------------------------
// 4. audit-b-movement-references
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-movement-references: each broken link fires its own column; text references and NULLs are left alone', async () => {
  const Q = 'audit-b-movement-references'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const firstOf = (type) => `(SELECT MIN(id) FROM inventory_movements WHERE movement_type='${type}')`
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.deepEqual(Object.values(JSON.parse(clean.first_ids)).filter((v) => v !== null), [])
  // the clean world holds every legitimate reference shape the query must NOT flag
  const shapes = w0.all("SELECT movement_type, typeof(reference_id) AS t, COUNT(*) AS n FROM inventory_movements GROUP BY 1, 2").map((r) => r.movement_type + ':' + r.t)
  for (const wanted of ['sale:integer', 'return:integer', 'damage_in:integer', 'add:null', 'remove:text']) assert.ok(shapes.includes(wanted), 'the clean world lacks ' + wanted + ' (' + shapes + ')')
  w0.raw.close()

  const r1 = await plant('a movement of a deleted product', (w) => w.run('UPDATE inventory_movements SET product_id=999, batch_id=NULL WHERE id=1'), { movements_product_missing: 1 })
  assert.equal(JSON.parse(r1.rows[0].first_ids).product, 1)
  await plant('a movement at a missing branch', (w) => w.run('UPDATE inventory_movements SET branch_id=99 WHERE id=1'), { movements_branch_missing: 1 })
  await plant('a movement whose lot was deleted', (w) => w.run('UPDATE inventory_movements SET batch_id=9999 WHERE id=1'), { movements_lot_missing: 1 })
  await plant('a movement stamped with another product\'s lot', (w) => w.run('UPDATE inventory_movements SET batch_id=? WHERE id=1', w.named.L3), { movements_lot_other_product: 1 })
  await plant('a sale movement of a sale that does not exist', (w) => w.run(`UPDATE inventory_movements SET reference_id=9999 WHERE id=${firstOf('sale')}`), { sale_movements_sale_missing: 1 })
  await plant('a sale movement of a product the sale does not hold', (w) => w.run(`UPDATE inventory_movements SET product_id=4, batch_id=NULL WHERE id=${firstOf('sale')}`), { sale_movements_line_missing: 1 })
  await plant('a return-family movement of a return that does not exist', (w) => w.movement({ product: 2, branch: SHOP, type: 'return_reversal', quantity: -1, reference: 777, reason: 'plant' }), { return_family_return_missing: 1 })
  await plant('a customer-return movement that names no record holding its product', (w) => w.run(`UPDATE inventory_movements SET reference_id=5000 WHERE id=${firstOf('return')}`), { ambiguous_reference_unowned: 1 })
  // not defects: NULL and text references, a cancel restock that names its SALE
  await plant('NULL and text references are not record ids', (w) => {
    w.run("UPDATE inventory_movements SET reference_id=NULL WHERE movement_type IN ('return','damage_in')")
    w.run("UPDATE inventory_movements SET reference_id='damaged-lot:1' WHERE movement_type='remove'")
  }, {})
})

// ---------------------------------------------------------------------------------------------------------------------
// 5. audit-b-transfers
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-transfers: unbalanced events, orphan legs, receipts, members, generations and history each fire their own column', async () => {
  const Q = 'audit-b-transfers'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.deepEqual([clean.transfer_rows, clean.transfer_rows_legacy, clean.transfer_legs, clean.transfer_events, clean.receipts_reversed], [4, 1, 8, 4, 1])
  assert.equal(clean.transfer_unbalanced_units, 0)
  assert.deepEqual(Object.values(JSON.parse(clean.first_ids)).filter((v) => v !== null), [])
  w0.raw.close()
  const dropTriggers = (w, ...names) => names.forEach((n) => w.raw.exec('DROP TRIGGER ' + n))
  const legacyIn = (w) => w.named.transfer.in
  const legacyOut = (w) => w.named.transfer.out

  const r1 = await plant('a transfer_in leg of 1 more than the out leg', (w) => w.run('UPDATE inventory_movements SET quantity=quantity+1 WHERE id=?', legacyIn(w)), { transfer_events_unbalanced: 1 })
  assert.equal(r1.rows[0].transfer_unbalanced_units, 1)
  assert.ok(JSON.parse(r1.rows[0].first_ids).event > 0)
  await plant('a deleted transfer_in leg', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', legacyIn(w)), { transfer_events_unbalanced: 1 })
  await plant('a stock_transfers row with its out leg deleted', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', legacyOut(w)), { transfer_events_unbalanced: 1, transfer_rows_without_out_leg: 1 })
  await plant('an out leg no stock_transfers row accounts for', (w) => w.run('DELETE FROM stock_transfers WHERE receipt_id IS NULL'), { out_legs_without_transfer_row: 1 })
  await plant('a stock_transfers row of another quantity than its leg', (w) => w.run('UPDATE stock_transfers SET quantity=quantity+1 WHERE receipt_id IS NULL'), { transfer_rows_quantity_mismatch: 1 })
  await plant('a committed receipt with no member', (w) => { dropTriggers(w, 'transfer_members_immutable_delete'); w.run('DELETE FROM transfer_operation_members WHERE receipt_id=?', w.named.opTransfer.receipt) },
    { receipts_without_members: 1, transfer_rows_receipt_missing: 1 })
  await plant('a member whose receipt is gone', (w) => { dropTriggers(w, 'transfer_receipts_immutable_delete'); w.run('DELETE FROM transfer_operation_receipts WHERE id=?', w.named.opTransfer.receipt) },
    { members_without_receipt: 1, transfer_rows_receipt_missing: 1 })
  await plant('a member quantity that is not its allocations plus the untracked part', (w) => { dropTriggers(w, 'transfer_members_immutable_update'); w.run('UPDATE transfer_operation_members SET quantity=quantity+1 WHERE receipt_id=?', w.named.opTransfer.receipt) }, { member_split_mismatch: 1 })
  await plant('replay_state reversed on generation 0 (and a history that still says undoable)', (w) => { dropTriggers(w, 'transfer_receipts_generation_update'); w.run("UPDATE transfer_operation_receipts SET replay_state='reversed' WHERE id=?", w.named.opTransfer.receipt) },
    { receipt_state_generation_mismatch: 1, history_state_mismatch: 1 })
  await plant('an undone transfer that lost its generation-1 stock_transfers row', (w) => w.run('DELETE FROM stock_transfers WHERE receipt_id=? AND generation=1', w.named.undoneTransfer.receipt),
    { receipt_generation_rows_mismatch: 1, out_legs_without_transfer_row: 1 })
  await plant('a provenance-1 receipt whose history row is gone', (w) => { dropTriggers(w, 'transfer_receipts_identity_update'); w.run('UPDATE transfer_operation_receipts SET action_history_id=NULL WHERE id=?', w.named.opTransfer.receipt) }, { history_row_missing: 1 })
  await plant('a history status that contradicts the receipt', (w) => w.run("UPDATE action_history SET status='undoable' WHERE id=?", w.named.undoneTransfer.history), { history_state_mismatch: 1 })
  await plant('an empty undo payload (Undo would do nothing)', (w) => w.run("UPDATE action_history SET undo_payload='{}' WHERE id=?", w.named.opTransfer.history), { history_payload_mismatch: 1 })
  await plant('a payload naming the wrong generation', (w) => w.run("UPDATE action_history SET redo_payload=json_set(redo_payload,'$.generation',5) WHERE id=?", w.named.opTransfer.history), { history_payload_mismatch: 1 })
  await plant('two transfers of one product in the same second still match each other (clusters, not single rows)', (w) => {
    const a = w.transfer(1, WAREHOUSE, SHOP, 2, { lot: w.named.L1 })
    const b = w.transfer(1, WAREHOUSE, SHOP, 1, { lot: w.named.L1 })
    w.run('UPDATE inventory_movements SET created_at=(SELECT created_at FROM inventory_movements WHERE id=?) WHERE id IN (?,?)', a.out, b.out, b.in)
    w.run('UPDATE stock_transfers SET created_at=(SELECT created_at FROM inventory_movements WHERE id=?) WHERE id=(SELECT MAX(id) FROM stock_transfers)', a.out)
  }, {})
  // legs one second apart (the two INSERTs of a batch straddling a second) are one event; five seconds apart are two
  await plant('legs one second apart still pair', (w) => w.run("UPDATE inventory_movements SET created_at=datetime(created_at,'+1 second') WHERE id=?", legacyIn(w)), {})
  await plant('legs five seconds apart do not pair', (w) => w.run("UPDATE inventory_movements SET created_at=datetime(created_at,'+5 seconds') WHERE id=?", legacyIn(w)), { transfer_events_unbalanced: 2 })
  // ISO timestamps (JS-stamped writers) are read the same way
  await plant('ISO timestamps on both legs', (w) => w.run("UPDATE inventory_movements SET created_at=replace(created_at,' ','T')||'.000Z' WHERE id IN (?,?)", legacyIn(w), legacyOut(w)), {})
})

// ---------------------------------------------------------------------------------------------------------------------
// 6. audit-b-sale-deductions
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-sale-deductions: every status transition table row fires its own column, and the exempt classes stay quiet', async () => {
  const Q = 'audit-b-sale-deductions'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  // the sale's own sale / cancel-restore movement ids
  const saleMovement = (w, sale) => w.get("SELECT id FROM inventory_movements WHERE movement_type='sale' AND reference_id=? ORDER BY id LIMIT 1", sale.id).id
  const restoreMovement = (w, sale) => w.get("SELECT id FROM inventory_movements WHERE movement_type='return' AND reference_id=? AND reason LIKE 'Sale cancelled%'", sale.id).id
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  // transition table of the clean world: completed / awaiting_payment / awaiting_delivery / partial_return hold, cancelled holds nothing
  assert.equal(clean.system_lines, 6, 'six system lines: three holding statuses, a cancelled sale, a sold-out sale, a partially returned sale')
  assert.deepEqual([clean.skipped_lines, clean.import_lines, clean.legacy_lines, clean.replacement_lines], [1, 0, 0, 0])
  assert.equal(clean.examples_system, '[]')
  assert.equal(clean.system_mismatch_first_sale_at, null)
  w0.raw.close()

  const S = (w) => w.named.sales
  await plant('Not Paid sale whose stock was never taken', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', saleMovement(w, S(w).awaitingPayment)), { deducted_never_deducted: 1 })
  await plant('completed sale that took 1 of its 3 units', (w) => w.run('UPDATE inventory_movements SET quantity=-1 WHERE id=?', saleMovement(w, S(w).completed)), { deducted_under_deducted: 1 })
  await plant('awaiting_delivery sale that took 3 for a 1-unit line', (w) => w.run('UPDATE inventory_movements SET quantity=-3 WHERE id=?', saleMovement(w, S(w).awaitingDelivery)), { deducted_over_deducted: 1 })
  await plant('cancelled sale whose restock row is missing (units still out)', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', restoreMovement(w, S(w).toCancel)), { cancelled_still_out: 1 })
  await plant('cancelled sale restored twice (phantom stock)', (w) => w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 4, reason: 'Sale cancelled (mistake)', reference: S(w).toCancel.id, batch: w.named.L2 }), { cancelled_over_restored: 1 })
  await plant('status flipped to cancelled with no restock (the movement still says out)', (w) => w.run("UPDATE sales SET sale_status='cancelled' WHERE id=?", S(w).completed.id), { cancelled_still_out: 1 })
  // lines come from sale_items, so a deducted movement whose line is gone is audit-b-movement-references.sql's (sale_movements_line_missing), not this query's
  await plant('sale line deleted but its units never given back (this query reads lines; the reference audit flags the orphan movement)', (w) => w.run('DELETE FROM sale_items WHERE id=?', S(w).completed.itemIds[0]), {})
  await planted('audit-b-movement-references', 'the same orphan movement', (w) => w.run('DELETE FROM sale_items WHERE id=?', S(w).completed.itemIds[0]), { sale_movements_line_missing: 1 }, { base: activeWorld })
  // legitimate shapes
  await plant('a line removed WITH its restock row is balanced', (w) => {
    w.run('DELETE FROM sale_items WHERE id=?', S(w).completed.itemIds[0])
    w.run('DELETE FROM sale_item_batch_allocations WHERE sale_item_id=?', S(w).completed.itemIds[0])
    w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 3, reason: 'Item removed from sale #' + S(w).completed.id, reference: S(w).completed.id, batch: w.named.L2 })
  }, {})
  const imp = await plant('an imported sale (not skipped) with no movement is info, not a defect', (w) => w.run('UPDATE sales SET stock_skipped=0 WHERE id=?', S(w).imported.id), {})
  assert.deepEqual([imp.rows[0].import_lines, imp.rows[0].import_lines_mismatch, imp.rows[0].skipped_lines], [1, 1, 0])
  const leg = await plant('a legacy-sale: sale with its movement deleted is info, not a defect', (w) => {
    w.run("UPDATE sales SET client_request_id='legacy-sale:1:1' WHERE id=?", S(w).completed.id)
    w.run('DELETE FROM inventory_movements WHERE id=?', saleMovement(w, S(w).completed))
  }, {})
  assert.deepEqual([leg.rows[0].legacy_lines, leg.rows[0].legacy_lines_mismatch], [1, 1])
  const rep = await plant('a replacement sale (source_return_id) is left to the returns audit', (w) => {
    w.run('UPDATE sales SET source_return_id=1 WHERE id=?', S(w).completed.id)
    w.run('DELETE FROM inventory_movements WHERE id=?', saleMovement(w, S(w).completed))
  }, {})
  assert.equal(rep.rows[0].replacement_lines, 1)
  const dmg = await plant('a damaged-lot line is not a branch line', (w) => {
    w.run('UPDATE sale_items SET damaged_lot_id=1 WHERE id=?', S(w).completed.itemIds[0])
    w.run('DELETE FROM inventory_movements WHERE id=?', saleMovement(w, S(w).completed))
  }, {})
  assert.equal(dmg.rows[0].damaged_lot_lines, 1)
  // a sale cancelled AFTER a customer return restocked part of it: the cancel gives back only the units the return did not (q - returned)
  const cancelAfterReturn = (restored) => (w) => {
    const sale = w.sale('completed', [{ product: 2, branch: SHOP, qty: 5, lot: w.named.L2 }])
    w.customerReturn(sale, [{ saleItem: sale.itemIds[0], product: 2, branch: SHOP, qty: 2, action: 'restock', lot: w.named.L2 }])
    w.run("UPDATE sales SET sale_status='cancelled' WHERE id=?", sale.id)
    w.bump({ product: 2, branch: SHOP, lot: w.named.L2, delta: restored })
    w.movement({ product: 2, branch: SHOP, type: 'return', quantity: restored, reason: 'Sale cancelled (mistake)', reference: sale.id, batch: w.named.L2 })
    w.run('UPDATE sale_item_batch_allocations SET released_quantity=? WHERE sale_item_id=?', restored, sale.itemIds[0])
  }
  await plant('cancel after a 2-unit return restores only the other 3 (q - returned)', cancelAfterReturn(3), {})
  await plant('cancel after a 2-unit return that restores all 5 phantoms 2 units', cancelAfterReturn(5), { cancelled_over_restored: 1 })
  // the era columns and the example list name the offender
  const era = await plant('examples and era', (w) => w.run('UPDATE inventory_movements SET quantity=-1 WHERE id=?', saleMovement(w, S(w).completed)), { deducted_under_deducted: 1 })
  assert.deepEqual(JSON.parse(era.rows[0].examples_system), [[1, 2, SHOP, 'completed', 3, 1]])
  assert.ok(era.rows[0].system_mismatch_first_sale_at && era.rows[0].system_mismatch_first_sale_at === era.rows[0].system_mismatch_last_sale_at)
})

// ---------------------------------------------------------------------------------------------------------------------
// 7. audit-b-stock-skipped-sales
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-stock-skipped-sales: a skipped sale that moved stock fires, a customer return that merely shares its number does not', async () => {
  const Q = 'audit-b-stock-skipped-sales'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.deepEqual([clean.skipped_sales, clean.skipped_import, clean.skipped_legacy, clean.skipped_other, clean.import_sales, clean.import_sales_unmarked], [1, 1, 0, 0, 1, 0])
  assert.equal(clean.examples, '[]')
  const skipped = w0.named.sales.imported
  w0.raw.close()

  const r1 = await plant('a sale movement on a skipped sale', (w) => w.movement({ product: 2, branch: SHOP, type: 'sale', quantity: -2, reference: w.named.sales.imported.id, reason: 'plant' }), { skipped_sale_movement_rows: 1 })
  assert.equal(r1.rows[0].skipped_movement_net_units, -2)
  assert.deepEqual(JSON.parse(r1.rows[0].examples).map((e) => e.slice(0, 1).concat(e.slice(2))), [[skipped.id, 'sale', -2]])
  const r2 = await plant('a cancel restock on a skipped sale (units never taken, handed back)', (w) => w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 2, reference: w.named.sales.imported.id, reason: 'Sale cancelled (mistake)' }), { skipped_sale_movement_rows: 1 })
  assert.equal(r2.rows[0].skipped_movement_net_units, 2)
  await plant('a damage movement on a skipped sale', (w) => w.movement({ product: 2, branch: SHOP, type: 'damage_out', quantity: -1, reference: w.named.sales.imported.id, reason: 'plant' }), { skipped_sale_movement_rows: 1 })
  await plant('allocations still holding units on a skipped sale', (w) => w.run('UPDATE sale_item_batch_allocations SET released_quantity=0 WHERE sale_item_id=?', w.named.sales.imported.itemIds[0]), { skipped_sale_allocations_held: 2 })
  // a REAL customer return against a skipped sale restocks normally and names the return, not the sale
  const cr = await plant('a customer return on a skipped sale is legitimate (info only)', (w) => {
    const s = w.named.sales.imported
    w.customerReturn(s, [{ saleItem: s.itemIds[0], product: 2, branch: SHOP, qty: 1, action: 'restock', lot: w.named.L2 }])
  }, {})
  assert.deepEqual([cr.rows[0].skipped_with_customer_returns, cr.rows[0].skipped_return_restock_units], [1, 1])
  // ... even when the return's id equals the skipped sale's id (two autoincrement sequences collide freely): told apart by the reason
  await plant('a return whose id equals the skipped sale id is not the sale\'s movement', (w) => {
    const s = w.named.sales.imported
    w.customerReturn(w.named.sales.returned, [{ saleItem: w.named.sales.returned.itemIds[0], product: 2, branch: SHOP, qty: 1, action: 'restock', lot: w.named.L2 }], { id: s.id })
  }, {})
  const un = await plant('an import sale not marked (pre-0235): info columns, including the phantom cancel restock', (w) => {
    const s = w.named.sales.imported
    w.run("UPDATE sales SET stock_skipped=0, sale_status='cancelled' WHERE id=?", s.id)
    w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 2, reference: s.id, reason: 'Sale cancelled (mistake)' })
  }, {})
  assert.deepEqual([un.rows[0].import_sales_unmarked, un.rows[0].import_unmarked_cancelled, un.rows[0].import_unmarked_cancel_restock_units], [1, 1, 2])
  assert.equal(un.rows[0].skipped_sales, 0)
})

// ---------------------------------------------------------------------------------------------------------------------
// 8. audit-b-returns-restock
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-returns-restock: restock / damaged / none / cancel / edit / replace each fire their own column; sale-cancel rows sharing a return id do not', async () => {
  const Q = 'audit-b-returns-restock'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const R = (w) => w.named.returns
  const moveOf = (w, returnId, type) => w.get('SELECT id FROM inventory_movements WHERE reference_id=? AND movement_type=? ORDER BY id LIMIT 1', returnId, type).id
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.deepEqual([clean.returns_checked, clean.return_groups, clean.returns_without_any_movement, clean.restock_lines_without_allocation], [4, 4, 0, 0])
  assert.equal(clean.examples, '[]')
  w0.raw.close()

  await plant('a restock line whose movement is missing (never restocked)', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', moveOf(w, R(w).restock, 'return')), { restock_short: 1 })
  await plant('a restock of 0.5 for a 1-unit line', (w) => w.run('UPDATE inventory_movements SET quantity=0.5 WHERE id=?', moveOf(w, R(w).restock, 'return')), { restock_short: 1 })
  await plant('a restock written twice', (w) => w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 1, reason: 'Return: changed mind', reference: R(w).restock, batch: w.named.L2 }), { restock_excess: 1 })
  await plant('a DAMAGED line that also moved sellable stock (the double count)', (w) => w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 1, reason: 'Return: changed mind', reference: R(w).damaged, batch: w.named.L2 }), { restock_excess: 1 })
  await plant('a NONE line that moved sellable stock', (w) => w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 1, reason: 'Return: changed mind', reference: R(w).none, batch: w.named.L2 }), { restock_excess: 1 })
  await plant('a cancelled return whose restock was not taken back', (w) => w.run("UPDATE returns SET status='cancelled' WHERE id=?", R(w).restock), { cancelled_return_still_in: 1 })
  await plant('a properly cancelled restock return and a properly cancelled damaged return', (w) => {
    w.run("UPDATE returns SET status='cancelled' WHERE id IN (?,?)", R(w).restock, R(w).damaged)
    w.movement({ product: 2, branch: SHOP, type: 'return_reversal', quantity: -1, reason: 'Return #RT1 cancelled', reference: R(w).restock, batch: w.named.L2 })
    w.movement({ product: 2, branch: SHOP, type: 'damage_reversal', quantity: -1, reason: 'Return #RT2 cancelled', reference: R(w).damaged, batch: w.named.L2 })
  }, {})
  await plant('a cancelled return reversed twice', (w) => {
    w.run("UPDATE returns SET status='cancelled' WHERE id=?", R(w).restock)
    for (let i = 0; i < 2; i++) w.movement({ product: 2, branch: SHOP, type: 'return_reversal', quantity: -1, reason: 'Return #RT1 cancelled', reference: R(w).restock, batch: w.named.L2 })
  }, { cancelled_return_over_reversed: 1 })
  await plant('a damaged line whose damage_in is missing', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', moveOf(w, R(w).damaged, 'damage_in')), { damage_movement_mismatch: 1 })
  await plant('a damaged line whose tagged lot is another size', (w) => w.run('UPDATE damaged_stock_lots SET quantity=2, quantity_remaining=2 WHERE return_id=?', R(w).damaged), { damaged_lot_mismatch: 1 })
  await plant('a replacement item whose replacement_out movement is missing', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', w.named.replacementOut), { replacement_mismatch: 1 })
  await plant('a restock line whose lot rows add up to another figure', (w) => w.run('UPDATE return_item_batch_allocations SET quantity=0.5 WHERE return_item_id=(SELECT id FROM return_items WHERE return_id=?)', R(w).restock), { allocation_sum_mismatch: 1 })
  await plant('lot rows on a damaged line (it never entered a lot)', (w) => w.run('INSERT INTO return_item_batch_allocations(return_item_id,batch_id,branch_id,quantity) VALUES((SELECT id FROM return_items WHERE return_id=?),?,?,1)', R(w).damaged, w.named.L2, SHOP), { allocation_sum_mismatch: 1 })
  await plant('a restock lot row that names another product\'s lot', (w) => w.run('UPDATE return_item_batch_allocations SET batch_id=? WHERE return_item_id=(SELECT id FROM return_items WHERE return_id=?)', w.named.L3, R(w).restock), { allocation_lot_other_product: 1 })
  // legitimate shapes
  await plant('an edited return: +1, reversal -1, new +2 against a 2-unit line', (w) => {
    w.run('UPDATE return_items SET quantity=2 WHERE return_id=?', R(w).restock)
    w.run('UPDATE return_item_batch_allocations SET quantity=2 WHERE return_item_id=(SELECT id FROM return_items WHERE return_id=?)', R(w).restock)
    w.movement({ product: 2, branch: SHOP, type: 'return_reversal', quantity: -1, reason: 'Return #RT1 updated - reversing previous restock', reference: R(w).restock, batch: w.named.L2 })
    w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 2, reason: 'Return #RT1 updated: changed mind', reference: R(w).restock, batch: w.named.L2 })
  }, {})
  await plant('a SALE cancel restock whose sale id equals a return id is not the return\'s movement', (w) => w.movement({ product: 2, branch: SHOP, type: 'return', quantity: 1, reason: 'Sale cancelled (mistake)', reference: R(w).restock, batch: w.named.L2 }), {})
  const legacy = await plant('an old-system return: restock line with no movement and no lot row', (w) => {
    w.run("INSERT INTO returns(id,return_number,sale_id,branch_id,return_scope,status,created_at) VALUES(50,'OLD1',?,?, 'customer','completed','2026-08-30 10:00:00')", w.named.sales.returned.id, SHOP)
    w.run("INSERT INTO return_items(return_id,sale_item_id,product_id,quantity,return_to_stock,stock_action,branch_id) VALUES(50,?,2,1,1,'restock',?)", w.named.sales.returned.itemIds[0], SHOP)
  }, { restock_short: 1 })
  assert.deepEqual([legacy.rows[0].returns_without_any_movement, legacy.rows[0].restock_lines_without_allocation], [1, 1])
  assert.equal(legacy.rows[0].mismatch_first_return_at, '2026-08-30 10:00:00')
  assert.deepEqual(JSON.parse(legacy.rows[0].examples), [[50, 2, SHOP, 'completed', 1, 0, 0, 0]])
  // supplier returns are not customer returns
  await plant('a supplier-scope return is out of scope', (w) => {
    w.run("INSERT INTO returns(id,return_number,return_scope,status,branch_id) VALUES(60,'SUP1','supplier','completed',?)", SHOP)
    w.run("INSERT INTO return_items(return_id,product_id,quantity,return_to_stock,stock_action,branch_id) VALUES(60,2,1,1,'restock',?)", SHOP)
  }, {})
})

// ---------------------------------------------------------------------------------------------------------------------
// 9. audit-b-revert-linkage
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-revert-linkage: a Revert must name an existing original and invert exactly its delta; the Set undo and revert-of-revert shapes are legal', async () => {
  const Q = 'audit-b-revert-linkage'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.deepEqual([clean.reverts, clean.reverts_of_reverts], [3, 0], 'one stock Revert and the Undo counters of two scoped Sets')
  assert.deepEqual(Object.values(JSON.parse(clean.first_ids)).filter((v) => v !== null), [])
  w0.raw.close()
  const rev = (w) => w.named.revert
  const orig = (w) => w.named.added

  await plant('a reference that is not exactly revert:<integer>', (w) => w.run("UPDATE inventory_movements SET reference_id='revert:abc' WHERE id=?", rev(w)), { revert_reference_malformed: 1 })
  await plant('a reference with a leading zero', (w) => w.run("UPDATE inventory_movements SET reference_id='revert:0'||? WHERE id=?", String(orig(w)), rev(w)), { revert_reference_malformed: 1 })
  await plant('an original that was deleted', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', orig(w)), { revert_original_missing: 1 })
  await plant('a Revert written before its original', (w) => {
    const next = w.get('SELECT MAX(id)+1 AS n FROM inventory_movements').n
    w.movement({ product: 7, branch: SHOP, type: 'remove', quantity: 1, reason: 'plant', reference: 'revert:' + (next + 1), batch: w.named.L7 })
    w.movement({ product: 7, branch: SHOP, type: 'add', quantity: 1, reason: 'plant', batch: w.named.L7 })
  }, { revert_id_precedes_original: 1 })
  await plant('a Revert at another branch', (w) => w.run('UPDATE inventory_movements SET branch_id=? WHERE id=?', WAREHOUSE, rev(w)), { revert_wrong_product_or_branch: 1 })
  await plant('a Revert of 3 for an original of 4 (does not invert its delta)', (w) => w.run('UPDATE inventory_movements SET quantity=3 WHERE id=?', rev(w)), { revert_quantity_not_inverse: 1 })
  await plant('a Revert that moves stock the same way as its original', (w) => w.run("UPDATE inventory_movements SET movement_type='add' WHERE id=?", rev(w)), { revert_direction_not_inverse: 1 })
  await plant('a Revert that lost the original\'s lot', (w) => w.run('UPDATE inventory_movements SET batch_id=NULL WHERE id=?', rev(w)), { revert_lot_differs: 1 })
  await plant('a Revert of a sale movement', (w) => {
    const sale = w.get("SELECT id, quantity FROM inventory_movements WHERE movement_type='sale' ORDER BY id LIMIT 1")
    w.movement({ product: 2, branch: SHOP, type: 'add', quantity: Math.abs(sale.quantity), reason: 'plant', reference: 'revert:' + sale.id, batch: w.named.L2 })
  }, { revert_of_unrevertible_type: 1 })
  await plant('an original reverted twice', (w) => w.movement({ product: 7, branch: SHOP, type: 'remove', quantity: 4, reason: 'plant', reference: 'revert:' + orig(w), batch: w.named.L7 }), { originals_reverted_more_than_once: 1 })
  // legal shapes
  await plant('undo of the downward half of a scoped Set: forward remove, counter adjustment', (w) => {
    const forward = w.movement({ product: 3, branch: WAREHOUSE, type: 'remove', quantity: 2, reason: 'Set to 26', reference: 'stock-set:op-9:0', batch: w.named.L3 })
    w.movement({ product: 3, branch: WAREHOUSE, type: 'adjustment', quantity: 2, reason: 'Undo: Set to 26', reference: 'revert:' + forward, batch: w.named.L3 })
  }, {})
  await plant('undo of a TAGGED scoped Set: forward damage_out (the hold), counter adjustment', (w) => {
    const forward = w.movement({ product: 3, branch: WAREHOUSE, type: 'damage_out', quantity: 2, reason: 'Set to 26', reference: 'stock-set:op-9:0', batch: w.named.L3 })
    w.movement({ product: 3, branch: WAREHOUSE, type: 'adjustment', quantity: 2, reason: 'Undo: Set to 26', reference: 'revert:' + forward, batch: w.named.L3 })
  }, {})
  const rr = await plant('a Revert of a Revert is legal (the revert of the remove is an add)', (w) => w.movement({ product: 7, branch: SHOP, type: 'add', quantity: 4, reason: 'plant', reference: 'revert:' + rev(w), batch: w.named.L7 }), {})
  assert.deepEqual([rr.rows[0].reverts, rr.rows[0].reverts_of_reverts], [4, 1])
  let revertId = null
  const names = await plant('the first_ids object names the offending Revert', (w) => { revertId = rev(w); w.run('UPDATE inventory_movements SET quantity=3 WHERE id=?', revertId) }, { revert_quantity_not_inverse: 1 })
  assert.equal(JSON.parse(names.rows[0].first_ids).quantity, revertId)
})

// ---------------------------------------------------------------------------------------------------------------------
// 10. audit-b-set-and-session-undo
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-set-and-session-undo: Set generations, Reverts of a Set, stock-in sessions and their history each fire their own column', async () => {
  const Q = 'audit-b-set-and-session-undo'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const S = (w) => w.named.sets
  const T = (w) => w.named.sessions
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.deepEqual([clean.set_operations, clean.set_operations_reversed, clean.line_edit_operations, clean.stock_sessions, clean.stock_session_members_total, clean.stock_sessions_reversed], [3, 1, 0, 2, 2, 1])
  assert.deepEqual([clean.set_branch_delta_differs, clean.open_history_rows, clean.open_history_without_applier, clean.open_history_without_applier_by_entity], [0, 7, 0, '{}'])
  assert.deepEqual(Object.values(JSON.parse(clean.first_ids)).filter((v) => v !== null), [])
  w0.raw.close()

  // scoped Set generations (G = 0 applied, 1 reversed, 2 applied again)
  await plant('state reversed at an even generation (and a history that still says undoable)', (w) => w.run("UPDATE stock_lot_adjustment_operations SET state='reversed' WHERE id=?", S(w).down.op), { set_state_generation_mismatch: 1, operation_history_mismatch: 1 })
  await plant('a Set whose forward movement is gone', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', S(w).down.forward[0]), { set_forward_rows_mismatch: 1 })
  await plant('a redone Set that lost its generation-2 forward row', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', S(w).redone.forward[1]), { set_forward_rows_mismatch: 1 })
  await plant('a forward movement of another size than the delta', (w) => w.run('UPDATE inventory_movements SET quantity=3 WHERE id=?', S(w).down.forward[0]), { set_forward_quantity_mismatch: 1 })
  await plant('a forward movement at another branch', (w) => w.run('UPDATE inventory_movements SET branch_id=? WHERE id=?', WAREHOUSE, S(w).down.forward[0]), { set_forward_scope_mismatch: 1 })
  await plant('a downward Set recorded as an adjustment (up)', (w) => w.run("UPDATE inventory_movements SET movement_type='adjustment' WHERE id=?", S(w).down.forward[0]), { set_forward_direction_mismatch: 1 })
  await plant('an undone Set whose counter movement is gone', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', S(w).undone.counter[0]), { set_counter_rows_mismatch: 1 })
  await plant('a counter that inverts 1 of the 2 units (the SK-II shape)', (w) => w.run('UPDATE inventory_movements SET quantity=1 WHERE id=?', S(w).undone.counter[0]), { set_counter_quantity_mismatch: 1 })
  await plant('an operation with no history row', (w) => w.run('UPDATE stock_lot_adjustment_operations SET history_id=NULL WHERE id=?', S(w).down.op), { operation_history_missing: 1, open_history_without_operation: 1 })
  await plant('an empty undo payload (Undo would report success and do nothing)', (w) => w.run("UPDATE action_history SET undo_payload='{}' WHERE id=?", S(w).down.history), { operation_history_mismatch: 1 })
  await plant('a payload that names another generation', (w) => w.run("UPDATE action_history SET redo_payload=json_set(redo_payload,'$.generation',4) WHERE id=?", S(w).redone.history), { operation_history_mismatch: 1 })
  await plant('a payload that is not JSON at all', (w) => w.run("UPDATE action_history SET undo_payload='not json' WHERE id=?", S(w).down.history), { operation_history_mismatch: 1 })
  const editPayload = JSON.stringify({ applier: 'stock.session_line_edit', operation_id: 'edit-1', generation: 0 })
  const addLineEdit = (payload) => (w) => {
    const h = Number(w.run("INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload) VALUES('inventory','stock_in_line_edit','2','Edit',1,'undoable',?,?)", payload, payload).lastInsertRowid)
    w.run("INSERT INTO stock_lot_adjustment_operations(id,actor_id,request_id,request_json,request_digest,response_json,before_json,after_json,revision_json,history_id) VALUES('edit-1',7,'edit-1','{}','d','{}','{}','{}','{}',?)", h)
  }
  await plant('a line-edit operation with the right applier is clean', addLineEdit(editPayload), {})
  const le = await plant('a line-edit operation with an empty payload', addLineEdit('{}'), { operation_history_mismatch: 1 })
  assert.equal(le.rows[0].line_edit_operations, 1)
  const info = await plant('a lot-scope Set whose branch delta differs from the lot delta is info (the Part-77 floor)', (w) => w.run("UPDATE stock_lot_adjustment_operations SET after_json=json_set(after_json,'$.branchQuantity',json_extract(after_json,'$.branchQuantity')+3) WHERE id=?", S(w).down.op), {})
  assert.equal(info.rows[0].set_branch_delta_differs, 1)

  // stock-in sessions
  await plant('a session whose members are gone', (w) => w.run('DELETE FROM stock_session_members WHERE operation_id=?', T(w).live.op), { session_ops_without_members: 1 })
  await plant('a member with no receipt movement id', (w) => w.run('UPDATE stock_session_members SET movement_id=NULL WHERE operation_id=?', T(w).live.op), { session_member_movement_missing: 1 })
  await plant('a member whose receipt movement was deleted', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', T(w).live.movement), { session_member_movement_missing: 1 })
  await plant('a receipt movement of another size than its member', (w) => w.run('UPDATE inventory_movements SET quantity=5 WHERE id=?', T(w).live.movement), { session_member_movement_mismatch: 1 })
  await plant('a receipt movement not stamped with its operation', (w) => w.run('UPDATE inventory_movements SET reference_id=NULL WHERE id=?', T(w).live.movement), { session_member_movement_mismatch: 1 })
  await plant('a member whose lot belongs to another product', (w) => w.run('UPDATE stock_session_members SET batch_id=? WHERE operation_id=?', w.named.L3, T(w).live.op), { session_member_lot_other_product: 1, session_member_movement_mismatch: 1 })
  await plant('an undone session whose undo rows are missing', (w) => w.run('DELETE FROM inventory_movements WHERE id=?', T(w).undone.undo), { session_generation_rows_mismatch: 1 })
  await plant('a session whose undo snapshot is empty', (w) => w.run("UPDATE undo_snapshots SET payload_json='{}' WHERE id=?", T(w).live.snapshot), { session_snapshot_unusable: 1 })
  await plant('a session whose snapshot is gone', (w) => w.run('DELETE FROM undo_snapshots WHERE id=?', T(w).live.snapshot), { session_snapshot_unusable: 1 })
  await plant('a session snapshot in the wrong state for its generation', (w) => w.run("UPDATE undo_snapshots SET status='reversed' WHERE id=?", T(w).live.snapshot), { session_snapshot_unusable: 1 })
  await plant('a session whose history payload is empty', (w) => w.run("UPDATE action_history SET undo_payload='{}' WHERE id=?", T(w).live.history), { session_history_mismatch: 1 })
  await plant('a session whose history status contradicts its generation', (w) => w.run("UPDATE action_history SET status='undoable' WHERE id=?", T(w).undone.history), { session_history_mismatch: 1 })
  await plant('a session with no history row', (w) => w.run('UPDATE stock_session_operations SET history_id=NULL WHERE id=?', T(w).live.op), { session_history_mismatch: 1, open_history_without_operation: 1 })
  // open history
  await plant('an open stock-session history row no operation points at', (w) => {
    const payload = JSON.stringify({ applier: 'stock.session', operation_id: 'ghost', snapshot_id: 1, generation: 0 })
    w.run("INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload) VALUES('global','stock_session','ghost','Ghost',1,'undoable',?,?)", payload, payload)
  }, { open_history_without_operation: 1 })
  const noApplier = await plant('open history of another family with no applier is info (client-side undo)', (w) => w.run("INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload) VALUES('sales','sale','1','Edit',1,'undoable','{}','{}')"), {})
  assert.deepEqual([noApplier.rows[0].open_history_without_applier, noApplier.rows[0].open_history_without_applier_by_entity], [1, '{"sale":1}'])
})

// ---------------------------------------------------------------------------------------------------------------------
// 11. audit-b-catalog-cost
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-catalog-cost: the set-based formula agrees with the 0195 triggers (override, sold-out fallback, half-up) and each unrecomputed input change drifts', async () => {
  const Q = 'audit-b-catalog-cost'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  // products 1-7 and 9 are priced by the formula (6 has no recorded cost: 0 and NULL lots); 8 is removed
  assert.deepEqual([clean.active_products, clean.products_with_derivation, clean.manual_entries, clean.overridden_products], [8, 7, 1, 1])
  assert.deepEqual([clean.cost_without_basis, clean.purchase_cost_differs, clean.drift_stored_zero], [0, 0, 0])
  assert.equal(clean.examples, '[]')
  // the triggers' own figures are the oracle: product 4 carries a manual override AND later lots, 5 is sold out (newest lot stands in)
  assert.deepEqual(w0.all('SELECT id, cost_price_usd c FROM products WHERE id IN (1, 4, 5) ORDER BY id').map((r) => r.c), [2.2857, 8.4444, 6])
  w0.raw.close()

  // half away from zero at 4dp: 1.0001 and 1.0002, one unit each, average 1.00015 -> 1.0002 (the trigger and the query must agree)
  await plant('a tie at the fifth decimal rounds up like the trigger', (w) => {
    w.product(10, 'Product 10')
    w.receive(10, SHOP, 1, { cost: 1.0001, received: '2026-08-01' })
    w.receive(10, SHOP, 1, { cost: 1.0002, received: '2026-08-02' })
    assert.equal(w.get('SELECT cost_price_usd c FROM products WHERE id=10').c, 1.0002)
  }, {})
  const drift = await plant('a stored cost of 9 where the lots say 3', (w) => w.run('UPDATE products SET cost_price_usd=9 WHERE id=2'), { catalog_cost_drift: 1 })
  assert.deepEqual([drift.rows[0].drift_stored_higher, drift.rows[0].drift_stored_lower, drift.rows[0].drift_stored_zero, drift.rows[0].drift_abs_sum_usd], [1, 0, 0, 6])
  assert.deepEqual(JSON.parse(drift.rows[0].examples), [[2, 9, 3, 30]])
  const edited = await plant('a lot cost edited without a recompute (no trigger fires on unit_cost_usd)', (w) => w.run('UPDATE product_batches SET unit_cost_usd=10 WHERE id=?', w.named.L7), { catalog_cost_drift: 1 })
  assert.equal(edited.rows[0].drift_stored_lower, 1)
  await plant('a manual cost entry added without the route\'s recompute', (w) => w.costEntry(7, 8, w.get('SELECT MAX(id) m FROM product_batches WHERE variant_product_id=7').m), { catalog_cost_drift: 1 })
  const zero = await plant('a catalog cost of 0 on costed stock', (w) => w.run('UPDATE products SET cost_price_usd=0 WHERE id=3'), { catalog_cost_drift: 1 })
  assert.equal(zero.rows[0].drift_stored_zero, 1)
  await plant('a lot activated or deactivated with nothing to derive from leaves the stored figure alone (sold-out product, lot inactive)', (w) => w.run('UPDATE product_batches SET is_active=0 WHERE id=?', w.named.L5), {})
  const basis = await plant('a stored cost no lot and no entry explains is info', (w) => w.run('UPDATE products SET cost_price_usd=3 WHERE id=6'), {})
  assert.equal(basis.rows[0].cost_without_basis, 1)
  await plant('a removed product\'s frozen cost is not audited', (w) => w.run('UPDATE products SET cost_price_usd=99 WHERE id=8'), {})
  const mirror = await plant('purchase_price_usd away from cost_price_usd is info', (w) => w.run('UPDATE products SET purchase_price_usd=77 WHERE id=2'), {})
  assert.equal(mirror.rows[0].purchase_cost_differs, 1)
  // a manual entry only re-prices the lots AT OR BELOW its baseline: lots received after it count at their own cost (product 4: 5 units at 8, 4 at 9)
  await plant('a stored cost that ignores the override (the lots\' own 7 and 9 averaged)', (w) => w.run('UPDATE products SET cost_price_usd=8.0 WHERE id=4'), { catalog_cost_drift: 1 })
})

// ---------------------------------------------------------------------------------------------------------------------
// 12. audit-b-lots-and-cost-gaps
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-lots-and-cost-gaps: a lot of an inactive product, a missing supplier, an orphan cost entry fire; unknown / free / untracked stock is sized, not flagged', async () => {
  const Q = 'audit-b-lots-and-cost-gaps'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.deepEqual([clean.stock_lots_unknown_cost, clean.stock_units_unknown_cost, clean.stock_lots_zero_cost, clean.products_stock_without_any_lot], [1, 2, 0, 0])
  assert.deepEqual([clean.cost_entries, clean.cost_entries_not_positive, clean.overridden_lots_cost_differs, clean.lots_received_cost_drift], [1, 0, 1, 0], 'product 4: its first lot (cost 7) is re-priced to the entry\'s 8')
  assert.equal(clean.examples_inactive_product_lots, '[]')
  const base = clean
  w0.raw.close()

  const r1 = await plant('a product merged away (inactive) that still owns a lot with stock (the 0109 shape)', (w) => w.run('UPDATE products SET is_active=0 WHERE id=7'), { stock_lots_of_inactive_products: 1, inactive_products_with_stock: 1 })
  assert.equal(r1.rows[0].examples_inactive_product_lots.startsWith('[['), true)
  assert.deepEqual(JSON.parse(r1.rows[0].examples_inactive_product_lots).map((e) => e.slice(1)), [[7, 9]])
  await plant('a lot whose supplier row was deleted', (w) => w.run('UPDATE product_batches SET supplier_id=999 WHERE id=?', w.named.L2), { lots_supplier_missing: 1 })
  await plant('a manual cost entry of a deleted product', (w) => w.costEntry(999, 4, 0), { cost_entries_orphan_product: 1 })
  // an inactive product with NO stock is simply removed history: not a finding
  await plant('a removed product with no stock is fine', (w) => w.run('UPDATE products SET is_active=0 WHERE id=5'), {})
  const untracked = await plant('an active product with stock and no lot at all (legacy untracked stock)', (w) => {
    w.product(11, 'Product 11')
    w.raw.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(11,2,4)')
    w.run('UPDATE products SET stock_quantity=4 WHERE id=11')
  }, {})
  assert.deepEqual([untracked.rows[0].products_stock_without_any_lot, untracked.rows[0].units_stock_without_any_lot, untracked.rows[0].products_stock_without_costed_lot - base.products_stock_without_costed_lot,
    untracked.rows[0].products_cost_zero_with_stock - base.products_cost_zero_with_stock], [1, 4, 1, 1])
  const free = await plant('a lot with stock at $0', (w) => w.run('UPDATE product_batches SET unit_cost_usd=0 WHERE id=?', w.named.L7), {})
  assert.deepEqual([free.rows[0].stock_lots_zero_cost, free.rows[0].stock_units_zero_cost], [1, 9])
  const exceed = await plant('a lot holding more than it ever received (an upward count is not a purchase)', (w) => w.run('UPDATE product_batches SET received_quantity=1 WHERE id=?', w.named.L7), {})
  assert.deepEqual([exceed.rows[0].lots_stock_exceeds_received, exceed.rows[0].units_stock_exceeds_received], [base.lots_stock_exceeds_received + 1, base.units_stock_exceeds_received + 8])
  const drift = await plant('received cost off from unit x quantity', (w) => w.run('UPDATE product_batches SET received_cost_usd=999 WHERE id=?', w.named.L7), {})
  assert.equal(drift.rows[0].lots_received_cost_drift, 1)
  const zeroEntry = await plant('a manual cost entry of 0', (w) => w.costEntry(2, 0, 0), {})
  assert.deepEqual([zeroEntry.rows[0].cost_entries, zeroEntry.rows[0].cost_entries_not_positive], [2, 1])
})

// ---------------------------------------------------------------------------------------------------------------------
// 13. audit-b-lot-duplicates
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-lot-duplicates: the same business day written three ways, at one branch, with one expiry and one supplier, is a duplicate; a supplier or expiry split is not', async () => {
  const Q = 'audit-b-lot-duplicates'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const two = (a, b) => (w) => {
    w.product(10, 'Product 10')
    w.receive(10, SHOP, 3, { received: a.received, expiry: a.expiry ?? null, cost: a.cost ?? 2, supplier: a.supplier ?? null, supplierName: a.supplierName ?? null })
    w.receive(10, b.branch2 ?? SHOP, 4, { received: b.received, expiry: b.expiry ?? null, cost: b.cost ?? 2, supplier: b.supplier ?? null, supplierName: b.supplierName ?? null })
  }
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.equal(clean.duplicate_lot_groups, 0)
  assert.equal(clean.positive_lots > 5, true)
  w0.raw.close()

  const iso = await plant('ISO date and ISO timestamp of the same Cambodia day', two({ received: '2026-09-01' }, { received: '2026-09-01T03:00:00Z' }), { duplicate_lot_groups: 1 })
  assert.deepEqual([iso.rows[0].duplicate_lots, iso.rows[0].duplicate_extra_lots, iso.rows[0].duplicate_units], [2, 1, 7])
  await plant('a UTC evening instant is the NEXT Cambodia day (so it matches the next date)', two({ received: '2026-09-02' }, { received: '2026-09-01T20:00:00Z' }), { duplicate_lot_groups: 1 })
  await plant('a UTC evening instant is not the same day as the UTC date', two({ received: '2026-09-01' }, { received: '2026-09-01T20:00:00Z' }), {})
  await plant('a month-first slash date matches the ISO date', two({ received: '2026-09-02' }, { received: '09/02/2026' }), { duplicate_lot_groups: 1 })
  await plant('different expiry dates keep lots apart', two({ received: '2026-09-01', expiry: '2027-01-01' }, { received: '2026-09-01T03:00:00Z', expiry: '2027-02-01' }), {})
  await plant('two different suppliers keep lots apart (info only)', two({ received: '2026-09-01', supplier: 1, supplierName: 'Acme' }, { received: '2026-09-01T03:00:00Z', supplierName: 'Other' }), {})
  const split = await run((() => { const w = activeWorld(); two({ received: '2026-09-01', supplier: 1, supplierName: 'Acme' }, { received: '2026-09-01T03:00:00Z', supplierName: 'Other' })(w); return w })(), Q)
  assert.equal(split.rows[0].supplier_split_groups, 1)
  const empty = await plant('a no-supplier lot beside a supplied one merges', two({ received: '2026-09-01', supplier: 1, supplierName: 'Acme' }, { received: '2026-09-01T03:00:00Z' }), { duplicate_lot_groups: 1 })
  assert.equal(empty.rows[0].duplicate_groups_empty_supplier, 1)
  await plant('the same day at two branches is the cutover fold, not a duplicate here', two({ received: '2026-09-01' }, { received: '2026-09-01T03:00:00Z', branch2: WAREHOUSE }), {})
  const cost = await plant('differing costs are sized', two({ received: '2026-09-01', cost: 2 }, { received: '2026-09-01T03:00:00Z', cost: 3 }), { duplicate_lot_groups: 1 })
  assert.equal(cost.rows[0].duplicate_groups_cost_differs, 1)
  await plant('a duplicate lot with no stock is not counted', (w) => { two({ received: '2026-09-01' }, { received: '2026-09-01T03:00:00Z' })(w); w.run('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=(SELECT MAX(id) FROM product_batches)') }, {})
  const ev = await plant('a return-created event lot beside the day lot', (w) => { two({ received: '2026-09-01' }, { received: '2026-09-01T03:00:00Z' })(w); w.run("UPDATE product_batches SET batch_key=' event:r1' WHERE id=(SELECT MAX(id) FROM product_batches)") }, { duplicate_lot_groups: 1 })
  assert.equal(ev.rows[0].duplicate_groups_event_lot, 1)
  await plant('a positive lot with no received date can never merge', (w) => { w.product(10, 'Product 10'); w.receive(10, SHOP, 3, { received: null }) }, { positive_lots_without_day: 1 })
  await plant('a positive lot with garbage received_at', (w) => { w.product(10, 'Product 10'); w.receive(10, SHOP, 3, { received: 'yesterday' }) }, { positive_lots_without_day: 1 })
})

// ---------------------------------------------------------------------------------------------------------------------
// 14. audit-b-lot-cost-vs-receipts
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-lot-cost-vs-receipts: a receipt row whose unit x quantity is not its total, or whose cost was lost from the lot, fires; an edited lot cost is sized only', async () => {
  const Q = 'audit-b-lot-cost-vs-receipts'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.equal(clean.lots_with_receipts > 5, true)
  assert.equal(clean.lots_cost_differs_from_all_receipts, 0)
  w0.raw.close()
  await plant('a receipt whose total is not unit x quantity', (w) => w.run("UPDATE inventory_movements SET total_cost_usd=999 WHERE id=(SELECT MIN(id) FROM inventory_movements WHERE movement_type='add' AND unit_cost_usd>0)"), { add_movements_total_mismatch: 1 })
  await plant('a lot whose cost was erased although its receipt recorded one', (w) => w.run('UPDATE product_batches SET unit_cost_usd=NULL WHERE id=?', w.named.L7), { add_movements_cost_without_lot_cost: 2 })  // lot 7 holds its receipt and the Revert's re-add
  const edit = await plant('a lot cost edited away from every receipt is info', (w) => w.run('UPDATE product_batches SET unit_cost_usd=50 WHERE id=?', w.named.L3), {})
  assert.equal(edit.rows[0].lots_cost_differs_from_all_receipts, 1)
  const none = await plant('a costed lot with no receipt movement is info', (w) => w.run("DELETE FROM inventory_movements WHERE batch_id=? AND movement_type='add'", w.named.L3), {})
  assert.equal(none.rows[0].lots_costed_without_receipts, 1)
})

// ---------------------------------------------------------------------------------------------------------------------
// 15. audit-b-lot-date-shapes
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-lot-date-shapes: an unparseable or future received date and an unreadable or too-early expiry each fire; expired stock is sized', async () => {
  const Q = 'audit-b-lot-date-shapes'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.deepEqual([clean.lots_with_expiry, clean.expired_lots_with_stock], [1, 0])
  w0.raw.close()
  await plant('a lot with no received date', (w) => w.run('UPDATE product_batches SET received_at=NULL WHERE id=?', w.named.L2), { lots_received_unparseable: 1 })
  await plant('a lot with a received date that is text', (w) => w.run("UPDATE product_batches SET received_at='yesterday' WHERE id=?", w.named.L2), { lots_received_unparseable: 1 })
  await plant('a received date in the far future', (w) => w.run("UPDATE product_batches SET received_at='2099-01-01' WHERE id=?", w.named.L2), { lots_received_in_future: 1 })
  await plant('an expiry that is not a date', (w) => w.run("UPDATE product_batches SET expiry_date='soon' WHERE id=?", w.named.L2), { lots_expiry_unparseable: 1 })
  const early = await plant('an expiry before the received day', (w) => w.run("UPDATE product_batches SET expiry_date='2026-01-01' WHERE id=?", w.named.L2), { lots_expiry_before_received: 1 })
  assert.deepEqual(JSON.parse(early.rows[0].examples).map((e) => [e[2], e[3], e[4]]), [['2026-08-05', '2026-01-01', 'expiry_before_received']])
  await plant('an ISO timestamp expiry is read by its date part', (w) => w.run("UPDATE product_batches SET expiry_date='2027-08-06T00:00:00Z' WHERE id=?", w.named.L3), {})
  const exp = await plant('expired stock is sized, not flagged', (w) => w.run("UPDATE product_batches SET expiry_date='2026-08-20' WHERE id=?", w.named.L3), {})
  assert.deepEqual([exp.rows[0].expired_lots_with_stock, exp.rows[0].expired_units_on_hand], [1, 28])
  await plant('an inactive lot is not read', (w) => w.run("UPDATE product_batches SET received_at=NULL, is_active=0 WHERE id=?", w.named.L5), {})
})

// ---------------------------------------------------------------------------------------------------------------------
// 16. audit-b-sale-allocations
// ---------------------------------------------------------------------------------------------------------------------
section('audit-b-sale-allocations: a held item that released units, a cancelled line that kept or over-released units each fire; legacy, skipped and damaged lines stay quiet', async () => {
  const Q = 'audit-b-sale-allocations'
  const plant = (label, mutate, expected) => planted(Q, label, mutate, expected, { base: activeWorld })
  const w0 = activeWorld()
  const clean = (await run(w0, Q)).rows[0]
  assert.equal(clean.items_with_allocations > 4, true)
  assert.equal(clean.cancelled_lines_with_allocations, 1)
  assert.equal(clean.examples, '[]')
  w0.raw.close()
  const S = (w) => w.named.sales
  const held = await plant('a held item whose allocation released 1 unit', (w) => w.run('UPDATE sale_item_batch_allocations SET released_quantity=1 WHERE sale_item_id=?', S(w).completed.itemIds[0]), { allocation_held_items_mismatch: 1 })
  assert.deepEqual(JSON.parse(held.rows[0].examples).map((e) => e.slice(2)), [[3, 2]])
  await plant('a held item whose allocation drew another quantity', (w) => w.run('UPDATE sale_item_batch_allocations SET quantity=9 WHERE sale_item_id=?', S(w).awaitingPayment.itemIds[0]), { allocation_held_items_mismatch: 1 })
  await plant('a cancelled sale whose allocation was never released', (w) => w.run('UPDATE sale_item_batch_allocations SET released_quantity=0 WHERE sale_item_id=?', S(w).toCancel.itemIds[0]), { allocation_cancelled_lines_mismatch: 1 })
  await plant('a held sale flipped to cancelled with its allocation still out', (w) => w.run("UPDATE sales SET sale_status='cancelled' WHERE id=?", S(w).completed.id), { allocation_cancelled_lines_mismatch: 1 })
  await plant('an item with no allocation rows at all is legacy, not a defect', (w) => w.run('DELETE FROM sale_item_batch_allocations WHERE sale_item_id=?', S(w).completed.itemIds[0]), {})
  await plant('allocations still held on a stock-skipped sale belong to the skipped-sales audit', (w) => w.run('UPDATE sale_item_batch_allocations SET released_quantity=1 WHERE sale_item_id=?', S(w).imported.itemIds[0]), {})
  await plant('a replacement sale is left to the returns audit', (w) => w.run('UPDATE sales SET source_return_id=1 WHERE id=?', S(w).completed.id), {})
  await plant('a damaged-lot line is not a branch line', (w) => { w.run('UPDATE sale_items SET damaged_lot_id=1 WHERE id=?', S(w).completed.itemIds[0]); w.run('UPDATE sale_item_batch_allocations SET released_quantity=1 WHERE sale_item_id=?', S(w).completed.itemIds[0]) }, {})
})
