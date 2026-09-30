const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')
const tables = ['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'stock_session_operations', 'stock_session_members', 'stock_session_revisions', 'stock_lot_adjustment_operations', 'action_history', 'undo_snapshots', 'audit_logs']
const state = f => tables.map(t => [t, f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])
const route = loadStockSession('routes/actionHistory.ts').default
async function call(f, method, url, body, actor = user) {
  const target = actor === user ? route : loadStockSession('routes/actionHistory.ts', actor).default
  const res = await target.request(url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, f.env, { waitUntil: p => p.catch(() => {}), passThroughOnException: () => {} })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const preview = (f, id, actor) => call(f, 'GET', `/movements/${id}/revert-preview`, undefined, actor)
const replay = (f, p, actor) => call(f, 'POST', `/${p.historyId}/${p.direction}`, { require_applied: true, expected_generation: p.expectedGeneration }, actor)
const denied = { ...user, permissions: JSON.stringify({ inventory: true, 'inventory:adjust': false, products: true }) }

async function main() {
  const f = fixture()
  try {
    const api = loadStockSession()
    const request = receiveRequest('movement-preview-session', 5)
    request.items.push({ line_id: 'second', kind: 'create_receive', quantity: 3, unit_cost_usd: 2, product: { name: 'Second', barcode: 'SECOND', cost_price_usd: 2 } })
    const receipt = await api.commitStockSession(f.env, user, request)
    const firstMovement = receipt.items[0].movementId
    const beforePreview = state(f)
    const first = await preview(f, firstMovement)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.deepEqual(state(f), beforePreview, 'preview is read-only')
    const p = first.body.revert
    assert.deepEqual([p.kind, p.historyId, p.operationId, p.expectedGeneration, p.direction, p.lineCount], ['stock_session', receipt.actionHistoryId, receipt.operationId, 0, 'undo', 2])
    assert.equal((await preview(f, firstMovement, denied)).status, 403)
    assert.ok([403, 404].includes((await replay(f, p, denied)).status))
    const noProductAdd = { ...user, permissions: JSON.stringify({ inventory: true, products: true, 'products:add': false }) }
    assert.equal((await preview(f, firstMovement, noProductAdd)).status, 403)
    assert.ok([403, 404].includes((await replay(f, p, noProductAdd)).status))
    const otherActor = { ...user, id: 8 }
    assert.equal((await preview(f, firstMovement, otherActor)).status, 403)
    assert.ok([403, 404].includes((await replay(f, p, otherActor)).status))
    assert.equal((await preview(f, 'bad')).status, 400)
    assert.equal((await preview(f, 999999)).status, 404)
    assert.deepEqual(state(f), beforePreview)
    f.failWhenSqlMatches(/INSERT INTO inventory_movements/)
    assert.equal((await replay(f, p)).status, 500)
    assert.deepEqual(state(f), beforePreview, 'failure after stock changes rolls back the whole session and history')
    assert.equal((await replay(f, p)).status, 200)
    assert.deepEqual(f.sql.prepare('SELECT stock_quantity FROM products ORDER BY id').all(), [{ stock_quantity: 0 }, { stock_quantity: 0 }])
    const undone = state(f)
    assert.equal((await preview(f, firstMovement)).body.code, 'undo_history_stale', 'fresh preview never offers an already-reversed row')
    assert.equal((await replay(f, p)).status, 200)
    assert.deepEqual(state(f), undone, 'lost response retry does not repeat whole-session undo')
    const counter = f.sql.prepare('SELECT id FROM inventory_movements ORDER BY id DESC LIMIT 1').get().id
    const counterPreview = await preview(f, counter)
    assert.equal(counterPreview.status, 200, JSON.stringify(counterPreview.body))
    assert.deepEqual([counterPreview.body.revert.direction, counterPreview.body.revert.expectedGeneration], ['redo', 1])
    assert.equal((await replay(f, counterPreview.body.revert)).status, 200)
    assert.deepEqual(f.sql.prepare('SELECT stock_quantity FROM products ORDER BY id').all(), [{ stock_quantity: 5 }, { stock_quantity: 3 }])
    assert.equal((await preview(f, firstMovement)).status, 409)
    const afterRedo = state(f)
    assert.equal((await replay(f, p)).status, 409)
    assert.deepEqual(state(f), afterRedo)
    const latest = f.sql.prepare('SELECT id FROM inventory_movements ORDER BY id DESC LIMIT 1').get().id
    f.sql.prepare('UPDATE inventory_movements SET reason=? WHERE id=?').run('Edited receipt note', latest)
    const edited = state(f)
    const editedPreview = await preview(f, latest)
    assert.equal(editedPreview.status, 200, 'editing display reason must preserve current immutable replay identity')
    assert.deepEqual(state(f), edited)
    assert.equal((await replay(f, editedPreview.body.revert)).status, 200)
    f.sql.prepare('UPDATE inventory_movements SET reason=? WHERE id=?').run(`Stock session ${receipt.operationId} undo generation 3`, counter)
    assert.equal((await preview(f, counter)).status, 409, 'forging current generation into old display text cannot revive an old row')
    const current = f.sql.prepare('SELECT id FROM inventory_movements ORDER BY id DESC LIMIT 1').get().id
    const currentPreview = await preview(f, current)
    assert.equal(currentPreview.status, 200)
    assert.equal(currentPreview.body.revert.expectedGeneration, 3)
    const attacks = [
      ['same-reference identical counter collision', () => f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,batch_id,movement_type,quantity,reference_id,reason)
        SELECT product_id,branch_id,batch_id,movement_type,quantity,reference_id,reason FROM inventory_movements WHERE id=?`).run(current)],
      ['partial latest block', () => f.sql.prepare('DELETE FROM inventory_movements WHERE id=?').run(current - 1)],
      ['reordered generation types', () => f.sql.prepare("UPDATE inventory_movements SET movement_type='add' WHERE id=?").run(current - 1)],
      ['earlier block quantity drift', () => f.sql.prepare('UPDATE inventory_movements SET quantity=quantity-1 WHERE id=?').run(counter)],
      ['operation/history mismatch', () => f.sql.prepare("UPDATE action_history SET undo_payload=json_set(undo_payload,'$.generation',4) WHERE id=?").run(receipt.actionHistoryId)],
      ['missing generation block', () => f.sql.prepare('UPDATE stock_session_operations SET generation=4 WHERE id=?').run(receipt.operationId)],
      ['bounded lineage', () => f.sql.prepare('UPDATE stock_session_operations SET generation=501 WHERE id=?').run(receipt.operationId), 'undo_preview_limit'],
    ]
    for (const [name, mutate, code] of attacks) {
      f.sql.exec('SAVEPOINT identity_attack')
      mutate()
      const before = state(f)
      const refused = await preview(f, current)
      assert.equal(refused.status, 409, name)
      if (code) assert.equal(refused.body.code, code)
      assert.deepEqual(state(f), before, `${name} changes nothing`)
      f.sql.exec('ROLLBACK TO identity_attack; RELEASE identity_attack')
    }
    f.sql.exec('SAVEPOINT duplicate_members')
    const firstMember = f.sql.prepare('SELECT product_id,branch_id,batch_id,quantity FROM stock_session_members WHERE movement_id=?').get(firstMovement)
    const secondMember = receipt.items[1]
    f.sql.prepare('UPDATE stock_session_members SET product_id=?,branch_id=?,batch_id=?,quantity=? WHERE movement_id=?')
      .run(firstMember.product_id, firstMember.branch_id, firstMember.batch_id, firstMember.quantity, secondMember.movementId)
    f.sql.prepare('UPDATE inventory_movements SET product_id=?,branch_id=?,batch_id=?,quantity=CASE WHEN quantity<0 THEN -? ELSE ? END WHERE product_id=?')
      .run(firstMember.product_id, firstMember.branch_id, firstMember.batch_id, firstMember.quantity, firstMember.quantity, secondMember.productId)
    assert.equal((await preview(f, current)).status, 200, 'identical member multiplicities are preserved by whole-block comparison')
    f.sql.exec('ROLLBACK TO duplicate_members; RELEASE duplicate_members')
    f.sql.exec('SAVEPOINT zero_member')
    f.sql.prepare("INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,product_created,branch_id,quantity) VALUES(?,'zero-only','receive',1,0,1,0)").run(receipt.operationId)
    const withZero = await preview(f, current)
    assert.equal(withZero.status, 200)
    assert.equal(withZero.body.revert.lineCount, 3, 'zero-movement members count in whole action but not replay blocks')
    f.sql.exec('ROLLBACK TO zero_member; RELEASE zero_member')
    const plan = f.sql.prepare('EXPLAIN QUERY PLAN SELECT id,product_id,branch_id,batch_id,movement_type,quantity,reference_id FROM inventory_movements WHERE reference_id=? AND movement_type=? AND id>? ORDER BY id LIMIT ?').all('1', 'remove', firstMovement, 1001)
    assert.ok(plan.some(row => /idx_inventory_movements_reference_type_id/.test(row.detail)))
    assert.ok(plan.every(row => !/TEMP B-TREE|SCAN inventory_movements/.test(row.detail)), 'bounded per-type range reads need no whole-reference sort')
    console.log('PASS Stock Changes session preview, whole-operation replay, cross-surface generations, permission denial and retry safety')
    console.log('PASS immutable session lineage survives edited reasons, refuses forged/stale/colliding/incomplete generations and bounds indexed reads')
  } finally { f.sql.close() }

  const s = fixture()
  try {
    const received = await loadStockSession().commitStockSession(s.env, user, receiveRequest('set-seed', 5))
    const batchId = received.items[0].batchId
    const db = loadStockSession('lib/db.ts').getDb(s.env)
    const set = await loadStockSession('lib/stockLotAdjustment.ts').applyStockLotSet(db, user, 'preview-set', { productId: 1, branchId: 1, batchId, quantity: 2, setScope: 'lot', reason: 'Fixture count', conditionTag: null })
    assert.equal(set.status, 200)
    const movement = s.sql.prepare('SELECT id FROM inventory_movements ORDER BY id DESC LIMIT 1').get().id
    const p = (await preview(s, movement)).body.revert
    assert.equal(p.kind, 'stock_set')
    assert.deepEqual([p.direction, p.expectedGeneration, p.lineCount], ['undo', 0, 1])
    assert.ok(p.label.includes('Fixture') || p.label.length > 0)
    assert.equal((await replay(s, p)).status, 200)
    assert.equal(s.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 5)
    const counter = s.sql.prepare('SELECT id FROM inventory_movements ORDER BY id DESC LIMIT 1').get().id
    const redo = (await preview(s, counter)).body.revert
    assert.deepEqual([redo.kind, redo.direction, redo.expectedGeneration], ['stock_set', 'redo', 1])
    assert.equal((await replay(s, redo)).status, 200)
    assert.equal(s.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 2)
    const afterRedo = state(s)
    assert.equal((await replay(s, redo)).status, 200)
    assert.deepEqual(state(s), afterRedo)
    assert.equal((await preview(s, movement)).status, 409)
    const latest = s.sql.prepare('SELECT id FROM inventory_movements ORDER BY id DESC LIMIT 1').get().id
    const newer = (await preview(s, latest)).body.revert
    s.sql.prepare('UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=? AND branch_id=1').run(batchId)
    const changed = state(s)
    assert.equal((await replay(s, newer)).status, 409)
    assert.deepEqual(state(s), changed, 'intervening stock change keeps all history guards')
    console.log('PASS Set forward/counter previews share History undo/redo and refuse stale or changed stock without writes')
  } finally { s.sql.close() }

  const legacy = fixture()
  try {
    for (const [type, reference] of [['add', null], ['remove', 'revert:999'], ['sale', 'sale:1'], ['transfer_out', 'transfer:1'], ['adjustment', 'stock-line-edit:1:0'], ['in', 'damaged-stock:1']]) {
      const id = Number(legacy.sql.prepare('INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reference_id) VALUES(1,1,?,?,?)').run(type, 1, reference).lastInsertRowid)
      const before = state(legacy)
      const result = await preview(legacy, id)
      assert.equal(result.status, 200, JSON.stringify(result.body))
      assert.deepEqual(result.body.revert, { kind: 'movement', movementId: id, lineCount: 1 }, 'ordinary or restricted movements never gain History mutation authority')
      assert.deepEqual(state(legacy), before)
    }
    console.log('PASS ordinary and separately guarded movements keep their existing inventory endpoint and gain no History authority')
  } finally { legacy.sql.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
