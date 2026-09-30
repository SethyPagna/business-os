import { normalizePortalLanguage } from './portalLanguageOptions.ts'
import type { PortalLanguage } from './portalLanguageOptions.ts'

type PortalTextMap = Record<string, string>

// English is each call site's own fallback text, so Khmer is the only pack.
const PORTAL_TEXT_BY_LANGUAGE: Partial<Record<PortalLanguage, PortalTextMap>> = {
  km: {
    switch_to_light_mode: 'ប្តូរទៅរបៀបភ្លឺ',
    switch_to_dark_mode: 'ប្តូរទៅរបៀបងងឹត',
    publicTranslation: 'ភាសា',
    followApp: 'ភាសាដើម',
    products: 'ផលិតផល',
    membership: 'សមាជិកភាព',
    membershipComingSoon: 'សមាជិកភាព៖ នឹងមកដល់ឆាប់ៗនេះ',
    about: 'អំពី',
    faq: 'សំណួរ',
    assistant: 'ជំនួយការ',
    portalAssistant: 'ជំនួយការ AI',
    account: 'គណនី',
    wishlistTitle: 'បញ្ជីចង់បាន',
    publicNavigation: 'ការរុករកផ្នែក',
    search: 'ស្វែងរកផលិតផល',
    searchPlaceholder: 'ស្វែងរកតាមឈ្មោះផលិតផល ពិពណ៌នា ប្រភេទ ឬម៉ាក',
    searchCategories: 'ស្វែងរកប្រភេទ...',
    searchBrands: 'ស្វែងរកម៉ាក...',
    noMatches: 'គ្មានលទ្ធផលត្រូវគ្នា',
    closeFilters: 'បិទតម្រង',
    removeActiveFilter: 'ដកតម្រងចេញ៖ {label}',
    category: 'ប្រភេទ',
    brand: 'ម៉ាក',
    noBrandHeader: 'ម៉ាកផ្សេងៗ',
    promotionsHeader: 'ប្រូម៉ូសិន',
    promotionsFilter: 'ប្រូម៉ូសិនតែប៉ុណ្ណោះ',
    promotionsSectionFallback: 'ការផ្ដល់ជូនពិសេស',
    promotionsSectionHint: 'ការផ្ដល់ជូន និងសេចក្ដីជូនដំណឹងថ្មីៗរបស់យើង។',
    announcementStripSection: 'សេចក្ដីជូនដំណឹង',
    promoStripJump: 'ទៅកាន់ប្រូម៉ូសិន',
    portalPromotionsViewProduct: 'មើល',
    open: 'បើកមើល',
    viewProduct: 'មើលផលិតផល',
    promotionBadge: 'ប្រូម៉ូ',
    promotionBadgeBuy: 'ទិញ',
    recommendedBadge: 'ណែនាំ',
    topSellerBadge: 'លក់ដាច់បំផុត',
    topProductBadge: 'ផលិតផលកំពូល',
    newArrivalBadge: 'ថ្មី',
    branch: 'សាខា',
    stockStatus: 'ស្ថានភាពស្តុក',
    all: 'ទាំងអស់',
    allBranches: 'សាខាទាំងអស់',
    inStock: 'មានស្តុក',
    lowStock: 'ស្តុកតិច',
    outOfStock: 'អស់ស្តុក',
    noProducts: 'មិនមានផលិតផលត្រូវនឹងតម្រងបច្ចុប្បន្នទេ។',
    price: 'តម្លៃ',
    priceHidden: 'បានលាក់តម្លៃ',
    noDescription: 'មិនមានការពិពណ៌នា។',
    loadingPortal: 'កំពុងផ្ទុកគេហទំព័រ...',
    accountLoading: 'កំពុងពិនិត្យគណនីរបស់អ្នក…',
    signedInAs: 'បានចូលគណនីជា',
    membershipId: 'លេខសមាជិក',
    membershipIdOptional: 'លេខសមាជិក (ស្រេចចិត្ត)',
    membershipIdHint: 'ទុកទទេ ហើយយើងនឹងបង្កើតលេខមួយជូនអ្នក។',
    nameOrMembershipId: 'ឈ្មោះ ឬលេខសមាជិក',
    inYourList: 'ក្នុងបញ្ជីរបស់អ្នក',
    saved: 'បានរក្សាទុក',
    accountMemoryHint: 'បញ្ជីរបស់អ្នក និងផលិតផលដែលបានរក្សាទុក ត្រូវបានរក្សាជាមួយគណនី ដូច្នេះអ្នកអាចមើលវាបាននៅលើគ្រប់ឧបករណ៍។',
    signIn: 'ចូលគណនី',
    signingIn: 'កំពុងចូលគណនី…',
    signOut: 'ចាកចេញ',
    signUp: 'ចុះឈ្មោះ',
    createAccount: 'បង្កើតគណនី',
    creatingAccount: 'កំពុងបង្កើតគណនី…',
    yourName: 'ឈ្មោះរបស់អ្នក',
    phoneNumber: 'លេខទូរស័ព្ទ',
    password: 'ពាក្យសម្ងាត់',
    createPassword: 'បង្កើតពាក្យសម្ងាត់',
    forgotPasswordHint: 'ភ្លេចពាក្យសម្ងាត់? សូមទាក់ទងយើង ដើម្បីកំណត់វាឡើងវិញ។',
    signupReminder: 'ប្រសិនបើអ្នកធ្លាប់ទិញពី Leang Cosmetics/Leang Beauty សូមទាក់ទងយើងដើម្បីទទួលលេខសមាជិករបស់អ្នក — លេខទូរស័ព្ទរបស់អ្នកត្រូវតែដូចគ្នា។ នេះគ្រាន់តែជាការរំលឹកប៉ុណ្ណោះ។',
    customer: 'អតិថិជន',
    company: 'ក្រុមហ៊ុន',
    note: 'កំណត់សម្គាល់',
    items: 'ទំនិញ',
    reason: 'មូលហេតុ',
    refund: 'សងប្រាក់',
    active: 'សកម្ម',
    liveCatalog: 'រុករកផលិតផលរបស់យើង និងពិនិត្យមើលថាមានស្តុកឬអត់។',
    filterSummary: 'លទ្ធផល {count}',
    loadingProducts: 'កំពុងផ្ទុកផលិតផល...',
    catalogLoading: 'កំពុងផ្ទុកផលិតផល...',
    refreshing: 'កំពុងធ្វើបច្ចុប្បន្នភាព...',
    selected: 'បានជ្រើស',
    filters: 'តម្រង',
    clear: 'សម្អាត',
    page: 'ទំព័រ',
    perPage: 'ក្នុងមួយទំព័រ',
    back: 'ត្រឡប់',
    next: 'បន្ទាប់',
    jumpToBrand: 'រំលងទៅម៉ាក',
    of: 'នៃ',
    mapCard: 'ផែនទីហាង',
    portalAboutFallback: 'សូមស្វាគមន៍មកកាន់ហាងរបស់យើង។',
    aboutTitle: 'អំពីយើង',
    faqTitle: 'សំណួរដែលសួរញឹកញាប់',
    faqHint: 'ចម្លើយរហ័សចំពោះសំណួរទូទៅ។',
    faqEmptyState: 'មិនទាន់មានសំណួរនៅឡើយទេ។ សូមទាក់ទងយើងគ្រប់ពេល យើងរីករាយជួយអ្នក។',
    logoImage: 'រូបសញ្ញា',
    aiTitle: 'ជំនួយការសម្រស់',
    aiIntro: "ប្រាប់យើងថាអ្នកកំពុងរកអ្វី ហើយជំនួយការ AI នឹងណែនាំផលិតផលពី Leang Beauty។",
    aiDisclaimer: 'ចម្លើយ AI សម្រាប់យោងប៉ុណ្ណោះ។ សម្រាប់ការណែនាំត្រឹមត្រូវ សូមទាក់ទងហាងតាម Instagram ឬ Facebook។',
    assistantNotice: 'បង្កើតដោយ AI សម្រាប់យោងប៉ុណ្ណោះ។',
    assistantContactNote: 'សម្រាប់ការប្រឹក្សាត្រឹមត្រូវ សូមទាក់ទងហាងតាម Instagram ឬ Facebook។',
    aiQuery: 'សំណួរ AI',
    assistantBrand: 'ម៉ាកដែលចូលចិត្ត',
    assistantSkinType: 'ប្រភេទស្បែក',
    assistantShoppingFor: 'កំពុងរកទិញ',
    assistantGoal: 'គោលដៅ / ការប្រើប្រាស់',
    assistantConcerns: 'បញ្ហាស្បែក',
    assistantQuestion: 'តើអ្នកចង់រកអ្វី?',
    askAssistant: "សួរ AI",
    assistantReset: 'សម្អាត',
    assistantLoading: 'កំពុងគិត...',
    assistantQuestionRequired: 'សូមសួរសំណួរជាមុនសិន។',
    assistantUsageCompact: 'មានអ្នកប្រើ {users} នាក់កំពុងប្រើឥឡូវនេះ។ ម្នាក់ៗអាចស្វែងរកបាន {searches} ដងក្នុងមួយនាទី។',
    assistantResults: 'ផលិតផលដែលសមស្រប',
    assistantFollowUps: 'សំណួរបន្តដែលមានប្រយោជន៍',
    assistantWhy: 'ហេតុអ្វីបានជាសម',
    assistantUse: 'របៀបប្រើ',
    assistantCaution: 'ការប្រុងប្រយ័ត្ន',
    assistantIngredients: 'គ្រឿងផ្សំសំខាន់',
    bucketTitle: 'បញ្ជីរបស់ខ្ញុំ',
    bucketHint: 'មិនមានការទូទាត់ទីនេះទេ -- គ្រាន់តែជាបញ្ជីខ្លីៗសម្រាប់បង្ហាញក្រុមការងាររបស់យើង។',
    bucketEmpty: 'បញ្ជីរបស់អ្នកនៅទទេ។ សូមចុច "បន្ថែម" លើផលិតផលដែលអ្នកចូលចិត្ត។',
    clearBucket: 'សម្អាតទាំងអស់',
    copyList: 'ចម្លងបញ្ជី',
    downloadList: 'ទាញយកបញ្ជី',
    bucketCopied: 'បានចម្លង!',
    bucketCopyFailed: 'មិនអាចចម្លងដោយស្វ័យប្រវត្តិទេ -- សូមសាកល្បងទាញយកជំនួសវិញ។',
    addToBucket: 'បន្ថែមទៅបញ្ជី',
    addedToBucket: 'បានបន្ថែម',
    addToBucketQty: 'បន្ថែមទៀត (បានបន្ថែម {qty})',
    removeFromBucket: 'លុបចេញ',
    addToWishlist: 'រក្សាទុកក្នុងបញ្ជីចង់បាន',
    removeFromWishlist: 'ដកចេញពីបញ្ជីចង់បាន',
    decreaseQty: 'បន្ថយចំនួន',
    increaseQty: 'បង្កើនចំនួន',
    noPaymentNotice: 'យើង Leang Cosmetics/Leang Beauty មិនទទួលការទូទាត់តាមអនឡាញទេ — សូមទាក់ទងយើងដើម្បីទិញ។ ឯកជនភាពរបស់អ្នកគឺជាអាទិភាពរបស់យើង។',
    noPaymentNoticeShort: 'មិនមានការទូទាត់តាមអនឡាញទេ — សូមទាក់ទងយើងដើម្បីទិញ។ ដើម្បីសុវត្ថិភាពរបស់អ្នក។',
    contactUs: 'ទាក់ទងយើង',
    contactUsMinimize: 'បង្រួមប៊ូតុងទាក់ទងយើង',
    phone: 'ទូរស័ព្ទ',
    email: 'អ៊ីមែល',
    address: 'អាសយដ្ឋាន',
    call: 'ហៅទូរស័ព្ទ',
    messenger: 'Messenger',
    facebook: 'Facebook',
    instagram: 'Instagram',
    telegram: 'Telegram',
    website: 'គេហទំព័រ',
    scrollToTop: 'ទៅផ្នែកខាងលើ',
    scrollToBottom: 'ទៅផ្នែកខាងក្រោម',
    map: 'ផែនទី',
    close: 'បិទ',
    // Product detail flyout (ProductDetailFlyout.tsx). These keys exist in
    // neither lang pack, so before this every one of them fell through to
    // its English fallback for a Khmer visitor. Terms follow the words the
    // packs already use for the same concept (product_details, category,
    // brand, assistantCaution, assistantIngredients, contactUs).
    productDetails: 'ព័ត៌មានលម្អិតផលិតផល',
    productShopName: 'ឈ្មោះផលិតផលរបស់ហាង',
    productOfficialName: 'ឈ្មោះផលិតផលផ្លូវការ',
    productIntroduction: 'សេចក្តីផ្តើម',
    productCategory: 'ប្រភេទ',
    productBrand: 'ម៉ាក',
    productFeatures: 'លក្ខណៈពិសេស',
    productBenefits: 'អត្ថប្រយោជន៍',
    productFeaturesBenefits: 'លក្ខណៈពិសេស និងអត្ថប្រយោជន៍',
    productWhoFor: 'សម្រាប់អ្នកណា?',
    productIngredients: 'គ្រឿងផ្សំ',
    productCaution: 'ការប្រុងប្រយ័ត្ន',
    productNeedMoreDetails: 'ត្រូវការព័ត៌មានបន្ថែម',
    viewImages: 'មើលរូបភាព',
    discounts: 'បញ្ចុះតម្លៃ',
    prevImage: 'រូបភាពមុន',
    nextImage: 'រូបភាពបន្ទាប់',
    dotsLabel: 'រូបភាព {current} នៃ {total}',
  },
}

export function getPortalLanguageText(language: unknown, key: unknown): string {
  const normalized = normalizePortalLanguage(language)
  const text = normalized ? PORTAL_TEXT_BY_LANGUAGE[normalized]?.[String(key || '')] : undefined
  return typeof text === 'string' && text.trim() ? text : ''
}

// The Worker (routes/portal.ts) and the editor fill these in when the merchant left the
// field empty; that English is system text, while a merchant's own wording is kept.
const DEFAULT_CONFIG_COPY_KEYS: Record<string, [englishDefault: string, resourceKey: string]> = {
  aboutTitle: ['About us', 'aboutTitle'],
  aiTitle: ['Beauty Assistant', 'aiTitle'],
  aiIntro: ['Tell us what you are shopping for and the assistant will compare products from the current public catalogue.', 'aiIntro'],
  aiDisclaimer: ['AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.', 'aiDisclaimer'],
  faqTitle: ['Frequently asked questions', 'faqTitle'],
  promotionsTitle: ['Featured offers', 'promotionsSectionFallback'],
}
const DEFAULT_LINK_LABEL_COPY_KEYS: Record<string, [englishDefault: string, resourceKey: string]> = {
  website: ['Website', 'website'],
}

const sameText = (value: unknown, text: string) => String(value || '').normalize('NFC').trim() === text

function localizedDefault(language: unknown, value: unknown, [englishDefault, resourceKey]: [string, string]): unknown {
  return sameText(value, englishDefault) ? getPortalLanguageText(language, resourceKey) || value : value
}

export function defaultConfigText(language: unknown, field: string, value: unknown): unknown {
  const entry = DEFAULT_CONFIG_COPY_KEYS[field]
  return entry ? localizedDefault(language, value, entry) : value
}

export function localizeDefaultConfigCopy<Config extends { linkLabels?: Record<string, string> }>(config: Config, language: unknown): Config {
  const next: Record<string, unknown> = { ...config }
  for (const field of Object.keys(DEFAULT_CONFIG_COPY_KEYS)) {
    if (field in next) next[field] = defaultConfigText(language, field, next[field])
  }
  if (config.linkLabels) {
    const linkLabels: Record<string, string> = { ...config.linkLabels }
    for (const [label, entry] of Object.entries(DEFAULT_LINK_LABEL_COPY_KEYS)) {
      if (label in linkLabels) linkLabels[label] = String(localizedDefault(language, linkLabels[label], entry))
    }
    next.linkLabels = linkLabels
  }
  return next as Config
}

type AppTranslator = ((key: string) => string) | undefined

// portal_a11y_* names are flat en/km pack keys, not portalEditor.* ones.
const FLAT_PACK_KEY_PREFIX = 'portal_a11y_'
const EDITOR_PACK_KEY_PREFIX = 'portalEditor.'

export function resolveStorefrontCopy(pageLanguage: string, t: AppTranslator, key: string, fallback = '', fallbackKm = fallback): string {
  if (key.startsWith(FLAT_PACK_KEY_PREFIX)) {
    // `t` follows the app language, so an explicit Khmer storefront choice wins over it.
    if (pageLanguage === 'km' && fallbackKm) return fallbackKm
    const packed = typeof t === 'function' ? t(key) : ''
    return packed && packed !== key ? packed : fallback
  }
  const localized = getPortalLanguageText(pageLanguage, key)
  if (localized) return localized
  const editorKey = `${EDITOR_PACK_KEY_PREFIX}${key}`
  const translated = typeof t === 'function' ? t(editorKey) : ''
  if (translated && translated !== editorKey) return translated
  return pageLanguage === 'km' ? (fallbackKm || fallback) : fallback
}
