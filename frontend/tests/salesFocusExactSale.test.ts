import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { activeSalesFocusId, parseSalesFocus } from '../src/components/sales/salesFocus.ts'
import { queueEntitySearch } from '../src/components/shared/entityLinkFocus.ts'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8').replace(/\r\n?/g, '\n')

// lane/sales-stats-reads: a link to one sale opens it by id, not by an all-time receipt search (about a million rows a click).

// --- the handoff payload -> focus
assert.deepEqual(parseSalesFocus({ search: 'R0000123', saleId: 42 }), { saleId: 42, receipt: 'R0000123' })
assert.deepEqual(parseSalesFocus({ search: ' R0000123 ', saleId: '42' }), { saleId: 42, receipt: 'R0000123' }, 'the id may arrive as a numeric string; the receipt is trimmed')
assert.equal(parseSalesFocus({ search: 'R0000123' }), null, 'a receipt-only handoff (the Expenses link) stays a plain typed search')
assert.equal(parseSalesFocus({ saleId: 42 }), null, 'an id without the receipt text has nothing to show in the search box')
for (const bad of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, '12abc', '1e3', '-1', '', null, {}, [], true]) {
  assert.equal(parseSalesFocus({ search: 'R1', saleId: bad }), null, `saleId ${String(bad)} must not become a focus`)
}
assert.equal(parseSalesFocus(null), null)
assert.equal(parseSalesFocus('R1'), null)

// --- when the focus applies
const focus = { saleId: 42, receipt: 'R0000123' }
const none = {}
assert.equal(activeSalesFocusId(focus, 'R0000123', 'R0000123', none), 42, 'search box holds the receipt, no dates: read by id')
assert.equal(activeSalesFocusId(focus, 'R0000123', '', none), 42, 'right after the link the debounced value has not caught up: still by id, never one all-time search for the old text')
assert.equal(activeSalesFocusId(focus, 'R00001234', 'R0000123', none), 42, 'one debounce after an edit the requests still carry the old text: hold, so no all-time receipt search fires for it')
assert.equal(activeSalesFocusId(focus, 'R00001234', 'R00001234', none), null, 'the user typed something else: read as typed')
assert.equal(activeSalesFocusId(focus, '', '', none), null, 'search cleared: no focus')
assert.equal(activeSalesFocusId(focus, 'R0000123', 'R0000123', { startDate: '2026-11-01' }), null, 'picking a date range ends the focus')
assert.equal(activeSalesFocusId(focus, 'R0000123', 'R0000123', { endDate: '2026-11-01' }), null)
assert.equal(activeSalesFocusId(null, 'R0000123', 'R0000123', none), null, 'no focus queued: never an id')
assert.equal(activeSalesFocusId({ saleId: 42, receipt: 'R0000123' }, ' R0000123 ', 'R0000123', none), 42, 'surrounding spaces in the box do not break it')

// --- the wiring
const sales = read('src/components/sales/Sales.tsx')
const note = read('src/components/shifts/ShiftCloseDriftNote.tsx')
assert.match(note, /<EntityLink page="sales" anchor="hub:sales:sales" search=\{sale\.receipt\} focus=\{\{ saleId: sale\.saleId \}\}/, 'the shift report link must queue the sale id with the receipt')
assert.match(sales, /setSalesFocus\(parseSalesFocus\(payload\)\)/, 'Sales must seed the focus from the handoff')
assert.match(sales, /\.\.\.\(focusSaleId \? \{ id: focusSaleId \} : effectiveSalesSearch \? \{ search: effectiveSalesSearch \} : \{\}\)/, 'with a focus the requests carry id and NOT the receipt as a search')
assert.match(sales, /activeSalesFocusId\(salesFocus, search, effectiveSalesSearch, salesDateRange\)/)
// the same params feed the list and the totals, so one id filter reaches both endpoints
assert.match(sales, /const salesPageParams = useMemo\(\(\) => \(\{\n    \.\.\.salesStatsParams,/)

// --- the handoff storage contract: id and receipt travel together
const stored = new Map<string, string>()
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    sessionStorage: { setItem: (k: string, v: string) => stored.set(k, v), getItem: (k: string) => stored.get(k) || null, removeItem: (k: string) => stored.delete(k) },
    dispatchEvent: () => true,
  },
})
queueEntitySearch('sales', 'R0000123', 'hub:sales:sales', { saleId: 42 })
assert.deepEqual(JSON.parse(stored.get('bos:sales:focus') || '{}'), { saleId: 42, search: 'R0000123' })
assert.deepEqual(parseSalesFocus(JSON.parse(stored.get('bos:sales:focus') || '{}')), { saleId: 42, receipt: 'R0000123' })

// --- the server side of the same contract: /stats takes the list's own id filter
const route = read('../cloudflare/src/routes/sales.ts')
const stats = route.slice(route.indexOf("app.get('/stats', async"), route.indexOf("app.get('/stats-strip'"))
assert.match(stats, /parseSaleIdFilter\(query\.id\)/, 'GET /api/sales/stats must apply the id filter the list already has')

console.log('PASS the exact-sale link: parsing, when it applies, wiring, storage, and the stats id filter')
