'use strict'
// Count tasks against the REAL product merge and its Undo (harness/count-tasks-world.cjs: the real products route, the real merge kernel, the real action-history undo; no raw SQL and no foreign_keys=OFF).
// A product merged away leaves a task's total and lands in its removed figure; the keeper's own count can then close the task; the Undo of the merge returns the loser to the total of a task that is still open
// and leaves a closed task's frozen figures alone. Then each plant is applied to the source and must turn its scenario red with an AssertionError (an anchor that no longer matches, or any other error, is red too).
//
// Run: node scripts/test-inventory-check-task-merge-native.cjs
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const T = 'lib/inventoryCheckTasks.ts'
const P = 'routes/products.ts'
const KEEP = 400, LOSER = 401, OTHER = 100
const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 4).join('\n     ')}`) } }

async function kit(edits = {}) {
  const w = buildWorld(edits)
  await w.call('admin', 'GET', '/api/inventory-checks/tasks?branchId=1')
  w.stockWrite(() => {
    for (const id of [KEEP, LOSER]) {
      w.raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,created_at,updated_at)
        VALUES(?,'Twin',?,'8851234567890',20,9.5,38000,4,16000,'T','Cat',1,0,'2026-09-01 00:00:00','2026-09-01 00:00:00')`).run([id, `SKU${id}`])
      for (const b of [1, 2]) w.raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,10)').run([id, b])
    }
  })
  await w.bumpProducts()
  const ic = (who, method, url, body) => w.call(who, method, `/api/inventory-checks${url}`, body)
  return {
    w, ic,
    issue: async (productIds) => { await sleep(4); const r = await ic('admin', 'POST', '/tasks', { branchId: 1, requestId: w.rid('iss'), productIds }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.item.id },
    count: async (productIds, quantity = 10) => { await sleep(4); const r = await ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: w.rid('sub'), lines: productIds.map((productId) => ({ productId, countedQuantity: quantity, seenQuantity: quantity })) }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json },
    figures: async (id) => { const row = (await ic('admin', 'GET', '/tasks?branchId=1')).json.items.find((item) => item.id === id); return row && { status: row.status, total: row.total, done: row.done, removed: row.removed } },
    merge: async () => { await sleep(4); const r = await w.call('admin', 'POST', '/api/products/possible-duplicates/merge', { keepId: KEEP, mergeId: LOSER, stock: 'merge' }); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400)); assert.ok(r.json.actionHistoryId && r.json.undoReady, 'the merge records its Undo: ' + JSON.stringify({ id: r.json.actionHistoryId, ready: r.json.undoReady, committed: r.json.committed })); return r.json.actionHistoryId },
    undo: async (historyId) => { await sleep(4); const generation = JSON.parse(w.row('SELECT undo_payload FROM action_history WHERE id=?', historyId).undo_payload).generation; const r = await w.call('admin', 'POST', `/api/action-history/${historyId}/undo`, { require_applied: true, expected_generation: generation }); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400)); return r },
    active: (id) => w.row('SELECT is_active FROM products WHERE id=?', id).is_active,
  }
}

/** An open task holding the loser: the merge moves it from total to removed, the Undo moves it back, and the task is open throughout. */
async function openTask(edits) {
  const k = await kit(edits)
  const t = await k.issue([OTHER, KEEP, LOSER])
  await k.count([OTHER])
  assert.deepEqual(await k.figures(t), { status: 'open', total: 3, done: 1, removed: 0 })
  const history = await k.merge()
  assert.equal(k.active(LOSER), 0, 'the merge deactivated the loser'); assert.equal(k.active(KEEP), 1)
  assert.deepEqual(await k.figures(t), { status: 'open', total: 2, done: 1, removed: 1 }, 'the loser left the total and is counted in removed')
  await k.undo(history)
  assert.equal(k.active(LOSER), 1, 'the Undo reactivated the loser')
  assert.deepEqual(await k.figures(t), { status: 'open', total: 3, done: 1, removed: 0 }, 'the Undo returned the loser to the total; the task is not closed')
}

/** The keeper's own count closes a task whose loser was merged away; the closed task keeps its figures through the Undo of the merge. */
async function closeThenUndo(edits) {
  const k = await kit(edits)
  const t = await k.issue([KEEP, LOSER])
  const history = await k.merge()
  assert.deepEqual(await k.figures(t), { status: 'open', total: 1, done: 0, removed: 1 })
  const counted = await k.count([KEEP], 20)
  assert.deepEqual(counted.closedTasks, [t], 'the keeper count closes the task: the merged-away loser does not block it')
  const closed = await k.figures(t)
  assert.deepEqual(closed, { status: 'closed', total: 1, done: 1, removed: 1 })
  await k.undo(history)
  assert.deepEqual(await k.figures(t), closed, 'the Undo of the merge does not reopen a closed task or move its figures')
  assert.equal(k.active(LOSER), 1)
}

/** A task cannot be issued for the loser while it is merged away, and can again after the Undo. */
async function issueForLoser(edits) {
  const k = await kit(edits)
  const history = await k.merge()
  await sleep(4)
  const refused = await k.ic('admin', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('iss'), productIds: [LOSER] })
  assert.equal(refused.status, 400, JSON.stringify(refused.json)); assert.equal(refused.json.code, 'inventory_check_product_not_eligible')
  await k.undo(history)
  assert.equal((await k.ic('admin', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('iss'), productIds: [LOSER] })).status, 201)
}

const SCENARIOS = { openTask, closeThenUndo, issueForLoser }

// ---- the plants: each must turn the named scenario red -----------------------------------------------------------------------------------------------------------------------------------------
const DEACTIVATE = "statements.push({ sql: 'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: dup.id } })"
const COUNTABLE = 'export const TASK_COUNTABLE_SQL = `(${catalogProductSql(\'p\', false)} AND ${CHECKABLE_SQL} AND COALESCE(p.is_group,0)=0)`'
const MUTANTS = [
  ['G1 the merge writer leaves the loser active', { [P]: [[DEACTIVATE, "statements.push({ sql: 'UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: dup.id } })"]] }, 'openTask'],
  ['G2 a task still counts a product that is not active', { [T]: [[COUNTABLE, 'export const TASK_COUNTABLE_SQL = `(COALESCE(p.is_group,0)=0)`']] }, 'openTask'],
]

async function main() {
  for (const [name, run] of Object.entries(SCENARIOS)) await check(name, () => run())
  const killed = []
  for (const [name, edits, scenario] of MUTANTS) {
    let outcome = 'survived', why = ''
    try { await SCENARIOS[scenario](edits) } catch (error) {
      why = String(error && error.message || error).split('\n')[0].slice(0, 110)
      outcome = /must match once/.test(String(error && error.message)) ? 'anchor' : error instanceof assert.AssertionError ? 'killed' : 'crashed'
    }
    if (outcome === 'killed') { killed.push(name); passed++; console.log(`KILLED ${name} by ${scenario}: ${why}`) }
    else if (outcome === 'survived') { failures.push(`mutant survived: ${name}`); console.log(`SURVIVED ${name} (scenario ${scenario} stayed green)`) }
    else if (outcome === 'anchor') { failures.push(`RED ${name}: its anchor no longer matches`); console.log(`RED ${name}: anchor no longer matches (${why})`) }
    else { failures.push(`CRASHED ${name}`); console.log(`CRASHED ${name} in ${scenario}: ${why}`) }
  }
  console.log(`\n${passed} passed, ${failures.length} failed; ${killed.length}/${MUTANTS.length} plants killed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
}
main().catch((error) => { console.error(error); process.exit(1) })
