// Product names use ProductNameRail. Generic identifier rails remain single-line.
// Excluded writer surfaces retain explicit, independently checked contracts.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
const css = read('styles/main.css')

let failures = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL ${name}`)
    console.error(String((error as Error).message))
  }
}

function block(source: string, selector: string): string {
  const at = source.indexOf(`\n${selector} {`)
  assert.ok(at > 0, `no CSS rule for selector: ${selector}`)
  const open = source.indexOf('{', at)
  const close = source.indexOf('}', open)
  return source.slice(open + 1, close)
}

// ---------------------------------------------------------------------------
// 1. The shared class
// ---------------------------------------------------------------------------

runTest('.scroll-x-clean scrolls horizontally with no visible scrollbar', () => {
  const rule = block(css, '.scroll-x-clean')
  assert.match(rule, /overflow-x:\s*auto/, 'must scroll horizontally')
  assert.match(rule, /white-space:\s*nowrap/, 'generic identifiers must stay on one line')
  assert.match(rule, /min-width:\s*0/, 'must be able to shrink inside a flex/table cell')
  assert.match(rule, /text-overflow:\s*clip/, 'a scrolling name must not also grow an ellipsis')
  assert.match(rule, /scrollbar-width:\s*none/, 'Firefox/standards scrollbar hidden')
  assert.match(rule, /-webkit-overflow-scrolling:\s*touch/, 'iOS momentum scrolling')
  assert.match(rule, /overscroll-behavior-inline:\s*contain/, 'a horizontal fling must not chain out to the page')
  const bar = block(css, '.scroll-x-clean::-webkit-scrollbar')
  assert.match(bar, /display:\s*none/, 'WebKit/Blink scrollbar hidden -- this is the iOS and Android PWA case')
})

runTest('.scroll-x-clean does NOT pin touch-action, so vertical list scrolling survives', () => {
  const rule = block(css, '.scroll-x-clean')
  assert.doesNotMatch(rule, /touch-action/, 'pinning the axis would break a vertical swipe that starts on a product name')
  // Positive control: the class this one is modelled on DOES pin it, so the
  // assertion above is checking a real distinction and not a typo.
  assert.match(block(css, '.compact-action-row'), /touch-action:\s*pan-x/, 'positive control: the horizontal toolbar class still pins pan-x')
})

runTest('Khmer names keep their ink inside the scrolling box', () => {
  // overflow-y: hidden cannot take an overflow-clip-margin, so without a line
  // -height floor every coeng subscript would be sheared off.
  assert.match(css, /body\.lang-km \.scroll-x-clean[\s\S]{0,80}line-height:\s*var\(--km-line-height/, 'the km line-height floor must be restated for the scrolling cell')
})


 // Product names now use two-line rails; generic identifiers retain scroll-x-clean.
const EXPECTED_NAMES: Record<string, string[]> = {
 'components/products/surfaces/ProductDetailModal.tsx':['productName'],
 'components/inventory/ProductDetailModal.tsx':['p.name'],
 'components/inventory/InventoryStockModals.tsx':['adjustModal.name'],
 'components/inventory/InventoryMovementsSurface.tsx':['movement.product_name'],
 'components/pos/ProductCard.tsx':['displayName'],
 'components/products/Products.tsx':['productName','productName'],
 'components/products/surfaces/ProductsListSurface.tsx':['group.name','group.name'],
 'components/inventory/InventoryProductsSurface.tsx':['group.label','product.name','group.label','product.name'],
 'components/products/ProductsImageOnlyView.tsx':['product.name'],
 'components/branches/Branches.tsx':['product.name','group.name'],
 'components/products/ProductDuplicatesTab.tsx':['product.name'],
 'components/products/CreateProductsSessionModal.tsx':['group.name'],
 'components/branches/TransferModal.tsx':['group.name','selectedProduct.name','product.name','group.name'],
 'components/products/forms/BulkAddStockModal.tsx':['row.request.productName'],
}
const ADOPTED: Array<[string, number]> = [
 ['components/products/surfaces/ProductDetailModal.tsx',1],
 ['components/inventory/ProductDetailModal.tsx',1],
 ['components/inventory/InventoryStockModals.tsx',1],
 ['components/inventory/InventoryMovementsSurface.tsx',1],
 ['components/pos/ProductCard.tsx',1],
 ['components/products/Products.tsx',2],
 ['components/products/surfaces/ProductsListSurface.tsx',2],
 ['components/inventory/InventoryProductsSurface.tsx',4],
 ['components/products/ProductsImageOnlyView.tsx',1],
 ['components/branches/Branches.tsx',2],
 ['components/products/ProductDuplicatesTab.tsx',1],
 ['components/products/CreateProductsSessionModal.tsx',1],
 ['components/branches/TransferModal.tsx',4],
 ['components/products/forms/BulkAddStockModal.tsx',1],
]
runTest('adopted product names use the shared two-line component, not a local clamp',()=>{
 for(const [file,count] of ADOPTED){
  const source=read(file)
  const rails=[...source.matchAll(/<ProductNameRail\b[^>]*?\/>/g)].map(m=>m[0])
  assert.equal(rails.length,count,file)
  rails.forEach((rail,index)=>assert.ok(rail.includes(EXPECTED_NAMES[file][index]),`${file}: rail ${index} must preserve its original name expression`))
  for(const rail of rails) {
   assert.match(rail,/name=\{/,`${file}: full name supplied`)
   assert.doesNotMatch(rail,/line-clamp-|\btruncate\b|scroll-x-clean/,`${file}: no single-line or clipped rail`)
  }
  assert.doesNotMatch(source,/::-webkit-scrollbar/,`${file}: scrollbar CSS stays shared`)
 }
})
runTest('Products preserves copy wrappers, links and row gestures',()=>{
 const source=read('components/products/Products.tsx')
 assert.equal((source.match(/<ProductNameRail name=\{productName\} \/>/g)||[]).length,2)
 assert.equal((source.match(/getKhmerTextProps\(productName, ['`]min-w-0/g)||[]).length,2)
 assert.equal((source.match(/\{\.\.\.copy\(productName\)\}/g)||[]).length,2)
 assert.ok((source.match(/createLongPressHandlers\(rowLongPressState, \{/g)||[]).length>=2)
 assert.equal((source.match(/deferCopySurfaceAction\(copyTarget/g)||[]).length,4)
 assert.equal((source.match(/search=\{productName\}/g)||[]).length,2)
})
runTest('Stock Change mobile positively adopts rail; desktop ledger still has titled reveal',()=>{
 const source=read('components/products/StockChangeSection.tsx')
 assert.match(source,/data-stock-mobile-product-name="true"[\s\S]{0,180}<ProductNameRail name=\{row\.product_name\}/)
 const tags=[...source.matchAll(/<span\b[^>]*>\{row\.product_name\}/g)].map(m=>m[0])
 assert.equal(tags.length,1)
 assert.match(tags[0],/dense-cell-truncate/)
 assert.match(tags[0],/title=/)
})
runTest('excluded stock-in history keeps both fully wrapped name cells',()=>{
 const source=read('components/products/StockInSessionsSection.tsx')
 const tags=[...source.matchAll(/<span\b[^>]*>\{row\.product_name\}/g)].map(m=>m[0])
 assert.equal(tags.length,2)
 tags.forEach(tag=>assert.match(tag,/break-words/))
})
runTest('excluded fast picker remains readable until its owner adopts the new rail',()=>{
 const source=read('components/inventory/FastStockInModal.tsx')
 assert.ok(source.includes('<ProductNameRail') || /className="scroll-x-clean [^"]*">\{group.name\}/.test(source))
})
if(failures) process.exit(1)
console.log('PASS productNameScrollCells two-line adoption and protected generic rails')
