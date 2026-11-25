// Owner A71 + Q4 (A78): shift profit follows the View product costs grant, and employees see nothing new of shift results.
// The Worker reads three things per caller: the Business results block (shift management = administrator), the cost keys inside it (the
// View product costs grant) and the drawer comparison (administrator). The table is cloudflare/scripts/fixtures/shift-profit-permission-cases.json;
// the screen test frontend/tests/shiftProfitPermission.test.ts reads the same rows.
// Run: node scripts/test-shift-profit-permission-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', source)((name) => (name.startsWith('.') ? load(path.resolve(path.dirname(file), name.endsWith('.ts') ? name : name + '.ts')) : require(name)), mod, mod.exports)
  return mod.exports
}
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
const { composeShiftFigures, gateShiftFiguresCosts, SHIFT_FIGURE_COST_KEYS } = load(path.join(root, 'src/lib/shiftReconciliation.ts'))
const { holdsCostViewGrant } = load(path.join(root, 'src/lib/acquisitionCostAccess.ts'))
const { isAdminControlUser } = load(path.join(root, 'src/lib/permissions.ts'))
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'shift-profit-permission-cases.json'), 'utf8'))

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log('PASS ' + name) }

const totals = {
  revenue_usd: 100, cost_usd: 60, profit_usd: 40, cost_missing_snapshot_lines: 2, delivery_usd: 3, not_paid_owed_usd: 5, refund_usd: 1,
  revenue_without_not_paid_usd: 95, profit_without_not_paid_usd: 37, removal_loss_usd: 4, revenue_after_losses_usd: 96, profit_after_losses_usd: 36, removal_loss_unvalued_rows: 1,
}
const figures = composeShiftFigures({
  opening: { usd: 10, khr: 0 }, additionalCash: { usd: 0, khr: 0 }, counted: { usd: 120, khr: 0 }, totals,
  expenses: { usd: 5, khr: 0 }, deliveryFees: { usd: 1, khr: 0 }, courier: { usd: 2, khr: 0 },
})
const userOf = (row) => ({ role_code: row.role_code, role_permissions: row.role_permissions, permissions: row.permissions })
// What routes/shifts.ts figuresFor answers for a caller, built from the same two functions it calls.
const answerFor = (user) => (isAdminControlUser(user) ? gateShiftFiguresCosts(figures, holdsCostViewGrant(user)) : null)
const keysDeep = (value, out = []) => {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, out))
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { out.push(key); keysDeep(child, out) }
  return out
}

check('the fixture is a real table: every combination of grant and figures is in it', () => {
  assert.ok(cases.users.length >= 8)
  for (const [grant, block] of [[true, true], [true, false], [false, false]]) assert.ok(cases.users.some((row) => row.grant === grant && row.figures === block), JSON.stringify({ grant, block }))
})

check('the Worker answer matches the table on every row: block, cost keys and grant', () => {
  for (const row of cases.users) {
    const user = userOf(row)
    assert.equal(holdsCostViewGrant(user), row.grant, row.name + ' grant')
    assert.equal(isAdminControlUser(user), row.drawer, row.name + ' drawer and block are one administrator test')
    const answer = answerFor(user)
    assert.equal(answer != null, row.figures, row.name + ' block')
    const keys = answer ? keysDeep(answer) : []
    for (const key of SHIFT_FIGURE_COST_KEYS) assert.equal(keys.includes(key), row.figures && row.grant, row.name + ' ' + key + ' (absent, not zero, when hidden)')
    if (answer && !row.grant) assert.equal(answer.sales_usd, 100, 'revenue stays when only the cost half is hidden')
  }
})

check('a caller without the grant gets no cost key anywhere in the JSON a history read or a close would carry', () => {
  for (const row of cases.users.filter((r) => !r.grant)) {
    const json = JSON.stringify({ shift: { id: 1, figures: answerFor(userOf(row)) } })
    assert.doesNotMatch(json, /cogs|profit|removal_loss|revenue_after_losses|cost_missing/, row.name)
  }
  const holder = cases.users.find((r) => r.name === 'administrator')
  assert.match(JSON.stringify(answerFor(userOf(holder))), /"profit_usd":40/, 'a holder has them, so the scan is not vacuous')
})

check('routes/shifts.ts: the cost half is the grant, the block and the drawer are the administrator, and both answers go through reconciledShift', () => {
  const shifts = read('src/routes/shifts.ts')
  assert.match(shifts, /export function canManageShifts\(user: SessionUser\): boolean \{\s*return isAdminControlUser\(user\)\s*\}/)
  assert.match(shifts, /async function figuresFor\([^)]*\)[^{]*\{\s*if \(!canManageShifts\(user\)\) return null[\s\S]{0,400}?gateShiftFiguresCosts\(await loadShiftFigures\(env, shift, Date\.now\(\), memo\), holdsCostViewGrant\(user\)\)/)
  assert.match(shifts, /async function drawerFor\([^)]*\)[^{]*\{\s*const none = noDrawer\(\)\s*if \(!canManageShifts\(user\)\) return none/)
  assert.match(shifts, /async function reconciliationFor\([^)]*\)[^{]*\{[^}]*?if \(!canManageShifts\(user\)\) return null/)
  assert.match(shifts, /shift: await reconciledShift\(c\.env, user, shift\),/, 'the history read')
  assert.equal((shifts.match(/await reconciledShift\(c\.env, user, result\.shift, \{ closedOn/g) || []).length, 2, 'both close answers')
  assert.doesNotMatch(shifts, /profit_usd|cogs_usd|profit_after_losses_usd/, 'no cost key is written outside the gated figures')
})

console.log(`PASS ${passed} shift profit-permission checks`)
