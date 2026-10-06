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
  await plant('lot allocation that released 1 unit of a held sale', (w) => w.run('UPDATE sale_item_batch_allocations SET released_quantity=1 WHERE sale_item_id=?', S(w).completed.itemIds[0]), { allocation_outstanding_mismatch: 1 })
  await plant('status flipped to cancelled with no restock (movement AND allocation still say out)', (w) => w.run("UPDATE sales SET sale_status='cancelled' WHERE id=?", S(w).completed.id), { cancelled_still_out: 1, allocation_outstanding_mismatch: 1 })
  await plant('sale line deleted but its units never given back', (w) => w.run('DELETE FROM sale_items WHERE id=?', S(w).completed.itemIds[0]), { deducted_over_deducted: 1 })
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
  await plant('cancel after a 2-unit return that restores all 5 phantoms 2 units', cancelAfterReturn(5), { cancelled_over_restored: 1, allocation_outstanding_mismatch: 1 })
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
