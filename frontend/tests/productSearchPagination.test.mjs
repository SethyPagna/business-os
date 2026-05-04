import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const productsPage = readFileSync(new URL('../src/components/products/Products.jsx', import.meta.url), 'utf8')
const posPage = readFileSync(new URL('../src/components/pos/POS.jsx', import.meta.url), 'utf8')
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
assert.match(
  posPage,
  /hasProductDiscoveryQuery[\s\S]*stockFilter === 'all'[\s\S]*\? \(hasProductDiscoveryQuery \? '' : 'positive'\)/,
  'POS should switch from sellable-only browsing to all-result discovery during text or initial search',
)
assert.match(
  posPage,
  /stockFilter === 'all' && !hasProductDiscoveryQuery/,
  'POS client-side fallback should only hide out-of-stock products while browsing without discovery filters',
)
assert.match(
  productsPage,
  /visibleProducts\.length === 0[\s\S]*refreshingProducts[\s\S]*Refreshing products/,
  'Products page should show refreshing state instead of a false no-data search result while data is in flight',
)
assert.match(
  productsPage,
  /product_brand_color_map/,
  'Products page should read brand color settings for product rows and details',
)
assert.match(
  productsPage,
  /renderMetaPill/,
  'Products page should render colored metadata pills for SKU, barcode, unit, category, brand, and branches',
)
assert.match(
  productsPage,
  /p\.brand[\s\S]*getBrandColor\(p\.brand\)[\s\S]*pl-\[5\.35rem\]/,
  'Mobile product cards should show brand and let the lower metadata row span under the action button',
)
assert.match(
  posPage,
  /visibleProductCards\.length === 0[\s\S]*catalogRefreshing[\s\S]*Refreshing/,
  'POS product grid should show refreshing state instead of a false no-data result while data is in flight',
)
assert.match(
  posPage,
  /include: 'branch_stock,images,family'/,
  'POS should request product families so one card can show parent, variants, and options together',
)
assert.match(
  posPage,
  /groupFilter === 'grouped'[\s\S]*isParentGroup \|\| isVariantGroup/,
  'POS group filter should show grouped parent and variant families under Groups',
)
assert.doesNotMatch(
  posPage,
  /quickFilters|pos_quick_filters|setQuickFilter/,
  'POS should not keep the removed quick-filter controls wired',
)
assert.match(
  posPage,
  /membership_number[\s\S]*Auto-generated if blank/,
  'POS quick-add customer form should expose optional membership id and allow generated memberships',
)

console.log('productSearchPagination tests passed')
