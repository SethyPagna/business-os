// Actual return bulk kernel + D1 adapter + real SQLite transactions. No SQL mocks.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const cache = new Map()
const actual = new Set(['actorSnapshot','movementBranchName','db', 'permissions', 'returnBulkAction'])

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
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  let batches = 0
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
      return sql.transaction(() => statements.map(statement => {
        const result = sql.prepare(statement.text).run(...statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  } }
  return { sql, env, batches: () => batches }
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

function request(f, ids, field, source, target, key) {
  const rows = f.sql.prepare(`SELECT id,COALESCE(status,'completed') expected_status,
    CASE WHEN return_scope='supplier' THEN COALESCE(supplier_settlement,'refund') ELSE COALESCE(return_type,'restock') END expected_method,
    updated_at expected_updated_at FROM returns WHERE id IN (${ids.map(() => '?')}) ORDER BY id`).all(...ids)
  return { client_request_id: key, field, source, target, items: rows }
}

function snapshot(f) {
  return JSON.stringify(['returns','products','branch_stock','branch_batch_stock','damaged_stock_lots','inventory_movements','undo_snapshots','action_history','return_bulk_operations','return_bulk_members','return_write_revisions','audit_logs'].map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

async function replay(f, historyId, direction, generation) {
  const row = f.sql.prepare('SELECT undo_payload,redo_payload FROM action_history WHERE id=?').get(historyId)
  const payload = JSON.parse(row[direction === 'undo' ? 'undo_payload' : 'redo_payload'])
  return helper.replayReturnBulkAction(f.env, user, direction, historyId, generation, payload)
}

async function run() {
  let f = fixture(); seed(f)
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
  const committed = snapshot(f)
  assert.deepEqual(await helper.applyReturnBulkAction(f.env, user, cancelRequest), cancelled)
  assert.equal(snapshot(f), committed)
  await replay(f, cancelled.actionHistoryId, 'undo', 0)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, 12)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1').get().quantity, 7)
  await replay(f, cancelled.actionHistoryId, 'redo', 1)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, 10)
  assert.equal(f.sql.prepare('SELECT total_refund_usd FROM returns WHERE id=1').get().total_refund_usd, 8)
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
