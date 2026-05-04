import assert from 'node:assert/strict'
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

const localized = localizePortalConfig(config, 'zh-CN')
assert.notEqual(localized.faqItems[0].question, config.faqItems[0].question)
assert.notEqual(localized.faqItems[0].answer, config.faqItems[0].answer)
assert.match(localized.faqItems[0].question, /肤质|产品/)

const fallbackText = localizePortalFaqText(config.faqItems[1].question, 'zh-CN')
assert.notEqual(fallbackText, config.faqItems[1].question)
assert.match(fallbackText, /敏感肌|预算|产品/)

const english = localizePortalConfig(config, 'en')
assert.equal(english.faqItems[0].question, config.faqItems[0].question)

console.log('PASS portal FAQ vocabulary fallback')
