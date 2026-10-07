// CUTOVER-LC residual gap: the grouped return action (cancel / restore, with its undo and redo) for a return that was
// recorded at a branch that has since been retired (Shop -> "Old Shop", successor "LC Store").
//
// Real returnBulkAction / branchEffect kernels against migrated SQLite and the raw D1 binding shape. An ORACLE is the same
// kernel as it stood at b2b57f90b, run on the same fixtures: while both branches are active the new kernel writes
// byte-identical statements and ledgers (inert), and on the post-consolidation fixture the old kernel strands the units in
// the retired branch (so the fixture tells the fix from the defect).
//
// Run (from cloudflare/): node scripts/test-return-bulk-retired-branch-pure.cjs

const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const ORACLE_SHA = 'b2b57f90b'
const oracleSource = execFileSync('git', ['show', `${ORACLE_SHA}:cloudflare/src/lib/returnBulkAction.ts`], { cwd: path.join(root, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

function makeLoader(overrides) {
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const mod = { exports: {} }
    cache.set(rel, mod)
    const source = overrides[rel] ?? fs.readFileSync(path.join(root, 'src', rel), 'utf8')
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const req = (name) => {
      if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {} }
      if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts')
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load
}
const fresh = makeLoader({})('lib/returnBulkAction.ts')
const old = makeLoader({ 'lib/returnBulkAction.ts': oracleSource })('lib/returnBulkAction.ts')

const admin = { id: 1, username: 'admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const tables = ['returns', 'return_items', 'return_item_batch_allocations', 'sales', 'sale_items', 'products', 'product_batches', 'branch_stock',
  'branch_batch_stock', 'damaged_stock_lots', 'inventory_movements', 'undo_snapshots', 'action_history', 'return_bulk_operations',
  'return_bulk_members', 'return_bulk_guards', 'return_write_revisions', 'sale_write_revisions', 'audit_logs', 'sale_record_events']

let migratedTemplate = null
function migratedDb() {
  if (!migratedTemplate) {
    const seed = new Database(':memory:')
    seed.pragma('foreign_keys = OFF')
    for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) seed.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
    migratedTemplate = seed.serialize()
    seed.close()
  }
  const sql = new Database(migratedTemplate)
  sql.pragma('foreign_keys = OFF')
  return sql
}

// Production ids after the cutover: 1 = LC Store (was Warehouse), 2 = Old Shop (was Shop). The return was made at Shop (2) and
// restocked 2 units into lot 3 there; the consolidation then moved Old Shop's stock into LC Store and folded lot 3 into lot 1.
//   before  both branches active, NULL roles; lot 3 holds the 2 units at Shop
//   after   consolidated: LC Store holds lot 1 with everything, Old Shop is empty and retired with successor LC Store
//   orphan  as after, but Old Shop has no successor
function fixture(state, { damaged = false } = {}) {
  const sql = migratedDb()
  let batches = 0
  const capture = []
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        return { text, params,
          async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
          async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
          async run() { const result = sqliteD1Call(sql.prepare(text), 'run', params); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } } },
        }
      } }
    },
    async batch(statements) {
      batches++
      capture.push(statements.map((statement) => ({ sql: statement.text, params: statement.params })))
      return sql.transaction(() => statements.map((statement) => {
        const result = sqliteD1Call(sql.prepare(statement.text), 'run', statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  } }
  sql.exec('DELETE FROM branches')
  if (state === 'before') {
    sql.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Warehouse',1,0),(2,'Shop',1,1)")
  } else {
    sql.exec("INSERT INTO branches(id,name,role,canonical_key,is_active,is_default) VALUES(1,'LC Store','shop','warehouse',1,1)")
    sql.prepare("INSERT INTO branches(id,name,role,canonical_key,is_active,is_default,successor_branch_id) VALUES(2,'Old Shop','shop','shop',0,0,?)").run(state === 'orphan' ? null : 1)
  }
  sql.exec(`INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',${state === 'before' ? 16 : 16});
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(1,1,'lot-a','LOT-A','2026-01-01',1,1),(3,1,'lot-c','LOT-C','2026-01-01',1,3);`)
  if (state === 'before') {
    sql.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,16); INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,2,10),(3,2,6)')
  } else {
    sql.exec(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,16),(1,2,0);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,16),(3,1,0),(1,2,0),(3,2,0)`)
    sql.prepare("INSERT INTO audit_logs(user_name,action,entity,entity_id,details) VALUES('op','branch_cutover_lot_fold','product_batch','1',?)")
      .run(JSON.stringify({ operationId: 'op-1', productId: 1, survivorBatchId: 1, foldedBatchIds: [3], branchId: 1 }))
  }
  sql.exec(`INSERT INTO sales(id,receipt_number,sale_status,status_before_return,branch_id,branch_name,money_precision_version,calculated_total_usd,rounding_adjustment_usd,total_usd,updated_at)
      VALUES(1,'SALE-OLD','partial_return','completed',2,'Shop',1,30,0,30,'sale-1');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd) VALUES(101,1,1,'A',5,2,10,50);`)
  const snapshot = JSON.stringify({ version: 1, sale_id: 1, sale_item_id: 101, line_key: 'line-101', pool_key: 'sale-pool', source_sale_revision: 0,
    source_pricing_snapshot_digest: 'a'.repeat(64), sold_quantity: 5, return_quantity: 2, returned_quantity_before: 0, returned_quantity_after: 2,
    receipt_allocation: { discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, net_entitlement_usd: 20 }, net_entitlement_usd: 20,
    calculated_refund_before_usd: 0, calculated_refund_after_usd: 20, calculated_refund_usd: 20, calculated_refund_khr: 80000, exchange_rate: 4000,
    sale_product_entitlement_usd: 50, sale_product_payout_cap_usd: 50 })
  sql.prepare(`INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,branch_id,branch_name,updated_at,money_precision_version,calculated_refund_usd,rounding_adjustment_usd,total_refund_usd,total_refund_khr)
    VALUES(10,'RET-10',1,'customer','completed','refund',2,'Shop','return-10',0,NULL,0,20,80000)`).run()
  sql.prepare(`INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,total_usd,total_khr,applied_price_usd,applied_price_khr,stock_action,return_to_stock,branch_id,batch_id,refund_snapshot_json)
    VALUES(10,10,101,1,'A',2,20,80000,10,40000,?,?,2,3,?)`).run(damaged ? 'damaged' : 'restock', damaged ? 0 : 1, snapshot)
  sql.prepare('INSERT INTO return_item_batch_allocations(return_item_id,batch_id,branch_id,quantity) VALUES(10,3,2,2)').run()
  return { sql, env, capture, batches: () => batches }
}

const request = (f, source, target, key) => ({ client_request_id: key, field: 'status', source, target,
  items: f.sql.prepare("SELECT id,status AS expected_status,return_type AS expected_method,updated_at AS expected_updated_at FROM returns WHERE id=10").all() })
const stockOf = (f) => ({
  lot1AtStore: f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').get()?.quantity ?? null,
  lot3AtStore: f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=3 AND branch_id=1').get()?.quantity ?? null,
  lot1AtOld: f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=2').get()?.quantity ?? null,
  lot3AtOld: f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=3 AND branch_id=2').get()?.quantity ?? null,
  store: f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get()?.quantity ?? null,
  old: f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get()?.quantity ?? null,
  product: f.sql.prepare('SELECT stock_quantity AS quantity FROM products WHERE id=1').get().quantity,
})
const state = (f) => JSON.stringify(tables.map((table) => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const scrub = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/\d{4}-\d{2}-\d{2}[ T][\d:.Z]+/g, '<ts>').replace(/-\d{12,}/g, '<id>')
const movements = (f) => f.sql.prepare("SELECT movement_type, branch_id, branch_name, addressed_branch_name, quantity, batch_id FROM inventory_movements ORDER BY id").all().map((row) => ({ ...row }))
async function replay(kernel, f, receipt, direction, generation) {
  const row = f.sql.prepare('SELECT undo_payload,redo_payload FROM action_history WHERE id=?').get(receipt.actionHistoryId)
  return kernel.replayReturnBulkAction(f.env, admin, direction, receipt.actionHistoryId, generation, JSON.parse(row[direction === 'undo' ? 'undo_payload' : 'redo_payload']))
}
// CUTOVER-LR: `redirect` is the confirmed branch the route reads from X-Branch-Redirect; LC Store is id 1 here.
const refused = async (kernel, f, req, status, code, redirect = null) => {
  const before = state(f)
  let caught = null
  await assert.rejects(kernel.applyReturnBulkActionOutcome(f.env, admin, req, redirect), (error) => { caught = error; return error instanceof kernel.ReturnBulkError && error.statusCode === status && (!code || error.code === code || error.message.includes(code)) })
  assert.equal(state(f), before, 'a refusal writes nothing')
  return caught
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

;(async () => {
  await check('CONTROL: the code before this change cannot cancel an old Shop return at all (it asks the empty retired branch for the units)', async () => {
    const f = fixture('after')
    const before = state(f)
    await assert.rejects(old.applyReturnBulkActionOutcome(f.env, admin, request(f, 'completed', 'cancelled', 'old-cancel')), (error) => error instanceof old.ReturnBulkError && error.statusCode === 409)
    assert.equal(state(f), before)
    const stocked = fixture('after')
    stocked.sql.exec('UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=3 AND branch_id=2; UPDATE branch_stock SET quantity=2 WHERE product_id=1 AND branch_id=2')
    const outcome = await old.applyReturnBulkActionOutcome(stocked.env, admin, request(stocked, 'completed', 'cancelled', 'old-cancel-2'))
    assert.equal(outcome.wrote, true)
    assert.equal(stockOf(stocked).lot1AtStore, 16, 'when the retired branch happens to hold stock the old code drains it instead of LC Store')
  })

  await check('cancel / undo / redo / restore of an old Shop return move the units at LC Store in the merged lot', async () => {
    const f = fixture('after')
    const before = stockOf(f)
    assert.deepEqual(before, { lot1AtStore: 16, lot3AtStore: 0, lot1AtOld: 0, lot3AtOld: 0, store: 16, old: 0, product: 16 })
    const cancelRequest = request(f, 'completed', 'cancelled', 'cancel-1')
    const asked = await refused(fresh, f, cancelRequest, 409, 'branch_redirect_required')
    assert.deepEqual(asked.extra, { redirect: { addressed_branch_id: 2, addressed_branch_name: 'Old Shop', successor_branch_id: 1, successor_branch_name: 'LC Store', targets: [{ id: 1, name: 'LC Store' }], requested_target_id: null } },
      'the refusal carries what the client asks: the disabled branch, its successor and the valid targets')
    await refused(fresh, f, cancelRequest, 409, 'branch_redirect_target_invalid', 2)
    const cancelled = await fresh.applyReturnBulkActionOutcome(f.env, admin, cancelRequest, 1)
    assert.equal(cancelled.wrote, true)
    const cancelledStock = { ...before, lot1AtStore: 14, store: 14, product: 14 }
    assert.deepEqual(stockOf(f), cancelledStock, 'the units come out of LC Store lot 1; Old Shop and lot 3 are untouched')
    assert.deepEqual(movements(f), [{ movement_type: 'return_reversal', branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: -2, batch_id: 1 }])
    const header = f.sql.prepare('SELECT branch_id, branch_name FROM returns WHERE id=10').get()
    assert.deepEqual({ ...header }, { branch_id: 2, branch_name: 'Shop' }, 'the return keeps its own branch and label')
    assert.deepEqual({ ...f.sql.prepare('SELECT branch_id, batch_id FROM return_items WHERE id=10').get() }, { branch_id: 2, batch_id: 3 }, 'the recorded line is never rewritten')
    const settled = state(f)
    const again = await fresh.applyReturnBulkActionOutcome(f.env, admin, cancelRequest, 1)
    assert.equal(again.wrote, false, 'the same request id replays')
    assert.equal(state(f), settled, 'a replay writes nothing')
    await replay(fresh, f, cancelled.receipt, 'undo', 0)
    assert.deepEqual(stockOf(f), before, 'undo restores exactly the units that were removed, at the same lot')
    await replay(fresh, f, cancelled.receipt, 'redo', 1)
    assert.deepEqual(stockOf(f), cancelledStock, 'redo removes them once more')
    await replay(fresh, f, cancelled.receipt, 'undo', 2)
    const restored = await fresh.applyReturnBulkActionOutcome(f.env, admin, request(f, 'completed', 'cancelled', 'cancel-2'), 1)
    assert.equal(restored.wrote, true)
    await refused(fresh, f, request(f, 'cancelled', 'completed', 'restore-1'), 409, 'branch_redirect_required')
    const back = await fresh.applyReturnBulkActionOutcome(f.env, admin, request(f, 'cancelled', 'completed', 'restore-1'), 1)
    assert.equal(back.wrote, true)
    assert.deepEqual(stockOf(f), before, 'cancel then restore nets to zero at LC Store, none at Old Shop')
    assert.deepEqual(movements(f).slice(-1), [{ movement_type: 'return', branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Shop', quantity: 2, batch_id: 1 }])
  })

  await check('a retired branch with no successor refuses 409 with nothing written; a damaged line refuses 409', async () => {
    const orphan = fixture('orphan')
    const askedOrphan = await refused(fresh, orphan, request(orphan, 'completed', 'cancelled', 'orphan-1'), 409, 'branch_redirect_required')
    assert.equal(askedOrphan.extra.redirect.successor_branch_id, null, 'no successor: asked with no default')
    orphan.sql.exec("UPDATE branches SET is_active=0 WHERE id=1")
    await refused(fresh, orphan, request(orphan, 'completed', 'cancelled', 'orphan-1'), 409, 'branch_retired_no_successor', 1)
    const damaged = fixture('after', { damaged: true })
    await refused(fresh, damaged, request(damaged, 'completed', 'cancelled', 'damaged-1'), 409, 'branch_retired_damaged_stock', 1)
  })

  await check('F4 a held unit the cutover moved to LC Store: cancelling and restoring the old Shop damaged return succeeds and lands at LC Store; a held unit still at Old Shop keeps refusing', async () => {
    const lotAt = (f, branch) => f.sql.prepare("INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,return_id,quantity,quantity_remaining,reason) VALUES(1,1,'A',?,10,2,2,'damaged')").run(branch)
    const stillThere = fixture('after', { damaged: true }); lotAt(stillThere, 2)
    await refused(fresh, stillThere, request(stillThere, 'completed', 'cancelled', 'held-old'), 409, 'branch_retired_damaged_stock', 1)
    assert.equal(stillThere.sql.prepare('SELECT quantity_remaining q FROM damaged_stock_lots WHERE id=1').get().q, 2, 'nothing written')
    const moved = fixture('after', { damaged: true }); lotAt(moved, 1)
    const cancelled = await fresh.applyReturnBulkActionOutcome(moved.env, admin, request(moved, 'completed', 'cancelled', 'held-cancel'), 1)
    assert.equal(cancelled.wrote, true)
    assert.deepEqual({ ...moved.sql.prepare('SELECT branch_id b, quantity_remaining q FROM damaged_stock_lots WHERE id=1').get() }, { b: 1, q: 0 }, 'the held unit is consumed at LC Store')
    assert.ok(moved.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE branch_id=1 AND product_id=1").get().n >= 1, 'the movement is at LC Store')
    assert.equal(moved.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE branch_id=2").get().n, 0, 'nothing at Old Shop')
    const back = await fresh.applyReturnBulkActionOutcome(moved.env, admin, request(moved, 'cancelled', 'completed', 'held-restore'), 1)
    assert.equal(back.wrote, true)
    assert.equal(moved.sql.prepare('SELECT quantity_remaining q FROM damaged_stock_lots WHERE id=1').get().q, 2, 'restore gives the held unit back at LC Store')
  })

  await check('INERT while both branches are active: the grouped action writes the exact statements and ledgers the old kernel wrote', async () => {
    for (const [name, run] of [
      ['cancel', async (kernel, f) => kernel.applyReturnBulkActionOutcome(f.env, admin, request(f, 'completed', 'cancelled', 'inert-cancel'))],
      // A stray confirmed branch while every branch is active is never read (the old kernel takes no such argument).
      ['cancel with a redirect', async (kernel, f) => kernel.applyReturnBulkActionOutcome(f.env, admin, request(f, 'completed', 'cancelled', 'inert-cancel'), 1)],
      ['cancel then restore', async (kernel, f) => {
        await kernel.applyReturnBulkActionOutcome(f.env, admin, request(f, 'completed', 'cancelled', 'inert-cancel'))
        return kernel.applyReturnBulkActionOutcome(f.env, admin, request(f, 'cancelled', 'completed', 'inert-restore'))
      }],
    ]) {
      const a = fixture('before'); const b = fixture('before')
      await run(fresh, a); await run(old, b)
      const statementsA = scrub(JSON.stringify(a.capture)); const statementsB = scrub(JSON.stringify(b.capture))
      let at = 0
      while (at < statementsA.length && statementsA[at] === statementsB[at]) at++
      assert.equal(statementsA === statementsB, true, `${name}: byte-identical statements; first difference near ${statementsA.slice(Math.max(0, at - 120), at + 120)} <> ${statementsB.slice(Math.max(0, at - 120), at + 120)}`)
      assert.equal(scrub(state(a)), scrub(state(b)), `${name}: identical ledgers`)
      assert.equal(a.sql.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE addressed_branch_name IS NOT NULL').get().n, 0, `${name}: no provenance label while both branches are active`)
      assert.equal(stockOf(a).lot3AtOld, name.startsWith('cancel') && !name.includes('restore') ? 4 : 6, `${name}: stock moves at the return's own branch and lot`)
    }
  })

  console.log(`${passed} grouped return retired-branch checks passed`)
})().catch((error) => { console.error(error); process.exit(1) })
