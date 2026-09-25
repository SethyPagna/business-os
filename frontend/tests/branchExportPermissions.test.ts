import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'

function variable(source: string, name: string): ts.VariableDeclaration {
  const ast = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.VariableDeclaration | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `production variable ${name} exists`)
  return found
}
function evaluate(code: string, bindings: Record<string, unknown>): any {
  const compiled = ts.transpileModule(`const callback = ${code}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(bindings), `${compiled}; return callback`)(...Object.values(bindings))
}
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const branches = read('../src/components/branches/Branches.tsx')
const dialog = read('../src/components/shared/ExportOptionsDialog.tsx')
const inventory = read('../src/components/inventory/Inventory.tsx')
const history = read('../src/utils/actionHistory.ts')

for (const source of [inventory, history]) {
  const call = variable(source, 'isAdmin').initializer as ts.CallExpression
  const getAdmin = (user: unknown) => evaluate(call.arguments[0].getText(), { user, effectivePermissions })()
  for (const [user, expected] of [
    [{ role_permissions: { all: true }, permissions: {} }, true],
    [{ role_permissions: '{"all":true}', permissions: '{}' }, true],
    [{ role_permissions: { all: true }, permissions: { all: false } }, false],
    [{ role_permissions: { all: true }, permissions: { all: 'true' } }, false],
    [{ permissions: { all: 'false' } }, false],
    [{ username: ' ADMIN ', permissions: { all: false } }, true],
    [{ role_code: ' AdMiN ', permissions: { all: false } }, true],
  ] as const) assert.equal(getAdmin(user), expected)
}

const exportCallback = (variable(branches, 'openBranchExport').initializer as ts.CallExpression).arguments[0].getText()
type Authority = { actorId: string; allowed: boolean; canViewCosts?: boolean }
async function branchScenario(tab: string, authority: Authority, onRead?: (read: number, authority: Authority) => void, cost?: unknown) {
  const reads: number[] = [], published: any[] = [], notices: string[] = []
  const inFlight = { current: false }
  const readPage = async (id: number) => {
    reads.push(id)
    onRead?.(reads.length, authority)
    return tab === 'transfers'
      ? { items: [{ id, product_name: 'Tea', quantity: 2 }], totalPages: 2 }
      : [{ name: 'Tea', branch_quantity: 2, ...(cost !== undefined ? { purchase_price_usd: cost } : {}) }]
  }
  const run = evaluate(exportCallback, {
    branchExportAuthorityRef: { current: authority }, branchExportInFlightRef: inFlight,
    setBranchExportLoading: () => {}, tab,
    branchApi: { getTransfers: (query: any) => readPage(query.page) },
    branchDateRange: { startDate: '', endDate: '' }, transferFromFilter: 'all', transferToFilter: 'all',
    isTransferRecord: (row: any) => !!row.id, formatTransferDate: () => '', historyExportField: (value: unknown) => value || '',
    notify: (message: string) => notices.push(message), tr: (_key: string, fallback: string) => fallback,
    setExportDialog: (result: unknown) => published.push(result),
    branches: [{ id: 1, name: 'Shop' }, { id: 2, name: 'Warehouse' }], getBranchStockRequest: readPage,
    runConcurrentTasks: async (items: any[], task: (item: any) => Promise<unknown>) => {
      const successes = []
      for (const item of items) successes.push({ item, value: await task(item) })
      return { successes, failures: [] }
    },
  })
  await run()
  assert.equal(inFlight.current, false)
  return { reads, published, notices }
}
for (const tab of ['branches', 'transfers']) {
  for (const tier of [true, 'review', false]) for (const override of [undefined, false, true, 'false']) {
    const user = { role_permissions: { branches: tier }, permissions: override === undefined ? {} : { 'branches:export': override } }
    const allowed = effectivePermissions(user).can('branches', 'export')
    assert.equal(allowed, tier !== false && override !== false, 'Review/Full defaults remain; only explicit false narrows export')
    const result = await branchScenario(tab, { actorId: '7', allowed })
    assert.equal(result.reads.length, allowed ? 2 : 0)
    assert.equal(result.published.length, allowed ? 1 : 0)
  }
  for (const change of ['permission', 'actor']) {
    const result = await branchScenario(tab, { actorId: '7', allowed: true }, (count, authority) => {
      if (count === 1) { if (change === 'permission') authority.allowed = false; else authority.actorId = '8' }
    })
    assert.equal(result.reads.length, 1, 'revoked/changed authority stops subsequent reads')
    assert.equal(result.published.length, 0, 'late results never open the export dialog')
  }
}
for (const canViewCosts of [false, true]) {
  for (const cost of [undefined, null, '', 0, 3.25]) {
    const result = await branchScenario('branches', { actorId: '7', allowed: true, canViewCosts }, undefined, cost)
    const row = result.published[0].rows[0]
    assert.equal(Object.hasOwn(row, 'Cost_USD'), canViewCosts, 'hidden acquisition columns are omitted, never fabricated as zero')
    assert.equal(Object.hasOwn(row, 'Stock_Value_USD'), canViewCosts)
    if (canViewCosts) {
      const expected = typeof cost === 'number' ? cost : ''
      assert.equal(row.Cost_USD, expected, 'known zero is numeric; absent cost remains blank')
      assert.equal(row.Stock_Value_USD, expected === '' ? '' : expected * 2)
    }
  }
}
const revokedCost = await branchScenario('branches', { actorId: '7', allowed: true, canViewCosts: true }, (count, authority) => {
  if (count === 1) authority.canViewCosts = false
}, 3.25)
assert.equal(revokedCost.published.length, 0, 'cost access revoked during a stock export invalidates the captured rows')

const runExportSource = variable(dialog, 'runExport').initializer!.getText()
  .replace("import('../../utils/csv.ts')", 'loadCsv()')
  .replace("import('../../utils/xlsxExport.ts')", 'loadXlsx()')
for (const format of ['csv', 'xlsx', 'pdf']) for (const revoke of ['never', 'before', 'during', 'unmount']) {
  let allowed = revoke !== 'before', downloads = 0, imports = 0
  const mountedRef = { current: true }
  const exportAllowed = evaluate(variable(dialog, 'exportAllowed').initializer!.getText(), {
    exportAuthorityRef: { current: () => allowed }, mountedRef,
  })
  const load = async () => {
    imports++
    if (revoke === 'during') allowed = false
    if (revoke === 'unmount') mountedRef.current = false
    return { downloadCSV: () => downloads++, downloadXLSX: () => downloads++ }
  }
  const run = evaluate(runExportSource, {
    exportAllowed, selected: new Set(['Product']), notify: () => {}, t: (key: string) => key,
    tr: (_t: unknown, _key: string, fallback: string) => fallback, setBusy: () => {},
    projectExportRows: () => {
      if (format === 'pdf' && revoke === 'during') allowed = false
      if (format === 'pdf' && revoke === 'unmount') mountedRef.current = false
      return [{ Product: 'Tea' }]
    },
    rows: [{ Product: 'Tea' }], columns: [{ key: 'Product', label: 'Product' }],
    fileBaseName: 'branch-stock', format, title: 'Stock', loadCsv: load, loadXlsx: load,
    openPrintExport: () => { downloads++; return true }, saveRememberedColumns: () => {}, rememberKey: 'branches', onClose: () => {},
    todayStr: () => '2026-09-24',
  })
  await run()
  assert.equal(downloads, revoke === 'never' ? 1 : 0, `${format} rechecks permission immediately before publication`)
  if (revoke === 'before') assert.equal(imports, 0)
  mountedRef.current = false
  assert.equal(exportAllowed(), false, 'unmounted guarded dialogs cannot publish')
}
const legacyAllowed = evaluate(variable(dialog, 'exportAllowed').initializer!.getText(), { exportAuthorityRef: { current: undefined }, mountedRef: { current: true } })
assert.equal(legacyAllowed(), true, 'existing callers retain default export behavior')
assert.match(branches, /const canExportBranch = can\('branches', 'export'\)/)
assert.match(branches, /canExport=\{\(\) => branchExportAuthorityRef.current.allowed && branchExportAuthorityRef.current.actorId === exportDialog.actorId && branchExportAuthorityRef.current.canViewCosts === exportDialog.canViewCosts\}/)
console.log('PASS effective admin authority, branch export tiers, hidden/missing/zero costs, actor/cost revocation races and CSV/XLSX/PDF publication guards')
