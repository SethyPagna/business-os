import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'

const source = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const lifecycleStart = source.indexOf('  type SalesStripPayload =')
const lifecycleEnd = source.indexOf('\n  useEffect(() => {\n    if (!isActive)', lifecycleStart)
const cardsStart = source.indexOf('  const stripHasTime =')
const cardsEnd = source.indexOf('\n  // A sale "counts"', cardsStart)
assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart && cardsStart >= 0 && cardsEnd > cardsStart)
const lifecycle = source.slice(lifecycleStart, lifecycleEnd)
const cards = source.slice(cardsStart, cardsEnd)

// Execute the actual component's lifecycle AND card projection. Defer effects
// explicitly so a render-before-cleanup leak cannot hide behind a green test.
const run = new Function(`${stripTypeScriptTypes(`
function render(hooks: any, props: any, api: any, helpers: any) {
  const { useState, useRef, useMemo, useCallback, useEffect } = hooks
  const { stripRange, isActive, user, canViewSales, canViewFees, getPermissionTier } = props
  const { getSalesStatsStrip, getFeesReport } = api
  const { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } = helpers
  const withLoaderTimeout = (load: () => unknown) => load()
  const t = (key: string) => key
  const translateOr = (_key: string, en: string, km = en) => props.language === 'km' ? km : en
  const fmtUSD = (value: number) => '$' + value.toFixed(2)
  const fmtKHR = (value: number) => value + ' KHR'
  const getStatusLabel = (status: string) => status
  ${lifecycle}
  ${cards}
  return { status: stripStatus, data: stripData, fees: feeStripData, cards: stripCards, reload: loadStatsStrip }
}`)}; return render`)() as (hooks: unknown, props: unknown, api: unknown, helpers: unknown) => View

type Card = { key: string; label: string; value: string; sub?: string; details?: unknown[]; trend?: number; tone?: string; hint?: string }
type View = { status: string; data: unknown; fees: unknown; cards: Card[]; reload: () => Promise<void> }
type Slot = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Pending = { params: Record<string, unknown>; resolve: (value: unknown) => void; reject: (reason: unknown) => void }
const range = { startDate: '2026-09-01', endDate: '2026-09-05', startTime: '', endTime: '' }
const sales = (revenue = 42) => ({ totals: { tx_count: revenue ? 2 : 0, revenue_usd: revenue, cost_usd: 12, profit_usd: 28, store_delivery_usd: 2 }, by_status: [{ sale_status: 'completed', count: 2, total_usd: revenue }], by_payment: [{ payment_method: 'cash', tx_count: 2, collected_usd: revenue }], returns: { count: 1, refund_usd: 5 } })
const fees = { totals: { amount_usd: 3, amount_khr: 4000 }, by_type: [{ fee_type: 'tax', amount_usd: 3, amount_khr: 4000 }] }

function harness() {
  const props = {
    stripRange: { ...range }, isActive: true,
    user: { id: 1, username: 'staff', role_code: 'staff', permissions: { sales: 'full' } } as Record<string, unknown> | null,
    canViewSales: true, canViewFees: true, getPermissionTier: (_key: string) => 'full', language: 'en',
    search: '', statusFilter: 'all', userFilter: 'all',
  }
  let cursor = 0
  let dirty = false
  const slots: Slot[] = []
  const effects = new Map<number, () => void | (() => void)>()
  const changed = (before: unknown[] | undefined, next: unknown[]) => !before || before.length !== next.length || next.some((value, index) => !Object.is(value, before[index]))
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++
      const slot = slots[index] ??= { value: initial }
      return [slot.value, (value: unknown) => { slot.value = value; dirty = true }]
    },
    useRef(initial: unknown) { return (slots[cursor++] ??= { value: { current: initial } }).value },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const slot = slots[cursor++] ??= {}
      if (changed(slot.deps, deps)) { slot.value = factory(); slot.deps = deps }
      return slot.value
    },
    useCallback(callback: unknown, deps: unknown[]) { return hooks.useMemo(() => callback, deps) },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = cursor++
      const slot = slots[index] ??= {}
      if (changed(slot.deps, deps)) { effects.set(index, effect); slot.deps = deps }
    },
  }
  const requests = { sales: [] as Pending[], fees: [] as Pending[] }
  const enqueue = (queue: Pending[], params: Record<string, unknown>) => new Promise((resolve, reject) => queue.push({ params, resolve, reject }))
  const api = { getSalesStatsStrip: (params: Record<string, unknown>) => enqueue(requests.sales, params), getFeesReport: (params: Record<string, unknown>) => enqueue(requests.fees, params) }
  let view: View
  const render = () => { cursor = 0; dirty = false; view = run(hooks, props, api, { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent }); return view }
  const commit = () => {
    for (const [index, effect] of effects) { slots[index].cleanup?.(); slots[index].cleanup = effect() || undefined }
    effects.clear()
    return dirty ? render() : view
  }
  const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); return dirty ? render() : view }
  const succeed = async (index: number, amount = 42) => { requests.sales[index].resolve(sales(amount)); requests.fees[index]?.resolve(fees); return flush() }
  const unmount = () => { for (const slot of slots) slot.cleanup?.() }
  return { props, requests, render, commit, flush, succeed, unmount }
}

function masked(view: View, status: string) {
  assert.equal(view.status, status)
  assert.equal(view.data, null)
  assert.equal(view.fees, null)
  assert.ok(view.cards.length >= 6)
  for (const card of view.cards) {
    assert.equal(card.value, '—')
    assert.equal(card.sub, undefined)
    assert.equal(card.details, undefined, 'an already-open detail modal must lose its stale breakdown')
    assert.equal(card.trend, undefined)
    assert.equal(card.tone, undefined)
  }
}
const card = (view: View, key: string) => view.cards.find((entry) => entry.key === key)!
let passed = 0
async function test(name: string, check: () => void | Promise<void>) { await check(); passed++; console.log(`PASS ${name}`) }

await test('no range, partial range and initial loading are not zero-valued periods', async () => {
  const h = harness()
  h.props.stripRange = { ...range, startDate: '', endDate: '' }
  masked(h.render(), 'no-range'); h.commit()
  assert.equal(h.requests.sales.length, 0)
  h.props.stripRange.startDate = range.startDate
  masked(h.render(), 'no-range'); h.commit()
  assert.equal(h.requests.sales.length, 0)
  h.props.stripRange.endDate = range.endDate
  masked(h.render(), 'loading'); h.commit()
  const view = await h.succeed(0, 0)
  assert.equal(view.status, 'ready')
  assert.equal(card(view, 'sales').value, '0')
  assert.equal(card(view, 'revenue').value, '$0.00')
})

await test('ready cards retain existing financial formulas and distinct expense currencies', async () => {
  const h = harness(); h.render(); h.commit()
  const view = await h.succeed(0)
  assert.equal(card(view, 'revenue').value, '$42.00')
  assert.equal(card(view, 'cogs').value, '$12.00')
  assert.equal(card(view, 'profit').value, '$28.00')
  assert.equal(card(view, 'profit').sub, '66.7% margin')
  assert.equal(card(view, 'profit').hint, 'Gross profit = revenue − COGS + delivery fees charged − courier cost (including Not Paid).')
  assert.equal(card(view, 'expenses').value, '$3.00 · 4000 KHR')
})

for (const change of ['date', 'time', 'user', 'logout', 'role', 'permissions', 'sales grant', 'fees grant', 'tier', 'inactive', 'clear range']) {
  await test(`${change} masks amounts synchronously and rejects obsolete callbacks/completions`, async () => {
    const h = harness(); h.render(); h.commit()
    const prior = await h.succeed(0)
    const inFlight = prior.reload(); masked(h.render(), 'loading')
    const expected = ['logout', 'sales grant', 'inactive'].includes(change) ? 'unavailable' : change === 'clear range' ? 'no-range' : 'loading'
    if (change === 'date') h.props.stripRange.endDate = '2026-09-06'
    if (change === 'time') h.props.stripRange.startTime = '09:00'
    if (change === 'user') h.props.user = { ...h.props.user, id: 2 }
    if (change === 'logout') h.props.user = null
    if (change === 'role') h.props.user = { ...h.props.user, role_code: 'other' }
    if (change === 'permissions') h.props.user = { ...h.props.user, permissions: { sales: 'view' } }
    if (change === 'sales grant') h.props.canViewSales = false
    if (change === 'fees grant') h.props.canViewFees = false
    if (change === 'tier') h.props.getPermissionTier = () => 'view'
    if (change === 'inactive') h.props.isActive = false
    if (change === 'clear range') h.props.stripRange.endDate = ''
    masked(h.render(), expected) // Intentionally before effect cleanup.
    await prior.reload()
    assert.equal(h.requests.sales.length, 2, 'a handler captured for the old scope cannot start another read')
    await h.succeed(1, 999); await inFlight
    masked(h.render(), expected)
    h.commit()
    assert.equal(h.requests.sales.length, expected === 'loading' ? 3 : 2)
    if (expected === 'loading') {
      const view = await h.succeed(2, 7)
      assert.equal(card(view, 'revenue').value, '$7.00')
      if (change === 'fees grant') { assert.equal(h.requests.fees.length, 2); assert.equal(card(view, 'expenses'), undefined) }
    }
  })
}

await test('A -> B -> A and deactivate/reactivate cannot resurrect an old ready snapshot', async () => {
  const h = harness(); h.render(); h.commit(); await h.succeed(0)
  h.props.stripRange.endDate = '2026-09-06'; masked(h.render(), 'loading')
  h.props.stripRange.endDate = range.endDate; masked(h.render(), 'loading'); h.commit(); await h.succeed(1)
  h.props.isActive = false; masked(h.render(), 'unavailable'); h.commit()
  h.props.isActive = true; masked(h.render(), 'loading'); h.commit()
  assert.equal(h.requests.sales.length, 3)
  assert.equal((await h.succeed(2)).status, 'ready')
})

for (const failure of ['sales', 'fees', 'null sales', 'null fees']) {
  await test(`${failure} failure is unavailable with a working retry`, async () => {
    const h = harness(); h.render(); h.commit()
    if (failure === 'sales') h.requests.sales[0].reject(new Error('offline'))
    else h.requests.sales[0].resolve(failure === 'null sales' ? null : sales())
    if (failure === 'fees') h.requests.fees[0].reject(new Error('forbidden'))
    else h.requests.fees[0].resolve(failure === 'null fees' ? null : fees)
    const failed = await h.flush(); masked(failed, 'error')
    const retry = failed.reload(); masked(h.render(), 'loading')
    const recovered = await h.succeed(1); await retry
    assert.equal(recovered.status, 'ready')
  })
}

await test('same-scope races and unmount cannot publish obsolete success or failure', async () => {
  const h = harness(); const initial = h.render(); h.commit()
  const reload = initial.reload(); await h.succeed(1, 7); await reload
  h.requests.sales[0].reject(new Error('old request')); h.requests.fees[0].resolve(fees)
  assert.equal(card(await h.flush(), 'revenue').value, '$7.00')
  const pending = h.render().reload(); h.unmount(); await h.succeed(2, 999); await pending
  masked(h.render(), 'loading')
})

await test('period scope ignores list search/status/cashier and fees remain date-only', async () => {
  const h = harness(); h.props.stripRange = { ...range, startTime: '09:00', endTime: '17:00' }; h.render(); h.commit()
  await h.succeed(0)
  assert.deepEqual(h.requests.sales[0].params, h.props.stripRange)
  assert.deepEqual(h.requests.fees[0].params, { startDate: range.startDate, endDate: range.endDate })
  h.props.search = 'receipt'; h.props.statusFilter = 'cancelled'; h.props.userFilter = '2'
  const view = h.render(); h.commit()
  assert.equal(view.status, 'ready'); assert.equal(h.requests.sales.length, 1)
  assert.equal(card(view, 'expenses').label, 'Expenses · whole days')
  assert.match(card(view, 'expenses').hint!, /time filter does not apply/)
  h.props.language = 'km'
  assert.match(card(h.render(), 'expenses').label, /[\u1780-\u17ff]/)
})

await test('visible scope, availability and touch-safe retry use bilingual local fallbacks', () => {
  for (const key of ['period_scope', 'choose_range', 'loading', 'failed', 'unavailable', 'retry', 'expenses_whole_days', 'expenses_time_hint']) {
    assert.match(source, new RegExp(`translateOr\\('sales_strip_${key}', '[^']+', '[^']*[\\u1780-\\u17ff][^']*'\\)`))
  }
  assert.match(source, /<p[^>]*>[\s\S]*?translateOr\('sales_strip_period_scope', 'Period totals · list search, status and cashier filters do not apply\.'/)
  assert.match(source, /role="status" aria-live="polite"/)
  assert.match(source, /stripStatus === 'error' \? \([\s\S]{0,200}min-h-\[44px\][\s\S]{0,120}onClick=\{\(\) => \{ void loadStatsStrip\(\)/)
  assert.match(source, /loading=\{stripLoading\}/)
  assert.match(lifecycle, /withLoaderTimeout\(/, 'a stalled request must reach the retryable error state')
})

console.log(`${passed} sales strip availability tests passed`)
