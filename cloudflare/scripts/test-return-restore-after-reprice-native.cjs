const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
// 6.0.905 (owner, 20 Oct 2026): a return is the tag beside the payment state (sales.return_state) and never a
// sale_status word; the word it used to write is read off the tag.
function returnWord(f, id) {
  const row = f.sql.prepare('SELECT sale_status,return_state FROM sales WHERE id=?').get(id)
  assert.ok(!['partial_return', 'returned'].includes(row.sale_status), `sale ${id} carries a retired word: ${row.sale_status}`)
  return row.return_state === 'full' ? 'returned' : row.return_state === 'partial' ? 'partial_return' : row.sale_status
}
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

// Real v1 pricing snapshots (the Worker's own serializer), not placeholders: a check that only skipped empty snapshots, or hashed the wrong text, would pass a fixture of ''.
const pricing = load('lib/saleItemPricing.ts')
const KEYS = { 101: 'a', 102: 'b' }
const PRICES = { a: 10, b: 20 }
// prices: unit price per line key; extra: lines added to the sale later; discount: header discount prorated over all lines.
function snapshotOf(lineKey, { prices = PRICES, extra = {}, discount = 0, membership = 0 } = {}) {
  const all = { ...prices, ...extra }
  const pool = { version: 1, pool_key: 'sale-AB-pool', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [],
    lines: Object.keys(all).map(key => ({ line_key: key, source: 'selling', product: { id: 7, selling_price_usd: all[key], selling_price_khr: 1 }, selling_price_input_usd: null, manual: { type: 'none', value: 0 } })) }
  const quantities = Object.fromEntries(Object.keys(all).map(key => [key, 1]))
  return pricing.serializeSaleItemPricing(pool, quantities, lineKey, { version: 1, lines: Object.keys(all).map(key => ({ line_key: key, amount: all[key] })),
    discount_usd: discount, membership_discount_usd: membership, tax_usd: 0 })
}
const PRICING_101 = snapshotOf('a')
const PRICING_102 = snapshotOf('b')
function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  assert.throws(() => sql.prepare("INSERT INTO products(name) VALUES('unadmitted fixture control')").run(), /stock_transaction_required/)
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
  seedStockFixture(sql, () => sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',11),(2,'B',10);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,11),(2,1,10);
    INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(1,1,'lot-A'),(2,2,'lot-B');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,11),(2,1,10);
    INSERT INTO sales(id,receipt_number,sale_status,status_before_return,money_precision_version,
      calculated_total_usd,rounding_adjustment_usd,total_usd,updated_at)
      VALUES(1,'SALE-AB','partial_return','completed',1,30,0,30,'sale-AB');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,pricing_snapshot_json)
      VALUES(101,1,1,'A',1,1,10,10,'${PRICING_101}'),(102,1,2,'B',1,1,20,20,'${PRICING_102}');
  `))
  insertReturn(sql, 10, 101, 1, 'completed')
  return { sql, env, batches: () => batches, beforeBatch: hook => { beforeBatch = hook } }
}

function insertReturn(sql, id, saleItemId, productId, status, legacy = false) {
  const amount = productId === 1 ? 10 : 20
  const snapshot = JSON.stringify({ version: 1, sale_id: 1, sale_item_id: saleItemId,
    line_key: KEYS[saleItemId], pool_key: 'sale-AB-pool', source_sale_revision: 0,
    source_pricing_snapshot_digest: 'a'.repeat(64), sold_quantity: 1, return_quantity: 1,
    returned_quantity_before: 0, returned_quantity_after: 1,
    receipt_allocation: { discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, net_entitlement_usd: amount },
    net_entitlement_usd: amount, calculated_refund_before_usd: 0, calculated_refund_after_usd: amount,
    calculated_refund_usd: amount, calculated_refund_khr: amount * 4000, exchange_rate: 4000,
    sale_product_entitlement_usd: 30, sale_product_payout_cap_usd: 30 })
  sql.prepare(`INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,branch_id,updated_at,
    money_precision_version,calculated_refund_usd,rounding_adjustment_usd,total_refund_usd,total_refund_khr)
    VALUES(?,?,1,'customer',?,'refund',1,?,?,?,0,?,?)`)
    .run(id, `RET-${id}`, status, `return-${id}`, legacy ? 0 : 1, legacy ? null : amount, amount, amount * 4000)
  sql.prepare(`INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,total_usd,
    total_khr,applied_price_usd,applied_price_khr,stock_action,return_to_stock,branch_id,batch_id,refund_snapshot_json)
    VALUES(?,?,?,?,?,1,?,?,?,?,'restock',1,1,?,?)`)
    .run(id, id, saleItemId, productId, productId === 1 ? 'A' : 'B', amount, amount * 4000,
      amount, amount * 4000, productId, legacy ? null : snapshot)
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

// Finding G (owner, 12-13 Oct 2026): a cancelled return is not restored after its sale was repriced; staff record a new return.
// A reprice rewrites the sale line's pricing snapshot, whose sha-256 the return recorded when it was priced.
const CODE = 'return_restore_sale_repriced'
// A real reprice: the line's unit price changes, so its total, its allocation and its snapshot change.
const reprice = (f, id = 101) => f.sql.prepare('UPDATE sale_items SET pricing_snapshot_json=? WHERE id=?').run(snapshotOf(KEYS[id], { prices: { ...PRICES, [KEYS[id]]: 99 } }), id)
// Every line's snapshot is rewritten when another item is added to the sale (the allocation context lists all lines).
const addUnrelatedItem = (f, discount = 0) => {
  for (const id of [101, 102]) f.sql.prepare('UPDATE sale_items SET pricing_snapshot_json=? WHERE id=?').run(snapshotOf(KEYS[id], { extra: { c: 30 }, discount }), id)
}
async function repricedRefusal(f, action, label) {
  const before = state(f)
  const batches = f.batches()
  await assert.rejects(action, error => error instanceof kernel.ReturnBulkError && error.statusCode === 409 && error.code === CODE
    && /record a new return/i.test(error.message), label)
  assert.equal(state(f), before, `${label}: nothing changed`)
  assert.equal(f.batches(), batches, `${label}: refused before any write batch`)
}

// A legacy (v0) return: no refund snapshot, money_precision_version 0 -- nothing in it to compare the sale line with.
function makeLegacy(f) {
  f.sql.exec('DELETE FROM return_item_batch_allocations WHERE return_item_id=10; DELETE FROM return_items WHERE return_id=10; DELETE FROM returns WHERE id=10; UPDATE sales SET money_precision_version=0 WHERE id=1')
  insertReturn(f.sql, 10, 101, 1, 'completed', true)
}

const cases = [
  ['no-reprice-restores-normally', async f => {
    await cancelA(f)
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-unchanged'))
    assert.deepEqual(result.changedIds, [10])
    assert.equal(stock(f), 11)
    assert.equal(refund(f), 10)
  }],
  ['reprice-then-list-restore-refused', async f => {
    await cancelA(f)
    reprice(f)
    const req = request(f, [10], 'cancelled', 'completed', 'restore-after-reprice')
    await repricedRefusal(f, () => kernel.applyReturnBulkActionOutcome(f.env, admin, req), 'list restore')
    await repricedRefusal(f, () => kernel.applyReturnBulkActionOutcome(f.env, admin, req), 'same refused request retried (nothing stored for it)')
    assert.equal(stock(f), 10)
    assert.equal(refund(f), 0)
  }],
  ['dry-run-refuses-too', async f => {
    await cancelA(f)
    reprice(f)
    await repricedRefusal(f, () => kernel.applyReturnBulkAction(f.env, admin, { ...request(f, [10], 'cancelled', 'completed', 'restore-dry'), dry_run: true }), 'dry run')
  }],
  ['group-with-one-repriced-is-refused-whole', async f => {
    await cancelA(f)
    insertReturn(f.sql, 11, 102, 2, 'cancelled')
    reprice(f, 102)
    await repricedRefusal(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10, 11], 'cancelled', 'completed', 'restore-group-reprice')), 'group')
  }],
  ['only-the-repriced-line-matters', async f => {
    await cancelA(f)
    insertReturn(f.sql, 11, 102, 2, 'cancelled')
    reprice(f, 102)
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-untouched-line'))
    assert.deepEqual(result.changedIds, [10])
    assert.equal(refund(f), 10)
  }],
  ['undo-of-cancel-after-reprice-refused', async f => {
    const cancelled = await cancelA(f)
    reprice(f)
    await repricedRefusal(f, () => replay(f, cancelled, 'undo', 0), 'undo of the cancel')
  }],
  ['redo-of-restore-after-reprice-refused', async f => {
    await cancelA(f)
    const restored = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-then-undo'))
    await replay(f, restored, 'undo', 0)
    reprice(f)
    await repricedRefusal(f, () => replay(f, restored, 'redo', 1), 'redo of the restore')
  }],
  ['undo-without-reprice-still-works', async f => {
    const cancelled = await cancelA(f)
    await replay(f, cancelled, 'undo', 0)
    assert.equal(stock(f), 11)
    assert.equal(refund(f), 10)
    await replay(f, cancelled, 'redo', 1)
    assert.equal(stock(f), 10)
  }],
  ['reprice-does-not-block-cancelling', async f => {
    reprice(f)
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'completed', 'cancelled', 'cancel-after-reprice'))
    assert.deepEqual(result.changedIds, [10])
    assert.equal(stock(f), 10)
  }],
  ['undo-of-restore-after-reprice-is-a-cancel-and-allowed', async f => {
    await cancelA(f)
    const restored = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-ok'))
    // The restore changed the sale's revision; a repriced sale refuses the replay by its revision guard, never by the digest check.
    reprice(f)
    await assert.rejects(() => replay(f, restored, 'undo', 0), error => !(error.code === CODE))
  }],
  ['non-pricing-sale-change-does-not-refuse', async f => {
    await cancelA(f)
    f.sql.exec("UPDATE sales SET updated_at='later-note' WHERE id=1")
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-after-note'))
    assert.deepEqual(result.changedIds, [10])
  }],
  ['empty-snapshot-legacy-line-is-not-refused-without-a-ledger-entry', async f => {
    makeLegacy(f)
    await cancelA(f)
    f.sql.exec("UPDATE sale_items SET pricing_snapshot_json='' WHERE id=101")
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-legacy'))
    assert.deepEqual(result.changedIds, [10], 'nothing comparable and no recorded line change: the legacy line restores')
  }],
  ['historical-sale-line-changed-after-the-return-is-refused', async f => {
    makeLegacy(f)
    await cancelA(f)
    f.sql.exec("UPDATE sale_items SET pricing_snapshot_json=NULL WHERE id=101")
    f.sql.exec("INSERT INTO sale_amendments(sale_id,kind,sale_item_id,created_at) VALUES(1,'line_updated',101,'2999-01-01 00:00:00')")
    await repricedRefusal(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-v0-edited')), 'v0 line edited after the return')
  }],
  ['historical-sale-line-changed-before-the-return-is-not-refused', async f => {
    makeLegacy(f)
    await cancelA(f)
    f.sql.exec("UPDATE sale_items SET pricing_snapshot_json=NULL WHERE id=101")
    f.sql.exec("INSERT INTO sale_amendments(sale_id,kind,sale_item_id,created_at) VALUES(1,'line_updated',101,'2000-01-01 00:00:00')")
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-v0-old-edit'))
    assert.deepEqual(result.changedIds, [10])
  }],
  ['adding-an-unrelated-item-does-not-block-the-restore', async f => {
    await cancelA(f)
    addUnrelatedItem(f)
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-after-add'))
    assert.deepEqual(result.changedIds, [10])
  }],
  ['adding-an-item-that-moves-the-header-discount-share-is-a-reprice', async f => {
    await cancelA(f)
    addUnrelatedItem(f, 3)
    await repricedRefusal(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-after-discounted-add')), 'discount share changed')
  }],
  // planDeliveryFeeChange rewrites the sale header only (no line snapshot, no line entitlement; the refund cap is min(total, product entitlement) and the fee only raises the total).
  ['delivery-fee-change-is-not-a-reprice', async f => {
    await cancelA(f)
    f.sql.exec("UPDATE sales SET delivery_fee_usd=2.5,delivery_fee_khr=10000,delivery_fee_paid_by='customer' WHERE id=1")
    const result = await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-after-fee'))
    assert.deepEqual(result.changedIds, [10])
  }],
  // Same net entitlement, different split (header discount -> membership discount): the net comparison cannot see it, the allocation comparison does.
  ['moving-a-share-between-discount-and-membership-with-the-same-net-is-a-reprice', async f => {
    const recorded = JSON.parse(snapshotOf('a', { discount: 3 })).receipt_allocation
    const now = JSON.parse(snapshotOf('a', { membership: 3 })).receipt_allocation
    assert.equal(recorded.net_entitlement_usd, now.net_entitlement_usd, 'fixture: the same net entitlement')
    assert.notDeepEqual(recorded, now, 'fixture: a different split')
    await cancelA(f)
    const row = f.sql.prepare('SELECT refund_snapshot_json FROM return_items WHERE return_id=10').get()
    const snapshot = JSON.parse(row.refund_snapshot_json); snapshot.receipt_allocation = recorded; snapshot.net_entitlement_usd = recorded.net_entitlement_usd
    f.sql.prepare('UPDATE return_items SET refund_snapshot_json=? WHERE return_id=10').run(JSON.stringify(snapshot))
    for (const id of [101, 102]) f.sql.prepare('UPDATE sale_items SET pricing_snapshot_json=? WHERE id=?').run(snapshotOf(KEYS[id], { membership: 3 }), id)
    await repricedRefusal(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-split-moved')), 'discount share moved to the membership discount')
  }],
  ['units-sold-changed-is-a-reprice', async f => {
    await cancelA(f)
    f.sql.exec('UPDATE sale_items SET quantity=2 WHERE id=101')
    await repricedRefusal(f, () => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-qty-changed')), 'quantity changed')
  }],
  ['reprice-landing-before-the-write-is-fenced', async f => {
    await cancelA(f)
    f.beforeBatch(() => reprice(f))
    await assert.rejects(() => kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-race')),
      error => error.statusCode === 409)
    assert.equal(stock(f), 10)
    assert.equal(refund(f), 0)
  }],
  ['supplier-returns-are-not-checked', async f => {
    // The scope filter: a supplier return has no sale pricing; the helper must never refuse one.
    await cancelA(f)
    f.sql.exec("UPDATE returns SET return_scope='supplier' WHERE id=10")
    reprice(f)
    await kernel.applyReturnBulkAction(f.env, admin, request(f, [10], 'cancelled', 'completed', 'restore-supplier')).catch(error => assert.notEqual(error.code, CODE))
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
  console.log(`PASS return restore after reprice: ${passed}/${selected ? 1 : cases.length} cases (real kernels, migrated SQLite, atomic D1 batch adapter)`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
