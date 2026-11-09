// PERM-UI, 3 Nov 2026: the seeded Manager holds `dashboard` and not `product_cost_view`, and its Dashboard showed
// "Dashboard summary unavailable / Dashboard startup returned incomplete summary data".
//
// Why: cloudflare compat.ts mounts acquisitionCostResponses on /dashboard and /dashboard/*, which runs the Worker's
// projectAcquisitionCosts over the JSON. That removes every cost-shaped key (cost_in, cost_out, stock_value_usd ... and
// their *_khr twins) for a caller without the cost grant, and Dashboard.tsx isDashboardSummaryPayload required
// stock_value_usd to be a finite number, so the summary was refused as incomplete.
//
// Nothing here is a hand copy of either side: the key set is read out of compat.ts emptySummary() by AST, the projection is the
// Worker's own module bundled by esbuild, the Manager is DEFAULT_ROLE_PERMISSIONS.manager, and the validator is cut out of
// Dashboard.tsx and executed (the technique tests/effectiveViewNavigation.test.ts uses for canAccessPage).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build, transformSync } from 'esbuild'
import ts from 'typescript'
import { DEFAULT_ROLE_PERMISSIONS } from '../../cloudflare/src/lib/roleDefaults.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const dashboardSource = read('../src/components/dashboard/Dashboard.tsx')
const compatSource = read('../../cloudflare/src/routes/compat.ts')

function parse(name: string, source: string) {
  return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function findNode<T extends ts.Node>(root: ts.Node, match: (node: ts.Node) => node is T): T {
  let found: T | undefined
  const visit = (node: ts.Node): void => { if (!found && match(node)) found = node; if (!found) ts.forEachChild(node, visit) }
  visit(root)
  if (!found) throw new Error('the node this test cuts out of the source has moved')
  return found
}

// --- the Dashboard's own validator, executed ---------------------------------------------------------------------------
const dashboardAst = parse('Dashboard.tsx', dashboardSource)
const validatorDeclaration = findNode(dashboardAst, (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'isDashboardSummaryPayload')
const validatorJs = transformSync(validatorDeclaration.getText(dashboardAst).replace(/\): value is DashboardSummary/, '): boolean'), { loader: 'ts' }).code
const isDashboardSummaryPayload = new Function(`${validatorJs}; return isDashboardSummaryPayload`)() as (value: unknown) => boolean

// --- the Worker's summary shape: the object compat.ts emptySummary() returns --------------------------------------------------
const compatAst = parse('compat.ts', compatSource)
const emptySummaryDeclaration = findNode(compatAst, (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'emptySummary')
const returned = findNode(emptySummaryDeclaration, (node): node is ts.ReturnStatement => ts.isReturnStatement(node))
const workerSummary = new Function(`return (${returned.expression!.getText(compatAst)})`)() as Record<string, unknown>

// --- the Worker's own projection and permission module ------------------------------------------------------------------------
const bundled = await build({
  stdin: {
    contents: "export { projectAcquisitionCosts } from './acquisitionCostAccess.ts'\nexport { hasAnyPermission } from './permissions.ts'",
    resolveDir: new URL('../../cloudflare/src/lib/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
})
const worker = { exports: {} as Record<string, (...args: unknown[]) => unknown> }
new Function('module', 'exports', bundled.outputFiles[0].text)(worker, worker.exports)
const projectAcquisitionCosts = worker.exports.projectAcquisitionCosts as (value: unknown, user: unknown) => Record<string, unknown>
const hasAnyPermission = worker.exports.hasAnyPermission as (user: unknown, keys: string[]) => boolean

const asWorkerUser = (roleCode: string, grants: Record<string, unknown>) => ({ username: roleCode, role_code: roleCode, role_permissions: JSON.stringify(grants), permissions: '{}' })
const MANAGER = asWorkerUser('manager', DEFAULT_ROLE_PERMISSIONS.manager)
const MANAGER_WITH_COST = asWorkerUser('manager', { ...DEFAULT_ROLE_PERMISSIONS.manager, product_cost_view: true })
const EMPLOYEE = asWorkerUser('employee', DEFAULT_ROLE_PERMISSIONS.employee)
const ADMIN = asWorkerUser('admin', DEFAULT_ROLE_PERMISSIONS.admin)
const COST_SUMMARY_KEYS = ['cost_in', 'cost_out', 'cost_in_khr', 'cost_out_khr', 'stock_value_usd', 'stock_value_khr']

let passed = 0
function test(name: string, check: () => void): void { check(); passed += 1; console.log(`PASS ${name}`) }

test('control: the Worker summary is a valid Dashboard summary and carries all six cost-derived keys', () => {
  for (const key of COST_SUMMARY_KEYS) assert.ok(Object.hasOwn(workerSummary, key), `emptySummary() has ${key}`)
  assert.equal(isDashboardSummaryPayload(workerSummary), true)
})

test('roles that hold `dashboard`: the Manager default (no cost grant) is one, the Employee default is not', () => {
  assert.equal(hasAnyPermission(MANAGER, ['dashboard']), true, 'the Manager default opens /api/dashboard/startup')
  assert.equal(hasAnyPermission(EMPLOYEE, ['dashboard']), false, 'the Employee default is refused by denyUnless(c, "dashboard")')
  assert.equal(DEFAULT_ROLE_PERMISSIONS.manager.product_cost_view, undefined, 'the Manager default holds no cost grant')
})

test('WHY it failed: for the Manager the Worker removes every cost-derived summary key, stock_value_usd among them', () => {
  const sent = projectAcquisitionCosts(workerSummary, MANAGER)
  for (const key of COST_SUMMARY_KEYS) assert.equal(Object.hasOwn(sent, key), false, `${key} is removed for a caller without product_cost_view`)
  assert.equal(Object.hasOwn(sent, 'product_count'), true, 'the non-cost keys the validator reads survive')
})

test('the Dashboard accepts what the Worker sends the Manager (red before: it threw "incomplete summary data")', () => {
  assert.equal(isDashboardSummaryPayload(projectAcquisitionCosts(workerSummary, MANAGER)), true)
})

test('cost holders keep the cost keys and are accepted too: the grant, not the role code, decides', () => {
  for (const user of [MANAGER_WITH_COST, ADMIN]) {
    const sent = projectAcquisitionCosts(workerSummary, user)
    for (const key of COST_SUMMARY_KEYS) assert.equal(Object.hasOwn(sent, key), true, `${key} reaches ${user.role_code}${user === MANAGER_WITH_COST ? ' with the cost grant' : ''}`)
    assert.equal(isDashboardSummaryPayload(sent), true)
  }
})

test('the validator still refuses a summary that is genuinely incomplete', () => {
  const sent = projectAcquisitionCosts(workerSummary, MANAGER)
  for (const key of ['product_count', 'today_count', 'expiring_count', 'recent_sales', 'low_stock', 'out_of_stock', 'expiring_products']) {
    const { [key]: _removed, ...without } = sent
    assert.equal(isDashboardSummaryPayload(without), false, `a summary without ${key} is incomplete`)
  }
  assert.equal(isDashboardSummaryPayload({}), false)
  assert.equal(isDashboardSummaryPayload(null), false)
  assert.equal(isDashboardSummaryPayload({ ...sent, recent_sales: 'x' }), false)
})

test('the stock-value card needs the cost grant AND the Worker having sent it, and absent cost keys are never defaulted to 0', () => {
  assert.match(dashboardSource, /const aHasStockValue = canViewAcquisitionCosts\(user\) && Number\.isFinite\(Number\(summary\?\.stock_value_usd \?\? NaN\)\)/)
  assert.match(dashboardSource, /\.\.\.\(aHasStockValue \? \[\{\s*id: 'stock-value'/, 'the card is spread in only when the stock value is shown')
  const emptyDefaults = dashboardSource.slice(dashboardSource.indexOf('const EMPTY_DASHBOARD_SUMMARY'), dashboardSource.indexOf('const EMPTY_DASHBOARD_ANALYTICS'))
  for (const key of COST_SUMMARY_KEYS) assert.equal(emptyDefaults.includes(`${key}:`), false, `EMPTY_DASHBOARD_SUMMARY must not default ${key} to 0 (that would read as a real empty shelf)`)
})

console.log(`${passed} dashboard cost-free summary tests passed`)
