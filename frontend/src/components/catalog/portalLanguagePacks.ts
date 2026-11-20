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
    about: 'អំពី',
    faq: 'សំណួរ',
    assistant: 'ជំនួយការ',
    portalAssistant: 'ជំនួយការ AI',
    account: 'គណនី',
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
    noCategoryHeader: 'ប្រភេទផ្សេងៗ',
    portalBrowseView: 'មើលតាម',
    portalBrowseSort: 'តម្រៀប',
    portalViewAll: 'ផលិតផលទាំងអស់',
    portalViewByBrand: 'ដាក់ជាក្រុមតាមម៉ាក',
    portalViewByCategory: 'ដាក់ជាក្រុមតាមប្រភេទ',
    portalViewAllTip: 'បញ្ជីតែមួយ គ្មានក្រុម',
    portalSortFeatured: 'ពិសេស',
    portalSortFeaturedTip: 'ប្រូម៉ូសិនមុន បន្ទាប់មកតាមអក្សរ A-Z',
    portalSortNameAsc: 'ឈ្មោះ A-Z',
    portalSortNameDesc: 'ឈ្មោះ Z-A',
    portalSortPriceAsc: 'តម្លៃទាប',
    portalSortPriceDesc: 'តម្លៃខ្ពស់',
    portalSortNameAscTip: 'ឈ្មោះ ពី A ដល់ Z',
    portalSortNameDescTip: 'ឈ្មោះ ពី Z ដល់ A',
    portalSortPriceAscTip: 'តម្លៃ ពីទាបទៅខ្ពស់',
    portalSortPriceDescTip: 'តម្លៃ ពីខ្ពស់ទៅទាប',
    promotionsHeader: 'ប្រូម៉ូសិន',
    promotionsFilter: 'ប្រូម៉ូសិនតែប៉ុណ្ណោះ',
    promotionsSectionFallback: 'ការផ្ដល់ជូនពិសេស',
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
    membershipId: 'លេខសមាជិក',
    membershipPoints: 'ពិន្ទុ',
    membershipPointsComingSoon: 'នឹងមកដល់ឆាប់ៗនេះ',
    membershipIdOptional: 'លេខសមាជិក (ស្រេចចិត្ត)',
    nameOrMembershipId: 'ឈ្មោះ ឬលេខសមាជិក',
    saved: 'បានរក្សាទុក',
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
    customer: 'អតិថិជន',
    company: 'ក្រុមហ៊ុន',
    note: 'កំណត់សម្គាល់',
    items: 'ទំនិញ',
    reason: 'មូលហេតុ',
    refund: 'សងប្រាក់',
    active: 'សកម្ម',
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
    portalAboutFallback: 'សូមស្វាគមន៍មកកាន់ហាងរបស់យើង។',
    aboutTitle: 'អំពីយើង',
    faqTitle: 'សំណួរដែលសួរញឹកញាប់',
    faqEmptyState: 'មិនទាន់មានសំណួរនៅឡើយទេ។ សូមទាក់ទងយើងគ្រប់ពេល យើងរីករាយជួយអ្នក។',
    logoImage: 'រូបសញ្ញា',
    aiTitle: 'ជំនួយការសម្រស់',
    aiIntro: 'ប្រាប់យើងថាអ្នកកំពុងរកអ្វី ហើយជំនួយការនឹងប្រៀបធៀបផលិតផលពីកាតាឡុកសាធារណៈបច្ចុប្បន្ន។',
    aiDisclaimer: 'ចម្លើយ AI សម្រាប់យោងប៉ុណ្ណោះ។ សម្រាប់ការណែនាំត្រឹមត្រូវ សូមទាក់ទងក្រុមការងាររបស់ហាង។',
    assistantContactNote: 'សម្រាប់ការប្រឹក្សាត្រឹមត្រូវ សូមទាក់ទងក្រុមការងាររបស់ហាង។',
    aiQuery: 'សំណួរ AI',
    assistantBrand: 'ម៉ាកដែលចូលចិត្ត',
    assistantSkinType: 'ប្រភេទស្បែក',
    assistantShoppingFor: 'កំពុងរកទិញ',
    assistantGoal: 'គោលដៅ / ការប្រើប្រាស់',
    assistantConcerns: 'បញ្ហាស្បែក',
    assistantQuestion: 'តើអ្នកចង់ឲ្យជួយរកអ្វី?',
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
    clearBucket: 'សម្អាតទាំងអស់',
    copyList: 'ចម្លងបញ្ជី',
    downloadList: 'ទាញយកបញ្ជី',
    bucketCopied: 'បានចម្លង!',
    bucketCopyFailed: 'មិនអាចចម្លងដោយស្វ័យប្រវត្តិទេ -- សូមសាកល្បងទាញយកជំនួសវិញ។',
    addToBucket: 'បន្ថែមទៅបញ្ជី',
    addToBucketShort: 'បន្ថែម',
    addedToBucket: 'បានបន្ថែម',
    addToBucketQty: 'បន្ថែមទៀត (បានបន្ថែម {qty})',
    removeFromBucket: 'លុបចេញ',
    addToWishlist: 'រក្សាទុកក្នុងបញ្ជីចង់បាន',
    removeFromWishlist: 'ដកចេញពីបញ្ជីចង់បាន',
    decreaseQty: 'បន្ថយចំនួន',
    increaseQty: 'បង្កើនចំនួន',
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
    // Storefront strings that were typed at their call sites; the pack is the one source (storefrontKhmerPackAgreement.test.ts keeps them equal).
    assistantConsentRequired: 'សូមបញ្ជាក់ការជូនដំណឹងអំពីការប្រើប្រាស់ទិន្នន័យ AI មុនពេលផ្ញើសំណួរ។',
    assistantDailyLimit: 'ជំនួយការបានដល់ចំនួនកំណត់សម្រាប់ថ្ងៃនេះហើយ។ សូមព្យាយាមម្តងទៀតនៅថ្ងៃស្អែក។',
    portalLoadFailed: 'យើងមិនអាចបើកហាងបានទេ។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ហើយព្យាយាមម្ដងទៀត។',
    retry: 'ព្យាយាមម្ដងទៀត',
    contactButton: 'ទាក់ទង',
    portalAccountUnavailable: 'គណនីមិនអាចប្រើបានពេលនេះទេ។',
    portalAccountIncomplete: 'ចម្លើយគណនីមិនពេញលេញ។ សូមព្យាយាមម្ដងទៀត។',
    portalAccountGenericError: 'មានបញ្ហា។ សូមព្យាយាមម្ដងទៀត។',
    portalSegmentList: 'បញ្ជី',
    listEmptyLine: 'បញ្ជីរបស់អ្នកនៅទទេ។',
    savedEmptyLine: 'មិនទាន់មានអ្វីរក្សាទុកទេ។',
    inList: 'ក្នុងបញ្ជី',
    addToList: 'បន្ថែម',
    removeSavedItem: 'លុបចេញ',
    clearWishlist: 'សម្អាតទាំងអស់',
    clearAllConfirm: 'សម្អាត {count} មុខទាំងអស់ឬ?',
    clearOneConfirm: 'សម្អាតមុខនេះឬ?',
    clearAllYes: 'សម្អាត',
    clearAllKeep: 'រក្សា',
    translateUnavailable: 'ឥឡូវនេះមិនអាចបកប្រែបានទេ។',
    aiPolicyLanguage: 'ខ្មែរ',
    portalFooterConcernsContact: 'បើមានខ្លឹមសារអំពីអ្នក ឬអ្នកបារម្ភអំពីរូបភាពណាមួយ សូមទាក់ទងយើងតាម {contact}។ យើងពិនិត្យរាល់សំណើ ហើយសុំតែព័ត៌មានដែលត្រូវការ ដើម្បីសម្គាល់ខ្លឹមសារ និងអ្នកដាក់សំណើ។',
    install_app: 'ដំឡើងកម្មវិធី',
    install_shop_band: 'ដំឡើង Leang Cosmetics',
    ios_install_hint: 'បន្ថែមទៅអេក្រង់ដើម ក្នុង ៣ ជំហាន។',
    install_open_elsewhere_hint: 'បើកទំព័រនេះក្នុង Chrome ឬ Safari ដើម្បីដំឡើង។',
    install_offer_detail: 'បើកពីរូបតំណាងផ្ទាល់ខ្លួននៅលើអេក្រង់ដើម។',
    dismiss_notification: 'បិទការជូនដំណឹង',
    install_app_short: 'ដំឡើង',
    searchProductsShort: 'ស្វែងរកផលិតផល',
    clearSearch: 'សម្អាតការស្វែងរក',
    noProductsForSearch: 'រកមិនឃើញផលិតផលសម្រាប់ "{term}"។',
    clearFilters: 'សម្អាតតម្រង',
    openInGoogleMaps: 'បើកក្នុង Google Maps',
    callUs: 'ហៅទូរស័ព្ទ',
    faqEmptyNone: 'មិនទាន់មានសំណួរនៅឡើយទេ។',
    faqSearch: 'ស្វែងរកសំណួរ',
    faqNoMatch: 'គ្មានសំណួរត្រូវនឹង "{query}" ទេ',
    faqStillHeading: 'នៅមានសំណួរទៀតទេ?',
    assistantConsentWithdraw: 'ដកការយល់ព្រម',
    assistantAgreeSend: 'យល់ព្រម ហើយផ្ញើ',
    assistantTagline: 'ការណែនាំពី AI មិនមែនជាយោបល់វេជ្ជសាស្ត្រទេ។',
    assistantInfo: 'អំពីជំនួយការ',
    assistantAddDetails: 'បន្ថែមព័ត៌មាន',
    skinDry: 'ស្ងួត',
    skinOily: 'ខ្លាញ់',
    skinCombination: 'ចម្រុះ',
    skinSensitive: 'ងាយប្រតិកម្ម',
    skinNormal: 'ធម្មតា',
    skinAcneProne: 'ងាយកើតមុន',
    assistantExample1: 'ឡេការពារកម្ដៅថ្ងៃទន់ភ្លន់ សម្រាប់ស្បែកខ្លាញ់',
    assistantExample2: 'ក្រែមផ្តល់សំណើម សម្រាប់ស្បែកស្ងួត ងាយប្រតិកម្ម',
    assistantExample3: 'ផលិតផលលាងមុខទន់ភ្លន់ សម្រាប់ស្បែកងាយកើតមុន',
    assistantExample4: 'ក្រហមមាត់ជាប់យូរ ពណ៌ធម្មជាតិ',
    assistantGoalPlaceholder: 'ប្រើរាល់ថ្ងៃ ធ្វើឲ្យស្បែកភ្លឺ ឬជាប់បានយូរ...',
    assistantConcernsPlaceholder: 'មុន ស្បែកងាយប្រតិកម្ម ស្នាមខ្មៅ ឬស្បែកស្ងួត...',
    assistantSend: 'ផ្ញើ',
    assistantViewProduct: 'មើលផលិតផល',
    accountNameLabel: 'ឈ្មោះ',
    signupPausedLine: 'ការចុះឈ្មោះត្រូវបានផ្អាក។',
    forgotPasswordLink: 'ភ្លេចពាក្យសម្ងាត់?',
    signupMemberAsk: 'ធ្លាប់ទិញពីយើងហើយឬ? សូមសុំលេខសមាជិកពីយើង។',
    signupPasswordHint: '១០ តួអក្សរឡើងទៅ។',
    productInStore: 'ក្នុងហាង',
    noPaymentLine: 'មិនមានការទូទាត់អនឡាញទេ។ ផ្ញើបញ្ជីមកយើងដើម្បីបញ្ជាទិញ។',
    mapConsentLine: 'Google Maps កំណត់ខូឃីរបស់ខ្លួន។',
    mapLoad: 'ផ្ទុកផែនទី',
    portalConsentLine: 'ខ្ញុំមានអាយុ ១៦ ឆ្នាំឡើងទៅ ហើយទទួលយក{terms} និង{privacy}។',
  },
}

export function getPortalLanguageText(language: unknown, key: unknown): string {
  const normalized = normalizePortalLanguage(language)
  const text = normalized ? PORTAL_TEXT_BY_LANGUAGE[normalized]?.[String(key || '')] : undefined
  return typeof text === 'string' && text.trim() ? text : ''
}

// A value equal to one of these English defaults is system text, shown in the shopper's
// language; any other value is the merchant's wording and is kept. Today the Worker
// (routes/portal.ts) fills only aiTitle, aiDisclaimer and faqTitle when empty; the other
// three are matched for copies of this English already stored in settings.
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
