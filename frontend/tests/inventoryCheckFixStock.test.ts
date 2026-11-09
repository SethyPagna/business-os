import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, propsOf, type MountedSurface } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { fixStockOpening, fixStockReason, fixStockRequestId, fixStockTarget } from '../src/components/inventory/inventoryCheckFixStock.ts'
import * as reportsFocusModule from '../src/components/sales/reports/reportsFocus.ts'
import { peekReportsFocus, productSalesFocus, queueReportsFocus, takeReportsFocus } from '../src/components/sales/reports/reportsFocus.ts'
import { offsetDate, todayStr } from '../src/utils/dateHelpers.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// Lane 6.0.1045 (P1.7): Fix stock opens the existing Set session with the counted quantity minus the branch's damaged units and a reason,
// and writes nothing until a person confirms it; the Sales link opens Reports > Grouped > Product with the product and 30 days.
// Both sit behind ic_fix_stock (the server answer says so), Fix stock needs stock adjustment, the link needs Sales view.

// ---- the numbers: Set excludes damaged units, a count includes them ----
assert.equal(fixStockTarget(12, 2), 10, 'a count of 12 with 2 damaged sets 10')
assert.equal(fixStockTarget(3, 5), 0, 'never below zero')
assert.equal(fixStockTarget(0, 0), 0)
assert.equal(fixStockTarget(12, null), 12, 'no damaged units recorded: the count as it is')
assert.equal(fixStockTarget(12, undefined), 12)
assert.equal(fixStockTarget(12, -3), 12, 'a negative damaged figure never adds stock')
assert.equal(fixStockTarget(12.9, 1), 11, 'whole units')

assert.equal(fixStockReason('Inventory check', 'Two boxes crushed'), 'Inventory check: Two boxes crushed')
assert.equal(fixStockReason('Inventory check', '  '), 'Inventory check', 'no note: the label alone, never empty')
assert.equal(fixStockReason('Inventory check', null), 'Inventory check')
assert.equal(fixStockReason('ការរាប់ស្តុក', 'ប្រអប់ខូច'), 'ការរាប់ស្តុក: ប្រអប់ខូច', 'Khmer text is kept whole')
assert.equal(Array.from(fixStockReason('Inventory check', 'x'.repeat(500))).length, 512, 'a 500-character note still fits the 512-character stock reason')

// ---- who gets a Set session, and for which branch ----
const issueRow: InventoryCheckProduct = { id: 12, name: 'Test variant', quantity: 14, damaged_quantity: 2, check_status: 'issue', check_counted_quantity: 12, check_note: 'Two boxes crushed', check_branch_id: 1 }
const where = { listBranchId: '1', canViewStock: true, label: 'Inventory check' }
const opened = fixStockOpening(issueRow, where)
assert.deepEqual(opened && { branchId: opened.branchId, quantity: opened.quantity, reason: opened.reason }, { branchId: 1, quantity: 10, reason: 'Inventory check: Two boxes crushed' })
assert.equal(fixStockOpening({ ...issueRow, check_status: 'ok' }, where), null, 'a checked-OK product has nothing to fix')
assert.equal(fixStockOpening({ ...issueRow, check_status: 'in_check' }, where), null)
assert.equal(fixStockOpening({ ...issueRow, check_counted_quantity: null }, where), null, 'an issue without a count has no number to set')
assert.equal(fixStockOpening({ ...issueRow, check_counted_quantity: undefined }, where), null)
assert.equal(fixStockOpening(issueRow, { ...where, listBranchId: '' }), null, 'an all-branches list cannot say how many units are damaged in the counted branch')
assert.equal(fixStockOpening(issueRow, { ...where, listBranchId: '2' }), null, 'a list filtered to another branch likewise')
assert.equal(fixStockOpening(issueRow, { ...where, canViewStock: false }), null, 'damaged units are part of the stock field')
assert.equal(fixStockOpening({ ...issueRow, is_group: true }, where), null, 'a family header is not a product')
assert.equal(fixStockOpening({ ...issueRow, checkable: false }, where), null)
const inSession = fixStockOpening({ ...issueRow, check_status: undefined, check_counted_quantity: undefined, check_note: undefined, check_branch_id: undefined },
  { ...where, listBranchId: '', session: { branchId: 3 }, observation: { state: 'issue', counted_quantity: 9, reason: 'Shelf short' } })
assert.deepEqual(inSession && { branchId: inSession.branchId, quantity: inSession.quantity, reason: inSession.reason }, { branchId: 3, quantity: 7, reason: 'Inventory check: Shelf short' }, 'inside a session the issue and the branch are the session’s')
assert.equal(fixStockOpening(issueRow, { ...where, session: { branchId: 3 }, observation: { state: 'done', counted_quantity: 9, reason: null } }), null, 'a done item in the session is not an issue')
assert.equal(fixStockOpening(issueRow, { ...where, session: { branchId: 3 }, observation: { state: 'issue', counted_quantity: null, reason: 'x' } }), null, 'a blind count has no number')

// ---- a count that waits for approval is decided first; the stock request names the count so the server can hold it too ----
assert.equal(fixStockOpening(issueRow, { ...where, pending: true }), null, 'pending in the list: nothing to fix yet')
assert.equal(fixStockOpening(issueRow, { ...where, session: { id: 'check-1', branchId: 3 }, observation: { state: 'issue', counted_quantity: 9, reason: 'Shelf short' }, pending: true }), null, 'pending inside its session')
assert.equal(fixStockOpening(issueRow, { ...where, pending: false })?.quantity, 10, 'decided (rejected or never submitted): offered as before')
const named = fixStockOpening({ ...issueRow, check_session_id: '3f9c1c2e-1111-4222-8333-444455556666' }, where)
assert.match(named?.requestId ?? '', /^icfix_3f9c1c2e-1111-4222-8333-444455556666_12_[0-9a-f]{16}$/, 'the list names the count from the row')
assert.equal(inSession?.requestId, null, 'a session opening that was given no id carries no name')
const named2 = fixStockOpening({ ...issueRow, check_status: undefined, check_counted_quantity: undefined }, { ...where, listBranchId: '', session: { id: 'check-9', branchId: 3 }, observation: { state: 'issue', counted_quantity: 9, reason: null } })
assert.match(named2?.requestId ?? '', /^icfix_check-9_12_[0-9a-f]{16}$/, 'inside a session the session names the count')
assert.notEqual(fixStockRequestId('check-9', 12), fixStockRequestId('check-9', 12), 'every opening is a new request')
for (const bad of [null, undefined, '', 'a b', 'x'.repeat(65), 12]) assert.equal(fixStockRequestId(bad, 12), null, String(bad))
assert.equal(fixStockRequestId('check-9', 0), null); assert.equal(fixStockRequestId('check-9', 1.5), null)

// ---- the Sales link: 30 days, handed over once ----
const focus = productSalesFocus('  Test variant ')
assert.deepEqual(focus, { view: 'products', search: 'Test variant', startDate: offsetDate(-29), endDate: todayStr() }, 'the last 30 days, today included')
assert.equal(peekReportsFocus(), null, 'nothing waits before a link is followed')
queueReportsFocus(focus)
assert.deepEqual(peekReportsFocus(), focus, 'peeking does not consume (a render can run twice)')
assert.deepEqual(takeReportsFocus(), focus, 'the first read gets it')
assert.equal(takeReportsFocus(), null, 'and the second gets nothing: read once')
const realNow = Date.now
queueReportsFocus(focus)
Date.now = () => realNow() + 31_000
assert.equal(takeReportsFocus(), null, 'a link that never reached Reports expires')
Date.now = realNow
queueReportsFocus({ ...focus, startDate: 'yesterday' })
assert.equal(takeReportsFocus(), null, 'a malformed date is never applied')

// ---- the page: detail float, the Set session, the link ----
const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts', 'components/sales/reports/reportsFocus.ts'] })
const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
const entries: string[] = ['https://admin.example.test/inventory#hub:inventory:products']
let entryIndex = 0
const applyLocation = (url: string) => {
  const next = new URL(url, window.location.href)
  Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash })
}
window.history.pushState = (_state, _unused, url) => { entries.splice(entryIndex + 1); entries.push(new URL(String(url), window.location.href).href); entryIndex += 1; applyLocation(entries[entryIndex]) }
window.history.replaceState = (_state, _unused, url) => { entries[entryIndex] = new URL(String(url), window.location.href).href; applyLocation(entries[entryIndex]) }
applyLocation(entries[0])

const row = { id: 12, name: 'Test variant', quantity: 14, unit: 'pcs', damaged_quantity: 2, barcode: '885000111', check_status: 'issue', check_counted_quantity: 12, check_note: 'Two boxes crushed', check_by: 'alice', check_at: '2026-10-19 02:30:00', check_session_id: 'check-1', check_branch_id: 1 }
let fixStockOn = true
let rowOverride: Record<string, unknown> = {}
const productRequests: Array<Record<string, unknown>> = []
const navigations: Array<[string, string | undefined]> = []
const handedToReports: Array<ReturnType<typeof productSalesFocus>> = []
const commits: unknown[][] = []
const writes: unknown[][] = []
const response = () => ({ items: [{ ...row, ...rowOverride }], total: 1, page: 1, pageSize: 20, simple: true, branches: [{ id: 1, name: 'Test branch' }], summary: { not_checked: 0, in_check: 0, ok: 0, issue: 1, total: 1 }, facets: { brands: [], categories: [] }, facetsLimited: { brands: false, categories: false }, capabilities: { fixStock: fixStockOn } })
const baseUser = { id: 7, username: 'alice', role_code: 'employee', permissions: { inventory: true, inventory_checks: true, sales: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_stock: true, inventory_check_show_received: true } as Record<string, unknown> }
const app = {
  user: baseUser as Record<string, unknown>,
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => key, settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
  usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100, notify() {},
  navigateTo: (page: string, anchor?: string) => { navigations.push([page, anchor]) },
}
const doubles = {
  'utils/dirtyWork.ts': dirtyWork,
  // What the link hands to Reports is recorded here as well as queued.
  'components/sales/reports/reportsFocus.ts': { queueReportsFocus: (focus: Parameters<typeof queueReportsFocus>[0]) => { handedToReports.push(focus); reportsFocusModule.queueReportsFocus(focus) } },
  'api/actorReadScope.ts': {
    captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: '1' }),
    captureActorWriteIdentity: () => ({ owner: 'test', epoch: 1 }),
    isActorReadScopeCurrent: () => true,
    isActorWriteIdentityCurrent: () => true,
  },
  'api/inventoryChecksTransport.ts': {
    captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
    readInventoryCheckProducts: async (params: Record<string, unknown>) => { productRequests.push(params); return response() },
    readInventoryCheckSessions: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async () => { throw new Error('not used') },
    readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    createInventoryCheckSession: async (...args: unknown[]) => { writes.push(args); throw new Error('Fix stock never creates a check session') },
    saveInventoryCheckObservation: async (...args: unknown[]) => { writes.push(args); throw new Error('Fix stock never saves a check') },
    changeInventoryCheckSession: async (...args: unknown[]) => { writes.push(args); throw new Error('Fix stock never closes a check session') },
  },
  'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: [] }) },
  'api/methods.ts': { getProductFilters: async () => ({ brands: [] }) },
  'api/productSearchIndex.ts': { useProductSearchIndex: () => 0 },
  'api/inventoryWriteTransport.ts': { getInventoryReasons: async () => ({}), commitFastStockIn: async (...args: unknown[]) => { commits.push(args); return { ok: true } } },
}
const mount = () => harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
const openDetail = async (surface: MountedSurface) => { await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Test variant', 'product button')) }
const detailButton = (surface: MountedSurface, attribute: string) => surface.findAll(node => node.tagName === 'BUTTON' && node.getAttribute(attribute) !== null)

const draftText = () => { const parts: string[] = []; for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index) ?? ''; if (key.includes('fast_stockin')) parts.push(localStorage.getItem(key) ?? '') } return parts.join('\n') }
const discardDraft = () => { for (const key of Object.keys(localStorage)) if (key.includes('fast_stockin')) localStorage.removeItem(key) }
const offeredFor = async (override: Record<string, unknown>, user = baseUser, capable = true) => {
  rowOverride = override; fixStockOn = capable; app.user = user
  const mounted = await mount()
  try { await openDetail(mounted); return { fix: detailButton(mounted, 'data-check-fix-stock').length, sales: detailButton(mounted, 'data-check-sales-link').length } }
  finally { await mounted.unmount() }
}

try {
  // The owner at the till: stock adjustment and Sales view both held.
  const surface = await mount()
  await openDetail(surface)
  assert.equal(detailButton(surface, 'data-check-fix-stock').length, 1, 'an Issue with a count offers Fix stock')
  assert.equal(detailButton(surface, 'data-check-sales-link').length, 1, 'and the Sales link')
  const fix = detailButton(surface, 'data-check-fix-stock')[0], sales = detailButton(surface, 'data-check-sales-link')[0]
  assert.ok(fix.textContent.includes('Fix stock'), 'the main action is icon + one word')
  assert.equal(sales.textContent.trim(), '', 'the Sales link is icon-only')
  assert.ok((sales.getAttribute('aria-label') || '').length > 0 && sales.getAttribute('title') === sales.getAttribute('aria-label'), 'with a tooltip that names it')

  // Fix stock opens the Set session and writes nothing until a person confirms it there.
  discardDraft()
  await surface.click(fix)
  await surface.waitFor(() => draftText().includes('icfix_'), 'the Set session keeps its line')
  assert.equal(commits.length, 0, 'opening the Set session commits nothing'); assert.equal(writes.length, 0, 'and writes no check')
  const saved = JSON.parse(draftText().split('\n').find(part => part.includes('icfix_')) ?? '{}') as { data?: { lines?: Array<Record<string, unknown>>; mode?: string }; lines?: Array<Record<string, unknown>>; mode?: string }
  const lines = saved.data?.lines ?? saved.lines ?? []
  assert.equal(lines.length, 1, 'one line')
  assert.deepEqual({ mode: lines[0].mode, quantity: lines[0].quantity, reason: lines[0].reason }, { mode: 'set', quantity: 10, reason: 'Inventory check: Two boxes crushed' }, 'count 12 with 2 damaged units sets 10')
  assert.match(String(lines[0].requestId), /^icfix_check-1_12_[0-9a-f]{16}$/, 'the stock request names the count it fixes, so the server can hold it while that count waits')
  await surface.unmount()

  // The Sales link opens Reports > Grouped > Product with the product and 30 days, once.
  discardDraft(); rowOverride = {}; app.user = baseUser
  const linked = await mount(); await openDetail(linked)
  const before = navigations.length
  await linked.click(detailButton(linked, 'data-check-sales-link')[0])
  assert.equal(navigations.length, before + 1, 'following the link navigates once')
  assert.deepEqual(handedToReports.at(-1), productSalesFocus('Test variant'), 'Reports is handed the product and the last 30 days')
  takeReportsFocus()
  await linked.unmount()

  // A count that waits for approval is decided first: Fix stock is not offered (the server holds the Set as well); the Sales link is unaffected.
  assert.deepEqual(await offeredFor({ check_pending: true }), { fix: 0, sales: 1 }, 'pending count: no Fix stock, the Sales link stays')
  assert.deepEqual(await offeredFor({}), { fix: 1, sales: 1 }, 'the same row once it is decided (the tag is gone) offers it again')
  // Rights and the switch.
  const permissions = baseUser.permissions as Record<string, unknown>
  assert.deepEqual(await offeredFor({}, { ...baseUser, permissions: { ...permissions, inventory: false } }), { fix: 0, sales: 1 }, 'no stock adjustment: no Fix stock')
  assert.deepEqual(await offeredFor({}, { ...baseUser, permissions: { ...permissions, sales: false } }), { fix: 1, sales: 0 }, 'no Sales view: no link')
  assert.deepEqual(await offeredFor({}, baseUser, false), { fix: 0, sales: 0 }, 'ic_fix_stock off (the server does not say so): neither')
} finally { discardDraft(); await harness.close() }
void act; void propsOf; void APP_NAVIGATION_EVENT; void readFileSync
console.log('PASS inventoryCheckFixStock: targets, who is offered Fix stock and the Sales link, the Set session it opens, the count-naming request id, and the hold while a count waits')
