import assert from 'node:assert/strict'
import {
  FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS,
  getPortalLanguageText,
} from '../src/components/catalog/portalLanguagePacks.mjs'
import {
  localizePortalConfig,
  localizePortalFaqText,
} from '../src/components/catalog/portalContentI18n.mjs'

const config = {
  faqTitle: 'Frequently asked questions',
  faqItems: [
    {
      id: 'edited-default',
      question: 'How do I choose products for my skin type?',
      answer: 'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.',
    },
    {
      id: 'edited-vocab',
      question: 'Can I ask for sensitive skin products within a specific budget?',
      answer: 'Ask the store team for stock, alternatives, price range, and recommendations.',
    },
  ],
  translations: {},
}

const defaultFaqConfig = {
  faqTitle: 'Frequently asked questions',
  faqItems: [
    {
      id: 'default-products',
      question: 'How do I choose products for my skin type?',
      answer: 'Tell us your skin type, concerns, and what kind of routine you want. We can recommend suitable skincare, cosmetics, hair, or body products from our available stock.',
    },
    {
      id: 'default-stock',
      question: 'Are the products shown here available in store?',
      answer: 'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.',
    },
    {
      id: 'default-points',
      question: 'How do I check my membership points?',
      answer: 'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.',
    },
    {
      id: 'default-out-of-stock',
      question: 'What should I do if an item is out of stock?',
      answer: 'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.',
    },
  ],
  translations: {},
}

const localized = localizePortalConfig(config, 'zh-CN')
assert.notEqual(localized.faqItems[0].question, config.faqItems[0].question)
assert.notEqual(localized.faqItems[0].answer, config.faqItems[0].answer)
assert.match(localized.faqItems[0].question, /肤质|产品/)

const fallbackText = localizePortalFaqText(config.faqItems[1].question, 'zh-CN')
assert.notEqual(fallbackText, config.faqItems[1].question)
assert.match(fallbackText, /敏感肌|预算|产品/)

const english = localizePortalConfig(config, 'en')
assert.equal(english.faqItems[0].question, config.faqItems[0].question)

const firstPartyLanguages = FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS
  .map((option) => option.value)
  .filter((language) => language !== 'en')

for (const language of firstPartyLanguages) {
  const localizedDefault = localizePortalConfig(defaultFaqConfig, language)
  assert.notEqual(localizedDefault.faqTitle, defaultFaqConfig.faqTitle, `${language} faq title should localize`)
  localizedDefault.faqItems.forEach((item, index) => {
    const original = defaultFaqConfig.faqItems[index]
    assert.notEqual(item.question, original.question, `${language} question ${index + 1} should localize`)
    assert.notEqual(item.answer, original.answer, `${language} answer ${index + 1} should localize`)
    assert.doesNotMatch(item.question, /\b(products|membership points|available in store|skin type|out of stock)\b/i, `${language} question ${index + 1} still has public English fragments`)
    assert.doesNotMatch(item.answer, /\b(products|membership points|available in store|skin type|out of stock)\b/i, `${language} answer ${index + 1} still has public English fragments`)
  })

  const edited = localizePortalFaqText('Can I ask for sensitive skin products within a specific budget?', language)
  assert.notEqual(edited, 'Can I ask for sensitive skin products within a specific budget?', `${language} edited FAQ should use vocabulary fallback`)
  assert.doesNotMatch(edited, /\b(sensitive skin|products|specific budget)\b/i, `${language} edited FAQ still has key English fragments`)
}

const protectedCopy = localizePortalFaqText(
  'Contact Leang Cosmetics through Facebook, Instagram, Telegram, or phone for product stock advice.',
  'km',
)
assert.match(protectedCopy, /Leang Cosmetics/)
assert.match(protectedCopy, /Facebook/)
assert.match(protectedCopy, /Instagram/)
assert.match(protectedCopy, /Telegram/)
assert.notEqual(protectedCopy, 'Contact Leang Cosmetics through Facebook, Instagram, Telegram, or phone for product stock advice.')

for (const language of firstPartyLanguages) {
  for (const key of ['faqTitle', 'aiTitle', 'products', 'membership', 'stockStatus', 'filters']) {
    assert.ok(getPortalLanguageText(language, key), `${language}.${key} must be present for public portal vocabulary coverage`)
  }
}

console.log('PASS portal FAQ vocabulary fallback')
