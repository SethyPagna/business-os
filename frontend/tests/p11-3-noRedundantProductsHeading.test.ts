// P11-3: "We already have products section so no need to say Products
// again... above the 'Browse our products and check availability.'"
//
// Run: node tests/p11-3-noRedundantProductsHeading.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogDir = path.join(here, '..', 'src', 'components', 'catalog')
const catalogUi = fs.readFileSync(path.join(catalogDir, 'catalogUi.tsx'), 'utf8')
const productsSection = fs.readFileSync(path.join(catalogDir, 'CatalogProductsSection.tsx'), 'utf8')

assert.match(catalogUi, /title\?\s*: ReactNode/, 'SectionShell must accept an optional (omittable) title')
assert.match(catalogUi, /\{title \? <h2[^>]*>\{title\}<\/h2> : null\}/, 'SectionShell must not render an empty heading when title is falsy')
assert.match(
  productsSection,
  /title=\{publicView \? undefined : copy\('products', 'Products'\)\}/,
  'the public storefront must omit the Products heading (the admin editor preview keeps it)',
)
assert.match(productsSection, /subtitle=\{copy\('liveCatalog'/, 'the subtitle line must still print regardless')

console.log('P11-3: the public products section has no redundant "Products" heading -- PASS')
