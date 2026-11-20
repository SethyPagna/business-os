'use strict'
// Count tasks, round 8c: the task board's cache is moved by every writer that changes a task's figures, and the figures stay exact for products that leave the catalogue. Over the real routes and migrations
// in an in-memory SQLite (harness/count-tasks-world.cjs). Each scenario warms the board of the branch, runs ONE writer, and reads the board again: a missing bump serves the old figure from the warm entry.
//   B1/B2  a lot Set sent to a branch that redirects (a disabled branch) lands at the OTHER branch: it is that branch's board that moves (POST /api/inventory/adjust, PATCH /api/batches/:id/branches/:b).
//   B3/B4  a lot Set that closes the last difference, with stock_bump_narrow ON (the 'products' version does not move): the board shows the task closed on the next read, on both routes.
//   B5/B6  a lot Set that changes nothing (a sale got there first) and closes the last difference: the same, on both routes.
//   B7     a plain Set that changes nothing (the zero path) and closes the last difference: the same.
//   F1     an open task whose counted product is deactivated afterwards: that product leaves the total and is not done, it is removed.
//   F2     a task the auto-close closes while it holds a deactivated product: the close records the removed product, and the board shows it.
// Run: node scripts/test-inventory-check-tasks-board-bumps-native.cjs [--mutant=<name>]   (a mutant plants a source edit in memory: every mutant must make at least one check fail)
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')

const ARG = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const MUTANT = ARG.mutant || 'none'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 5).join('\n     ')}`) } }

const ADJUST_LOT = "setBumps.push('inventory_checks', icTasksNamespace(Number(result.body.branchId) || branchId))"
const BATCH_LOT = "bumpNamespaces.push('inventory_checks', icTasksNamespace(Number(result.body.branchId) || branchId))"
const ZERO = "await bumpVersions(c.env, ['inventory_checks', icTasksNamespace(branchId)])"
const LIVE_FIGURES = "SUM(CASE WHEN ${taskItemCountableSql('t')} THEN CASE WHEN ${taskItemDoneSql('t', 'page.branch_id', 'page.started_at', '@org')} THEN"
const MUTANTS = {
  f2_adjust: { 'routes/inventory.ts': [[ADJUST_LOT, "setBumps.push('inventory_checks', icTasksNamespace(branchId))"]] },
  f2_batches: { 'routes/batches.ts': [[BATCH_LOT, "bumpNamespaces.push('inventory_checks', icTasksNamespace(branchId))"]] },
  m6_adjust: { 'routes/inventory.ts': [[ADJUST_LOT, "setBumps.push('inventory_checks')"]] },
  m6b_batches: { 'routes/batches.ts': [[BATCH_LOT, "bumpNamespaces.push('inventory_checks')"]] },
  m7_zero: { 'routes/inventory.ts': [[ZERO, "await bumpVersions(c.env, ['inventory_checks'])"]] },
  sq4_done_not_gated: { 'lib/inventoryCheckTasks.ts': [[LIVE_FIGURES, "SUM(CASE WHEN (${taskItemCountableSql('t')} OR ${taskItemDoneSql('t', 'page.branch_id', 'page.started_at', '@org')}) THEN CASE WHEN ${taskItemDoneSql('t', 'page.branch_id', 'page.started_at', '@org')} THEN"]] },
  sq7_removed_zero: { 'lib/inventoryCheckTasks.ts': [["'removed',COALESCE(c.f,0)%1000)", "'removed',0)"]] },
}
if (MUTANT !== 'none' && !MUTANTS[MUTANT]) throw new Error(`unknown mutant ${MUTANT}: ${Object.keys(MUTANTS).join(', ')}`)
const REDIRECT = ['lib/branchEffect.ts', [["const raw = String(c.req.header(BRANCH_REDIRECT_HEADER) ?? '').trim()", "const raw = '1'"]]]

function kit({ redirect = false, narrow = false } = {}) {
  const edits = JSON.parse(JSON.stringify(MUTANT === 'none' ? {} : MUTANTS[MUTANT]))
  if (redirect) edits[REDIRECT[0]] = [...(edits[REDIRECT[0]] || []), ...REDIRECT[1]]
  const w = buildWorld(edits)
  if (narrow) w.app.setSwitch('stock_bump_narrow', 'on')
  const ic = (who, method, url, body) => w.call(who, method, `/api/inventory-checks${url}`, body)
  const boardRuns = () => w.app.statements.filter((s) => s.includes('WITH open_t AS')).length
  const k = {
    w, ic, boardRuns,
    issue: async (products, branchId = 1) => { await sleep(4); const r = await ic('admin', 'POST', '/tasks', { branchId, requestId: w.rid('iss'), productIds: products }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.item.id },
    task: async (id, branch = 1) => (await ic('admin', 'GET', `/tasks?branchId=${branch}`)).json.items.find((item) => item.id === id),
    status: (id) => w.row('SELECT status FROM inventory_check_sessions WHERE id=?', id).status,
    /** A lot count that differs (counted 2, seen 3), rejected: its difference stays until a Set closes it. */
    lotDiffers: async (product = 130) => {
      await sleep(4)
      const s = await ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: w.rid('sub'), lines: [{ productId: product, lots: [{ batchId: product * 10 + 1, scope: 'lot', counted: 2, seen: 3 }, { batchId: product * 10 + 2, scope: 'lot', counted: 7, seen: 7 }] }] })
      assert.equal(s.status, 201, JSON.stringify(s.json))
      const rj = await ic('admin', 'POST', `/sessions/${s.json.item.id}/approval/lines`, { productId: product, action: 'reject', requestId: w.rid('rj') }); assert.equal(rj.status, 200, JSON.stringify(rj.json))
    },
    plainDiffers: async (product = 100) => {
      await sleep(4)
      const s = await ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: w.rid('sub'), lines: [{ productId: product, countedQuantity: 9, seenQuantity: 10 }] })
      assert.equal(s.status, 201, JSON.stringify(s.json))
      const rj = await ic('admin', 'POST', `/sessions/${s.json.item.id}/approval/lines`, { productId: product, action: 'reject', requestId: w.rid('rj') })
      assert.ok(rj.status === 200 || rj.status === 409 || rj.status === 404, JSON.stringify(rj.json))
    },
    /** A sale got there first: the lot at branch 1 already holds the counted figure (2), so a Set to 2 changes nothing. */
    lotDrops: async (product = 130) => {
      w.raw.exec('PRAGMA foreign_keys=OFF')
      w.stockWrite(() => {
        w.raw.prepare('UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=? AND branch_id=1').run([product * 10 + 1])
        w.raw.prepare('UPDATE branch_stock SET quantity=9 WHERE product_id=? AND branch_id=1').run([product])
        w.raw.prepare('UPDATE products SET stock_quantity=19 WHERE id=?').run([product])
      })
      w.raw.exec('PRAGMA foreign_keys=ON'); await w.bumpProducts()
    },
    plainDrops: async (product = 100) => {
      w.raw.exec('PRAGMA foreign_keys=OFF')
      w.stockWrite(() => { w.raw.prepare('UPDATE branch_stock SET quantity=9 WHERE product_id=? AND branch_id=1').run([product]); w.raw.prepare('UPDATE products SET stock_quantity=19 WHERE id=?').run([product]) })
      w.raw.exec('PRAGMA foreign_keys=ON'); await w.bumpProducts()
    },
    deactivate: async (product) => {
      w.raw.exec('PRAGMA foreign_keys=OFF')
      w.stockWrite(() => { w.raw.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=?').run([product]); w.raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=?').run([product]); w.raw.prepare('UPDATE products SET is_active=0 WHERE id=?').run([product]) })
      w.raw.exec('PRAGMA foreign_keys=ON'); await w.bumpProducts()
    },
    adjustLot: async (body) => { await sleep(4); return w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', reason: 'Physical count', client_request_id: 'inventory_set_' + w.rid('a'), ...body }) },
    batchSet: async (batchId, branchId, body) => { await sleep(4); return w.call('admin', 'PATCH', `/api/batches/${batchId}/branches/${branchId}`, { reason: 'Physical count', client_request_id: 'batch_set_' + w.rid('b'), ...body }) },
    plainSet: async (body) => { await sleep(4); return w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', reason: 'Physical count', client_request_id: 'inventory_set_' + w.rid('p'), ...body }) },
  }
  return k
}
/** The board of `branch` is warm: a second read does not run the board statement. */
async function warm(k, t, branch = 1) {
  const a = await k.task(t, branch); assert.equal(a.status, 'open'); const runs = k.boardRuns()
  await k.task(t, branch); assert.equal(k.boardRuns(), runs, 'the board is warm')
}
async function closedOnTheBoard(k, t, set) {
  assert.equal(set.status, 200, JSON.stringify(set.json)); assert.equal(set.json.issue_closed, true, JSON.stringify(set.json))
  assert.equal(k.status(t), 'closed', 'the task closed in the database')
  assert.equal((await k.task(t)).status, 'closed', 'and the warm board of its branch shows it closed on the next read')
}

async function main() {
  console.log(`mutant: ${MUTANT}`)
  await check('B1 a lot Set addressed to a disabled branch lands at branch 1, changes nothing and closes the difference: the board of branch 1 (the landing branch) shows the task closed', async () => {
    const k = kit({ redirect: true })
    await k.lotDiffers(130); const t = await k.issue([130]); await k.lotDrops(130)
    k.w.raw.prepare('UPDATE branches SET is_active=0 WHERE id=2').run([]); await warm(k, t)
    const s = await k.adjustLot({ productId: 130, branchId: 2, batchId: 1301, quantity: 2, expectedLotQuantity: 2 })
    assert.equal(s.json.branchId, 1, 'the answer names the landing branch')
    await closedOnTheBoard(k, t, s)
  })
  await check('B2 the same through PATCH /api/batches/:id/branches/:b', async () => {
    const k = kit({ redirect: true })
    await k.lotDiffers(130); const t = await k.issue([130]); await k.lotDrops(130)
    k.w.raw.prepare('UPDATE branches SET is_active=0 WHERE id=2').run([]); await warm(k, t)
    const s = await k.batchSet(1301, 2, { quantity: 2, expectedLotQuantity: 2 })
    assert.equal(s.json.branchId, 1, 'the answer names the landing branch')
    await closedOnTheBoard(k, t, s)
  })
  await check('B3 stock_bump_narrow ON: a lot Set that moves only quantities and closes the last difference shows the task closed at once (POST /api/inventory/adjust)', async () => {
    const k = kit({ narrow: true })
    await k.lotDiffers(130); const t = await k.issue([130]); await warm(k, t)
    await closedOnTheBoard(k, t, await k.adjustLot({ productId: 130, branchId: 1, batchId: 1301, quantity: 2, expectedLotQuantity: 3 }))
  })
  await check('B4 stock_bump_narrow ON: the same through PATCH /api/batches/:id/branches/:b', async () => {
    const k = kit({ narrow: true })
    await k.lotDiffers(130); const t = await k.issue([130]); await warm(k, t)
    await closedOnTheBoard(k, t, await k.batchSet(1301, 1, { quantity: 2, expectedLotQuantity: 3 }))
  })
  await check('B5 a lot Set that changes nothing and closes the last difference shows the task closed at once (POST /api/inventory/adjust)', async () => {
    const k = kit()
    await k.lotDiffers(130); const t = await k.issue([130]); await k.lotDrops(130); await warm(k, t)
    await closedOnTheBoard(k, t, await k.adjustLot({ productId: 130, branchId: 1, batchId: 1301, quantity: 2, expectedLotQuantity: 2 }))
  })
  await check('B6 the same through PATCH /api/batches/:id/branches/:b', async () => {
    const k = kit()
    await k.lotDiffers(130); const t = await k.issue([130]); await k.lotDrops(130); await warm(k, t)
    await closedOnTheBoard(k, t, await k.batchSet(1301, 1, { quantity: 2, expectedLotQuantity: 2 }))
  })
  await check('B7 a plain Set that changes nothing (the zero path) and closes the last difference shows the task closed at once', async () => {
    const k = kit()
    await k.plainDiffers(100); const t = await k.issue([100]); await k.plainDrops(100); await warm(k, t)
    await closedOnTheBoard(k, t, await k.plainSet({ productId: 100, branchId: 1, quantity: 9 }))
  })
  await check('F1 an open task whose counted product is deactivated afterwards: the product leaves the total, is not done, and is removed', async () => {
    const k = kit(), t = await k.issue([100, 101])
    const s = await k.ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: k.w.rid('sub'), lines: [{ productId: 100, countedQuantity: 10, seenQuantity: 10 }] }); assert.equal(s.status, 201, JSON.stringify(s.json))
    const before = await k.task(t); assert.deepEqual([before.status, before.total, before.done, before.removed], ['open', 2, 1, 0])
    await k.deactivate(100)
    const after = await k.task(t); assert.deepEqual([after.status, after.total, after.done, after.removed], ['open', 1, 0, 1], 'total, done and removed')
  })
  await check('F2 a task the auto-close closes while it holds a deactivated product: the close records the removed product (not 0), and the board shows it', async () => {
    const k = kit(), t = await k.issue([100, 101, 102])
    await k.deactivate(102)
    for (const p of [100, 101]) { const s = await k.ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: k.w.rid('sub'), lines: [{ productId: p, countedQuantity: 10, seenQuantity: 10 }] }); assert.equal(s.status, 201, JSON.stringify(s.json)); await sleep(4) }
    assert.equal(k.status(t), 'closed', 'the last countable product closed the task')
    const event = JSON.parse(k.w.row("SELECT after_json FROM inventory_check_events WHERE session_id=? AND action='close' ORDER BY id DESC LIMIT 1", t).after_json)
    assert.deepEqual([event.total, event.done, event.removed], [2, 2, 1], 'the close event records one removed product')
    const shown = await k.task(t); assert.deepEqual([shown.total, shown.done, shown.removed], [2, 2, 1])
  })
  console.log(`${passed} checks passed${failures.length ? `, ${failures.length} FAILED` : ''}`)
  console.log(`RESULT ${JSON.stringify({ mutant: MUTANT, failed: failures.map((f) => f.split(' ')[0]) })}`)
  process.exit(failures.length ? 1 : 0)
}
main().catch((error) => { console.error(error); process.exit(1) })
