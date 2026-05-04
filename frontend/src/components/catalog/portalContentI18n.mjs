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

const DEFAULT_FAQ_TEXT_BY_LANGUAGE = {
  'zh-CN': {
    'How do I choose products for my skin type?': '如何根据我的肤质选择产品？',
    'Tell us your skin type, concerns, and what kind of routine you want. We can recommend suitable skincare, cosmetics, hair, or body products from our available stock.': '告诉我们你的肤质、护理困扰和想要的日常步骤。我们会从现有库存中推荐合适的护肤、彩妆、护发或身体护理产品。',
    'Are the products shown here available in store?': '这里显示的产品店里有货吗？',
    'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.': '本页面读取当前 Business OS 商品目录。繁忙时库存可能变化，到店前如需最终确认，请联系门店。',
    'How do I check my membership points?': '如何查询我的会员积分？',
    'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.': '打开会员页面，输入会员编号，即可查看购买记录、退货记录和当前积分。',
    'How does Share & Reward work?': '分享奖励如何运作？',
    'Share our store on social media, upload your screenshot in the portal, and our staff will review it. Approved submissions can receive reward points in your membership account.': '在社交媒体分享本店后，在页面上传截图，工作人员会进行审核。通过后奖励积分会加入你的会员账户。',
    'How can I contact Leang Cosmetics for more accurate advice?': '如何联系 Leang Cosmetics 获得更准确的建议？',
    'Use the social links on this page or call the store directly. Our team can help with product matching, stock checks, and more specific skincare or makeup questions.': '你可以使用本页的社交链接或直接致电门店。团队可以协助产品匹配、库存确认，以及更具体的护肤或彩妆问题。',
    'Do you have products for sensitive skin?': '有适合敏感肌的产品吗？',
    'Yes. Ask our team or use the AI assistant with your skin type and concerns so we can narrow options that are gentler and easier to compare from current stock.': '有。请告诉团队或 AI 助手你的肤质和困扰，我们会从现有库存中筛选更温和、便于比较的选项。',
    'Can I ask whether a product is original or from a specific brand line?': '可以询问产品是否正品或属于某个品牌系列吗？',
    'Yes. Contact the store directly if you want brand confirmation, latest packaging details, or a more exact stock check before buying.': '可以。购买前如需品牌确认、最新包装信息或更准确库存，请直接联系门店。',
    'Do you sell skincare, makeup, hair care, and body care together?': '你们同时销售护肤、彩妆、护发和身体护理吗？',
    'Yes. Leang Cosmetics carries multiple beauty categories, so you can search the catalog or ask for recommendations across skincare, cosmetics, perfume, hair, and body products.': '是的。Leang Cosmetics 提供多个美妆品类，你可以搜索目录，或询问护肤、彩妆、香水、护发和身体护理产品推荐。',
    'Can the store help me build a full routine?': '门店可以帮我搭配完整护理流程吗？',
    'Yes. Share your budget, skin type, concerns, and whether you need morning, night, or event-based products. We can help match a more complete routine from available products.': '可以。请说明预算、肤质、困扰，以及需要早间、夜间或活动场景产品。我们会从现有产品中帮你搭配更完整的方案。',
    'What should I do if an item is out of stock?': '商品缺货时该怎么办？',
    'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.': '如果商品暂时缺货，请通过 Facebook、Instagram、Telegram 或电话联系门店，团队会推荐替代品或确认补货变化。',
    'Can I ask for products within a specific budget?': '可以按指定预算推荐产品吗？',
    'Yes. Tell us your budget and what category you want, and we can narrow options from the current catalog.': '可以。告诉我们你的预算和想要的品类，我们会从当前目录中缩小选择范围。',
    'Do you have gift-friendly items or bundles?': '有适合送礼的产品或套装吗？',
    'Yes. Ask the store team or use the assistant to explore perfumes, makeup, skincare, and beauty gifts that fit the occasion.': '有。可以询问门店团队或使用助手，查找适合场合的香水、彩妆、护肤和美妆礼品。',
    'Can I ask for alternatives if my preferred brand is unavailable?': '如果喜欢的品牌没货，可以推荐替代品吗？',
    'Yes. We can suggest similar products from other brands in stock based on category, concern, and price range.': '可以。我们会根据品类、需求和价格范围，推荐库存中其他品牌的相似产品。',
    'Can I check whether a product is suitable for oily, dry, or combination skin?': '可以确认产品是否适合油性、干性或混合性皮肤吗？',
    'Yes. Use the assistant or contact the store with your skin type and concern so recommendations stay closer to your needs.': '可以。请通过助手或联系门店说明肤质和困扰，这样推荐会更贴近你的需要。',
    'Do you also carry hair, body, and fragrance products?': '你们也有护发、身体护理和香氛产品吗？',
    'Yes. The store carries more than just skincare and makeup, so you can also browse hair, body, perfume, and related beauty items when available.': '有。门店不只销售护肤和彩妆，也可以浏览护发、身体护理、香水和相关美妆产品。',
    'What details help the AI recommend better products?': '哪些信息能帮助 AI 推荐更合适的产品？',
    'Does the AI only recommend products available at Leang Cosmetics?': 'AI 只会推荐 Leang Cosmetics 有售的产品吗？',
    'Should I trust the AI as medical or skin-treatment advice?': 'AI 可以作为医疗或皮肤治疗建议吗？',
    'Why does the assistant sometimes suggest several options instead of one product?': '为什么助手有时会推荐多个选项而不是一个产品？',
    'Can the assistant explain why a product was recommended?': '助手能解释为什么推荐某个产品吗？',
  },
}

const FAQ_VOCABULARY_BY_LANGUAGE = {
  'zh-CN': {
    'sensitive skin': '敏感肌',
    'skin type': '肤质',
    products: '产品',
    product: '产品',
    membership: '会员',
    points: '积分',
    stock: '库存',
    alternatives: '替代品',
    alternative: '替代品',
    budget: '预算',
    price: '价格',
    skincare: '护肤',
    makeup: '彩妆',
    hair: '护发',
    body: '身体护理',
    fragrance: '香氛',
    perfume: '香水',
    brand: '品牌',
    store: '门店',
    recommendations: '推荐',
    recommend: '推荐',
  },
  'zh-TW': {
    'sensitive skin': '敏感肌',
    'skin type': '膚質',
    products: '產品',
    product: '產品',
    membership: '會員',
    points: '點數',
    stock: '庫存',
    alternatives: '替代品',
    alternative: '替代品',
    budget: '預算',
    price: '價格',
    skincare: '保養',
    makeup: '彩妝',
    hair: '護髮',
    body: '身體保養',
    fragrance: '香氛',
    perfume: '香水',
    brand: '品牌',
    store: '門市',
    recommendations: '推薦',
    recommend: '推薦',
  },
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
  vi: { products: 'sản phẩm', product: 'sản phẩm', membership: 'thành viên', points: 'điểm', stock: 'tồn kho', budget: 'ngân sách', price: 'giá', skincare: 'chăm sóc da', makeup: 'trang điểm', brand: 'thương hiệu', store: 'cửa hàng' },
  th: { products: 'สินค้า', product: 'สินค้า', membership: 'สมาชิก', points: 'คะแนน', stock: 'สต็อก', budget: 'งบประมาณ', price: 'ราคา', skincare: 'สกินแคร์', makeup: 'เมคอัพ', brand: 'แบรนด์', store: 'ร้าน' },
  ru: { products: 'товары', product: 'товар', membership: 'клиентская карта', points: 'баллы', stock: 'наличие', budget: 'бюджет', price: 'цена', skincare: 'уход за кожей', makeup: 'макияж', brand: 'бренд', store: 'магазин' },
  fr: { products: 'produits', product: 'produit', membership: 'fidélité', points: 'points', stock: 'stock', budget: 'budget', price: 'prix', skincare: 'soins de la peau', makeup: 'maquillage', brand: 'marque', store: 'boutique' },
  es: { products: 'productos', product: 'producto', membership: 'membresía', points: 'puntos', stock: 'stock', budget: 'presupuesto', price: 'precio', skincare: 'cuidado de la piel', makeup: 'maquillaje', brand: 'marca', store: 'tienda' },
  de: { products: 'Produkte', product: 'Produkt', membership: 'Mitgliedschaft', points: 'Punkte', stock: 'Bestand', budget: 'Budget', price: 'Preis', skincare: 'Hautpflege', makeup: 'Make-up', brand: 'Marke', store: 'Geschäft' },
  ja: { products: '商品', product: '商品', membership: '会員', points: 'ポイント', stock: '在庫', budget: '予算', price: '価格', skincare: 'スキンケア', makeup: 'メイク', brand: 'ブランド', store: '店舗' },
  ko: { products: '제품', product: '제품', membership: '멤버십', points: '포인트', stock: '재고', budget: '예산', price: '가격', skincare: '스킨케어', makeup: '메이크업', brand: '브랜드', store: '매장' },
  pt: { products: 'produtos', product: 'produto', membership: 'fidelidade', points: 'pontos', stock: 'estoque', budget: 'orçamento', price: 'preço', skincare: 'cuidados com a pele', makeup: 'maquiagem', brand: 'marca', store: 'loja' },
  it: { products: 'prodotti', product: 'prodotto', membership: 'fedeltà', points: 'punti', stock: 'stock', budget: 'budget', price: 'prezzo', skincare: 'cura della pelle', makeup: 'trucco', brand: 'marchio', store: 'negozio' },
  ar: { products: 'المنتجات', product: 'منتج', membership: 'العضوية', points: 'النقاط', stock: 'المخزون', budget: 'الميزانية', price: 'السعر', skincare: 'العناية بالبشرة', makeup: 'المكياج', brand: 'العلامة', store: 'المتجر' },
  hi: { products: 'उत्पाद', product: 'उत्पाद', membership: 'सदस्यता', points: 'अंक', stock: 'स्टॉक', budget: 'बजट', price: 'कीमत', skincare: 'स्किनकेयर', makeup: 'मेकअप', brand: 'ब्रांड', store: 'स्टोर' },
  id: { products: 'produk', product: 'produk', membership: 'keanggotaan', points: 'poin', stock: 'stok', budget: 'anggaran', price: 'harga', skincare: 'perawatan kulit', makeup: 'makeup', brand: 'merek', store: 'toko' },
  ms: { products: 'produk', product: 'produk', membership: 'keahlian', points: 'mata', stock: 'stok', budget: 'bajet', price: 'harga', skincare: 'penjagaan kulit', makeup: 'solekan', brand: 'jenama', store: 'kedai' },
  tr: { products: 'ürünler', product: 'ürün', membership: 'üyelik', points: 'puan', stock: 'stok', budget: 'bütçe', price: 'fiyat', skincare: 'cilt bakımı', makeup: 'makyaj', brand: 'marka', store: 'mağaza' },
}

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

function getLanguageMap(source, language) {
  const key = normalizeLanguageKey(language)
  if (!key || key === 'en') return null
  if (isPlainObject(source[key])) return source[key]
  const base = key.split('-')[0]
  if (base && isPlainObject(source[base])) return source[base]
  return null
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function localizePortalFaqText(value, language) {
  const raw = normalizeText(value)
  const key = normalizeLanguageKey(language)
  if (!raw || !key || key === 'en') return value

  const exactMap = getLanguageMap(DEFAULT_FAQ_TEXT_BY_LANGUAGE, language)
  const exact = exactMap?.[raw]
  if (normalizeText(exact)) return exact

  const vocabulary = getLanguageMap(FAQ_VOCABULARY_BY_LANGUAGE, language)
  if (!vocabulary) return value

  let localized = String(value || '')
  const entries = Object.entries(vocabulary)
    .filter(([term, translation]) => normalizeText(term) && normalizeText(translation))
    .sort((left, right) => right[0].length - left[0].length)

  entries.forEach(([term, translation]) => {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
    localized = localized.replace(pattern, translation)
  })

  return localized
}

function localizeFaqItems(items, collection, language) {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  const localized = localizeCollectionItems(items, collection, ['question', 'answer'])
  return localized.map((item, index) => {
    const entry = getCollectionEntry(collection, item?.id, index)
    const next = { ...item }
    ;['question', 'answer'].forEach((field) => {
      const explicit = normalizeText(pickTranslatedText(entry, field, ''))
      if (!explicit) next[field] = localizePortalFaqText(next[field], language)
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
  next.faqItems = localizeFaqItems(source.faqItems, langBlock.faqItems, language)

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
