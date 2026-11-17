// Owner, 17 Nov 2026: "same for other costs//profit etc". The shift report's COGS, profit and removal-loss figures answer to the View product costs
// grant (holdsCostViewGrant), like every other cost surface; who may read the shift report at all stays shift management (canManageShifts =
// administrator). An administrator always holds the grant, so the default is unchanged. Telegram keeps profit (owner).
// Run: node test-shift-figures-cost-gate-pure.cjs
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
const holder = (role, own) => ({ role_code: 'manager', role_permissions: JSON.stringify(role), permissions: own ? JSON.stringify(own) : null })

check('the full figures carry every cost key (the fixture really has something to hide)', () => {
  for (const key of SHIFT_FIGURE_COST_KEYS) assert.ok(Object.hasOwn(figures, key), key)
  assert.equal(figures.cogs_usd, 60); assert.equal(figures.profit_usd, 40)
})

check('a reader holding View product costs gets the figures untouched', () => {
  assert.equal(gateShiftFiguresCosts(figures, true), figures)
})

check('a reader without it gets every cost key ABSENT and every other figure unchanged', () => {
  const before = JSON.stringify(figures)
  const gated = gateShiftFiguresCosts(figures, false)
  assert.equal(JSON.stringify(figures), before, 'input is not mutated')
  for (const key of SHIFT_FIGURE_COST_KEYS) assert.equal(Object.hasOwn(gated, key), false, key + ' is absent, not zero')
  const { cogs_usd, profit_usd, profit_without_not_paid_usd, cost_missing_snapshot_lines, removal_loss_usd, revenue_after_losses_usd, profit_after_losses_usd, removal_loss_unvalued_rows, ...rest } = figures
  assert.deepEqual(gated, rest)
  assert.equal(gated.sales_usd, 100, 'revenue stays')
  assert.deepEqual(Object.keys(gated).sort(), Object.keys(rest).sort())
})

check('the switch is the real helper: admin and an Edit-only or ungranted role differ from a View-grant holder', () => {
  const answers = [
    [{ role_code: 'admin' }, true],
    [holder({ all: true }), true],
    [holder({ product_cost_view: true }), true],
    [holder({ product_cost_edit: true }), false],
    [holder({}), false],
    [holder({ product_cost_view: true }, { product_cost_view: false }), false],
  ]
  for (const [user, expected] of answers) {
    assert.equal(holdsCostViewGrant(user), expected)
    assert.equal(Object.hasOwn(gateShiftFiguresCosts(figures, holdsCostViewGrant(user)), 'profit_usd'), expected)
  }
})

check('routes/shifts.ts: who reads the report stays administrator, the cost half follows the grant, Telegram is untouched', () => {
  const shifts = read('src/routes/shifts.ts')
  assert.match(shifts, /export function canManageShifts\(user: SessionUser\): boolean \{\s*return isAdminControlUser\(user\)\s*\}/)
  assert.match(shifts, /async function figuresFor\([^)]*\)[^{]*\{\s*if \(!canManageShifts\(user\)\) return null[\s\S]{0,400}?gateShiftFiguresCosts\(await loadShiftFigures\(env, shift, Date\.now\(\), memo\), holdsCostViewGrant\(user\)\)/)
  assert.doesNotMatch(read('src/lib/telegram.ts'), /gateShiftFiguresCosts|holdsCostViewGrant/, 'Telegram keeps profit (owner, 16 Nov 2026)')
})

console.log(`PASS ${passed} shift-figures cost-gate checks`)
