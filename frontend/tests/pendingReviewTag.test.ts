// The mini "waiting for review" tag (owner, 13 Oct 2026): "do a mini small tag to show
// the row needs review. minimize without taking used spaces or breaking UI. utilize
// empty space can be the empty margin."
//
// What this pins:
//   - the tag is ABSENT when nothing is pending, and present (role="img", the translated
//     label as aria-label and title, a 10px amber hourglass) when its record is waiting;
//   - the tag takes no space: it is `pointer-events-none absolute`, nothing in its class
//     string can put it back in the flow, and the markup of every surface with the tag
//     removed is byte-identical to the markup without it (name cells, rows and cards keep
//     the box they had);
//   - each surface places it where the plan's table (section 2.1) says, inside a gutter
//     the row already has, and the Products row keeps its memo boundary;
//   - rows only read the shared store: no row file imports the transport or fetches.
// The store's own rules (one request per page visit, who reads which list) are pinned in
// tests/pendingReviewTargets.test.ts.
//
// Negative controls at the end are the same source with one rule removed; each must turn the
// matching check RED (tag placed in the flow; a caller offset that takes space).
//
// Run: node tests/pendingReviewTag.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { transformSync } from 'esbuild'
import { __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import * as store from '../src/utils/pendingReviewTargets.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const read = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>

// ---- a recording fetch behind the real transport, and a way to put requests "in the queue" ----
type Row = { section: string; entity_type: string; entity_id: number | null; status: string }
const open = (section: string, entity_type: string, entity_id: number | null): Row => ({ section, entity_type, entity_id, status: 'open' })
let queue: Row[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, data: queue }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
setSyncServerUrl('https://sync.example.test')
async function waiting(...rows: Row[]): Promise<void> {
  queue = rows
  __resetApiWriteDedupeForTests()
  await store.refreshPendingReviewTargets('all')
}
async function nothingWaiting(): Promise<void> { await waiting() }

// ---- compile the real components with a language the test controls ----
let language: 'en' | 'km' = 'en'
const translate = (key: string): string => (language === 'km' ? km : en)[key] ?? key
function load(file: string, code = read(file), extra: (id: string) => unknown = () => undefined): Record<string, any> {
  const mod: { exports: Record<string, any> } = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(code, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.endsWith('utils/pendingReviewTargets.ts')) return store
    if (id.endsWith('AppContextCore.tsx')) return { useApp: () => ({ t: translate, getPermissionTier: () => 'full' }), useSync: () => ({ syncChannel: null }) }
    if (id.endsWith('icons/hourglass.js')) return { default: (props: Record<string, unknown>) => React.createElement('svg', { 'data-icon': 'hourglass', ...props }), __esModule: true }
    const injected = extra(id)
    if (injected !== undefined) return injected
    return { default: () => null, __esModule: true }
  }, mod, mod.exports)
  return mod.exports
}
const tagModule = (code?: string) => load('components/shared/PendingReviewTag.tsx', code)
const render = (node: unknown): string => renderToStaticMarkup(node as never)
const tagMarkup = (api: Record<string, any>, props: Record<string, unknown> = {}): string =>
  render(React.createElement(api.default, { section: 'products', entityType: 'product', ids: [7], className: 'left-0 top-1', ...props }))

// The tag element(s) in a piece of markup: <span role="img" ...><svg ...></svg></span>
const TAG = /<span role="img"[^>]*><svg[^>]*><\/svg><\/span>/g
const classOf = (html: string): string[] => (html.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)

// ---- the contract on a tag's class list: out of the flow, no box of its own ----
// Anything here that could put the tag back in the flow, or give it a margin/padding/size
// beyond the 10px box, is a regression the owner called out ("without taking used spaces").
const POSITION_UTILITIES = /^(?:static|relative|sticky|fixed)$/
const TAKES_SPACE = /^(?:-?m[trblxyse]?-|p[trblxyse]?-|float-|clear-|inline|block$|flex$|grid$|table|contents$|w-|h-|min-|max-|basis-|grow|shrink|gap-|space-)/
const OFFSETS = /^(?:-?(?:left|right|top|bottom|inset)(?:-[\w.[\]/%-]+)?|-?translate-[xy]-[\w./[\]-]+)$/
function assertOutOfFlow(html: string, where: string): void {
  const tokens = classOf(html)
  assert.ok(tokens.includes('absolute'), `${where}: the tag must be absolutely positioned, class was "${tokens.join(' ')}"`)
  assert.ok(tokens.includes('pointer-events-none'), `${where}: the tag must not take taps from the row, class was "${tokens.join(' ')}"`)
  assert.ok(!tokens.some((token) => POSITION_UTILITIES.test(token)), `${where}: a position utility besides absolute puts the tag back in the flow: ${tokens.join(' ')}`)
  const space = tokens.filter((token) => TAKES_SPACE.test(token) && !['h-2.5', 'w-2.5'].includes(token))
  assert.deepEqual(space, [], `${where}: these classes give the tag a box of its own: ${space.join(' ')}`)
  const placement = tokens.filter((token) => OFFSETS.test(token))
  assert.ok(placement.length > 0, `${where}: the caller must offset the tag inside its container`)
}
// The inner box must be exactly the 10px glyph.
const GLYPH = /<svg data-icon="hourglass" aria-hidden="true" class="block h-2\.5 w-2\.5"/

// ---- the tests ----

test('the tag is absent when nothing is pending', async () => {
  await nothingWaiting()
  const api = tagModule()
  assert.equal(tagMarkup(api), '')
  assert.equal(render(React.createElement(api.PendingReviewCountBadge, { section: 'products', entityType: 'product' })), '')
})

test('the tag appears for a waiting record: a 10px amber hourglass named in the user\'s language', async () => {
  await waiting(open('products', 'product', 7))
  const api = tagModule()
  const html = tagMarkup(api)
  assert.match(html, /^<span role="img" aria-label="Waiting for review" title="Waiting for review" class="/)
  assert.match(html, GLYPH, 'the 10px hourglass icon')
  const tokens = classOf(html)
  for (const token of ['pointer-events-none', 'absolute', 'h-2.5', 'w-2.5', 'text-amber-600', 'dark:text-amber-400', 'left-0', 'top-1']) {
    assert.ok(tokens.includes(token), `tag class carries ${token}: ${tokens.join(' ')}`)
  }
  language = 'km'
  try {
    const khmer = tagMarkup(tagModule())
    assert.match(khmer, /aria-label="កំពុងរង់ចាំការត្រួតពិនិត្យ" title="កំពុងរង់ចាំការត្រួតពិនិត្យ"/)
  } finally { language = 'en' }
  assert.equal(en.pending_review_tag, 'Waiting for review')
  assert.notEqual(km.pending_review_tag, en.pending_review_tag)
})

test('the tag is out of the flow and takes no box of its own', async () => {
  await waiting(open('products', 'product', 7))
  assertOutOfFlow(tagMarkup(tagModule()), 'PendingReviewTag')
  const source = read('components/shared/PendingReviewTag.tsx')
  assert.match(source, /export const PENDING_REVIEW_TAG_CLASS = 'pointer-events-none absolute h-2\.5 w-2\.5 text-amber-600 dark:text-amber-400'/)
})

test('a tag answers only for its own record, section and type; a merged row answers for any of its ids', async () => {
  await waiting(open('products', 'product', 31), open('fees', 'fee', 5), open('branches', 'branch', 2))
  const api = tagModule()
  assert.notEqual(tagMarkup(api, { ids: [30, 31, 32] }), '', 'a merged display row is tagged when one of its records waits')
  assert.equal(tagMarkup(api, { ids: [30, 32] }), '')
  assert.equal(tagMarkup(api, { ids: [5] }), '', 'fee 5 waiting does not tag product 5')
  assert.notEqual(tagMarkup(api, { section: 'fees', entityType: 'fee', ids: [5] }), '')
  assert.equal(tagMarkup(api, { section: 'fees', entityType: 'fee', ids: [31] }), '')
  assert.notEqual(tagMarkup(api, { section: 'branches', entityType: 'branch', ids: [2] }), '')
  assert.equal(tagMarkup(api, { ids: [undefined, null] }), '', 'a row with no id is never tagged')
})

test('product creates have no record yet: they are counted on the Add button, never tagged on a row', async () => {
  const badge = (api: Record<string, any>) => render(React.createElement(api.PendingReviewCountBadge, { section: 'products', entityType: 'product' }))
  await waiting(open('products', 'product', null))
  assert.equal(tagMarkup(tagModule()), '', 'a create waiting does not tag product 7')
  const one = badge(tagModule())
  assert.match(one, /role="img" aria-label="Waiting for review: 1" title="Waiting for review: 1"/)
  assert.match(one, />1<\/span>$/)
  await waiting(open('products', 'product', null), open('products', 'product', null), open('products', 'product', 5))
  assert.match(badge(tagModule()), />2<\/span>$/, 'edits of existing products are not creates')
  await waiting(...Array.from({ length: 12 }, () => open('products', 'product', null)))
  assert.match(badge(tagModule()), />9\+<\/span>$/)
  await waiting(open('fees', 'fee', null))
  assert.equal(badge(tagModule()), '', 'another section\'s requests are not product creates')
})

test('the Add-button badge stays inside the button\'s own box', async () => {
  await waiting(open('products', 'product', null))
  const html = render(React.createElement(tagModule().PendingReviewCountBadge, { section: 'products', entityType: 'product' }))
  const tokens = classOf(html)
  for (const token of ['pointer-events-none', 'absolute', 'right-px', 'top-px', 'h-2.5']) assert.ok(tokens.includes(token), `badge carries ${token}: ${tokens.join(' ')}`)
  assert.ok(!tokens.some((token) => /^-(?:right|top|left|bottom)/.test(token)), 'a negative offset would poke out of the toolbar\'s overflow-x-auto strip and add a scrollbar')
  assert.ok(!tokens.some((token) => POSITION_UTILITIES.test(token)))
})

test('rows only read the shared store: no tag or row file talks to the network', () => {
  const tag = read('components/shared/PendingReviewTag.tsx')
  assert.doesNotMatch(tag, /from '[^']*\/api\//, 'the tag must not import any transport')
  assert.doesNotMatch(tag, /\bfetch\(|apiFetch|route\(|useEffect/, 'the tag has no effect and no request')
  assert.match(tag, /useIsPendingReview\(/)
  const sync = read('components/shared/PendingReviewSync.tsx')
  assert.doesNotMatch(sync, /\bfetch\(|apiFetch/)
  assert.match(sync, /usePendingReviewTargetsLoader\(/)
  assert.match(sync, /getPermissionTier\?\.\('review'\)/, 'the list a user reads follows their review permission')
})

// ---- the Inventory products surface, rendered for real ----
const surfaceSource = read('components/inventory/InventoryProductsSurface.tsx')
function loadSurface(code = surfaceSource, tagApiCode?: string): Record<string, any> {
  const tagApi = tagModule(tagApiCode)
  return load('components/inventory/InventoryProductsSurface.tsx', code, (id) => {
    if (id.includes('PendingReviewTag')) return tagApi
    if (id.includes('PendingReviewSync')) return { default: () => null, __esModule: true }
    if (id.includes('productGrouping')) return require('../src/utils/productGrouping.ts')
    return undefined
  })
}
const products = [
  { id: 1, name: 'Tea', barcode: '111', purchase_price_usd: 2, selling_price_usd: 4, branch_stock: [{ branch_id: 1, branch_name: 'A', quantity: 3 }] },
  { id: 2, name: 'Tea', barcode: '111', purchase_price_usd: 4, selling_price_usd: 5, branch_stock: [{ branch_id: 2, branch_name: 'B', quantity: 7 }] },
  { id: 3, name: 'Soap', barcode: '333', purchase_price_usd: 1, selling_price_usd: 2, branch_stock: [{ branch_id: 1, branch_name: 'A', quantity: 9 }] },
  { id: 4, name: 'Salt', barcode: '444', purchase_price_usd: 1, selling_price_usd: 2, branch_stock: [{ branch_id: 1, branch_name: 'A', quantity: 4 }] },
]
const surfaceProps = {
  items: products, total: products.length, page: 1, pageSize: 20, totalPages: 1, branchFilter: 'all', loading: false, error: null,
  serverStats: null, statsLoading: false, t: (key: string) => key, fmtUSD: (v: number) => `$${v}`, fmtKHR: (v: number) => `${v}KHR`,
  onPageChange: () => {}, onPageSizeChange: () => {}, onOpenDetail: () => {}, onOpenInCatalogue: () => {},
}
const renderSurface = (api: Record<string, any>): string => render(React.createElement(api.default, surfaceProps))

test('Inventory products: the tag sits in the first cell and the card gutter, and removing it leaves the markup byte-identical', async () => {
  await nothingWaiting()
  const api = loadSurface()
  const without = renderSurface(api)
  assert.equal((without.match(TAG) || []).length, 0, 'no tag when nothing waits')

  // Product 2 waits: the Tea display row stands for ids 1 and 2, so its row AND its card carry the tag.
  await waiting(open('products', 'product', 2))
  const withTag = renderSurface(api)
  const tags = withTag.match(TAG) || []
  assert.equal(tags.length, 2, 'one tag on the desktop row and one on the mobile card of the merged Tea row')
  for (const tag of tags) assertOutOfFlow(tag, 'Inventory tag')
  assert.equal(withTag.replace(TAG, ''), without, 'the markup with the tag removed is identical to the markup without it: nothing else moved')

  // The tag lives in the gutter of the first cell, whose own padding is the empty margin.
  assert.match(withTag, /<td class="relative max-w-\[18rem\] px-3 py-1\.5"><span role="img"/)
  assert.match(withTag, /<div class="card relative min-w-0 p-2 text-sm"><span role="img"/)
  const soap = withTag.indexOf('Soap')
  assert.ok(soap === -1 || !/<span role="img"/.test(withTag.slice(withTag.indexOf('<tr', withTag.indexOf('Tea'))).split('</tr>')[1] || ''), 'only the waiting row is tagged')

  // Another section's request for the same number, or an approved one, tags nothing.
  await waiting(open('fees', 'fee', 2), open('branches', 'branch', 3))
  assert.equal(renderSurface(api), without)
})

test('Inventory products: a row or card whose record is not waiting keeps its classes (the container is always positioned)', async () => {
  await nothingWaiting()
  const html = renderSurface(loadSurface())
  assert.match(html, /<td class="relative max-w-\[18rem\] px-3 py-1\.5">/, 'the positioned container exists with or without a tag, so the tag never changes the row\'s box')
  assert.match(html, /<div class="card relative min-w-0 p-2 text-sm">/)
})

// ---- the other surfaces: the plan's table (section 2.1) as source facts ----
const products_tsx = read('components/products/Products.tsx')
const fees = read('components/fees/FeesPage.tsx')
const branches = read('components/branches/Branches.tsx')
const reasons = read('components/shared/StockReasonsManagerModal.tsx')
const header = read('components/products/surfaces/HeaderActions.tsx')
const offsetOf = (source: string, anchor: string): string[] => {
  const at = source.indexOf(anchor)
  assert.notEqual(at, -1, `missing ${anchor}`)
  const element = source.slice(at, source.indexOf('/>', at) + 2)
  return (element.match(/className="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
}
const onlyOffsets = (tokens: string[], where: string) => {
  assert.ok(tokens.length > 0 && tokens.every((token) => OFFSETS.test(token)), `${where}: the caller passes only offsets, got "${tokens.join(' ')}"`)
}

test('Products table row: the tag is in the image cell (the name cell is untouched) and the memo boundaries are intact', () => {
  const desktop = products_tsx.slice(products_tsx.indexOf('function ProductDesktopRowComponent'), products_tsx.indexOf('const ProductDesktopRow = memo'))
  const imageCell = desktop.slice(desktop.indexOf('<td className="relative px-2 py-2">'), desktop.indexOf('{/* Name rail (col 3)'))
  assert.ok(imageCell.length > 0, 'the image cell is positioned (relative) so the tag has a container')
  assert.match(imageCell, /<PendingReviewTag section="products" entityType="product" ids=\{rowScopeIds\}/)
  assert.equal((desktop.match(/<PendingReviewTag/g) || []).length, 1, 'one tag per desktop row')
  onlyOffsets(offsetOf(desktop, '<PendingReviewTag'), 'desktop row')
  // A child row has no image, but its (empty) image cell still hosts the tag in the same column.
  assert.ok(imageCell.indexOf('<PendingReviewTag') < imageCell.indexOf('{indented ? null : ('), 'the tag renders for child rows too')
  // The name cell is byte-for-byte what it was.
  assert.ok(desktop.includes('<td className={`${ROW_TEXT_GUTTER} py-2`}>'), 'the name cell\'s opening tag is unchanged')
  const nameCell = desktop.slice(desktop.indexOf('<td className={`${ROW_TEXT_GUTTER} py-2`}>'), desktop.indexOf('{/* border-l here'))
  assert.doesNotMatch(nameCell, /PendingReviewTag|relative/, 'nothing was added to the name cell')

  // Rows read the store through the tag; the shared ctx did not grow, so no row re-renders when the list changes.
  assert.match(products_tsx, /const ProductDesktopRow = memo\(ProductDesktopRowComponent\)/)
  assert.match(products_tsx, /const ProductMobileCard = memo\(ProductMobileCardComponent\)/)
  const ctxType = products_tsx.slice(products_tsx.indexOf('type ProductRowCtx = {'), products_tsx.indexOf('function ProductDesktopRowComponent'))
  assert.doesNotMatch(ctxType, /pending|Pending|review/i, 'the pending list is not in the row context')
  const ctxMemo = products_tsx.slice(products_tsx.indexOf('const productRowCtx = useMemo<ProductRowCtx>'), products_tsx.indexOf('const renderDesktopProductRow'))
  assert.doesNotMatch(ctxMemo, /pending|Pending/, 'the row context memo does not depend on the pending list')
})

test('Products card: the tag is in the card\'s start gutter; indented child cards use their own 12px padding', () => {
  const card = products_tsx.slice(products_tsx.indexOf('function ProductMobileCardComponent'), products_tsx.indexOf('const ProductMobileCard = memo'))
  const rowClass = card.slice(card.indexOf('const rowClassName = indented'), card.indexOf('// Same long-press/select-mode rules'))
  assert.equal((rowClass.match(/\brelative\b/g) || []).length, 2, 'both the grouped-child card and the standalone card are positioned containers')
  assert.match(card, /<PendingReviewTag section="products" entityType="product" ids=\{rowScopeIds\}/)
  assert.equal((card.match(/<PendingReviewTag/g) || []).length, 1, 'one tag per card')
  onlyOffsets(offsetOf(card, '<PendingReviewTag'), 'product card')
  // It sits before the flex row that holds the thumbnail and text, so it cannot reorder or resize them.
  assert.ok(card.indexOf('<PendingReviewTag') < card.indexOf('<div className="flex min-w-0 items-start gap-3">'))
  // The discount badge keeps the thumbnail's top-right corner; the tag takes the start gutter, not the thumbnail.
  assert.match(card, /<ProductDiscountBadge[^>]*overlay \/>/)
})

test('Products: one loader per page, and every product write that is answered "queued" refreshes the tags', () => {
  assert.equal((products_tsx.match(/<PendingReviewSync/g) || []).length, 1)
  assert.match(products_tsx, /<PendingReviewSync active=\{isActive\} \/>/)
  const write = products_tsx.slice(products_tsx.indexOf('const runProductWriteMutation = useCallback'), products_tsx.indexOf('const runProductStockMutation'))
  assert.match(write, /withLoaderTimeout\(loader, label, timeoutMs\)\.then\(noteQueuedForReview\)/, 'create, edit, bulk edit and restore all go through this wrapper')
  assert.match(write, /withLoaderTimeout\(loader, label, PRODUCT_DELETE_MUTATION_TIMEOUT_MS\)\.then\(noteQueuedForReview\)/, 'single and bulk removal go through this one')
  const stock = products_tsx.slice(products_tsx.indexOf('const runProductStockMutation'), products_tsx.indexOf('const load = useCallback'))
  assert.doesNotMatch(stock.slice(0, 300), /noteQueuedForReview/, 'stock moves never queue, so they never refresh the tags')
})

test('Products Add button: a pending-create count badge inside the button\'s own box', () => {
  assert.match(header, /import \{ PendingReviewCountBadge \} from '\.\.\/\.\.\/shared\/PendingReviewTag'/)
  const add = header.slice(header.indexOf('{onAdd ? ('), header.indexOf('{primaryActionSlot}'))
  assert.match(add, /className=\{`\$\{primaryToolbarButtonClassName\} relative min-w-max`\}/)
  assert.match(add, /<PendingReviewCountBadge section="products" entityType="product" \/>/)
  assert.ok(add.indexOf('<PendingReviewCountBadge') > add.indexOf('<span className="min-w-0 truncate">'), 'the badge follows the label, so it never reorders the icon and text')
})

test('Expenses: the tag is in the time cell and the card\'s start gutter; only deletes queue, so only a fee id can be tagged', () => {
  assert.match(fees, /import PendingReviewTag from '\.\.\/shared\/PendingReviewTag'/)
  assert.equal((fees.match(/<PendingReviewTag/g) || []).length, 2, 'one in the table row, one in the card')
  assert.equal((fees.match(/<PendingReviewSync/g) || []).length, 1)
  assert.match(fees, /<PendingReviewSync active=\{isActive\} \/>/)
  const timeCell = fees.slice(fees.indexOf('<td className="relative whitespace-nowrap text-slate-500'), fees.indexOf('<td className="whitespace-nowrap">'))
  assert.match(timeCell, /<PendingReviewTag section="fees" entityType="fee" ids=\{\[fee\.id\]\}/)
  assert.match(timeCell, /\{fmtClock24\(fee\.created_at\)\}/, 'the time text is still the cell\'s content')
  const card = fees.slice(fees.indexOf('data-expense-card=""'), fees.indexOf('data-expense-line="primary"'))
  assert.match(card, /className="relative block w-full/)
  assert.match(card, /<PendingReviewTag section="fees" entityType="fee" ids=\{\[fee\.id\]\}/)
  for (const element of fees.match(/<PendingReviewTag[^>]*\/>/g) || []) onlyOffsets((element.match(/className="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean), 'expense tag')
})

test('Branch cards: the tag is in the card\'s start gutter, and an edit queued by this user refreshes it', () => {
  assert.match(branches, /import PendingReviewTag from '\.\.\/shared\/PendingReviewTag'/)
  assert.match(branches, /className="card relative overflow-hidden transition-all"\s*>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<PendingReviewTag section="branches" entityType="branch" ids=\{\[branch\.id\]\}/)
  assert.equal((branches.match(/<PendingReviewTag/g) || []).length, 1)
  assert.equal((branches.match(/<PendingReviewSync/g) || []).length, 1)
  assert.match(branches, /<PendingReviewSync active=\{isActive\} \/>/)
  onlyOffsets(offsetOf(branches, '<PendingReviewTag'), 'branch card')
  assert.match(branches, /withWriteTimeout\(loader, label, BRANCH_MUTATION_TIMEOUT_MS, \(key\) => tr\(key, ''\)\)\.then\(noteQueuedForReview\)/)
})

test('Saved reasons window: a slot beside the title tags a waiting list edit and the window keeps its own loader', () => {
  assert.match(reasons, /<PendingReviewSync \/>/)
  assert.match(reasons, /<PendingReviewTag section="inventory" entityType="inventory_reason" ids=\{\[PENDING_REVIEW_NEW\]\}/)
  const slot = reasons.slice(reasons.indexOf('<span className="relative'), reasons.indexOf('</span>', reasons.indexOf('<span className="relative')))
  assert.match(slot, /<span className="relative ml-1\.5 inline-block h-2\.5 w-2\.5 align-middle">/, 'the slot is the only thing in the flow, and is exactly the glyph\'s 10px box')
  const catalog = read('utils/useStockReasonCatalog.ts')
  assert.match(catalog, /if \(result\?\.pending\) \{\s*noteQueuedForReview\(result\)/)
})

test('every surface the plan names is wired, and no other list is tagged', () => {
  const tagged = ['components/products/Products.tsx', 'components/fees/FeesPage.tsx', 'components/branches/Branches.tsx', 'components/inventory/InventoryProductsSurface.tsx', 'components/shared/StockReasonsManagerModal.tsx']
  for (const file of tagged) assert.match(read(file), /PendingReviewTag/, `${file} draws the tag`)
  // Sales, returns, contacts and stock sessions never queue (plan 2.1), so nothing there draws a tag.
  for (const file of ['components/sales/Sales.tsx', 'components/returns/Returns.tsx', 'components/contacts/Contacts.tsx', 'components/review/ReviewQueue.tsx']) {
    if (fs.existsSync(new URL(`../src/${file}`, import.meta.url))) assert.doesNotMatch(read(file), /PendingReviewTag/, `${file} must not draw the tag`)
  }
})

// ---- negative controls ----
const tagSource = read('components/shared/PendingReviewTag.tsx')
function mutate(source: string, from: string, to: string): string {
  assert.equal(source.split(from).length - 1, 1, `negative control anchor must match the live source exactly once: ${from}`)
  return source.replace(from, to)
}

test('MUTANT tag placed in the layout flow: the contract rejects it', async () => {
  await waiting(open('products', 'product', 7))
  const inFlow = mutate(tagSource, "'pointer-events-none absolute h-2.5 w-2.5", "'pointer-events-none relative h-2.5 w-2.5")
  assert.throws(() => assertOutOfFlow(tagMarkup(tagModule(inFlow)), 'mutant'), /absolutely positioned|puts the tag back in the flow/)
  const dropped = mutate(tagSource, "'pointer-events-none absolute h-2.5 w-2.5", "'pointer-events-none h-2.5 w-2.5")
  assert.throws(() => assertOutOfFlow(tagMarkup(tagModule(dropped)), 'mutant'), /absolutely positioned/)
  const blocksTaps = mutate(tagSource, "'pointer-events-none absolute h-2.5", "'absolute h-2.5")
  assert.throws(() => assertOutOfFlow(tagMarkup(tagModule(blocksTaps)), 'mutant'), /must not take taps/)
  // And the live component passes the same check.
  assertOutOfFlow(tagMarkup(tagModule()), 'live')
})

test('MUTANT a caller that gives the tag room: the surface check rejects an in-flow offset', async () => {
  await waiting(open('products', 'product', 2))
  const spaced = mutate(surfaceSource, 'className="left-px top-1"', 'className="mr-2 inline-block"')
  const html = renderSurface(loadSurface(spaced))
  assert.throws(() => assertOutOfFlow((html.match(TAG) || [''])[0], 'mutant surface'), /box of its own|puts the tag back|offset/)
  const live = (renderSurface(loadSurface()).match(TAG) || [''])[0]
  assertOutOfFlow(live, 'live surface')
})

test('MUTANT the tag changes the row\'s markup: the byte-identity check rejects extra wrapper or classes', async () => {
  await nothingWaiting()
  const without = renderSurface(loadSurface())
  await waiting(open('products', 'product', 2))
  const wrapped = mutate(tagSource, '  return waiting ? <PendingReviewGlyph className={className} /> : null', '  return waiting ? <div className="flex"><PendingReviewGlyph className={className} /></div> : null')
  const html = renderSurface(loadSurface(surfaceSource, wrapped))
  assert.notEqual(html.replace(TAG, ''), without, 'a wrapper element around the tag leaves a trace in the row')
})

test.after(() => {
  globalThis.fetch = realFetch
  setSyncServerUrl('')
  __resetApiWriteDedupeForTests()
})
