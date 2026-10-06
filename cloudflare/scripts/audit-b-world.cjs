// Fixture builder for the DATA-AUDIT lane B (stock & cost) queries (ops/queries/audit-b-*.sql). Not a test: the pure
// and scale tests load it. It builds a real migrated SQLite (every migration, D1's expression-depth and bind limits) and
// a small "world" whose writers mirror the production ones, so a CLEAN world makes every expect-zero audit column read 0
// and a planted inconsistency is a plain UPDATE/DELETE on top of it:
//   receive          Add stock / receive a lot   -> lot + branch_batch_stock + branch_stock + rollup + 'add' (quantity +)
//   sale             POST /sales                 -> 'sale' movement (quantity -), lot allocation, three ledgers down
//   cancel           PATCH /sales/:id/status     -> 'return' movement (+, reference = the SALE id), allocation released
//   customerReturn  POST /returns                -> 'return' (+, reference = the RETURN id, reason 'Return: ...') or
//                                                 'damage_in' (+) and a damaged_stock_lots row, return_item_batch_allocations
//   transfer         stock transfer              -> stock_transfers row + transfer_out / transfer_in (both +) in one instant
//   remove           Remove stock                -> 'remove' (+ magnitude), lot + branch + rollup down
//   revert           Revert                      -> counter movement, reference 'revert:<id>', same magnitude, opposite direction
// Movement quantities follow the writers: 'sale' / 'replacement_out' / 'return_reversal' / 'damage_reversal' are stored
// NEGATIVE, every other type as a positive magnitude (the direction is the type's, see stockLedgerQuery.ts).
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '..')
const WAREHOUSE = 1, SHOP = 2, LEGACY = 3

let schemaCache = null
/** The schema every migration leaves, as statements in creation order (virtual-table shadow tables are rebuilt by their CREATE). */
function migratedSchema() {
  if (schemaCache) return schemaCache
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  const rows = raw.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
  const virtual = rows.filter((r) => /^CREATE VIRTUAL TABLE/i.test(r.sql)).map((r) => r.name)
  const shadow = (r) => r.type === 'table' && !/^CREATE VIRTUAL TABLE/i.test(r.sql) && virtual.some((v) => /^(data|idx|content|docsize|config)$/.test(r.name.slice(v.length + 1)) && r.name.startsWith(v + '_'))
  schemaCache = rows.filter((r) => !shadow(r)).map((r) => r.sql)
  raw.close()
  return schemaCache
}

function openDb() {
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.limits.variableNumber = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const sql of migratedSchema()) raw.exec(sql)
  raw.limits.functionArg = 100
  raw.exec(`INSERT INTO branches(id,name,notes,is_active,is_default,canonical_key,role,created_at) VALUES
    (${SHOP},'Shop','front of house',1,1,'shop','shop','2026-01-01 00:00:00'),
    (${WAREHOUSE},'Warehouse','back store',1,0,'warehouse','warehouse','2026-01-01 00:00:00'),
    (${LEGACY},'Shop','legacy row retired in 2025',0,0,NULL,NULL,'2025-01-01 00:00:00')`)
  return raw
}

const OUT_TYPES = ['remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out']

class World {
  constructor(raw = openDb()) {
    this.raw = raw
    this.clock = Date.UTC(2026, 8, 1, 10, 0, 0)
    this.nextLot = 100
    this.nextSale = 1
    this.nextReturn = 1
    this.nextSaleItem = 1
    this.nextReturnItem = 1
  }

  run(sql, ...params) { return this.raw.prepare(sql).run(...params) }
  all(sql, ...params) { return this.raw.prepare(sql).all(...params).map((r) => ({ ...r })) }
  get(sql, ...params) { const r = this.raw.prepare(sql).get(...params); return r ? { ...r } : undefined }
  at() { this.clock += 10000; return new Date(this.clock).toISOString().slice(0, 19).replace('T', ' ') }

  product(id, name, { active = 1, group = 0, cost = null } = {}) {
    this.run('INSERT INTO products(id,name,sku,is_active,is_group,stock_quantity,cost_price_usd,purchase_price_usd,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?,?)',
      id, name, 'SKU' + id, active, group, cost ?? 0, cost ?? 0, '2026-08-01', '2026-08-01')
    return id
  }

  /** A lot row and nothing else (no stock, no movement). */
  lotRow(id, product, { key, received = '2026-08-01', expiry = null, cost = null, supplier = null, supplierName = null, active = 1, receivedQty = 0, receivedBranch = SHOP, receivedCost = null } = {}) {
    this.run(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,unit_cost_usd,received_cost_usd,received_quantity,received_branch_id,supplier_id,supplier_name,is_active,batch_number,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, product, key ?? 'K' + id, 'L' + id, received, expiry, cost, receivedCost, receivedQty, receivedBranch, supplier, supplierName, active, id, '2026-08-01 00:00:00', '2026-08-01 00:00:00')
    return id
  }

  movement({ product, branch, type, quantity, reason = null, reference = null, batch = null, cost = null, at = null, user = 7 }) {
    const name = this.get('SELECT name FROM products WHERE id=?', product)?.name ?? null
    const bname = this.get('SELECT name FROM branches WHERE id=?', branch)?.name ?? null
    const total = cost == null ? null : Math.round(cost * Math.abs(quantity) * 10000) / 10000
    const info = this.run(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,reference_id,user_id,user_name,created_at,batch_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, product, name, branch, bname, type, quantity, cost, total, reason, reference, user, 'operator', at || this.at(), batch)
    return Number(info.lastInsertRowid)
  }

  /** Move stock in the three ledgers (lot, branch, rollup) without writing a movement. */
  bump({ product, branch, lot = null, delta }) {
    if (lot != null) {
      const row = this.get('SELECT id FROM branch_batch_stock WHERE batch_id=? AND branch_id=?', lot, branch)
      if (row) this.run('UPDATE branch_batch_stock SET quantity=quantity+? WHERE batch_id=? AND branch_id=?', delta, lot, branch)
      else this.run('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)', lot, branch, delta)
    }
    const bs = this.get('SELECT id FROM branch_stock WHERE product_id=? AND branch_id=?', product, branch)
    if (bs) this.run('UPDATE branch_stock SET quantity=quantity+? WHERE product_id=? AND branch_id=?', delta, product, branch)
    else this.run('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)', product, branch, delta)
    this.run('UPDATE products SET stock_quantity=COALESCE(stock_quantity,0)+? WHERE id=?', delta, product)
  }

  /** Add stock onto a (new or existing) lot: one 'add' movement. Returns { lot, movement }. */
  receive(product, branch, quantity, { lot, received = '2026-08-01', expiry = null, cost = null, supplier = null, supplierName = null, free = 0 } = {}) {
    let lotId = lot
    if (lotId == null) {
      lotId = this.nextLot++
      this.lotRow(lotId, product, { received, expiry, cost, supplier, supplierName, receivedQty: quantity, receivedBranch: branch, receivedCost: cost == null ? null : Math.round(cost * quantity * 10000) / 10000 })
    } else {
      this.run('UPDATE product_batches SET received_quantity=COALESCE(received_quantity,0)+?1, received_cost_usd=CASE WHEN unit_cost_usd IS NULL THEN received_cost_usd ELSE ROUND(COALESCE(received_cost_usd,0)+unit_cost_usd*?1,4) END WHERE id=?2', quantity, lotId)
    }
    this.bump({ product, branch, lot: lotId, delta: quantity })
    const movement = this.movement({ product, branch, type: 'add', quantity, reason: 'Stock in', batch: lotId, cost: cost ?? this.get('SELECT unit_cost_usd c FROM product_batches WHERE id=?', lotId).c })
    return { lot: lotId, movement }
  }

  remove(product, branch, quantity, { lot = null, reason = 'Removed' } = {}) {
    this.bump({ product, branch, lot, delta: -quantity })
    return this.movement({ product, branch, type: 'remove', quantity, reason, batch: lot })
  }

  /** A sale. lines: [{ product, branch, qty, lot }]. status decides whether stock is held; skipped = stock_skipped. */
  sale(status, lines, { id = this.nextSale++, key = null, skipped = 0, at = null, replacementOf = null } = {}) {
    const created = at || this.at()
    this.run(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,sale_status,client_request_id,stock_skipped,total_usd,subtotal_usd,created_at,updated_at,source_return_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, 'R' + id, lines[0]?.branch ?? SHOP, 'Shop', status, key, skipped, lines.reduce((s, l) => s + l.qty * 5, 0), lines.reduce((s, l) => s + l.qty * 5, 0), created, created, replacementOf)
    const held = ['completed', 'awaiting_payment', 'awaiting_delivery'].includes(status) && !skipped
    const itemIds = []
    for (const line of lines) {
      const itemId = this.nextSaleItem++
      itemIds.push(itemId)
      this.run('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,applied_price_usd,total_usd,branch_id,batch_id,returned_quantity) VALUES(?,?,?,?,?,?,?,?,?,0)',
        itemId, id, line.product, 'P' + line.product, line.qty, 5, line.qty * 5, line.branch, line.lot ?? null)
      if (line.lot != null) {
        this.run('INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity,released_at) VALUES(?,?,?,?,?,?)',
          itemId, line.lot, line.branch, line.qty, held ? 0 : line.qty, held ? null : created)
      }
      if (held) {
        this.bump({ product: line.product, branch: line.branch, lot: line.lot, delta: -line.qty })
        this.movement({ product: line.product, branch: line.branch, type: 'sale', quantity: -line.qty, reference: id, batch: line.lot, at: created })
      }
    }
    return { id, itemIds }
  }

  /** Cancel a held sale: stock back through 'return' movements that reference the sale. */
  cancel(sale, lines) {
    this.run("UPDATE sales SET sale_status='cancelled', status_before_cancel='completed', cancelled_at=? WHERE id=?", this.at(), sale.id)
    lines.forEach((line, i) => {
      this.bump({ product: line.product, branch: line.branch, lot: line.lot, delta: line.qty })
      this.movement({ product: line.product, branch: line.branch, type: 'return', quantity: line.qty, reason: 'Sale cancelled (mistake)', reference: sale.id, batch: line.lot })
      if (line.lot != null) this.run("UPDATE sale_item_batch_allocations SET released_quantity=quantity, released_at=datetime('now') WHERE sale_item_id=?", sale.itemIds[i])
    })
  }

  /** A customer return. items: [{ saleItem, product, branch, qty, action: 'restock'|'damaged'|'none', lot }]. */
  customerReturn(sale, items, { id = this.nextReturn++, status = 'completed', saleStatus = 'partial_return' } = {}) {
    this.run("INSERT INTO returns(id,return_number,sale_id,branch_id,branch_name,return_scope,status,reason,created_at) VALUES(?,?,?,?,?,'customer',?,?,?)",
      id, 'RT' + id, sale.id, items[0].branch, 'Shop', status, 'changed mind', this.at())
    for (const item of items) {
      const itemId = this.nextReturnItem++
      this.run('INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,total_usd,return_to_stock,stock_action,branch_id,batch_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        itemId, id, item.saleItem, item.product, 'P' + item.product, item.qty, item.qty * 5, item.action === 'restock' ? 1 : 0, item.action, item.branch, item.lot ?? null)
      if (item.action === 'restock') {
        if (item.lot != null) this.run('INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity) VALUES(?,?,?,?,?)', itemId, item.saleItem, item.lot, item.branch, item.qty)
        this.bump({ product: item.product, branch: item.branch, lot: item.lot, delta: item.qty })
        this.movement({ product: item.product, branch: item.branch, type: 'return', quantity: item.qty, reason: 'Return: changed mind', reference: id, batch: item.lot })
      } else if (item.action === 'damaged') {
        this.run('INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,return_id,quantity,quantity_remaining,reason,condition_tag,source) VALUES(?,?,?,?,?,?,?,?,?)',
          item.product, item.branch, item.lot ?? null, id, item.qty, item.qty, 'damaged', 'damaged', 'return')
        this.movement({ product: item.product, branch: item.branch, type: 'damage_in', quantity: item.qty, reason: 'Return: changed mind', reference: id, batch: item.lot })
      }
      if (status !== 'cancelled') this.run('UPDATE sale_items SET returned_quantity=returned_quantity+? WHERE id=?', item.qty, item.saleItem)
    }
    this.run('UPDATE sales SET sale_status=?, status_before_return=COALESCE(status_before_return,?) WHERE id=?', saleStatus, 'completed', sale.id)
    return id
  }

  /** A transfer between branches of one product: stock_transfers row + the two movement legs in one instant. */
  transfer(product, from, to, quantity, { lot = null, toLot = lot } = {}) {
    const at = this.at()
    this.run('INSERT INTO stock_transfers(product_id,product_name,from_branch_id,to_branch_id,quantity,notes,user_id,user_name,created_at,client_request_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
      product, 'P' + product, from, to, quantity, 'restock shop', 7, 'operator', at, 'xfer-' + at)
    this.bump({ product, branch: from, lot, delta: -quantity })
    this.bump({ product, branch: to, lot: toLot, delta: quantity })
    const out = this.movement({ product, branch: from, type: 'transfer_out', quantity, reason: 'restock shop', batch: lot, at })
    const inn = this.movement({ product, branch: to, type: 'transfer_in', quantity, reason: 'restock shop', batch: toLot, at })
    return { out, in: inn }
  }

  /**
   * An operation-based transfer (migration 0148 provenance): receipt + member + action_history + stock_transfers generation 0
   * and the two legs; undone = the Undo generation too (legs swapped, generation 1, history redoable).
   */
  operationTransfer(product, from, to, quantity, { lot = null, undone = false, destProduct = product, destLot = lot } = {}) {
    this.nextOp = (this.nextOp || 0) + 1
    const op = 'op-' + this.nextOp
    const payload = (generation) => JSON.stringify({ applier: 'stock.transfer', operation_id: op, generation, permission: 'inventory' })
    const history = Number(this.run("INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name) VALUES('global','stock_transfer',?,?,1,'undoable',?,?,7,'operator')", op, '1 stock transfer', payload(0), payload(0)).lastInsertRowid)
    const receipt = Number(this.run(`INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,response_json,status,operation_id,provenance_version,action_history_id,replay_state,generation)
      VALUES(7,?,?,?,?,'pending',?,1,?,'applied',0)`, op, 'digest', '{}', '{}', op, history).lastInsertRowid)
    const allocations = lot == null ? [] : [{ source_batch_id: lot, destination_batch_id: destLot, quantity }]
    this.run(`INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)
      VALUES(?,0,?,?,?,?,?,?,'{}','{}',?)`, receipt, product, destProduct, from, to, quantity, lot == null ? quantity : 0, JSON.stringify(allocations))
    this.run("UPDATE transfer_operation_receipts SET status='committed' WHERE id=?", receipt)
    const apply = (a, b, gen, aProduct, bProduct, aLot, bLot) => {
      const at = this.at()
      this.run('INSERT INTO stock_transfers(product_id,product_name,from_branch_id,to_branch_id,quantity,notes,user_id,user_name,created_at,client_request_id,receipt_id,member_ordinal,generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?)',
        aProduct, 'P' + aProduct, a, b, quantity, 'op transfer', 7, 'operator', at, op, receipt, gen)
      this.bump({ product: aProduct, branch: a, lot: aLot, delta: -quantity })
      this.bump({ product: bProduct, branch: b, lot: bLot, delta: quantity })
      this.movement({ product: aProduct, branch: a, type: 'transfer_out', quantity, reason: 'op transfer', batch: aLot, at })
      this.movement({ product: bProduct, branch: b, type: 'transfer_in', quantity, reason: 'op transfer', batch: bLot, at })
    }
    apply(from, to, 0, product, destProduct, lot, destLot)
    if (undone) {
      apply(to, from, 1, destProduct, product, destLot, lot)
      this.run("UPDATE transfer_operation_receipts SET generation=1, replay_state='reversed' WHERE id=?", receipt)
      this.run("UPDATE action_history SET status='redoable', undo_payload=?, redo_payload=? WHERE id=?", payload(1), payload(1), history)
    }
    return { receipt, history, op }
  }

  /**
   * A scoped lot-level Set (lib/stockLotAdjustment.ts): operation row + history + forward movement 'stock-set:<op>:0' (+ Undo counter and Redo forward).
   * undone: apply the Undo generation too (generation 1, 'reversed'); redone: and the Redo (generation 2, 'applied').
   */
  scopedSet(product, branch, lot, target, { undone = false, redone = false } = {}) {
    this.nextSet = (this.nextSet || 0) + 1
    const op = 'set-' + this.nextSet
    const lotQ = () => this.get('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=?', lot, branch).q
    const branchQ = () => this.get('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=?', product, branch).q
    const before = { productId: product, branchId: branch, batchId: lot, lotQuantity: lotQ(), branchQuantity: branchQ(), lotExists: 1, branchExists: 1 }
    const delta = target - before.lotQuantity
    const after = { ...before, lotQuantity: target, branchQuantity: Math.max(0, before.branchQuantity + delta) }
    const payload = (generation) => JSON.stringify({ applier: 'stock.quantity_set', operation_id: op, generation })
    const history = Number(this.run("INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name) VALUES('inventory','stock_quantity_set',?,?,1,'undoable',?,?,7,'operator')", String(product), 'Set', payload(0), payload(0)).lastInsertRowid)
    this.run(`INSERT INTO stock_lot_adjustment_operations(id,actor_id,request_id,request_json,request_digest,response_json,before_json,after_json,revision_json,history_id)
      VALUES(?,7,?,?,?,'{}',?,?,'{}',?)`, op, op, JSON.stringify({ productId: product, branchId: branch, batchId: lot, quantity: target, setScope: 'lot', reason: 'count' }), 'digest', JSON.stringify(before), JSON.stringify(after), history)
    const apply = (state) => {
      this.run('UPDATE branch_batch_stock SET quantity=? WHERE batch_id=? AND branch_id=?', state.lotQuantity, lot, branch)
      const bdelta = state.branchQuantity - branchQ()
      this.run('UPDATE branch_stock SET quantity=? WHERE product_id=? AND branch_id=?', state.branchQuantity, product, branch)
      this.run('UPDATE products SET stock_quantity=COALESCE(stock_quantity,0)+? WHERE id=?', bdelta, product)
    }
    apply(after)
    const forward = (gen) => this.movement({ product, branch, type: delta > 0 ? 'adjustment' : 'remove', quantity: Math.abs(delta), reason: 'count (Set received date to ' + target + ')', reference: 'stock-set:' + op + ':' + gen, batch: lot })
    const f0 = forward(0)
    let generation = 0
    const mark = (state, status) => {
      this.run('UPDATE stock_lot_adjustment_operations SET generation=?, state=? WHERE id=?', generation, state, op)
      this.run('UPDATE action_history SET status=?, undo_payload=?, redo_payload=? WHERE id=?', status, payload(generation), payload(generation), history)
    }
    const out = { op, history, forward: [f0], counter: [] }
    if (undone || redone) {
      apply(before)
      out.counter.push(this.movement({ product, branch, type: delta > 0 ? 'remove' : 'adjustment', quantity: Math.abs(delta), reason: 'Undo: count', reference: 'revert:' + f0, batch: lot }))
      generation = 1
      mark('reversed', 'redoable')
    }
    if (redone) {
      apply(after)
      out.forward.push(forward(2))
      generation = 2
      mark('applied', 'undoable')
    }
    return out
  }

  /**
   * A stock-in session with one received line (stock_session_operations + undo_snapshots + history + member + receipt movement).
   * undone: the Undo generation too (a negative 'remove' movement per member, snapshot reversed, history redoable).
   */
  stockSession(product, branch, quantity, { received = '2026-08-15', cost = 2.5, undone = false } = {}) {
    this.nextSession = (this.nextSession || 0) + 1
    const op = 'ses-' + this.nextSession
    const snapshot = Number(this.run("INSERT INTO undo_snapshots(kind,status,payload_json) VALUES('stock.session','applied',?)", JSON.stringify({ products: [product], lots: [] })).lastInsertRowid)
    const payload = (generation) => JSON.stringify({ applier: 'stock.session', snapshot_id: snapshot, operation_id: op, generation })
    const history = Number(this.run("INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name) VALUES('global','stock_session',?,?,1,'undoable',?,?,7,'operator')", op, '1 stock-in line', payload(0), payload(0)).lastInsertRowid)
    this.run("INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json,snapshot_id,history_id) VALUES(?,7,?,'stock_in','{}',?,?)", op, op, snapshot, history)
    const rowid = this.get('SELECT rowid AS r FROM stock_session_operations WHERE id=?', op).r
    const { lot, movement } = this.receive(product, branch, quantity, { received, cost })
    this.run('UPDATE inventory_movements SET reference_id=?, reason=? WHERE id=?', rowid, 'Stock-in session ' + op, movement)
    this.run("INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,product_created,branch_id,batch_id,movement_id,quantity,unit_cost_usd) VALUES(?,'l1','receive',?,0,?,?,?,?,?)", op, product, branch, lot, movement, quantity, cost)
    const out = { op, rowid, snapshot, history, lot, movement, undo: null }
    if (undone) {
      this.bump({ product, branch, lot, delta: -quantity })
      this.unreceive(lot, quantity)
      out.undo = this.movement({ product, branch, type: 'remove', quantity: -quantity, reason: 'Stock session ' + op + ' undo generation 1', reference: rowid, batch: lot })
      this.run('UPDATE stock_session_operations SET generation=1 WHERE id=?', op)
      this.run("UPDATE undo_snapshots SET status='reversed' WHERE id=?", snapshot)
      this.run("UPDATE action_history SET status='redoable', undo_payload=?, redo_payload=? WHERE id=?", payload(1), payload(1), history)
    }
    return out
  }

  /** planUnreceiveBatchStock: the lot loses the receipt's units and money. */
  unreceive(lot, quantity) {
    this.run('UPDATE product_batches SET received_quantity=received_quantity-?1, received_cost_usd=CASE WHEN unit_cost_usd IS NULL OR received_cost_usd IS NULL THEN received_cost_usd ELSE ROUND(received_cost_usd-unit_cost_usd*?1,4) END WHERE id=?2', quantity, lot)
  }

  /** Revert a plain stock movement: counter movement with the same magnitude, opposite direction. */
  revert(movementId) {
    const m = this.get('SELECT * FROM inventory_movements WHERE id=?', movementId)
    const magnitude = Math.abs(m.quantity)
    const outward = OUT_TYPES.includes(m.movement_type)
    this.bump({ product: m.product_id, branch: m.branch_id, lot: m.batch_id, delta: outward ? magnitude : -magnitude })
    if (m.movement_type === 'add' && m.batch_id != null) this.unreceive(m.batch_id, magnitude)
    return this.movement({ product: m.product_id, branch: m.branch_id, type: outward ? 'add' : 'remove', quantity: magnitude, reason: 'Revert of #' + movementId, reference: 'revert:' + movementId, batch: m.batch_id })
  }

  costEntry(product, cost, baselineBatchId) {
    this.run("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,?,'manual',?)", product, cost, baselineBatchId)
  }
}

/**
 * The clean control: every ledger agrees, every history row is complete. Products 1..8; the shapes are chosen so each
 * audit query has something to chew on (sales in every status, a return of each stock action, a transfer, a Revert,
 * costed / uncosted / manual-cost products, a product with no lot, a removed (inactive) product with no stock).
 */
function cleanWorld() {
  const w = new World()
  w.run("INSERT INTO suppliers(id,name) VALUES(1,'Acme')")
  for (let id = 1; id <= 8; id++) w.product(id, 'Product ' + id)
  // 1: two lots at different dates at the Shop, stock also at the Warehouse; costs differ (weighted catalog cost)
  w.receive(1, SHOP, 10, { received: '2026-08-01', cost: 2 })
  w.receive(1, SHOP, 5, { received: '2026-08-10', cost: 4 })
  w.receive(1, WAREHOUSE, 20, { received: '2026-08-01', cost: 2, lot: 100 })
  // 2: one costed lot, sells through every status
  w.receive(2, SHOP, 40, { received: '2026-08-05', cost: 3, supplier: 1, supplierName: 'Acme' })
  // 3: a lot with an expiry and a supplier, a transfer Warehouse -> Shop
  w.receive(3, WAREHOUSE, 30, { received: '2026-08-06', expiry: '2027-08-06', cost: 1.5 })
  // 4: manual cost entry after the first lot, a later lot above the baseline
  w.receive(4, SHOP, 6, { received: '2026-08-02', cost: 7 })
  w.receive(4, SHOP, 4, { received: '2026-08-20', cost: 9 })
  // 5: sold out (nothing on hand): the newest lot's cost stands in
  w.receive(5, SHOP, 3, { received: '2026-08-03', cost: 6 })
  // 6: free / unknown cost lots (cost 0 and NULL are "not recorded")
  w.receive(6, SHOP, 2, { received: '2026-08-04', cost: 0 })
  w.receive(6, SHOP, 2, { received: '2026-08-12', cost: null })
  // 7: a revert pair on an add
  w.receive(7, SHOP, 9, { received: '2026-08-07', cost: 5 })
  // 8: a removed (inactive) product: no stock anywhere
  w.run('UPDATE products SET is_active=0 WHERE id=8')
  return w
}

/**
 * cleanWorld plus history: sales in every status (incl. a cancelled one and an imported stock-skipped one), a return of
 * each stock action, a transfer, a removal, a Revert, a manual cost entry. Still CLEAN: every ledger agrees, every
 * movement is explained. Returns the world with the named ids the sections plant against.
 */
function activeWorld() {
  const w = cleanWorld()
  w.product(9, 'Product 9')
  const lot = (product) => w.get('SELECT MIN(id) AS id FROM product_batches WHERE variant_product_id=?', product).id
  const L2 = lot(2), L3 = lot(3), L5 = lot(5), L7 = lot(7)
  w.named = { L1: lot(1), L2, L3, L5, L7 }
  w.named.sales = {
    completed: w.sale('completed', [{ product: 2, branch: SHOP, qty: 3, lot: L2 }]),
    awaitingPayment: w.sale('awaiting_payment', [{ product: 2, branch: SHOP, qty: 2, lot: L2 }]),
    awaitingDelivery: w.sale('awaiting_delivery', [{ product: 2, branch: SHOP, qty: 1, lot: L2 }]),
    toCancel: w.sale('completed', [{ product: 2, branch: SHOP, qty: 4, lot: L2 }]),
    soldOut: w.sale('completed', [{ product: 5, branch: SHOP, qty: 3, lot: L5 }]),
    returned: w.sale('completed', [{ product: 2, branch: SHOP, qty: 5, lot: L2 }]),
    imported: w.sale('completed', [{ product: 2, branch: SHOP, qty: 2, lot: L2 }], { key: 'sales-import:7:1', skipped: 1 }),
  }
  w.cancel(w.named.sales.toCancel, [{ product: 2, branch: SHOP, qty: 4, lot: L2 }])
  const r = w.named.sales.returned
  w.named.returns = {
    restock: w.customerReturn(r, [{ saleItem: r.itemIds[0], product: 2, branch: SHOP, qty: 1, action: 'restock', lot: L2 }]),
    damaged: w.customerReturn(r, [{ saleItem: r.itemIds[0], product: 2, branch: SHOP, qty: 1, action: 'damaged', lot: L2 }]),
    none: w.customerReturn(r, [{ saleItem: r.itemIds[0], product: 2, branch: SHOP, qty: 1, action: 'none', lot: L2 }]),
  }
  // a return that records nothing for the returned unit (action none) and hands out a replacement of product 6 from its first lot
  const L6 = lot(6)
  w.named.L6 = L6
  w.named.returns.replace = w.customerReturn(r, [{ saleItem: r.itemIds[0], product: 2, branch: SHOP, qty: 1, action: 'none', lot: L2 }])
  w.run("INSERT INTO return_replacement_items(return_id,product_id,product_name,branch_id,batch_id,quantity,applied_price_usd,total_usd) VALUES(?,?,?,?,?,?,?,?)", w.named.returns.replace, 6, 'P6', SHOP, L6, 1, 5, 5)
  w.bump({ product: 6, branch: SHOP, lot: L6, delta: -1 })
  w.named.replacementOut = w.movement({ product: 6, branch: SHOP, type: 'replacement_out', quantity: -1, reason: 'Replacement for return #RT4', reference: w.named.returns.replace, batch: L6 })
  w.named.transfer = w.transfer(1, WAREHOUSE, SHOP, 5, { lot: w.named.L1 })
  w.named.removed = w.remove(3, WAREHOUSE, 2, { lot: L3 })
  w.named.opTransfer = w.operationTransfer(1, WAREHOUSE, SHOP, 3, { lot: w.named.L1 })
  w.named.undoneTransfer = w.operationTransfer(3, WAREHOUSE, SHOP, 2, { lot: L3, undone: true })
  w.named.added = w.receive(7, SHOP, 4, { lot: L7 }).movement
  w.named.revert = w.revert(w.named.added)
  // a manual cost entry on product 4 after its first lot: the first lot's units count at 8, the later lot at its own 9. The entry itself fires no
  // trigger (the route recomputes); the scoped Sets below change lot stock, which fires the 0195 trigger and re-derives the figure.
  const first4 = lot(4)
  w.costEntry(4, 8, first4)
  const lots4 = w.all('SELECT id FROM product_batches WHERE variant_product_id=4 ORDER BY id').map((r) => r.id)
  w.named.sets = {
    down: w.scopedSet(4, SHOP, lots4[0], 5),
    undone: w.scopedSet(4, SHOP, lots4[1], 6, { undone: true }),
    redone: w.scopedSet(6, SHOP, L6, 0, { redone: true }),
  }
  w.named.sessions = {
    live: w.stockSession(9, SHOP, 6),
    undone: w.stockSession(9, SHOP, 2, { received: '2026-08-16', undone: true }),
  }
  return w
}

module.exports = { World, openDb, cleanWorld, activeWorld, SHOP, WAREHOUSE, LEGACY, OUT_TYPES }
