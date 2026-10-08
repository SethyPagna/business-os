// Lane LM (branch cutover, readiness gap G-M): the branch UI collapses to one
// branch from DATA and keeps history reachable.
//
// Two states are compared everywhere, so a surface that hard-codes either one
// fails a case:
//   TWO_ACTIVE   Shop + Warehouse both active (today)  -> everything renders as before
//   ONE_PLUS_OLD LC Store active + Old Shop retired    -> pickers collapse, history filters
//                                                         still offer the retired branch, labelled
// Nothing below names a branch by anything but its row.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import {
  branchChoiceSettled,
  branchStepMatters,
  branchHistoryLabel,
  branchStockLinesWorthShowing,
  labelInactiveChoices,
  normalizeBranchRows,
  showsBranchComparison,
  showsBranchHistoryFilter,
} from '../src/utils/branchScope.ts'
import { REPORT_VIEWS, resolveReportView, visibleReportViews } from '../src/components/sales/reports/reportModel.ts'
import { buildProductBranchSummaryLabel } from '../src/components/products/helpers/productDisplayHelpers.ts'
import { hasTransferPair } from '../src/utils/branchCollapse.ts'
import { deriveProductSheetState } from '../src/components/pos/productSheetState.ts'

let failed = 0
function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(fn).then(
    () => { console.log(`PASS ${name}`) },
    (error) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) },
  )
}
const src = (...parts: string[]) => fs.readFileSync(new URL(`../src/${parts.join('/')}`, import.meta.url), 'utf8')

type Row = { id: number; name: string; role: string | null; is_active: number }
const TWO_ACTIVE: Row[] = [
  { id: 1, name: 'Warehouse', role: 'warehouse', is_active: 1 },
  { id: 2, name: 'Shop', role: 'shop', is_active: 1 },
]
const ONE_PLUS_OLD: Row[] = [
  { id: 1, name: 'LC Store', role: 'shop', is_active: 1 },
  { id: 2, name: 'Old Shop', role: 'shop', is_active: 0 },
]
const ONE_ONLY: Row[] = [ONE_PLUS_OLD[0]]

// ---------------------------------------------------------------------------
// the pure rules
// ---------------------------------------------------------------------------
await runTest('history filter: shown while two branches exist at all, retired included; gone with one', () => {
  assert.equal(showsBranchHistoryFilter(TWO_ACTIVE), true, 'today: unchanged')
  assert.equal(showsBranchHistoryFilter(ONE_PLUS_OLD), true, 'after the cutover the retired branch is still selectable')
  assert.equal(showsBranchHistoryFilter(ONE_ONLY), false, 'a single branch row has nothing to filter')
  assert.equal(showsBranchHistoryFilter([]), false)
  assert.equal(showsBranchHistoryFilter(null), false, 'not loaded yet: callers keep today\'s behaviour by testing null themselves')
})

await runTest('a retired branch is labelled in history choices, an active one is not', () => {
  assert.equal(branchHistoryLabel(TWO_ACTIVE[1], 'Inactive'), 'Shop', 'today: no label appears')
  assert.equal(branchHistoryLabel(ONE_PLUS_OLD[0], 'Inactive'), 'LC Store')
  assert.equal(branchHistoryLabel(ONE_PLUS_OLD[1], 'Inactive'), 'Old Shop (Inactive)')
  assert.equal(branchHistoryLabel({ name: 'Old Shop', is_active: 0 }, 'អសកម្ម'), 'Old Shop (អសកម្ម)', 'the label is the caller\'s translated word')
  assert.equal(branchHistoryLabel({ name: 'No flag' }, 'Inactive'), 'No flag', 'a row that does not say is active, like COALESCE(is_active,1)')
})

await runTest('branch comparison: two active branches or two branches with data keep it, one of each hides it', () => {
  assert.equal(showsBranchComparison(TWO_ACTIVE, 1), true, 'today a range with one branch\'s sales still shows the card')
  assert.equal(showsBranchComparison(TWO_ACTIVE, 0), true)
  assert.equal(showsBranchComparison(ONE_PLUS_OLD, 2), true, 'a range spanning the cutover compares LC Store with Old Shop')
  assert.equal(showsBranchComparison(ONE_PLUS_OLD, 1), false, 'a range after the cutover is one branch: noise')
  assert.equal(showsBranchComparison(ONE_ONLY, 1), false)
  assert.equal(showsBranchComparison(null, 1), true, 'rows not loaded (or the read failed): never hide a card on a guess')
})

await runTest('a picker whose only answer is chosen is settled; empty or stale selections keep the picker', () => {
  assert.equal(branchChoiceSettled(['1', '2'], '1'), false, 'two choices: ask')
  assert.equal(branchChoiceSettled([1], '1'), true, 'one choice, chosen (number vs string ids)')
  assert.equal(branchChoiceSettled([1], ''), false, 'nothing chosen yet: the person must be able to choose')
  assert.equal(branchChoiceSettled([1], null), false)
  assert.equal(branchChoiceSettled([1], '2'), false, 'a stale draft naming the retired branch must stay re-choosable')
  assert.equal(branchChoiceSettled([], '1'), false)
})

await runTest('labelInactiveChoices marks only what the active list lacks', () => {
  const all = [{ value: '1', label: 'LC Store' }, { value: '2', label: 'Old Shop' }]
  assert.deepEqual(labelInactiveChoices(all, [{ value: '1' }], 'Inactive').map((o) => o.label), ['LC Store', 'Old Shop (Inactive)'])
  assert.deepEqual(labelInactiveChoices(all, all, 'Inactive').map((o) => o.label), ['LC Store', 'Old Shop'], 'both active: no label')
  assert.deepEqual(labelInactiveChoices(all, [], 'Inactive').map((o) => o.label), ['LC Store', 'Old Shop'], 'no active list: nothing to tell apart')
  assert.deepEqual(labelInactiveChoices(all, [{ value: '1' }], 'Inactive').map((o) => !!o.disabled), [false, true], 'CUTOVER-LR: the disabled branch is greyed out, never a new target')
})

await runTest('per-branch stock lines: sole active identity stays visible, retired stock stays visible', () => {
  const two = [{ branch_id: 1, quantity: 5, branch_active: 1 }, { branch_id: 2, quantity: 0, branch_active: 1 }]
  assert.equal(branchStockLinesWorthShowing(two).length, 2, 'today: unchanged, zero lines included')
  const oneActiveRetiredEmpty = [{ branch_id: 1, quantity: 12, branch_active: 1 }, { branch_id: 2, quantity: 0, branch_active: 0 }]
  assert.deepEqual(branchStockLinesWorthShowing(oneActiveRetiredEmpty), [oneActiveRetiredEmpty[0]], 'the active branch stays named')
  const retiredHolds = [{ branch_id: 1, quantity: 12, branch_active: 1 }, { branch_id: 2, quantity: 3, branch_active: 0 }]
  assert.equal(branchStockLinesWorthShowing(retiredHolds).length, 2, 'stock left at the retired branch explains the total')
  const noFlags = [{ branch_id: 1, quantity: 5 }, { branch_id: 2, quantity: 1 }]
  assert.equal(branchStockLinesWorthShowing(noFlags).length, 2, 'rows that do not say are shown as they always were (older payloads)')
  assert.equal(branchStockLinesWorthShowing([{ branch_id: 1, quantity: 5 }]).length, 1, 'a lone line that does not say whether its branch is active is not evidence of one branch')
  assert.deepEqual(branchStockLinesWorthShowing([{ branch_id: 1, quantity: 5, branch_active: 1 }]), [{ branch_id: 1, quantity: 5, branch_active: 1 }], 'sole active Products stock remains visible')
  assert.equal(branchStockLinesWorthShowing([{ branch_id: 1, quantity: 5, branch_active: 1 }, { branch_id: 2, quantity: 0 }]).length, 2, 'a mixed payload (one line silent) is not judged')
  assert.equal(branchStockLinesWorthShowing([{ branch_id: 2, quantity: 0, branch_active: 0 }]).length, 1, 'only a retired line: nothing is hidden')
})

await runTest('the product row summary follows the same rule and keeps its old behaviour otherwise', () => {
  const names = new Map<string, unknown>([['1', 'LC Store'], ['2', 'Old Shop']])
  const base = (flags: [number, number], q: [number, number]) => ({ branch_stock: [
    { branch_id: 1, quantity: q[0], branch_active: flags[0] }, { branch_id: 2, quantity: q[1], branch_active: flags[1] },
  ] })
  assert.equal(buildProductBranchSummaryLabel(base([1, 1], [5, 3]), names), 'LC Store: 5, Old Shop: 3', 'two active: unchanged')
  assert.equal(buildProductBranchSummaryLabel(base([1, 0], [12, 0]), names), 'LC Store: 12', 'one active stays named')
  assert.equal(buildProductBranchSummaryLabel(base([1, 0], [12, 3]), names), 'LC Store: 12, Old Shop: 3', 'retired stock stays named')
  assert.equal(buildProductBranchSummaryLabel({ branch_stock: [] }), '0', 'no rows at all is still a bare 0')
})

await runTest('normalizeBranchRows accepts the bare array and the wrapped shape and drops rows without an id', () => {
  const raw = [{ id: 1, name: 'LC Store', is_active: 1 }, { id: 2, branch_name: 'Old Shop', is_active: 0 }, { name: 'no id' }, null]
  const rows = normalizeBranchRows(raw)
  assert.deepEqual(rows.map((row) => [row.id, row.name]), [['1', 'LC Store'], ['2', 'Old Shop']])
  assert.equal(rows[1].is_active, 0, 'the active flag survives for the helpers')
  assert.deepEqual(normalizeBranchRows({ branches: raw }).length, 2)
  assert.deepEqual(normalizeBranchRows(null), [])
  assert.deepEqual(normalizeBranchRows('x'), [])
})

await runTest('reports: the Branches view goes only when a single branch row exists; permissions still decide the rest', () => {
  const all = { sales: true, returns: true, fees: true, shift: true }
  assert.equal(visibleReportViews(all).length, REPORT_VIEWS.length, 'no scope = today')
  assert.equal(visibleReportViews(all, { branchComparison: true }).length, REPORT_VIEWS.length)
  const collapsed = visibleReportViews(all, { branchComparison: false }).map((view) => view.id)
  assert.ok(!collapsed.includes('branches'))
  assert.equal(collapsed.length, REPORT_VIEWS.length - 1, 'only the Branches view leaves')
  assert.equal(resolveReportView('branches', all, { branchComparison: true }), 'branches')
  assert.equal(resolveReportView('branches', all, { branchComparison: false }), 'overview', 'a stored Branches choice falls back instead of rendering a one-line comparison')
  assert.equal(resolveReportView('products', all, { branchComparison: false }), 'products')
  const noSales = { sales: false, returns: true, fees: false, shift: false }
  assert.equal(resolveReportView('branches', noSales, { branchComparison: true }), 'overview', 'permissions still win')
})

// ---------------------------------------------------------------------------
// rendered surfaces (esbuild bundle + react-dom/server, the same approach as
// fastStockIn.test.ts): props-driven pieces rendered in both states
// ---------------------------------------------------------------------------
const nodeRequire = createRequire(import.meta.url)
async function load(rel: string): Promise<Record<string, unknown>> {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(`../src/${rel}`, import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server'],
    plugins: [{ name: 'lm-stubs', setup(builder) {
      // The portal modals render into document.body; on the server the node is the markup.
      builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'lm-stub' }))
      builder.onResolve({ filter: /(?:^|\/)AppContext(?:\.tsx)?$/ }, () => ({ path: 'ctx', namespace: 'lm-stub' }))
      builder.onLoad({ filter: /.*/, namespace: 'lm-stub' }, (args) => ({
        contents: args.path === 'portal'
          ? 'export const createPortal = (node) => node;'
          : `export const useApp = () => globalThis.__lmCtx; export const useSync = () => ({});
          export const useLowStockConfig = () => ({}); export const isBrokenLocalizedString = () => false;`,
        loader: 'js',
      }))
    } }],
  })
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(nodeRequire, mod, mod.exports)
  return mod.exports
}
// ProductDetailModal reads document.body for its portal target (the stub ignores it).
if (!('document' in globalThis)) Object.assign(globalThis, { document: { body: null } })
Object.assign(globalThis, { __lmCtx: { t: (key: string) => key, user: { permissions: {} }, getPermissionTier: () => 'none', can: () => false } })
const tr = (key: string, fallback?: string) => fallback ?? key
const originalError = console.error
const quietLayoutEffectWarning = <T,>(fn: () => T): T => {
  console.error = (...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect')) originalError(...args) }
  try { return fn() } finally { console.error = originalError }
}

const sessionDetails = (await load('components/stock-session/StockSessionSharedDetails.tsx')).default as never
const renderDetails = (props: Record<string, unknown>) => quietLayoutEffectWarning(() => renderToStaticMarkup(React.createElement(sessionDetails, {
  tr, packLookup: () => undefined, brand: '', onBrand() {}, brandOptions: [], supplier: { supplierName: '' }, onSupplier() {},
  receivedDate: '', onReceivedDate() {}, onBranch() {}, ...props,
})))

await runTest('stock session: two receiving branches keep the picker (today)', () => {
  const html = renderDetails({ branchId: '1', branchOptions: [{ value: '1', label: 'Warehouse' }, { value: '2', label: 'Shop' }] })
  assert.doesNotMatch(html, /data-stock-session-sole-branch/)
  assert.match(html, /aria-label="Branch"/, 'the real select is there')
})

await runTest('stock session: one receiving branch, chosen, becomes a plain label with the branch name', () => {
  const html = renderDetails({ branchId: '1', branchOptions: [{ value: '1', label: 'LC Store' }] })
  assert.match(html, /data-stock-session-sole-branch/)
  assert.match(html, /LC Store/)
  assert.doesNotMatch(html, /aria-label="Branch"/, 'the labelled picker control is not rendered (the label group is named "Branch: LC Store")')
})

await runTest('stock session: a stale draft naming the retired branch keeps the picker and its alert so it can be re-chosen', () => {
  const html = renderDetails({ branchId: '2', branchInvalid: true, branchOptions: [{ value: '1', label: 'LC Store' }] })
  assert.doesNotMatch(html, /data-stock-session-sole-branch/)
  assert.match(html, /role="alert"/)
  assert.match(html, /Branch #2/, 'the stale id stays visible (disabled) so the person sees what was lost')
})

await runTest('stock session: Remove / Set may still correct the retired branch, so two options keep the picker and the retired one is labelled', () => {
  const options = labelInactiveChoices([{ value: '1', label: 'LC Store' }, { value: '2', label: 'Old Shop' }], [{ value: '1' }], 'Inactive')
  const html = renderDetails({ branchId: '1', branchOptions: options })
  assert.doesNotMatch(html, /data-stock-session-sole-branch/)
})

const rowParts = await load('components/products/surfaces/ProductRowParts.tsx') as { ProductDetailsCell: React.ComponentType<Record<string, unknown>> }
const renderCell = (branch_stock: unknown[]) => quietLayoutEffectWarning(() => renderToStaticMarkup(React.createElement(rowParts.ProductDetailsCell, {
  product: { id: 1, branch_stock }, tr, fmtUSD: String, renderMetaPill: () => null, selectedBranchId: 'all',
})))

await runTest('product row pills: sole active branch stays named; retired stock stays', () => {
  assert.match(renderCell([{ branch_id: 1, branch_name: 'Warehouse', quantity: 5, branch_active: 1 }, { branch_id: 2, branch_name: 'Shop', quantity: 0, branch_active: 1 }]), /Warehouse: 5[\s\S]*Shop: 0/)
  const collapsed = renderCell([{ branch_id: 1, branch_name: 'LC Store', quantity: 12, branch_active: 1 }, { branch_id: 2, branch_name: 'Old Shop', quantity: 0, branch_active: 0 }])
  assert.match(collapsed, /LC Store: 12/)
  assert.doesNotMatch(collapsed, /Old Shop/)
  assert.match(renderCell([{ branch_id: 1, branch_name: 'LC Store', quantity: 12, branch_active: 1 }, { branch_id: 2, branch_name: 'Old Shop', quantity: 3, branch_active: 0 }]), /LC Store: 12[\s\S]*Old Shop: 3/)
})

const inventoryDetail = (await load('components/inventory/ProductDetailModal.tsx')).default as never
const renderInventoryDetail = (branch_stock: unknown[]) => quietLayoutEffectWarning(() => renderToStaticMarkup(React.createElement(inventoryDetail, {
  product: { id: 1, name: 'Soap', unit: 'pcs', stock_quantity: 12, selling_price_usd: 2, branch_stock }, onClose() {}, fmtUSD: String, fmtKHR: String, t: (key: string) => key,
})))
const surfaceDetail = (await load('components/products/surfaces/ProductDetailModal.tsx')).default as never
const renderSurfaceDetail = (branch_stock: unknown[]) => quietLayoutEffectWarning(() => renderToStaticMarkup(React.createElement(surfaceDetail, {
  p: { id: 1, name: 'Soap', unit: 'pcs', stock_quantity: 12, selling_price_usd: 2, branch_stock }, fmtUSD: String, fmtKHR: String, onEdit() {}, onClose() {}, t: (key: string) => key,
})))
const TWO_LINES = [{ branch_id: 1, branch_name: 'Warehouse', quantity: 5, branch_active: 1 }, { branch_id: 2, branch_name: 'Shop', quantity: 7, branch_active: 1 }]
const ONE_LINE = [{ branch_id: 1, branch_name: 'LC Store', quantity: 12, branch_active: 1 }, { branch_id: 2, branch_name: 'Old Shop', quantity: 0, branch_active: 0 }]

await runTest('inventory product detail: sole active branch and count tile remain visible', () => {
  const today = renderInventoryDetail(TWO_LINES)
  assert.match(today, /Warehouse: <span[^>]*>5/)
  assert.match(today, /Shop: <span[^>]*>7/)
  assert.match(today, /data-detail-branch-row/)
  assert.match(today, />branches</, 'the Branches count tile (its label is the key under the test translator)')
  const after = renderInventoryDetail(ONE_LINE)
  assert.match(after, /LC Store/)
  assert.doesNotMatch(after, /Old Shop/)
  assert.match(after, /data-detail-branch-row/)
  assert.match(after, />branches</, 'the sole active branch remains counted')
  assert.match(renderInventoryDetail([]), />branches</, 'a product with no branch rows keeps the tile exactly as before (nothing was collapsed)')
})

await runTest('products product detail: sole active branch row remains visible', () => {
  assert.match(renderSurfaceDetail(TWO_LINES), /Warehouse[\s\S]*Shop/)
  const after = renderSurfaceDetail(ONE_LINE)
  assert.match(after, /LC Store/)
  assert.doesNotMatch(after, /Old Shop/)
})

// ---------------------------------------------------------------------------
// the till's product sheet: the Branch step asks only when there is a choice
// ---------------------------------------------------------------------------
await runTest('POS sheet: today two branch pills; after the cutover the sole selling branch needs no step, a lone non-selling one still explains', () => {
  const sheet = (branch_stock: unknown[], intent: 'sell' | 'stock' = 'sell') => deriveProductSheetState({ product: { id: 1, name: 'Soap', branch_stock } as never, groupProduct: false, intent })
  const today = sheet([
    { branch_id: 2, branch_name: 'Shop', branch_role: 'shop', branch_active: 1, quantity: 3 },
    { branch_id: 1, branch_name: 'Warehouse', branch_role: 'warehouse', branch_active: 1, quantity: 40 },
  ])
  assert.equal(branchStepMatters(today.branchOptions), true, 'today: unchanged')
  const after = sheet([{ branch_id: 2, branch_name: 'LC Store', branch_role: 'shop', branch_active: 1, quantity: 12 }])
  assert.equal(after.branchOptions.length, 1)
  assert.equal(after.effectiveBranchId, '2', 'the sheet already resolves to the sole branch, so hiding the step loses nothing')
  assert.equal(after.displayedStock, 12)
  assert.equal(branchStepMatters(after.branchOptions), false)
  const loneStockOnly = sheet([{ branch_id: 1, branch_name: 'Warehouse', branch_role: 'warehouse', branch_active: 1, quantity: 40 }])
  assert.equal(branchStepMatters(loneStockOnly.branchOptions), true, 'a lone branch that cannot sell keeps its notice')
  assert.equal(branchStepMatters(sheet([]).branchOptions), false)
  const sheetSource = src('components', 'pos', 'ProductDetailSheet.tsx')
  assert.match(sheetSource, /const branchStepShown = branchChoiceMatters/)
  assert.match(sheetSource, /\{branchChoiceMatters \? \(\s*<div className="flex gap-3"><span className="w-24 flex-shrink-0" \/><span className="text-xs text-gray-400">\{sheetState\.branchSummary\}/)
})

// ---------------------------------------------------------------------------
// the transfer entry points follow the collapse helper (LE) in the hub too
// ---------------------------------------------------------------------------
await runTest('transfer pair: two active branches have one, LC Store alone does not', () => {
  assert.equal(hasTransferPair(TWO_ACTIVE), true)
  assert.equal(hasTransferPair(ONE_PLUS_OLD), false)
})

// ---------------------------------------------------------------------------
// surfaces that load their own branch rows: decided by the helpers, and the
// shape that makes that true is pinned (a hard-coded name or flag would fail)
// ---------------------------------------------------------------------------
await runTest('Dashboard: the branch card and its export entry come from the branch rows and the data', () => {
  const dashboard = src('components', 'dashboard', 'Dashboard.tsx')
  assert.match(dashboard, /const branchRows = useBranchRows\(\)/)
  assert.match(dashboard, /const showBranchPerformance = showsBranchComparison\(branchRows, analytics\?\.byBranch\?\.length \?\? 0\)/)
  assert.match(dashboard, /\{showBranchPerformance \? \(\s*<BranchPerformanceCard/)
  assert.match(dashboard, /\.\.\.\(showBranchPerformance \? \[\{ id: 'branches'/)
  assert.doesNotMatch(dashboard, /'Old Shop'|'LC Store'|=== 'Shop'/, 'no branch name is hard-coded')
})

await runTest('Reports: the branch filter keeps the retired branch (labelled), and the Branches view follows the rows', () => {
  const hub = src('components', 'sales', 'ReportsHub.tsx')
  assert.match(hub, /showsBranchHistoryFilter\(branchRows\) \? <AppSelect value=\{branchFilter\}/)
  assert.match(hub, /branchHistoryLabel\(branch, trh\('inactive', 'Inactive'\)\)/)
  assert.match(hub, /\.\.\.\(branchRows \?\? \[\]\)\.map/, 'every row, active or not, is offered')
  assert.match(hub, /branchComparison: branchRows === null \|\| showsBranchHistoryFilter\(branchRows\)/)
})

await runTest('Branches hub: all three transfer entry points are gated, the history filters offer every branch', () => {
  const hub = src('components', 'branches', 'Branches.tsx')
  assert.match(hub, /const transferBlocked = branches\.length > 0 && !hasTransferPair\(branches\)/)
  assert.match(hub, /disabled=\{transferBlocked\}\s+title=\{transferBlocked \? transferBlockedReason/, 'header Transfer: disabled, with the reason')
  assert.match(hub, /\{transferBlocked \? null : <button onClick=\{\(\) => setModal\('transfer'\)\}/, '"Transfer stock" link on an expanded branch')
  assert.match(hub, /className="btn-primary px-3 py-1\.5 text-sm disabled:cursor-not-allowed disabled:opacity-50" disabled=\{transferBlocked\}/, 'New transfer in the detail float')
  assert.equal((hub.match(/\.\.\.transferHistoryBranchOptions\.map/g) || []).length, 2, 'From and To both offer the retired branch')
  assert.doesNotMatch(hub, /\.\.\.transferBranchOptions\.map/, 'the active-only list no longer feeds a HISTORY filter')
  assert.match(hub, /branchFilterSections\.length > 0 \? \(\s*<FilterMenu/, 'no empty Filters button (beside the transfers tab consolidation toggle: CUTOVER-LD and LM composed)')
  assert.match(hub, /const showBranchCountTile = branchSummary\?\.branch_count == null \|\| Number\(branchSummary\.branch_count\) > 1/, 'the Branches count tile needs a count above one (an unknown count keeps today\'s tile)')
})

await runTest('history filters elsewhere: Expenses and Stock Changes keep the retired branch, labelled', () => {
  const fees = src('components', 'fees', 'FeesPage.tsx')
  assert.doesNotMatch(fees, /\.filter\(\(row\) => row\.is_active !== false\)/, 'the Expenses filter list is no longer cut to active rows')
  assert.match(fees, /showsBranchHistoryFilter\(branches\) \? \[\{/)
  const changes = src('components', 'products', 'StockChangeSection.tsx')
  assert.match(changes, /branchHistoryLabel\(\{ name: branch\.name, is_active: branch\.isActive \}/)
})

await runTest('write pickers collapse through the shared settled test (stale drafts keep them)', () => {
  const needle = 'branchChoiceSettled('
  for (const [file, pattern] of [
    [['components', 'products', 'forms', 'ProductForm.tsx'], /const initialBranchSettled = branchChoiceSettled\(branches\.map\(\(branch\) => branch\.id\), form\.branch_id \|\| defaultBranchId\)/],
    [['components', 'products', 'forms', 'VariantFormModal.tsx'], /const branchSettled = branchChoiceSettled\(branches\.map\(\(branch\) => branch\.id\), form\.branch_id \|\| \(branches\.length === 1 \? branches\[0\]\.id : ''\)\)/],
    [['components', 'returns', 'NewSupplierReturnModal.tsx'], /branchChoiceSettled\(branches\.map\(\(item\) => item\.id\), branchId\) \? null/],
    [['components', 'inventory', 'ManageBatchesModal.tsx'], /branchChoiceSettled\(branchSelectOptions\.map\(\(option\) => option\.value\), branchId\) \? null/],
    [['components', 'stock-session', 'StockSessionSharedDetails.tsx'], /branchChoiceSettled\(branchOptions\.map\(\(option\) => option\.value\), branchId\)/],
  ] as const) {
    const text = src(...file)
    assert.ok(text.includes(needle), `${file.join('/')} asks the shared helper`)
    assert.match(text, pattern, `${file.join('/')} gates on the settled test`)
  }
  const product = src('components', 'products', 'forms', 'ProductForm.tsx')
  assert.match(product, /isCreateMode && branches\.length > 0 && !initialBranchSettled \?/)
  assert.match(product, /activeTab === 'stock' && isEditMode && branches\.length > 0 \?/, 'the stock tab retains the sole active branch')
  const fast = src('components', 'inventory', 'FastStockInModal.tsx')
  assert.match(fast, /mode === 'add' \? receivingBranchOptions : labelInactiveChoices\(branchOptions, receivingBranchOptions, tr\('inactive', 'Inactive'\)\)/)
})

const productForm = (await load('components/products/forms/ProductForm.tsx')).default as React.ComponentType<Record<string, unknown>>
await runTest('create stock tab displays the settled sole branch without a dropdown', () => {
  const props = {
    product: null, categories: [], units: [], branches: [{ id: 1, name: 'Current Shop', is_default: 1 }],
    initialTab: 'stock', createDefaults: { branch_id: 1 }, onSave() {}, onClose() {},
    t: (key: string) => key, usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100,
    user: { id: 1, role_code: 'admin', role_permissions: { all: true } },
  }
  const render = (overrides: Record<string, unknown>) => quietLayoutEffectWarning(() => renderToStaticMarkup(React.createElement(productForm, { ...props, ...overrides })))
  for (const branchWord of ['Branch', 'សាខា']) {
    const html = render({ t: (key: string) => key === 'branch' ? branchWord : key })
    assert.match(html, /data-product-initial-sole-branch/)
    assert.ok(html.includes(`${branchWord}: Current Shop`))
    assert.doesNotMatch(html, /name="product_initial_branch"/)
  }
  const stale = render({ createDefaults: { branch_id: 2 } })
  assert.doesNotMatch(stale, /data-product-initial-sole-branch/)
  assert.match(stale, /name="product_initial_branch"/, 'stale branch selection still needs a choice')
})

const availability = await load('components/shared/AvailabilityFilterOptions.tsx') as {
  buildAvailabilityFilterSection: (props: Record<string, unknown>) => { summary: string; render: () => React.ReactNode }
}
await runTest('Availability renders the sole branch and preserves selected scope in EN/KM', () => {
  for (const branchWord of ['Branch', 'សាខា']) {
    const section = availability.buildAvailabilityFilterSection({
      t: (key: string) => key === 'branch' ? branchWord : key,
      branches: [{ id: 1, name: 'Current Shop' }], branchFilter: '1', setBranchFilter() {},
      stockFilter: 'all', setStockFilter() {}, groupFilter: 'all', setGroupFilter() {},
    })
    const html = quietLayoutEffectWarning(() => renderToStaticMarkup(section.render()))
    assert.match(html, /Current Shop/)
    assert.ok(html.includes(branchWord))
    assert.equal(section.summary, 'Current Shop')
  }
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
