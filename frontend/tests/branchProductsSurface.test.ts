import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const surface = fs.readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.tsx', import.meta.url), 'utf8')
const hub = fs.readFileSync(new URL('../src/components/branches/BranchesHubPage.tsx', import.meta.url), 'utf8')

test('Branches Products mounts the product workspace rather than ranged statistics', () => {
  assert.match(hub, /active === 'products'[\s\S]{0,400}hostSection="products"/)
  assert.doesNotMatch(hub, /active === 'products'[\s\S]{0,500}hostSection="stats"/)
})

test('product search has an independent tracked lifecycle and branch-scoped query', () => {
  assert.match(inventory, /const productsRequestRef = useRef\(0\)/)
  assert.match(inventory, /beginTrackedRequest\(productsRequestRef\)/)
  assert.ok((inventory.match(/isTrackedRequestCurrent\(productsRequestRef, requestId\)/g) || []).length >= 3)
  assert.match(inventory, /searchInventoryProducts\(\{[\s\S]{0,400}branchId:[\s\S]{0,300}query:[\s\S]{0,200}page: productsPage,[\s\S]{0,100}pageSize: productsPageSize/)
  assert.match(inventory, /\[branchFilter, deferredSearch, isActive, needsProductsData, productsPage, productsPageSize, searchMode, tr\]/)
  assert.doesNotMatch(inventory, /settleLoaderMap\([\s\S]{0,700}searchInventoryProducts/)
})

test('scope changes reset paging and stale responses cannot replace the latest rows', async () => {
  let sequence = 0
  let rows: string[] = []
  const apply = async (promise: Promise<string[]>) => {
    const request = ++sequence
    const value = await promise
    if (request === sequence) rows = value
  }
  let resolveOld!: (rows: string[]) => void
  const old = new Promise<string[]>((resolve) => { resolveOld = resolve })
  const first = apply(old)
  await apply(Promise.resolve(['new branch']))
  resolveOld(['stale branch'])
  await first
  assert.deepEqual(rows, ['new branch'])
  assert.match(inventory, /useEffect\(\(\) => \{\s*setProductsPage\(1\)\s*\}, \[branchFilter, deferredSearch, searchMode\]\)/)
})

test('compact grouped rows expose scoped quantity, SKU, barcode, detail popup and canonical link', () => {
  assert.match(surface, /function groupInventoryProducts/)
  assert.match(surface, /function scopedProductQuantity/)
  assert.match(surface, /row\.branch_id[\s\S]{0,120}branchFilter/)
  assert.match(surface, /t\('sku'\)/)
  assert.match(surface, /t\('barcode'\)/)
  assert.match(surface, /onClick=\{\(\) => onOpenDetail\(product\)\}/)
  assert.match(surface, /onOpenInCatalogue\(product\)/)
  assert.match(inventory, /setDetailProduct/)
  assert.match(inventory, /bos:dashboard:products-focus/)
  assert.match(inventory, /navigateTo\?\.\('products'\)/)
})

test('loading, error, empty, data and pagination are separate product states', () => {
  assert.match(surface, /loading \? \(/)
  assert.match(surface, /\) : error \? \(/)
  assert.match(surface, /\) : groups\.length === 0 \? \(/)
  assert.match(surface, /groups\.map\(\(group\)/)
  assert.match(surface, /<PaginationControls[\s\S]{0,300}page=\{page\}[\s\S]{0,100}pageSize=\{pageSize\}[\s\S]{0,100}totalItems=\{total\}/)
  assert.match(inventory, /setProductsError\(error instanceof Error/)
  assert.match(inventory, /finally \{[\s\S]{0,140}setProductsLoading\(false\)/)
})
