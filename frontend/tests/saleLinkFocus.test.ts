import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { activeSalesFocusId, parseSalesFocus, saleLinkTarget, salesHandoffState } from '../src/components/sales/salesFocus.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { queueEntitySearch } from '../src/components/shared/entityLinkFocus.ts'

// An "Open sale" link opens THE sale: it hands the Sales page the receipt (box text) AND the sale id (exact focus). The Expenses detail link and the
// product report's sales drill used to hand over the receipt only (or nothing), so the Sales page ran an all-time typed search / landed unfocused.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8').replace(/\r\n?/g, '\n')

// --- the helper: every (id, receipt) shape
assert.deepEqual(saleLinkTarget(42, 'R0000123'), { search: 'R0000123', focus: { saleId: 42 } })
assert.deepEqual(saleLinkTarget('42', ' R0000123 '), { search: 'R0000123', focus: { saleId: 42 } }, 'numeric-string id, receipt trimmed')
assert.deepEqual(saleLinkTarget(42, ''), { search: '42', focus: { saleId: 42 } }, 'no receipt: the id is the box text and still focuses')
assert.deepEqual(saleLinkTarget(42, null), { search: '42', focus: { saleId: 42 } })
assert.deepEqual(saleLinkTarget(42, undefined), { search: '42', focus: { saleId: 42 } })
for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, '12abc', '', null, undefined, {}, true]) {
  assert.deepEqual(saleLinkTarget(bad, 'R1'), { search: 'R1' }, `id ${String(bad)}: no focus, plain receipt search`)
  assert.deepEqual(saleLinkTarget(bad, ''), { search: '' }, `id ${String(bad)} and no receipt: nothing to hand over`)
}

// --- the handoff, end to end: link props -> queued payload -> Sales page focus
const store = new Map<string, string>()
const events: string[] = []
;(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: { setItem: (k: string, v: string) => { store.set(k, v) }, getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => { store.delete(k) } },
  dispatchEvent: (event: { type: string }) => { events.push(event.type); return true },
}
;(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class { type: string; constructor(type: string) { this.type = type } }
function open(saleId: unknown, receipt: unknown) {
  store.clear()
  const props = saleLinkTarget(saleId, receipt)
  queueEntitySearch('sales', props.search, 'hub:sales:sales', props.focus)
  const raw = store.get('bos:sales:focus')
  return raw ? parseSalesFocus(JSON.parse(raw)) : null
}
assert.deepEqual(open(42, 'R0000123'), { saleId: 42, receipt: 'R0000123' }, 'the Sales page receives the exact sale')
assert.deepEqual(open(7, ''), { saleId: 7, receipt: '7' }, 'a receipt-less sale still focuses')
assert.equal(open('x', 'R0000123'), null, 'a bad id degrades to the plain receipt search, never a wrong focus')
{
  const focus = open(42, 'R0000123')
  assert.equal(activeSalesFocusId(focus, 'R0000123', 'R0000123', {}), 42, 'with the box holding the receipt the list reads id=42')
}
assert.ok(events.includes('bos:entity-focus'), 'an already-mounted Sales page is told')

// --- the wiring: the Sales page consumes the focus (kept in step with salesFocusExactSale.test.ts)
const sales = read('src/components/sales/Sales.tsx')
assert.ok(sales.includes('salesHandoffState(JSON.parse(raw))') && sales.includes('setSalesFocus(handoff.focus)'), 'Sales must seed the focus from the handoff')
assert.match(sales, /\.\.\.\(focusSaleId \? \{ id: focusSaleId \} : effectiveSalesSearch \? \{ search: effectiveSalesSearch \} : \{\}\)/, 'with a focus the requests carry the id')

// --- every link to the Sales page that names a sale passes the id
const fees = read('src/components/fees/FeesPage.tsx')
assert.match(fees, /<EntityLink page="sales" anchor="hub:sales:sales" \{\.\.\.saleLinkTarget\(selected\.sale_id, selected\.sale_receipt_number\)\} navigate=\{navigateTo\}>/, 'the Expenses "Open sale" link must pass focus={{saleId}} through saleLinkTarget')
const report = read('src/components/products/surfaces/ProductDetailReport.tsx')
assert.match(report, /page="sales" anchor="hub:sales:sales" \{\.\.\.saleLinkTarget\(sale\.id, sale\.receipt_number\)\}/, 'the product report sale rows must open the sale')

// The Dashboard's recent-sale detail: "Open sales page" opens the sale on screen, not just the page.
const dashboard = read('src/components/dashboard/Dashboard.tsx')
assert.ok(dashboard.includes('saleLinkTarget(recentSaleDetail.id, recentSaleDetail.receipt_number)'), 'the Dashboard recent-sale button must pass the sale through saleLinkTarget')
assert.ok(dashboard.includes("queueEntitySearch('sales', target.search, 'hub:sales:sales', target.focus)"), 'and queue the focus before navigating')

// --- the handoff clears every filter that could hide the sale the link names (a leftover "Not Paid" or one cashier used to)
{
  store.clear()
  const props = saleLinkTarget(42, 'R0000123')
  queueEntitySearch('sales', props.search, 'hub:sales:sales', props.focus)
  const state = salesHandoffState(JSON.parse(store.get('bos:sales:focus') as string))
  assert.deepEqual(state, { search: 'R0000123', focus: { saleId: 42, receipt: 'R0000123' }, statusFilter: 'all', userFilter: 'all' })
  // The page applies exactly what the handoff returns, so a stale filter cannot survive it.
  const page = { search: 'old', statusFilter: 'Not Paid', userFilter: '7' }
  if (state) Object.assign(page, { search: state.search, statusFilter: state.statusFilter, userFilter: state.userFilter })
  assert.deepEqual(page, { search: 'R0000123', statusFilter: 'all', userFilter: 'all' })
  assert.equal(salesHandoffState({ saleId: 42, search: '   ' }), null, 'a handoff naming nothing changes nothing, so no filter is cleared for it')
  assert.equal(salesHandoffState(null), null)
  assert.equal(salesHandoffState('R1'), null)
  assert.deepEqual(salesHandoffState({ search: 'R9' }), { search: 'R9', focus: null, statusFilter: 'all', userFilter: 'all' }, 'a receipt-only link still clears the filters')
}
const salesSource = read('src/components/sales/Sales.tsx')
assert.ok(salesSource.includes('setStatusFilter(handoff.statusFilter)') && salesSource.includes('setUserFilter(handoff.userFilter)'), 'the Sales page applies the cleared filters from the handoff')

// --- the Dashboard button is offered only to a role that may open Sales (the Expenses link gates on can('sales', 'view') the same way)
{
  const may = (map: Record<string, unknown>) => effectivePermissions({ role_code: 'employee', role_permissions: JSON.stringify(map) }).can('sales', 'view')
  assert.equal(may({ sales: true }), true)
  assert.equal(may({ sales: 'view' }), true)
  assert.equal(may({ dashboard: true }), false, 'a custom role with the Dashboard but not Sales is not offered the link')
  assert.equal(may({ sales: false, dashboard: true }), false)
  assert.equal(effectivePermissions({ role_code: 'admin', role_permissions: '{}' }).can('sales', 'view'), true)
  const gate = dashboard.indexOf("{can('sales', 'view') ? (")
  const button = dashboard.indexOf("translateOr('open_sales_page'")
  assert.ok(gate > 0 && button > gate && dashboard.indexOf(') : null}', button) > button && dashboard.slice(gate, button).split('<button').length === 2, 'the Dashboard wraps the Open sales page button in the Sales view check')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx$/.test(name)) out.push(full)
  }
  return out
}
const offenders: string[] = []
let salesLinks = 0
for (const file of walk(resolve(root, 'src'))) {
  const text = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
  for (const tag of text.match(/<EntityLink\b[^>]*?page="sales"[\s\S]*?>/g) || []) {
    salesLinks += 1
    if (!/saleLinkTarget\(|focus=\{\{\s*saleId/.test(tag)) offenders.push(`${file.slice(root.length)}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`)
  }
}
assert.ok(salesLinks >= 3, `the sweep must find the sale links (found ${salesLinks}); a sweep that finds none proves nothing`)
assert.deepEqual(offenders, [], 'every EntityLink to the Sales page must carry the sale id')
console.log('saleLinkFocus: ok')
