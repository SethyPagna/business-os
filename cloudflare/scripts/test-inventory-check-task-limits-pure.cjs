'use strict'
// The count-task sizes (lib/inventoryCheckTaskLimits.ts): one value per plan tier, the same on Free and Paid, chosen by the tier like every other limit, and read by the route and the writer through
// getInventoryCheckTaskLimits(env), never as a literal at a call site. They live beside planTier.ts, not in it, because planTier.ts is inside the sales-daily kernel fingerprint (see the module's comment);
// this test is what keeps both tiers pinned.
//
// Run: node scripts/test-inventory-check-task-limits-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

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
const { getInventoryCheckTaskLimits, INVENTORY_CHECK_TASK_LIMITS_BY_TIER } = load('lib/inventoryCheckTaskLimits.ts')
const { __resetPlanTierCacheForTests } = load('lib/planTier.ts')
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }

check('both tiers hold exactly the pinned numbers, and they are the same on Free and Paid', () => {
  assert.deepEqual(INVENTORY_CHECK_TASK_LIMITS_BY_TIER, { paid: { maxProducts: 300, maxOpenTasks: 30, tasksClosedShown: 5 }, free: { maxProducts: 300, maxOpenTasks: 30, tasksClosedShown: 5 } })
  assert.deepEqual(INVENTORY_CHECK_TASK_LIMITS_BY_TIER.free, INVENTORY_CHECK_TASK_LIMITS_BY_TIER.paid)
  assert.ok(INVENTORY_CHECK_TASK_LIMITS_BY_TIER.paid.maxProducts < 500, 'under the 500 items a session detail can read')
})
check('the tier picks the table: PLAN_TIER=free, paid, and no tier at all (paid, as every limit)', () => {
  for (const [env, tier] of [[{ PLAN_TIER: 'free' }, 'free'], [{ PLAN_TIER: 'paid' }, 'paid'], [{}, 'paid']]) { __resetPlanTierCacheForTests(); assert.deepEqual(getInventoryCheckTaskLimits(env), INVENTORY_CHECK_TASK_LIMITS_BY_TIER[tier]) }
})
check('no call site writes a task size as a literal: the route reads the limits through getInventoryCheckTaskLimits', () => {
  const route = fs.readFileSync(path.join(src, 'routes/inventoryChecks.ts'), 'utf8')
  assert.ok(route.includes('getInventoryCheckTaskLimits(c.env)'))
  for (const literal of [/\b300\b/, /\bmaxOpenTasks:\s*\d/, /maxProducts:\s*\d/]) assert.equal(literal.test(route), false, `the route holds no literal ${literal}`)
  const writer = fs.readFileSync(path.join(src, 'lib/inventoryCheckSessions.ts'), 'utf8')
  assert.equal(/maxProducts:\s*\d+/.test(writer), false)
  assert.equal(/maxOpenTasks:\s*\d+/.test(writer), false)
})
check('the cap on issuing and the number of open tasks the board shows are ONE value: the board is cut at maxOpenTasks and the issue is refused at it', () => {
  const route = fs.readFileSync(path.join(src, 'routes/inventoryChecks.ts'), 'utf8'), writer = fs.readFileSync(path.join(src, 'lib/inventoryCheckSessions.ts'), 'utf8')
  assert.ok(route.includes('shown: taskLimits.maxOpenTasks'), 'the board is cut at the cap')
  assert.ok(route.includes('maxOpenTasks: getInventoryCheckTaskLimits(c.env).maxOpenTasks'), 'the issue is refused at the same number')
  assert.ok(writer.includes('<@maxOpenTasks') && writer.includes("'inventory_check_task_limit'"))
  assert.equal(/tasksShown/.test(route + writer), false, 'the old second number is gone')
  assert.ok(INVENTORY_CHECK_TASK_LIMITS_BY_TIER.paid.maxOpenTasks >= 1)
})
console.log(`${passed} checks passed`)
