import assert from 'node:assert/strict'
import { getPortalLanguageText } from '../src/components/catalog/portalLanguagePacks.ts'

// Owner decision, 27 Sep 2026: the public site is English and Khmer only.
// Khmer comes from the pack; English is each call site's own fallback.
assert.equal(getPortalLanguageText('km', 'products'), '\u1795\u179b\u17b7\u178f\u1795\u179b')
assert.equal(getPortalLanguageText(' KM ', 'products'), getPortalLanguageText('km', 'products'))
assert.equal(getPortalLanguageText('en', 'products'), '')
for (const retired of ['zh-CN', 'zh-TW', 'vi', 'th', 'ru', 'fr', 'es', 'de', 'ja', 'ko', 'pt', 'it', 'ar', 'hi', 'id', 'ms', 'tr']) {
  assert.equal(getPortalLanguageText(retired, 'products'), '', `the retired ${retired} pack still answers`)
}
{
  const fs = await import('node:fs')
  const packSource = fs.readFileSync(new URL('../src/components/catalog/portalLanguagePacks.ts', import.meta.url), 'utf8')
  const packLanguages = new Set([...packSource.matchAll(/^ {2}'?([a-z]{2}(?:-[A-Za-z]{2})?)'?: \{/gm)].map((match) => match[1]))
  assert.deepEqual([...packLanguages], ['km'], 'the pack file holds a retired language')
}

const mojibakePattern = /\u00c3|\u00c2|\u00e2\u20ac|\u00e1\u017e|\u00e1\u0178|\u00e0\u00b8|\u00e1\u00ba|\u00d0|\u00d1|\u00d8|\u00d9|\ufffd/

for (const key of ['products', 'membership', 'search', 'searchPlaceholder', 'noProducts', 'filters', 'loadingProducts', 'aboutTitle', 'faqTitle', 'aiTitle', 'assistantQuestion', 'switch_to_dark_mode']) {
  const text = getPortalLanguageText('km', key)
  assert.ok(text, `km.${key} is missing`)
  assert.doesNotMatch(text, mojibakePattern, `km.${key} is mojibake`)
}
assert.equal(getPortalLanguageText('km', 'businessName'), '', 'merchant fields never come from the pack')
assert.equal(getPortalLanguageText('km', 'portalIntro'), '')
assert.equal(getPortalLanguageText('km', 'businessTagline'), '')


// P3-L3 item D: the product detail flyout's labels. None of its copy() keys
// exists in either lang pack, so for a Khmer visitor every one of them fell
// through to the English fallback (the "Caution" / "Need More Details"
// headings on a Khmer storefront). The key list is read from the flyout
// source so a label added later without Khmer fails here, not on screen.
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const flyout = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'catalog', 'ProductDetailFlyout.tsx'), 'utf8')
  const keys = new Set<string>()
  for (const match of flyout.matchAll(/copy\('([A-Za-z]+)'/g)) keys.add(match[1])
  for (const match of flyout.matchAll(/labelKey: '([A-Za-z]+)'/g)) keys.add(match[1])
  // A floor that catches a broken extraction regex, not a quota: P-public
  // (2026-09-25) retired the flyout's generic empty-state lines
  // (productCautionNotProvided, productNeedMoreDetailsFallback,
  // productDetailNotProvided) in favour of owner defaults / hidden rows.
  assert.ok(keys.size >= 18, `expected the flyout's copy keys, found ${keys.size}`)
  // imageCount is "{current}/{total}" in every language: digits and a slash.
  keys.delete('imageCount')
  const khmer = /[\u1780-\u17ff]/
  for (const key of keys) {
    const text = getPortalLanguageText('km', key)
    assert.ok(text, `km pack has no value for flyout key ${key}`)
    assert.match(text, khmer, `km.${key} is not Khmer: ${text}`)
    assert.doesNotMatch(text, mojibakePattern, `km.${key} is mojibake`)
  }
  // Same word for the same concept as the rest of the storefront.
  assert.equal(getPortalLanguageText('km', 'productCategory'), getPortalLanguageText('km', 'category'))
  assert.equal(getPortalLanguageText('km', 'productBrand'), getPortalLanguageText('km', 'brand'))
  assert.equal(getPortalLanguageText('km', 'productCaution'), 'ការប្រុងប្រយ័ត្ន')
  assert.equal(getPortalLanguageText('km', 'productNeedMoreDetails'), 'ត្រូវការព័ត៌មានបន្ថែម')
}

console.log('portalLanguagePacks tests passed')
