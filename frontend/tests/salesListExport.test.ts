// Execute the actual SalesListReport menu/button callbacks and export hook with
// deterministic React scheduling. Presentation primitives are inert elements;
// transport/lazy import and authority are the only asynchronous boundaries.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '../src')
const slots: any[] = []
let hookIndex = 0, actor = 1, allowed = true
let context = { language: 'en', exchangeRate: 4100, settings: { business_name: 'Shop' }, user: { id: 1 } }
const same = (a: unknown[] | undefined, b: unknown[]) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
const react = {
  useRef(value: unknown) { const i = hookIndex++; slots[i] ??= { current: value }; return slots[i] },
  useState(value: unknown) { const i = hookIndex++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
    return [slots[i], (next: unknown) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
  useMemo(fn: () => unknown, deps: unknown[]) { const i = hookIndex++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value },
  useEffect(fn: () => (() => void) | undefined, deps: unknown[]) { const i = hookIndex++; if (!same(slots[i]?.deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } } },
}
const token = 'a'.repeat(64)
const money = { gross_sales_usd: 0, store_discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0,
  net_revenue_usd: 0, pending_revenue_usd: 0, collected_total_usd: 0 }
const row = (id: number) => ({ ...money, id, date: `2026-09-24T0${id}:00:00Z`, cursor_at: `2026-09-24T0${id}:00:00Z`, business_date: '2026-09-24',
  receipt_number: `00000${id}`, customer_phone: '000123', customer: 'សុខា', branch: 'Shop', cashier: 'A', payment_method: 'Cash', status: 'completed' })
const total = { ...money, revenue_usd: .01 }
const envelope = (rows: unknown[], more = false) => ({ export_version: 1, export_token: token, snapshot_max_id: 2, row_count: 2,
  totals: total, rows, has_more: more, next_cursor: more ? { id: 2, created_at: row(2).cursor_at } : null })
const verified = { export_version: 1, export_token: token, snapshot_max_id: 2, row_count: 2, verified: true }
const calls: any[] = [], downloads: any[] = [], prints: any[] = []
let transport: (query: any) => Promise<unknown> = async query => query.verifyOnly ? verified : query.afterId ? envelope([row(1)]) : envelope([row(2)], true)
let importExcel: () => Promise<unknown> = async () => ({ downloadTypedWorkbook: (_file: string, input: unknown, current: () => boolean) => { assert.equal(current(), true); downloads.push(input) } })
const modules = new Map<string, any>()
const jsx = (type: unknown, props: unknown) => ({ type, props })
function load(file: string): any {
  if (modules.has(file)) return modules.get(file).exports
  const mod = { exports: {} }
  modules.set(file, mod)
  let source = fs.readFileSync(file, 'utf8')
  // Keep the actual hook body, replacing only module acquisition with a
  // controllable promise so revocation can occur during a lazy import.
  if (file.endsWith('salesListExport.ts')) source = source.replace("import('../../../utils/xlsxExport.ts')", '__testImportExcel()')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file }).outputText
  const localRequire = (name: string): any => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    if (name.includes('AppContext')) return { useApp: () => context }
    if (name.includes('actorReadScope')) return { captureActorReadScope: () => ({ actor }), isActorReadScopeCurrent: (scope: any) => scope.actor === actor }
    if (name.includes('reportsTransport')) return { getBusinessSummarySalesPage: async (query: unknown) => { calls.push(query); return transport(query) } }
    if (name.endsWith('/csv.ts')) return { downloadCSV: (_file: string, rows: unknown[]) => downloads.push(rows) }
    if (name.endsWith('/exportOptions.ts')) return { openPrintExport: (input: unknown, current: () => boolean) => { assert.ok(current()); prints.push({ input, current }); return true } }
    if (name.includes('shared/kit')) return { Button: 'Button', Fold: 'Fold', OverflowMenu: 'OverflowMenu' }
    if (name.includes('lucide-react')) return { default: 'Icon' }
    if (name === './usePagedReport.ts') return { usePagedReport: () => ({ rows: [row(2)], hasMore: true, loading: false, error: null, reload: () => {}, loadMore: () => {} }) }
    if (['./ReportFrame.tsx', './ReportTable.tsx', './ReceiptSheet.tsx'].includes(name)) return { __esModule: true, default: name.slice(2, -4) }
    if (name.includes('StatusBadge')) return { getStatusLabel: (status: string) => status }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), /\.[cm]?[jt]sx?$/.test(name) ? name : `${name}.ts`))
    return require(name)
  }
  new Function('require', 'module', 'exports', '__testImportExcel', output)(localRequire, mod, mod.exports, () => importExcel())
  return mod.exports
}
const SalesListReport = load(path.join(root, 'components/sales/reports/SalesListReport.tsx')).default
const { getReportView } = load(path.join(root, 'components/sales/reports/reportModel.ts'))
let props: any = { view: getReportView('sales'), filters: { startDate: '2026-09-24', endDate: '2026-09-24', branchId: '', status: '', paymentMethod: '' },
  search: '', exportScopeKey: '', options: { basis: 'revenue', currency: 'usd' }, style: 'excel',
  tr: (_key: string, fallback: string) => fallback, t: (key: string) => key, fmtMoney: (n: number) => `$${n.toFixed(2)}`,
  canExport: () => allowed }
let tree: any
function render() { hookIndex = 0; tree = SalesListReport(props); return tree }
function nodes(node = tree): any[] { return !node ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item)) : typeof node === 'object' ? [node, ...nodes(node.props?.children ?? null)] : [] }
function preview() { return nodes().find(node => node.type === 'section' && node.props['aria-label'] === 'Export preview') }
function menu(label: string) { return tree.props.menuAction.props.items.find((item: any) => item.label === label).onSelect() }
function button(label: string) {
  const result = nodes(preview()).find(node => node.type === 'Button' && node.props.children === label)
  assert.ok(result, `preview ${label} button exists`)
  return result.props.onClick()
}
async function settled() { await new Promise<void>(resolve => setImmediate(resolve)); render() }
async function prepare() { render(); menu('Export CSV'); await settled(); assert.ok(preview(), 'verified completed report preview is published') }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

render()
assert.equal(nodes().find(node => node.type === 'ReportTable').props.rows.length, 1, 'only one browsing page row is loaded')
await prepare()
assert.equal(calls.length, 3, 'menu executes all pages plus final verification')
const table = nodes(preview()).find(node => node.type === 'ReportTable')
assert.equal(table.props.rows.length, 2)
assert.equal(table.props.totalsRow.net_revenue_usd, .01, 'preview uses authoritative total, not rounded row sum')
button('Export CSV')
assert.equal(downloads.at(-1).length, 3, 'CSV contains both receipts and canonical total')
assert.equal(downloads.at(-1).at(-1).Revenue, '$0.01')
button('Print')
assert.equal(prints.at(-1).input.rows.length, 2)
assert.equal(prints.at(-1).input.totals.Revenue, '$0.01')
button('Export Excel'); await settled()
assert.equal(downloads.at(-1).rows.length, 2)
const pendingPrintGuard = prints.at(-1).current
await prepare()
assert.equal(pendingPrintGuard(), false, 'old delayed print guard rejects after a newer prepare')
render(); assert.ok(preview(), 'rejected old print does not erase the newer preview')

const outputCount = () => downloads.length + prints.length
let before = outputCount()
const held = deferred<unknown>()
transport = async () => held.promise
menu('Print'); allowed = false; held.resolve(envelope([row(2), row(1)])); await settled()
assert.equal(outputCount(), before); assert.equal(preview(), undefined); assert.ok(tree.props.error, 'revocation is visible and publishes nothing')
allowed = true
transport = async query => query.verifyOnly ? verified : envelope([row(2), row(1)])
await prepare()
const oldCsv = nodes(preview()).find(node => node.type === 'Button' && node.props.children === 'Export CSV').props.onClick
props = { ...props, exportScopeKey: 'new raw text' }; render()
assert.equal(preview(), undefined, 'raw search edit invalidates before the250ms debounce changes query')
oldCsv(); await settled(); assert.equal(outputCount(), before)
menu('Print'); await settled(); assert.equal(preview(), undefined, 'cannot prepare the old query during pending debounce')
props = { ...props, search: 'new raw text' }; render(); await prepare()

const pendingImport = deferred<any>()
importExcel = () => pendingImport.promise
button('Export Excel')
allowed = false
pendingImport.resolve({ downloadTypedWorkbook: () => downloads.push('LEAK') }); await settled()
assert.equal(outputCount(), before); assert.ok(tree.props.error, 'revocation during lazy import is visible')
allowed = true; await prepare()
const staleImport = deferred<any>()
importExcel = () => staleImport.promise
button('Export Excel')
menu('Print'); await settled(); assert.ok(preview())
staleImport.resolve({ downloadTypedWorkbook: () => downloads.push('LEAK') }); await settled()
assert.ok(preview(), 'old import failure must not erase the newer completed generation')
assert.equal(outputCount(), before)

for (const mutation of [() => { actor++ }, () => { props = { ...props, filters: { ...props.filters, branchId: '2' } } },
  () => { context = { ...context, language: 'km', exchangeRate: 4000 } }]) {
  await prepare()
  const stale = nodes(preview()).find(node => node.type === 'Button' && node.props.children === 'Export CSV').props.onClick
  mutation(); render(); stale(); await settled()
  assert.equal(outputCount(), before)
  assert.equal(preview(), undefined)
}
transport = async query => { if (query.verifyOnly) throw { code: 'report_export_changed' }; return envelope([row(2), row(1)]) }
menu('Print'); await settled(); assert.equal(preview(), undefined); assert.match(tree.props.error, /changed/)
for (const bad of [{ ...envelope([], false), row_count: 0 }, { ...envelope([row(2)]), row_count: 10001 },
  envelope([{ ...row(2), net_revenue_usd: null }, row(1)])]) {
  transport = async () => bad; menu('Export CSV'); await settled(); assert.ok(tree.props.error); assert.equal(preview(), undefined)
}
assert.equal(outputCount(), before, 'every failure leaves downloads and print untouched')
const unmounted = deferred<unknown>()
transport = async () => unmounted.promise
menu('Print')
for (const slot of slots) slot?.cleanup?.()
unmounted.resolve(envelope([row(2), row(1)])); await settled()
assert.equal(outputCount(), before, 'unmount prevents publication')
assert.ok(fs.readFileSync(path.join(root, 'components/sales/ReportsHub.tsx'), 'utf8').includes('exportScopeKey: supportsSearch ? searchText'), 'actual hub passes immediate search control state')
console.log('PASS actual Sales menu/buttons: complete rows + canonical preview, CSV/Excel/print; permission, debounce, filter, actor, display, token, lazy-import, superseding and unmount fences')
