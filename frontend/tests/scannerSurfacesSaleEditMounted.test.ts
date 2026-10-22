// The REAL sale-edit modal, mounted with transport doubles (lane 6.0.934).
//
// Adding items to a sale and replacing a line each have a product search that says "Search by
// name or barcode" but had no scan button. Both now have one, and a scan does what typing does
// and nothing more: the code fills the search and the list narrows; no line is staged and no
// amendment is sent (the person still picks the card).
//
// Run: node tests/scannerSurfacesSaleEditMounted.test.ts
import assert from 'node:assert/strict'
import { act } from 'react'
import { createHarness, MemoryNode, propsOf, type MountedSurface } from './mountedComponentHarness.ts'

const rects = MemoryNode.prototype.getClientRects
MemoryNode.prototype.getClientRects = function (): unknown[] { return this.isConnected ? [{}] : [] }
const harness = await createHarness({ observe: ['api/methods.ts', 'api/productSearchIndex.ts'] })
;(globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
  if (String(input).includes('/api/sales/money-precision-capability')) {
    return new Response(JSON.stringify({ money_precision_version: 1, schema_ready: true, historical_edit_ready: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
}

const CODE = '3348901729222'
const sale = {
  id: 5, receipt_number: 'R-5', sale_status: 'completed', branch_id: 1, money_precision_version: 0, exchange_rate: 4100,
  subtotal_usd: 2, total_usd: 2, total_khr: 8200, discount_usd: 0, amount_paid_usd: 2, amount_paid_khr: 0, created_at: '2026-10-20 03:00:00',
  items: [{ id: 11, sale_id: 5, product_id: 7, product_name: 'Soap', quantity: 1, applied_price_usd: 2, applied_price_khr: 8200, total_usd: 2, total_khr: 8200 }],
}
const searches: Array<Record<string, unknown>> = []
const writes: string[] = []

const scanButtons = (surface: MountedSurface): MemoryNode[] => surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'scan_barcode')
const addBox = (surface: MountedSurface): MemoryNode => surface.find((node) => node.tagName === 'INPUT' && node.getAttribute('id') === 'sale-add-item-search', 'the add-items search')
const replaceBox = (surface: MountedSurface): MemoryNode => surface.find((node) => node.tagName === 'INPUT' && propsOf(node).type === 'search', 'the replace-line search')

// The scan button's component props are not on the DOM node: walk up its fiber.
function onDetectedOf(button: MemoryNode): (code: string) => void {
  const key = Object.keys(button).find((name) => name.startsWith('__reactFiber')) as string
  for (let fiber = (button as unknown as Record<string, any>)[key]; fiber; fiber = fiber.return) {
    if (typeof fiber.memoizedProps?.onDetected === 'function') return fiber.memoizedProps.onDetected
  }
  throw new Error('no onDetected above the scan button')
}

async function mountSale(): Promise<MountedSurface> {
  searches.length = 0
  writes.length = 0
  return harness.mount({
    component: 'components/sales/SaleDetailModal.tsx',
    props: {
      sale, settings: {}, onClose() {}, t: (key: string) => key, fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => String(value),
      onAddItems: async () => { writes.push('add'); return { ok: true } },
      onAmend: async () => { writes.push('amend'); return { ok: true } },
    },
    app: { user: { id: 3, role_code: 'admin', permissions: { all: true } }, authReady: true, t: (key: string) => key, can: () => true, notify() {}, navigateTo() {}, language: 'en', settings: {}, hasPermission: () => true, getPermissionTier: () => 'full' },
    doubles: {
      'api/batchesTransport.ts': { getTrackedBatchProductIds: async () => ({ productIds: [] }), getProductBatches: async () => ({ batches: [] }) },
      'api/methods.ts': { searchProducts: async (query: Record<string, unknown>) => { searches.push(query); return { items: [], total: 0 } } },
      'api/productSearchIndex.ts': { useProductSearchIndex: () => 0 },
    },
  })
}

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

try {
  await check('add items: the search has a scan button, and a scan fills the search and runs it without staging anything', async () => {
    const surface = await mountSale()
    assert.equal(scanButtons(surface).length, 1, 'one scan button, beside the add-items search')
    await act(async () => { onDetectedOf(scanButtons(surface)[0])(CODE) })
    await surface.settle()
    assert.equal(propsOf(addBox(surface)).value, CODE)
    assert.ok(searches.some((query) => query.query === CODE), 'the list narrows with the same product search typing runs')
    assert.deepEqual(writes, [], 'nothing was added to the sale')
    await surface.unmount()
  })

  await check('replace line: the search has its own scan button, and a scan fills it without replacing anything', async () => {
    const surface = await mountSale()
    await surface.click(surface.button('edit'))
    await surface.click(surface.button('Replace'))
    await surface.waitFor(() => surface.findAll((node) => node.tagName === 'INPUT' && propsOf(node).type === 'search').length === 1, 'the replace-line search')
    const buttons = scanButtons(surface)
    assert.equal(buttons.length, 2, 'one for add items and one for the replace-line search')
    const replaceRow = replaceBox(surface).parentNode as MemoryNode
    const [inReplaceRow, inAddItems] = [buttons.filter((button) => replaceRow.contains(button)), buttons.filter((button) => !replaceRow.contains(button))]
    assert.equal(inReplaceRow.length, 1, 'one button sits in the replace-line search row')
    assert.equal(inAddItems.length, 1, 'the other stays with the add-items search')
    await act(async () => { onDetectedOf(inReplaceRow[0])(CODE) })
    await surface.settle()
    assert.equal(propsOf(replaceBox(surface)).value, CODE)
    assert.ok(searches.some((query) => query.query === CODE))
    assert.deepEqual(writes, [], 'no replacement was sent')
    await surface.unmount()
  })

  await check('a scan runs exactly the product search typing runs (same request, only the text differs)', async () => {
    const surface = await mountSale()
    await surface.type(addBox(surface), 'TYPED-1')
    await surface.settle()
    await act(async () => { onDetectedOf(scanButtons(surface)[0])('SCANNED-2') })
    await surface.settle()
    const typed = searches.find((query) => query.query === 'TYPED-1')
    const scanned = searches.find((query) => query.query === 'SCANNED-2')
    assert.ok(typed && scanned, 'both reached the product search')
    assert.deepEqual({ ...scanned, query: '' }, { ...typed, query: '' })
    await surface.unmount()
  })
} finally {
  await harness.close()
  MemoryNode.prototype.getClientRects = rects
}
if (failed > 0) process.exitCode = 1
