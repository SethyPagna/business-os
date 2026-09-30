import assert from 'node:assert/strict'
import {
  localizePortalConfig,
  localizePortalProduct,
  normalizePortalTranslations,
  stringifyPortalTranslations,
} from '../src/components/catalog/portalContentI18n.ts'

type LocalizedFaqItem = { question: string; answer: string }
type LocalizedAboutBlock = { title: string; body: string }
type LocalizedPortalConfig = {
  businessName?: string
  businessTagline?: string
  intro?: string
  aboutTitle?: string
  aboutContent?: string
  aiTitle?: string
  aiIntro?: string
  faqTitle?: string
  faqItems: LocalizedFaqItem[]
  aboutBlocks: LocalizedAboutBlock[]
  linkLabels: Record<string, string>
}
type LocalizedPortalProduct = {
  name?: string
  description?: string
  category?: string
}

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
    km: {
      aboutTitle: 'អំពីហាងយើង',
      aboutContent: 'ខ្លឹមសារអំពីហាង',
      aiTitle: 'ជំនួយការសម្រស់',
      fields: {
        aiIntro: 'ប្រាប់យើងពីអ្វីដែលអ្នកចង់បាន',
      },
      faqItems: {
        'faq-shipping': { question: 'តើអាចដឹកជញ្ជូនបានទេ?', answer: 'បាន សូមសួរបុគ្គលិក។' },
      },
      aboutBlocks: {
        'about-hours': { title: 'ម៉ោងបើកហាង', body: 'បើករាល់ថ្ងៃ។' },
      },
      linkLabels: { website: 'គេហទំព័រហាង' },
    },
  },
}

const localized = localizePortalConfig(config, 'KM') as LocalizedPortalConfig
assert.equal(localized.aboutTitle, 'អំពីហាងយើង')
assert.equal(localized.aboutContent, 'ខ្លឹមសារអំពីហាង')
assert.equal(localized.aiTitle, 'ជំនួយការសម្រស់')
assert.equal(localized.aiIntro, 'ប្រាប់យើងពីអ្វីដែលអ្នកចង់បាន')
assert.equal(localized.faqItems[0].question, 'តើអាចដឹកជញ្ជូនបានទេ?')
assert.equal(localized.faqItems[0].answer, 'បាន សូមសួរបុគ្គលិក។')
assert.equal(localized.aboutBlocks[0].title, 'ម៉ោងបើកហាង')
assert.equal(localized.aboutBlocks[0].body, 'បើករាល់ថ្ងៃ។')
assert.equal(localized.linkLabels.website, 'គេហទំព័រហាង')
assert.equal(localized.linkLabels.facebook, 'Facebook')

assert.equal(localized.businessName, 'Leang Cosmetic')
assert.equal(localized.businessTagline, 'Glow daily')
assert.equal(localized.intro, 'Browse our newest products.')

const defaultCopyLocalized = localizePortalConfig({
  aboutTitle: 'About us',
  aiTitle: 'Beauty Assistant',
  aiIntro: 'Tell us what you are shopping for and the assistant will suggest products from Leang Beauty.',
  aiDisclaimer: 'AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.',
  faqTitle: 'Frequently asked questions',
  translations: {},
}, 'km') as LocalizedPortalConfig

assert.notEqual(defaultCopyLocalized.aboutTitle, 'About us')
assert.notEqual(defaultCopyLocalized.aiTitle, 'Beauty Assistant')
assert.notEqual(defaultCopyLocalized.faqTitle, 'Frequently asked questions')

const product = localizePortalProduct({
  id: 123,
  name: 'AHA Serum',
  description: 'Brightening serum',
  category: 'Skincare',
  translations: {
    km: {
      description: 'សេរ៉ូមធ្វើឱ្យស្បែកភ្លឺ',
      category: 'ថែរក្សាស្បែក',
    },
  },
}, 'km') as LocalizedPortalProduct

assert.equal(product.name, 'AHA Serum')
assert.equal(product.description, 'សេរ៉ូមធ្វើឱ្យស្បែកភ្លឺ')
assert.equal(product.category, 'ថែរក្សាស្បែក')

assert.deepEqual(normalizePortalTranslations('bad json'), {})
assert.equal(stringifyPortalTranslations({ km: { aboutTitle: 'អំពីយើង' } }).includes('អំពីយើង'), true)

console.log('portalContentI18n tests passed')
