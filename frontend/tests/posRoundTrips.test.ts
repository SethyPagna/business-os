// Request counts of the REAL POS (lane 6.0.878). Stubs sit at the transport layer and the capability fetch, so every
// number below is a request the browser would send. Before: open = 2 products/bootstrap (money version 0 then 1) and
// an eager categories read; one sale = 2 catalog reloads (direct + the sync echo). After: 1, none unless needed, 1.
// products/filters stays eager on purpose: the A-Z rail on the grid is built from its `initials` (bootstrap runs metadata=0).
import assert from 'node:assert/strict'
import { act } from 'react'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const USER = { id: 7, organization_id: 1, name: 'Cashier', role_code: 'admin' }
const product = {
  id: 11, name: 'Synthetic serum', barcode: '111', unit: 'pcs', selling_price_usd: 5, selling_price_khr: 20500, applied_price_usd: 5, applied_price_khr: 20500,
  stock: 20, stock_quantity: 20, branch_stock: [{ branch_id: 1, branch_name: 'LC Store', quantity: 20 }], is_active: 1, status: 'active', category: 'Care',
}
const cartLine = { ...product, cart_line_id: '11:selling:1:0:D0:1:abcde', quantity: 1, price_mode: 'selling', branch_id: 1 }
const recordedLine = {
  id: 70, sale_id: 17, product_id: 11, quantity: 1, base_price_usd: null, applied_price_usd: 5, applied_price_khr: 20500, total_usd: 5, total_khr: 20500,
  manual_discount_type: null, manual_discount_value: null, manual_discount_usd: 0, cost_price_usd: null, pricing_snapshot_json: null,
}
const savedSale = {
  id: 17, money_precision_version: 0, calculated_total_usd: null, rounding_adjustment_usd: 0, subtotal_usd: 5, subtotal_khr: 20500, discount_usd: 0,
  membership_discount_usd: 0, tax_usd: 0, total_usd: 5, total_khr: 20500, exchange_rate: 4100, amount_paid_usd: 0, amount_paid_khr: 0, items: [recordedLine],
}
const DRAFT_KEYS = ['businessos_pos_orders_7', 'businessos_pos_active_7', 'businessos_pos_counter_7', 'bos_pos_orders', 'bos_pos_active', 'bos_pos_counter']
const FILTER_KEYS = ['pos_cat', 'pos_brand', 'pos_branch', 'pos_stock', 'pos_group', 'pos_supplier', 'pos_initial']

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })
const browser = globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage; dispatchEvent: (event: Event) => boolean } }
let capability: 'ready' | 'refused' = 'ready'
;(globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
  if (!String(input).includes('/api/sales/money-precision-capability')) throw new TypeError(`unexpected fetch ${String(input)}`)
  return capability === 'ready'
    ? new Response(JSON.stringify({ money_precision_version: 1, schema_ready: true, historical_edit_ready: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response(JSON.stringify({ error: 'unavailable' }), { status: 403, headers: { 'content-type': 'application/json' } })
}

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
  }
}

interface Calls { bootstrap: Array<Record<string, unknown>>; search: Array<Record<string, unknown>>; filters: number; categories: number; sales: number }

async function mountTill(options: { filters?: Record<string, string>; cart?: boolean; capability?: 'ready' | 'refused' } = {}) {
  capability = options.capability ?? 'ready'
  for (const key of DRAFT_KEYS) { browser.window.localStorage.removeItem(key); browser.window.sessionStorage.removeItem(key) }
  for (const key of FILTER_KEYS) browser.window.sessionStorage.removeItem(key)
  for (const [key, value] of Object.entries(options.filters ?? {})) browser.window.sessionStorage.setItem(key, value)
  if (options.cart) browser.window.localStorage.setItem('businessos_pos_orders_7', JSON.stringify([{ id: 'order-1', name: 'Order 1', cart: [cartLine], money_precision_version: 1 }]))
  const calls: Calls = { bootstrap: [], search: [], filters: 0, categories: 0, sales: 0 }
  const page = await harness.mount({
    component: '../tests/posSyncHost.tsx',
    app: {
      t: (key: string) => key, notify: () => {}, user: { ...USER, role_permissions: { all: true } }, authReady: true, page: 'pos', settings: {}, language: 'en',
      fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, usdSymbol: '$', khrSymbol: 'R', exchangeRate: 4100,
      can: () => true, hasPermission: () => true, getPermissionTier: () => 'all', canWriteToServer: true,
    },
    doubles: {
      'api/productReadTransport.ts': {
        getProductBootstrap: async (query: Record<string, unknown>) => {
          calls.bootstrap.push(query)
          return { items: [product], total: 1, page: 1, pageSize: 50, totalPages: 1, promotion_rules: [], branches: [{ id: 1, name: 'LC Store', is_default: true, is_active: 1 }] }
        },
        searchProducts: async (query: Record<string, unknown>) => {
          calls.search.push(query)
          return { items: [product], total: 1, page: 1, pageSize: 50, totalPages: 1, promotion_rules: [] }
        },
        getProductFilters: async () => { calls.filters += 1; return { brands: ['Acme'], suppliers: [], initials: [] } },
      },
      'api/batchesTransport.ts': { getTrackedBatchProductIds: async () => ({ productIds: [] }), getProductBatches: async () => ({ batches: [] }) },
      'api/lookupTransport.ts': { getCategories: async () => { calls.categories += 1; return [{ id: 1, name: 'Care' }] } },
      'api/contactReadTransport.ts': { getSalesCustomerPicker: async () => [], getDeliveryContacts: async () => [], invalidateCustomerReadCache: () => {}, lookupCustomerMembership: async () => null },
      'api/salesTransport.ts': { createSale: async () => { calls.sales += 1; return { success: true, id: 17, sale: savedSale } } },
    },
  })
  mounted.push(page)
  return { page, calls }
}

const heard = (): Array<{ channel?: string; source?: string }> => ((globalThis as Record<symbol, unknown>)[Symbol.for('posSyncHost.heard')] as Array<{ channel?: string; source?: string }>) ?? []
const button = (page: MountedSurface, text: string): MemoryNode => page.find((node) => node.tagName === 'BUTTON' && node.textContent.trim() === text, `button ${text}`)
const catalogReads = (calls: Calls): number => calls.bootstrap.length + calls.search.length

try {
  await check('open with default filters: exactly one products/bootstrap (money version 1), no categories read', async () => {
    const till = await mountTill()
    assert.equal(till.calls.bootstrap.length, 1, `bootstrap versions: ${JSON.stringify(till.calls.bootstrap.map((q) => q.money_precision_version))}`)
    assert.equal(till.calls.bootstrap[0].money_precision_version, 1)
    assert.equal(till.calls.search.length, 0)
    assert.equal(till.calls.filters, 1, 'the A-Z rail still gets its letters')
    assert.equal(till.calls.categories, 0, 'categories are read only when the filter panel opens or a category filter is persisted')
  })

  await check('a persisted category filter reads categories at open (the stale-filter prune needs them)', async () => {
    const till = await mountTill({ filters: { pos_cat: 'Care' } })
    assert.equal(till.calls.categories, 1)
    assert.equal(till.calls.bootstrap.length, 1)
  })

  await check('opening the filter panel reads categories once', async () => {
    const till = await mountTill()
    assert.equal(till.calls.categories, 0)
    const trigger = till.page.find((node) => node.tagName === 'BUTTON' && propsOf(node)['aria-haspopup'] !== undefined && /filter/i.test(`${propsOf(node)['aria-label'] ?? ''}${node.textContent}`), 'the filter trigger')
    await till.page.click(trigger)
    assert.equal(till.calls.categories, 1)
  })

  await check('capability read refused: one money version 0 bootstrap, no loop', async () => {
    const till = await mountTill({ capability: 'refused' })
    assert.equal(till.calls.bootstrap.length, 1, `bootstrap versions: ${JSON.stringify(till.calls.bootstrap.map((q) => q.money_precision_version))}`)
    assert.equal(till.calls.bootstrap[0].money_precision_version, 0)
  })

  await check('one completed sale: one catalog reload in the till, and other pages still hear inventory and sales', async () => {
    const till = await mountTill({ cart: true })
    const before = catalogReads(till.calls)
    await till.page.click(button(till.page, 'complete_sale'))
    await till.page.click(till.page.find((node) => node.getAttribute('data-pos-status-option') === 'awaiting_payment', 'the Not Paid option'))
    assert.equal(till.calls.sales, 1, 'the sale was sent')
    assert.equal(catalogReads(till.calls) - before, 1, 'exactly one reload after the sale')
    assert.deepEqual(heard().map((event) => event.channel).sort(), ['inventory', 'sales'], 'other pages are still told')
  })

  await check('control: a sale pushed from another till still reloads this one', async () => {
    const till = await mountTill()
    const before = catalogReads(till.calls)
    await act(async () => { browser.window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } })) })
    await till.page.settle()
    assert.equal(catalogReads(till.calls) - before, 1)
  })
} finally {
  await harness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nposRoundTrips: all checks passed')
