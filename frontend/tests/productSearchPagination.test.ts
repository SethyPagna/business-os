import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const productsPage = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const productFilterHelpers = readFileSync(new URL('../src/components/products/helpers/productFilterHelpers.ts', import.meta.url), 'utf8')
const productMenuHelpers = readFileSync(new URL('../src/components/products/helpers/productMenuHelpers.ts', import.meta.url), 'utf8')
const productsSurface = readFileSync(new URL('../src/components/products/surfaces/ProductsListSurface.tsx', import.meta.url), 'utf8')
const posPage = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const posFilterPanel = readFileSync(new URL('../src/components/pos/FilterPanel.tsx', import.meta.url), 'utf8')
const apiMethods = readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
const productReadTransport = readFileSync(new URL('../src/api/productReadTransport.ts', import.meta.url), 'utf8')

assert.ok(
  /productApi\.getProductsByIds|window\.api\.getProductsByIds/.test(productsPage),
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
  productReadTransport.includes('/api/products/search'),
  'bounded product id lookup should reuse the paginated search API',
)
assert.match(
  posPage,
  /const effectiveStockState = stockFilter === 'all' \? '' : stockFilter/,
  'POS should request total product results by default instead of forcing sellable-only browsing',
)
assert.match(
  posPage,
  /totalItems=\{productTotal\}/,
  'POS pagination should be driven by the total product result count',
)
assert.match(
  productsSurface,
  /visibleProducts\.length === 0[\s\S]*refreshingProducts[\s\S]*Refreshing products/,
  'Products page should show refreshing state instead of a false no-data search result while data is in flight',
)
assert.match(
  productFilterHelpers,
  /product\?\.unit/,
  'Products search should include unit names so unit review can jump into matching products',
)
assert.match(
  productsPage,
  /const handleLookupReviewSelection = useCallback/,
  'Products page should expose a lookup-review handoff for manage brand/category/unit flows',
)
assert.match(
  productsPage,
  /onReviewSelection=\{handleLookupReviewSelection\}/,
  'Products page should wire lookup-review handoff into the manage brand/category/unit modals',
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
  /getProductFilters\(\{\}\)/,
  'Products page should load global product filter options instead of shrinking options by the active filters',
)
assert.doesNotMatch(
  productsPage,
  /compactBrandOptions|slice\(0,\s*40\)/,
  'Products page should not cap the visible brand filter list',
)
assert.match(
  productsPage,
  /(?:p\.brand|brandName)[\s\S]*getBrandColor\((?:p\.brand|brandName)\)[\s\S]*pl-\[5\.35rem\]/,
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
  /const POS_CATALOG_LOAD_TIMEOUT_MS = 15000/,
  'POS catalog bootstrap should have a named timeout budget',
)
assert.match(
  posPage,
  /withLoaderTimeout\(\s*\(\) => Promise\.all\(\[[\s\S]*(?:window\.api|api)\.searchProducts(?:\?\.)?\(productQuery\)[\s\S]*(?:window\.api|api)\.getCategories(?:\?\.)?\(\)[\s\S]*(?:window\.api|api)\.getBranches(?:\?\.)?\(\)[\s\S]*label,\s*POS_CATALOG_LOAD_TIMEOUT_MS,\s*\)/,
  'POS catalog bootstrap should apply the named timeout to product, category, and branch reads',
)
assert.doesNotMatch(
  posPage,
  /getProductFilters(?:\?\.)?\(\{\}\)[\s\S]{0,260}POS_CATALOG_LOAD_TIMEOUT_MS/,
  'POS catalog bootstrap should keep full product filters out of the first route-load batch',
)
assert.match(
  posPage,
  /withLoaderTimeout\(\(\) => (?:window\.api|api)\.getProductFilters(?:\?\.)?\(\{\}\) \|\| missingPosApiMethod\('getProductFilters'\), 'POS product filters', POS_FILTER_META_TIMEOUT_MS\)/,
  'POS filter panel should receive delayed global filter metadata',
)
assert.match(
  posFilterPanel,
  /T\('groups', 'Groups'\)/,
  'POS filter panel should name the grouping filter Groups',
)
assert.match(
  productMenuHelpers,
  /label:\s*t\('groups'\) \|\| 'Groups'/,
  'Products filter menu should name the grouping filter Groups',
)
assert.match(
  posPage,
  /groupFilter === 'grouped'[\s\S]*isParentGroup \|\| isVariantGroup/,
  'POS group filter should show grouped parent and variant families under Groups',
)
assert.doesNotMatch(
  posPage,
  new RegExp(`Tap to view ${'choices'}|Tap to add ${'instantly'}`),
  'POS product cards should not show instructional tap copy',
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
