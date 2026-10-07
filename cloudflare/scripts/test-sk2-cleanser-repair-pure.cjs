// SK2-REPAIR (owner, 7 Oct 2026: "i want you to do it for me. with the cut over. backend."): the backend repair of
// SK-II Gentle Cleanser 20g (product 5357, Shop = branch 2), run by the cutover operator action `repair-sk2`
// (lib/sk2CleanserRepair.ts through lib/branchCutoverOperator.ts) on the real migration chain, with the production
// rows as read from the 7 Oct prod copy. The result is read back through the APP's own paths -- the ledger Revert
// (lib/stockRevert.ts), the History Redo of the Set (lib/stockLotAdjustment.ts) and the loss reader every report uses
// (lib/removalLosses.ts) -- not through the repair's own WHERE clauses.
//
// Owner ruling (6 Oct 2026 22:50): the delivery back (30, $210), the Set's +27 fully reverted (slot back to 3), then
// the 3 removed from the 02/09 slot as a formal loss -- the only loss. End: lot 56725 0, lot 61482 30, Shop 30.
//
// Lot 56725 costs $5 here (production: $7 on both lots) so the catalog cost and the loss tell the right lot from the
// wrong one: the end cost is 7 (only the delivery on hand) and the loss 3 x 5 = 15.
//
// Discriminating controls: the plausible wrong repair that removes 30 (the whole slot, or the delivery again) is run
// through the same batch and must be refused by the post-assertion with nothing written; a sale since, a wrong actor,
// a begun cutover, a concurrent change and a lost acknowledgement are each covered.
//
// Run (from cloudflare/): node scripts/test-sk2-cleanser-repair-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { Hono } = require('hono')
const { fixture, user } = require('./test-stock-session-atomic.cjs')

const root = path.join(__dirname, '..')
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
      if (name === '../lib/auth' || name === './auth') return { requireAuth: async (c, next) => { c.set('user', user); await next() } }
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
const losses = load('lib/removalLosses.ts')
const repair = load('lib/sk2CleanserRepair.ts')
const operator = load('lib/branchCutoverOperator.ts')
const { getDb } = load('lib/db.ts')
const app = new Hono()
app.route('/api/inventory', load('routes/inventory.ts').default)
app.route('/api/action-history', load('routes/actionHistory.ts').default)
async function send(f, method, url, body) {
  const res = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    f.env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}) } })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const OP = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a'
// The production rows (prod copy 7 Oct 2026), lot 56725's cost aside (see the header).
function production() {
  lotSet.resetStockLotSetSchemaProbe()
  const f = fixture()
  const before = { productId: 5357, branchId: 2, batchId: 56725, lotQuantity: 3, branchQuantity: 33, lotExists: 1, branchExists: 1 }
  const after = { ...before, lotQuantity: 30, branchQuantity: 60 }
  const request = { productId: 5357, branchId: 2, batchId: 56725, quantity: 30, setScope: 'lot', reason: 'wrong stock', conditionTag: null, expectedLotQuantity: 3 }
  const payload = JSON.stringify({ applier: 'stock.quantity_set', operation_id: OP, generation: 0 })
  f.sql.prepare(`UPDATE branches SET name='Warehouse' WHERE id=1`).run()
  f.sql.exec(`
    INSERT INTO roles(id, name, code, permissions) VALUES(1, 'Admin', 'admin', '{"all":true}');
    INSERT INTO users(id, username, name, password, role_id, permissions, is_active, organization_id) VALUES
      (1, 'admin', 'Admin', 'x', 1, '{}', 1, 1), (5, 'sethyka', 'UNG Sethyka', 'x', 1, '{}', 1, 1);
    INSERT INTO branches(id, name, is_default, is_active) VALUES(2, 'Shop', 0, 1);
    INSERT INTO suppliers(id, name) VALUES(19, 'Dane japan');
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, stock_quantity, is_active) VALUES(5357, 'SK-II Gentle Cleanser 20g', '0', 5, 0, 10, 30, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(5357, 1, 0), (5357, 2, 30);
    INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active, received_quantity, received_cost_usd, received_branch_id, payment_status)
      VALUES(56725, 5357, 'latest-data-20260902-v1:c0cb', 'ADJ09/02/2026', '2026-09-02T15:30:00.000Z', 3, 5, 1, 3, 15, NULL, 'paid');
    INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active, received_quantity, received_cost_usd, received_branch_id, supplier_id, supplier_name, payment_status)
      VALUES(61482, 5357, ' receipt:2026-09-29:cost:7:after:0', '09292026', '2026-09-29', 4, 7, 0, 0, 0, 2, 19, 'Dane japan', 'paid');
    INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active, received_quantity, received_cost_usd, received_branch_id)
      VALUES(43614, 5357, 'import-20251005', '10052025', '2025-10-05', 2, 7, 1, 3, 21, 2);
    INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES(56725, 1, 0), (56725, 2, 30), (61482, 2, 0), (43614, 2, 0);
    INSERT INTO inventory_movements(id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name, created_at, batch_id) VALUES
      (36930, 5357, 'SK-II Gentle Cleanser 20g', 2, 'Shop', 'add', 3, 0, NULL, 0, NULL, 'Unified stock import', NULL, NULL, NULL, '2025-10-05', NULL),
      (48026, 5357, 'SK-II Gentle Cleanser 20g', 2, 'Shop', 'add', 30, 7, 0, 210, 0, 'New arrival', 1790667050013, 1, 'admin', '2026-09-29 07:33:05', 61482),
      (48034, 5357, 'SK-II Gentle Cleanser 20g', 2, 'Shop', 'adjustment', 27, 7, NULL, 189, NULL, 'wrong stock (Set received date to 30)', 'stock-set:${OP}:0', 1, 'admin', '2026-09-30 01:44:02', 56725),
      (48197, 5357, 'SK-II Gentle Cleanser 20g', 2, 'Shop', 'remove', 30, 7, 0, 210, 0, 'Revert of #48026: New arrival', 'revert:48026', 1, 'admin', '2026-10-01 14:35:45', 61482);
  `)
  f.sql.prepare(`INSERT INTO action_history(id, scope, entity, entity_id, label, reversible, status, undo_payload, redo_payload, created_by_id, created_by_name)
    VALUES(1318, 'inventory', 'stock_quantity_set', '5357.0', 'Set SK-II Gentle Cleanser 20g received 2026-09-02 to 30', 1, 'undoable', ?, ?, ?, 'admin')`).run(payload, payload, user.id)
  f.sql.prepare(`INSERT INTO stock_lot_adjustment_operations(id, actor_id, request_id, request_json, request_digest, response_json, before_json, after_json, revision_json, history_id, generation, state)
    VALUES(?, ?, 'req-1', ?, 'digest', '{}', ?, ?, ?, 1318, 0, 'applied')`)
    .run(OP, user.id, JSON.stringify(request), JSON.stringify(before), JSON.stringify(after), JSON.stringify({ generation: 0, unitCostUsd: 7 }))
  f.sql.prepare(`UPDATE branch_batch_stock SET quantity=quantity WHERE batch_id=56725 AND branch_id=2`).run()
  return f
}

const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args)
const shop = (f) => ({
  slot: one(f, 'SELECT quantity q FROM branch_batch_stock WHERE batch_id=56725 AND branch_id=2').q,
  delivery: one(f, 'SELECT quantity q FROM branch_batch_stock WHERE batch_id=61482 AND branch_id=2').q,
  branch: one(f, 'SELECT quantity q FROM branch_stock WHERE product_id=5357 AND branch_id=2').q,
  product: one(f, 'SELECT stock_quantity q FROM products WHERE id=5357').q,
  cost: one(f, 'SELECT cost_price_usd q FROM products WHERE id=5357').q,
})
const receipt = (f) => one(f, 'SELECT received_quantity, received_cost_usd, is_active, supplier_name, payment_status FROM product_batches WHERE id=61482')
const setState = (f) => ({ ...one(f, 'SELECT generation, state FROM stock_lot_adjustment_operations WHERE id=?', OP), status: one(f, 'SELECT status FROM action_history WHERE id=1318').status })
const tables = ['products', 'branch_stock', 'branch_batch_stock', 'product_batches', 'inventory_movements', 'action_history', 'stock_lot_adjustment_operations', 'audit_logs', 'stock_session_guards']
const snapshot = (f) => JSON.stringify(tables.map((t) => f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))
const loss = (f) => losses.summarizeRemovalLosses(f.sql.prepare(`SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM}
  WHERE m.product_id = 5357 AND ${losses.removalLossMovementWhere('m')}`).all())
const newRows = (f) => f.sql.prepare(`SELECT movement_type, quantity, batch_id, unit_cost_usd, total_cost_usd, reference_id, user_id, user_name
  FROM inventory_movements WHERE product_id=5357 AND id > 48197 ORDER BY id`).all()
const repairOp = (f, body = {}) => operator.runBranchCutoverOperatorAction(f.env, 'repair-sk2', { actorUserId: 5, ...body })

const PRE = { slot: 30, delivery: 0, branch: 30, product: 30, cost: 5 }
const END = { slot: 0, delivery: 30, branch: 30, product: 30, cost: 7 }
const END_RECEIPT = { received_quantity: 30, received_cost_usd: 210, is_active: 1, supplier_name: 'Dane japan', payment_status: 'paid' }
const END_LOSS = { removal_loss_usd: 15, removal_loss_qty: 3, removal_loss_unvalued_rows: 0 }
const END_ROWS = [
  { movement_type: 'add', quantity: 30, batch_id: 61482, unit_cost_usd: 7, total_cost_usd: 210, reference_id: 'revert:48197', user_id: 5, user_name: 'sethyka' },
  { movement_type: 'remove', quantity: 27, batch_id: 56725, unit_cost_usd: 7, total_cost_usd: 189, reference_id: 'revert:48034', user_id: 5, user_name: 'sethyka' },
  { movement_type: 'remove', quantity: 3, batch_id: 56725, unit_cost_usd: 5, total_cost_usd: 15, reference_id: null, user_id: 5, user_name: 'sethyka' },
]

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n`, error) }
}

async function main() {
  await check('the operator offers repair-sk2 and the fixture reads as production did', async () => {
    assert.ok(operator.BRANCH_CUTOVER_OPERATOR_ACTIONS.includes('repair-sk2'))
    const f = production()
    assert.deepEqual(shop(f), PRE)
    assert.deepEqual(setState(f), { generation: 0, state: 'applied', status: 'undoable' })
    assert.equal((await repair.readSk2State(getDb(f.env))).state, 'pre')
  })

  await check('dry run: reads state pre and the planned loss (3 x the slot cost), writes nothing', async () => {
    const f = production()
    const before = snapshot(f)
    const out = await repairOp(f, { dryRun: true })
    assert.equal(out.status, 200, JSON.stringify(out.body))
    assert.deepEqual([out.body.state, out.body.plannedLossUsd], ['pre', 15])
    assert.equal(snapshot(f), before)
  })

  await check('apply: three compensating records by user 5 -> delivery 30 ($210 purchase again), slot 0, Shop 30, catalog cost 7, loss only the 3', async () => {
    const f = production()
    const count = one(f, 'SELECT COUNT(*) n FROM inventory_movements').n
    assert.deepEqual(loss(f), { removal_loss_usd: 0, removal_loss_qty: 0, removal_loss_unvalued_rows: 0 })
    const out = await repairOp(f)
    assert.equal(out.status, 200, JSON.stringify(out.body))
    assert.deepEqual([out.body.ok, out.body.applied, out.body.from, out.body.state], [true, true, 'pre', 'done'])
    assert.deepEqual(shop(f), END)
    assert.deepEqual(receipt(f), END_RECEIPT)
    assert.deepEqual(setState(f), { generation: 1, state: 'reversed', status: 'redoable' })
    assert.deepEqual(newRows(f), END_ROWS)
    assert.equal(one(f, 'SELECT COUNT(*) n FROM inventory_movements').n, count + 3, 'nothing deleted or rewritten')
    for (const id of [36930, 48026, 48034, 48197]) assert.ok(one(f, 'SELECT id FROM inventory_movements WHERE id=?', id), `#${id} kept`)
    assert.deepEqual(loss(f), END_LOSS)
    assert.equal(one(f, 'SELECT received_quantity q FROM product_batches WHERE id=56725').q, 3, 'a loss is not an un-receive')
    assert.equal(one(f, 'SELECT selling_price_usd q FROM products WHERE id=5357').q, 10, 'the price is untouched')
    const audits = f.sql.prepare("SELECT user_id, user_name, action, details FROM audit_logs WHERE entity='product' AND entity_id='5357' ORDER BY id").all()
    assert.deepEqual(audits.map((a) => [a.action, a.user_id, a.user_name]), [['stock_revert_repair_before', 5, 'sethyka'], ['stock_revert_repair', 5, 'sethyka']])
    const before = JSON.parse(audits[0].details).before
    assert.deepEqual([before.branch_stock.quantity, before.products.stock_quantity, before.newest_movement], [30, 30, 48197], 'the before images are kept')
    const done = JSON.parse(audits[1].details)
    assert.deepEqual([done.reverted, done.removed, done.shop], [[48197, 48034], { lot: 56725, quantity: 3, loss_usd: 15 }, [30, 30]])
    assert.equal(one(f, 'SELECT COUNT(*) n FROM stock_session_guards').n, 0)
  })

  await check('the records appear on Stock Changes: each Revert names its row and each row says it was reverted', async () => {
    const f = production()
    await repairOp(f)
    const ledger = load('lib/stockLedgerQuery.ts')
    const q = ledger.buildStockLedgerQuery({ productId: 5357 })
    const rows = f.sql.prepare(q.rowsSql).all({ ...q.params, limit: 50, offset: 0 })
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    const ids = rows.map((r) => r.id)
    assert.equal(rows.length, 7)
    assert.equal(byId[48197].reverted_by_movement_id, Math.max(...ids.filter((id) => byId[id].reference_id === 'revert:48197')))
    assert.equal(byId[48034].reverted_by_movement_id, Math.max(...ids.filter((id) => byId[id].reference_id === 'revert:48034')))
    assert.deepEqual(rows.filter((r) => r.reverts_movement_id != null).map((r) => r.reverts_movement_id).sort(), [48026, 48034, 48197])
  })

  await check('double apply: a second run (and a third) writes nothing and answers done', async () => {
    const f = production()
    await repairOp(f)
    const once = snapshot(f)
    for (let i = 0; i < 2; i++) {
      const again = await repairOp(f)
      assert.equal(again.status, 200)
      assert.deepEqual([again.body.state, again.body.applied, again.body.replayed], ['done', false, true])
    }
    assert.equal(snapshot(f), once)
  })

  await check('lost acknowledgement: the batch committed but the answer was lost -> the retry reports done, never a second write', async () => {
    const f = production()
    f.loseNextCommitAcknowledgement()
    // db.batch retries a transient error; whichever layer sees the loss, the end state is applied exactly once.
    const out = await repairOp(f).catch((error) => ({ status: 'threw', body: { error: String(error) } }))
    if (out.status !== 200) {
      const retry = await repairOp(f)
      assert.equal(retry.status, 200, JSON.stringify(retry.body))
    }
    assert.deepEqual(shop(f), END)
    assert.equal(newRows(f).length, 3)
  })

  await check('reversible through the app afterwards: Revert of the Remove puts the 3 back and cancels the loss; History Redo re-applies the +27', async () => {
    const f = production()
    await repairOp(f)
    const removeId = one(f, "SELECT id FROM inventory_movements WHERE product_id=5357 AND movement_type='remove' AND reference_id IS NULL AND batch_id=56725").id
    const back = await send(f, 'POST', `/api/inventory/movements/${removeId}/revert`)
    assert.equal(back.status, 200, JSON.stringify(back.json))
    assert.deepEqual(shop(f), { ...END, slot: 3, branch: 33, product: 33, cost: 6.8182 })
    assert.equal(loss(f).removal_loss_qty, 0, 'a reverted removal is not a loss')
    const redo = await send(f, 'POST', '/api/action-history/1318/redo', { expected_generation: 1, require_applied: true })
    assert.equal(redo.status, 200, JSON.stringify(redo.json))
    assert.deepEqual([shop(f).slot, shop(f).branch], [30, 60])
  })

  await check('steps A and B already done (state ab): the repair adds the Remove only -> the same end state', async () => {
    const f = production()
    assert.equal((await send(f, 'POST', '/api/inventory/movements/48197/revert')).status, 200)
    assert.equal((await send(f, 'POST', '/api/action-history/1318/undo', { expected_generation: 0, require_applied: true })).status, 200)
    const count = one(f, 'SELECT COUNT(*) n FROM inventory_movements').n
    const out = await repairOp(f)
    assert.equal(out.status, 200, JSON.stringify(out.body))
    assert.equal(out.body.from, 'ab')
    assert.deepEqual(shop(f), END)
    assert.deepEqual(loss(f), END_LOSS)
    assert.equal(one(f, 'SELECT COUNT(*) n FROM inventory_movements').n, count + 1)
  })

  await check('refusals write nothing: a sale since, only step A done, a wrong actor, a begun cutover', async () => {
    const sale = production()
    sale.sql.exec(`UPDATE branch_batch_stock SET quantity=29 WHERE batch_id=56725 AND branch_id=2; UPDATE branch_stock SET quantity=29 WHERE product_id=5357 AND branch_id=2;
      UPDATE products SET stock_quantity=29 WHERE id=5357;
      INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, batch_id) VALUES(5357, 2, 'sale', 1, 56725);`)
    let before = snapshot(sale)
    let out = await repairOp(sale)
    assert.deepEqual([out.status, out.body.refusal], [409, 'sk2_state_mismatch'])
    assert.equal(snapshot(sale), before)

    const half = production()
    assert.equal((await send(half, 'POST', '/api/inventory/movements/48197/revert')).status, 200)
    before = snapshot(half)
    out = await repairOp(half)
    assert.deepEqual([out.status, out.body.refusal], [409, 'sk2_state_mismatch'])
    assert.equal(snapshot(half), before)

    const actor = production()
    before = snapshot(actor)
    out = await repairOp(actor, { actorUserId: 1 })
    assert.equal(out.status, 409)
    assert.equal(snapshot(actor), before, 'the repair acts as user 5 only')
    actor.sql.exec("UPDATE users SET is_active=0 WHERE id=5")
    out = await repairOp(actor)
    assert.deepEqual([out.status, out.body.refusal], [409, 'actor_not_permitted'])

    const begun = production()
    const realPrepare = begun.env.DB.prepare
    begun.env.DB.prepare = (text) => /FROM branch_cutovers/.test(text) ? realPrepare.call(begun.env.DB, "SELECT 'op' AS operation_id") : realPrepare.call(begun.env.DB, text)
    before = snapshot(begun)
    out = await repairOp(begun)
    assert.deepEqual([out.status, out.body.refusal], [409, 'cutover_already_begun'])
    assert.equal(snapshot(begun), before)
  })

  await check('concurrency: a sale lands between the read and the batch -> the in-batch guard refuses, nothing written', async () => {
    const f = production()
    f.beforeCommit((sql) => sql.exec(`UPDATE branch_batch_stock SET quantity=29 WHERE batch_id=56725 AND branch_id=2;
      UPDATE branch_stock SET quantity=29 WHERE product_id=5357 AND branch_id=2; UPDATE products SET stock_quantity=29 WHERE id=5357;`))
    const out = await repairOp(f)
    assert.deepEqual([out.status, out.body.refusal], [409, 'sk2_state_changed'])
    assert.equal(newRows(f).length, 0)
    assert.deepEqual(shop(f), { ...PRE, slot: 29, branch: 29, product: 29 })
  })

  await check('ops path end to end: repair-sk2-check then repair-sk2 through the operator loop against the fixture; a re-run is done; refusals stop with a fixed code', async () => {
    const { pathToFileURL } = require('node:url')
    const script = await import(pathToFileURL(path.join(root, '..', 'ops', 'scripts', 'ops-branch-cutover.mjs')).href)
    const loop = await import(pathToFileURL(path.join(root, '..', 'ops', 'scripts', 'branch-cutover-loop.mjs')).href)
    assert.deepEqual(script.MODES.slice(0, 5), ['inspect', 'bookmark', 'repair-sk2-check', 'repair-sk2', 'start'], 'runbook order: the repair just before start')
    const quiet = process.stdout.write
    process.stdout.write = () => true
    try {
      const f = production()
      const client = () => loop.createClient({ sleep: async () => {}, send: async (action, text) => {
        const out = await operator.runBranchCutoverOperatorAction(f.env, action, JSON.parse(text))
        return { status: out.status, json: out.body }
      } })
      const env = { OPS_ACTOR_USER_ID: '5' }
      const checked = await script.executeMode('repair-sk2-check', { client: client(), env })
      assert.deepEqual([checked.repair.state, checked.repair.plannedLossUsd], ['pre', 15])
      assert.deepEqual(shop(f), PRE, 'the check writes nothing')
      const applied = await script.executeMode('repair-sk2', { client: client(), env })
      assert.deepEqual([applied.repair.state, applied.repair.applied], ['done', true])
      assert.deepEqual(shop(f), END)
      const again = await script.executeMode('repair-sk2', { client: client(), env })
      assert.deepEqual([again.repair.state, again.repair.applied], ['done', false])
      assert.equal(newRows(f).length, 3)
      await assert.rejects(script.executeMode('repair-sk2', { client: client(), env: {} }), (e) => e.code === 'actor-user-missing')
      await assert.rejects(script.executeMode('repair-sk2', { client: client(), env: { OPS_ACTOR_USER_ID: '1' } }), (e) => e.code === 'refused-sk2-actor-not-5')
      const sale = production()
      sale.sql.exec(`UPDATE branch_batch_stock SET quantity=29 WHERE batch_id=56725 AND branch_id=2; UPDATE branch_stock SET quantity=29 WHERE product_id=5357 AND branch_id=2; UPDATE products SET stock_quantity=29 WHERE id=5357;`)
      const saleClient = loop.createClient({ sleep: async () => {}, send: async (action, text) => {
        const out = await operator.runBranchCutoverOperatorAction(sale.env, action, JSON.parse(text))
        return { status: out.status, json: out.body }
      } })
      await assert.rejects(script.executeMode('repair-sk2-check', { client: saleClient, env }), (e) => e.code === 'repair-sk2-stale')
      await assert.rejects(script.executeMode('repair-sk2', { client: saleClient, env }), (e) => e.code === 'refused-sk2-state-mismatch')
      assert.equal(newRows(sale).length, 0)
    } finally { process.stdout.write = quiet }
  })

  await check('DISCRIMINATING: the wrong repair that removes 30 is refused by the post-assertion, nothing written', async () => {
    // Record C rewritten as the plausible wrong repairs. Every one keeps every quantity >= 0, so only the
    // post-assertion (the guard_value CHECK) can tell them from the right one.
    const isC = (sql) => /'Stock count: received 02\/09|quantity - 3[, ]|stock_quantity, 0\) - 3,/.test(sql)
    const thirty = (sql) => sql.replace("'remove', 3,", "'remove', 30,").replace('ROUND(3 * pb.unit_cost_usd, 4)', 'ROUND(30 * pb.unit_cost_usd, 4)')
      .replace('quantity = quantity - 3,', 'quantity = quantity - 30,').replace('quantity = quantity - 3 WHERE', 'quantity = quantity - 30 WHERE').replace('stock_quantity, 0) - 3,', 'stock_quantity, 0) - 30,')
    for (const [label, wrong, statesOf] of [
      ['removes 30 from the delivery (Shop ends at 3)', (sql) => thirty(sql.replaceAll('@slot', '@delivery')), 'pre'],
      ['removes the 3 from the delivery instead of the 02/09 slot', (sql) => sql.replaceAll('@slot', '@delivery'), 'pre'],
      ['skips the Set undo and removes 30 from the slot (the Set +27 and the 3 counted as one loss of 30)', thirty, 'noB'],
    ]) {
      const f = production()
      const before = snapshot(f)
      let statements = repair.sk2RepairStatements('pre').map((s) => ({ ...s, sql: isC(s.sql) ? wrong(s.sql) : s.sql }))
      if (statesOf === 'noB') statements = statements.filter((s) => !/revert:48034'|quantity - 27|generation = 1, state = 'reversed'|status = 'redoable'/.test(s.sql) || /^INSERT INTO stock_session_guards/.test(s.sql.trim()))
      assert.notDeepEqual(statements.map((s) => s.sql), repair.sk2RepairStatements('pre').map((s) => s.sql), `${label}: the control really differs`)
      await assert.rejects(getDb(f.env).batch(statements), /guard_value/i, `${label}: refused by the post-assertion`)
      assert.equal(snapshot(f), before, `${label}: nothing written`)
    }
    // The positive control: the real statements pass the same post-assertion.
    const f = production()
    await getDb(f.env).batch(repair.sk2RepairStatements('pre'))
    assert.deepEqual(shop(f), END)
  })

  if (failures.length) throw new Error(`${failures.length} SK2 repair check(s) failed: ${failures.join('; ')}`)
  console.log('test-sk2-cleanser-repair-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
