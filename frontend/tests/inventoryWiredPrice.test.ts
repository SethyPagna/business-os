import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'
import { wiredResult, type WiredRaw } from '../src/components/inventory/inventoryWired.ts'
import { priceFacts } from '../src/components/inventory/inventoryPriceFacts.ts'

// D1 wave 2 (11 Nov, lane d1-inventory). Owner: "the inventory page itself only needs to wire the image, name, count, price details, batch, etc."
// The wired list already carries the price fields of every Products row (and the promotion rules of the answer); the page used to drop them. They are shown now, with no extra read:
//   1. pure: priceFacts shows selling and wholesale as stored and the promotion price only while the POS evaluator says one applies right now (live, expired, not yet started, rule, none)
//   2. pure: the wired rows keep the price fields they carry, and keep none they do not (the server cut them without the price grant)
//   3. mounted page: with the grant the three prices are on the row, in English and Khmer labels; without it nothing, even when the shared Products store holds rows WITH prices; cost never
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

// ---- 1. priceFacts ----
const NOW = new Date('2026-11-11T05:00:00Z')
const rule = (extra: Record<string, unknown> = {}) => ({ id: 5, title: 'Ten off', show_title: true, rule_type: 'percent_off', min_quantity: 1, save_usd: 0, save_khr: 0, percent_off: 10, scope_type: 'products', min_spend_usd: 0, min_spend_khr: 0,
  label_style: 'save', product_ids: [12], category: '', brand: '', badge_color: '#e11d48', starts_at: null, ends_at: null, is_active: true, ...extra }) as never
const product = (extra: Record<string, unknown> = {}) => ({ id: 12, name: 'Priced', selling_price_usd: 10, selling_price_khr: 41000, wholesale_price_usd: 8, wholesale_price_khr: 0, ...extra });
{
  const plain = priceFacts(product(), [], 4100, NOW)
  assert.deepEqual(plain.selling, { usd: 10, khr: 41000 }); assert.deepEqual(plain.wholesale, { usd: 8, khr: null }, 'a wholesale price with no riel figure has none to show')
  assert.equal(plain.promotion, null, 'no discount, no rule: no promotion price')
  assert.equal(priceFacts(product({ wholesale_price_usd: 0 }), [], 4100, NOW).wholesale, null, 'an unset wholesale price (0) is not shown')
  assert.deepEqual(priceFacts({ id: 12, name: 'No grant' }, [rule()], 4100, NOW), { selling: null, wholesale: null, promotion: null }, 'a row without price fields (no grant) has no facts, whatever the rules say')
  const live = priceFacts(product({ discount_enabled: 1, discount_type: 'percent', discount_percent: 20 }), [], 4100, NOW)
  assert.equal(live.promotion?.usd, 8, 'a live product discount of 20% on $10')
  const expired = priceFacts(product({ discount_enabled: 1, discount_type: 'percent', discount_percent: 20, discount_ends_at: '2026-11-01T00:00:00Z' }), [], 4100, NOW)
  assert.equal(expired.promotion, null, 'an expired product discount is NOT applied (the POS would not charge it)')
  const later = priceFacts(product({ discount_enabled: 1, discount_type: 'percent', discount_percent: 20, discount_starts_at: '2026-12-01T00:00:00Z' }), [], 4100, NOW)
  assert.equal(later.promotion, null, 'a discount that has not started is not applied')
  assert.equal(priceFacts(product(), [rule()], 4100, NOW).promotion?.usd, 9, 'a live rule for this product: 10% off $10')
  assert.equal(priceFacts(product(), [rule({ ends_at: '2026-11-01T00:00:00Z' })], 4100, NOW).promotion, null, 'an expired rule is not applied')
  assert.equal(priceFacts(product(), [rule({ product_ids: [99] })], 4100, NOW).promotion, null, 'a rule for another product is not applied')
  const best = priceFacts(product({ discount_enabled: 1, discount_type: 'percent', discount_percent: 20 }), [rule()], 4100, NOW)
  assert.equal(best.promotion?.usd, 8, 'the single best benefit applies, never stacked (the POS rule)')
}

// ---- 2. the wired rows keep what they carry ----
const rawOf = (items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): WiredRaw => ({
  list: { items, total: items.length, page: 1, pageSize: 20, ...extra } as never, overlay: new Map(), lots: new Map(), branches: [{ id: 1, name: 'Only branch' }], branchId: 1, extras: {},
})
{
  const priced = { id: 12, name: 'Priced', branch_stock: [{ branch_id: 1, quantity: 4 }], selling_price_usd: 10, selling_price_khr: 41000, wholesale_price_usd: 8, wholesale_price_khr: 0, discount_enabled: 1, discount_type: 'percent', discount_percent: 20, cost_price_usd: 3 }
  const cut = { id: 13, name: 'Cut', branch_stock: [{ branch_id: 1, quantity: 2 }] }
  const result = wiredResult(rawOf([priced, cut], { promotion_rules: [rule()] }))
  const [a, b] = result.items as unknown as Array<Record<string, unknown>>
  assert.equal(a.selling_price_usd, 10); assert.equal(a.wholesale_price_usd, 8); assert.equal(a.discount_percent, 20); assert.equal(a.discount_enabled, 1)
  assert.equal(Object.hasOwn(a, 'cost_price_usd'), false, 'cost is never carried onto an Inventory row (the owner has not decided; today nobody sees it)')
  assert.equal(Object.keys(b).some(key => key.includes('price') || key.startsWith('discount')), false, 'a row the server cut has no price field')
  assert.equal(result.promotionRules.length, 1, 'the answer\'s promotion rules ride along'); assert.deepEqual(wiredResult(rawOf([cut])).promotionRules, [], 'none when the answer has none')
}

// ---- 3. the mounted page ----
const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'] })
const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
const entries: string[] = []
let entryIndex = 0
const applyLocation = (url: string) => { const next = new URL(url, 'https://admin.example.test/'); Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash }) }
const open = (hash: string) => { entries.splice(0, entries.length, `https://admin.example.test/inventory#${hash}`); entryIndex = 0; applyLocation(entries[0]) }
window.history.pushState = (_state, _unused, url) => { entries.splice(entryIndex + 1); entries.push(new URL(String(url), 'https://admin.example.test/').href); entryIndex += 1; applyLocation(entries[entryIndex]) }
window.history.replaceState = (_state, _unused, url) => { entries[entryIndex] = new URL(String(url), 'https://admin.example.test/').href; applyLocation(entries[entryIndex]) }

const FIELDS = { inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true }
const pricedRow = { id: 12, name: 'Priced product', unit: 'pcs', stock_quantity: 4, branch_stock: [{ branch_id: 1, branch_name: 'Only branch', quantity: 4 }],
  selling_price_usd: 10, selling_price_khr: 41000, wholesale_price_usd: 8, wholesale_price_khr: 0, discount_enabled: 1, discount_type: 'percent', discount_percent: 20, cost_price_usd: 3.21, cost_price_khr: 13161 }
const listBody = (rows: Array<Record<string, unknown>>, withPrices: boolean) => ({ items: rows.map(row => withPrices ? row : Object.fromEntries(Object.entries(row).filter(([key]) => !key.includes('price') && !key.startsWith('discount')))),
  total: rows.length, page: 1, pageSize: 20, totalPages: 1, wired: true, projected: true, summary: { ok: 0, issue: 0, not_checked: rows.length, total: rows.length }, ...(withPrices ? { promotion_rules: [] } : {}) })
let served: ReturnType<typeof listBody> = listBody([pricedRow], true)
const held = new Map<string, unknown>()
const lists: URLSearchParams[] = []
const doubles = {
  'utils/dirtyWork.ts': dirtyWork,
  'api/actorReadScope.ts': {
    captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: '1' }), captureActorWriteIdentity: () => ({ owner: 'test', epoch: 1 }),
    isActorReadScopeCurrent: () => true, isActorWriteIdentityCurrent: () => true,
  },
  'api/productReadTransport.ts': { peekProductSearch: (query: string) => held.get(query) ?? null, primeProductSearch: (query: string, payload: unknown) => { held.set(query, payload) }, getProductFilters: async () => ({ brands: [], categories: [] }) },
  'api/inventoryChecksTransport.ts': {
    captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
    readInventoryCheckList: async (params: QueryParams) => { lists.push(new URL(appendQuery('/api/inventory-checks/list', buildQueryString(params)), 'https://admin.example.test').searchParams); return served },
    readInventoryCheckOverlay: async (params: { branchId: number | string; ids: Array<number | string> }) => ({ wired: true, branchId: Number(params.branchId), items: params.ids.map(id => ({ product_id: Number(id), last_change_at: null })) }),
    readInventoryCheckProducts: async () => { throw new Error('the older list must not be asked while ic_wired is on') },
    readInventoryCheckSessions: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }), readInventoryCheckSession: async () => ({ item: null, items: [] }), readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  },
}
const app = (permissions: Record<string, boolean>, pack: Record<string, string>) => ({
  user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...permissions } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => pack[key] ?? key, notify: () => {}, settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
  exchangeRate: 4100, formatPrice: (usd: unknown) => `$${Number(usd).toFixed(2)}`,
  navigateTo: (page: string, anchor?: string) => { window.history.pushState(null, '', `/inventory#${anchor || ''}`); window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/inventory', anchor } })) },
})
async function mount(permissions: Record<string, boolean>, pack: Record<string, string> = en) {
  lists.length = 0
  open('hub:inventory:products')
  return harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app: app(permissions, pack), doubles, props: {} })
}
const rowText = (surface: Awaited<ReturnType<typeof mount>>) => surface.find(node => node.getAttribute('data-inventory-check-row') === '12', 'row 12').textContent.replace(/\s+/g, ' ')
const priceNodes = (surface: Awaited<ReturnType<typeof mount>>) => surface.findAll(node => node.getAttribute('data-price') !== null)

try {
  // with the grant: selling, wholesale and the live promotion price, labelled inside the row, one list request
  {
    served = listBody([pricedRow], true)
    const surface = await mount({ ...FIELDS, inventory_check_show_price: true })
    const text = rowText(surface)
    assert.ok(text.includes(`${en.selling_price} $10.00`), `selling price on the row: ${text}`)
    assert.ok(text.includes(`${en.wholesale_price} $8.00`), 'wholesale price on the row')
    assert.ok(text.includes(`${en.promotion} $8.00`), 'the live product discount (20% off $10) as the promotion price')
    assert.deepEqual(priceNodes(surface).map(node => node.getAttribute('data-price')), ['selling', 'wholesale', 'promotion'])
    assert.ok(!text.includes('3.21') && !text.includes('13161'), 'cost is on the Products row but never on an Inventory row')
    assert.equal(lists.length, 1, 'the prices cost no extra read')
    await surface.unmount()
  }
  // Khmer labels come from the same keys (the pack has all three)
  {
    for (const key of ['selling_price', 'wholesale_price', 'promotion']) assert.ok(km[key] && km[key] !== en[key], `km has ${key}`)
    const surface = await mount({ ...FIELDS, inventory_check_show_price: true }, km)
    const text = rowText(surface)
    assert.ok(text.includes(km.selling_price) && text.includes(km.wholesale_price) && text.includes(km.promotion), 'the three labels in Khmer')
    await surface.unmount()
  }
  // an expired promotion is not shown as one
  {
    served = listBody([{ ...pricedRow, discount_ends_at: '2020-01-01T00:00:00Z' }], true)
    const surface = await mount({ ...FIELDS, inventory_check_show_price: true })
    assert.deepEqual(priceNodes(surface).map(node => node.getAttribute('data-price')), ['selling', 'wholesale'], 'an expired discount draws no promotion')
    await surface.unmount()
  }
  // without the grant: the server cut the fields, so there is nothing to show
  {
    served = listBody([pricedRow], false)
    const surface = await mount({ ...FIELDS, inventory_check_show_price: false })
    assert.ok(surface.text().includes('Priced product'))
    assert.equal(priceNodes(surface).length, 0, 'no price on a row of a viewer without the price grant')
    await surface.unmount()
  }
  // without the grant AND with Products' own rows (prices included) held in the shared store: still nothing reaches the screen
  {
    served = listBody([pricedRow], false)
    held.clear(); held.set('page=1&pageSize=20&searchMode=AND&sort=name_asc&include=branch_stock%2Cimages%2Cbatches%2Ctagged_lots', { items: [pricedRow], total: 1, page: 1, pageSize: 20, totalPages: 1, promotion_rules: [] })
    const surface = await mount({ ...FIELDS, inventory_check_show_price: false })
    held.set('page=1&pageSize=20&searchMode=AND&sort=name_asc&include=branch_stock%2Cimages%2Cbatches%2Ctagged_lots', { items: [pricedRow], total: 1, page: 1, pageSize: 20, totalPages: 1, promotion_rules: [] })
    assert.ok(surface.text().includes('Priced product'), 'the row is drawn')
    assert.equal(priceNodes(surface).length, 0, 'the price grant, not the store, decides what is drawn')
    assert.ok(!surface.text().includes('$10.00') && !surface.text().includes('$8.00') && !surface.text().includes('3.21'), 'no figure of the held row reaches the screen')
    await surface.unmount()
    held.clear()
  }
  console.log('inventoryWiredPrice passed: price facts (live / expired / future / rule / none), rows keep only what they carry, mounted page shows prices only with the grant, never cost, en and km')
} finally {
  await harness.close()
}
