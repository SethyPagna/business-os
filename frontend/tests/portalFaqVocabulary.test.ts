import assert from 'node:assert/strict'
import {
  FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS,
  getPortalLanguageText,
} from '../src/components/catalog/portalLanguagePacks.ts'
import {
  localizePortalConfig,
  localizePortalFaqText,
} from '../src/components/catalog/portalContentI18n.ts'
import { FAQ_STARTER_TEXT } from '../src/components/catalog/faqStarterText.ts'

type LocalizedFaqItem = { question: string; answer: string }
type LocalizedPortalConfig = {
  faqTitle: string
  faqItems: LocalizedFaqItem[]
}

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

const localized = localizePortalConfig(config, 'zh-CN') as LocalizedPortalConfig
assert.notEqual(localized.faqItems[0].question, config.faqItems[0].question)
assert.notEqual(localized.faqItems[0].answer, config.faqItems[0].answer)
assert.match(localized.faqItems[0].question, /肤质|产品/)

const fallbackText = String(localizePortalFaqText(config.faqItems[1].question, 'zh-CN'))
assert.notEqual(fallbackText, config.faqItems[1].question)
assert.match(fallbackText, /敏感肌|预算|产品/)

const english = localizePortalConfig(config, 'en') as LocalizedPortalConfig
assert.equal(english.faqItems[0].question, config.faqItems[0].question)

const firstPartyLanguages = FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS
  .map((option) => option.value)
  .filter((language) => language !== 'en')

for (const language of firstPartyLanguages) {
  const localizedDefault = localizePortalConfig(defaultFaqConfig, language) as LocalizedPortalConfig
  assert.notEqual(localizedDefault.faqTitle, defaultFaqConfig.faqTitle, `${language} faq title should localize`)
  localizedDefault.faqItems.forEach((item, index) => {
    const original = defaultFaqConfig.faqItems[index]
    assert.notEqual(item.question, original.question, `${language} question ${index + 1} should localize`)
    assert.notEqual(item.answer, original.answer, `${language} answer ${index + 1} should localize`)
    assert.doesNotMatch(item.question, /\b(products|membership points|available in store|skin type|out of stock)\b/i, `${language} question ${index + 1} still has public English fragments`)
    assert.doesNotMatch(item.answer, /\b(products|membership points|available in store|skin type|out of stock)\b/i, `${language} answer ${index + 1} still has public English fragments`)
  })

  const edited = String(localizePortalFaqText('Can I ask for sensitive skin products within a specific budget?', language))
  assert.notEqual(edited, 'Can I ask for sensitive skin products within a specific budget?', `${language} edited FAQ should use vocabulary fallback`)
  assert.doesNotMatch(edited, /\b(sensitive skin|products|specific budget)\b/i, `${language} edited FAQ still has key English fragments`)
}

const protectedCopy = String(localizePortalFaqText(
  'Contact Leang Beauty through Facebook, Instagram, Telegram, or phone for product stock advice.',
  'km',
))
assert.match(protectedCopy, /Leang Beauty/)
assert.match(protectedCopy, /Facebook/)
assert.match(protectedCopy, /Instagram/)
assert.match(protectedCopy, /Telegram/)
assert.notEqual(protectedCopy, 'Contact Leang Beauty through Facebook, Instagram, Telegram, or phone for product stock advice.')

for (const language of firstPartyLanguages) {
  for (const key of ['faqTitle', 'aiTitle', 'products', 'membership', 'stockStatus', 'filters']) {
    assert.ok(getPortalLanguageText(language, key), `${language}.${key} must be present for public portal vocabulary coverage`)
  }
}

// The five starter FAQ items added after the original set (delivery,
// payment, store hours, authenticity, promotions) exercise both the zh-CN
// exact-dictionary path and the vocabulary-substitution fallback every other
// first-party language relies on.
//
// These are READ FROM THE SHIPPED DEFAULTS, never re-typed here. The block
// used to be a hand-copied duplicate of the strings in CatalogPage.tsx,
// which meant the guard went on passing against wording the storefront had
// stopped using -- it was still asserting the retired "100% authentic"
// guarantee after that claim was rewritten. Importing the source of truth is
// what makes this test able to notice (N45).
const newStarterFaq = FAQ_STARTER_TEXT.filter(([index]) => ['21', '22', '23', '24', '25'].includes(index))
  .map(([, question, answer]) => ({ question, answer }))
assert.equal(newStarterFaq.length, 5, 'the five later starter FAQ items must still exist in faqStarterText.ts')

// No default FAQ answer may make a claim the shop cannot be asked to prove.
// "100% authentic", "guarantee", "certified" and the like are the app
// speaking for the merchant, and a consumer-protection complaint does not
// care that a template wrote it.
const UNSUPPORTED_CLAIM = /(100%|guarantee[ds]?|certified|clinically proven|cures?|guaranteed authentic)/i
for (const [index, question, answer] of FAQ_STARTER_TEXT) {
  assert.doesNotMatch(question, UNSUPPORTED_CLAIM, `starter FAQ ${index} question makes an unsupported claim`)
  assert.doesNotMatch(answer, UNSUPPORTED_CLAIM, `starter FAQ ${index} answer makes an unsupported claim`)
}
const newStarterFaqLeakPattern = /\b(delivery|payment|store hours|authentic|promotions|discounts)\b/i

const zhCnLocalized = newStarterFaq.map((item) => ({
  question: String(localizePortalFaqText(item.question, 'zh-CN')),
  answer: String(localizePortalFaqText(item.answer, 'zh-CN')),
}))
zhCnLocalized.forEach((item, index) => {
  assert.notEqual(item.question, newStarterFaq[index].question, `zh-CN new FAQ question ${index + 1} should localize`)
  assert.notEqual(item.answer, newStarterFaq[index].answer, `zh-CN new FAQ answer ${index + 1} should localize`)
  assert.doesNotMatch(item.answer, newStarterFaqLeakPattern, `zh-CN new FAQ answer ${index + 1} still has key English fragments`)
})

for (const language of firstPartyLanguages) {
  newStarterFaq.forEach((item, index) => {
    const question = String(localizePortalFaqText(item.question, language))
    const answer = String(localizePortalFaqText(item.answer, language))
    assert.notEqual(question, item.question, `${language} new FAQ question ${index + 1} should localize`)
    assert.notEqual(answer, item.answer, `${language} new FAQ answer ${index + 1} should localize`)
    assert.doesNotMatch(answer, newStarterFaqLeakPattern, `${language} new FAQ answer ${index + 1} still has key English fragments`)
  })
}

console.log('PASS portal FAQ vocabulary fallback')
