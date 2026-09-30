import { defaultConfigText } from './portalLanguagePacks.ts'

type PlainRecord = Record<string, unknown>
type TextRecord = Record<string, string>
type TextRecordByLanguage = Record<string, TextRecord>
type PublicCopyPlaceholder = [token: string, original: string]

const TRANSLATABLE_CONFIG_FIELDS = [
  'aboutTitle',
  'aboutContent',
  'aiTitle',
  'aiIntro',
  'aiDisclaimer',
  'faqTitle',
  'membershipInfoText',
  'promotionsTitle',
  'promotionsIntro',
  'submissionInstructions',
]

const PRODUCT_TRANSLATABLE_FIELDS = [
  'name',
  'description',
  'category',
  'brand',
]

const FAQ_VOCABULARY_BY_LANGUAGE: TextRecordByLanguage = {
  km: {
    'sensitive skin': 'ស្បែកងាយប្រតិកម្ម',
    'skin type': 'ប្រភេទស្បែក',
    products: 'ផលិតផល',
    product: 'ផលិតផល',
    membership: 'សមាជិក',
    points: 'ពិន្ទុ',
    stock: 'ស្តុក',
    alternatives: 'ជម្រើសជំនួស',
    alternative: 'ជម្រើសជំនួស',
    budget: 'ថវិកា',
    price: 'តម្លៃ',
    skincare: 'ថែរក្សាស្បែក',
    makeup: 'គ្រឿងសម្អាង',
    hair: 'សក់',
    body: 'រាងកាយ',
    fragrance: 'ក្លិនក្រអូប',
    perfume: 'ទឹកអប់',
    brand: 'ម៉ាក',
    store: 'ហាង',
    recommendations: 'ការណែនាំ',
    recommend: 'ណែនាំ',
  },
}

const DEFAULT_FAQ_TEXT_BY_LANGUAGE: TextRecordByLanguage = {
  km: {
    'How do I choose products for my skin type?': 'តើខ្ញុំគួរជ្រើសរើសផលិតផលសម្រាប់ប្រភេទស្បែករបស់ខ្ញុំដោយរបៀបណា?',
    'Tell us your skin type, concerns, and what kind of routine you want. We can recommend suitable skincare, cosmetics, hair, or body products from our available stock.': 'ប្រាប់យើងពីប្រភេទស្បែក បញ្ហាស្បែក និងរបៀបថែរក្សាដែលអ្នកចង់បាន។ យើងអាចណែនាំផលិតផលថែរក្សាស្បែក គ្រឿងសម្អាង សក់ ឬរាងកាយដែលសមស្របពីស្តុកបច្ចុប្បន្ន។',
    'Are the products shown here available in store?': 'តើផលិតផលដែលបង្ហាញនៅទីនេះមាននៅហាងដែរឬទេ?',
    'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.': 'ទំព័រនេះអានពីកាតាឡុក Business OS បច្ចុប្បន្ន។ ស្តុកអាចផ្លាស់ប្តូរនៅពេលរវល់ ដូច្នេះសូមទាក់ទងហាង ប្រសិនបើអ្នកត្រូវការបញ្ជាក់ចុងក្រោយមុនទៅហាង។',
    'How do I check my membership points?': 'តើខ្ញុំអាចពិនិត្យពិន្ទុសមាជិកភាពរបស់ខ្ញុំដោយរបៀបណា?',
    'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.': 'បើកផ្នែកសមាជិកភាព បញ្ចូលលេខសមាជិករបស់អ្នក ហើយអ្នកអាចមើលប្រវត្តិទិញ ការត្រឡប់ និងពិន្ទុបច្ចុប្បន្នពីគណនីអតិថិជន។',
    'What should I do if an item is out of stock?': 'តើខ្ញុំគួរធ្វើដូចម្តេច ប្រសិនបើទំនិញអស់ស្តុក?',
    'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.': 'ប្រសិនបើទំនិញមិនមាន សូមផ្ញើសារទៅហាងតាម Facebook, Instagram, Telegram ឬទូរស័ព្ទ ដើម្បីឱ្យក្រុមការងារណែនាំជម្រើសជំនួស ឬបញ្ជាក់ពេលស្តុកផ្លាស់ប្តូរ។',
  },
}

const FAQ_VOCABULARY_EXTENSIONS_BY_LANGUAGE: TextRecordByLanguage = {
  km: {
    delivery: 'ការដឹកជញ្ជូន',
    payment: 'ការទូទាត់',
    'store hours': 'ម៉ោងបើកហាង',
    authentic: 'ទំនិញពិតប្រាកដ',
    promotions: 'ការផ្សព្វផ្សាយ',
    discounts: 'បញ្ចុះតម្លៃ',
    'available in store': 'មាននៅហាង',
    'membership points': 'ពិន្ទុសមាជិកភាព',
    'purchase history': 'ប្រវត្តិទិញ',
    'out of stock': 'អស់ស្តុក',
    'specific budget': 'ថវិកាជាក់លាក់',
    concerns: 'បញ្ហាស្បែក',
    routine: 'របៀបថែរក្សា',
    cosmetics: 'គ្រឿងសម្អាង',
    'hair care': 'ការថែសក់',
    'body care': 'ការថែទាំរាងកាយ',
    available: 'មាន',
    unavailable: 'មិនមាន',
    category: 'ប្រភេទ',
    categories: 'ប្រភេទ',
    branch: 'សាខា',
    item: 'ទំនិញ',
    items: 'ទំនិញ',
    assistant: 'ជំនួយការ',
    advice: 'ការណែនាំ',
    medical: 'វេជ្ជសាស្ត្រ',
    allergies: 'អាឡែហ្ស៊ី',
    oily: 'ស្បែកខ្លាញ់',
    dry: 'ស្បែកស្ងួត',
    combination: 'ស្បែកចម្រុះ',
    suitable: 'សមស្រប',
    contact: 'ទាក់ទង',
    phone: 'ទូរស័ព្ទ',
  },
}

Object.entries(FAQ_VOCABULARY_EXTENSIONS_BY_LANGUAGE).forEach(([language, vocabulary]) => {
  FAQ_VOCABULARY_BY_LANGUAGE[language] = {
    ...(FAQ_VOCABULARY_BY_LANGUAGE[language] || {}),
    ...vocabulary,
  }
})

const FAQ_FUTURE_EDIT_VOCABULARY_BY_LANGUAGE: TextRecordByLanguage = {
  km: { 'social media': 'បណ្ដាញសង្គម', screenshot: 'រូបថតអេក្រង់', gift: 'អំណោយ', bundles: 'កញ្ចប់', 'oily skin': 'ស្បែកខ្លាញ់', 'dry skin': 'ស្បែកស្ងួត', 'combination skin': 'ស្បែកចម្រុះ', morning: 'ពេលព្រឹក', night: 'ពេលយប់', 'for reference only': 'សម្រាប់យោងប៉ុណ្ណោះ', 'medical advice': 'ដំបូន្មានវេជ្ជសាស្ត្រ' },
}

Object.entries(FAQ_FUTURE_EDIT_VOCABULARY_BY_LANGUAGE).forEach(([language, vocabulary]) => {
  FAQ_VOCABULARY_BY_LANGUAGE[language] = {
    ...(FAQ_VOCABULARY_BY_LANGUAGE[language] || {}),
    ...vocabulary,
  }
})

const PUBLIC_COPY_PROTECTED_TERMS = [
  'Leang Beauty',
  'Leang Cosmetic',
  'Business OS',
  'Facebook',
  'Instagram',
  'Telegram',
]

function isPlainObject(value: unknown): value is PlainRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLanguageKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeText(value: unknown): string {
  return String(value || '').normalize('NFC').trim()
}

export function normalizePortalTranslations(value: unknown): PlainRecord {
  if (!value) return {}
  if (isPlainObject(value)) return value
  if (typeof value !== 'string') return {}
  const raw = value.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch (_) {
    return {}
  }
}

export function stringifyPortalTranslations(value: unknown): string {
  const normalized = normalizePortalTranslations(value)
  if (!Object.keys(normalized).length) return '{}'
  return JSON.stringify(normalized, null, 2)
}

function getLanguageBlock(translations: unknown, language: unknown): PlainRecord {
  const normalized = normalizePortalTranslations(translations)
  const key = normalizeLanguageKey(language)
  if (!key) return {}
  if (isPlainObject(normalized[key])) return normalized[key]
  const lowerMatch = Object.entries(normalized).find(([entryKey]) => normalizeLanguageKey(entryKey) === key)
  if (lowerMatch && isPlainObject(lowerMatch[1])) return lowerMatch[1]
  const base = key.split('-')[0]
  if (base && isPlainObject(normalized[base])) return normalized[base]
  return {}
}

function pickTranslatedText(block: unknown, field: string, fallback: unknown): unknown {
  if (!isPlainObject(block)) return fallback
  const fieldsBlock = isPlainObject(block.fields) ? block.fields : {}
  const textBlock = isPlainObject(block.text) ? block.text : {}
  const candidates = [
    block[field],
    fieldsBlock[field],
    textBlock[field],
  ]
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }
  return fallback
}

function pickDefaultFirstPartyText(language: unknown, field: string, fallback: unknown): unknown {
  return normalizeLanguageKey(language) === 'en' ? fallback : defaultConfigText(language, field, fallback)
}

function getCollectionEntry(collection: unknown, id: unknown, index: number): PlainRecord {
  if (!collection) return {}
  if (Array.isArray(collection)) {
    const byIndex = collection[index]
    if (isPlainObject(byIndex)) return byIndex
    return {}
  }
  if (!isPlainObject(collection)) return {}
  const idKey = String(id || '').trim()
  if (idKey && isPlainObject(collection[idKey])) return collection[idKey]
  const indexKey = String(index)
  if (isPlainObject(collection[indexKey])) return collection[indexKey]
  const oneBasedIndexKey = String(index + 1)
  if (isPlainObject(collection[oneBasedIndexKey])) return collection[oneBasedIndexKey]
  return {}
}

function localizeCollectionItems(
  items: unknown,
  collection: unknown,
  fields: string[],
): unknown[] {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  return items.map((item, index) => {
    if (!isPlainObject(item)) return item
    const entry = getCollectionEntry(collection, item?.id, index)
    if (!Object.keys(entry).length) return item
    const next = { ...item }
    fields.forEach((field) => {
      next[field] = pickTranslatedText(entry, field, next[field])
    })
    return next
  })
}

function getLanguageMap(source: TextRecordByLanguage, language: unknown): TextRecord | null {
  const key = normalizeLanguageKey(language)
  if (!key || key === 'en') return null
  if (isPlainObject(source[key])) return source[key]
  const base = key.split('-')[0]
  if (base && isPlainObject(source[base])) return source[base]
  return null
}

function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function protectPublicCopyTerms(value: unknown): { text: string, placeholders: PublicCopyPlaceholder[] } {
  let text = String(value || '')
  const placeholders: PublicCopyPlaceholder[] = []
  PUBLIC_COPY_PROTECTED_TERMS.forEach((term) => {
    const pattern = new RegExp(escapeRegExp(term), 'g')
    text = text.replace(pattern, (match) => {
      const token = `__BUSINESS_OS_PUBLIC_TERM_${placeholders.length}__`
      placeholders.push([token, match])
      return token
    })
  })
  return { text, placeholders }
}

function restorePublicCopyTerms(value: unknown, placeholders: PublicCopyPlaceholder[]): string {
  return placeholders.reduce((text, [token, original]) => text.replaceAll(token, original), String(value || ''))
}

export function localizePortalFaqText(value: unknown, language: unknown): unknown {
  const raw = normalizeText(value)
  const key = normalizeLanguageKey(language)
  if (!raw || !key || key === 'en') return value

  const exactMap = getLanguageMap(DEFAULT_FAQ_TEXT_BY_LANGUAGE, language)
  const exact = exactMap?.[raw]
  if (normalizeText(exact)) return exact

  const vocabulary = getLanguageMap(FAQ_VOCABULARY_BY_LANGUAGE, language)
  if (!vocabulary) return value

  const protectedCopy = protectPublicCopyTerms(value)
  let localized = protectedCopy.text
  const entries = Object.entries(vocabulary)
    .filter(([term, translation]) => normalizeText(term) && normalizeText(translation))
    .sort((left, right) => right[0].length - left[0].length)

  entries.forEach(([term, translation]) => {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
    localized = localized.replace(pattern, translation)
  })

  return restorePublicCopyTerms(localized, protectedCopy.placeholders)
}

function localizeFaqItems(items: unknown, collection: unknown, language: unknown): unknown[] {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  const localized = localizeCollectionItems(items, collection, ['question', 'answer'])
  return localized.map((item, index) => {
    if (!isPlainObject(item)) return item
    const entry = getCollectionEntry(collection, item?.id, index)
    const next = { ...item }
    ;['question', 'answer'].forEach((field) => {
      const explicit = normalizeText(pickTranslatedText(entry, field, ''))
      if (!explicit) next[field] = localizePortalFaqText(next[field], language)
    })
    return next
  })
}

export function localizePortalConfig(config: unknown, language: unknown): PlainRecord {
  const source = isPlainObject(config) ? config : {}
  const translations = normalizePortalTranslations(source.translations)
  const langBlock = getLanguageBlock(translations, language)

  const next: PlainRecord = { ...source, translations }
  TRANSLATABLE_CONFIG_FIELDS.forEach((field) => {
    next[field] = pickDefaultFirstPartyText(language, field, pickTranslatedText(langBlock, field, next[field]))
  })

  if (isPlainObject(source.linkLabels) && isPlainObject(langBlock.linkLabels)) {
    const nextLinkLabels: PlainRecord = { ...source.linkLabels }
    Object.keys(nextLinkLabels).forEach((key) => {
      nextLinkLabels[key] = pickTranslatedText(langBlock.linkLabels, key, nextLinkLabels[key])
    })
    next.linkLabels = nextLinkLabels
  }

  next.aboutBlocks = localizeCollectionItems(source.aboutBlocks, langBlock.aboutBlocks, ['title', 'body'])
  next.promoItems = localizeCollectionItems(source.promoItems, langBlock.promoItems, ['eyebrow', 'title', 'subtitle', 'body', 'ctaLabel'])
  next.faqItems = localizeFaqItems(source.faqItems, langBlock.faqItems, language)

  return next
}

function getProductTranslationBlock(product: unknown, language: unknown, portalTranslations: unknown, index: number): PlainRecord {
  const source = isPlainObject(product) ? product : {}
  const productTranslations = normalizePortalTranslations(source.translations || source.i18n || source.localized)
  const productBlock = getLanguageBlock(productTranslations, language)
  if (Object.keys(productBlock).length) return productBlock

  const langBlock = getLanguageBlock(portalTranslations, language)
  const products = langBlock.products || langBlock.catalogProducts || langBlock.catalog
  return getCollectionEntry(products, source.id, index)
}

export function localizePortalProduct<TProduct>(product: TProduct, language: unknown, portalTranslations?: unknown, index = 0): TProduct | PlainRecord {
  if (!isPlainObject(product)) return product
  const block = getProductTranslationBlock(product, language, portalTranslations, index)
  if (!Object.keys(block).length) return product
  const next: PlainRecord = { ...product }
  PRODUCT_TRANSLATABLE_FIELDS.forEach((field) => {
    next[field] = pickTranslatedText(block, field, next[field])
  })
  return next
}

export function localizePortalProducts<TProduct>(products: TProduct[], language: unknown, portalTranslations?: unknown): TProduct[] {
  if (!Array.isArray(products) || !products.length) return Array.isArray(products) ? products : []
  return products.map((product, index) => localizePortalProduct(product, language, portalTranslations, index) as TProduct)
}
