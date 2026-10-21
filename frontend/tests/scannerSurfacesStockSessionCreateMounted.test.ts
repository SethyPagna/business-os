// The REAL Stock Session float, mounted with transport doubles: what "+ Create" prefills (lane 6.0.934).
//
// A scanner gun on the Windows Khmer layout types Khmer digits, and the float used to decide
// "barcode or name?" with an ASCII-only digit test, so "+ Create" opened the product form with
// the scanned code as the NAME. The product form is doubled so its `product` prop - what the
// form would open with - can be read.
//
// Run: node tests/scannerSurfacesStockSessionCreateMounted.test.ts
import assert from 'node:assert/strict'
import { act } from 'react'
import { createHarness, MemoryNode, propsOf, type MountedSurface } from './mountedComponentHarness.ts'

const rects = MemoryNode.prototype.getClientRects
MemoryNode.prototype.getClientRects = function (): unknown[] { return this.isConnected ? [{}] : [] }
const harness = await createHarness({ observe: ['api/methods.ts', 'api/productSearchIndex.ts', 'components/products/forms/ProductForm.tsx'] })

const forms: Array<Record<string, unknown>> = []
const SEARCH = 'Product or barcode'
const KHMER_CODE = '៣៣៤៨៩០១៧២៩២២២'
const ASCII_CODE = '3348901729222'

async function mountFloat(): Promise<MountedSurface> {
  localStorage.clear()
  forms.length = 0
  return harness.mount({
    component: 'components/inventory/FastStockInModal.tsx',
    props: {
      tr: (key: string, fallback?: string) => fallback ?? key, notify() {}, onClose() {}, onDone() {}, initialMode: 'add',
      branchOptions: [{ value: '1', label: 'Fixture branch' }], defaultBranchId: '1',
      initialHeader: { supplier: { supplierId: 4, supplierName: 'Fixture supplier' } },
    },
    app: { user: { id: 3, username: 'fixture', role_code: 'admin' }, t: (key: string) => key, can: () => true, notify() {}, usdSymbol: '$', exchangeRate: 4100 },
    doubles: {
      'api/batchesTransport.ts': { getProductBatches: async () => ({ batches: [] }) },
      'api/inventoryWriteTransport.ts': { getInventoryReasons: async () => ({}) },
      // No product matches: the float offers "+ Create" for whatever was searched.
      'api/methods.ts': { getProductFilters: async () => ({ brands: [] }), searchProducts: async () => ({ items: [], total: 0 }) },
      'api/productSearchIndex.ts': { useProductSearchIndex: () => 0 },
      'components/products/forms/ProductForm.tsx': { default: (props: { product?: Record<string, unknown> }) => { forms.push(props.product ?? {}); return null } },
    },
  })
}

const searchBox = (float: MountedSurface): MemoryNode => float.find((node) => node.tagName === 'INPUT' && node.getAttribute('aria-label') === SEARCH, SEARCH)
const createRow = (float: MountedSurface): MemoryNode => float.find((node) => node.tagName === 'BUTTON' && node.getAttribute('role') === 'option' && node.textContent.startsWith('Create'), 'the + Create row')

// The scan button's component props are not on the DOM node: walk up its fiber.
function onDetectedOf(float: MountedSurface): (code: string) => void {
  const button = float.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Scan product for this stock-in', 'the scan button')
  const key = Object.keys(button).find((name) => name.startsWith('__reactFiber$')) as string
  for (let fiber = (button as unknown as Record<string, any>)[key]; fiber; fiber = fiber.return) {
    if (typeof fiber.memoizedProps?.onDetected === 'function') return fiber.memoizedProps.onDetected
  }
  throw new Error('no onDetected above the scan button')
}

async function searchThenCreate(float: MountedSurface, how: 'typed' | 'scanned', text: string): Promise<Record<string, unknown>> {
  if (how === 'typed') await float.type(searchBox(float), text)
  else await act(async () => { onDetectedOf(float)(text) })
  await float.waitFor(() => float.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('role') === 'option' && node.textContent.startsWith('Create')).length > 0, 'the + Create row')
  assert.equal(propsOf(searchBox(float)).value, text, 'the search box holds what was searched')
  await float.click(createRow(float))
  await float.waitFor(() => forms.length > 0, 'the product form')
  return forms[forms.length - 1]
}

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

try {
  await check('+ Create after a Khmer-digit barcode opens the product form with the barcode (as ASCII digits), not a name', async () => {
    const float = await mountFloat()
    assert.deepEqual(
      { name: (await searchThenCreate(float, 'typed', KHMER_CODE)).name, barcode: forms[0].barcode },
      { name: '', barcode: ASCII_CODE },
    )
    await float.unmount()
  })

  await check('+ Create after a scan of the same Khmer digits opens it the same way', async () => {
    const float = await mountFloat()
    const product = await searchThenCreate(float, 'scanned', KHMER_CODE)
    assert.equal(product.name, '')
    assert.equal(product.barcode, ASCII_CODE)
    await float.unmount()
  })

  await check('+ Create after ASCII digits still prefills the barcode (control)', async () => {
    const float = await mountFloat()
    const product = await searchThenCreate(float, 'typed', ASCII_CODE)
    assert.equal(product.name, '')
    assert.equal(product.barcode, ASCII_CODE)
    await float.unmount()
  })

  await check('+ Create after a typed name prefills the name and leaves the barcode empty (control)', async () => {
    const float = await mountFloat()
    const product = await searchThenCreate(float, 'typed', 'Dior Sauvage')
    assert.equal(product.name, 'Dior Sauvage')
    assert.equal(product.barcode, '')
    await float.unmount()
  })

  await check('+ Create after a scanned non-numeric code (Code 128) prefills the barcode; the same text typed is a name', async () => {
    const scanned = await mountFloat()
    const fromScan = await searchThenCreate(scanned, 'scanned', 'AB-12345')
    assert.deepEqual({ name: fromScan.name, barcode: fromScan.barcode }, { name: '', barcode: 'AB-12345' })
    await scanned.unmount()
    const typed = await mountFloat()
    const fromTyping = await searchThenCreate(typed, 'typed', 'AB-12345')
    assert.deepEqual({ name: fromTyping.name, barcode: fromTyping.barcode }, { name: 'AB-12345', barcode: '' })
    await typed.unmount()
  })
} finally {
  await harness.close()
  MemoryNode.prototype.getClientRects = rects
}
if (failed > 0) process.exitCode = 1
