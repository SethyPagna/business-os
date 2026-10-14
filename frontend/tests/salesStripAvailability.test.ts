import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'
// The REAL formula module the cards build their equations from -- injected,
// not stubbed, so a card that prints an equation that does not foot fails here.
import { buildEquation, revenueTerms, profitTerms, equationResidual } from '../src/utils/statsFormulas.ts'
import { formatUsd4 } from '../src/utils/reportMoney.ts'
// The REAL client mirror of the Worker's cost gate, injected like the formulas above.
import { canViewAcquisitionCosts } from '../src/utils/acquisitionCostAccess.ts'
import { costCoverage, costFigureText } from '../src/utils/costCoverage.ts'
import { partialCostNote, unknownCostLabel } from '../src/utils/costDisplay.ts'

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
  const { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, buildEquation, revenueTerms, profitTerms, formatUsd4, canViewAcquisitionCosts, costCoverage, costFigureText, partialCostNote, unknownCostLabel } = helpers
  const settings = props.settings
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
const sales = (revenue = 42) => ({
  totals: {
    tx_count: revenue ? 2 : 0, revenue_usd: revenue, net_sales_usd: revenue + 3, refund_usd: 3,
    cost_usd: 12, profit_usd: 28,
    // 42 - 12 + 0 - 2 = 28. store_delivery_usd is a memo the shop waived,
    // never a term: it is here precisely so a formula that subtracts it
    // stops footing.
    recognized_delivery_usd: 0, recognized_delivery_cost_usd: 2, store_delivery_usd: 2,
  },
  by_status: [{ sale_status: 'completed', count: 2, total_usd: revenue }],
  by_payment: [{ payment_method: 'cash', tx_count: 2, collected_usd: revenue }],
  // RETURN-DATE activity: 5 paid out at the desk, of which 3 reverses a
  // sale rung in this range. Revenue is down by the 3, never by the 5.
  returns: { count: 1, refund_usd: 5 },
})
const fees = { totals: { amount_usd: 3, amount_khr: 4000 }, by_type: [{ fee_type: 'tax', amount_usd: 3, amount_khr: 4000 }] }

function harness() {
  const props = {
    stripRange: { ...range }, isActive: true,
    user: { id: 1, username: 'staff', role_code: 'staff', permissions: { sales: 'full', product_cost_view: true } } as Record<string, unknown> | null,
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
  const render = () => { cursor = 0; dirty = false; view = run(hooks, props, api, { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, buildEquation, revenueTerms, profitTerms, formatUsd4, canViewAcquisitionCosts, costCoverage, costFigureText, partialCostNote, unknownCostLabel }); return view }
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
  // Sales, Revenue, Payments, Returns and Expenses always; COGS and Profit only for a cost reader
  // (a permission change away from the grant takes them out, see the finding-5 test below).
  assert.ok(view.cards.length >= 5)
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
  // The hint is the sentence PLUS the equation with this period's numbers,
  // and the equation has to close on the value the card shows.
  const profitHint = card(view, 'profit').hint!
  assert.match(profitHint, /^Profit = revenue − cost of goods sold \+ delivery fees charged − actual delivery cost\. Includes Not Paid sales\./)
  assert.equal(profitHint.split('\n').pop(), 'Gross profit $28.00 = Revenue $42.00 − COGS $12.00 − Actual delivery cost $2.00')
  assert.equal(equationResidual(28, profitTerms(sales().totals)), 0, 'the printed profit equation foots')
  const revenueHint = card(view, 'revenue').hint!
  assert.equal(revenueHint.split('\n').pop(), 'Revenue $42.00 = Net sales $45.00 − Refunds $3.00')
  assert.equal(equationResidual(42, revenueTerms(sales().totals)), 0, 'the printed revenue equation foots')
  // ... and it uses the sale-basis refund (3), never the returns desk's 5.
  assert.ok(!revenueHint.includes('$5.00'), 'the return-date total is not a term of revenue')
  assert.equal(card(view, 'expenses').value, '$3.00 · 4000 KHR')
  // Owner, 13 Oct 2026: the per-method rows split the Collected figure, so
  // they print 4 places and add up to it exactly; the headline cards above
  // keep cents.
  assert.equal(card(view, 'payments').sub, '2 · $42.0000')
  assert.deepEqual(card(view, 'payments').details, [{ label: 'cash', value: '2 · $42.0000' }])
})

// Finding 5 of the R2 area review (13 Oct 2026): the Worker OMITS cost_usd / profit_usd for a caller
// without the cost grant (gateTotals) and never sends 0 for "hidden"; `|| 0` printed a $0.00 COGS
// card and a $0.00 profit at 0.0% margin, which reads as a period that broke even.
const withoutCost = (amount = 42) => {
  const { cost_usd: _cost, profit_usd: _profit, ...rest } = sales(amount).totals
  return { ...sales(amount), totals: rest }
}
await test('a reader without the cost grant gets no COGS or profit card, ready or loading; a cost reader keeps both', async () => {
  const plain = harness(); plain.props.user = { id: 3, username: 'reader', role_code: 'staff', permissions: { sales: 'view' } }
  const loading = plain.render(); plain.commit()
  assert.equal(loading.status, 'loading')
  assert.deepEqual(loading.cards.map((entry) => entry.key), ['sales', 'revenue', 'payments', 'returns', 'expenses'], 'no cost placeholders while loading')
  plain.requests.sales[0].resolve(withoutCost()); plain.requests.fees[0].resolve(fees)
  const ready = await plain.flush()
  assert.equal(ready.status, 'ready')
  assert.deepEqual(ready.cards.map((entry) => entry.key), ['sales', 'revenue', 'payments', 'returns', 'expenses'])
  assert.equal(card(ready, 'revenue').value, '$42.00', 'the money a reader may see is untouched')
  const everything = JSON.stringify(ready.cards)
  assert.doesNotMatch(everything, /COGS|cogs|Gross profit|Gross Profit|margin/, 'nothing prints a cost or profit figure, zero or otherwise')
  const cost = harness(); const costLoading = cost.render(); cost.commit()
  assert.ok(costLoading.cards.some((entry) => entry.key === 'cogs') && costLoading.cards.some((entry) => entry.key === 'profit'), 'control: a cost reader sees the placeholders')
  const costReady = await cost.succeed(0)
  assert.equal(card(costReady, 'cogs').value, '$12.00'); assert.equal(card(costReady, 'profit').value, '$28.00')
})

await test('a cost reader whose window is genuinely free of cost still sees $0.00 (presence, not value, decides)', async () => {
  const h = harness(); h.render(); h.commit()
  const zero = sales(0); zero.totals.cost_usd = 0; zero.totals.profit_usd = 0
  h.requests.sales[0].resolve(zero); h.requests.fees[0].resolve(fees)
  const view = await h.flush()
  assert.equal(card(view, 'cogs').value, '$0.00'); assert.equal(card(view, 'profit').value, '$0.00')
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

await test('availability and touch-safe retry use bilingual local fallbacks without repeated period prose', () => {
  for (const key of ['loading', 'failed', 'unavailable', 'retry', 'expenses_whole_days', 'expenses_time_hint']) {
    assert.match(source, new RegExp(`translateOr\\('sales_strip_${key}', '[^']+', '[^']*[\\u1780-\\u17ff][^']*'\\)`))
  }
  assert.doesNotMatch(source, /sales_strip_(?:period_scope|choose_range)/, 'the compact strip must not repeat range instructions already expressed by its controls')
  assert.match(source, /role="status" aria-live="polite"/)
  assert.match(source, /stripStatus === 'error' \? \([\s\S]{0,200}min-h-\[44px\][\s\S]{0,120}onClick=\{\(\) => \{ void loadStatsStrip\(\)/)
  assert.match(source, /loading=\{stripLoading\}/)
  assert.match(lifecycle, /withLoaderTimeout\(/, 'a stalled request must reach the retryable error state')
})

console.log(`${passed} sales strip availability tests passed`)
