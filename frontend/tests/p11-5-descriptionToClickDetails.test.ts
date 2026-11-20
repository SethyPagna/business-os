// P11-5 (2026-09-18): the description comes off the card and opens from it instead.
// Public web overhaul, spec section 9 (20 Nov 2026): the "Click to view details" link under every
// card is gone too. The picture opens the gallery and the product NAME opens the detail sheet; the
// whole card is also clickable for a pointer.
//
// Run: node tests/p11-5-descriptionToClickDetails.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const productsSection = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogProductsSection.tsx'), 'utf8')

assert.doesNotMatch(productsSection, /showDescription \?/, 'the card must not gate a printed description block anymore')
assert.doesNotMatch(
  productsSection,
  /<p \{\.\.\.getKhmerTextProps\(product\.description/,
  'the card must not render the raw description paragraph',
)
assert.doesNotMatch(productsSection, /clickToViewDetails|Click to view details/, 'no "Click to view details" link on a card')
// What replaces it: the name is the keyboard-reachable opener, and the card itself opens for a click.
assert.match(productsSection, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); openProductDetail\(product\) \}\}\s*translate="no"/, 'the product name opens the detail sheet')
assert.match(productsSection, /onClick=\{\(\) => openProductDetail\?\.\(product\)\}/, 'the card opens the detail sheet for a pointer')

console.log('P11-5: the product card carries no description and no "Click to view details"; the name and the card open the details -- PASS')
