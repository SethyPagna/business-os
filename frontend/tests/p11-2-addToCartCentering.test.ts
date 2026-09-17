// P11-2: "the add to cart in smaller screens are also not being centered
// correctly in the button. the add icon and its button display"
//
// Run: node tests/p11-2-addToCartCentering.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const productsSection = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogProductsSection.tsx'), 'utf8')

assert.match(
  productsSection,
  /className=\{`inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-2\.5 py-1 text-\[11px\] font-semibold transition/,
  'the add-to-bucket button must centre its content (justify-center) like the wishlist button beside it',
)
assert.match(productsSection, /<Plus className="h-3\.5 w-3\.5 shrink-0" \/>/, 'the Plus icon must not lose width to the qty badge')

console.log('P11-2: the add-to-cart pill centres its icon like its wishlist sibling -- PASS')
