import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/contacts/useStockInInvoiceReport.ts', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/components/contacts/StockInInvoicesSection.tsx', import.meta.url), 'utf8')
assert.match(component, /useStockInInvoiceReport\(\{/)
assert.match(component, /actorKey: JSON.stringify\(user \?\? null\)/)
assert.match(component, /onClose=\{closeGroup\}/)
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function deferred() {
  let resolve!: (value: any) => void
  let reject!: (error: Error) => void
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
const group = { supplier_key: 'id:1', received_day: '2026-09-20', line_count: 1, units_received: 2, cost_usd: 10, lines_without_cost: 0, credit_lines: 0 }
const groupKey = 'id:1|2026-09-20'
const payload = (name: string) => ({ lines: [{ id: 1, product_name: name }], total_lines: 300 })

function harness() {
  const slots: any[] = []
  let index = 0, writes = 0
  let pending: Array<() => void> = []
  let authority = 'actor-A', revision = '0', blocked = false
  const reports: Array<ReturnType<typeof deferred> & { params: any }> = []
  const lines: Array<ReturnType<typeof deferred> & { params: any }> = []
  const changed = (a: unknown[] | undefined, b: unknown[]) => !a || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]))
  const react = {
    useState(initial: any) {
      const i = index++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (next: any) => { writes++; slots[i] = typeof next === 'function' ? next(slots[i]) : next }]
    },
    useRef(initial: any) { const i = index++; return slots[i] ??= { current: initial } },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const i = index++
      if (changed(slots[i]?.deps, deps)) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } })
    },
  }
  const mod = { exports: {} as any }
  new Function('require', 'exports', compiled)((name: string) => {
    if (name === 'react') return react
    if (name.includes('contactReadTransport')) return {
      getStockInInvoiceReport(params: any) { const d = { ...deferred(), params }; reports.push(d); return d.promise },
      getStockInInvoiceLines(params: any) { const d = { ...deferred(), params }; lines.push(d); return d.promise },
    }
    if (name.includes('actorReadScope')) return {
      captureActorReadScope: () => ({ authority, revision }),
      isActorReadScopeCurrent: (s: any) => !blocked && s.authority === authority && s.revision === revision,
    }
    if (name.includes('PaginationControls')) return { clampPage: (p: number, n: number, size: number) => Math.max(1, Math.min(p, Math.max(1, Math.ceil(n / size)))) }
    throw new Error(`Unexpected import ${name}`)
  }, mod.exports)
  const input = { branchId: 'all', supplierKey: 'all', fromDate: '2026-09-20', toDate: '2026-09-20', page: 1, pageSize: 20, refreshToken: 0, actorKey: 'A:cost-view', setPage: (page: number) => { input.page = page }, errorText: 'failed' }
  return {
    input, reports, lines,
    render() { index = 0; return mod.exports.useStockInInvoiceReport(input) },
    effects() { const jobs = pending; pending = []; jobs.forEach(job => job()) },
    unmount() { slots.forEach(s => s?.cleanup?.()); pending = [] },
    actor(value: string) { authority = value }, invalidate() { revision += '1' }, block() { blocked = true },
    get writes() { return writes },
  }
}
async function ready(h: ReturnType<typeof harness>) {
  h.render(); h.effects()
  h.reports.at(-1)!.resolve({ invoices: [group], total_invoices: 1 }); await settle()
  const state = h.render()
  assert.equal(state.data.invoices[0].supplier_key, group.supplier_key)
  state.openGroup(group)
  assert.equal(h.render().detailGroup, group)
}

let passed = 0
for (const boundary of ['filter', 'account', 'unmount']) {
  for (const rejects of [false, true]) {
    const h = harness(); h.render(); h.effects()
    const old = h.reports[0]
    if (boundary === 'filter') { h.input.branchId = '2'; h.render() }
    else if (boundary === 'account') h.actor('B')
    else h.unmount()
    const writes = h.writes
    if (rejects) old.reject(new Error('old report')); else old.resolve({ invoices: [group], total_invoices: 1 })
    await settle(); assert.equal(h.writes, writes, `${boundary}: old report completion cannot write`)
    h.unmount(); passed++
  }
}
for (const field of ['branchId', 'supplierKey', 'fromDate', 'toDate', 'actorKey', 'refreshToken', 'page', 'pageSize', 'authority', 'revision'] as const) {
  for (const rejects of [false, true]) {
    const h = harness(); await ready(h)
    const retained = h.render()
    const old = h.lines[0]
    if (field === 'authority') h.actor('actor-B')
    else if (field === 'revision') h.invalidate()
    else if (typeof h.input[field] === 'number') (h.input as any)[field]++
    else (h.input as any)[field] += '-changed'
    const masked = h.render() // Deliberately BEFORE old effect cleanup.
    assert.equal(masked.data, null, field)
    assert.equal(masked.detailGroup, null, field)
    assert.deepEqual(masked.lineCache, {}, field)
    const writes = h.writes, requests = h.lines.length
    retained.openGroup(group); retained.loadLines(group, 2)
    assert.equal(h.lines.length, requests, 'retained handlers cannot dispatch in a retired scope')
    if (rejects) old.reject(new Error('old failure')); else old.resolve(payload('old private product'))
    await settle(); assert.equal(h.writes, writes, `${field}: stale completion cannot write`)
    h.effects()
    h.reports.at(-1)!.resolve({ invoices: [group], total_invoices: 100 }); await settle()
    h.render().openGroup(group)
    h.lines.at(-1)!.resolve(payload('current product')); await settle()
    assert.equal(h.render().lineCache[groupKey].lines[0].product_name, 'current product')
    h.unmount(); passed++
  }
}

// Already-cached detail is hidden immediately, and returning to A never
// resurrects an old A generation (even before a new group request finishes).
{
  const h = harness(); await ready(h)
  h.lines[0].resolve(payload('cached A')); await settle()
  assert.equal(h.render().lineCache[groupKey].lines[0].product_name, 'cached A')
  h.render().closeGroup(); h.render().openGroup(group)
  assert.equal(h.lines.length, 1, 'same-scope reopen retains useful cache')
  h.input.branchId = '2'; assert.equal(h.render().detailGroup, null); h.effects()
  h.input.branchId = 'all'; assert.deepEqual(h.render().lineCache, {}); h.effects()
  h.reports[1].resolve({ invoices: [{ ...group, supplier_name: 'obsolete branch' }], total_invoices: 1 }); await settle()
  assert.equal(h.render().data, null)
  h.reports[2].reject(new Error('new scope failed')); await settle()
  assert.equal(h.render().data, null); assert.equal(h.render().error, 'new scope failed')
  h.unmount(); passed++
}

// Same-group pagination and error races: only the newest request may write.
for (const rejects of [false, true]) {
  const h = harness(); await ready(h)
  h.render().loadLines(group, 2)
  h.lines[1].resolve(payload('page two')); await settle()
  const writes = h.writes
  if (rejects) h.lines[0].reject(new Error('obsolete page')); else h.lines[0].resolve(payload('page one'))
  await settle(); assert.equal(h.writes, writes)
  assert.equal(h.render().lineCache[groupKey].page, 2)
  assert.equal(h.render().lineCache[groupKey].lines[0].product_name, 'page two')
  h.render().loadLines(group, 3)
  assert.deepEqual(h.render().lineCache[groupKey].lines, [], 'new page cannot show previous page rows under its new page label')
  h.unmount(); passed++
}

// Actor changes and unmount must fence even without another component render.
for (const boundary of ['actor', 'unmount', 'quarantine']) {
  const h = harness(); await ready(h)
  h.render().loadLines(group, 5)
  if (boundary === 'actor') h.actor('B')
  else if (boundary === 'unmount') h.unmount()
  else h.block()
  const writes = h.writes
  h.lines[1].resolve({ lines: [], total_lines: 0 }); await settle()
  assert.equal(h.writes, writes)
  assert.equal(h.lines.length, 2, 'retired completion cannot dispatch a corrected page')
  h.unmount(); passed++
}

// Current scope page clamping remains functional, preserving query semantics.
{
  const h = harness(); await ready(h)
  h.render().loadLines(group, 5)
  h.lines[1].resolve({ lines: [], total_lines: 1 }); await settle()
  assert.deepEqual(h.lines[2].params, { supplier_key: 'id:1', day: '2026-09-20', branch_id: '', page: 1, page_size: 100 })
  h.lines[2].resolve({ lines: [{ id: 7 }], total_lines: 1 }); await settle()
  assert.equal(h.render().lineCache[groupKey].lines[0].id, 7)
  h.unmount(); passed++
}
{
  const h = harness(); await ready(h)
  const other = { ...group, supplier_key: 'id:2' }
  h.render().openGroup(other)
  h.lines[1].resolve(payload('selected supplier')); await settle()
  h.lines[0].resolve(payload('other cached supplier')); await settle()
  const state = h.render()
  assert.equal(state.detailGroup, other)
  assert.equal(state.lineCache['id:2|2026-09-20'].lines[0].product_name, 'selected supplier')
  assert.equal(state.lineCache[groupKey].lines[0].product_name, 'other cached supplier')
  h.unmount(); passed++
}
console.log(`stockInInvoiceScope: ${passed} executed loader/state cases passed`)
