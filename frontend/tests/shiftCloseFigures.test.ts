// N4 (LOOPHOLE-REVIEW-20261006): the shift report shows the figures a shift
// CLOSED on, labels a recomputation as "Computed", and lists anything that
// moved after the close as a separate "Changed after close" block with a link
// to each sale -- beside the closed drawer, never instead of it.
//
// ShiftSummary is rendered for real (react-dom/server) with ShiftCloseDriftNote
// and shiftReportModel real; only the app context, the breakdown table, the
// figures block, the hint popover, the link and the icons are stubbed. The
// breakdown stub prints the expected cash it was handed, so the test can see
// WHICH reconciliation reached it (stored $90, not today's $40).
//
// Run: node tests/shiftCloseFigures.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import {
  shiftCloseDriftRows,
  shiftCloseDriftView,
  shiftDrawerSourceBadge,
} from '../src/components/shifts/shiftReportModel.ts'
import type { Shift, ShiftReconciliation } from '../src/api/shiftTransport.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string
type AnyProps = Record<string, any>

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let pack = en
let appUser: AnyProps = { id: 1, role_code: 'admin' }
const linkCalls: AnyProps[] = []

function loadTsx(url: URL): any {
  const source = readFileSync(url, 'utf8')
  const compiled = transformSync(source, { loader: url.pathname.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('AppContext')) {
      return { useApp: () => ({ user: appUser, t: (key: string) => pack[key] ?? key,
        fmtUSD: (v: unknown) => `$${Number(v).toFixed(2)}`, fmtKHR: (v: unknown) => `${Number(v)}៛`, navigateTo: () => {} }) }
    }
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    if (id.includes('InfoHint')) return { __esModule: true, default: ({ text }: AnyProps) => React.createElement('i', { 'data-hint': text }) }
    if (id.includes('ShiftCashBreakdown')) {
      return { __esModule: true, default: ({ reconciliation }: AnyProps) => React.createElement('div', null, `breakdown-expected:${reconciliation?.expected?.usd}`) }
    }
    if (id.includes('ShiftReportFigures')) return { __esModule: true, default: () => null }
    if (id.includes('EntityLink')) {
      return { __esModule: true, default: (props: AnyProps) => { linkCalls.push(props); return React.createElement('a', { 'data-page': props.page, 'data-search': props.search }, props.children) } }
    }
    if (id.includes('utils/permissions')) return { isAdminControlUser: (u: AnyProps) => u?.role_code === 'admin' }
    if (id.includes('formatters')) return nodeRequire('../src/utils/formatters.ts')
    if (id.startsWith('.')) return loadTsx(new URL(id, url))
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}
const ShiftSummary = loadTsx(new URL('../src/components/shifts/ShiftSummary.tsx', import.meta.url)).default

const recon = (expected: number, cashSales: number): ShiftReconciliation => ({
  opening: { usd: 10, khr: 0 }, additional_cash: { usd: 0, khr: 0 }, cash_sales: { usd: cashSales, khr: 0 },
  refunds: { usd: 0, khr: 0 }, expenses: { usd: 0, khr: 0 }, courier: { usd: 0, khr: 0 },
  expected: { usd: expected, khr: 0 }, counted: { usd: 40, khr: 0 }, difference: { usd: 40 - expected, khr: 0 },
  needs_review: false, review_codes: [],
})
const drift = {
  components: [
    { key: 'cash_sales', stored: { usd: 80, khr: 0 }, current: { usd: 30, khr: 0 } },
    { key: 'expected', stored: { usd: 90, khr: 0 }, current: { usd: 40, khr: 0 } },
    { key: 'other_tenders', stored: { usd: 20, khr: 0 }, current: { usd: 70, khr: 0 } },
  ],
  sales: [
    { sale_id: 1, change: 'changed' as const, before: [50, 0, 0, 0] as [number, number, number, number], after: [0, 0, 50, 0] as [number, number, number, number], receipt_number: 'R-CASH-50', sale_status: 'completed' },
    { sale_id: 2, change: 'changed' as const, before: [30, 0, 0, 0] as [number, number, number, number], after: [0, 0, 0, 0] as [number, number, number, number], receipt_number: 'R-CASH-30', sale_status: 'cancelled' },
    { sale_id: 4, change: 'added' as const, before: null, after: [5, 0, 0, 0] as [number, number, number, number], receipt_number: null, sale_status: 'completed' },
  ],
  sales_total: 25,
  sales_unavailable: false,
  current: recon(40, 30),
}
const closedShift = (patch: Partial<Shift> = {}): Shift => ({
  id: 9, shift_code: 'S-20261005-0900-za', scope_mode: 'per_account', user_id: 7, user_name: 'za', branch_id: 1, branch_name: 'Shop',
  business_date: '2026-10-05', opened_at: '2026-10-05T02:00:00.000Z', opening_float_usd: 10, opening_float_khr: 0,
  opening_note: null, closed_at: '2026-10-05T10:00:00.000Z', closing_counted_usd: 40, closing_counted_khr: 0, closing_note: null,
  closed_by_user_id: 7, closed_by_user_name: 'za', revision: 1, capabilities: { can_edit: false, can_close: false, can_reopen: false, can_cancel: false },
  cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null,
  reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null,
  reconciliation: recon(90, 80), reconciliation_source: 'stored', close_drift: drift, ...patch,
})
const render = (shift: Shift) => renderToStaticMarkup(React.createElement(ShiftSummary, { shift, detail: true }))

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

test('badge: stored on a closed shift with stored figures, computed on one without, nothing on an open shift', () => {
  assert.equal(shiftDrawerSourceBadge(closedShift())?.source, 'stored')
  assert.equal(shiftDrawerSourceBadge(closedShift({ reconciliation_source: 'computed' }))?.source, 'computed')
  assert.equal(shiftDrawerSourceBadge(closedShift({ closed_at: null, reconciliation_source: 'computed' })), null, 'an open shift has no close to store')
  assert.equal(shiftDrawerSourceBadge(closedShift({ reconciliation: null })), null, 'no comparison, no badge')
  assert.equal(shiftDrawerSourceBadge(closedShift({ reconciliation_source: undefined })), null, 'an older Worker that does not say gets no badge')
})

test('drift view: components labelled, sales with receipt and cash/other split, the unnamed remainder counted', () => {
  const view = shiftCloseDriftView(closedShift())!
  assert.deepEqual(view.components.map((c) => c.labelKey), ['shift_recon_cash_sales', 'shift_recon_expected', 'shift_recon_other_tenders'])
  assert.deepEqual(view.sales.map((s) => [s.receipt, s.change, s.cancelled]), [['R-CASH-50', 'changed', false], ['R-CASH-30', 'changed', true], ['#4', 'added', false]])
  assert.deepEqual(view.sales[0].cash, { before: { usd: 50, khr: 0 }, after: { usd: 0, khr: 0 } })
  assert.deepEqual(view.sales[0].other, { before: { usd: 0, khr: 0 }, after: { usd: 50, khr: 0 } })
  assert.equal(view.more, 22, '25 drifted, 3 named')
  assert.equal(shiftCloseDriftView(closedShift({ close_drift: null })), null)
  assert.equal(shiftCloseDriftView(closedShift({ reconciliation_source: 'computed' })), null, 'drift is only ever relative to stored figures')
})

test('export rows: today\'s value per moved line, then each sale\'s cash movement', () => {
  const rows = shiftCloseDriftRows(closedShift())
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.labelKey, r.usd]), [['shift_recon_cash_sales', 30], ['shift_recon_expected', 40], ['shift_recon_other_tenders', 70]])
  assert.deepEqual(rows.slice(3).map((r) => [r.label, r.usd]), [['R-CASH-50', -50], ['R-CASH-30', -30], ['#4', 5]])
  assert.deepEqual(shiftCloseDriftRows(closedShift({ close_drift: null })), [])
})

test('render (EN): stored badge, the CLOSED expected cash in the breakdown, and the changed-after-close block with sale links', () => {
  pack = en; appUser = { id: 1, role_code: 'admin' }; linkCalls.length = 0
  const html = render(closedShift())
  assert.match(html, />Stored at close</)
  assert.match(html, /breakdown-expected:90/, 'the breakdown receives the stored $90, not today\'s $40')
  assert.doesNotMatch(html, /breakdown-expected:40/)
  assert.match(html, /Changed after close/)
  assert.match(html, /Cash sales<\/dt>.*?\$80\.00 → \$30\.00/)
  assert.match(html, /Other tenders<\/dt>.*?\$20\.00 → \$70\.00/)
  assert.match(html, /data-page="sales" data-search="R-CASH-50">R-CASH-50</)
  assert.match(html, /Cash \$50\.00 → \$0\.00 · Other \$0\.00 → \$50\.00/)
  assert.match(html, />Cancelled</, 'a sale cancelled after close is marked')
  assert.match(html, /Added after close · Cash — → \$5\.00/)
  assert.match(html, /\+22 more sales/)
  assert.deepEqual(linkCalls.map((p) => p.anchor), ['hub:sales:sales', 'hub:sales:sales', 'hub:sales:sales'])
})

test('render (KM): the same block in Khmer', () => {
  pack = km; appUser = { id: 1, role_code: 'admin' }
  const html = render(closedShift())
  assert.ok(html.includes(km.shift_figures_stored), 'stored badge in Khmer')
  assert.ok(html.includes(km.shift_changed_after_close), 'changed-after-close title in Khmer')
  assert.ok(html.includes(km.shift_recon_other_tenders))
  assert.doesNotMatch(html, /Stored at close|Changed after close/, 'no English left in the Khmer render')
  pack = en
})

test('render: a shift closed before stored figures reads "Computed" and shows no drift block', () => {
  appUser = { id: 1, role_code: 'admin' }
  const html = render(closedShift({ reconciliation_source: 'computed', reconciliation: recon(40, 30) }))
  assert.match(html, />Computed</)
  assert.match(html, /breakdown-expected:40/)
  assert.doesNotMatch(html, /Changed after close/)
  assert.doesNotMatch(html, /Stored at close/)
})

test('render: staff never see the comparison, the badge or the drift', () => {
  appUser = { id: 7, role_code: 'staff' }
  const html = render(closedShift())
  assert.doesNotMatch(html, /Changed after close|Stored at close|breakdown-expected/)
  appUser = { id: 1, role_code: 'admin' }
})

test('the sale link hands its receipt to the Sales page (search across all time)', () => {
  const store = new Map<string, string>()
  const events: string[] = []
  const previous = (globalThis as AnyProps).window
  ;(globalThis as AnyProps).window = {
    sessionStorage: { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => store.delete(k) },
    dispatchEvent: (event: Event) => { events.push(event.type); return true },
  }
  try {
    const { queueEntitySearch } = loadTsx(new URL('../src/components/shared/entityLinkFocus.ts', import.meta.url))
    queueEntitySearch('sales', 'R-CASH-50', 'hub:sales:sales')
    assert.deepEqual(JSON.parse(store.get('bos:sales:focus')!), { search: 'R-CASH-50' })
    assert.deepEqual(events, ['bos:entity-focus'])
  } finally { (globalThis as AnyProps).window = previous }
  const sales = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  assert.match(sales, /sessionStorage\.getItem\('bos:sales:focus'\)/, 'Sales consumes the handoff')
  assert.match(sales, /setStripRange\(\{ \.\.\.EMPTY_DATE_TIME_RANGE \}\)/, 'and widens the range to all time')
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('OK shift close figures: stored vs computed, and drift beside -- never instead of -- the closed drawer')
