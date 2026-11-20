'use strict'
// Count tasks, the two plan caps at their own boundary (harness/count-tasks-world.cjs, the real routes and migrations in an in-memory SQLite).
// Free: 10 open tasks per branch, 100 products per task. Paid: 30 open tasks, 300 products. An ISSUE at the open cap is refused 409 inventory_check_task_limit; a product list over the cap is refused 400
// inventory_check_task_too_many; a TAKE-BACK (the resume of a closed count session a task rested on) reopens the task past the open cap and is never refused. Then every plant is applied to the source and must
// turn its scenario red with an AssertionError (an anchor that no longer matches, or any other error, is red too, never a kill).
//
// Run: node scripts/test-inventory-check-task-caps-native.cjs
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const TIERS = { free: { open: 10, products: 100 }, paid: { open: 30, products: 300 } }
const S = 'lib/inventoryCheckSessions.ts'
const T = 'lib/inventoryCheckTasks.ts'
const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 4).join('\n     ')}`) } }

async function world(tier, edits = {}) {
  const w = buildWorld(edits)
  const env = { ...w.app.env, PLAN_TIER: tier }
  const send = async (who, method, url, body) => { w.as(who); return w.app.send(method, url, body, env) }
  await w.call('admin', 'GET', '/api/inventory-checks/tasks?branchId=1')
  const ic = (who, method, url, body) => send(who, method, `/api/inventory-checks${url}`, body)
  const k = {
    w, ic, send,
    issue: async (productIds, extra = {}) => { await sleep(4); return ic('admin', 'POST', '/tasks', { branchId: 1, requestId: w.rid('iss'), productIds, ...extra }) },
    close: async (id) => ic('admin', 'PATCH', `/sessions/${id}`, { expectedRevision: 0, requestId: w.rid('close'), action: 'close' }),
    board: async () => (await ic('admin', 'GET', '/tasks?branchId=1')).json,
    taskRows: () => w.row("SELECT COUNT(*) AS n FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='task'").n,
    bulk: async (from, count, brand) => {
      w.stockWrite(() => {
        for (let id = from; id < from + count; id++) {
          w.raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,created_at,updated_at)
            VALUES(?,?,?,?,20,9.5,38000,4,16000,?,'Cat',1,0,'2026-09-01 00:00:00','2026-09-01 00:00:00')`).run([id, `Bulk ${id}`, `SKU${id}`, `88500${id}`, brand])
          for (const b of [1, 2]) w.raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,10)').run([id, b])
        }
      })
      await w.bumpProducts()
    },
  }
  return k
}
const ids = (from, count) => Array.from({ length: count }, (_, i) => from + i)

/** The open cap: the Nth issue answers 201, the N+1th answers 409 with the open count and the limit, and closing one frees exactly one place. */
async function openCap(tier, edits) {
  const cap = TIERS[tier].open, k = await world(tier, edits)
  assert.equal((await k.board()).capabilities.maxOpenTasks, cap, `the board says the ${tier} cap`)
  const made = []
  for (let n = 0; n < cap; n++) { const r = await k.issue([101 + (n % 15)]); assert.equal(r.status, 201, `task ${n + 1} of ${cap}: ${JSON.stringify(r.json)}`); made.push(r.json.item.id) }
  const refused = await k.issue([101])
  assert.equal(refused.status, 409, JSON.stringify(refused.json)); assert.equal(refused.json.code, 'inventory_check_task_limit')
  assert.equal(refused.json.open, cap); assert.equal(refused.json.limit, cap)
  assert.equal(k.taskRows(), cap, 'a refused issue writes nothing')
  assert.equal((await k.board()).items.filter((t) => t.status === 'open').length, cap, 'the board lists every open task')
  assert.equal((await k.close(made[0])).status, 200)
  assert.equal((await k.issue([102])).status, 201, 'closing one frees one place')
  const again = await k.issue([103])
  assert.equal(again.status, 409, 'and the place is taken again'); assert.equal(again.json.open, cap); assert.equal(again.json.limit, cap)
  assert.equal(k.taskRows(), cap + 1, 'the closed task stays a row; open is back at the cap')
}

/** The product cap: a list of exactly N answers 201, N+1 answers 400 with the total and the limit, on the id path and the filter path. */
async function productCap(tier, edits) {
  const cap = TIERS[tier].products, k = await world(tier, edits)
  await k.bulk(300, cap, 'Y'); await k.bulk(300 + cap, cap + 1, 'Z')
  const exact = await k.issue(ids(300, cap))
  assert.equal(exact.status, 201, JSON.stringify(exact.json).slice(0, 300)); assert.equal(exact.json.item.progress.total, cap)
  const before = k.taskRows()
  const over = await k.issue(ids(300, cap + 1))
  assert.equal(over.status, 400, JSON.stringify(over.json).slice(0, 300)); assert.equal(over.json.code, 'inventory_check_task_too_many'); assert.equal(over.json.total, cap + 1); assert.equal(over.json.limit, cap)
  const mixed = await k.issue([...ids(300, cap), 140])
  assert.equal(mixed.status, 400, JSON.stringify(mixed.json).slice(0, 300)); assert.equal(mixed.json.code, 'inventory_check_task_too_many', 'the count of what was asked is checked first'); assert.equal(mixed.json.total, cap + 1); assert.equal(mixed.json.limit, cap)
  const ghost = await k.issue([...ids(300, cap - 1), 140])
  assert.equal(ghost.status, 400); assert.equal(ghost.json.code, 'inventory_check_product_not_eligible', 'at the cap with one ineligible product the refusal is the eligibility one')
  const byFilter = await k.ic('admin', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('f'), filters: { brand: 'Y' } })
  assert.equal(byFilter.status, 201, JSON.stringify(byFilter.json).slice(0, 300)); assert.equal(byFilter.json.item.progress.total, cap)
  const filterOver = await k.ic('admin', 'POST', '/tasks', { branchId: 1, requestId: k.w.rid('f'), filters: { brand: 'Z' } })
  assert.equal(filterOver.status, 400, JSON.stringify(filterOver.json).slice(0, 300)); assert.equal(filterOver.json.code, 'inventory_check_task_too_many'); assert.equal(filterOver.json.limit, cap); assert.ok(filterOver.json.total >= cap + 1, 'the total is what the filter holds, so the admin can narrow it')
  assert.equal(k.taskRows(), before + 1, 'only the exact-size id task and the exact-size filter task were written')
  assert.equal((await k.board()).capabilities.maxProducts, cap)
}

/** A take-back at the open cap still reopens: the branch then holds cap+1 open tasks, the board lists all of them, and the next issue is refused with the real open count. */
async function takeBack(tier, edits) {
  const cap = TIERS[tier].open, k = await world(tier, edits)
  const first = await k.issue([100]); assert.equal(first.status, 201, JSON.stringify(first.json)); const target = first.json.item.id
  await sleep(4)
  const made = await k.ic('emp1', 'POST', '/sessions', { branchId: 1, requestId: k.w.rid('s'), productIds: [100], scope: { membership: 'visible_page' } }); assert.equal(made.status, 201, JSON.stringify(made.json))
  const sessionId = made.json.item.id
  const counted = await k.ic('emp1', 'PATCH', `/sessions/${sessionId}/items/100`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: k.w.rid('o'), state: 'done', counted_quantity: 10 }); assert.equal(counted.status, 200, JSON.stringify(counted.json))
  await sleep(4)
  const closed = await k.ic('emp1', 'PATCH', `/sessions/${sessionId}`, { expectedRevision: 0, requestId: k.w.rid('c'), action: 'close' }); assert.equal(closed.status, 200, JSON.stringify(closed.json))
  assert.equal(k.w.row('SELECT status FROM inventory_check_sessions WHERE id=?', target).status, 'closed', 'the count closed the task it covered')
  for (let n = 0; n < cap; n++) { const r = await k.issue([101 + (n % 15)]); assert.equal(r.status, 201, `fill ${n + 1} of ${cap}: ${JSON.stringify(r.json)}`) }
  const full = await k.issue([101]); assert.equal(full.status, 409, 'the branch is at its cap'); assert.equal(full.json.open, cap)
  await sleep(4)
  const resumed = await k.ic('emp1', 'PATCH', `/sessions/${sessionId}`, { expectedRevision: 1, requestId: k.w.rid('r'), action: 'resume' })
  assert.equal(resumed.status, 200, `a take-back at the cap is never refused: ${JSON.stringify(resumed.json)}`)
  assert.equal(k.w.row('SELECT status FROM inventory_check_sessions WHERE id=?', target).status, 'open', 'the task reopened')
  const board = await k.board()
  assert.equal(board.items.filter((t) => t.status === 'open').length, cap + 1, 'the board lists all of the open tasks, one over the cap')
  assert.ok(board.items.some((t) => t.id === target && t.status === 'open'))
  const after = await k.issue([101]); assert.equal(after.status, 409); assert.equal(after.json.open, cap + 1, 'the refusal names the real open count'); assert.equal(after.json.limit, cap)
}

const SCENARIOS = {
  openCapFree: (e) => openCap('free', e), openCapPaid: (e) => openCap('paid', e),
  productCapFree: (e) => productCap('free', e), productCapPaid: (e) => productCap('paid', e),
  takeBackFree: (e) => takeBack('free', e), takeBackPaid: (e) => takeBack('paid', e),
}

// ---- the plants: each must turn the named scenario red -----------------------------------------------------------------------------------------------------------------------------------------
const ISSUE_CAP = '{ ...params, maxOpenTasks: issue.maxOpenTasks }),'
const ASKED = 'if (asked.length > issue.maxProducts && !issue.dropIneligible) fail('
const RESOLVED = 'if (products.length > issue.maxProducts) fail('
const REOPEN_WHERE = "WHERE ${autoClosedSql('t')}`"
const reopenCap = (n) => `WHERE \${autoClosedSql('t')} AND (SELECT COUNT(*) FROM inventory_check_sessions o WHERE o.organization_id IS @org AND json_extract(o.scope_json,'$.membership')='task' AND o.branch_id=@branchId AND o.status='open')<${n}\``
const MUTANTS = [
  ['W1 Free branches accept 30 open tasks (the guard reads max(30, cap))', { [S]: [[ISSUE_CAP, '{ ...params, maxOpenTasks: Math.max(30, issue.maxOpenTasks) }),']] }, 'openCapFree'],
  ['W1p Paid branches accept more than 30 open tasks (the guard reads max(60, cap))', { [S]: [[ISSUE_CAP, '{ ...params, maxOpenTasks: Math.max(60, issue.maxOpenTasks) }),']] }, 'openCapPaid'],
  ['W1e Free: one open task too many (the guard reads <= cap)', { [S]: [['guard(`(${OPEN_TASK_COUNT_SQL})<@maxOpenTasks`', 'guard(`(${OPEN_TASK_COUNT_SQL})<=@maxOpenTasks`']] }, 'openCapFree'],
  ['W1e Paid: one open task too many (the guard reads <= cap)', { [S]: [['guard(`(${OPEN_TASK_COUNT_SQL})<@maxOpenTasks`', 'guard(`(${OPEN_TASK_COUNT_SQL})<=@maxOpenTasks`']] }, 'openCapPaid'],
  ['W2 Free accepts ids up to 300 (both product checks read max(300, cap))', { [S]: [[ASKED, 'if (asked.length > Math.max(300, issue.maxProducts) && !issue.dropIneligible) fail('], [RESOLVED, 'if (products.length > Math.max(300, issue.maxProducts)) fail(']] }, 'productCapFree'],
  ['W2a Free: the count of what was asked is checked against max(300, cap)', { [S]: [[ASKED, 'if (asked.length > Math.max(300, issue.maxProducts) && !issue.dropIneligible) fail(']] }, 'productCapFree'],
  ['W2p Paid accepts ids up to 600 (both product checks read max(600, cap))', { [S]: [[ASKED, 'if (asked.length > Math.max(600, issue.maxProducts) && !issue.dropIneligible) fail('], [RESOLVED, 'if (products.length > Math.max(600, issue.maxProducts)) fail(']] }, 'productCapPaid'],
  ['W2e Free: one product too many (>= cap on both checks)', { [S]: [[ASKED, 'if (asked.length >= issue.maxProducts && !issue.dropIneligible) fail('], [RESOLVED, 'if (products.length >= issue.maxProducts) fail(']] }, 'productCapFree'],
  ['W2e Paid: one product too many (>= cap on both checks)', { [S]: [[ASKED, 'if (asked.length >= issue.maxProducts && !issue.dropIneligible) fail('], [RESOLVED, 'if (products.length >= issue.maxProducts) fail(']] }, 'productCapPaid'],
  ['TB10 Free: the reopen is refused at 10 open tasks', { [T]: [[REOPEN_WHERE, reopenCap(10)]] }, 'takeBackFree'],
  ['TB30 Paid: the reopen is refused at 30 open tasks', { [T]: [[REOPEN_WHERE, reopenCap(30)]] }, 'takeBackPaid'],
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
