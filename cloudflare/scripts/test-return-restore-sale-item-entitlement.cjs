const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

// Real restore/replay kernels and migrated SQLite transactions; only external
// notifications are replaced. The sale still has B after A is removed.
const root = path.join(__dirname, '..')
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }
  cache.set(rel, mod)
  const source = fs.readFileSync(path.join(root, 'src', rel), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const req = name => {
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {} }
    if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
    if (name.startsWith('.')) {
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts')
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}
const kernel = load('lib/returnBulkAction.ts')
const admin = { id: 1, username: 'admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const employee = { id: 2, username: 'employee', role_code: 'employee',
  permissions: JSON.stringify({ returns: true, 'returns:bulk': true }) }
const denied = { ...employee, permissions: JSON.stringify({ returns: true, 'returns:bulk': false }) }
const tables = ['returns', 'return_items', 'return_item_batch_allocations', 'sales', 'sale_items',
  'products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'damaged_stock_lots',
  'inventory_movements', 'undo_snapshots', 'action_history', 'return_bulk_operations', 'return_bulk_members',
  'return_bulk_guards', 'return_write_revisions', 'sale_write_revisions', 'audit_logs', 'sale_record_events']

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  let batches = 0
  let beforeBatch = null
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        return { text, params,
          async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
          async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
          async run() {
            const result = sqliteD1Call(sql.prepare(text), 'run', params)
            return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
          },
        }
      } }
    },
    async batch(statements) {
      batches++
      if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook() }
      return sql.transaction(() => statements.map(statement => {
        const result = sqliteD1Call(sql.prepare(statement.text), 'run', statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  } }
  sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',11),(2,'B',10);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,11),(2,1,10);
    INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(1,1,'lot-A'),(2,2,'lot-B');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,11),(2,1,10);
    INSERT INTO sales(id,receipt_number,sale_status,status_before_return,money_precision_version,
      calculated_total_usd,rounding_adjustment_usd,total_usd,updated_at)
      VALUES(1,'SALE-AB','partial_return','completed',1,30,0,30,'sale-AB');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd)
      VALUES(101,1,1,'A',1,1,10,10),(102,1,2,'B',1,1,20,20);
  `)
  insertReturn(sql, 10, 101, 1, 'completed')
  return { sql, env, batches: () => batches, beforeBatch: hook => { beforeBatch = hook } }
}

function insertReturn(sql, id, saleItemId, productId, status) {
  const amount = productId === 1 ? 10 : 20
  const snapshot = JSON.stringify({ version: 1, sale_id: 1, sale_item_id: saleItemId,
    line_key: `line-${saleItemId}`, pool_key: 'sale-AB-pool', source_sale_revision: 0,
    source_pricing_snapshot_digest: 'a'.repeat(64), sold_quantity: 1, return_quantity: 1,
    returned_quantity_before: 0, returned_quantity_after: 1,
    receipt_allocation: { discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, net_entitlement_usd: amount },
    net_entitlement_usd: amount, calculated_refund_before_usd: 0, calculated_refund_after_usd: amount,
    calculated_refund_usd: amount, calculated_refund_khr: amount * 4000, exchange_rate: 4000,
    sale_product_entitlement_usd: 30, sale_product_payout_cap_usd: 30 })
  sql.prepare(`INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,branch_id,updated_at,
    money_precision_version,calculated_refund_usd,rounding_adjustment_usd,total_refund_usd,total_refund_khr)
    VALUES(?,?,1,'customer',?,'refund',1,?,1,?,0,?,?)`)
    .run(id, `RET-${id}`, status, `return-${id}`, amount, amount, amount * 4000)
  sql.prepare(`INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,total_usd,
    total_khr,applied_price_usd,applied_price_khr,stock_action,return_to_stock,branch_id,batch_id,refund_snapshot_json)
    VALUES(?,?,?,?,?,1,?,?,?,?,'restock',1,1,?,?)`)
    .run(id, id, saleItemId, productId, productId === 1 ? 'A' : 'B', amount, amount * 4000,
      amount, amount * 4000, productId, snapshot)
  sql.prepare('INSERT INTO return_item_batch_allocations(return_item_id,batch_id,branch_id,quantity) VALUES(?,?,1,1)')
    .run(id, productId)
}

function request(f, ids, source, target, key) {
  const items = f.sql.prepare(`SELECT id,status AS expected_status,return_type AS expected_method,
    updated_at AS expected_updated_at FROM returns WHERE id IN (${ids.map(() => '?')}) ORDER BY id`).all(...ids)
  return { client_request_id: key, field: 'status', source, target, items }
}
const state = f => JSON.stringify(tables.map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const stock = (f, id = 1) => f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1').get(id).quantity
const refund = f => f.sql.prepare(`SELECT COALESCE(SUM(total_refund_usd),0) AS amount FROM returns
  WHERE sale_id=1 AND status<>'cancelled'`).get().amount
async function cancelA(f) {
  const outcome = await kernel.applyReturnBulkActionOutcome(f.env, admin, request(f, [10], 'completed', 'cancelled', 'cancel-return-A'))
  assert.equal(outcome.wrote, true)
  assert.equal(stock(f), 10)
  assert.equal(refund(f), 0)
  return outcome.receipt
}
async function replay(f, receipt, direction, generation, user = admin) {
  const row = f.sql.prepare('SELECT undo_payload,redo_payload FROM action_history WHERE id=?').get(receipt.actionHistoryId)
  return kernel.replayReturnBulkAction(f.env, user, direction, receipt.actionHistoryId, generation,
    JSON.parse(row[direction === 'undo' ? 'undo_payload' : 'redo_payload']))
}
async function refused(f, action, label) {
  const before = state(f)
  const batches = f.batches()
  await assert.rejects(action, error => error instanceof kernel.ReturnBulkError && error.statusCode === 409
    && /exact refund entitlement changed/i.test(error.message), label)
  assert.equal(state(f), before, `${label}: stock, refunds, statuses, receipts, history, generations and audit unchanged`)
  assert.equal(f.batches(), batches, `${label}: refused before attempting a write batch`)
}

const cases = [
  ['missing-line', async f => {
    await cancelA(f)
    f.sql.prepare('DELETE FROM sale_items WHERE id=101').run()
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=1').get().n, 1)
    const req = request(f, [10], 'cancelled', 'completed', 'restore-missing-A')
    await refused(f, () => kernel.applyReturnBulkActionOutcome(f.env, admin, req), 'removed A with B remaining')
    await refused(f, () => kernel.applyReturnBulkActionOutcome(f.env, admin, req), 'same refused request retry')
    await refused(f, () => kernel.applyReturnBulkActionOutcome(f.env, admin, { ...req, client_request_id: 'restore-missing-fresh' }), 'fresh refused request retry')
  }],
  ['replacement-line', async f => {
    await cancelA(f)
    f.sql.exec("DELETE FROM sale_items WHERE id=101; INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id) VALUES(103,1,1,'A replacement',1,1)")
    await refused(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-replacement-A')), 'same product on new sale_item_id')
  }],
  ['sale-product-mismatch', async f => {
    await cancelA(f)
    f.sql.prepare("UPDATE sale_items SET product_id=2,product_name='B replacement' WHERE id=101").run()
    await refused(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-wrong-product')), 'same sale_item_id now belongs to another product')
  }],
  ['return-product-mismatch', async f => {
    await cancelA(f)
    f.sql.prepare('UPDATE return_items SET product_id=2,batch_id=2 WHERE return_id=10').run()
    f.sql.prepare('UPDATE return_item_batch_allocations SET batch_id=2 WHERE return_item_id=10').run()
    await refused(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-wrong-return-product')), 'return stock product disagrees with sale line')
  }],
  ['other-sale-line', async f => {
    await cancelA(f)
    f.sql.exec("INSERT INTO sales(id,receipt_number,sale_status) VALUES(2,'OTHER-SALE','completed'); UPDATE sale_items SET sale_id=2 WHERE id=101")
    await refused(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-other-sale')), 'id exists on another sale')
  }],
  ['bulk-atomic', async f => {
    await cancelA(f)
    insertReturn(f.sql, 11, 102, 2, 'cancelled')
    f.sql.prepare('DELETE FROM sale_items WHERE id=101').run()
    await refused(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10, 11], 'cancelled', 'completed', 'restore-mixed-group')), 'one orphan rejects the entire group')
  }],
  ['active-cohort-orphan', async f => {
    insertReturn(f.sql, 11, 102, 2, 'cancelled')
    f.sql.prepare('DELETE FROM sale_items WHERE id=101').run()
    await refused(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [11], 'cancelled', 'completed', 'restore-with-active-orphan')), 'unselected active orphan remains in projected cohort')
  }],
  ['valid-single-replay-retry', async f => {
    await cancelA(f)
    const req = request(f, [10], 'cancelled', 'completed', 'restore-valid-single')
    const applied = await kernel.applyReturnBulkActionOutcome(f.env, employee, req)
    assert.deepEqual(applied.receipt.changedIds, [10])
    assert.equal(applied.wrote, true)
    assert.equal(stock(f), 11)
    assert.equal(refund(f), 10)
    assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'partial_return')
    const after = state(f)
    const retry = await kernel.applyReturnBulkActionOutcome(f.env, employee, req)
    assert.deepEqual(retry.receipt, applied.receipt)
    assert.equal(retry.wrote, false)
    assert.equal(state(f), after)
    await replay(f, applied.receipt, 'undo', 0, employee)
    assert.equal(stock(f), 10)
    assert.equal(refund(f), 0)
    await replay(f, applied.receipt, 'redo', 1, employee)
    assert.equal(stock(f), 11)
    assert.equal(refund(f), 10)
  }],
  ['valid-bulk', async f => {
    await cancelA(f)
    insertReturn(f.sql, 11, 102, 2, 'cancelled')
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10, 11], 'cancelled', 'completed', 'restore-valid-group'))
    assert.deepEqual(result.changedIds, [10, 11])
    assert.equal(refund(f), 30)
    assert.equal(stock(f), 11)
    assert.equal(stock(f, 2), 11)
    assert.equal(f.sql.prepare('SELECT sale_status FROM sales WHERE id=1').get().sale_status, 'returned')
  }],
  ['cancelled-orphan-excluded', async f => {
    await cancelA(f)
    insertReturn(f.sql, 11, 102, 2, 'cancelled')
    f.sql.prepare('DELETE FROM sale_items WHERE id=101').run()
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [11], 'cancelled', 'completed', 'restore-valid-B-only'))
    assert.deepEqual(result.changedIds, [11])
    assert.equal(refund(f), 20)
    assert.equal(stock(f), 10)
  }],
  ['repair-cancel', async f => {
    f.sql.prepare('DELETE FROM sale_items WHERE id=101').run()
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'completed', 'cancelled', 'cancel-orphan-repair'))
    assert.deepEqual(result.changedIds, [10])
    assert.equal(refund(f), 0)
    assert.equal(stock(f), 10)
  }],
  ['undo-restores-orphan', async f => {
    const cancelled = await cancelA(f)
    f.sql.prepare('DELETE FROM sale_items WHERE id=101').run()
    await refused(f, () => replay(f, cancelled, 'undo', 0), 'undo cancellation cannot reactivate an orphan')
  }],
  ['redo-restores-orphan', async f => {
    await cancelA(f)
    const restored = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-before-redo'))
    await replay(f, restored, 'undo', 0)
    f.sql.prepare('DELETE FROM sale_items WHERE id=101').run()
    await refused(f, () => replay(f, restored, 'redo', 1), 'redo restoration cannot reactivate an orphan')
  }],
  ['permission-denied', async f => {
    await cancelA(f)
    const before = state(f)
    const batches = f.batches()
    await assert.rejects(() => kernel.applyReturnBulkAction(f.env, denied, request(f, [10], 'cancelled', 'completed', 'restore-role-denied')),
      error => error.statusCode === 403 && /Bulk Returns access is required/.test(error.message))
    assert.equal(state(f), before)
    assert.equal(f.batches(), batches)
  }],
  ['source-mismatch-noop', async f => {
    await cancelA(f)
    f.sql.exec('DELETE FROM sale_items WHERE id=101; UPDATE return_items SET refund_snapshot_json=NULL WHERE return_id=10')
    const before = f.sql.prepare('SELECT * FROM returns WHERE id=10').get()
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'completed', 'cancelled', 'source-mismatch-orphan'))
    assert.deepEqual(result.changedIds, [])
    assert.deepEqual(result.unchangedIds, [10])
    assert.deepEqual(f.sql.prepare('SELECT * FROM returns WHERE id=10').get(), before)
    assert.equal(f.sql.prepare('SELECT status FROM action_history WHERE id=?').get(result.actionHistoryId).status, 'recorded')
    assert.equal(stock(f), 10)
    assert.equal(refund(f), 0)
  }],
  ['product-reparent-compatible', async f => {
    await cancelA(f)
    f.sql.exec(`UPDATE sale_items SET product_id=2 WHERE id=101;
      UPDATE return_items SET product_id=2,batch_id=2 WHERE return_id=10;
      UPDATE return_item_batch_allocations SET batch_id=2 WHERE return_item_id=10`)
    const immutable = f.sql.prepare('SELECT refund_snapshot_json FROM return_items WHERE return_id=10').get().refund_snapshot_json
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-reparented-product'))
    assert.deepEqual(result.changedIds, [10])
    assert.equal(f.sql.prepare('SELECT refund_snapshot_json FROM return_items WHERE return_id=10').get().refund_snapshot_json, immutable)
    assert.equal(stock(f), 10)
    assert.equal(stock(f, 2), 11)
    assert.equal(refund(f), 10)
  }],
  ['sale-line-race', async f => {
    await cancelA(f)
    let afterRemoval
    f.beforeBatch(() => {
      f.sql.prepare('DELETE FROM sale_items WHERE id=101').run()
      afterRemoval = state(f)
    })
    await assert.rejects(() => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-removal-race')),
      error => error.statusCode === 409 && /changed|Nothing/.test(error.message))
    assert.equal(state(f), afterRemoval, 'sale revision guard retains interposed deletion and rolls back every restore effect')
    assert.equal(stock(f), 10)
    assert.equal(refund(f), 0)
  }],
]

async function main() {
  const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length)
  if (selected) assert.ok(cases.some(([name]) => name === selected), `Unknown case: ${selected}`)
  let passed = 0
  for (const [name, run] of cases) {
    if (selected && selected !== name) continue
    const f = fixture()
    try { await run(f); passed++; console.log(`PASS ${name}`) }
    finally { f.sql.close() }
  }
  console.log(`PASS return restore sale-item entitlement: ${passed}/${selected ? 1 : cases.length} cases (real kernels, migrated SQLite, atomic D1 batch adapter)`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
