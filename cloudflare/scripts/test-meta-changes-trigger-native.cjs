'use strict'
// D1 counts the rows a trigger writes in meta.changes (the harness emulates it: D1Compat.countTriggerRows()). Two Inventory Check readers decided "a row changed" with `=== 1`:
//   T1 plain Revert of a Set that closed a difference takes the Set's count back (UPDATE inventory_check_items SET state='unstarted'): lib/stockRevert.ts answers countChanged from that statement,
//      and the route then moves the inventory_checks version. With a writing trigger on inventory_check_items the number is 2+, so the take-back was reported as "nothing taken back" and the
//      version stayed (a warm list kept showing the count);
//   T2 a plain Set that closes a difference answers issue_closed from the INSERT of its session (lib/stockSetClosesIssue.ts): with a writing trigger on inventory_check_sessions it answered false.
// Each scenario also runs without the trigger (the positive control: same answer), and every plant of the old check must turn a scenario red.
// Run: node scripts/test-meta-changes-trigger-native.cjs
const assert = require('node:assert/strict')
const { buildWorld } = require('./harness/count-tasks-world.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 5).join('\n     ')}`) } }

const TRIGGERS = {
  items: 'CREATE TABLE trg_scratch_items(n INTEGER); CREATE TRIGGER trg_scratch_items_upd AFTER UPDATE ON inventory_check_items BEGIN INSERT INTO trg_scratch_items(n) VALUES (1); END; CREATE TRIGGER trg_scratch_items_ins AFTER INSERT ON inventory_check_items BEGIN INSERT INTO trg_scratch_items(n) VALUES (1); END;',
  sessions: 'CREATE TABLE trg_scratch_sessions(n INTEGER); CREATE TRIGGER trg_scratch_sessions_ins AFTER INSERT ON inventory_check_sessions BEGIN INSERT INTO trg_scratch_sessions(n) VALUES (1); END; CREATE TRIGGER trg_scratch_sessions_upd AFTER UPDATE ON inventory_check_sessions BEGIN INSERT INTO trg_scratch_sessions(n) VALUES (1); END;',
}

function kit(sourceEdits, triggers) {
  const w = buildWorld(sourceEdits)
  w.raw.countTriggerRows()
  const ic = (who, method, url, body) => w.call(who, method, `/api/inventory-checks${url}`, body)
  const cache = w.app.load('lib/cache.ts')
  return {
    w, ic,
    install: () => { for (const sql of triggers) w.raw.exec(sql) },
    version: () => cache.getVersionWithFallback(w.app.env, 'inventory_checks'),
    status: (id) => w.row('SELECT status FROM inventory_check_sessions WHERE id=?', id).status,
    issue: async (products) => { await sleep(4); const r = await ic('admin', 'POST', '/tasks', { branchId: 1, requestId: w.rid('iss'), productIds: products }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.item.id },
  }
}

/** A Differs count of product 105 (rejected, so it stays an Issue), a task on it, then the plain Set that closes the difference. Returns the Set's answer and the Revert of its movement. */
async function setThenRevert(k, { revert = true } = {}) {
  const { w, ic } = k
  await sleep(4)
  const s0 = await ic('emp1', 'POST', '/submissions', { branchId: 1, requestId: w.rid('sub'), lines: [{ productId: 105, countedQuantity: 8, seenQuantity: 10 }] }); assert.equal(s0.status, 201, JSON.stringify(s0.json))
  const rj = await ic('admin', 'POST', `/sessions/${s0.json.item.id}/approval/lines`, { productId: 105, action: 'reject', requestId: w.rid('rj') }); assert.equal(rj.status, 200, JSON.stringify(rj.json))
  const t = await k.issue([105])
  k.install()
  await sleep(4)
  const set = await w.call('admin', 'POST', '/api/inventory/adjust', { type: 'set', productId: 105, branchId: 1, quantity: 8, reason: 'Physical count', client_request_id: 'inventory_set_' + w.rid('p') })
  assert.equal(set.status, 200, JSON.stringify(set.json))
  if (!revert) return { t, set }
  assert.equal(k.status(t), 'closed', 'the Set closed the difference and the task')
  const movement = w.row('SELECT MAX(id) AS id FROM inventory_movements').id
  const before = await k.version()
  await sleep(4)
  const undo = await w.call('admin', 'POST', `/api/inventory/movements/${movement}/revert`, {}); assert.equal(undo.status, 200, JSON.stringify(undo.json))
  return { t, set, before, after: await k.version(), undo }
}

const T1 = async (edits, triggers) => {
  const k = kit(edits, triggers)
  const { t, before, after } = await setThenRevert(k)
  assert.equal(k.status(t), 'open', 'the Revert took the Set count back and the task reopened')
  assert.notEqual(after, before, 'the Revert reported the count taken back: the inventory_checks version moved, so a warm list does not keep showing the count')
}
const T2 = async (edits, triggers) => {
  const k = kit(edits, triggers)
  const { t, set } = await setThenRevert(k, { revert: false })
  assert.equal(set.json.issue_closed, true, 'the Set closed the difference and says so')
  assert.equal(k.status(t), 'closed')
}

const OLD_REVERT = ["countChanged = Number((results.slice(-countPart.statements.length)[countPart.changedAt] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) > 0", "countChanged = Number((results.slice(-countPart.statements.length)[countPart.changedAt] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) === 1"]
const OLD_SET = ["issue_closed: Number(tail[0]?.meta?.changes ?? 0) > 0", "issue_closed: Number(tail[0]?.meta?.changes ?? 0) === 1"]
const MUTANTS = [
  ['M1 stockRevert reads exactly one changed row', { 'lib/stockRevert.ts': [OLD_REVERT] }, 'T1 items'],
  ['M2 stockSetClosesIssue reads exactly one changed row', { 'lib/stockSetClosesIssue.ts': [OLD_SET] }, 'T2 sessions'],
]

async function main() {
  await check('T1 control (no trigger): the Revert reports the count taken back and moves the version', () => T1({}, []))
  await check('T1 a writing trigger on inventory_check_items: the Revert still reports the count taken back', () => T1({}, [TRIGGERS.items]))
  await check('T2 control (no trigger): the Set that closes a difference says issue_closed', () => T2({}, []))
  await check('T2 a writing trigger on inventory_check_sessions: the Set still says issue_closed', () => T2({}, [TRIGGERS.sessions]))
  for (const [name, edits, scenario] of MUTANTS) {
    await check(`mutant killed: ${name}`, async () => {
      let caught = false
      try { await (scenario === 'T1 items' ? T1(edits, [TRIGGERS.items]) : T2(edits, [TRIGGERS.sessions])) } catch (error) { if (/must match once/.test(String(error && error.message))) throw error; caught = true }
      assert.equal(caught, true, 'the planted old check was not caught')
    })
  }
  await check('mutant controls: with no trigger the old check passes (so only the trigger exposes it)', async () => {
    await T1({ 'lib/stockRevert.ts': [OLD_REVERT] }, [])
    await T2({ 'lib/stockSetClosesIssue.ts': [OLD_SET] }, [])
  })
  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join('; ')}`); process.exit(1) }
  console.log(`PASS test-meta-changes-trigger-native (${passed})`)
}
main().catch((error) => { console.error(error); process.exit(1) })
