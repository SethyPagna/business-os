const productStockGuard = require('./harness/product_stock_guard.cjs')
// Scoped "Set quantity" (owner, 17 Sep; confirmed 24 Sep: "Set Quantity:
// offer selected received-date lot or branch total; selected lot is the
// default") -- the companion for cloudflare/migrations/0193_stock_lot_
// adjustment_operations.sql and lib/stockLotAdjustment.ts, the ONE lot-level
// Set writer behind POST /api/inventory/adjust {setScope} and PATCH
// /api/batches/:id/branches/:branchId.
//
// Ported from codex/existing-stock-lot-corrections-20260912's
// test-stock-lot-adjustment-native.cjs onto today's code, on the real-SQLite
// harness (every migration applied, the REAL route and lib files transpiled,
// mounted in Hono and driven over HTTP), because today's writer sits inside
// runAdjustActionKernel behind the 0192 receipt wrapper and the maintenance
// guard, which the branch's Miniflare fixture did not load.
//
// Every stock number is asserted at each step. Loss classification uses the
// real lib/removalLosses.ts SQL and reducer.
//
// STOCK_LOT_TEST_ROOT=<dir containing src/> runs the same file against
// another tree (used to prove these checks red on the pre-change source).
//
// Run (from cloudflare/): node scripts/test-stock-lot-adjustment-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { Hono } = require('hono')
const { fixture, user } = require('./test-stock-session-atomic.cjs')

const root = process.env.STOCK_LOT_TEST_ROOT || path.join(__dirname, '..')
const migrations = path.join(__dirname, '..', 'migrations')

function loadModules() {
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
    if (name.endsWith('/productStockGuard')) return productStockGuard
      if (name === '../lib/auth' || name === './auth') return {
        requireAuth: async (c, next) => { c.set('user', c.req.header('x-test-user') ? JSON.parse(c.req.header('x-test-user')) : user); await next() },
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

const load = loadModules()
const app = new Hono()
app.route('/api/inventory', load('routes/inventory.ts').default)
app.route('/api/batches', load('routes/batches.ts').default)
app.route('/api/action-history', load('routes/actionHistory.ts').default)
app.route('/api/products', load('routes/products.ts').default)
const losses = load('lib/removalLosses.ts')
const ledger = load('lib/stockLedgerQuery.ts')
const backup = load('lib/backup.ts')

// Both schema probes memoise only a positive answer per isolate; a test that
// drops a table in a fresh database must forget the earlier positive answer.
function resetProbes() {
  load('lib/stockMutationReceipt.ts').resetStockMutationReceiptSchemaProbe()
  try { load('lib/stockLotAdjustment.ts').resetStockLotSetSchemaProbe() } catch { /* absent on the pre-change tree */ }
}

function seeded() {
  resetProbes()
  const f = fixture()
  f.sql.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(2, 'Warehouse', 0, 1);
    INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active)
      VALUES(10, 1, 'OLD', 'OLD', '2026-09-02', 1, 3, 1), (11, 1, 'NEW', 'NEW', '2026-09-09', 2, 5, 1);
    INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES(10, 1, 3), (11, 1, 7);
    UPDATE branch_stock SET quantity=10 WHERE product_id=1 AND branch_id=1;
    UPDATE products SET stock_quantity=10 WHERE id=1;
  `)
  return f
}

function call(f, method, url, body, headers = {}) {
  return app.request(url, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env, { waitUntil(promise) { Promise.resolve(promise).catch(() => {}) } })
}
async function send(f, method, url, body, headers) {
  const res = await call(f, method, url, body, headers)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const setLot = (id, quantity, extra = {}) => ({ type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 10, quantity, reason: 'Physical count', client_request_id: id, ...extra })

function stock(f) {
  const q = (sql, ...a) => Number(f.sql.prepare(sql).get(...a)?.q ?? 0)
  return {
    lot10: q('SELECT quantity q FROM branch_batch_stock WHERE batch_id=10 AND branch_id=1'),
    lot11: q('SELECT quantity q FROM branch_batch_stock WHERE batch_id=11 AND branch_id=1'),
    branch: q('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1'),
    product: q('SELECT stock_quantity q FROM products WHERE id=1'),
    held: q('SELECT COALESCE(SUM(quantity_remaining),0) q FROM damaged_stock_lots WHERE product_id=1'),
  }
}
const movements = f => f.sql.prepare('SELECT id,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,batch_id FROM inventory_movements ORDER BY id').all()
function loss(f) {
  const rows = f.sql.prepare(`SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM} WHERE ${losses.removalLossMovementWhere('m')}`).all()
  return losses.summarizeRemovalLosses(rows)
}
const history = (f, id) => f.sql.prepare('SELECT status, undo_payload FROM action_history WHERE id=?').get(id)
const undo = (f, id, generation) => send(f, 'POST', `/api/action-history/${id}/undo`, { expected_generation: generation, require_applied: true })
const redo = (f, id, generation) => send(f, 'POST', `/api/action-history/${id}/redo`, { expected_generation: generation, require_applied: true })

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n`, error) }
}

async function main() {
  await check('0193 is schema-only: applying it to a populated database changes no business row', async () => {
    const f = seeded()
    f.sql.exec('DROP TABLE stock_lot_adjustment_operations')
    const snapshot = () => JSON.stringify(['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'inventory_movements', 'audit_logs', 'action_history']
      .map(t => f.sql.prepare(`SELECT * FROM ${t}`).all()))
    const before = snapshot()
    f.sql.exec(fs.readFileSync(path.join(migrations, '0193_stock_lot_adjustment_operations.sql'), 'utf8'))
    assert.equal(snapshot(), before)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='stock_lot_adjustment_operations'").get().n, 1)
    assert.ok(!fs.readFileSync(path.join(migrations, '0193_stock_lot_adjustment_operations.sql'), 'utf8').includes('\r'), 'LF-only')
  })

  await check('lot-scope Set moves only the selected lot; up is an adjustment at the lot cost with exact history', async () => {
    const f = seeded()
    const res = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-set-up-0001', 5))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    const [m] = movements(f)
    assert.equal(m.movement_type, 'adjustment'); assert.equal(m.quantity, 2); assert.equal(m.unit_cost_usd, 3); assert.equal(m.total_cost_usd, 6); assert.equal(m.batch_id, 10)
    assert.equal(m.reference_id, `stock-set:${res.json.operation_id}:0`)
    assert.equal(history(f, res.json.action_history_id).status, 'undoable')
    assert.equal(loss(f).removal_loss_usd, 0, 'an upward Set is not a loss')
  })

  await check('the same scoped Set twice is applied once (0192 receipt) and once without 0192 (0193 identity)', async () => {
    for (const drop0192 of [false, true]) {
      const f = seeded()
      if (drop0192) f.sql.exec('DROP TABLE stock_mutation_receipts')
      const first = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-set-twice-01', 6))
      const second = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-set-twice-01', 6))
      assert.equal(first.status, 200); assert.equal(second.status, 200)
      assert.equal(second.json.replayed, true)
      assert.equal(second.json.operation_id, first.json.operation_id)
      assert.deepEqual(stock(f), { lot10: 6, lot11: 7, branch: 13, product: 13, held: 0 })
      assert.equal(movements(f).length, 1, 'double-apply: one movement only')
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').get().n, 1)
      const other = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-set-twice-01', 1))
      assert.equal(other.status, 409, 'same id, different data')
      assert.deepEqual(stock(f), { lot10: 6, lot11: 7, branch: 13, product: 13, held: 0 })
    }
  })

  await check('undo -> undo -> redo restores and re-applies exact stock; generations advance once', async () => {
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-undo-cycle-1', 1))
    assert.deepEqual(stock(f), { lot10: 1, lot11: 7, branch: 8, product: 8, held: 0 })
    assert.equal(set.json.movementType, 'remove')
    assert.equal(loss(f).removal_loss_usd, 6, 'untagged down-Set is a loss at the lot cost (2 x 3)')
    const id = set.json.action_history_id
    const u1 = await undo(f, id, 0)
    assert.equal(u1.status, 200, JSON.stringify(u1.json))
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 })
    assert.equal(loss(f).removal_loss_usd, 0, 'an undone loss is no longer counted')
    const counter = movements(f).at(-1)
    assert.equal(counter.movement_type, 'adjustment'); assert.equal(counter.reference_id, `revert:${movements(f)[0].id}`)
    const u2 = await undo(f, id, 0)
    assert.equal(u2.status, 200, 'a repeated undo of the same generation is idempotent')
    const u3 = await undo(f, id, 1)
    assert.equal(u3.status, 409, 'undo of an already reversed generation is refused')
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 }, 'second undo moves nothing')
    assert.equal(movements(f).length, 2)
    const r = await redo(f, id, 1)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.deepEqual(stock(f), { lot10: 1, lot11: 7, branch: 8, product: 8, held: 0 })
    assert.equal(movements(f).at(-1).reference_id, `stock-set:${set.json.operation_id}:2`)
    assert.equal(loss(f).removal_loss_usd, 6, 'the redone removal is a loss again, once')
    assert.equal(JSON.parse(history(f, id).undo_payload).generation, 2)
  })

  // REVERT-SET (owner, 6 Oct 2026): undo moves the Set's recorded DELTA, so a
  // later sale that left the Set's units alone no longer blocks it, and one
  // that used them refuses it whole with the numbers.
  await check('undo after an intervening sale takes back exactly the Set delta; a sale that used those units refuses it whole', async () => {
    const sell = (f, lot, qty) => f.sql.exec(`UPDATE branch_batch_stock SET quantity=quantity-${qty} WHERE batch_id=${lot} AND branch_id=1;
      UPDATE branch_stock SET quantity=quantity-${qty} WHERE product_id=1 AND branch_id=1;
      UPDATE products SET stock_quantity=stock_quantity-${qty} WHERE id=1;
      INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,batch_id) VALUES(1,1,'sale',${qty},${lot});`)
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-undo-sale-01', 5))
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    sell(f, 10, 1)
    sell(f, 11, 2)
    const res = await undo(f, set.json.action_history_id, 0)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stock(f), { lot10: 2, lot11: 5, branch: 7, product: 7, held: 0 }, 'only the +2 comes back off; both sales stay')
    const counter = movements(f).at(-1)
    assert.equal(counter.movement_type, 'remove'); assert.equal(counter.quantity, 2); assert.equal(counter.batch_id, 10)
    assert.equal(history(f, set.json.action_history_id).status, 'redoable')

    const g = seeded()
    const set2 = await send(g, 'POST', '/api/inventory/adjust', setLot('lot-undo-sale-02', 5))
    sell(g, 10, 4)
    const before = stock(g)
    const refused = await undo(g, set2.json.action_history_id, 0)
    assert.equal(refused.status, 409, JSON.stringify(refused.json))
    assert.equal(refused.json.code, 'revert_insufficient_lot_stock')
    assert.deepEqual(refused.json.params, { available: 1, needed: 2 })
    assert.deepEqual(stock(g), before, 'refused whole: nothing moved')
    assert.equal(history(g, set2.json.action_history_id).status, 'undoable')
  })

  // The owner's report, 6 Oct 2026 (SK-II Gentle Cleanser 20g): a lot of 3
  // received 02/09 and a delivery of 30 received 29/09, then "Set received
  // date" on the 02/09 lot to 30 (+27, total 60). Lot costs differ (5 and 7)
  // so the catalog cost tells the right end state from the wrong one.
  function screenshotSeeded() {
    resetProbes()
    const f = fixture()
    f.sql.exec(`
      INSERT INTO branches(id, name, is_default, is_active) VALUES(2, 'Warehouse', 0, 1);
      INSERT INTO suppliers(id, name) VALUES(19, 'Dane japan');
      INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active, received_quantity, received_cost_usd, received_branch_id)
        VALUES(20, 1, 'ADJ', 'ADJ09/02/2026', '2026-09-02', 1, 5, 1, 3, 15, 1);
      INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, batch_number, unit_cost_usd, is_active, received_quantity, received_cost_usd, received_branch_id, supplier_id, supplier_name, payment_status)
        VALUES(21, 1, 'NEW', '09292026', '2026-09-29', 2, 7, 1, 30, 210, 1, 19, 'Dane japan', 'paid');
      INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES(20, 1, 3), (21, 1, 30);
      UPDATE branch_stock SET quantity=33 WHERE product_id=1 AND branch_id=1;
      UPDATE products SET stock_quantity=33 WHERE id=1;
      INSERT INTO inventory_movements(id, product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, reference_id, batch_id, created_at)
        VALUES(48026, 1, 'Serum', 1, 'Shop', 'add', 30, 7, 210, 'New arrival', 1790667050013, 21, '2026-09-29 07:33:05');
    `)
    return f
  }
  const lots = (f) => {
    const q = (sql, ...a) => f.sql.prepare(sql).get(...a)
    return {
      old: Number(q('SELECT quantity q FROM branch_batch_stock WHERE batch_id=20 AND branch_id=1').q),
      delivery: Number(q('SELECT quantity q FROM branch_batch_stock WHERE batch_id=21 AND branch_id=1').q),
      branch: Number(q('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').q),
      product: Number(q('SELECT stock_quantity q FROM products WHERE id=1').q),
      cost: Number(q('SELECT cost_price_usd q FROM products WHERE id=1').q),
    }
  }
  const delivery = (f) => f.sql.prepare('SELECT received_quantity, received_cost_usd, is_active FROM product_batches WHERE id=21').get()
  const setOld = (id) => setLot(id, 30, { batchId: 20, reason: 'wrong stock' })
  const ledgerRevert = (f, id) => send(f, 'POST', `/api/inventory/movements/${id}/revert`)

  await check('screenshot sequence: reverting the Set takes exactly 27 back off its own lot (33, both lots and the delivery intact)', async () => {
    const f = screenshotSeeded()
    assert.equal(lots(f).cost, 6.8182, 'weighted (3x5 + 30x7) / 33 before the Set')
    const set = await send(f, 'POST', '/api/inventory/adjust', setOld('ss-set-0000001'))
    assert.equal(set.status, 200, JSON.stringify(set.json))
    assert.deepEqual(lots(f), { old: 30, delivery: 30, branch: 60, product: 60, cost: 6 })
    const forward = movements(f).at(-1)
    assert.equal(forward.movement_type, 'adjustment'); assert.equal(forward.quantity, 27); assert.equal(forward.batch_id, 20)
    assert.equal(f.sql.prepare('SELECT reason FROM inventory_movements WHERE id=?').get(forward.id).reason,
      'wrong stock (Set received 2026-09-02 from 3 to 30)', 'the row names the lot and both quantities')
    // The delivery's Revert says what it does and that the Set stays applied --
    // on Stock Changes (preview) and on the Stock-in Sessions line alike.
    const addPreview = await send(f, 'GET', '/api/action-history/movements/48026/revert-preview')
    assert.equal(addPreview.status, 200, JSON.stringify(addPreview.json))
    assert.equal(addPreview.json.revert.kind, 'movement')
    assert.deepEqual(addPreview.json.effect, {
      quantity: -30, batchId: 21, receivedAt: '2026-09-29', lotCode: '09292026', branchId: 1, branchName: 'Shop', branchBefore: 60, branchAfter: 30,
    })
    assert.deepEqual(addPreview.json.laterSets.map((s) => [s.movementId, s.quantity, s.receivedAt]), [[forward.id, 27, '2026-09-02']])
    const lines = await send(f, 'GET', '/api/products/stock-in-session-lines?key=session:1790667050013')
    assert.equal(lines.status, 200, JSON.stringify(lines.json))
    assert.deepEqual(lines.json.rows.map((row) => [row.id, (row.later_open_sets || []).map((s) => s.movementId)]), [[48026, [forward.id]]])
    // The Stock Changes Revert on the Set row resolves THIS Set, not the delivery.
    const preview = await send(f, 'GET', `/api/action-history/movements/${forward.id}/revert-preview`)
    assert.equal(preview.status, 200, JSON.stringify(preview.json))
    assert.equal(preview.json.revert.kind, 'stock_set'); assert.equal(preview.json.revert.direction, 'undo')
    assert.equal(preview.json.revert.historyId, set.json.action_history_id)
    assert.deepEqual([preview.json.effect.quantity, preview.json.effect.batchId, preview.json.effect.branchBefore, preview.json.effect.branchAfter],
      [-27, 20, 60, 33], 'the Set row previews -27 on its own lot')
    const res = await undo(f, set.json.action_history_id, 0)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(lots(f), { old: 3, delivery: 30, branch: 33, product: 33, cost: 6.8182 }, '33, not 30')
    assert.deepEqual((await send(f, 'GET', '/api/action-history/movements/48026/revert-preview')).json.laterSets, [], 'an undone Set no longer warns')
    assert.deepEqual(delivery(f), { received_quantity: 30, received_cost_usd: 210, is_active: 1 }, 'the delivery stays a purchase')
    const counter = movements(f).at(-1)
    assert.equal(counter.movement_type, 'remove'); assert.equal(counter.quantity, 27); assert.equal(counter.batch_id, 20)
    assert.equal(counter.reference_id, `revert:${forward.id}`)
    // Double apply: the same generation again is a no-op; a stale one and a ledger Revert of either row are refused.
    assert.equal((await undo(f, set.json.action_history_id, 0)).status, 200)
    assert.equal((await undo(f, set.json.action_history_id, 1)).status, 409)
    assert.equal((await ledgerRevert(f, forward.id)).status, 409)
    assert.equal((await ledgerRevert(f, counter.id)).status, 409)
    assert.deepEqual(lots(f), { old: 3, delivery: 30, branch: 33, product: 33, cost: 6.8182 }, 'nothing moved twice')
    assert.equal(movements(f).length, 3)
  })

  await check('screenshot sequence: reverting the Add takes its own 30 and un-receives it; the Set stays and still undoes by exactly 27', async () => {
    const f = screenshotSeeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setOld('ss-set-0000002'))
    const res = await ledgerRevert(f, 48026)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(lots(f), { old: 30, delivery: 0, branch: 30, product: 30, cost: 5 }, 'production state of 1 Oct')
    assert.deepEqual(delivery(f), { received_quantity: 0, received_cost_usd: 0, is_active: 0 })
    // Before the fix the Set's Undo was refused here for good (branch 30 is not the snapshot's 60).
    const undone = await undo(f, set.json.action_history_id, 0)
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.deepEqual(lots(f), { old: 3, delivery: 0, branch: 3, product: 3, cost: 5 })
    assert.equal(movements(f).at(-1).quantity, 27)
  })

  // Owner ruling, 6 Oct 2026 22:50: "restore the delivery, and also revert
  // the +27 ... current 3 + 27, revert +27 -> back to 3, then minus 3 -> 0 left
  // in that slot ... cost price, loss etc. only counts the 3. Revert should
  // fully revert, never leaves a stock effect behind." Each step is the app's
  // own action on the live build (4ab47676 -- run with STOCK_LOT_TEST_ROOT).
  await check('screenshot repair in the app (owner ruling): Revert the Revert, Undo the Set, Remove the 3 -> delivery 30, 02/09 lot 0, loss only the 3', async () => {
    const f = screenshotSeeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setOld('ss-set-0000003'))
    const forward = movements(f).at(-1)
    await ledgerRevert(f, 48026)
    const wrong = movements(f).at(-1)
    assert.equal(wrong.reference_id, 'revert:48026')
    assert.deepEqual(lots(f), { old: 30, delivery: 0, branch: 30, product: 30, cost: 5 }, 'production state of 1 Oct')
    // Step 1: Stock Changes -> the Revert row (#48197 in production) -> Revert.
    const back = await ledgerRevert(f, wrong.id)
    assert.equal(back.status, 200, JSON.stringify(back.json))
    assert.deepEqual(lots(f), { old: 30, delivery: 30, branch: 60, product: 60, cost: 6 })
    assert.deepEqual(delivery(f), { received_quantity: 30, received_cost_usd: 210, is_active: 1 })
    // Step 2: Stock Changes -> the Set row (#48034) -> Revert, which runs the Set's History Undo.
    assert.equal((await undo(f, set.json.action_history_id, 0)).status, 200)
    assert.deepEqual(lots(f), { old: 3, delivery: 30, branch: 33, product: 33, cost: 6.8182 })
    assert.deepEqual(delivery(f), { received_quantity: 30, received_cost_usd: 210, is_active: 1 })
    const dated = f.sql.prepare('SELECT supplier_name, payment_status FROM product_batches WHERE id=21').get()
    assert.deepEqual(dated, { supplier_name: 'Dane japan', payment_status: 'paid' }, 'supplier attribution kept through both')
    assert.deepEqual(loss(f), { removal_loss_usd: 0, removal_loss_qty: 0, removal_loss_unvalued_rows: 0 }, 'no Revert and no Undo is a loss')
    // Step 3: Remove Stock -> received date 02/09 -> 3, with a reason.
    const removed = await send(f, 'POST', '/api/inventory/adjust', { type: 'remove', productId: 1, branchId: 1, batchId: 20, quantity: 3, reason: 'Not on the shelf (stock count)', client_request_id: 'ss-remove-000003' })
    assert.equal(removed.status, 200, JSON.stringify(removed.json))
    assert.deepEqual(lots(f), { old: 0, delivery: 30, branch: 30, product: 30, cost: 7 }, 'only the delivery is on hand, at its own cost')
    assert.deepEqual(delivery(f), { received_quantity: 30, received_cost_usd: 210, is_active: 1 })
    const last = movements(f).at(-1)
    assert.deepEqual([last.movement_type, last.quantity, last.batch_id, last.reference_id], ['remove', 3, 20, null])
    // Fixture lot cost is 5 (production: 7 -> $21). A Remove from the wrong lot would read 3 x 7 here.
    assert.deepEqual(loss(f), { removal_loss_usd: 15, removal_loss_qty: 3, removal_loss_unvalued_rows: 0 }, 'only the 3 count as a loss, at their lot cost')
    // Every Revert is its own row, linked to the row it reverses; nothing was rewritten.
    const refs = f.sql.prepare("SELECT reference_id r FROM inventory_movements WHERE reference_id LIKE 'revert:%' ORDER BY id").all().map((row) => row.r)
    assert.deepEqual(refs, ['revert:48026', `revert:${wrong.id}`, `revert:${forward.id}`])
    assert.equal(movements(f).length, 6, 'the delivery, the Set, its wrong Revert, the Revert of that, the Set Undo and the Remove')
  })

  await check('a Set whose forward row already has a Revert is never reversed a second time', async () => {
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-legacy-rev-1', 5))
    const forward = movements(f)[0]
    // What a ledger Revert of a Set row wrote before the ledger refused them.
    f.sql.exec(`UPDATE branch_batch_stock SET quantity=quantity-2 WHERE batch_id=10 AND branch_id=1;
      UPDATE branch_stock SET quantity=quantity-2 WHERE product_id=1 AND branch_id=1;
      UPDATE products SET stock_quantity=stock_quantity-2 WHERE id=1;
      INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,batch_id,reference_id) VALUES(1,1,'remove',2,10,'revert:${forward.id}');`)
    const before = stock(f)
    const res = await undo(f, set.json.action_history_id, 0)
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json.code, 'already_reverted')
    assert.deepEqual(stock(f), before)
  })


  await check('refused during maintenance: Set and undo change nothing', async () => {
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-maint-set-01', 5))
    f.sql.exec(`INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
    const before = stock(f)
    const blocked = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-maint-set-02', 0))
    assert.equal(blocked.status, 503, JSON.stringify(blocked.json))
    const blockedUndo = await undo(f, set.json.action_history_id, 0)
    assert.equal(blockedUndo.status, 503, JSON.stringify(blockedUndo.json))
    assert.deepEqual(stock(f), before)
    assert.equal(movements(f).length, 1)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_lot_adjustment_operations').get().n, 1)
  })

  await check('loss rule: untagged down counted, tagged down held and not counted, up not counted; tagged undo empties the held row', async () => {
    const f = seeded()
    const down = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-loss-down-01', 4, { batchId: 11 }))
    assert.equal(down.json.movementType, 'remove')
    assert.deepEqual(stock(f), { lot10: 3, lot11: 4, branch: 7, product: 7, held: 0 })
    assert.equal(loss(f).removal_loss_usd, 15, '3 units at lot 11 cost 5')
    const tagged = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-loss-tag-001', 2, { batchId: 11, conditionTag: 'damaged' }))
    assert.equal(tagged.status, 200, JSON.stringify(tagged.json))
    assert.equal(tagged.json.movementType, 'damage_out')
    assert.deepEqual(stock(f), { lot10: 3, lot11: 2, branch: 5, product: 5, held: 2 })
    const hold = movements(f).at(-1)
    assert.equal(hold.movement_type, 'damage_out'); assert.equal(hold.unit_cost_usd, 5); assert.equal(hold.batch_id, 11)
    const heldRow = f.sql.prepare('SELECT condition_tag,source,batch_id,unit_cost_usd FROM damaged_stock_lots').get()
    assert.deepEqual(heldRow, { condition_tag: 'damaged', source: 'remove', batch_id: 11, unit_cost_usd: 5 }, 'same row the tagged Remove path writes')
    assert.equal(loss(f).removal_loss_usd, 15, 'a tagged down-Set is not a loss')
    const up = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-loss-up-0001', 6, { batchId: 11 }))
    assert.equal(up.json.movementType, 'adjustment')
    assert.equal(loss(f).removal_loss_usd, 15, 'an up-Set is not a loss')
    assert.equal((await send(f, 'POST', '/api/inventory/adjust', setLot('lot-loss-uptag-1', 9, { batchId: 11, conditionTag: 'damaged' }))).status, 400)
    assert.equal((await undo(f, up.json.action_history_id, 0)).status, 200)
    const tu = await undo(f, tagged.json.action_history_id, 0)
    assert.equal(tu.status, 200, JSON.stringify(tu.json))
    assert.deepEqual(stock(f), { lot10: 3, lot11: 4, branch: 7, product: 7, held: 0 })
    assert.equal((await undo(f, down.json.action_history_id, 0)).status, 200)
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 })
    assert.equal(loss(f).removal_loss_usd, 0)
  })

  await check('tagged undo is refused once the held row was disposed of', async () => {
    const f = seeded()
    const tagged = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-tag-dispose1', 1, { conditionTag: 'broken' }))
    f.sql.exec('UPDATE damaged_stock_lots SET quantity_remaining=0')
    const before = stock(f)
    assert.equal((await undo(f, tagged.json.action_history_id, 0)).status, 409)
    assert.deepEqual(stock(f), before)
  })

  await check('branch-total scope adjusts the selected lot by the branch difference and refuses a shortage', async () => {
    const f = seeded()
    const res = await send(f, 'POST', '/api/inventory/adjust', setLot('branch-scope-001', 12, { setScope: 'branch' }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    const short = await send(f, 'POST', '/api/inventory/adjust', setLot('branch-scope-002', 1, { setScope: 'branch' }))
    assert.equal(short.status, 409, 'lot 10 holds 5 and cannot give up 11')
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    const stale = await send(f, 'POST', '/api/inventory/adjust', setLot('branch-scope-003', 4, { expectedLotQuantity: 9 }))
    assert.equal(stale.status, 409, 'a stale preview is refused')
  })

  await check('PATCH /batches/:id/branches/:branchId is the same writer (lot scope, loss rule, undo)', async () => {
    const f = seeded()
    const res = await send(f, 'PATCH', '/api/batches/10/branches/1', { quantity: 0 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stock(f), { lot10: 0, lot11: 7, branch: 7, product: 7, held: 0 })
    assert.equal(movements(f)[0].movement_type, 'remove')
    assert.equal(loss(f).removal_loss_usd, 9)
    assert.equal((await undo(f, res.json.action_history_id, 0)).status, 200)
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 })
    // Part-77 floor kept: a drifted aggregate floors at zero, undo restores it exactly.
    f.sql.exec('UPDATE branch_stock SET quantity=2 WHERE product_id=1 AND branch_id=1')
    const floored = await send(f, 'PATCH', '/api/batches/11/branches/1', { quantity: 0 })
    assert.equal(floored.status, 200)
    assert.equal(stock(f).branch, 0)
    assert.equal((await undo(f, floored.json.action_history_id, 0)).status, 200)
    assert.equal(stock(f).branch, 2)
    assert.equal(stock(f).lot11, 7)
    // The editor's figure is a guard, and its request id makes a retry replay.
    assert.equal((await send(f, 'PATCH', '/api/batches/10/branches/1', { quantity: 1, expectedLotQuantity: 9 })).status, 409)
    const before = movements(f).length
    const once = await send(f, 'PATCH', '/api/batches/10/branches/1', { quantity: 1, expectedLotQuantity: 3, client_request_id: 'patch-lot-once-01' })
    const again = await send(f, 'PATCH', '/api/batches/10/branches/1', { quantity: 1, expectedLotQuantity: 3, client_request_id: 'patch-lot-once-01' })
    assert.equal(once.status, 200); assert.equal(again.json.replayed, true)
    assert.equal(stock(f).lot10, 1)
    assert.equal(movements(f).length, before + 1, 'the retried PATCH is applied once')
  })

  await check('the stock ledger refuses to revert a scoped Set or its undo counter', async () => {
    const f = seeded()
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-revert-deny1', 5))
    const forward = movements(f)[0]
    assert.equal((await send(f, 'POST', `/api/inventory/movements/${forward.id}/revert`)).status, 409)
    await undo(f, set.json.action_history_id, 0)
    const counter = movements(f).at(-1)
    const before = stock(f)
    assert.equal((await send(f, 'POST', `/api/inventory/movements/${counter.id}/revert`)).status, 409)
    assert.deepEqual(stock(f), before)
  })

  await check('without 0193 the ledger read works and a Set still applies (no undo recorded)', async () => {
    const f = seeded()
    f.sql.exec('DROP TABLE stock_lot_adjustment_operations')
    const res = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-no-0193-001', 5))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.server_recorded, false)
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM action_history').get().n, 0)
    const query = ledger.buildStockLedgerQuery({ productId: 1 })
    const rows = f.sql.prepare(query.rowsSql.replace(/@(\w+)/g, ':$1')).all({ ...query.params, limit: 50, offset: 0 })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].movement_type, 'adjustment')
  })

  await check('backup round-trip keeps the operation row and its undo still replays after restore', async () => {
    const f = seeded()
    assert.ok(backup.BACKUP_TABLES.indexOf('stock_lot_adjustment_operations') > backup.BACKUP_TABLES.indexOf('action_history'))
    assert.ok(backup.SALE_REPLAY_RESTORE_BUNDLE.includes('stock_lot_adjustment_operations'))
    const set = await send(f, 'POST', '/api/inventory/adjust', setLot('lot-backup-00001', 5))
    const doc = JSON.stringify({ format: 'business-os-cloudflare-backup', formatVersion: 1, tables: Object.fromEntries(backup.BACKUP_TABLES
      .filter(t => f.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t))
      .map(t => [t, { columns: f.sql.pragma(`table_info(${t})`).map(c => c.name), rows: f.sql.prepare(`SELECT * FROM ${t}`).all() }])),
      r2: { assets: [], copiedKeys: [] }, summary: { schemaMigration: '0193_stock_lot_adjustment_operations.sql' } })
    const saved = f.sql.prepare('SELECT * FROM stock_lot_adjustment_operations').all()
    await send(f, 'POST', '/api/inventory/adjust', setLot('lot-backup-00002', 7, { batchId: 11 }))
    const etag = require('node:crypto').createHash('sha256').update(doc).digest('hex')
    const env = { ...f.env, ASSETS: { async get(key, options) {
      if (!key.endsWith('fixture.json')) return null
      const metadata = { key, etag, version: 'fixture-upload', size: Buffer.byteLength(doc) }
      if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== etag) return metadata
      return { ...metadata, body: new Blob([doc]).stream(), customMetadata: { format: 'business-os-cloudflare-backup' } }
    } } }
    f.sql.exec(`INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
    await backup.restoreCloudflareBackup(env, 'fixture.json')
    f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
    assert.deepEqual(f.sql.prepare('SELECT * FROM stock_lot_adjustment_operations').all(), saved)
    assert.deepEqual(stock(f), { lot10: 5, lot11: 7, branch: 12, product: 12, held: 0 })
    assert.equal((await undo(f, set.json.action_history_id, 0)).status, 200)
    assert.deepEqual(stock(f), { lot10: 3, lot11: 7, branch: 10, product: 10, held: 0 })
  })

  await check('transfer with a selected received date draws only that lot and refuses a shortage', async () => {
    const f = seeded()
    const body = { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 2, batchId: 11, reason: 'Selected lot', client_request_id: 'transfer-lot-0001', transfer_provenance_version: 1 }
    const moved = await send(f, 'POST', '/api/inventory/transfer', body)
    assert.equal(moved.status, 200, JSON.stringify(moved.json))
    assert.equal(stock(f).lot10, 3, 'the older lot is not drawn FIFO')
    assert.equal(stock(f).lot11, 5)
    const replay = await send(f, 'POST', '/api/inventory/transfer', body)
    assert.equal(replay.json.replayed, true)
    assert.equal(stock(f).lot11, 5)
    const short = await send(f, 'POST', '/api/inventory/transfer', { ...body, batchId: 10, quantity: 4, client_request_id: 'transfer-lot-0002' })
    assert.equal(short.status, 409, JSON.stringify(short.json))
    assert.equal(stock(f).lot10, 3)
  })

  if (failures.length) throw new Error(`${failures.length} scoped Set check(s) failed: ${failures.join('; ')}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
