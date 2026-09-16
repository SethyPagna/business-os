import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { queueEntitySearch } from '../src/components/shared/entityLinkFocus.ts'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8').replace(/\r\n?/g, '\n')

const link = read('src/components/shared/EntityLink.tsx')
const focus = read('src/components/shared/entityLinkFocus.ts')
const products = read('src/components/products/Products.tsx')
const contacts = read('src/components/contacts/Contacts.tsx')
const saleDetail = read('src/components/sales/SaleDetailModal.tsx')
const productDetail = read('src/components/products/surfaces/ProductDetailModal.tsx')
const productRows = read('src/components/products/surfaces/ProductRowParts.tsx')
const productReport = read('src/components/products/surfaces/ProductDetailReport.tsx')
const salesList = read('src/components/sales/SalesListSurface.tsx')
const salesRoute = read('../cloudflare/src/routes/sales.ts')

assert.match(link, /getAdminPathForPage\(page\)/, 'entity links must use canonical admin routes')
assert.match(link, /navigate\(page, anchor\)/, 'internal links must use guarded AppContext navigation')
assert.match(link, /event\.preventDefault\(\)/, 'same-tab SPA navigation must preserve the current app shell')
assert.match(link, /event\.metaKey.*event\.ctrlKey/, 'modified clicks must retain normal browser link behavior')
assert.match(focus, /bos:dashboard:products-focus/, 'product links must queue a destination focus')
assert.match(focus, /bos:contacts:focus/, 'contact links must queue a destination focus')
assert.match(focus, /bos:entity-focus/, 'same-page links must refresh an already-mounted destination')

assert.match(products, /payload\?\.search/, 'Products must consume product-name/barcode focus')
assert.match(products, /payload\?\.unit/, 'Products must consume exact unit focus')
assert.match(products, /payload\?\.brand/, 'Products must consume exact brand focus')
assert.match(products, /payload\?\.category/, 'Products must consume exact category focus')
assert.match(contacts, /bos:contacts:focus/, 'Contacts must consume entity focus handoffs')
assert.match(contacts, /setResolveSearch\(\(current\) => \(\{ \.\.\.current, \[targetTab\]: search \}\)\)/, 'Contacts must seed the selected tab search')

for (const expected of [
  'hub:contacts:customers',
  'hub:contacts:delivery',
  'hub:contacts:suppliers',
  'hub:branches:overview',
  'hub:settings:settings',
  'hub:products:products',
]) {
  assert.match(saleDetail, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `SaleDetailModal must expose the ${expected} destination`)
}
assert.match(saleDetail, /search=\{sale\.customer_phone\}/, 'customer phone must link to customer search')
assert.match(saleDetail, /search=\{deliveryDriverName\}/, 'delivery driver must link to delivery contact search')
assert.doesNotMatch(saleDetail, /focus=\{\{ unit: item\.unit \}\}/, 'the compact receipt line must not grow a separate unit field')
assert.match(saleDetail, /search=\{item\.barcode\}/, 'sale item barcodes must link to product search')

assert.match(productDetail, /search=\{p\.barcode\}/, 'product detail barcode must link back to Products')
assert.match(productDetail, /search=\{p\.supplier\}/, 'product detail supplier must link to Suppliers')
assert.match(productDetail, /className="text-inherit no-underline hover:text-inherit hover:no-underline" page="products"/, 'copyable product detail links must retain navigation with inherited text styling')
assert.doesNotMatch(productDetail, /underline-offset-2 hover:text-blue-700 hover:underline/, 'description opener must read as ordinary inherited detail text')
assert.match(productDetail, /focus=\{\{ unit: p\.unit \}\}/, 'product detail unit must link to the exact unit filter')
assert.match(productRows, /hub:contacts:suppliers/, 'product list supplier must link to Suppliers')
assert.match(productRows, /className="text-inherit no-underline hover:text-inherit hover:no-underline" page="contacts"/, 'copyable supplier links must inherit their metadata pill styling')
assert.match(productReport, /hub:sales:sales/, 'product report sale drill-down must link to Sales')
assert.match(productReport, /hub:contacts:suppliers/, 'product report supplier drill-down must link to Suppliers')
assert.match(salesList, /hub:contacts:customers/, 'sales list customer name and phone must link to Customers')
assert.match(salesList, /hub:contacts:delivery/, 'sales list driver must link to Delivery contacts')
assert.match(salesList, /hub:settings:settings/, 'sales list payment method must link to payment settings')
assert.match(salesRoute, /p\.unit AS unit, p\.supplier AS supplier/, 'sale item reads must include unit and supplier link data')

// Runtime handoff check: this exercises the browser-storage contract rather
// than only checking JSX strings. Both cross-page and same-page targets must
// queue the right payload and notify an already-mounted destination.
const stored = new Map<string, string>()
const events: string[] = []
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    sessionStorage: {
      setItem: (key: string, value: string) => stored.set(key, value),
      getItem: (key: string) => stored.get(key) || null,
      removeItem: (key: string) => stored.delete(key),
    },
    dispatchEvent: (event: { type?: string }) => { events.push(String(event.type || '')); return true },
  },
})
queueEntitySearch('products', 'ABC-001', 'hub:products:products', { unit: 'Bottle' })
assert.deepEqual(JSON.parse(stored.get('bos:dashboard:products-focus') || '{}'), { unit: 'Bottle', search: 'ABC-001' })
queueEntitySearch('products', '', 'hub:products:products', { brand: 'Acme' })
assert.deepEqual(JSON.parse(stored.get('bos:dashboard:products-focus') || '{}'), { brand: 'Acme' })
queueEntitySearch('contacts', '012345678', 'hub:contacts:customers')
assert.deepEqual(JSON.parse(stored.get('bos:contacts:focus') || '{}'), { tab: 'customers', search: '012345678' })
assert.equal(events.length, 3, 'each handoff must notify an already-mounted destination')

console.log('PASS entity links, guarded navigation, and destination focus contracts')
