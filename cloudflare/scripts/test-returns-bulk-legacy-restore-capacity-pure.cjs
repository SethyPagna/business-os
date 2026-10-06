const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
// Restoring a cancelled return on a LEGACY (money_precision_version 0) sale
// must respect the same quantity cap POST /api/returns enforces.
//
// The defect (hunt H-stock #2, 2026-09-27): lib/returnBulkAction.ts validated
// the returned-quantity cohort only for v1 sales (`if (!headers.some(v1))
// continue`). Sell 2, return 2, cancel it, return 2 again, restore the first:
// 4 units counted as returned against 2 sold, stock restocked twice and the
// refund counted twice.
//
// Real lib/returnBulkAction.ts + lib/returnCreateAction.ts on the full
// migration chain in SQLite (same loader as test-returns-bulk-pure.cjs).
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const cache = new Map()
const actual = new Set(['branchEffect', 'branchRoles', 'sqlBinding', 'saleStatusResolution', 'actorSnapshot', 'movementBranchName', 'db', 'permissions', 'saleRecords', 'saleRecordEvents',
  'moneyPrecision', 'saleMoneyPrecision', 'refundMoneyPrecision', 'promotionRules', 'saleItemPricing',
  'customerReturnEntitlement', 'returnBulkAction', 'returnCreateAction'])

function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const source = fs.readFileSync(path.join(root, 'src', rel), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = name => {
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {} }
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
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        return {
          text, params,
          async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
          async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
          async run() { const result = sqliteD1Call(sql.prepare(text), 'run', params); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } } },
        }
      } }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map(statement => {
        const result = sqliteD1Call(sql.prepare(statement.text), 'run', statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  } }
  return { sql, env }
}

// Legacy sale 1: one line of 2 units of product 1. Returns are stock-neutral
// ('none') so the only thing under test is the returned-quantity cap.
function seed(f, returns) {
  f.sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'Serum',10);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10);
    INSERT INTO sales(id,receipt_number,sale_status,status_before_return,money_precision_version,updated_at)
      VALUES(1,'SALE-1','returned','completed',0,'sale-v0');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id) VALUES(1,1,1,'Serum',2,1);
  `)
  for (const r of returns) {
    f.sql.prepare(`INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,branch_id,updated_at,
      money_precision_version,total_refund_usd,total_refund_khr) VALUES(?,?,1,'customer',?,'refund',1,?,0,?,0)`)
      .run(r.id, `RET-${r.id}`, r.status, `u-${r.id}`, 5 * r.quantity)
    f.sql.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,total_usd,
      applied_price_usd,stock_action,return_to_stock,branch_id) VALUES(?,?,1,'Serum',?,?,5,'none',0,1)`)
      .run(r.id, r.saleItemId === undefined ? 1 : r.saleItemId, r.quantity, 5 * r.quantity)
  }
}

function restoreRequest(f, id, key) {
  const row = f.sql.prepare('SELECT status,return_type,updated_at FROM returns WHERE id=?').get(id)
  return { client_request_id: key, field: 'status', source: 'cancelled', target: 'completed',
    items: [{ id, expected_status: row.status, expected_method: row.return_type, expected_updated_at: row.updated_at }] }
}

function state(f) {
  return JSON.stringify(['returns', 'return_items', 'sales', 'branch_stock', 'products', 'inventory_movements',
    'return_bulk_operations', 'action_history'].map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

function activeReturned(f) {
  return f.sql.prepare(`SELECT COALESCE(SUM(ri.quantity),0) q FROM return_items ri JOIN returns r ON r.id=ri.return_id
    WHERE r.sale_id=1 AND COALESCE(r.status,'completed')<>'cancelled'`).get().q
}

async function refused(f, id, key, label, params) {
  const before = state(f)
  await assert.rejects(helper.applyReturnBulkAction(f.env, user, restoreRequest(f, id, key)),
    error => error instanceof Error && error.statusCode === 409 && /more units as returned than the sale sold/.test(error.message)
      // The machine code the bulk route forwards, so the client can restate
      // the refusal in the operator's language (en/km return_restore_over_capacity).
      && error.code === 'return_restore_over_capacity'
      // ...and the product and counts the English names (FX-exc1 item 4), so
      // the restated refusal keeps them (return_restore_over_capacity_detail).
      && JSON.stringify(error.params) === JSON.stringify(params),
    `${label}: the restore is refused with code return_restore_over_capacity and params ${JSON.stringify(params)}`)
  assert.equal(state(f), before, `${label}: a refused restore writes nothing`)
  assert.equal(activeReturned(f), 2, `${label}: still exactly the 2 sold units counted as returned`)
}

async function run() {
  // 1. The hunt's sequence: R10 (2, cancelled) then R11 (2, completed). Restoring R10 would make 4 of 2.
  {
    const f = fixture(); seed(f, [{ id: 10, status: 'cancelled', quantity: 2 }, { id: 11, status: 'completed', quantity: 2 }])
    await refused(f, 10, 'legacy-restore-over-1', 'sale_item_id lines', { product: 'Serum', returned: 4, sold: 2 })
  }
  // 2. Same, but the newer return matched the sale by product only (no sale_item_id).
  {
    const f = fixture(); seed(f, [{ id: 10, status: 'cancelled', quantity: 2 }, { id: 11, status: 'completed', quantity: 2, saleItemId: null }])
    await refused(f, 10, 'legacy-restore-over-2', 'product-matched line', { product: 'Serum', returned: 4, sold: 2 })
  }
  // 3. Partial overlap: 1 already active + restoring 2 = 3 of 2.
  {
    const f = fixture(); seed(f, [{ id: 10, status: 'cancelled', quantity: 2 }, { id: 11, status: 'completed', quantity: 1 }])
    const before = state(f)
    await assert.rejects(helper.applyReturnBulkAction(f.env, user, restoreRequest(f, 10, 'legacy-restore-over-3')),
      error => error.statusCode === 409 && JSON.stringify(error.params) === JSON.stringify({ product: 'Serum', returned: 3, sold: 2 }))
    assert.equal(state(f), before)
  }
  // 4. Positive control: nothing else active, the restore succeeds and counts 2 of 2.
  {
    const f = fixture(); seed(f, [{ id: 10, status: 'cancelled', quantity: 2 }, { id: 11, status: 'cancelled', quantity: 2 }])
    const receipt = await helper.applyReturnBulkAction(f.env, user, restoreRequest(f, 10, 'legacy-restore-ok-1'))
    assert.deepEqual(receipt.changedIds, [10])
    assert.equal(f.sql.prepare('SELECT status FROM returns WHERE id=10').get().status, 'completed')
    assert.equal(activeReturned(f), 2)
  }
  // 5. Positive control: exactly filling the line (1 active + restoring 1) is allowed.
  {
    const f = fixture(); seed(f, [{ id: 10, status: 'cancelled', quantity: 1 }, { id: 11, status: 'completed', quantity: 1 }])
    const receipt = await helper.applyReturnBulkAction(f.env, user, restoreRequest(f, 10, 'legacy-restore-ok-2'))
    assert.deepEqual(receipt.changedIds, [10])
    assert.equal(activeReturned(f), 2)
  }
  // 6. Cancelling is never blocked by the cap, even on an already over-returned legacy sale.
  {
    const f = fixture(); seed(f, [{ id: 10, status: 'completed', quantity: 2 }, { id: 11, status: 'completed', quantity: 2 }])
    const row = f.sql.prepare('SELECT status,return_type,updated_at FROM returns WHERE id=10').get()
    const receipt = await helper.applyReturnBulkAction(f.env, user, { client_request_id: 'legacy-cancel-over', field: 'status',
      source: 'completed', target: 'cancelled',
      items: [{ id: 10, expected_status: row.status, expected_method: row.return_type, expected_updated_at: row.updated_at }] })
    assert.deepEqual(receipt.changedIds, [10], 'a repair-direction cancel stays possible')
    assert.equal(activeReturned(f), 2)
  }
  console.log('PASS legacy return restore capacity: restoring a cancelled return on a v0 sale is refused (writing nothing) when it would count more units as returned than were sold, by sale_item_id or product match; in-cap restores and every cancel still succeed')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
