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
assert.notEqual(getPortalLanguageText('zh-CN', 'liveCatalog'), 'Live inventory, customer-safe details only.')
assert.notEqual(getPortalLanguageText('zh-CN', 'filterCompactHint'), 'Use quick filters to narrow products faster.')
assert.notEqual(getPortalLanguageText('zh-CN', 'aiTitle'), 'Beauty Assistant')
assert.notEqual(getPortalLanguageText('zh-CN', 'faqHint'), 'Add your most common customer questions here. Customers can open each answer one by one.')
assert.notEqual(getPortalLanguageText('vi', 'membership'), 'Membership')
assert.notEqual(getPortalLanguageText('th', 'search'), 'Search products')
assert.notEqual(getPortalLanguageText('ru', 'noProducts'), 'No products matched the current filters.')
assert.equal(getPortalLanguageText('zh-CN', 'products'), '\u4ea7\u54c1')
assert.equal(getPortalLanguageText('zh-TW', 'products'), '\u7522\u54c1')
assert.equal(getPortalLanguageText('vi', 'membership'), 'Th\u00e0nh vi\u00ean')
assert.equal(getPortalLanguageText('th', 'search'), '\u0e04\u0e49\u0e19\u0e2b\u0e32\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32')
assert.equal(getPortalLanguageText('ru', 'noProducts'), '\u0422\u043e\u0432\u0430\u0440\u044b \u043f\u043e \u0442\u0435\u043a\u0443\u0449\u0438\u043c \u0444\u0438\u043b\u044c\u0442\u0440\u0430\u043c \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.')

const mojibakePattern = /\u00c3|\u00c2|\u00e2\u20ac|\u00e1\u017e|\u00e1\u0178|\u00e0\u00b8|\u00e1\u00ba|\u00d0|\u00d1|\u00d8|\u00d9|\ufffd/

for (const option of FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS) {
  assert.doesNotMatch(option.nativeLabel || '', mojibakePattern, `${option.value} native label is mojibake`)
  for (const key of ['products', 'membership', 'search', 'searchPlaceholder', 'noProducts', 'filters', 'loadingProducts', 'aboutTitle', 'faqTitle', 'aiTitle', 'assistantQuestion', 'switch_to_dark_mode']) {
    const text = getPortalLanguageText(option.value, key)
    if (!text) continue
    assert.doesNotMatch(text, mojibakePattern, `${option.value}.${key} is mojibake`)
  }
}
assert.equal(getPortalLanguageText('zh-CN', 'businessName'), '')
assert.equal(getPortalLanguageText('fr', 'portalIntro'), '')
assert.equal(getPortalLanguageText('es', 'businessTagline'), '')

console.log('portalLanguagePacks tests passed')
