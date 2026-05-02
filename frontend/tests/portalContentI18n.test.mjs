import assert from 'node:assert/strict'
import {
  localizePortalConfig,
  localizePortalProduct,
  normalizePortalTranslations,
  stringifyPortalTranslations,
} from '../src/components/catalog/portalContentI18n.mjs'

const config = {
  businessName: 'Leang Cosmetic',
  businessTagline: 'Glow daily',
  intro: 'Browse our newest products.',
  aboutTitle: 'About us',
  aboutContent: 'Original about body',
  aiTitle: 'Beauty Assistant',
  aiIntro: 'Ask for help',
  faqTitle: 'Questions',
  faqItems: [
    { id: 'faq-shipping', question: 'Do you deliver?', answer: 'Yes, ask staff.' },
  ],
  aboutBlocks: [
    { id: 'about-hours', title: 'Store hours', body: 'Open every day.' },
  ],
  linkLabels: { website: 'Website', facebook: 'Facebook' },
  translations: {
    'zh-CN': {
      aboutTitle: '关于我们',
      aboutContent: '中文关于内容',
      aiTitle: '美容顾问',
      fields: {
        aiIntro: '告诉我们你的需求',
      },
      faqItems: {
        'faq-shipping': { question: '可以配送吗？', answer: '可以，请联系店员。' },
      },
      aboutBlocks: {
        'about-hours': { title: '营业时间', body: '每天营业。' },
      },
      linkLabels: { website: '网站' },
    },
  },
}

const localized = localizePortalConfig(config, 'zh-cn')
assert.equal(localized.aboutTitle, '关于我们')
assert.equal(localized.aboutContent, '中文关于内容')
assert.equal(localized.aiTitle, '美容顾问')
assert.equal(localized.aiIntro, '告诉我们你的需求')
assert.equal(localized.faqItems[0].question, '可以配送吗？')
assert.equal(localized.faqItems[0].answer, '可以，请联系店员。')
assert.equal(localized.aboutBlocks[0].title, '营业时间')
assert.equal(localized.aboutBlocks[0].body, '每天营业。')
assert.equal(localized.linkLabels.website, '网站')
assert.equal(localized.linkLabels.facebook, 'Facebook')

assert.equal(localized.businessName, 'Leang Cosmetic')
assert.equal(localized.businessTagline, 'Glow daily')
assert.equal(localized.intro, 'Browse our newest products.')

const product = localizePortalProduct({
  id: 123,
  name: 'AHA Serum',
  description: 'Brightening serum',
  category: 'Skincare',
  translations: {
    'zh-CN': {
      description: '焕亮精华',
      category: '护肤',
    },
  },
}, 'zh-CN')

assert.equal(product.name, 'AHA Serum')
assert.equal(product.description, '焕亮精华')
assert.equal(product.category, '护肤')

assert.deepEqual(normalizePortalTranslations('bad json'), {})
assert.equal(stringifyPortalTranslations({ vi: { aboutTitle: 'Giới thiệu' } }).includes('Giới thiệu'), true)

console.log('portalContentI18n tests passed')
