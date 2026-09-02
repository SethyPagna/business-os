import assert from 'node:assert/strict'
import fs from 'node:fs'

const form = fs.readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const products = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const adjust = fs.readFileSync(new URL('../src/components/products/forms/StockAdjustModal.tsx', import.meta.url), 'utf8')
const variant = fs.readFileSync(new URL('../src/components/products/forms/VariantFormModal.tsx', import.meta.url), 'utf8')
const workerProducts = fs.readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8')

assert.doesNotMatch(form, /id="product-sku"|name="product_sku"/, 'manual Product form must not expose SKU')
assert.equal((form.match(/id="product-barcode"/g) || []).length, 1, 'Barcode must exist once, in Basic Info only')
assert.match(form, /className="max-w-\[13rem\][^"]*"[\s\S]*?product-tag-label/, 'Tag field stays compact')
assert.match(form, /data-testid="product-basic-fields"[^>]*grid-cols-1[^>]*sm:grid-cols-2[^>]*lg:grid-cols-4/, 'Basic fields must stack safely on narrow screens and share compact desktop rows')
assert.match(form, /data-testid="product-pricing-grid"[^>]*grid-cols-1[^>]*xl:grid-cols-2/, 'Pricing panels must share a two-column large-screen row without forcing narrow overflow')
assert.match(form, /data-testid="product-stock-fields"[^>]*grid-cols-1[^>]*sm:grid-cols-2/, 'Stock and expiry fields must use a responsive compact grid')
assert.match(form, /h-11 w-11 flex-shrink-0[\s\S]*onClick=\{\(\) => openScanner\('barcode'\)\}/, 'Barcode scanner must remain icon-only with a 44px touch target')
assert.match(form, /buttonClassName="input min-h-11 w-full min-w-0"/, 'Initial branch stays in the compact stock row with a 44px control')
assert.match(form, /btn-primary min-h-11 flex-1/, 'Primary save action must preserve a 44px touch target')

for (const id of ['product-category', 'product-brand', 'product-unit']) {
  const pos = form.indexOf(`id="${id}"`)
  assert.ok(pos > 0, `${id} must exist`)
  const nearby = form.slice(Math.max(0, pos - 250), pos + 500)
  assert.match(nearby, /SuggestionTextInput/, `${id} must be free-text with suggestions, not select-only`)
}
assert.doesNotMatch(form, /id="product-parent-group"|Treat this item as a group parent/, 'Product form must not expose a group-parent concept')
assert.match(form, /Same-name grouping is virtual/, 'save contract must document virtual name-based grouping')
assert.match(form, /parent_id: _ignoredParentId/, 'manual saves must explicitly discard legacy parent links')
assert.match(form, /is_group: _ignoredIsGroup/, 'manual saves must explicitly discard legacy group flags')

const stockStart = form.indexOf("{activeTab === 'stock' || activeTab === 'expiry'")
const stockEnd = form.indexOf('{/* Sticky footer', stockStart)
const stockSection = form.slice(stockStart, stockEnd)
assert.match(stockSection, /product-stock-quantity/, 'Stock tab must show quantity')
assert.match(stockSection, /product-initial-branch|branches\.map/, 'Stock tab must show branch information')
assert.doesNotMatch(stockSection, /product-barcode|BranchStockAdjuster/, 'Stock tab must not contain barcode or inline adjustment controls')

assert.match(products, /setAdjustStockProduct\(detailProduct\)/, 'Product detail Adjust stock must open the floating adjustment flow')
assert.doesNotMatch(products, /onAdjustStock=\{\(\) => \{ setDetailProduct\(null\); openProductFormTab\(detailProduct, 'stock'\)/, 'Adjust stock must not open ProductForm Stock tab')
assert.match(products, /<StockAdjustModal[\s\S]*?initialProduct=\{adjustStockProduct\}/, 'floating adjust modal must receive the selected product')
assert.match(adjust, /getProductsByIds\(\[id\]\)/, 'floating adjust flow must refresh the exact product before writing stock')

assert.doesNotMatch(variant, /id="variant-form-sku"|name="variant_sku"/, 'Add-row/variant flow must not expose SKU either')
assert.doesNotMatch(variant, /parent_id:/, 'new same-name rows must not create stored parent-child links')
assert.match(variant, /virtual group title/, 'new same-name rows are grouped only by their normalized name')
assert.match(variant, /data-testid="variant-fields"[^>]*grid-cols-1[^>]*sm:grid-cols-2/, 'Add-row inputs must stack on narrow screens and share rows when space permits')
assert.match(variant, /btn-primary min-h-11 flex-1/, 'Add-row save action must preserve a 44px touch target')

assert.match(workerProducts, /MAX_PRODUCT_IMAGE_UPLOAD_BYTES = 12 \* 1024 \* 1024/, 'server must allow a bounded raw-image fallback when browser compression cannot decode the source')
assert.doesNotMatch(workerProducts, /Please try again, or pick a smaller\/simpler source photo/, 'image upload failure must not blame the operator for client compression failure')

console.log('PASS Product form/create/stock/grouping/image-upload contract')
