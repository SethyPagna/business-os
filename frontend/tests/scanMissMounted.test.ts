// The REAL POS, Products and image-only Products pages, mounted with transport doubles (lane 6.0.940).
//
// An empty list after a SCAN (camera or gun) says why: no product has that barcode, or the filters hide it.
// Typed text keeps the plain empty state. A scan still never adds, opens or picks anything, so the only things
// a miss can add are words, a Create button on Products (for accounts that may create) and a Clear button for
// "hidden by the filters". The index, not the filtered page, tells the two apart; where the page has no index
// (this account has none) and a filter is on, neither claim is made.
//
// Run: node tests/scanMissMounted.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, MemoryNode, propsOf, type Harness, type MountedSurface } from './mountedComponentHarness.ts'

const EN = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const USER = { id: 7, organization_id: 1, name: 'Owner', role_code: 'admin', permissions: { all: true }, role_permissions: { all: true } }
const DIOR = '3348901729222'
const HIDDEN = '4005900000011'
const MISSING = '9990001112223'
const noMatch = (code: string): string => EN.scan_no_match.replace('{code}', code)

type Row = ReturnType<typeof row>
const row = (id: number, name: string, barcode: string, category: string) => ({
  id, name, barcode, category, unit: 'pcs', selling_price_usd: 5, selling_price_khr: 20500, applied_price_usd: 5, applied_price_khr: 20500,
  stock: 4, stock_quantity: 4, is_active: 1, status: 'active', brand: 'Acme',
  created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00', images: [], batches: [], batch_count: 0,
  branch_stock: [{ branch_id: 1, branch_name: 'LC Store', quantity: 4 }],
})
// Three listed products and one in another category: HIDDEN is in the catalog (and its search index) but a
// Perfume filter keeps it off the page, which is what "hidden by the filters" means.
const CATALOG: Row[] = [
  row(21, 'Dior Sauvage', '3348901729000', 'Perfume'),
  row(22, 'Dior Sauvage', DIOR, 'Perfume'),
  row(23, 'Chanel Coco', '3145891264003', 'Perfume'),
  row(31, 'Hidden Serum', HIDDEN, 'Serum'),
]

// What the Worker does with the params the pages send: the ranked ids (or the text), narrowed by the category filter.
function answer(query: Record<string, unknown>) {
  const ranked = String(query.rankIds || '').split(',').filter(Boolean).map(Number)
  const text = String(query.query || query.q || '').toLowerCase()
  const category = String(query.category || '')
  const items = CATALOG.filter((item) => (!category || item.category === category)
    && (ranked.length ? ranked.includes(item.id) : (!text || item.barcode.includes(text) || item.name.toLowerCase().includes(text))))
  return { items, total: items.length, page: 1, pageSize: 50, totalPages: 1, promotion_rules: [], branches: [{ id: 1, name: 'LC Store', is_default: true, is_active: 1 }] }
}

const browser = globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage; matchMedia: (query: string) => unknown } }
let indexAvailable = true
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
// createHarness installs a fetch that refuses everything, so this goes in after every harness is created.
const installFetch = (): void => {
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/sales/money-precision-capability')) return json({ money_precision_version: 1, schema_ready: true, historical_edit_ready: true })
    if (url.includes('/api/products/search-index')) {
      if (!indexAvailable) return json({ error: 'You do not have permission to view the product catalog' }, 403)
      return json({ format: 1, page: 0, buckets: [0], pageIds: 2000, hash: 'scan-miss-fixture', rows: CATALOG.map((item) => [item.id, item.name, item.brand, item.category, item.barcode, '']) })
    }
    return json([])
  }
}

// Every string the page writes into the document, so a notice that is on screen for a single render still shows up here.
const written: string[] = []
const nodeValue = Object.getOwnPropertyDescriptor(MemoryNode.prototype, 'nodeValue') as PropertyDescriptor
Object.defineProperty(MemoryNode.prototype, 'nodeValue', { ...nodeValue, set(this: MemoryNode, value: string) { written.push(String(value)); nodeValue.set?.call(this, value) } })

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
    for (const key of ['pos_search', 'pos_cat', 'bos:dashboard:products-focus']) browser.window.sessionStorage.removeItem(key)
  }
}

const app = (can: (page: string, action?: string) => boolean = () => true) => ({
  t: (key: string) => EN[key] ?? key, notify: () => {}, user: USER, authReady: true, settings: {}, language: 'en',
  fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, usdSymbol: '$', khrSymbol: 'R', exchangeRate: 4100,
  can, hasPermission: () => true, getPermissionTier: () => 'all', canWriteToServer: true, navigateTo: () => {},
})

async function mountTill(): Promise<MountedSurface> {
  const page = await currentHarness.mount({
    component: '../tests/posSyncHost.tsx',
    app: { ...app(), page: 'pos' },
    doubles: {
      'api/productReadTransport.ts': {
        getProductBootstrap: async (query: Record<string, unknown>) => answer(query),
        searchProducts: async (query: Record<string, unknown>) => answer(query),
        getProductFilters: async () => ({ brands: [], suppliers: [], initials: [] }),
      },
      'api/batchesTransport.ts': { getTrackedBatchProductIds: async () => ({ productIds: [] }), getProductBatches: async () => ({ batches: [] }) },
      'api/lookupTransport.ts': { getCategories: async () => [] },
      'api/contactReadTransport.ts': { getSalesCustomerPicker: async () => [], getDeliveryContacts: async () => [], invalidateCustomerReadCache: () => {}, lookupCustomerMembership: async () => null },
      'api/salesTransport.ts': { createSale: async () => ({ success: true }) },
    },
  })
  mounted.push(page)
  return page
}

async function mountProducts(can?: (page: string, action?: string) => boolean): Promise<MountedSurface> {
  const page = await currentHarness.mount({
    component: '../tests/productsSyncHost.tsx',
    app: { ...app(can), page: 'products' },
    doubles: {
      'api/productReadTransport.ts': {
        searchProducts: async (query: Record<string, unknown>) => answer(query),
        getProductFilters: async () => ({ brands: [], categories: [], suppliers: [], initials: [] }),
      },
      'api/productWriteTransport.ts': { getPossiblySameProducts: async () => ({ clusters: [] }) },
      'api/damagedLotsTransport.ts': { getTaggedLots: async () => ({ items: [] }) },
    },
  })
  mounted.push(page)
  return page
}

async function mountImageOnly(grants: string[] = []): Promise<MountedSurface> {
  const page = await currentHarness.mount({
    component: 'components/products/ProductsImageOnlyView.tsx',
    app: { ...app(), hasPermission: (key: string) => grants.includes(key), user: { id: 9, username: 'image-only', role_code: 'products_image_only' } },
    doubles: { 'api/productReadTransport.ts': { searchProducts: async (query: Record<string, unknown>) => answer({ ...query, query: query.q }) } },
  })
  mounted.push(page)
  return page
}

// The scan button's component props are not on the DOM node: walk up its fiber.
function onDetectedOf(page: MountedSurface): (code: string) => void {
  const button = page.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === EN.scan_barcode)[0]
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
const searchBox = (page: MountedSurface): MemoryNode => page.find((node) => node.tagName === 'INPUT' && (node.getAttribute('placeholder') ?? '').startsWith(EN.search), 'search box')
const typeIn = async (page: MountedSurface, text: string): Promise<void> => { await page.type(searchBox(page), text); await page.settle() }
const notices = (page: MountedSurface): MemoryNode[] => page.findAll((node) => node.getAttribute('data-scan-miss') !== null)
const kindOf = (page: MountedSurface): string[] => [...new Set(notices(page).map((node) => node.getAttribute('data-scan-miss') as string))]
const buttonNamed = (page: MountedSurface, label: string): MemoryNode[] => page.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === label)
const waitText = (page: MountedSurface, text: string): Promise<void> => page.waitFor(() => page.text().includes(text), `"${text}"`)
const marked = (page: MountedSurface): MemoryNode[] => page.findAll((node) => node.getAttribute('data-scan-hit') === 'true')

const TILL_GENERIC = 'No products match your filters'
let currentHarness: Harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })
installFetch()

try {
  // ---------------------------------------------------------------- POS
  await check('POS: a scanned code no product has says so, with the code, and offers nothing to create', async () => {
    const till = await mountTill()
    await scan(till, MISSING)
    await waitText(till, noMatch(MISSING))
    assert.deepEqual(kindOf(till), ['no_match'])
    assert.ok(!till.text().includes(TILL_GENERIC), 'the generic empty state is replaced, not repeated')
    assert.equal(buttonNamed(till, EN.scan_create_with_barcode).length, 0, 'the till only shows the message')
    assert.equal(buttonNamed(till, EN.clear_filters).length, 0, 'nothing is hidden, so nothing to clear')
    assert.equal(browser.window.sessionStorage.getItem('pos_search'), MISSING, 'the scan is still just a search')
  })

  await check('POS: a typed query that finds nothing keeps today\'s empty state', async () => {
    const till = await mountTill()
    await typeIn(till, MISSING)
    await waitText(till, TILL_GENERIC)
    assert.deepEqual(kindOf(till), [], 'typed text is never a scan miss')
    assert.ok(!till.text().includes('No product has barcode'))
  })

  await check('POS: editing a scanned code ends the scan, and typing the same digits again is typing', async () => {
    const till = await mountTill()
    await scan(till, MISSING)
    await waitText(till, noMatch(MISSING))
    await typeIn(till, `${MISSING}1`)
    await waitText(till, TILL_GENERIC)
    assert.deepEqual(kindOf(till), [])
    await typeIn(till, MISSING)
    await waitText(till, TILL_GENERIC)
    assert.deepEqual(kindOf(till), [], 'the same digits typed by hand are a typed query')
  })

  await check('POS: a scan that finds its product shows the product, never a miss', async () => {
    const till = await mountTill()
    await scan(till, DIOR)
    await till.waitFor(() => marked(till).length === 1, 'the exact card to be marked')
    assert.deepEqual(kindOf(till), [])
    assert.ok(till.text().includes('Dior Sauvage'))
  })

  await check('POS: scanning a product after a miss never flashes "no such barcode" for the new code on the way to its card', async () => {
    const till = await mountTill()
    await scan(till, MISSING)
    await waitText(till, noMatch(MISSING))
    written.length = 0
    await scan(till, DIOR)
    await till.waitFor(() => marked(till).length === 1, 'the exact card to be marked')
    assert.ok(written.length > 0, 'the probe saw the page write')
    assert.equal(written.filter((text) => text.includes(DIOR) && text.includes('No product has barcode')).length, 0, 'the page never claimed the barcode it was about to show')
    assert.equal(written.filter((text) => text.includes(EN.scan_hidden_by_filters)).length, 0)
  })

  await check('POS: a barcode the filters hide says so, Clear keeps the scanned code, and the product then shows', async () => {
    browser.window.sessionStorage.setItem('pos_cat', 'Perfume')
    const till = await mountTill()
    await scan(till, HIDDEN)
    await waitText(till, EN.scan_hidden_by_filters)
    assert.deepEqual(kindOf(till), ['hidden_by_filters'])
    assert.ok(!till.text().includes('No product has barcode'), 'the product exists: not a miss')
    assert.equal(buttonNamed(till, EN.scan_create_with_barcode).length, 0)
    await till.click(buttonNamed(till, EN.clear_filters)[0])
    await waitText(till, 'Hidden Serum')
    assert.equal(browser.window.sessionStorage.getItem('pos_cat'), null, 'the filter is cleared')
    assert.equal(browser.window.sessionStorage.getItem('pos_search'), HIDDEN, 'the scanned code stays in the search box')
    await till.waitFor(() => marked(till).length === 1, 'the revealed product to be the exact hit')
    assert.deepEqual(kindOf(till), [])
  })

  await check('POS: a barcode nobody has stays a miss even while a filter is on', async () => {
    browser.window.sessionStorage.setItem('pos_cat', 'Perfume')
    const till = await mountTill()
    await scan(till, MISSING)
    await waitText(till, noMatch(MISSING))
    assert.deepEqual(kindOf(till), ['no_match'])
  })

  // ---------------------------------------------------------------- Products
  await check('Products: a scanned code no product has says so and offers Create; typed text keeps the plain empty state', async () => {
    const page = await mountProducts()
    await typeIn(page, MISSING)
    assert.deepEqual(kindOf(page), [], 'typed text is never a scan miss')
    assert.ok(page.text().includes(EN.no_data))
    await scan(page, MISSING)
    await waitText(page, noMatch(MISSING))
    assert.deepEqual(kindOf(page), ['no_match'])
    assert.ok(!page.text().includes(EN.no_data), 'the plain empty state is replaced')
    assert.ok(buttonNamed(page, EN.scan_create_with_barcode).length > 0, 'an account that may create products is offered Create')
    assert.ok(buttonNamed(page, EN.scan_create_with_barcode)[0].textContent.includes(EN.create), 'icon plus the one word')
    assert.equal(buttonNamed(page, EN.clear_filters).length, 0)
  })

  await check('Products: Create opens the product form with the scanned barcode filled in, and nothing is saved', async () => {
    const page = await mountProducts()
    await scan(page, MISSING)
    await waitText(page, noMatch(MISSING))
    await page.click(buttonNamed(page, EN.scan_create_with_barcode)[0])
    const field = page.field('product-barcode')
    assert.equal(propsOf(field).value, MISSING, 'the form opens with the barcode prefilled')
    assert.equal(propsOf(page.field('product-name')).value, '', 'only the barcode is prefilled')
  })

  await check('Products: no Create without the permission to create products, the message stays', async () => {
    const page = await mountProducts((area, action) => !(area === 'products' && action === 'add'))
    await scan(page, MISSING)
    await waitText(page, noMatch(MISSING))
    assert.deepEqual(kindOf(page), ['no_match'])
    assert.equal(buttonNamed(page, EN.scan_create_with_barcode).length, 0)
  })

  await check('Products: a scan that finds its product shows it, never a miss', async () => {
    const page = await mountProducts()
    await scan(page, DIOR)
    await page.waitFor(() => marked(page).length > 0, 'the exact row to be marked')
    assert.deepEqual(kindOf(page), [])
  })

  await check('Products: scanning a product after a miss never flashes "no such barcode" for the new code on the way to its row', async () => {
    const page = await mountProducts()
    await scan(page, MISSING)
    await waitText(page, noMatch(MISSING))
    written.length = 0
    await scan(page, DIOR)
    await page.waitFor(() => marked(page).length > 0, 'the exact row to be marked')
    assert.ok(written.length > 0, 'the probe saw the page write')
    assert.equal(written.filter((text) => text.includes(DIOR) && text.includes('No product has barcode')).length, 0, 'the page never claimed the barcode it was about to show')
    assert.equal(written.filter((text) => text.includes(EN.scan_hidden_by_filters)).length, 0)
  })

  await check('Products: a barcode the filters hide says so, Clear filters keeps the scanned code, and the product then shows', async () => {
    browser.window.sessionStorage.setItem('bos:dashboard:products-focus', JSON.stringify({ category: 'Perfume' }))
    const page = await mountProducts()
    await scan(page, HIDDEN)
    await waitText(page, EN.scan_hidden_by_filters)
    assert.deepEqual(kindOf(page), ['hidden_by_filters'])
    assert.equal(buttonNamed(page, EN.scan_create_with_barcode).length, 0, 'it exists, so there is nothing to create')
    await page.click(buttonNamed(page, EN.clear_filters)[0])
    await waitText(page, 'Hidden Serum')
    assert.equal(propsOf(searchBox(page)).value, HIDDEN, 'the scanned code stays in the search box')
    assert.deepEqual(kindOf(page), [])
  })

  // ---------------------------------------------------------------- image-only Products
  await check('Image-only Products: a scanned code no product has says so with no Create; typed text keeps the plain empty state', async () => {
    const page = await mountImageOnly()
    await page.type(searchBox(page), MISSING)
    await page.settle()
    assert.ok(page.text().includes(EN.no_data))
    assert.deepEqual(kindOf(page), [])
    await scan(page, MISSING)
    await waitText(page, noMatch(MISSING))
    assert.deepEqual(kindOf(page), ['no_match'])
    assert.equal(buttonNamed(page, EN.scan_create_with_barcode).length, 0, 'the role cannot create products')
  })

  await check('Image-only Products: with a granted filter on, an empty scan is not called a miss (this role has no index to tell)', async () => {
    const page = await mountImageOnly(['products_image_only_show_stock'])
    const control = (label: string): MemoryNode => page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === label, `control ${label}`)
    const choose = async (label: string, option: string): Promise<void> => {
      await page.click(control(label))
      await page.click(page.find((node) => node.getAttribute('role') === 'option' && node.textContent.trim() === option, `option ${option}`))
    }
    await choose(EN.stock_status, EN.low_stock)
    await scan(page, MISSING)
    await page.settle()
    assert.deepEqual(kindOf(page), [], 'a filter may be hiding it: neither claim')
    assert.ok(page.text().includes(EN.no_data))
    await choose(EN.stock_status, EN.all)
    await scan(page, `${MISSING}1`)
    await waitText(page, noMatch(`${MISSING}1`))
    assert.deepEqual(kindOf(page), ['no_match'], 'with the filter off an empty answer is a miss')
  })

  // ---------------------------------------------------------------- an account with no search index
  await currentHarness.close()
  indexAvailable = false
  currentHarness = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })
  installFetch()

  await check('POS without an index: with a filter on a hidden barcode is neither claimed hidden nor missing; with none on it is a miss', async () => {
    browser.window.sessionStorage.setItem('pos_cat', 'Perfume')
    const filtered = await mountTill()
    await scan(filtered, HIDDEN)
    await waitText(filtered, TILL_GENERIC)
    assert.deepEqual(kindOf(filtered), [], 'the page cannot tell, so it keeps its generic state (which offers Clear)')
    await filtered.unmount()
    mounted.splice(0)
    browser.window.sessionStorage.removeItem('pos_cat')
    const open = await mountTill()
    await scan(open, MISSING)
    await waitText(open, noMatch(MISSING))
    assert.deepEqual(kindOf(open), ['no_match'], 'with no filter on, an empty answer is a miss without any index')
  })

  await check('Products without an index: the same, and Create is still offered on a true miss', async () => {
    browser.window.sessionStorage.setItem('bos:dashboard:products-focus', JSON.stringify({ category: 'Perfume' }))
    const filtered = await mountProducts()
    await scan(filtered, HIDDEN)
    await filtered.settle()
    assert.deepEqual(kindOf(filtered), [])
    assert.ok(filtered.text().includes(EN.no_data))
    await filtered.unmount()
    mounted.splice(0)
    const open = await mountProducts()
    await scan(open, MISSING)
    await waitText(open, noMatch(MISSING))
    assert.deepEqual(kindOf(open), ['no_match'])
    assert.ok(buttonNamed(open, EN.scan_create_with_barcode).length > 0)
  })
} finally {
  await currentHarness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nscanMissMounted: all checks passed')
