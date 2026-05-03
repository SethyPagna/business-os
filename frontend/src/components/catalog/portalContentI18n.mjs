import { getPortalLanguageText } from './portalLanguagePacks.mjs'

const TRANSLATABLE_CONFIG_FIELDS = [
  'aboutTitle',
  'aboutContent',
  'aiTitle',
  'aiIntro',
  'aiDisclaimer',
  'faqTitle',
  'membershipInfoText',
  'submissionInstructions',
]

const DEFAULT_CONFIG_COPY_KEYS = {
  aboutTitle: ['About us', 'aboutTitle'],
  aiTitle: ['Beauty Assistant', 'aiTitle'],
  aiIntro: ['Tell us what you are shopping for and the assistant will suggest products from Leang Cosmetics.', 'aiIntro'],
  aiDisclaimer: ['AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.', 'aiDisclaimer'],
  faqTitle: ['Frequently asked questions', 'faqTitle'],
}

const PRODUCT_TRANSLATABLE_FIELDS = [
  'name',
  'description',
  'category',
  'brand',
]

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLanguageKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (lower === 'zh-cn') return 'zh-CN'
  if (lower === 'zh-tw') return 'zh-TW'
  return lower
}

function normalizeText(value) {
  return String(value || '').normalize('NFC').trim()
}

export function normalizePortalTranslations(value) {
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

export function stringifyPortalTranslations(value) {
  const normalized = normalizePortalTranslations(value)
  if (!Object.keys(normalized).length) return '{}'
  return JSON.stringify(normalized, null, 2)
}

function getLanguageBlock(translations, language) {
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

function pickTranslatedText(block, field, fallback) {
  if (!isPlainObject(block)) return fallback
  const candidates = [
    block[field],
    block.fields?.[field],
    block.text?.[field],
  ]
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }
  return fallback
}

function pickDefaultFirstPartyText(language, field, fallback) {
  const [englishDefault, resourceKey] = DEFAULT_CONFIG_COPY_KEYS[field] || []
  if (!englishDefault || normalizeLanguageKey(language) === 'en') return fallback
  if (normalizeText(fallback) !== normalizeText(englishDefault)) return fallback
  return getPortalLanguageText(language, resourceKey) || fallback
}

function getCollectionEntry(collection, id, index) {
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

function localizeCollectionItems(items, collection, fields) {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  return items.map((item, index) => {
    const entry = getCollectionEntry(collection, item?.id, index)
    if (!Object.keys(entry).length) return item
    const next = { ...item }
    fields.forEach((field) => {
      next[field] = pickTranslatedText(entry, field, next[field])
    })
    return next
  })
}

export function localizePortalConfig(config, language) {
  const source = isPlainObject(config) ? config : {}
  const translations = normalizePortalTranslations(source.translations)
  const langBlock = getLanguageBlock(translations, language)

  const next = { ...source, translations }
  TRANSLATABLE_CONFIG_FIELDS.forEach((field) => {
    next[field] = pickDefaultFirstPartyText(language, field, pickTranslatedText(langBlock, field, next[field]))
  })

  if (isPlainObject(source.linkLabels) && isPlainObject(langBlock.linkLabels)) {
    next.linkLabels = { ...source.linkLabels }
    Object.keys(next.linkLabels).forEach((key) => {
      next.linkLabels[key] = pickTranslatedText(langBlock.linkLabels, key, next.linkLabels[key])
    })
  }

  next.aboutBlocks = localizeCollectionItems(source.aboutBlocks, langBlock.aboutBlocks, ['title', 'body'])
  next.faqItems = localizeCollectionItems(source.faqItems, langBlock.faqItems, ['question', 'answer'])

  return next
}

function getProductTranslationBlock(product, language, portalTranslations, index) {
  const productTranslations = normalizePortalTranslations(product?.translations || product?.i18n || product?.localized)
  const productBlock = getLanguageBlock(productTranslations, language)
  if (Object.keys(productBlock).length) return productBlock

  const langBlock = getLanguageBlock(portalTranslations, language)
  const products = langBlock.products || langBlock.catalogProducts || langBlock.catalog
  return getCollectionEntry(products, product?.id, index)
}

export function localizePortalProduct(product, language, portalTranslations, index = 0) {
  if (!isPlainObject(product)) return product
  const block = getProductTranslationBlock(product, language, portalTranslations, index)
  if (!Object.keys(block).length) return product
  const next = { ...product }
  PRODUCT_TRANSLATABLE_FIELDS.forEach((field) => {
    next[field] = pickTranslatedText(block, field, next[field])
  })
  return next
}

export function localizePortalProducts(products, language, portalTranslations) {
  if (!Array.isArray(products) || !products.length) return Array.isArray(products) ? products : []
  return products.map((product, index) => localizePortalProduct(product, language, portalTranslations, index))
}
