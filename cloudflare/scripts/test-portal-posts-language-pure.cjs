// Website Editor lane, settings defect 5: the public config carries the
// storefront language the owner chose.
//
// The editor's "Portal language" select stores 'auto' | 'en' | 'km' under
// customer_portal_language. buildPortalConfig never published it, so:
//   - the live storefront (PublicCatalogPage.tsx reads config.language)
//     always fell back to English, whatever the owner picked;
//   - the editor builds its draft from this same public config
//     (CatalogPage.tsx buildDraft reads config.languageSetting), so every
//     editor save wrote 'auto' back over the owner's choice.
//
// Run (from cloudflare/): node scripts/test-portal-posts-language-pure.cjs
const assert = require('assert')
const { buildPortalConfig } = require('./harness/load_portal_route.cjs')

const ENV = { BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com' }
let checks = 0
const check = (label, fn) => { fn(); checks++; console.log(`PASS ${label}`) }
const languageOf = (stored) => {
  const config = buildPortalConfig(stored === undefined ? {} : { customer_portal_language: stored }, ENV)
  return { language: config.language, languageSetting: config.languageSetting }
}

check('Khmer chosen in the editor reaches the storefront and reads back into the editor', () => {
  assert.deepStrictEqual(languageOf('km'), { language: 'km', languageSetting: 'km' })
})

check('English chosen explicitly stays English', () => {
  assert.deepStrictEqual(languageOf('en'), { language: 'en', languageSetting: 'en' })
})

check("'auto' reads back as 'auto' for the editor and resolves to English for visitors", () => {
  // Same resolution as the editor preview (CatalogPage.tsx applyDraft), so a
  // visitor's consent record gets a real locale, never 'auto'.
  assert.deepStrictEqual(languageOf('auto'), { language: 'en', languageSetting: 'auto' })
})

check('a never-saved setting behaves exactly like auto', () => {
  assert.deepStrictEqual(languageOf(undefined), { language: 'en', languageSetting: 'auto' })
  assert.deepStrictEqual(languageOf(''), { language: 'en', languageSetting: 'auto' })
})

check('stored case and spacing do not matter', () => {
  assert.deepStrictEqual(languageOf(' KM '), { language: 'km', languageSetting: 'km' })
})

check('a value the editor never offers falls back to auto instead of reaching visitors', () => {
  for (const stored of ['zh-CN', 'fr', 'khmer', '<script>', '1']) {
    assert.deepStrictEqual(languageOf(stored), { language: 'en', languageSetting: 'auto' }, stored)
  }
})

console.log(`\nALL ${checks} CHECKS PASSED`)
