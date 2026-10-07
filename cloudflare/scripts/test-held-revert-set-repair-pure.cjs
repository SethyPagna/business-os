// REVERT-SET held repair (ops/scripts/migration/held/revert_set_sk2_cleanser_repair.sql):
// the production rows of SK-II Gentle Cleanser 20g as read on 6 Oct 2026 (run
// 37423173566), the held file applied on the real migration chain, and the
// result read back through the APP's own paths -- History Redo/Undo of the Set
// (lib/stockLotAdjustment.ts) and the ledger Revert (lib/stockRevert.ts) -- not
// a re-derivation of the file's own WHERE clauses.
//
// Owner ruling (6 Oct 2026 22:50): delivery back, the Set's +27 fully
// reverted, then the 3 left on the 02/09 slot removed -- the only loss. End:
// lot 56725 0, lot 61482 30 ($210 purchase), Shop 30.
//
// Lot 56725 is given cost $5 here (production: $7 on both lots) so the 0195
// catalog-cost triggers and the loss figure tell the right lot from the wrong
// one: the end cost is 7 (only the delivery on hand) and the loss 3 x 5 = 15;
// a Remove from the delivery would read cost 6.8 and a loss of 21.
//
// STOCK_LOT_TEST_ROOT=<dir containing src/> runs the app's own steps against
// another tree -- the live build 4ab47676 -- while the held file and the
// migration chain stay this tree's.
//
// Run (from cloudflare/): node scripts/test-held-revert-set-repair-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { Hono } = require('hono')
const { fixture, user } = require('./test-stock-session-atomic.cjs')

const root = process.env.STOCK_LOT_TEST_ROOT || path.join(__dirname, '..')
const heldFile = path.join(__dirname, '..', '..', 'ops', 'scripts', 'migration', 'held', 'revert_set_sk2_cleanser_repair.sql')
const repairSql = fs.readFileSync(heldFile, 'utf8')

function loader() {
  const cache = new Map()
  const load = (relativeFile) => {
    const normalized = relativeFile.replaceAll('\\', '/')
    if (cache.has(normalized)) return cache.get(normalized).exports
    const file = path.join(root, 'src', normalized)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    const mod = { exports: {} }
    cache.set(normalized, mod)
    const req = (name) => {
      if (name === '../lib/auth' || name === './auth') return {
        requireAuth: async (c, next) => { c.set('user', user); await next() },
      }
      if (name === './cache' || name === '../lib/cache') return { bumpVersion: async () => {}, getVersion: async () => 0, cacheKey: (...a) => a.join(':'), cachedJson: async (c, k, t, fn) => c.json(await fn()) }
      if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
      if (name === './telegram' || name === '../lib/telegram') return { sendTelegramEvent: async () => {}, formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [] }
      if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(normalized), `${name.slice(2)}.ts`))
      if (name.startsWith('../')) return load(path.posix.join(path.posix.dirname(normalized), `${name}.ts`))
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load
}
const load = loader()
const lotSet = load('lib/stockLotAdjustment.ts')
const ledger = load('lib/stockRevert.ts')
const losses = load('lib/removalLosses.ts')
const { getDb } = load('lib/db.ts')
const app = new Hono()
app.route('/api/inventory', load('routes/inventory.ts').default)
app.route('/api/action-history', load('routes/actionHistory.ts').default)
async function send(f, method, url, body) {
  const res = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    f.env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}) } })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
// The owner's three steps, each through the app's own route (what the buttons call).
const step1 = (f) => send(f, 'POST', '/api/inventory/movements/48197/revert')
const step2 = (f) => send(f, 'POST', '/api/action-history/1318/undo', { expected_generation: 0, require_applied: true })
const step3 = (f) => send(f, 'POST', '/api/inventory/adjust', { type: 'remove', productId: 5357, branchId: 2, batchId: 56725, quantity: 3, reason: 'Stock count: received 02/09/2026 holds 0', client_request_id: 'owner-remove-0003' })

const OP = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a'

function production() {
  lotSet.resetStockLotSetSchemaProbe()
  const f = fixture()
  const before = { productId: 5357, branchId: 2, batchId: 56725, lotQuantity: 3, branchQuantity: 33, lotExists: 1, branchExists: 1 }
  const after = { ...before, lotQuantity: 30, branchQuantity: 60 }
  const request = { productId: 5357, branchId: 2, batchId: 56725, quantity: 30, setScope: 'lot', reason: 'wrong stock', conditionTag: null, expectedLotQuantity: 3 }
  const payload = JSON.stringify({ applier: 'stock.quantity_set', operation_id: OP, generation: 0 })
  f.sql.prepare(`UPDATE branches SET name='Warehouse' WHERE id=1`).run()
  f.sql.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(2, 'Shop', 0, 1);
    INSERT INTO suppliers(id, name) VALUES(19, 'Dane japan');
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active) VALUES(5357, 'SK-II Gentle Cleanser 20g', '0', 5, 0, 30, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(5357, 1, 0), (5357, 2, 30);
    INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active, received_quantity, received_cost_usd, received_branch_id)
      VALUES(56725, 5357, 'latest-data-20260902-v1:c0cb', 'ADJ09/02/2026', '2026-09-02T15:30:00.000Z', 3, 5, 1, 3, 15, NULL);
    INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active, received_quantity, received_cost_usd, received_branch_id, supplier_id, supplier_name, payment_status)
      VALUES(61482, 5357, ' receipt:2026-09-29:cost:7:after:0', '09292026', '2026-09-29', 4, 7, 0, 0, 0, 2, 19, 'Dane japan', 'paid');
    INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES(56725, 1, 0), (56725, 2, 30), (61482, 2, 0);
    INSERT INTO inventory_movements(id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, reference_id, user_id, user_name, created_at, batch_id) VALUES
      (36930, 5357, 'SK-II Gentle Cleanser 20g', 2, 'Shop', 'add', 3, 0, 0, 'Unified stock import', NULL, NULL, NULL, '2025-10-05', NULL),
      (48026, 5357, 'SK-II Gentle Cleanser 20g', 2, 'Shop', 'add', 30, 7, 210, 'New arrival', 1790667050013, 1, 'admin', '2026-09-29 07:33:05', 61482),
      (48034, 5357, 'SK-II Gentle Cleanser 20g', 2, 'Shop', 'adjustment', 27, 7, 189, 'wrong stock (Set received date to 30)', 'stock-set:${OP}:0', 1, 'admin', '2026-09-30 01:44:02', 56725),
      (48197, 5357, 'SK-II Gentle Cleanser 20g', 2, 'Shop', 'remove', 30, 7, 210, 'Revert of #48026: New arrival', 'revert:48026', 1, 'admin', '2026-10-01 14:35:45', 61482);
  `)
  f.sql.prepare(`INSERT INTO action_history(id, scope, entity, entity_id, label, reversible, status, undo_payload, redo_payload, created_by_id, created_by_name)
    VALUES(1318, 'inventory', 'stock_quantity_set', '5357.0', 'Set SK-II Gentle Cleanser 20g received 2026-09-02 to 30', 1, 'undoable', ?, ?, ?, 'admin')`).run(payload, payload, user.id)
  f.sql.prepare(`INSERT INTO stock_lot_adjustment_operations(id, actor_id, request_id, request_json, request_digest, response_json, before_json, after_json, revision_json, history_id, generation, state)
    VALUES(?, ?, 'req-1', ?, 'digest', '{}', ?, ?, ?, 1318, 0, 'applied')`)
    .run(OP, user.id, JSON.stringify(request), JSON.stringify(before), JSON.stringify(after), JSON.stringify({ generation: 0, unitCostUsd: 7 }))
  // The 0195 triggers derive the cost of the state as seeded.
  f.sql.prepare(`UPDATE branch_batch_stock SET quantity=quantity WHERE batch_id=56725 AND branch_id=2`).run()
  return f
}

const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args)
function shop(f) {
  return {
    adj: one(f, 'SELECT quantity q FROM branch_batch_stock WHERE batch_id=56725 AND branch_id=2').q,
    delivery: one(f, 'SELECT quantity q FROM branch_batch_stock WHERE batch_id=61482 AND branch_id=2').q,
    branch: one(f, 'SELECT quantity q FROM branch_stock WHERE product_id=5357 AND branch_id=2').q,
    product: one(f, 'SELECT stock_quantity q FROM products WHERE id=5357').q,
    cost: one(f, 'SELECT cost_price_usd q FROM products WHERE id=5357').q,
  }
}
const receipt = (f) => one(f, 'SELECT received_quantity, received_cost_usd, is_active, supplier_name, payment_status FROM product_batches WHERE id=61482')
const setState = (f) => ({ ...one(f, 'SELECT generation, state FROM stock_lot_adjustment_operations WHERE id=?', OP), status: one(f, 'SELECT status FROM action_history WHERE id=1318').status })
const tables = ['products', 'branch_stock', 'branch_batch_stock', 'product_batches', 'inventory_movements', 'action_history', 'stock_lot_adjustment_operations', 'audit_logs']
const snapshot = (f) => JSON.stringify(tables.map((t) => f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))
const payloadOf = (f) => JSON.parse(one(f, 'SELECT undo_payload p FROM action_history WHERE id=1318').p)
const movement = (f, id) => one(f, `SELECT id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, unit_cost_khr,
  total_cost_usd, total_cost_khr, reason, reference_id, batch_id FROM inventory_movements WHERE id=?`, id)
// The loss figure as every report reads it (lib/removalLosses.ts SQL + reducer).
const loss = (f) => losses.summarizeRemovalLosses(f.sql.prepare(`SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM}
  WHERE m.product_id = 5357 AND ${losses.removalLossMovementWhere('m')}`).all())
const removeRow = (f) => one(f, `SELECT movement_type, quantity, batch_id, unit_cost_usd, total_cost_usd, reference_id FROM inventory_movements
  WHERE product_id=5357 AND movement_type='remove' AND reference_id IS NULL ORDER BY id DESC LIMIT 1`)
const END = { adj: 0, delivery: 30, branch: 30, product: 30, cost: 7 }
const END_RECEIPT = { received_quantity: 30, received_cost_usd: 210, is_active: 1, supplier_name: 'Dane japan', payment_status: 'paid' }
const END_LOSS = { removal_loss_usd: 15, removal_loss_qty: 3, removal_loss_unvalued_rows: 0 }

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n`, error) }
}

async function main() {
  await check('the held file is LF-only, held, and not in the migration chain', async () => {
    assert.ok(!repairSql.includes('\r'), 'LF-only')
    assert.ok(!fs.readdirSync(path.join(__dirname, '..', 'migrations')).some((name) => name.includes('revert_set')), 'never in cloudflare/migrations')
  })

  await check('production state: the fixture reads as production did (Shop 30, delivery un-received, Set still undoable)', async () => {
    const f = production()
    assert.deepEqual(shop(f), { adj: 30, delivery: 0, branch: 30, product: 30, cost: 5 })
    assert.deepEqual(setState(f), { generation: 0, state: 'applied', status: 'undoable' })
  })

  await check('apply on the production state: three compensating records -> delivery 30 (a purchase again), the 02/09 slot 0, Shop 30, loss only the 3', async () => {
    const f = production()
    const movementsBefore = one(f, 'SELECT COUNT(*) n FROM inventory_movements').n
    assert.deepEqual(loss(f), { removal_loss_usd: 0, removal_loss_qty: 0, removal_loss_unvalued_rows: 0 }, 'no loss before: the wrong Revert is not one')
    f.sql.exec(repairSql)
    assert.deepEqual(shop(f), END)
    assert.deepEqual(receipt(f), END_RECEIPT)
    assert.deepEqual(setState(f), { generation: 1, state: 'reversed', status: 'redoable' })
    assert.equal(one(f, 'SELECT COUNT(*) n FROM inventory_movements').n, movementsBefore + 3, 'three new rows; nothing deleted or rewritten')
    const a = one(f, "SELECT movement_type, quantity, batch_id, total_cost_usd, reason FROM inventory_movements WHERE reference_id='revert:48197'")
    assert.deepEqual(a, { movement_type: 'add', quantity: 30, batch_id: 61482, total_cost_usd: 210, reason: 'Revert of #48197: Revert of #48026: New arrival' })
    const b = one(f, "SELECT movement_type, quantity, batch_id, total_cost_usd FROM inventory_movements WHERE reference_id='revert:48034'")
    assert.deepEqual(b, { movement_type: 'remove', quantity: 27, batch_id: 56725, total_cost_usd: 189 })
    assert.deepEqual(removeRow(f), { movement_type: 'remove', quantity: 3, batch_id: 56725, unit_cost_usd: 5, total_cost_usd: 15, reference_id: null })
    assert.deepEqual(loss(f), END_LOSS, 'the loss every report reads: only the 3, at their lot cost (production: 3 x $7 = $21)')
    assert.equal(one(f, 'SELECT received_quantity q FROM product_batches WHERE id=56725').q, 3, 'a loss is not an un-receive')
    const audit = JSON.parse(one(f, "SELECT details d FROM audit_logs WHERE action='stock_revert_repair' AND entity_id='5357'").d)
    assert.deepEqual([audit.reverted, audit.removed], [[48197, 48034], { lot: 56725, quantity: 3, loss_usd: 15 }])
    assert.ok(one(f, "SELECT value FROM revert_set_repair_20261006 WHERE key='backup:branch_batch_stock:56725:2'").value.includes('"quantity":30'), 'backup keeps the pre-repair figure')
    assert.equal(one(f, "SELECT COUNT(*) n FROM revert_set_repair_20261006 WHERE key IN ('apply_now','apply_remove')").n, 0)
    assert.equal(one(f, 'SELECT COUNT(*) n FROM stock_session_guards').n, 0)
  })

  await check('idempotent: a second run writes nothing', async () => {
    const f = production()
    f.sql.exec(repairSql)
    const once = snapshot(f)
    f.sql.exec(repairSql)
    assert.equal(snapshot(f), once)
  })

  await check("the owner's three steps in the app on the production rows reach the same end state; the file is then a no-op", async () => {
    const f = production()
    const r1 = await step1(f)
    assert.equal(r1.status, 200, JSON.stringify(r1.json))
    assert.deepEqual(shop(f), { adj: 30, delivery: 30, branch: 60, product: 60, cost: 6 })
    const r2 = await step2(f)
    assert.equal(r2.status, 200, JSON.stringify(r2.json))
    assert.deepEqual(shop(f), { adj: 3, delivery: 30, branch: 33, product: 33, cost: 6.8182 })
    const r3 = await step3(f)
    assert.equal(r3.status, 200, JSON.stringify(r3.json))
    assert.deepEqual(shop(f), END)
    assert.deepEqual(receipt(f), END_RECEIPT)
    assert.deepEqual(setState(f), { generation: 1, state: 'reversed', status: 'redoable' })
    assert.deepEqual(loss(f), END_LOSS)
    // The file writes the same Remove row the app writes.
    assert.deepEqual(removeRow(f), { movement_type: 'remove', quantity: 3, batch_id: 56725, unit_cost_usd: 5, total_cost_usd: 15, reference_id: null })
    const before = snapshot(f)
    f.sql.exec(repairSql)
    assert.equal(snapshot(f), before)
  })

  await check('steps 1-2 done in the app: the file adds the Remove only -> the same end state', async () => {
    const f = production()
    assert.equal((await step1(f)).status, 200)
    assert.equal((await step2(f)).status, 200)
    const movementsBefore = one(f, 'SELECT COUNT(*) n FROM inventory_movements').n
    f.sql.exec(repairSql)
    assert.deepEqual(shop(f), END)
    assert.deepEqual(receipt(f), END_RECEIPT)
    assert.deepEqual(loss(f), END_LOSS)
    assert.equal(one(f, 'SELECT COUNT(*) n FROM inventory_movements').n, movementsBefore + 1)
    assert.deepEqual(JSON.parse(one(f, "SELECT details d FROM audit_logs WHERE action='stock_revert_repair'").d).reverted, [])
    const once = snapshot(f)
    f.sql.exec(repairSql)
    assert.equal(snapshot(f), once, 'and a re-run writes nothing')
  })

  await check('only step 1 done, or a sale since: the file aborts before any write', async () => {
    const prepares = [
      async (f) => { assert.equal((await step1(f)).status, 200) },
      async (f) => f.sql.exec(`UPDATE branch_batch_stock SET quantity=29 WHERE batch_id=56725 AND branch_id=2;
        UPDATE branch_stock SET quantity=29 WHERE product_id=5357 AND branch_id=2; UPDATE products SET stock_quantity=29 WHERE id=5357;
        INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, batch_id) VALUES(5357, 2, 'sale', 1, 56725);`),
    ]
    for (const prepare of prepares) {
      const f = production()
      await prepare(f)
      const before = snapshot(f)
      assert.throws(() => f.sql.exec(repairSql), /CHECK constraint failed/)
      assert.equal(snapshot(f), before)
      assert.equal(one(f, "SELECT COUNT(*) n FROM sqlite_master WHERE name='revert_set_repair_20261006'").n, 0, 'nothing created either')
    }
  })

  await check('every step stays reversible in the app after the file: Revert the Remove, Redo the Set, Revert the delivery Revert', async () => {
    const f = production()
    f.sql.exec(repairSql)
    const db = getDb(f.env)
    const removeId = one(f, "SELECT id FROM inventory_movements WHERE product_id=5357 AND movement_type='remove' AND reference_id IS NULL ORDER BY id DESC LIMIT 1").id
    const back = await ledger.applyMovementRevert(db, movement(f, removeId), { userId: user.id, userName: 'test' })
    assert.equal(back.ok, true, JSON.stringify(back))
    assert.deepEqual(shop(f), { adj: 3, delivery: 30, branch: 33, product: 33, cost: 6.8182 }, 'the 3 come back on their lot')
    assert.deepEqual(loss(f), { removal_loss_usd: 0, removal_loss_qty: 0, removal_loss_unvalued_rows: 0 }, 'and the loss is cancelled')
    await lotSet.replayStockLotSet(f.env, user, 'redo', 1318, 1, payloadOf(f))
    assert.deepEqual(shop(f), { adj: 30, delivery: 30, branch: 60, product: 60, cost: 6 }, 'Redo re-applies exactly +27')
    const repairRow = one(f, "SELECT id FROM inventory_movements WHERE reference_id='revert:48197'").id
    const result = await ledger.applyMovementRevert(db, movement(f, repairRow), { userId: user.id, userName: 'test' })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(shop(f), { adj: 30, delivery: 0, branch: 30, product: 30, cost: 5 }, 'back to the production state of 1 Oct')
    assert.deepEqual(receipt(f), { received_quantity: 0, received_cost_usd: 0, is_active: 0, supplier_name: 'Dane japan', payment_status: 'paid' })
  })

  await check('the read-only dry run names the state and the planned loss in every case', async () => {
    const dry = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'queries', 'revert-set-repair-dryrun.sql'), 'utf8')
    const read = (f) => { const row = f.sql.prepare(dry).get(); return [row.state, row.planned_loss_usd] }
    const f = production()
    assert.deepEqual(read(f), ['pre', 15])
    assert.equal((await step1(f)).status, 200)
    assert.deepEqual(read(f)[0], 'stale', 'step 1 alone: the file would abort')
    assert.equal((await step2(f)).status, 200)
    assert.deepEqual(read(f), ['ab', 15])
    f.sql.exec(repairSql)
    assert.deepEqual(read(f), ['done', 15])
    assert.ok(/^s*WITH /m.test(dry.replace(/--.*$/gm, '')) && !/(INSERT|UPDATE|DELETE|REPLACE|DROP|CREATE)/i.test(dry.replace(/--.*$/gm, '')), 'one read-only statement')
  })

  if (failures.length) { console.error(`\n${failures.length} failed`); process.exitCode = 1 } else console.log('test-held-revert-set-repair-pure: all checks passed')
}
main()
