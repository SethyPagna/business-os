// Actual return bulk kernel + D1 adapter + real SQLite transactions. No SQL mocks.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const cache = new Map()
const actual = new Set(['actorSnapshot','movementBranchName','db', 'permissions', 'saleRecords', 'saleRecordEvents',
  'moneyPrecision', 'saleMoneyPrecision', 'refundMoneyPrecision', 'promotionRules', 'saleItemPricing',
  'customerReturnEntitlement', 'returnBulkAction'])

function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const source = fs.readFileSync(path.join(root, 'src', rel), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = name => {
    if (name.endsWith('/cache')) return { bumpVersion: async () => {} }
    if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
    if (name.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts'
      if (actual.has(path.posix.basename(name))) return load(target)
      return {}
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

const helper = load('lib/returnBulkAction.ts')
const moneyPrecision = load('lib/moneyPrecision.ts')
const returnEntitlement = load('lib/customerReturnEntitlement.ts')
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  let batches = 0
  let failAt = null
  let beforeBatch = null
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        return {
          text,
          params,
          async first() { return sql.prepare(text).get(...params) || null },
          async all() { return { results: sql.prepare(text).all(...params) } },
          async run() { const result = sql.prepare(text).run(...params); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } } },
        }
      } }
    },
    async batch(statements) {
      batches += 1
      if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook() }
      return sql.transaction(() => statements.map(statement => {
        if (failAt && statement.text.includes(failAt)) throw new Error('injected failure')
        const result = sql.prepare(statement.text).run(...statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  } }
  return { sql, env, batches: () => batches, fail: value => { failAt = value },
    beforeBatch: value => { beforeBatch = value } }
}

function seed(f) {
  f.sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'Customer product',12),(2,'Supplier product',17);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,12),(2,1,17);
    INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(1,1,'customer-lot'),(2,2,'supplier-lot');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,7),(2,1,7);
    INSERT INTO sales(id,receipt_number,sale_status,status_before_return,updated_at) VALUES(1,'SALE-1','returned','completed','sale-v1');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id) VALUES(1,1,1,'Customer product',2,1);
    INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,supplier_settlement,branch_id,updated_at)
      VALUES(1,'RET-1',1,'customer','completed','restock','none',1,'v1'),
            (2,'RET-2',NULL,'customer','cancelled','refund','none',1,'v2'),
            (3,'SRET-3',NULL,'supplier','completed','supplier_return','refund',1,'v3');
    INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,return_to_stock,stock_action,branch_id,batch_id)
      VALUES(1,1,1,'Customer product',2,4,1,'restock',1,1),
            (2,2,1,'Customer product',1,4,0,'none',1,NULL),
            (3,3,2,'Supplier product',3,5,0,'none',1,NULL);
    INSERT INTO return_item_batch_allocations(return_item_id,batch_id,branch_id,quantity)
      VALUES(1,1,1,2),(3,2,1,3);
    UPDATE returns SET total_refund_usd=8,total_refund_khr=0 WHERE id=1;
  `)
}

function refundSnapshot(before, quantity, calculated, sold = 1, entitlement = 10, payoutCap = 10) {
  const after = Number(moneyPrecision.subtractDecimalSum(before, [-quantity]))
  return JSON.stringify({ version: 1, sale_id: 1, sale_item_id: 1, line_key: 'bulk-v1-line',
    pool_key: 'bulk-v1-pool', source_sale_revision: 0, source_pricing_snapshot_digest: 'a'.repeat(64),
    sold_quantity: sold, return_quantity: quantity, returned_quantity_before: before, returned_quantity_after: after,
    receipt_allocation: { discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, net_entitlement_usd: entitlement },
    net_entitlement_usd: entitlement,
    calculated_refund_before_usd: returnEntitlement.prorateCustomerReturnMoney4(entitlement, before, sold),
    calculated_refund_after_usd: returnEntitlement.prorateCustomerReturnMoney4(entitlement, after, sold),
    calculated_refund_usd: calculated,
    calculated_refund_khr: moneyPrecision.multiplyMoney4(calculated, 4000), exchange_rate: 4000,
    sale_product_entitlement_usd: entitlement, sale_product_payout_cap_usd: payoutCap })
}

function insertV1Return(f, { id, status, before, quantity, calculated, sold = 1,
  entitlement = 10, payoutCap = 10, total = calculated }) {
  f.sql.prepare(`INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,branch_id,updated_at,
    money_precision_version,calculated_refund_usd,rounding_adjustment_usd,total_refund_usd,total_refund_khr)
    VALUES(@id,@number,1,'customer',@status,'refund',1,@stamp,1,@calculated,@rounding,@total,@khr)`).run({
    id, number: `V1-RET-${id}`, status, stamp: `v1-${id}`, calculated,
    khr: total * 4000, total, rounding: moneyPrecision.subtractMoney4(total, calculated),
  })
  f.sql.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,total_usd,total_khr,
    applied_price_usd,applied_price_khr,stock_action,branch_id,refund_snapshot_json)
    VALUES(@id,1,1,'Customer product',@quantity,@calculated,@khr,@unit,@unitKhr,'none',1,@snapshot)`).run({
    id, quantity, calculated, khr: moneyPrecision.multiplyMoney4(calculated, 4000), unit: calculated / quantity,
    unitKhr: moneyPrecision.divideMoney4(moneyPrecision.multiplyMoney4(calculated, 4000), quantity),
    snapshot: refundSnapshot(before, quantity, calculated, sold, entitlement, payoutCap),
  })
}

function request(f, ids, field, source, target, key) {
  const rows = f.sql.prepare(`SELECT id,COALESCE(status,'completed') expected_status,
    CASE WHEN return_scope='supplier' THEN COALESCE(supplier_settlement,'refund') ELSE COALESCE(return_type,'restock') END expected_method,
    updated_at expected_updated_at FROM returns WHERE id IN (${ids.map(() => '?')}) ORDER BY id`).all(...ids)
  return { client_request_id: key, field, source, target, items: rows }
}

function snapshot(f) {
  return JSON.stringify(['returns','return_items','return_item_batch_allocations','sales','products','product_batches','branch_stock','branch_batch_stock','damaged_stock_lots','inventory_movements','undo_snapshots','action_history','return_bulk_operations','return_bulk_members','return_write_revisions','audit_logs','sale_record_events'].map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

function saleRecordEvents(f, sourceId) {
  return f.sql.prepare(`SELECT sale_id,source_kind,source_id,generation,kind,via,subject,changes_json
    FROM sale_record_events WHERE source_kind='return_bulk' AND source_id=? ORDER BY generation,id`).all(sourceId)
    .map(row => ({ ...row, changes: JSON.parse(row.changes_json) }))
}

async function replay(f, historyId, direction, generation) {
  const row = f.sql.prepare('SELECT undo_payload,redo_payload FROM action_history WHERE id=?').get(historyId)
  const payload = JSON.parse(row[direction === 'undo' ? 'undo_payload' : 'redo_payload'])
  return helper.replayReturnBulkAction(f.env, user, direction, historyId, generation, payload)
}

async function run() {
  for(const inactiveSql of ['0','NULL']) for(const scope of ['customer','supplier']) for(const restoringFirst of [true,false]) {
    const f=fixture();seed(f)
    const id=scope==='customer'?1:3, batch=scope==='customer'?1:2, quantity=scope==='customer'?2:3
    const source=(scope==='customer')===restoringFirst?'cancelled':'completed'
    const target=source==='cancelled'?'completed':'cancelled'
    f.sql.exec(`UPDATE returns SET sale_id=NULL,status='${source}' WHERE id=${id};
      UPDATE branch_batch_stock SET quantity=${restoringFirst?0:quantity} WHERE batch_id=${batch};
      UPDATE product_batches SET is_active=${restoringFirst?inactiveSql:1},received_at='2026-09-03' WHERE id=${batch};
      CREATE TRIGGER test_active_lot_insert BEFORE INSERT ON branch_batch_stock WHEN NEW.quantity>0
        AND NOT EXISTS(SELECT 1 FROM product_batches WHERE id=NEW.batch_id AND is_active=1)
        BEGIN SELECT RAISE(ABORT,'constraint failed: inactive parent'); END;
      CREATE TRIGGER test_active_lot_update BEFORE UPDATE OF quantity ON branch_batch_stock WHEN NEW.quantity>0
        AND NOT EXISTS(SELECT 1 FROM product_batches WHERE id=NEW.batch_id AND is_active=1)
        BEGIN SELECT RAISE(ABORT,'constraint failed: inactive parent'); END;`)
    const metadata=()=>{const {is_active,...row}=f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(batch);return row}
    const originalMetadata=metadata(), allocations=f.sql.prepare('SELECT * FROM return_item_batch_allocations ORDER BY id').all()
    const req=request(f,[id],'status',source,target,`archived-${scope}-${restoringFirst}`)
    const before=snapshot(f);f.fail('INSERT INTO audit_logs')
    await assert.rejects(()=>helper.applyReturnBulkAction(f.env,user,req),/injected failure/)
    assert.equal(snapshot(f),before)
    f.fail(null)
    const applied=await helper.applyReturnBulkAction(f.env,user,req)
    for(const [direction,generation,positive] of [['undo',0,!restoringFirst],['redo',1,restoringFirst]]) {
      if(positive) f.sql.prepare(`UPDATE product_batches SET is_active=${inactiveSql} WHERE id=?`).run(batch)
      const beforeReplay=snapshot(f);f.fail('INSERT INTO audit_logs')
      await assert.rejects(()=>replay(f,applied.actionHistoryId,direction,generation),/injected failure/)
      assert.equal(snapshot(f),beforeReplay,'failed replay must roll back activation, quantities, history and audit')
      f.fail(null)
      await replay(f,applied.actionHistoryId,direction,generation)
      assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=?').get(batch).quantity,positive?quantity:0)
      assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=?').get(batch).is_active,1)
      assert.deepEqual(metadata(),originalMetadata)
      assert.deepEqual(f.sql.prepare('SELECT * FROM return_item_batch_allocations ORDER BY id').all(),allocations)
    }
  }
  console.log('PASS archived and NULL-flag customer/supplier lot activation in both directions and apply/undo/redo, exact metadata/allocations, full failure rollback')
  let f = fixture(); seed(f)
  const blockedUser = { id: 2, name: 'Employee', username: 'employee', role_code: 'employee', permissions: { returns: true, 'returns:bulk': false } }
  const blockedState = snapshot(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, blockedUser, request(f, [1], 'status', 'completed', 'cancelled', 'return-blocked-001')), /Bulk Returns access is required/)
  assert.equal(snapshot(f), blockedState)
  console.log('PASS explicit returns:bulk denial blocks a full-Returns user before writes')

  f = fixture(); seed(f)
  f.sql.exec("UPDATE returns SET sale_id=NULL WHERE id=1; UPDATE sale_items SET quantity=1 WHERE id=1")
  insertV1Return(f, { id: 10, status: 'completed', before: 0, quantity: 0.6, calculated: 6 })
  insertV1Return(f, { id: 11, status: 'cancelled', before: 0.6, quantity: 0.4, calculated: 4 })
  const restoredV1 = await helper.applyReturnBulkAction(f.env, user,
    request(f, [11], 'status', 'cancelled', 'completed', 'v1-restore-001'))
  assert.equal(f.sql.prepare('SELECT status FROM returns WHERE id=11').get().status, 'completed')
  await replay(f, restoredV1.actionHistoryId, 'undo', 0)
  assert.equal(f.sql.prepare('SELECT status FROM returns WHERE id=11').get().status, 'cancelled')
  insertV1Return(f, { id: 12, status: 'completed', before: 0, quantity: 0.4, calculated: 4 })
  const beforeOverCapReplay = snapshot(f)
  await assert.rejects(() => replay(f, restoredV1.actionHistoryId, 'redo', 1), /exact refund entitlement changed/i)
  assert.equal(snapshot(f), beforeOverCapReplay, 'over-cap redo leaves returns, stock, history and generation untouched')
  console.log('PASS v1 bulk restore and replay use stored entitlement snapshots and reject a cumulative over-cap redo atomically')

  f = fixture(); seed(f)
  f.sql.exec("UPDATE returns SET sale_id=NULL WHERE id=1; UPDATE sale_items SET quantity=1 WHERE id=1")
  insertV1Return(f, { id: 10, status: 'completed', before: 0, quantity: 0.6, calculated: 6 })
  insertV1Return(f, { id: 11, status: 'cancelled', before: 0.6, quantity: 0.4, calculated: 4 })
  f.beforeBatch(() => insertV1Return(f, { id: 12, status: 'completed', before: 0, quantity: 0.4, calculated: 4 }))
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user,
    request(f, [11], 'status', 'cancelled', 'completed', 'v1-restore-race-001')), /changed|nothing/i)
  assert.equal(f.sql.prepare('SELECT status FROM returns WHERE id=11').get().status, 'cancelled')
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM return_bulk_operations WHERE request_id='v1-restore-race-001'").get().n, 0)
  console.log('PASS v1 restore freezes the complete active return graph and rejects an interposed cohort change before writes')

  f = fixture(); seed(f)
  f.sql.prepare(`UPDATE returns SET money_precision_version=1,calculated_refund_usd=8,
    rounding_adjustment_usd=0,total_refund_usd=8,total_refund_khr=32000 WHERE id=1`).run()
  const beforeMalformedCancellation = snapshot(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user,
    request(f, [1], 'status', 'completed', 'cancelled', 'malformed-v1-cancel-001')), /exact refund entitlement changed/i)
  assert.equal(snapshot(f), beforeMalformedCancellation,
    'a selected v1 return without immutable item authority cannot move stock or create history even when cancelling')
  console.log('PASS selected v1 cancellation requires its own immutable refund snapshot before stock or history writes')

  f = fixture(); seed(f)
  f.sql.exec("UPDATE returns SET sale_id=NULL WHERE id=1; UPDATE sale_items SET quantity=1 WHERE id=1; UPDATE sales SET sale_status='partial_return' WHERE id=1")
  insertV1Return(f, { id: 10, status: 'completed', before: 0, quantity: 0.5, calculated: 0.0049,
    entitlement: 0.0098, payoutCap: 0.01, total: 0 })
  insertV1Return(f, { id: 11, status: 'cancelled', before: 0.5, quantity: 0.5, calculated: 0.0049,
    entitlement: 0.0098, payoutCap: 0.01, total: 0.01 })
  const centResidual = await helper.applyReturnBulkAction(f.env, user,
    request(f, [11], 'status', 'cancelled', 'completed', 'cent-residual-restore-001'))
  assert.equal(f.sql.prepare('SELECT status FROM returns WHERE id=11').get().status, 'completed')
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'returned')
  await replay(f, centResidual.actionHistoryId, 'undo', 0)
  await replay(f, centResidual.actionHistoryId, 'redo', 1)
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'returned')
  console.log('PASS selected-member validation preserves a valid later return carrying the cohort cent residual')

  f = fixture(); seed(f)
  f.sql.exec("UPDATE returns SET sale_id=NULL WHERE id=1; UPDATE sale_items SET quantity=3 WHERE id=1; UPDATE sales SET sale_status='partial_return' WHERE id=1")
  insertV1Return(f, { id: 10, status: 'completed', before: 0, quantity: 1, calculated: 0.0033,
    sold: 3, entitlement: 0.01, payoutCap: 0.01, total: 0 })
  insertV1Return(f, { id: 11, status: 'cancelled', before: 1, quantity: 1, calculated: 0.0034,
    sold: 3, entitlement: 0.01, payoutCap: 0.01, total: 0.01 })
  const fourPlaceResidual = await helper.applyReturnBulkAction(f.env, user,
    request(f, [11], 'status', 'cancelled', 'completed', 'four-place-residual-restore-001'))
  assert.equal(f.sql.prepare('SELECT status FROM returns WHERE id=11').get().status, 'completed')
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'partial_return')
  await replay(f, fourPlaceResidual.actionHistoryId, 'undo', 0)
  await replay(f, fourPlaceResidual.actionHistoryId, 'redo', 1)
  assert.equal(f.sql.prepare('SELECT status FROM returns WHERE id=11').get().status, 'completed')
  console.log('PASS selected-member validation preserves a valid later return carrying the cohort four-place residual')

  f = fixture(); seed(f)
  f.sql.exec("UPDATE returns SET sale_id=NULL WHERE id=1; UPDATE sale_items SET quantity=1 WHERE id=1")
  insertV1Return(f, { id: 10, status: 'completed', before: 0, quantity: 1, calculated: 10 })
  f.sql.exec(`INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,branch_id,updated_at,total_refund_usd)
    VALUES(11,'LEGACY-RET-11',1,'customer','cancelled','refund',1,'legacy-11',8);
    INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,total_usd,stock_action,branch_id)
    VALUES(11,1,1,'Customer product',1,8,'none',1);`)
  const beforeLegacyRestore = snapshot(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user,
    request(f, [11], 'status', 'cancelled', 'completed', 'legacy-into-v1-001')), /exact refund entitlement changed/i)
  assert.equal(snapshot(f), beforeLegacyRestore, 'legacy restoration cannot bypass an active v1 payout cap')
  f.sql.prepare("UPDATE returns SET status='cancelled' WHERE id=10").run()
  const beforeMixedGroup = snapshot(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user,
    request(f, [10,11], 'status', 'cancelled', 'completed', 'mixed-restore-001')), /exact refund entitlement changed/i)
  assert.equal(snapshot(f), beforeMixedGroup, 'one grouped request cannot restore legacy and v1 payouts together')
  console.log('PASS legacy and mixed restoration cannot enter a v1 sale entitlement cohort or create an unreplayable history row')

  f = fixture(); seed(f)
  f.sql.exec("UPDATE returns SET sale_id=NULL WHERE id=1; UPDATE sale_items SET quantity=0.8 WHERE id=1; UPDATE sales SET sale_status='partial_return' WHERE id=1")
  insertV1Return(f, { id: 10, status: 'completed', before: 0, quantity: 0.1, calculated: 1.25, sold: 0.8 })
  insertV1Return(f, { id: 11, status: 'cancelled', before: 0.1, quantity: 0.7, calculated: 8.75, sold: 0.8 })
  const fractional = await helper.applyReturnBulkAction(f.env, user,
    request(f, [11], 'status', 'cancelled', 'completed', 'fractional-restore-001'))
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'returned')
  assert.deepEqual(saleRecordEvents(f, fractional.operationId).map(event => [event.generation, event.via,
    event.changes[0].before.value, event.changes[0].after.value]), [[0, 'apply', 'partial_return', 'returned']])
  await replay(f, fractional.actionHistoryId, 'undo', 0)
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'partial_return')
  await replay(f, fractional.actionHistoryId, 'redo', 1)
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'returned')
  assert.deepEqual(saleRecordEvents(f, fractional.operationId).map(event => [event.generation, event.via,
    event.changes[0].before.value, event.changes[0].after.value]), [
    [0, 'apply', 'partial_return', 'returned'], [1, 'undo', 'returned', 'partial_return'],
    [2, 'redo', 'partial_return', 'returned'],
  ])
  console.log('PASS exact decimal return quantities set full-return status consistently through apply, undo and redo')

  f = fixture(); seed(f)
  const method = await helper.applyReturnBulkAction(f.env, user, request(f, [1,2], 'return_type', 'refund', 'writeoff', 'return-method-001'))
  assert.deepEqual(method.changedIds, [2]); assert.deepEqual(method.unchangedIds, [1])
  assert.equal(f.sql.prepare('SELECT return_type FROM returns WHERE id=1').get().return_type, 'restock')
  assert.equal(f.sql.prepare('SELECT return_type FROM returns WHERE id=2').get().return_type, 'writeoff')
  f.sql.prepare("UPDATE returns SET notes='skipped row changed after action' WHERE id=1").run()
  await replay(f, method.actionHistoryId, 'undo', 0)
  assert.equal(f.sql.prepare('SELECT return_type FROM returns WHERE id=2').get().return_type, 'refund')
  await replay(f, method.actionHistoryId, 'redo', 1)
  assert.equal(f.sql.prepare('SELECT return_type FROM returns WHERE id=2').get().return_type, 'writeoff')
  console.log('PASS conditional method source mismatch and durable undo/redo')

  f = fixture(); seed(f)
  const mixedScope = await helper.applyReturnBulkAction(f.env, user, request(f, [1,3], 'supplier_settlement', 'refund', 'credit', 'mixed-scope-001'))
  assert.deepEqual(mixedScope.changedIds, [3]); assert.deepEqual(mixedScope.unchangedIds, [1])
  assert.equal(mixedScope.items.find(item => item.id === 1).reason, 'scope_mismatch')
  assert.equal(f.sql.prepare('SELECT return_type FROM returns WHERE id=1').get().return_type, 'restock')
  assert.equal(f.sql.prepare('SELECT supplier_settlement FROM returns WHERE id=3').get().supplier_settlement, 'credit')
  console.log('PASS mixed-scope method action skips rows from the other semantic scope')

  f = fixture(); seed(f)
  const staleRequest = request(f, [1,2], 'status', 'completed', 'cancelled', 'return-stale-001')
  f.sql.prepare("UPDATE returns SET notes='concurrent',updated_at='newer' WHERE id=2").run()
  const skippedStale = await helper.applyReturnBulkAction(f.env, user, staleRequest)
  assert.deepEqual(skippedStale.changedIds, [1]); assert.deepEqual(skippedStale.unchangedIds, [2])
  assert.equal(f.sql.prepare('SELECT notes FROM returns WHERE id=2').get().notes, 'concurrent')
  console.log('PASS stale source mismatch is skipped without blocking a matching row')

  f = fixture(); seed(f)
  const matchingStaleRequest = request(f, [1,2], 'status', 'completed', 'cancelled', 'return-matching-stale-001')
  f.sql.prepare("UPDATE returns SET notes='concurrent',updated_at='newer' WHERE id=1").run()
  const staleSnapshot = snapshot(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user, matchingStaleRequest), /entire group was rejected/)
  assert.equal(snapshot(f), staleSnapshot)
  console.log('PASS stale matching row rejects the whole group before writes')

  f = fixture(); seed(f)
  const cancelRequest = request(f, [1], 'status', 'completed', 'cancelled', 'return-cancel-001')
  const cancelled = await helper.applyReturnBulkAction(f.env, user, cancelRequest)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, 10)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1').get().quantity, 5)
  assert.equal(f.sql.prepare('SELECT total_refund_usd FROM returns WHERE id=1').get().total_refund_usd, 8)
  assert.deepEqual(saleRecordEvents(f, cancelled.operationId).map(event => ({
    sale_id: event.sale_id, generation: event.generation, kind: event.kind, via: event.via,
    subject: event.subject, changes: event.changes,
  })), [{
    sale_id: 1, generation: 0, kind: 'status_changed', via: 'apply', subject: 'RET-1',
    changes: [{ field: 'sale_status', before: { state: 'known_value', value: 'returned' }, after: { state: 'known_value', value: 'completed' } }],
  }])
  const committed = snapshot(f)
  assert.deepEqual(await helper.applyReturnBulkAction(f.env, user, cancelRequest), cancelled)
  assert.equal(snapshot(f), committed)
  const replayPayload = JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(cancelled.actionHistoryId).undo_payload)
  await assert.rejects(() => helper.replayReturnBulkAction(f.env, blockedUser, 'undo', cancelled.actionHistoryId, 0, replayPayload), /Bulk Returns access is required/)
  assert.equal(snapshot(f), committed)
  await replay(f, cancelled.actionHistoryId, 'undo', 0)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, 12)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1').get().quantity, 7)
  assert.deepEqual(saleRecordEvents(f, cancelled.operationId).map(event => [event.generation,event.via,event.changes[0].before.value,event.changes[0].after.value]), [
    [0,'apply','returned','completed'], [1,'undo','completed','returned'],
  ])
  await replay(f, cancelled.actionHistoryId, 'redo', 1)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, 10)
  assert.equal(f.sql.prepare('SELECT total_refund_usd FROM returns WHERE id=1').get().total_refund_usd, 8)
  assert.deepEqual(saleRecordEvents(f, cancelled.operationId).map(event => [event.generation,event.via,event.changes[0].before.value,event.changes[0].after.value]), [
    [0,'apply','returned','completed'], [1,'undo','completed','returned'], [2,'redo','returned','completed'],
  ])
  console.log('PASS customer cancel/uncancel exact lot and retry issues stock once')

  f = fixture(); seed(f)
  const supplierRequest = request(f, [3], 'status', 'completed', 'cancelled', 'supplier-cancel-001')
  const supplierCancelled = await helper.applyReturnBulkAction(f.env, user, supplierRequest)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=2').get().quantity, 20)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=2').get().quantity, 10)
  await replay(f, supplierCancelled.actionHistoryId, 'undo', 0)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=2').get().quantity, 17)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=2').get().quantity, 7)
  console.log('PASS supplier cancel/uncancel uses the recorded FIFO split exactly')

  f = fixture(); seed(f)
  f.sql.prepare('DELETE FROM return_item_batch_allocations WHERE return_item_id=3').run()
  const ambiguous = snapshot(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user, request(f, [3], 'status', 'completed', 'cancelled', 'supplier-legacy-001')), /predates exact lot tracking/)
  assert.equal(snapshot(f), ambiguous)
  console.log('PASS historical supplier return with ambiguous lot provenance is refused without writes')

  f = fixture(); seed(f)
  f.sql.prepare("UPDATE sales SET sale_status='cancelled' WHERE id=1").run()
  const parentCancelledState = snapshot(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user, request(f, [1], 'status', 'completed', 'cancelled', 'cancelled-parent-001')), /belongs to a cancelled sale/)
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'cancelled')
  assert.equal(snapshot(f), parentCancelledState)
  console.log('PASS cancelled parent sale blocks ambiguous return stock reconciliation')

  f = fixture(); seed(f)
  f.sql.exec(`
    INSERT INTO products(id,name,stock_quantity) VALUES(3,'Damaged product',0);
    INSERT INTO sales(id,receipt_number,sale_status,status_before_return,updated_at) VALUES(3,'SALE-3','returned','completed','sale-v3');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id) VALUES(3,3,3,'Damaged product',5,1);
    INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,branch_id,updated_at) VALUES(4,'RET-4',3,'customer','completed','refund',1,'v4');
    INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,return_to_stock,stock_action,branch_id)
      VALUES(4,4,3,'Damaged product',2,4,0,'damaged',1),(5,4,3,'Damaged product',3,6,0,'damaged',1);
    INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,return_id,quantity,quantity_remaining)
      VALUES(4,3,'Damaged product',1,4,2,2),(5,3,'Damaged product',1,4,3,3);
  `)
  const damaged = await helper.applyReturnBulkAction(f.env, user, request(f, [4], 'status', 'completed', 'cancelled', 'damaged-lines-001'))
  assert.deepEqual(f.sql.prepare('SELECT id,quantity_remaining FROM damaged_stock_lots WHERE return_id=4 ORDER BY id').all(), [{ id: 4, quantity_remaining: 0 }, { id: 5, quantity_remaining: 0 }])
  assert.equal(f.sql.prepare("SELECT COALESCE(SUM(quantity),0) quantity FROM inventory_movements WHERE reference_id=4 AND movement_type='damage_reversal'").get().quantity, -5)
  await replay(f, damaged.actionHistoryId, 'undo', 0)
  assert.deepEqual(f.sql.prepare('SELECT id,quantity_remaining FROM damaged_stock_lots WHERE return_id=4 ORDER BY id').all(), [{ id: 4, quantity_remaining: 2 }, { id: 5, quantity_remaining: 3 }])
  console.log('PASS duplicate-product damaged lines reconcile each damaged lot exactly once')

  f = fixture(); seed(f)
  f.sql.prepare("UPDATE sales SET sale_status='partial_return',status_before_return='awaiting_delivery' WHERE id=1").run()
  const awaiting = await helper.applyReturnBulkAction(f.env, user, request(f, [1], 'status', 'completed', 'cancelled', 'awaiting-parent-001'))
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'awaiting_delivery')
  await replay(f, awaiting.actionHistoryId, 'undo', 0)
  assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'returned')
  console.log('PASS final return cancellation restores the exact pre-return sale status')

  f = fixture(); seed(f)
  f.sql.prepare('UPDATE sales SET stock_skipped=1 WHERE id=1').run()
  const skipped = snapshot(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user, request(f, [1], 'status', 'completed', 'cancelled', 'skipped-parent-001')), /stock-skipped sale/)
  assert.equal(snapshot(f), skipped)
  console.log('PASS stock-skipped parent sale blocks return status stock inference')

  f = fixture(); seed(f)
  await assert.rejects(() => helper.applyReturnBulkAction(f.env, user, request(f, [1], 'return_type', 'restock', 'cash', 'invalid-method-001')), /Invalid customer return type/)
  console.log('PASS method target is constrained to the canonical scope vocabulary')
}

run().catch(error => { console.error(error); process.exit(1) })
