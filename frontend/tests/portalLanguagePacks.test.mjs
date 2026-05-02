import assert from 'node:assert/strict'
import {
  FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS,
  getPortalLanguageText,
  isFirstPartyPortalLanguage,
  normalizeFirstPartyPortalLanguage,
} from '../src/components/catalog/portalLanguagePacks.mjs'

const values = FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS.map((option) => option.value)

for (const required of ['en', 'km', 'zh-CN', 'zh-TW', 'vi', 'th', 'ru', 'fr', 'es']) {
  assert.ok(values.includes(required), `missing first-party portal language ${required}`)
}

assert.equal(normalizeFirstPartyPortalLanguage('zh-cn'), 'zh-CN')
assert.equal(normalizeFirstPartyPortalLanguage('ZH-TW'), 'zh-TW')
assert.equal(normalizeFirstPartyPortalLanguage('vi'), 'vi')
assert.equal(isFirstPartyPortalLanguage('ru'), true)
assert.equal(isFirstPartyPortalLanguage('fa'), false)

assert.notEqual(getPortalLanguageText('zh-CN', 'products'), 'Products')
assert.notEqual(getPortalLanguageText('vi', 'membership'), 'Membership')
assert.notEqual(getPortalLanguageText('th', 'search'), 'Search products')
assert.notEqual(getPortalLanguageText('ru', 'noProducts'), 'No products matched the current filters.')

assert.equal(getPortalLanguageText('zh-CN', 'businessName'), '')
assert.equal(getPortalLanguageText('fr', 'portalIntro'), '')
assert.equal(getPortalLanguageText('es', 'businessTagline'), '')

console.log('portalLanguagePacks tests passed')
