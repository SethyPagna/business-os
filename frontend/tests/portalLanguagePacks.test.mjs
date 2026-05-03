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
assert.equal(getPortalLanguageText('zh-CN', 'products'), '产品')
assert.equal(getPortalLanguageText('zh-TW', 'products'), '產品')
assert.equal(getPortalLanguageText('vi', 'membership'), 'Thành viên')
assert.equal(getPortalLanguageText('th', 'search'), 'ค้นหาสินค้า')
assert.equal(getPortalLanguageText('ru', 'noProducts'), 'Товары по текущим фильтрам не найдены.')

for (const option of FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS) {
  assert.doesNotMatch(option.nativeLabel || '', /Ã|Â|Ð|Ñ|à¸|áº|Ø|Ù|�/, `${option.value} native label is mojibake`)
  for (const key of ['products', 'membership', 'search', 'noProducts']) {
    const text = getPortalLanguageText(option.value, key)
    if (!text) continue
    assert.doesNotMatch(text, /Ã|Â|Ð|Ñ|à¸|áº|Ø|Ù|�/, `${option.value}.${key} is mojibake`)
  }
}

assert.equal(getPortalLanguageText('zh-CN', 'businessName'), '')
assert.equal(getPortalLanguageText('fr', 'portalIntro'), '')
assert.equal(getPortalLanguageText('es', 'businessTagline'), '')

console.log('portalLanguagePacks tests passed')
