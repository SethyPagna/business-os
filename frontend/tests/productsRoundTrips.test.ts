// Request counts of the REAL Products page (lane 6.0.894). Stubs sit at the transport layer, so every number below is a
// request the browser would send. Before: open = possible-duplicates x1, every page/search/filter change = one more
// whole-catalog scan, plus a separate tagged-lots read after each list. After: the scan runs once per products sync
// generation, and the list read carries the held stock of its own rows.
import assert from 'node:assert/strict'
import { act } from 'react'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const USER = { id: 7, organization_id: 1, name: 'Owner', role_code: 'admin', permissions: { all: true }, role_permissions: { all: true } }
const row = (id: number, name: string) => ({
  id, name, barcode: `88500${id}`, unit: 'pcs', selling_price_usd: 5, selling_price_khr: 20500, stock: 4, stock_quantity: 4, is_active: 1, status: 'active',
  category: 'Care', brand: 'Acme', created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00', images: [], batches: [], batch_count: 0,
  branch_stock: [{ branch_id: 1, branch_name: 'LC Store', quantity: 4 }],
})
const pageRows = (page: number) => (page === 1 ? [row(1, 'Alpha serum'), row(2, 'Beta cream')] : [row(3, 'Gamma toner'), row(4, 'Delta mask')])
const held = (productId: number) => ({ product_id: productId, product_name: `P${productId}`, branch_id: 1, branch_name: 'LC Store', condition_tag: 'damaged', quantity: 2, lot_count: 1 })

const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })
;(globalThis as unknown as { fetch: unknown }).fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })

let failed = 0
const mounted: MountedSurface[] = []
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const page of mounted.splice(0)) await page.unmount()
  }
}

interface Calls { search: Array<Record<string, unknown>>; duplicates: number; duplicatesFresh: number; tagged: Array<Array<number | string>> }

async function mountProducts(options: { folded?: boolean } = {}) {
  const calls: Calls = { search: [], duplicates: 0, duplicatesFresh: 0, tagged: [] }
  const folded = options.folded !== false
  const page = await harness.mount({
    component: '../tests/productsSyncHost.tsx',
    app: {
      t: (key: string) => key, notify: () => {}, user: USER, authReady: true, page: 'products', settings: {}, language: 'en',
      fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, usdSymbol: '$', khrSymbol: 'R', exchangeRate: 4100,
      can: () => true, hasPermission: () => true, getPermissionTier: () => 'all', canWriteToServer: true, navigateTo: () => {},
    },
    doubles: {
      'api/productReadTransport.ts': {
        searchProducts: async (query: Record<string, unknown>) => {
          calls.search.push(query)
          const items = pageRows(Number(query.page) || 1)
          return { items, total: 4, page: Number(query.page) || 1, pageSize: 2, totalPages: 2, promotion_rules: [], ...(folded ? { tagged_lots: items.map((item) => held(item.id)) } : {}) }
        },
        getProductFilters: async () => ({ brands: [], categories: [], suppliers: [], initials: [] }),
      },
      'api/productWriteTransport.ts': {
        getPossiblySameProducts: async (options?: { fresh?: boolean }) => {
          calls.duplicates += 1
          if (options?.fresh) calls.duplicatesFresh += 1
          return { clusters: [] }
        },
      },
      'api/damagedLotsTransport.ts': {
        getTaggedLots: async (ids: Array<number | string>) => { calls.tagged.push(ids); return { items: ids.map((id) => held(Number(id))) } },
      },
    },
  })
  mounted.push(page)
  return { page, calls }
}

const sync = async (surface: MountedSurface, channel: string) => {
  await act(async () => { window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel } })) })
  await surface.settle()
}
const nextPage = (surface: MountedSurface): MemoryNode => surface.find((node) => node.tagName === 'BUTTON' && /next/i.test(`${propsOf(node)['aria-label'] ?? ''}${propsOf(node).title ?? ''}${node.textContent}`) && propsOf(node).disabled !== true, 'the next-page button')

try {
  await check('open: one whole-catalog duplicates scan and NO separate tagged-lots read', async () => {
    const { page, calls } = await mountProducts()
    assert.ok(calls.search.length >= 1, 'the list was read')
    assert.ok(String(calls.search[0].include).includes('tagged_lots'), `list read asks for tagged_lots: ${String(calls.search[0].include)}`)
    assert.equal(calls.duplicates, 1, 'one duplicates scan at open')
    assert.deepEqual(calls.tagged, [], 'tagged lots arrive with the list')
    assert.ok(page.text().includes('damaged'), 'the folded held stock is rendered')
  })

  await check('a page turn reads the list again but not duplicates, and still not tagged-lots', async () => {
    const { page, calls } = await mountProducts()
    const searches = calls.search.length
    await page.click(nextPage(page))
    assert.ok(calls.search.length > searches, 'page 2 was read')
    assert.equal(calls.duplicates, 1, 'no second duplicates scan for a page turn')
    assert.deepEqual(calls.tagged, [], 'page 2 held stock came with its list')
  })

  await check('a products sync (merge or rename) rescans duplicates exactly once', async () => {
    const { page, calls } = await mountProducts()
    await sync(page, 'products')
    assert.equal(calls.duplicates, 2, 'open scan + one scan for the sync')
  })

  await check('a stock-only sync (inventory/sales) never rescans the whole catalog', async () => {
    const { page, calls } = await mountProducts()
    await sync(page, 'inventory')
    await sync(page, 'sales')
    assert.equal(calls.duplicates, 1)
  })

  await check('a refused fold (no Inventory view) falls back to the separate read for the visible ids', async () => {
    const { calls } = await mountProducts({ folded: false })
    assert.equal(calls.tagged.length, 1, 'one fallback read')
    assert.deepEqual([...calls.tagged[0]].map(String).sort(), ['1', '2'])
  })
} finally {
  await harness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nproductsRoundTrips: all checks passed')
