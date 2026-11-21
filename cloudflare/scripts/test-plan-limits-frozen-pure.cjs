'use strict'
// The sales-daily kernel fingerprint hashes only the plan-limit keys that closure code reads, and it only sees the closure. That is sound only while nothing anywhere can write to a plan limit: a write
// from a route would change what the kernel reads without a single kernel statement changing. Instead of scanning for write forms, the tables are made unwritable: src/lib/planTier.ts deep-freezes
// PAID_LIMITS, FREE_LIMITS and PLAN_LIMITS_BY_TIER, and getPlanLimits returns the frozen table itself. This test loads the REAL module and proves it, with an unfrozen copy as the control.
// Run (from cloudflare/): node scripts/test-plan-limits-frozen-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.join(__dirname, '..', 'src', 'lib', 'planTier.ts')
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
const mod = { exports: {} }
new Function('require', 'module', 'exports', output)(require, mod, mod.exports)
const { PLAN_LIMITS_BY_TIER, getPlanLimits, __resetPlanTierCacheForTests } = mod.exports

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

function unfrozenPaths(value, where) {
  if (value === null || typeof value !== 'object') return []
  const out = Object.isFrozen(value) ? [] : [where]
  for (const key of Reflect.ownKeys(value)) out.push(...unfrozenPaths(value[key], `${where}.${String(key)}`))
  return out
}
const copyOf = (value) => (value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copyOf(v)])) : value)
const tierOf = (tier) => { __resetPlanTierCacheForTests(); return getPlanLimits({ PLAN_TIER: tier }) }

/** Every write form against `table`, in strict mode: the names of the forms that CHANGED a value (an empty list = nothing could be written). */
function writesThatLanded(table) {
  const landed = []
  const key = Object.keys(table).find((k) => typeof table[k] === 'number')
  const before = JSON.stringify(table)
  const attempt = (name, run) => {
    try { run() } catch { /* a throw is a refusal */ }
    if (JSON.stringify(table) !== before) landed.push(name)
    try { delete table.addedByAWrite; Object.assign(table, JSON.parse(before)) } catch { /* frozen: nothing landed, nothing to restore */ }
  }
  const alias = table
  attempt('assignment', () => { table[key] = -1 })
  attempt('delete', () => { delete table[key] })
  attempt('Object.assign', () => { Object.assign(table, { [key]: -1 }) })
  attempt('Reflect.set', () => { Reflect.set(table, key, -1) })
  attempt('write through an alias', () => { const a = alias; a[key] = -1 })
  attempt('a new key', () => { table.addedByAWrite = 1 })
  return landed
}

check('each limit table and everything nested in them is frozen, recursively (PAID, FREE, and the table of tables)', () => {
  assert.ok(Object.keys(PLAN_LIMITS_BY_TIER).sort().join() === 'free,paid')
  assert.deepEqual(unfrozenPaths(PLAN_LIMITS_BY_TIER, 'PLAN_LIMITS_BY_TIER'), [])
  assert.ok(Object.isFrozen(PLAN_LIMITS_BY_TIER) && Object.isFrozen(PLAN_LIMITS_BY_TIER.paid) && Object.isFrozen(PLAN_LIMITS_BY_TIER.free))
  assert.ok(Object.keys(PLAN_LIMITS_BY_TIER.paid).length > 70 && Object.keys(PLAN_LIMITS_BY_TIER.free).length > 70, 'the tables are the real ones, not empty')
})

check('control: the recursive helper sees a nested object or array that is not frozen', () => {
  assert.deepEqual(unfrozenPaths(Object.freeze({ a: [1], b: { c: 1 } }), 'x'), ['x.a', 'x.b'])
  assert.deepEqual(unfrozenPaths({ a: 1 }, 'x'), ['x'])
  assert.deepEqual(unfrozenPaths(copyOf(PLAN_LIMITS_BY_TIER), 'copy').length > 0, true)
})

check('getPlanLimits returns the frozen table itself for each tier, not a copy that could be written', () => {
  assert.equal(tierOf('free'), PLAN_LIMITS_BY_TIER.free)
  assert.equal(tierOf('paid'), PLAN_LIMITS_BY_TIER.paid)
  assert.equal(tierOf(undefined), PLAN_LIMITS_BY_TIER.paid)
  assert.ok(Object.isFrozen(tierOf('free')) && Object.isFrozen(tierOf('paid')))
  assert.equal(tierOf('free').tier, 'free')
  assert.equal(tierOf('paid').tier, 'paid')
})

check('an assignment, a delete, Object.assign, Reflect.set, a write through an alias and a new key all leave every real table unchanged', () => {
  for (const [name, table] of [['paid', PLAN_LIMITS_BY_TIER.paid], ['free', PLAN_LIMITS_BY_TIER.free], ['getPlanLimits free', tierOf('free')], ['getPlanLimits paid', tierOf('paid')]]) {
    const before = JSON.stringify(table)
    assert.deepEqual(writesThatLanded(table), [], `${name}: a write landed`)
    assert.equal(JSON.stringify(table), before, `${name}: the table is unchanged`)
  }
  const tiers = PLAN_LIMITS_BY_TIER
  assert.throws(() => { tiers.paid = tiers.free }, TypeError, 'the table of tables cannot be repointed')
  assert.throws(() => { delete tiers.free }, TypeError)
})

check('control: the same checks on an unfrozen copy FAIL (every write form lands), so the check above can tell frozen from not', () => {
  for (const tier of ['paid', 'free']) {
    const copy = copyOf(PLAN_LIMITS_BY_TIER[tier])
    assert.deepEqual(Object.keys(copy), Object.keys(PLAN_LIMITS_BY_TIER[tier]), 'the copy has the same keys')
    assert.deepEqual(writesThatLanded(copy), ['assignment', 'delete', 'Object.assign', 'Reflect.set', 'write through an alias', 'a new key'], `${tier}: the copy accepts every write form`)
  }
})

console.log(`${passed} checks passed`)
