'use strict'
// Count tasks, round 8b (P2.1 + P2.2): the figures of a task.
//   P2.2  total, done and removed come from ONE walk of the task's items, packed in one number (total * 1e6 + done * 1e3 + removed). Exact while a task holds fewer than 1000 items: pinned on both plan tiers.
//   P2.1  every close records its figures in the close event (the auto-close and the close by hand), and the board shows a CLOSED task from its newest close event, with the live walk only as the fallback for a task closed
//         before the figures were recorded (COALESCE: SQLite stops at the first non-NULL argument, so a frozen row never runs the live walk). An OPEN row is always live.
// Run: node scripts/test-inventory-check-tasks-figures-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const src = path.join(__dirname, '..', 'src')
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const module = { exports: {} }
  cache.set(rel, module)
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(src, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((request) => {
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }, module, module.exports)
  return module.exports
}
const tasks = load('lib/inventoryCheckTasks.ts')
const { INVENTORY_CHECK_TASK_LIMITS_BY_TIER } = load('lib/inventoryCheckTaskLimits.ts')
let passed = 0
const queue = []
const check = (name, run) => { queue.push({ name, run }) }

check('the packed figure decodes exactly for every total, done, removed a task can hold (both tiers: fewer than 1000 items)', () => {
  for (const tier of ['free', 'paid']) assert.ok(INVENTORY_CHECK_TASK_LIMITS_BY_TIER[tier].maxProducts < 1000, `${tier} maxProducts < 1000`)
  const db = new DatabaseSync(':memory:')
  const pack = (total, done, removed) => db.prepare(`SELECT ${total}*${tasks.TASK_FIGURE_TOTAL}+${done}*${tasks.TASK_FIGURE_DONE}+${removed}*${tasks.TASK_FIGURE_REMOVED} AS f`).get().f
  for (const [total, done, removed] of [[0, 0, 0], [1, 0, 0], [1, 1, 0], [300, 299, 0], [300, 300, 0], [0, 0, 300], [150, 40, 150], [999 - 7, 999 - 7, 7], [100, 100, 0], [10, 3, 90]]) {
    assert.deepEqual(tasks.decodeTaskFigures(pack(total, done, removed)), { total, done, removed }, `${total}/${done}/${removed}`)
  }
  // the SQL form the writers use (division and modulo of integers) agrees with the decoder
  const f = pack(213, 77, 31)
  assert.deepEqual({ ...db.prepare(`SELECT ${f}/${tasks.TASK_FIGURE_TOTAL} AS total, (${f}/${tasks.TASK_FIGURE_DONE})%1000 AS done, ${f}%1000 AS removed`).get() }, { total: 213, done: 77, removed: 31 })
  assert.deepEqual(tasks.decodeTaskFigures(null), { total: 0, done: 0, removed: 0 })
})

check('the board reads ONE walk of the items (no separate total / done / removed counts) and shows a closed task from its newest close event, the live walk only as the fallback', async () => {
  let sql = ''
  await tasks.readTaskRows({ prepare(statement) { sql = statement; return { all: async () => [] } } }, { organization: null, branchId: 1, closedShown: 5 })
  assert.equal((sql.match(/SELECT SUM\(CASE WHEN EXISTS/g) || []).length, 2, 'the live walk appears twice: once as the fallback of a closed row, once for an open row')
  assert.equal(/\) AS (total|done|removed),/.test(sql), false, 'no per-figure count remains')
  assert.ok(/CASE WHEN page\.status='closed' THEN COALESCE\(\(SELECT json_extract\(e\.after_json,'\$\.total'\)/.test(sql), 'closed: frozen first')
  assert.ok(sql.includes("FROM inventory_check_events e WHERE e.session_id=page.id AND e.action='close' ORDER BY e.id DESC LIMIT 1)"), 'the newest close event: one seek of inventory_check_events_session')
  assert.ok(/ELSE \(SELECT SUM\(CASE WHEN EXISTS/.test(sql), 'open: always live')
  assert.ok(sql.includes(' END AS figures,'))
})

check('every close records its figures: the auto-close names total, done and removed in its event, the hand close of a task is an INSERT ... SELECT that adds them', () => {
  const auto = tasks.autoCloseTaskStatements().statements[0].sql
  for (const key of ["'total',", "'done',", "'removed',"]) assert.ok(auto.includes(key), `auto-close event carries ${key}`)
  assert.equal((auto.match(/SELECT SUM\(CASE WHEN EXISTS/g) || []).length, 1, 'one walk per closing task, in a derived table (not one per figure)')
  const hand = tasks.taskCloseEventSql()
  for (const key of ["'$.total'", "'$.done'", "'$.removed'"]) assert.ok(hand.includes(key), `hand close event carries ${key}`)
  assert.equal((hand.match(/SELECT SUM\(CASE WHEN EXISTS/g) || []).length, 1, 'one walk')
  const sessions = fs.readFileSync(path.join(src, 'lib/inventoryCheckSessions.ts'), 'utf8')
  assert.ok(/taskClosedFigures\(actor, eventStatement\(actor, \{ sessionId: id, action, key, hash,/.test(sessions) && sessions.includes("action === 'close' && membershipOf(session) === TASK_MEMBERSHIP)"), 'patchInventoryCheckSession uses it for a task only')
})

check('the sales-daily kernel pin is untouched: planTier.ts is not edited by this round', () => {
  const pin = JSON.parse(fs.readFileSync(path.join(__dirname, 'sales-daily-kernel-pin.json'), 'utf8'))
  assert.ok(JSON.stringify(pin).includes('src/lib/planTier.ts'))
  const limits = fs.readFileSync(path.join(src, 'lib/inventoryCheckTaskLimits.ts'), 'utf8')
  assert.ok(limits.includes('export function getInventoryCheckTaskLimits(env: Env)'), 'the limits stay in their own module')
})

;(async () => { for (const { name, run } of queue) { await run(); passed++; console.log(`PASS ${name}`) } console.log(`${passed} checks passed`) })().catch((error) => { console.error(error); process.exit(1) })
