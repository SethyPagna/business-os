// REVERT-SET (owner, 6 Oct 2026: "Revert should fully revert, never leaves a
// stock effect behind"; lead: an Undo is refused only when later movements
// took the units it needs, never by exact quantity). A stock-in session's
// Undo/Redo moves exactly the session's own recorded change (its postimage
// minus its preimage) on today's rows:
//
//   undo after a sale from ANOTHER lot     applies; the sale stays
//   undo after a later delivery, same lot   applies; the delivery stays, with
//                                           its attribution, the lot active
//   undo after a sale of the session's units refused, coded, the sale named
//   a line reverted alone in Stock Changes  refused (revert_session_line_reverted)
//   a lot the session created, reused by a  redo refused (its pinned columns)
//   later receipt from another supplier
//   repeat / stale generation               no-op / refused
//
// STOCK_SESSION_TEST_ROOT=<dir containing src/> runs it against another tree
// (the live build 4ab47676: every "applies" case is red there).
//
// Run (from cloudflare/): node scripts/test-stock-session-delta-replay.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { fixture, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

const root = process.env.STOCK_SESSION_TEST_ROOT || path.join(__dirname, '..')
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
      if (name === './cache' || name === '../lib/cache') return { bumpVersion: async () => {} }
      if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
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
const api = load('lib/stockSession.ts')
const ledger = load('lib/stockRevert.ts')
const { getDb } = load('lib/db.ts')
const { historyStockEffect } = load('lib/stockRevertEffect.ts')
const effect = (f, r) => historyStockEffect(getDb(f.env), q(f, 'SELECT id, status, undo_payload, redo_payload FROM action_history WHERE id=?', r.actionHistoryId))

const payload = (f, r) => JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(r.actionHistoryId).undo_payload)
const replay = (f, r, direction, generation) => api.replayStockSession(f.env, user, direction, r.actionHistoryId, generation, payload(f, r))
const q = (f, sql, ...args) => f.sql.prepare(sql).get(...args)
const lotQty = (f, batchId) => Number(q(f, 'SELECT COALESCE(SUM(quantity),0) q FROM branch_batch_stock WHERE batch_id=? AND branch_id=1', batchId).q)
const branch = (f) => Number(q(f, 'SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').q)
const product = (f) => Number(q(f, 'SELECT stock_quantity q FROM products WHERE id=1').q)
const lot = (f, batchId) => q(f, 'SELECT received_quantity, received_cost_usd, supplier_name, unit_cost_usd, is_active FROM product_batches WHERE id=?', batchId)
function sell(f, batchId, quantity) {
  f.sql.exec(`UPDATE branch_batch_stock SET quantity=quantity-${quantity} WHERE batch_id=${batchId} AND branch_id=1;
    UPDATE branch_stock SET quantity=quantity-${quantity} WHERE product_id=1 AND branch_id=1;
    UPDATE products SET stock_quantity=stock_quantity-${quantity} WHERE id=1;`)
  return Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,batch_id)
    VALUES(1,'Serum',1,'Shop','sale',?,?)`).run(quantity, batchId).lastInsertRowid)
}
const session = (f, id, quantity, extra = {}) => {
  const request = receiveRequest(id, quantity)
  Object.assign(request.items[0], extra.item || {})
  Object.assign(request.defaults, extra.defaults || {})
  return api.commitStockSession(f.env, user, request)
}

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n`, error) }
}

async function main() {
  await check('undo after a sale from ANOTHER lot applies: exactly the session\'s 10 come off its own lot; the sale stays', async () => {
    const f = fixture()
    const older = await session(f, 'delta-older-0001', 6, { defaults: { received_date: '2026-09-01' }, item: { unit_cost_usd: 1 } })
    const r = await session(f, 'delta-target-001', 10)
    const olderLot = older.items[0].batchId; const lotId = r.items[0].batchId
    assert.notEqual(olderLot, lotId)
    sell(f, olderLot, 4)
    assert.deepEqual([lotQty(f, olderLot), lotQty(f, lotId), branch(f), product(f)], [2, 10, 12, 12])
    await replay(f, r, 'undo', 0)
    assert.deepEqual([lotQty(f, olderLot), lotQty(f, lotId), branch(f), product(f)], [2, 0, 2, 2])
    assert.deepEqual(lot(f, lotId), { received_quantity: 0, received_cost_usd: 0, supplier_name: null, unit_cost_usd: null, is_active: 0 }, 'its own lot is un-received and released')
    await replay(f, r, 'undo', 0)
    assert.deepEqual([lotQty(f, lotId), branch(f)], [0, 2], 'the same generation again is a no-op')
    await assert.rejects(replay(f, r, 'undo', 1), (e) => e.statusCode === 409, 'a stale generation is refused')
    await replay(f, r, 'redo', 1)
    assert.deepEqual([lotQty(f, olderLot), lotQty(f, lotId), branch(f), product(f)], [2, 10, 12, 12])
    assert.deepEqual(lot(f, lotId), { received_quantity: 10, received_cost_usd: 20, supplier_name: 'Fixture Supplier', unit_cost_usd: 2, is_active: 1 })
  })

  await check('undo after a later delivery into the SAME lot applies: the session\'s 10 come off, the delivery and its attribution stay', async () => {
    const f = fixture()
    const r = await session(f, 'delta-first-0001', 10)
    const later = await session(f, 'delta-later-0001', 4)
    const lotId = r.items[0].batchId
    assert.equal(later.items[0].batchId, lotId, 'same date and cost: the same lot')
    // The confirm states the session's own 10, not the lot's 14 and not today's total.
    const undoEffect = await effect(f, r)
    assert.deepEqual([undoEffect.direction, undoEffect.lines.map((l) => [l.batchId, l.change]), undoEffect.branches.map((b) => [b.before, b.after])],
      ['undo', [[lotId, -10]], [[14, 4]]])
    await replay(f, r, 'undo', 0)
    assert.deepEqual([lotQty(f, lotId), branch(f), product(f)], [4, 4, 4])
    assert.deepEqual(lot(f, lotId), { received_quantity: 4, received_cost_usd: 8, supplier_name: 'Fixture Supplier', unit_cost_usd: 2, is_active: 1 })
    const redoEffect = await effect(f, r)
    assert.deepEqual([redoEffect.direction, redoEffect.lines.map((l) => l.change), redoEffect.branches.map((b) => [b.before, b.after])], ['redo', [10], [[4, 14]]])
    await replay(f, r, 'redo', 1)
    assert.deepEqual([lotQty(f, lotId), branch(f), product(f)], [14, 14, 14])
    assert.deepEqual(lot(f, lotId), { received_quantity: 14, received_cost_usd: 28, supplier_name: 'Fixture Supplier', unit_cost_usd: 2, is_active: 1 })
  })

  await check('undo after a sale of the session\'s own units is refused -- coded, the numbers and the sale named; nothing moves', async () => {
    const f = fixture()
    const r = await session(f, 'delta-sold-00001', 10)
    const sale = sell(f, r.items[0].batchId, 3)
    const before = JSON.stringify([lotQty(f, r.items[0].batchId), branch(f), product(f), q(f, 'SELECT status s FROM action_history').s])
    await assert.rejects(replay(f, r, 'undo', 0), (e) => e.statusCode === 409 && /revert_insufficient_(lot|branch)_stock/.test(e.code)
      && e.params.available === 7 && e.params.needed === 10 && e.refusal?.blocker?.movement_id === sale)
    assert.equal(JSON.stringify([lotQty(f, r.items[0].batchId), branch(f), product(f), q(f, 'SELECT status s FROM action_history').s]), before)
  })

  await check('a line reverted on its own in Stock Changes refuses the session Undo; reverting that Revert lets it through', async () => {
    const f = fixture()
    const r = await session(f, 'delta-revert-001', 10)
    const db = getDb(f.env)
    const memberId = r.items[0].movementId
    const row = (id) => q(f, 'SELECT * FROM inventory_movements WHERE id=?', id)
    const reverted = await ledger.applyMovementRevert(db, row(memberId), { userId: user.id, userName: 'test' })
    assert.equal(reverted.ok, true, JSON.stringify(reverted))
    assert.equal(branch(f), 0)
    await assert.rejects(replay(f, r, 'undo', 0), (e) => e.statusCode === 409 && e.code === 'revert_session_line_reverted')
    assert.equal(branch(f), 0, 'nothing taken twice')
    const counter = q(f, "SELECT id FROM inventory_movements WHERE reference_id=?", `revert:${memberId}`).id
    assert.equal((await ledger.applyMovementRevert(db, row(counter), { userId: user.id, userName: 'test' })).ok, true)
    assert.equal(branch(f), 10)
    await replay(f, r, 'undo', 0)
    assert.equal(branch(f), 0)
  })

  await check('a lot the session created and its undo released, then reused by a later receipt: the redo is refused (ABA)', async () => {
    const f = fixture()
    const a = await session(f, 'delta-aba-a-0001', 10)
    await replay(f, a, 'undo', 0)
    // What a later same-date unknown-cost receipt does to the released row
    // (stockSession.ts: it "can reuse the row and fill NULL fields").
    f.sql.exec(`UPDATE product_batches SET is_active=1, supplier_name='Supplier B', payment_status='credit', received_quantity=4 WHERE id=${a.items[0].batchId};
      UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=${a.items[0].batchId} AND branch_id=1;
      INSERT OR IGNORE INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(${a.items[0].batchId},1,4);
      UPDATE branch_stock SET quantity=quantity+4 WHERE product_id=1 AND branch_id=1; UPDATE products SET stock_quantity=stock_quantity+4 WHERE id=1;`)
    const before = JSON.stringify([lotQty(f, a.items[0].batchId), lot(f, a.items[0].batchId)])
    await assert.rejects(replay(f, a, 'redo', 1), (e) => e.statusCode === 409)
    assert.equal(JSON.stringify([lotQty(f, a.items[0].batchId), lot(f, a.items[0].batchId)]), before, 'B keeps its lot and attribution')
  })

  if (failures.length) { console.error(`\n${failures.length} failed: ${failures.join('; ')}`); process.exitCode = 1 } else console.log('test-stock-session-delta-replay: all checks passed')
}
main()
