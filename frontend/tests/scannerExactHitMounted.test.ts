// The REAL POS and Products pages, mounted with transport doubles (lane S4).
//
// A barcode that reaches the search box from the camera or the gun must: be saved
// like typed text, narrow the list, single out the ONE child row whose barcode is
// exactly it (a longer GTIN that merely contains it is not), open the name group
// that holds it on Products, and never add, open or pick anything. The gun's own
// key handling is proved in the real browser (scannerWedgeBrowser.test.ts); this
// file proves what the pages do with the code once they have it.
import assert from 'node:assert/strict'
import { act } from 'react'
import { createHarness, MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const USER = { id: 7, organization_id: 1, name: 'Owner', role_code: 'admin', permissions: { all: true }, role_permissions: { all: true } }
const DIOR = '3348901729222'

const row = (id: number, name: string, barcode: string) => ({
  id, name, barcode, unit: 'pcs', selling_price_usd: 5, selling_price_khr: 20500, applied_price_usd: 5, applied_price_khr: 20500,
  stock: 4, stock_quantity: 4, is_active: 1, status: 'active', category: 'Care', brand: 'Acme',
  created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00', images: [], batches: [], batch_count: 0,
  branch_stock: [{ branch_id: 1, branch_name: 'LC Store', quantity: 4 }],
})
// One name group with two child rows, a flat product, and the trap: a longer GTIN
// that CONTAINS the scanned code and is therefore returned by a text search.
const CATALOG = [
  row(21, 'Dior Sauvage', '3348901729000'),
  row(22, 'Dior Sauvage', DIOR),
  row(23, 'Chanel Coco', '3145891264003'),
  row(24, 'Chanel Coco Mini', `1${DIOR}`),
]
const TWIN_CATALOG = [...CATALOG.slice(0, 2), row(25, 'Dior Sauvage Travel', DIOR)]

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })
const browser = globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage; matchMedia: (query: string) => unknown } }
;(globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
  if (String(input).includes('/api/sales/money-precision-capability')) {
    return new Response(JSON.stringify({ money_precision_version: 1, schema_ready: true, historical_edit_ready: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
}

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run() ; console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
    browser.window.sessionStorage.removeItem('pos_search')
  }
}

// The scan button's component props are not on the DOM node: walk up its fiber.
function onDetectedOf(page: MountedSurface): (code: string) => void {
  const button = page.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'scan_barcode')[0]
  assert.ok(button, 'the page renders the scan button')
  const key = Object.keys(button).find((name) => name.startsWith('__reactFiber$')) as string
  for (let fiber = (button as unknown as Record<string, any>)[key]; fiber; fiber = fiber.return) {
    if (typeof fiber.memoizedProps?.onDetected === 'function') return fiber.memoizedProps.onDetected
  }
  throw new Error('no onDetected above the scan button')
}
const scan = async (page: MountedSurface, code: string): Promise<void> => {
  const onDetected = onDetectedOf(page)
  await act(async () => { onDetected(code) })
  await page.settle()
}
const marked = (page: MountedSurface): MemoryNode[] => page.findAll((node) => node.getAttribute('data-scan-hit') === 'true')
const sawText = (page: MountedSurface, text: string): boolean => page.text().includes(text)

const calls = { pos: { sales: 0 }, searches: [] as Array<Record<string, unknown>> }
const scrolled: MemoryNode[] = []
const originalScrollIntoView = MemoryNode.prototype.scrollIntoView
MemoryNode.prototype.scrollIntoView = function scrollIntoView(this: MemoryNode) { scrolled.push(this) }

function asDesktop(on: boolean): void {
  browser.window.matchMedia = (query: string) => ({ matches: on, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
}

async function mountTill(items: unknown[]) {
  browser.window.sessionStorage.removeItem('pos_search')
  const page = await harness.mount({
    component: '../tests/posSyncHost.tsx',
    app: {
      t: (key: string) => key, notify: () => {}, user: USER, authReady: true, page: 'pos', settings: {}, language: 'en',
      fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, usdSymbol: '$', khrSymbol: 'R', exchangeRate: 4100,
      can: () => true, hasPermission: () => true, getPermissionTier: () => 'all', canWriteToServer: true,
    },
    doubles: {
      'api/productReadTransport.ts': {
        getProductBootstrap: async () => ({ items, total: items.length, page: 1, pageSize: 50, totalPages: 1, promotion_rules: [], branches: [{ id: 1, name: 'LC Store', is_default: true, is_active: 1 }] }),
        searchProducts: async (query: Record<string, unknown>) => { calls.searches.push(query); return { items, total: items.length, page: 1, pageSize: 50, totalPages: 1, promotion_rules: [] } },
        getProductFilters: async () => ({ brands: [], suppliers: [], initials: [] }),
      },
      'api/batchesTransport.ts': { getTrackedBatchProductIds: async () => ({ productIds: [] }), getProductBatches: async () => ({ batches: [] }) },
      'api/lookupTransport.ts': { getCategories: async () => [] },
      'api/contactReadTransport.ts': { getSalesCustomerPicker: async () => [], getDeliveryContacts: async () => [], invalidateCustomerReadCache: () => {}, lookupCustomerMembership: async () => null },
      'api/salesTransport.ts': { createSale: async () => { calls.pos.sales += 1; return { success: true } } },
    },
  })
  mounted.push(page)
  return page
}

async function mountProducts(items: unknown[]) {
  const page = await harness.mount({
    component: '../tests/productsSyncHost.tsx',
    app: {
      t: (key: string) => key, notify: () => {}, user: USER, authReady: true, page: 'products', settings: {}, language: 'en',
      fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, usdSymbol: '$', khrSymbol: 'R', exchangeRate: 4100,
      can: () => true, hasPermission: () => true, getPermissionTier: () => 'all', canWriteToServer: true, navigateTo: () => {},
    },
    doubles: {
      'api/productReadTransport.ts': {
        searchProducts: async () => ({ items, total: items.length, page: 1, pageSize: 50, totalPages: 1, promotion_rules: [] }),
        getProductFilters: async () => ({ brands: [], categories: [], suppliers: [], initials: [] }),
      },
      'api/productWriteTransport.ts': { getPossiblySameProducts: async () => ({ clusters: [] }) },
      'api/damagedLotsTransport.ts': { getTaggedLots: async () => ({ items: [] }) },
    },
  })
  mounted.push(page)
  return page
}

try {
  await check('POS: a scanned code is saved like typed text and rings the one exact child row\'s card', async () => {
    asDesktop(false)
    const till = await mountTill(CATALOG)
    assert.equal(marked(till).length, 0, 'nothing is marked before a search')
    await scan(till, DIOR)
    assert.equal(browser.window.sessionStorage.getItem('pos_search'), DIOR, 'a scan was never saved before: it bypassed the typed handler')
    await till.waitFor(() => marked(till).length === 1, 'the exact card to be marked')
    assert.ok(sawText(till, 'Dior Sauvage'))
    assert.equal(marked(till).length, 1)
    assert.ok(marked(till)[0].textContent.includes('Dior Sauvage') && !marked(till)[0].textContent.includes('Mini'), 'the Dior card, not the longer-GTIN Chanel Mini that also contains the digits')
  })

  await check('POS: nothing is added, opened or sold by a scan', async () => {
    asDesktop(true)
    const till = await mountTill(CATALOG)
    await scan(till, DIOR)
    await till.waitFor(() => marked(till).length === 1, 'the exact card to be marked')
    assert.equal(calls.pos.sales, 0)
    assert.ok(till.text().includes('cart_empty'), 'the cart still shows its empty state: no line was added')
    assert.equal(till.findAll((node) => node.getAttribute('role') === 'dialog').length, 0, 'no detail sheet opened')
    // Control for the probe: a till that really holds a line does not show the empty state.
    await till.unmount()
    mounted.splice(0)
    const line = { ...CATALOG[2], cart_line_id: '23:selling:1:0:D0:1:abcde', quantity: 1, price_mode: 'selling', branch_id: 1 }
    browser.window.localStorage.setItem('businessos_pos_orders_7', JSON.stringify([{ id: 'order-1', name: 'Order 1', cart: [line], money_precision_version: 1 }]))
    try {
      const withLine = await mountTill(CATALOG)
      assert.ok(!withLine.text().includes('cart_empty'), 'the probe sees a cart line when there is one')
    } finally {
      browser.window.localStorage.removeItem('businessos_pos_orders_7')
    }
  })

  await check('POS desktop: the card is scrolled to and focused so Enter is a deliberate confirm; mobile only scrolls', async () => {
    asDesktop(true)
    scrolled.length = 0
    const till = await mountTill(CATALOG)
    await scan(till, DIOR)
    await till.waitFor(() => marked(till).length === 1, 'the exact card to be marked')
    await till.settle()
    const card = marked(till)[0]
    assert.ok(scrolled.includes(card), 'the card was scrolled into view')
    const active = (globalThis as unknown as { document: { activeElement: MemoryNode } }).document.activeElement
    assert.equal(active, card, 'focus moved to the card on desktop')
    await till.unmount()
    mounted.splice(0)
    asDesktop(false)
    scrolled.length = 0
    const phone = await mountTill(CATALOG)
    ;(globalThis as unknown as { document: { body: MemoryNode } }).document.body.focus()
    await scan(phone, DIOR)
    await phone.waitFor(() => marked(phone).length === 1, 'the exact card to be marked')
    await phone.settle()
    assert.ok(scrolled.includes(marked(phone)[0]), 'the card is scrolled to on a phone too')
    assert.notEqual((globalThis as unknown as { document: { activeElement: MemoryNode } }).document.activeElement, marked(phone)[0], 'no focus change on a phone (no keyboard pops up)')
  })

  await check('POS: two rows sharing the barcode single out no card', async () => {
    asDesktop(true)
    scrolled.length = 0
    const till = await mountTill(TWIN_CATALOG)
    await scan(till, DIOR)
    await till.waitFor(() => browser.window.sessionStorage.getItem('pos_search') === DIOR && calls.searches.length > 0, 'the search to settle')
    await till.settle()
    assert.equal(marked(till).length, 0, 'ambiguous: nothing is highlighted')
    assert.deepEqual(scrolled, [], 'and nothing is scrolled to or focused')
  })

  await check('POS: a text search or a prefix of a barcode rings nothing', async () => {
    asDesktop(false)
    const till = await mountTill(CATALOG)
    await scan(till, '33489017')
    await till.settle()
    assert.equal(marked(till).length, 0, 'a prefix is not the barcode')
    await scan(till, 'dior')
    await till.settle()
    assert.equal(marked(till).length, 0, 'a name is not a barcode')
  })

  await check('Products: a scan opens the collapsed name group holding the exact child row and marks it', async () => {
    const page = await mountProducts(CATALOG)
    const hasRow = (id: number): boolean => page.findAll((node) => node.getAttribute('data-product-jump-id') === String(id) && node.getAttribute('data-clickable') === 'true').length > 0
    assert.equal(hasRow(22), false, 'the two-row Dior group starts collapsed, so its child rows do not exist yet')
    assert.equal(hasRow(23), true, 'a flat product is listed')
    await scan(page, DIOR)
    await page.waitFor(() => marked(page).length > 0, 'the exact row to be marked')
    assert.equal(hasRow(22), true, 'the group was opened for the scanned row')
    const ids = [...new Set(marked(page).map((node) => node.getAttribute('data-product-jump-id')))]
    assert.deepEqual(ids, ['22'], 'only the row whose barcode is exactly the scanned one (not 21, not the longer GTIN 24)')
  })

  await check('Products: two rows sharing the barcode single out nothing', async () => {
    const page = await mountProducts([...CATALOG.slice(0, 2), row(25, 'Dior Sauvage Travel', DIOR), CATALOG[2]])
    await scan(page, DIOR)
    await page.settle()
    assert.equal(marked(page).length, 0)
  })
} finally {
  MemoryNode.prototype.scrollIntoView = originalScrollIntoView
  await harness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nscannerExactHitMounted: all checks passed')
