import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const read = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const storage = () => { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, String(v)), removeItem: (k: string) => values.delete(k) } }
const jsx = (type: any, props: any) => ({ type, props })
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []

async function exercise(mutant = false) {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch
  globalThis.window = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage() }) as any
  const http = await import('../src/api/http.ts')
  const transport = await import('../src/api/shiftTransport.ts')
  const previousUrl = http.getSyncServerUrl()
  http.setSyncServerUrl('https://shift-refresh.test'); http.cacheClearAll(); http.__resetApiHealthForTests()
  let total = 245
  const requests: number[] = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    const page = Math.min(Number(url.searchParams.get('page') || 1), Math.max(1, Math.ceil(total / 20)))
    requests.push(page)
    const shifts = Array.from({ length: Math.min(20, total - (page - 1) * 20) }, (_, i) => ({ id: (page - 1) * 20 + i + 1, business_date: '2026-09-20', opened_at: '2026-09-20T00:00:00Z', closed_at: null }))
    return new Response(JSON.stringify({ shifts, scope: 'own', page, page_size: 20, total }), { headers: { 'Content-Type': 'application/json' } })
  }
  type Host = { slots: any[]; cursor: number; pending: Array<() => void>; dirty: boolean }
  const parent: Host = { slots: [], cursor: 0, pending: [], dirty: false }
  const child: Host = { slots: [], cursor: 0, pending: [], dirty: false }
  let host = parent
  const hooks = {
    useState(initial: any) { const owner = host, i = owner.cursor++; if (!(i in owner.slots)) owner.slots[i] = typeof initial === 'function' ? initial() : initial
      return [owner.slots[i], (v: any) => { const next = typeof v === 'function' ? v(owner.slots[i]) : v; if (!Object.is(next, owner.slots[i])) { owner.slots[i] = next; owner.dirty = true } }] },
    useRef(initial: any) { const i = host.cursor++; return host.slots[i] ??= { current: initial } },
    useCallback(fn: any, deps: any[]) { const i = host.cursor++; if (!host.slots[i] || deps.some((v, j) => !Object.is(v, host.slots[i].deps[j]))) host.slots[i] = { fn, deps }; return host.slots[i].fn },
    useEffect(fn: any, deps: any[]) { const owner = host, i = owner.cursor++; if (!owner.slots[i] || deps.some((v, j) => !Object.is(v, owner.slots[i].deps[j]))) owner.pending.push(() => { owner.slots[i]?.cleanup?.(); owner.slots[i] = { deps, cleanup: fn() } }) },
  }
  const t = (key: string) => key
  const compile = (source: string, resolve: (id: string) => any) => {
    const mod: any = { exports: {} }
    new Function('require', 'module', 'exports', transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
      if (id === 'react') return hooks
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      return resolve(id)
    }, mod, mod.exports)
    return mod.exports
  }
  const pager = compile(read('components/shared/PaginationControls.tsx'), (id) => id.includes('pagerState') ? require('../src/utils/pagerState.ts') : { default: id })
  let modal = read('components/shifts/ShiftHistoryModal.tsx')
  if (mutant) {
    const original = modal
    modal = modal.replace('setPageInfo({ page, total: null })\n    setLoading(true)', 'setPageInfo({ page, total: 0 })')
    assert.notEqual(modal, original, 'negative control must actually remove the unloaded-state guard')
  }
  const component = compile(modal, (id) => {
    if (id.includes('PaginationControls')) return { __esModule: true, default: pager.default, DEFAULT_PAGE_SIZE: 20 }
    if (id.includes('AppContext')) return { useApp: () => ({ user: { id: 7 }, t }) }
    if (id.includes('shiftTransport')) return transport
    if (id.includes('ShiftGate')) return { SHIFT_STATE_CHANGED_EVENT: 'business-os:shift-state-changed', SHIFT_BRANCH_CHANGED_EVENT: 'business-os:shift-branch-changed' }
    if (id.includes('constants')) return { BUSINESS_TIME_ZONE: 'Asia/Phnom_Penh' }
    return { __esModule: true, default: id }
  }).default
  let tree: any, pagerNode: any
  const commit = () => {
    for (let i = 0; i < 20; i++) {
      host = parent; parent.cursor = 0; parent.dirty = false; parent.pending = []
      tree = component({ branchId: 1 })
      if (parent.dirty) continue // React restarts render before committing children.
      pagerNode = nodes(tree).find((node) => node.type === pager.default)
      if (pagerNode) { host = child; child.cursor = 0; child.pending = []; pager.default(pagerNode.props); child.pending.splice(0).forEach((job) => job()) }
      parent.pending.splice(0).forEach((job) => job())
      if (!parent.dirty) return
    }
    throw new Error('render did not stabilize')
  }
  const settle = async () => { for (let i = 0; i < 8; i++) { commit(); await new Promise((resolve) => setImmediate(resolve)) } commit() }
  try {
    commit(); nodes(tree).find((node) => node.type === 'button')!.props.onClick(); await settle()
    assert.equal(pagerNode.props.page, 1)
    pagerNode.props.onPageChange(2); await settle()
    assert.equal(pagerNode.props.page, 2, 'history Next must not auto-clamp from transient unloaded totals')
    assert.equal(pagerNode.props.totalItems, 245)
    assert.deepEqual(requests, [1, 2])
    // Cache is genuinely warm: ordinary read makes no fetch.
    await transport.listShifts({ branchId: 1, page: 2, pageSize: 20 })
    assert.equal(requests.length, 2)
    total = 21
    nodes(tree).find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('refresh'))!.props.onClick()
    await settle()
    assert.equal(requests.length, 3, 'actual Refresh button must fetch despite fresh20s cache')
    assert.equal(pagerNode.props.totalItems, 21)
    pagerNode.props.onPageChange(1); await settle()
    assert.equal(pagerNode.props.totalItems, 21, 'returning to an earlier page cannot revive its pre-refresh total')
    assert.equal(requests.length, 4)
    total = 5
    window.dispatchEvent(new Event('business-os:shift-state-changed'))
    await settle()
    assert.equal(requests.length, 5, 'actual SHIFT event is independently fresh without a synthetic sync:update')
    assert.equal(pagerNode.props.totalItems, 5)
    assert.equal(pagerNode.props.page, 1)
  } finally {
    for (const owner of [parent, child]) owner.slots.forEach((slot) => slot?.cleanup?.())
    http.cacheClearAll(); http.setSyncServerUrl(previousUrl); globalThis.window = previousWindow; globalThis.fetch = previousFetch
  }
}

test('actual history render/shared pager effects and real cached transport preserve Next and fresh Refresh', async () => { await exercise() })
test('negative control reproduces snapback when unloaded count is treated as zero', async () => {
  await assert.rejects(() => exercise(true), /history Next must not auto-clamp/)
})

test('explicit fresh list read detaches old in-flight response and prevents stale cache refill', async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch
  globalThis.window = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage() }) as any
  const http = await import('../src/api/http.ts'), transport = await import('../src/api/shiftTransport.ts')
  const previousUrl = http.getSyncServerUrl()
  http.setSyncServerUrl('https://shift-refresh.test'); http.cacheClearAll(); http.__resetApiHealthForTests()
  const replies: Array<(value: Response) => void> = []
  globalThis.fetch = () => new Promise<Response>((resolve) => replies.push(resolve))
  const response = (total: number) => new Response(JSON.stringify({ shifts: [], total, page: 1, page_size: 20, scope: 'own' }), { headers: { 'Content-Type': 'application/json' } })
  const filters = { branchId: 1, page: 1, pageSize: 20 }
  try {
    const old = transport.listShifts(filters)
    await new Promise((resolve) => setImmediate(resolve))
    const fresh = transport.listShifts(filters, { fresh: true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(replies.length, 2, 'fresh action cannot deduplicate onto stale in-flight request')
    replies[1](response(21)); assert.equal((await fresh).total, 21)
    replies[0](response(245)); await old
    assert.equal((await transport.listShifts(filters)).total, 21, 'late old result cannot refill refreshed cache')
    assert.equal(replies.length, 2)
  } finally { http.cacheClearAll(); http.setSyncServerUrl(previousUrl); globalThis.window = previousWindow; globalThis.fetch = previousFetch }
})
