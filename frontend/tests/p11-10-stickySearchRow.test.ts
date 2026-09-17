// P11-10: "the search row is not sticky when scrolled down. fix that as
// well." A `position: sticky` element can only stay pinned across the
// height of its OWN parent; the row used to be wrapped alone in a
// `<div className="mb-5 space-y-3">` with no other sibling, i.e. a parent
// exactly as tall as itself, giving it nowhere to actually stick.
//
// Run: node tests/p11-10-stickySearchRow.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const productsSection = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogProductsSection.tsx'), 'utf8')

assert.doesNotMatch(
  productsSection,
  /<div className="mb-5 space-y-3">\s*<div className="sticky top-16/,
  'the sticky row must not be the sole child of its own short "mb-5 space-y-3" wrapper',
)
assert.match(
  productsSection,
  /<div className="sticky top-16 z-20 -mx-1 mb-5 space-y-2 rounded-\[22px\]/,
  'the sticky row must carry its own mb-5 and sit directly in the tall column',
)

console.log('P11-10: the sticky search/filter row is a direct child of the tall product column -- PASS')
