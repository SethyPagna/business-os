import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const productsPage = readFileSync(new URL('../src/components/products/Products.jsx', import.meta.url), 'utf8')
const apiMethods = readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')

assert.ok(
  productsPage.includes('window.api.getProductsByIds'),
  'Products page should fetch touched records by id for undo/redo and bulk actions',
)
assert.ok(
  !productsPage.includes('window.api.getProducts('),
  'Products page must not use full getProducts() during normal browsing or recovery actions',
)
assert.ok(
  apiMethods.includes('export const getProductsByIds'),
  'API layer should expose bounded product id lookup',
)
assert.ok(
  apiMethods.includes('/api/products/search'),
  'bounded product id lookup should reuse the paginated search API',
)

console.log('productSearchPagination tests passed')
