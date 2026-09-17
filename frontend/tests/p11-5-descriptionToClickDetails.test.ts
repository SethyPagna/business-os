// P11-5: "for the description can be removed from default display instead
// replace with click to view details"
//
// Run: node tests/p11-5-descriptionToClickDetails.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const productsSection = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogProductsSection.tsx'), 'utf8')
const enPack = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'en.json'), 'utf8'))
const kmPack = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'km.json'), 'utf8'))
const flatten = (input: Record<string, unknown>, target: Record<string, string> = {}): Record<string, string> => {
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue
    if (typeof value === 'object' && !Array.isArray(value)) flatten(value as Record<string, unknown>, target)
    else target[key] = String(value)
  }
  return target
}
const enFlat = flatten(enPack)
const kmFlat = flatten(kmPack)

assert.doesNotMatch(productsSection, /showDescription \?/, 'the card must not gate a printed description block anymore')
assert.doesNotMatch(
  productsSection,
  /<p \{\.\.\.getKhmerTextProps\(product\.description/,
  'the card must not render the raw description paragraph',
)
assert.match(productsSection, /copy\('clickToViewDetails', 'Click to view details'/, 'a "click to view details" affordance must replace it')
assert.equal(enFlat.clickToViewDetails, 'Click to view details', 'en.json must carry the new key')
assert.ok(kmFlat.clickToViewDetails && kmFlat.clickToViewDetails !== enFlat.clickToViewDetails, 'km.json must carry an actual Khmer translation, not the English string')

console.log('P11-5: the product card no longer prints the description; it links to details instead -- PASS')
