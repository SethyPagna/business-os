import assert from 'node:assert/strict'
import { buildProductExportRows } from '../src/components/products/helpers/productExport.ts'
import {
  buildProductSearchTerms,
  filterProductsForPage,
  getProductBranchQuantity,
} from '../src/components/products/helpers/productFilterHelpers.ts'

const products = [
  {
    id: 1,
    name: 'Rose Serum',
    sku: 'RS-1',
    barcode: '1001',
    category: 'Skin',
    brand: 'Glow',
    unit: 'Bottle',
    supplier: 'Supplier A',
    created_at: '2026-05-03T00:00:00Z',
    stock_quantity: 8,
    low_stock_threshold: 5,
    out_of_stock_threshold: 0,
    branch_stock: [{ branch_id: 2, branch_name: 'Main', quantity: 8 }],
    image_gallery: ['/uploads/products/rose.png', '/uploads/products/box.png'],
    selling_price_usd: 12,
    purchase_price_usd: 7,
    is_active: true,
  },
  {
    id: 2,
    name: 'Matte Lipstick',
    category: 'Makeup',
    brand: 'Bold',
    supplier: 'Supplier B',
    created_at: '2026-04-10T00:00:00Z',
    stock_quantity: 0,
    low_stock_threshold: 5,
    out_of_stock_threshold: 0,
    branch_stock: [{ branch_id: 2, branch_name: 'Main', quantity: 0 }],
  },
  {
    id: 3,
    parent_id: 1,
    name: 'Rose Serum Travel',
    category: 'Skin',
    brand: 'Glow',
    supplier: 'Supplier A',
    created_at: '2026-05-11T00:00:00Z',
    stock_quantity: 2,
    low_stock_threshold: 5,
    out_of_stock_threshold: 0,
    branch_stock: [{ branch_id: 3, branch_name: 'Mall', quantity: 2 }],
  },
]

assert.deepEqual(buildProductSearchTerms(' rose,  serum ,, GLOW '), ['rose', 'serum', 'glow'])
assert.equal(getProductBranchQuantity(products[0], 2), 8)
assert.equal(getProductBranchQuantity(products[0], 99), 0)

assert.deepEqual(
  filterProductsForPage(products, {
    searchTerms: buildProductSearchTerms('rose,serum'),
    searchMode: 'AND',
    brandFilter: '  glow  ',
    catFilter: 'Skin',
    branchFilter: 'all',
    supplierFilter: 'all',
    createdYearFilter: '2026',
    createdMonthFilter: '5',
    groupFilter: 'all',
    parentProductIds: new Set([1]),
    stockFilter: 'all',
  }).map((product) => product.id),
  [1, 3],
  'filtering applies search, brand, category, and created date filters',
)

assert.deepEqual(
  filterProductsForPage(products, {
    branchFilter: '2',
    stockFilter: 'out',
    parentProductIds: new Set([1]),
  }).map((product) => product.id),
  [2],
  'branch out-of-stock filtering keeps only branch rows at or below threshold',
)

assert.deepEqual(
  filterProductsForPage(products, {
    groupFilter: 'group',
    parentProductIds: new Set([1]),
  }).map((product) => product.id),
  [1, 3],
  'group filtering selects parent and variant family members together',
)

assert.deepEqual(
  filterProductsForPage(products, {
    groupFilter: 'variant',
    parentProductIds: new Set([1]),
  }).map((product) => product.id),
  [1, 3],
  'legacy variant filter values map to the unified group filter',
)

const [row] = buildProductExportRows([products[0]])
assert.equal(row.Name, 'Rose Serum')
assert.equal(row.Selling_Price_USD, '12.00')
assert.equal(row.Purchase_Price_USD, '7.00')
assert.equal(row.Image_Filename_1, 'rose.png')
assert.equal(row.Image_Filenames, 'rose.png|box.png')
assert.equal(row.Branch, 'Main')
assert.equal(row.Is_Group, 'No')
assert.equal(row.Active, 'Yes')

console.log('productFilterHelpers tests passed')
