import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { buildQueryString, type QueryParams } from '../src/api/query.ts'
import {
  branchesOf, canonicalProductsQuery, countDifference, loadWired, mergeWiredRows, NotWired, readWiredRows, rememberWiredMode, setToAmount, wiredListParams, wiredMode, wiredResult,
  type OverlayAnswer, type OverlayEntry, type WiredAccess, type WiredDeps, type WiredList,
} from '../src/components/inventory/inventoryWired.ts'

// INV-B S4b: the wired Inventory Check reads (INVENTORY-REPLAN rev. 2 sections 2.1-2.5, 2.7), against fixtures that follow the server contract of S4a.
// Pure: no page, no network. The mounted behaviour (one request on open, ON/OFF) is in inventoryChecksOpenSequence.test.ts and inventoryChecksWired.test.ts.

// ---- the canonical query is Products' own query, in Products' own key order (its answer is what the shared store holds) --------------------------------------
const productsSource = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('Products.tsx', productsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function productQueryInitializer(): string {
  let found = ''
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'productQuery' && node.initializer) found = node.initializer.getText()
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(found, 'Products builds productQuery')
  return found
}
function productsQueryString(context: Record<string, unknown>): string {
  const compiled = transformSync(`return (${productQueryInitializer()})`, { loader: 'tsx', format: 'cjs' }).code
  const base = { productPage: 1, productPageSize: 20, cleanedSearchQuery: '', searchMode: 'AND', catFilter: new Set(), brandFilter: new Set(), supplierFilter: new Set(), unitFilter: '',
    branchFilter: 'all', effectiveStockState: 'all', groupFilter: 'all', initialFilter: 'all', issueFilter: 'all', promoFilter: 'all', mergedFilter: 'all', productSortDirection: 'name_asc', productSearchParamsKey: '{}' }
  const merged = { ...base, ...context }
  return buildQueryString(new Function(...Object.keys(merged), compiled)(...Object.values(merged)) as QueryParams)
}
assert.match(productsSource, /useState<SearchMode>\('AND'\)/, 'Products opens in AND search mode (the canonical key carries it)')
const paginationSource = readFileSync(new URL('../src/components/shared/PaginationControls.tsx', import.meta.url), 'utf8')
const inventorySource = readFileSync(new URL('../src/components/inventory/InventoryChecksPage.tsx', import.meta.url), 'utf8')
assert.match(productsSource, /useState<ProductSortDirection>\('name_asc'\)/, 'Products opens sorted by name A-Z')
assert.match(paginationSource, /export const DEFAULT_PAGE_SIZE = 20\b/, 'Products opens at 20 a page')
assert.match(inventorySource, /sortBy: 'name', sortDirection: 'asc' \}/, 'Inventory opens sorted by name A-Z: the same order')
assert.match(inventorySource, /useState\(bootstrapIntent\?\.pageSize \?\? 20\)/, 'and at 20 a page, so its first read is the query Products itself sends')

const wire = (params: QueryParams, options = {}) => wiredListParams({ page: 1, pageSize: 20, sortBy: 'name', sortDirection: 'asc', ...params }, options)
assert.equal(canonicalProductsQuery(wire({})), productsQueryString({}), 'default scope: the canonical key is the key Products sends')
assert.equal(canonicalProductsQuery(wire({ sortBy: 'created', sortDirection: 'desc' })), productsQueryString({ productSortDirection: 'created_desc' }), 'created, newest first')
assert.equal(canonicalProductsQuery(wire({ branchId: '1', stockState: 'low_stock', brand: 'Acme', category: 'Soap', page: 3 })),
  productsQueryString({ productPage: 3, branchFilter: '1', effectiveStockState: 'low', brandFilter: new Set(['Acme']), catFilter: new Set(['Soap']) }), 'a branch, a stock state, a brand, a category and page 3')
assert.equal(canonicalProductsQuery(wire({ stockState: 'out_of_stock' })), productsQueryString({ effectiveStockState: 'out' }), 'out of stock')
assert.equal(canonicalProductsQuery(wire({ query: 'soap' })), null, 'a search is not a scope Products holds')
assert.equal(canonicalProductsQuery(wire({ checkState: 'ok', branchId: '1' })), null, 'a check state is not either')

// ---- the wire query ----------------------------------------------------------------------------------------------------------------------------------------
assert.deepEqual(wiredListParams({ branchId: '', stockState: '', checkState: '', brand: '', category: '', sortBy: 'created', sortDirection: 'desc', query: '', page: 1, pageSize: 50, sessionId: '' }),
  { page: 1, pageSize: 50, sortBy: 'created', sortDirection: 'desc' }, 'empty values and the session id never go to /list')
assert.deepEqual(wiredListParams({ branchId: '2', sortBy: 'stock', sortDirection: 'asc', page: 2, pageSize: 20 }), { page: 2, pageSize: 20, branchId: '2', sortBy: 'created', sortDirection: 'asc' }, 'a stock sort (not offered) becomes created')
assert.equal(wiredListParams({ branchId: '1', page: 1, pageSize: 50 }, { omitBranch: true }).branchId, undefined, 'a sole branch is left out of the query')
assert.equal(wiredListParams({ branchId: '1', page: 1, pageSize: 50 }, { skipSummary: true }).summary, 0, 'a page step skips the counts')

// ---- the two figures computed on the client -----------------------------------------------------------------------------------------------------------------
assert.equal(countDifference(9, 12), -3); assert.equal(countDifference(12, 9), 3); assert.equal(countDifference(9, undefined), null); assert.equal(countDifference(undefined, 9), null)
assert.equal(setToAmount(9, 12, 12), 9, 'nothing sold since the count: the Set is the counted figure')
assert.equal(setToAmount(9, 12, 10), 7, 'two sold since the count: the variance (-3) is applied to what is there now')
assert.equal(setToAmount(0, 12, 5), 0, 'never below zero')
assert.equal(setToAmount(9, null, 12), 9, 'no seen figure: the counted figure')
assert.equal(setToAmount(9, 12, undefined), null, 'a viewer without stock has no figure')

// ---- fixtures ---------------------------------------------------------------------------------------------------------------------------------------------------
const branchesFixture = [{ branch_id: 1, branch_name: 'Shop', quantity: 12 }]
const row = (id: number, extra: Record<string, unknown> = {}) => ({ id, name: `Product ${id}`, barcode: `885${id}`, stock_quantity: 12, branch_stock: branchesFixture.map(entry => ({ ...entry })), ...extra })
const listOf = (ids: number[], extra: Partial<WiredList> & Record<string, unknown> = {}): WiredList => ({ items: ids.map(id => row(id)), total: 180, page: 1, pageSize: ids.length, totalPages: 4, wired: true, projected: false,
  tagged_lots: [{ product_id: ids[0], branch_id: 1, condition_tag: 'damaged', quantity: 2 }, { product_id: ids[0], branch_id: 1, condition_tag: 'expired', quantity: 5 }], ...extra })
const overlayEntry = (id: number, extra: Partial<OverlayEntry> = {}): OverlayEntry => ({ product_id: id, last_change_at: '2026-11-03 14:00:00', ...extra })
const FULL: WiredAccess = { stock: true, barcode: true, received: true }
type Log = { lists: QueryParams[]; overlays: Array<{ branchId: number; ids: number[]; lots?: boolean }>; primed: Array<{ query: string; payload: Record<string, unknown> }> }
function deps(options: { held?: Record<string, unknown>; list?: (params: QueryParams) => WiredList | Promise<WiredList>; overlay?: (ids: number[]) => OverlayAnswer; rank?: WiredDeps['rank'] } = {}): { log: Log; deps: WiredDeps } {
  const log: Log = { lists: [], overlays: [], primed: [] }
  return { log, deps: {
    readList: async params => { log.lists.push(params); return (options.list ?? (() => listOf([1, 2, 3])))(params) },
    readOverlay: async params => { log.overlays.push(params); return (options.overlay ?? ((ids: number[]) => ({ items: ids.map(id => overlayEntry(id)) })))(params.ids) },
    peek: query => options.held?.[query] ?? null,
    prime: (query, payload) => { log.primed.push({ query, payload: payload as Record<string, unknown> }) },
    rank: options.rank ?? (() => null),
  } }
}
const params = (extra: QueryParams = {}): QueryParams => ({ page: 1, pageSize: 20, sortBy: 'name', sortDirection: 'asc', branchId: '', ...extra })
const CANON = canonicalProductsQuery(wire({}))!

// ---- one request on open ----------------------------------------------------------------------------------------------------------------------------------
{
  const { log, deps: d } = deps()
  const load = await loadWired({ params: params(), skipSummary: false, access: FULL, deps: d })
  assert.equal(log.lists.length, 1, 'no store: one list request')
  assert.equal(load.listRequests, 1)
  assert.deepEqual(log.lists[0], { page: 1, pageSize: 20, sortBy: 'name', sortDirection: 'asc' }, 'the open request names no branch')
  assert.equal(log.overlays.length, 0, 'no overlay yet: the branch is chosen by the page from the rows, and the overlay is asked once, after that')
  const again = await loadWired({ params: params({ branchId: '1' }), seed: load.raw.list, known: { branches: load.raw.branches }, skipSummary: false, access: FULL, deps: d })
  assert.equal(log.lists.length, 1, 'the remount takes the open answer along: still one list request'); assert.equal(again.listRequests, 0)
  assert.deepEqual(log.overlays, [{ branchId: 1, ids: [1, 2, 3], lots: true }], 'one overlay request, for the sole branch; it asks for the received dates too: the rows carry none')
  assert.equal(log.primed.length, 1, 'an answer that is exactly Products\' answer primes the shared store')
  assert.equal(log.primed[0].query, CANON)
  for (const key of ['wired', 'projected', 'summary', 'capabilities']) assert.equal(key in log.primed[0].payload, false, `the primed payload carries no Inventory-only ${key}`)
  assert.deepEqual(load.raw.branches, [{ id: 1, name: 'Shop' }]); assert.equal(load.raw.branchId, 0)
}
{
  const { log, deps: d } = deps({ held: { [CANON]: listOf([1, 2, 3], { wired: undefined, projected: undefined }) } })
  const load = await loadWired({ params: params(), skipSummary: false, access: FULL, deps: d })
  assert.equal(log.lists.length, 0, 'Products already holds the rows: 0 list requests')
  assert.equal(load.listRequests, 0); assert.equal(load.fromStore, true)
  assert.equal(log.primed.length, 0); assert.deepEqual(load.raw.branches, [{ id: 1, name: 'Shop' }], 'the sole branch comes from the held rows')
  await loadWired({ params: params({ branchId: '1' }), seed: load.raw.list, known: { branches: load.raw.branches }, skipSummary: false, access: FULL, deps: d })
  assert.equal(log.lists.length, 0, 'still 0 list requests'); assert.equal(log.overlays.length, 1, 'only the overlay is requested')
}
{
  const { log, deps: d } = deps({ held: { [CANON]: listOf([1, 2, 3]) } })
  await loadWired({ params: params(), skipSummary: false, bypassStore: true, access: FULL, deps: d })
  assert.equal(log.lists.length, 1, 'after a write or Refresh the held answer is not used')
}
{
  const { log, deps: d } = deps({ held: { [CANON]: listOf([1, 2, 3]) } })
  const load = await loadWired({ params: params(), skipSummary: false, access: { ...FULL, stock: false }, deps: d })
  assert.equal(log.lists.length, 1, 'a blind-count viewer never reads the shared store: the server cuts stock from its own answer')
  assert.equal(load.fromStore, false)
}
{
  const projected = listOf([1, 2, 3], { projected: true })
  const { log, deps: d } = deps({ list: () => projected })
  await loadWired({ params: params(), skipSummary: false, access: FULL, deps: d })
  assert.equal(log.primed.length, 0, 'a projected answer stays in Inventory\'s own memory')
}
{
  const seed = listOf([1, 2, 3])
  const { log, deps: d } = deps()
  const load = await loadWired({ params: params({ branchId: '1' }), seed, known: { branches: [{ id: 1, name: 'Shop' }] }, skipSummary: false, access: FULL, deps: d })
  assert.equal(log.lists.length, 0, 'the answer to the open request, handed through the remount, is not asked for again'); assert.equal(load.listRequests, 0)
  assert.equal(log.overlays.length, 1)
}
{
  const two = listOf([1, 2], { items: [1, 2].map(id => row(id, { branch_stock: [{ branch_id: 1, branch_name: 'Shop', quantity: 12 }, { branch_id: 2, branch_name: 'Store', quantity: 3 }] })) })
  const { log, deps: d } = deps({ list: () => two })
  await loadWired({ params: params(), skipSummary: false, access: FULL, deps: d })
  assert.equal(log.overlays.length, 0, 'two branches and none chosen: no overlay (counts are per branch)')
  await loadWired({ params: params({ branchId: '2' }), skipSummary: false, access: FULL, deps: d })
  assert.equal(log.overlays[0].branchId, 2); assert.equal(log.lists[1].branchId, '2', 'a chosen branch goes in the query when the shop has more than one')
}
{
  const many = Array.from({ length: 230 }, (_, index) => index + 1)
  const { log, deps: d } = deps({ list: () => listOf(many) })
  await loadWired({ params: params({ pageSize: 230, branchId: '1' }), skipSummary: false, access: FULL, deps: d })
  assert.deepEqual(log.overlays.map(call => call.ids.length), [100, 100, 30], 'the overlay is asked in windows of 100 ids')
}

// ---- not wired --------------------------------------------------------------------------------------------------------------------------------------------
{
  const refuse = deps({ list: () => { throw Object.assign(new Error('not found'), { status: 404 }) } })
  await assert.rejects(() => loadWired({ params: params(), skipSummary: false, access: FULL, deps: refuse.deps }), NotWired, 'a 404 from /list is an OFF server')
  const other = deps({ list: () => { throw Object.assign(new Error('boom'), { status: 500 }) } })
  await assert.rejects(() => loadWired({ params: params(), skipSummary: false, access: FULL, deps: other.deps }), /boom/, 'any other failure is a failure, not a fallback')
  const unmarked = deps({ list: () => listOf([1], { wired: undefined }) })
  await assert.rejects(() => loadWired({ params: params(), skipSummary: false, access: FULL, deps: unmarked.deps }), NotWired, 'an answer that does not say it is wired is not trusted as one')
}

// ---- search: the device index plus ids ---------------------------------------------------------------------------------------------------------------------
{
  const ranked = { ids: [30, 10, 20, 40], total: 4 }
  const { log, deps: d } = deps({ rank: () => ranked, list: p => listOf(String(p.ids).split(',').map(Number).reverse()) })
  const load = await loadWired({ params: params({ query: 'soap' }), skipSummary: false, access: FULL, deps: d })
  assert.deepEqual(log.lists[0], { ids: '30,10,20,40' }, 'the ranked ids are read by id, with no query text and no paging keys')
  assert.deepEqual(load.raw.list.items.map(item => item.id), [30, 10, 20, 40], 'rows come back in the index\'s rank order')
  assert.equal(load.raw.list.total, 4); assert.equal(log.primed.length, 0, 'a search is never primed as a Products scope')
  const page2 = await loadWired({ params: params({ query: 'soap', page: 2, pageSize: 2 }), skipSummary: false, access: FULL, deps: deps({ rank: () => ranked, list: p => listOf(String(p.ids).split(',').map(Number)) }).deps })
  assert.deepEqual(page2.raw.list.items.map(item => item.id), [20, 40], 'page 2 is the next slice of the ranking'); assert.equal(page2.raw.list.totalPages, 2)
  const none = deps({ rank: () => ({ ids: [], total: 0 }) })
  const empty = await loadWired({ params: params({ query: 'zzz' }), skipSummary: false, access: FULL, deps: none.deps })
  assert.equal(none.log.lists.length, 0, 'a search the index answers with nothing reads nothing'); assert.deepEqual(empty.raw.list.items, [])
  const notReady = deps({ rank: () => null })
  await loadWired({ params: params({ query: 'soap' }), skipSummary: false, access: FULL, deps: notReady.deps })
  assert.equal(notReady.log.lists[0].query, 'soap', 'an index that is not ready: the server\'s text search')
  const blind = deps({ rank: () => ranked })
  await loadWired({ params: params({ query: '885001' }), skipSummary: false, access: { ...FULL, barcode: false }, deps: blind.deps })
  assert.equal(blind.log.lists[0].query, '885001', 'a viewer who may not see barcodes is searched by the server (exact codes only), never by the index')
  const filtered = deps({ rank: () => ranked })
  await loadWired({ params: params({ query: 'soap', brand: 'Acme' }), skipSummary: false, access: FULL, deps: filtered.deps })
  assert.equal(filtered.log.lists[0].query, 'soap', 'a search with a filter is the server\'s, which applies both')
}

// ---- the rows the page draws -------------------------------------------------------------------------------------------------------------------------------
{
  const lots = [{ id: 7, received_at: '2026-10-01', expiry_date: '2027-01-01', branches: [{ branch_id: 1, quantity: 5 }] }, { id: 8, received_at: '2026-10-20', expiry_date: '2026-12-01', branches: [{ branch_id: 1, quantity: 7 }] },
    { id: 9, received_at: '2026-11-01', expiry_date: '2026-11-15', branches: [{ branch_id: 1, quantity: 0 }] }]
  const { deps: d } = deps({ overlay: ids => ({ items: [overlayEntry(ids[0], { check: { state: 'issue', counted_quantity: 9, seen_quantity: 12, note: 'short', by: 'sok', at: '2026-11-02 09:00:00', session_id: 's1', revision: 2 }, pending: true }), overlayEntry(ids[1])],
    lots: [{ product_id: ids[0], lots }] }) })
  const load = await loadWired({ params: params({ branchId: '1' }), skipSummary: false, access: FULL, deps: d })
  const result = wiredResult(load.raw)
  const [first, second] = result.items
  assert.equal(first.quantity, 12, 'now = the branch quantity from the shared row'); assert.equal(first.damaged_quantity, 2, 'damaged comes from the tagged groups (the expired group is not damaged)')
  assert.equal(first.check_status, 'issue'); assert.equal(first.check_counted_quantity, 9); assert.equal(first.check_by, 'sok'); assert.equal(first.check_pending, true)
  assert.equal(first.check_difference, -3, 'difference = counted - now'); assert.equal(first.check_set_to, 9, 'seen 12 and now 12: the Set is the counted figure')
  assert.equal(first.latest_received_at, '2026-11-01'); assert.equal(first.next_expiry_date, '2026-12-01', 'earliest expiry among lots still holding stock here')
  assert.equal(first.last_change_at, '2026-11-03 14:00:00')
  assert.equal(second.check_status, 'not_checked'); assert.equal(second.check_difference, undefined)
  assert.equal(result.simple, true); assert.equal(result.wired, true); assert.deepEqual(result.branches, [{ id: 1, name: 'Shop' }])
  // sales since the count: the row shows the shared figure patched elsewhere; the Set keeps the variance
  const sold = { ...load.raw, list: { ...load.raw.list, items: load.raw.list.items.map(item => Number(item.id) === 1 ? { ...item, branch_stock: [{ branch_id: 1, branch_name: 'Shop', quantity: 10 }] } : item) } }
  const after = wiredResult(sold).items[0]
  assert.equal(after.check_difference, -1); assert.equal(after.check_set_to, 7, 'now 10 + (9 - 12)')
}
{
  // a viewer without the stock field: the server cut the quantities; nothing is invented
  const blindList = listOf([1], { items: [{ id: 1, name: 'Blind', branch_stock: [{ branch_id: 1, branch_name: 'Shop' }] }], tagged_lots: undefined })
  const { deps: d } = deps({ list: () => blindList, overlay: ids => ({ items: [overlayEntry(ids[0], { check: { state: 'ok', note: null, at: null, session_id: 's', revision: 1 } })] }) })
  const load = await loadWired({ params: params({ branchId: '1' }), skipSummary: false, access: { ...FULL, stock: false }, deps: d })
  const [only] = wiredResult(load.raw).items
  assert.equal(only.quantity, undefined, 'no quantity is shown'); assert.equal(only.check_difference, null, 'and no difference is computed'); assert.equal(only.check_counted_quantity, null)
}
{
  // summary: kept across a page step, replaced by the answer that brings one
  const withSummary = listOf([1], { summary: { ok: 3, issue: 1, not_checked: 170, total: 180 } })
  const first = wiredResult((await loadWired({ params: params(), skipSummary: false, access: FULL, deps: deps({ list: () => withSummary }).deps })).raw)
  assert.deepEqual(first.summary, { not_checked: 170, in_check: 0, ok: 3, issue: 1, total: 180 })
  const step = wiredResult((await loadWired({ params: params({ page: 2 }), skipSummary: true, access: FULL, deps: deps({ list: () => listOf([1]) }).deps })).raw, first)
  assert.deepEqual(step.summary, first.summary, 'a page step brings no counts: the last ones stay')
  const filteredSummary = wiredResult((await loadWired({ params: params({ brand: 'A' }), skipSummary: false, access: FULL, deps: deps({ list: () => listOf([1], { summary: { ok: 1, issue: 0 } }) }).deps })).raw, first)
  assert.deepEqual(filteredSummary.summary, { not_checked: 170, in_check: 0, ok: 1, issue: 0, total: 180 }, 'a filtered answer has no not-checked figure: that one stays')
}

// ---- a by-id refresh ---------------------------------------------------------------------------------------------------------------------------------------
{
  const { log, deps: d } = deps({ list: () => listOf([1, 2, 3]) })
  const load = await loadWired({ params: params({ branchId: '1' }), skipSummary: false, access: FULL, deps: d })
  const fresh = await readWiredRows([2], 1, { ...d, readList: async p => { log.lists.push(p); return { ...listOf([2]), items: [row(2, { branch_stock: [{ branch_id: 1, branch_name: 'Shop', quantity: 4 }] })], tagged_lots: [] } },
    readOverlay: async p => { log.overlays.push(p); return { items: [overlayEntry(2, { last_change_at: '2026-11-05 10:00:00' })] } } }, FULL)
  assert.deepEqual(log.lists.at(-1), { ids: '2', branchId: 1 }, 'the refresh reads the changed id, nothing else')
  const merged = wiredResult(mergeWiredRows(load.raw, fresh)).items
  assert.deepEqual(merged.map(item => item.id), [1, 2, 3], 'the page keeps its order'); assert.equal(merged[1].quantity, 4); assert.equal(merged[1].last_change_at, '2026-11-05 10:00:00'); assert.equal(merged[0].quantity, 12)
  assert.equal(merged[0].damaged_quantity, 2, 'the other rows keep their held stock groups')
}

// ---- which server this tab last saw ---------------------------------------------------------------------------------------------------------------------------
assert.equal(wiredMode(1_000), 'unknown'); rememberWiredMode('old', 1_000); assert.equal(wiredMode(2_000), 'old', 'a 404 is remembered')
assert.equal(wiredMode(1_000 + 5 * 60_000 + 1), 'unknown', 'and forgotten after 5 minutes, so a switch turned on is found without a reload')
rememberWiredMode('unknown')
assert.deepEqual(branchesOf([{ id: 1, branch_stock: [{ branch_id: 2, branch_name: 'B' }, { branch_id: 1, branch_name: 'A' }] }, { id: 2 }]), [{ id: 1, name: 'A' }, { id: 2, name: 'B' }])

console.log('inventoryWired passed: canonical key, wire query, one request on open, store hit, blind, search, rows, refresh')
