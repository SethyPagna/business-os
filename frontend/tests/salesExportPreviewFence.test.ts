import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/sales/ExportModal.tsx', import.meta.url), 'utf8')
function load(text: string, dependencies: Record<string, unknown>) {
  const module = { exports: {} as any }
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)((id: string) => dependencies[id] || { default: id }, module, module.exports)
  return module.exports
}
const loaders = load(readFileSync(new URL('../src/utils/loaders.ts', import.meta.url), 'utf8'), {})
const fullDay = { startDate: '2026-09-08', endDate: '2026-09-09', startTime: '00:00', endTime: '23:59' }
const narrow = { ...fullDay, startTime: '09:00', endTime: '11:00' }
const response = (amount: number) => ({ period: { start: fullDay.startDate, end: fullDay.endDate }, summary: { net_revenue_usd: amount } })
function deferred() {
  let resolve!: (value: any) => void
  let reject!: (error: Error) => void
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function mount(api: (params: any) => Promise<any>, timeout = 1000) {
  let cursor = 0, alive = true, lateWrites = 0, closed = 0
  let user: any = { id: 1, organization_id: 7, role_code: 'admin' }
  let permissions = { 'reports.export': true, 'products.view_cost_price': true }
  const slots: any[] = [], effects: any[] = [], queued: (() => void)[] = [], notices: string[] = [], downloads: Blob[] = []
  const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...Object.values(node.props).flatMap(nodes)] : []
  const component = load(source, {
    react: {
      useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (next: any) => { if (!alive) lateWrites++; slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
      useRef(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
      useMemo(fn: () => any) { return fn() },
      useEffect(fn: () => any, deps: any[]) { const i = cursor++; const old = effects[i]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) queued.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() } }) },
    },
    'react/jsx-runtime': { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) },
    '../../app/AppContextCore.tsx': { useApp: () => ({ user, getPermissions: () => permissions, notify: (message: string) => notices.push(message) }) },
    '../shared/Modal': { __esModule: true, default: 'Modal' },
    '../shared/DateTimeRangePicker.tsx': { __esModule: true, default: 'Picker', todayDateTimeRange: () => ({ ...fullDay }) },
    '../../utils/loaders.ts': { withLoaderTimeout: (fn: () => Promise<any>, label: string) => loaders.withLoaderTimeout(fn, label, timeout) },
    '../../utils/formatters.ts': { fmtDateOnly: (value: string) => value },
    '../../utils/salesImportContract.ts': { SALES_IMPORT_COLUMNS: ['receipt_number', 'sale_date', 'name'] },
  })
  const prior = { window: globalThis.window, alert: globalThis.alert, document: globalThis.document, URL: globalThis.URL }
  Object.assign(globalThis, { window: { api: { getSalesExport: api } }, alert: () => { throw new Error('native alert() must not be used; errors go through notify') }, document: { createElement: () => ({ click() {} }) }, URL: { createObjectURL: (blob: Blob) => { downloads.push(blob); return 'blob:test' }, revokeObjectURL() {} } })
  const render = (flush = true) => { cursor = 0; const tree = component.default({ t: (key: string) => key, fmtUSD: (amount: number) => '$' + amount, onClose: () => closed++ }); if (flush) queued.splice(0).forEach(fn => fn()); return tree }
  const button = (label: string) => nodes(render()).find(node => node.type === 'button' && (node.props['aria-label'] === label || node.props.children?.includes?.(label))).props.onClick
  const change = (range: typeof fullDay) => nodes(render()).find(node => node.type === 'Picker').props.onChange(range)
  const text = (node: any): string => Array.isArray(node) ? node.map(text).join('|') : node?.props ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  render()
  return {
    render, button, change, notices, downloads,
    text: () => text(render()),
    loading: () => nodes(render()).find(node => node.type === 'fieldset').props.disabled,
    actor(next: any) { user = next }, permissions(next: typeof permissions) { permissions = next },
    close() { nodes(render()).find(node => node.type === 'Modal').props.onClose() },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); alive = false },
    lateWrites: () => lateWrites, closed: () => closed,
    cleanup() { Object.assign(globalThis, prior) },
  }
}
let failures = 0, passes = 0
async function check(name: string, body: () => Promise<void>) { try { await body(); passes++; console.log('PASS ' + name) } catch (error) { failures++; console.error('FAIL ' + name, error) } }
await check('unchanged current preview is accepted', async () => {
  const m = mount(async () => response(123)); try { await m.button('Preview Summary')(); assert.match(m.text(), /\$123/); assert.equal(m.loading(), false) } finally { m.cleanup() }
})
await check('selection changes reject late success and permit retry', async () => {
  const old = deferred(); let calls = 0; const m = mount(() => ++calls === 1 ? old.promise : Promise.resolve(response(123)))
  let pending: Promise<void> | undefined
  try { pending = m.button('Preview Summary')(); m.change(narrow); assert.equal(m.loading(), false); await m.button('Preview Summary')(); old.resolve(response(987.65)); await pending; assert.match(m.text(), /\$123/); assert.doesNotMatch(m.text(), /\$987\.65/) } finally { old.resolve(response(0)); await pending; m.cleanup() }
})
for (const order of ['old-first', 'new-first']) await check('multiple previews complete ' + order, async () => {
  const old = deferred(), current = deferred(); let calls = 0; const m = mount(() => ++calls === 1 ? old.promise : current.promise)
  let first: Promise<void> | undefined, second: Promise<void> | undefined
  try {
    first = m.button('Preview Summary')(); m.change(narrow); second = m.button('Preview Summary')()
    if (order === 'old-first') { old.resolve(response(987.65)); await first; assert.equal(m.loading(), true); assert.doesNotMatch(m.text(), /\$987\.65/); current.resolve(response(123)); await second }
    else { current.resolve(response(123)); await second; old.resolve(response(987.65)); await first }
    assert.match(m.text(), /\$123/); assert.equal(m.loading(), false)
  } finally { old.resolve(response(0)); current.resolve(response(0)); await first; await second; m.cleanup() }
})
await check('stale failures do not alert or clear a newer pending preview', async () => {
  const old = deferred(), current = deferred(); let calls = 0; const m = mount(() => ++calls === 1 ? old.promise : current.promise)
  let first: Promise<void> | undefined, second: Promise<void> | undefined
  try { first = m.button('Preview Summary')(); m.change(narrow); second = m.button('Preview Summary')(); old.reject(Error('old error')); await first; assert.deepEqual(m.notices, []); assert.equal(m.loading(), true); current.resolve(response(123)); await second } finally { old.resolve(response(0)); current.resolve(response(0)); await first; await second; m.cleanup() }
})
await check('lost response times out, retry succeeds, original late response stays discarded', async () => {
  const lost = deferred(); let calls = 0; const m = mount(() => ++calls === 1 ? lost.promise : Promise.resolve(response(123)), 5)
  try { await m.button('Preview Summary')(); assert.equal(m.loading(), false); assert.equal(m.notices.length, 1); await m.button('Preview Summary')(); lost.resolve(response(987.65)); await new Promise(resolve => setImmediate(resolve)); assert.match(m.text(), /\$123/); assert.doesNotMatch(m.text(), /\$987\.65/) } finally { m.cleanup() }
})
for (const disposition of ['close', 'unmount']) await check(disposition + ' discards pending preview without state writes or alert', async () => {
  const pending = deferred(); const m = mount(() => pending.promise)
  try { const work = m.button('Preview Summary')(); if (disposition === 'close') { m.close(); assert.equal(m.closed(), 1) } else m.unmount(); pending.resolve(response(987.65)); await work; assert.equal(m.lateWrites(), 0); assert.deepEqual(m.notices, []); assert.doesNotMatch(m.text(), /\$987\.65/) } finally { m.cleanup() }
})
for (const change of ['actor', 'permissions']) await check(change + ' invalidates cached and pending summaries', async () => {
  const pending = deferred(); let calls = 0; const m = mount(() => ++calls === 1 ? Promise.resolve(response(123)) : pending.promise)
  let work: Promise<void> | undefined
  try {
    await m.button('Preview Summary')(); assert.match(m.text(), /\$123/); work = m.button('Preview Summary')()
    if (change === 'actor') m.actor({ id: 2, organization_id: 9, role_code: 'viewer' }); else m.permissions({ 'reports.export': true, 'products.view_cost_price': false })
    const tree = m.render(false); assert.equal(JSON.stringify(tree).includes('$123'), false, 'cached previous-owner summary disappears on render before effects')
    m.render(); assert.equal(m.loading(), false); pending.resolve(response(987.65)); await work; assert.doesNotMatch(m.text(), /\$987\.65/)
  } finally { pending.resolve(response(0)); await work; m.cleanup() }
})
await check('CSV remains frozen across portal selection changes and all pages', async () => {
  const first = deferred(); const calls: any[] = []; const m = mount(query => { calls.push(query); return calls.length === 1 ? first.promise : Promise.resolve({ sales: [{ receipt_number: 'NEXT' }], has_more: false }) })
  try { const work = m.button('Export')(); m.change(narrow); assert.equal(m.loading(), true); first.resolve({ sales: [{ receipt_number: 'FIRST' }], has_more: true, snapshot_max_id: 91, next_cursor: { created_at: '2026-09-08 01:00:00', id: 4 } }); await work; assert.equal(calls.length, 2); for (const q of calls) assert.deepEqual([q.startTime, q.endTime], ['00:00', '23:59']); assert.equal(calls[1].snapshotMaxId, '91'); assert.equal(m.downloads.length, 1); assert.equal(m.loading(), false) } finally { m.cleanup() }
})
await check('missing dates refuse without transport or uncaught errors', async () => {
  const m = mount(async () => { throw Error('must not request') }); try { m.change({ ...narrow, startDate: '', endDate: '' }); await m.button('Preview Summary')(); assert.deepEqual(m.notices, ['Please select start and end dates']); assert.equal(m.loading(), false) } finally { m.cleanup() }
})
console.log(`${passes} passed, ${failures} failed`)
if (failures) process.exitCode = 1
