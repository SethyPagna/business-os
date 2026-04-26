import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeDollarSign,
  Bot,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  Facebook,
  Globe,
  HelpCircle,
  Instagram,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Save,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  Store,
  Ticket,
  Upload,
} from 'lucide-react'
import { ProductImg } from '../products/primitives'
import ImageGalleryLightbox from '../shared/ImageGalleryLightbox'
import FilePickerModal from '../files/FilePickerModal'
import { useApp, useSync } from '../../AppContext'
import {
  createAboutBlock,
  normalizeAboutBlocks,
  normalizeGoogleMapsEmbed,
  serializeAboutBlocks,
} from './portalEditorUtils.mjs'
import { createCircularFaviconDataUrl } from '../../utils/favicon'

function getAboutBlockLabel(type) {
  if (type === 'image') return 'Image block'
  if (type === 'video') return 'Video block'
  return 'Text block'
}

function withAssetVersion(url, versionSeed) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const seed = String(versionSeed || '').trim()
  if (!seed) return raw
  const separator = raw.includes('?') ? '&' : '?'
  return `${raw}${separator}v=${encodeURIComponent(seed)}`
}

/**
 * CatalogPage
 * Internal mode: Portal editor + live preview with settings persistence.
 * Public mode: Read-only customer portal catalog/membership experience.
 */
const PORTAL_TEXT = {
  en: {
    previewBadge: 'Portal Studio',
    publicBadge: 'Customer Portal',
    studioTitle: 'Portal Editor',
    studioHint: 'Edit the customer-facing portal here. The public page remains read-only.',
    saveChanges: 'Save changes',
    savedPreview: 'Public preview',
    openPortal: 'Open customer page',
    businessInfo: 'Business details',
    businessName: 'Business name',
    businessTagline: 'Short tagline',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    addressLink: 'Address link',
    addressLinkHint: 'Optional external map or directions link opened when customers tap the address.',
    media: 'Images',
    logoImage: 'Logo image',
    coverImage: 'Cover image',
    uploadImage: 'Upload image',
    clearImage: 'Clear',
    content: 'Portal content',
    portalTitle: 'Portal title',
    portalIntro: 'Portal intro',
    language: 'Portal language',
    followApp: 'Follow app',
    english: 'English',
    khmer: 'Khmer',
    links: 'Social links',
    socialLabel: 'Display label',
    socialLabelPlaceholder: 'Optional label shown to customers',
    website: 'Website',
    facebook: 'Facebook',
    instagram: 'Instagram',
    telegram: 'Telegram',
    display: 'Display settings',
    showCatalog: 'Show product catalog',
    showMembership: 'Show membership lookup',
    showPrices: 'Show selling prices',
    priceDisplay: 'Price display',
    points: 'Points settings',
    pointsPerUsd: 'Points per USD',
    pointsPerKhr: 'Points per KHR',
    redeemPoints: 'Points needed to redeem',
    redeemUsd: 'Redeem value in USD',
    redeemKhr: 'Redeem value in KHR',
    products: 'Products',
    membership: 'Membership',
    search: 'Search products',
    searchPlaceholder: 'Search by product name, description, category, or brand',
    category: 'Category',
    brand: 'Brand',
    branch: 'Branch',
    stockStatus: 'Stock status',
    all: 'All',
    allBranches: 'All branches',
    inStock: 'In Stock',
    lowStock: 'Low Stock',
    outOfStock: 'Out of Stock',
    noProducts: 'No products matched the current filters.',
    price: 'Price',
    priceHidden: 'Price hidden',
    noDescription: 'No description available.',
    readOnly: 'Read-only for customers',
    customerUrl: 'Customer URL',
    customerUrlHint: 'Set a custom public path here, then publish that path through a separate customer-facing Funnel so the customer link is harder to guess from the admin side.',
    publicPathInput: 'Custom public path',
    publicPathPlaceholder: '/your-customer-link',
    membershipLookup: 'Membership lookup',
    membershipPlaceholder: 'Enter membership number',
    membershipLookupHint: 'Customers can view purchases, returns, and points. Only staff can apply membership discounts during checkout.',
    lookup: 'Check membership',
    loadingPortal: 'Loading customer portal...',
    checkingMembership: 'Checking membership...',
    membershipRequired: 'Please enter a membership number.',
    membershipNotFound: 'Membership number not found.',
    customer: 'Customer',
    memberSince: 'Member since',
    company: 'Company',
    note: 'Note',
    pointsBalance: 'Point balance',
    pointsValue: 'Point value',
    pointsEarned: 'Points earned',
    pointsRedeemed: 'Points redeemed',
    pointsRewarded: 'Reward points',
    redeemRule: 'Points can be used in whole units only. Ask staff to apply them during checkout.',
    redeemSummary: 'Minimum {points} points per unit. Available now: {units} unit(s).',
    membershipDiscountTotal: 'Membership discounts used',
    totalSales: 'Sales total',
    totalReturns: 'Returns total',
    purchaseHistory: 'Purchase history',
    returnHistory: 'Return history',
    items: 'Items',
    reason: 'Reason',
    refund: 'Refund',
    noSales: 'No sales found for this membership yet.',
    noReturns: 'No returns found for this membership yet.',
    branchView: 'Branch view',
    liveCatalog: 'Live inventory, customer-safe details only.',
    createdWith: 'Customer-ready catalog and membership view',
    publicPath: 'Public path',
    shareProofs: 'Share & reward',
    shareProofsHint: 'Customers can submit screenshots showing they shared the business. Staff reviews and awards points inside Business OS.',
    sharePlatform: 'Platform',
    sharePlatformPlaceholder: 'Facebook post, Instagram story, Telegram status...',
    shareNote: 'Customer note',
    shareNotePlaceholder: 'Optional note for the business team',
    sharePaste: 'Paste screenshots here or upload below',
    shareUpload: 'Upload screenshots',
    shareSubmit: 'Submit for review',
    shareSubmitting: 'Submitting...',
    shareRequirement: 'Add at least one screenshot before submitting.',
    shareSubmitted: 'Submission sent for review.',
    shareStatus: 'Status',
    shareReward: 'Reward',
    shareReviewNote: 'Review note',
    sharePending: 'Pending review',
    shareApproved: 'Approved',
    shareRejected: 'Rejected',
    noSubmissions: 'No share submissions yet.',
    reviewQueue: 'Review queue',
    reviewQueueHint: 'Approve, reject, and award points for customer share submissions.',
    approve: 'Approve',
    reject: 'Reject',
    pending: 'Pending',
    rewardPoints: 'Reward points',
    reviewNotePlaceholder: 'Internal review note',
    reviewSaved: 'Review saved.',
  },
  km: {
    assistantUsageCompact: 'មានអ្នកប្រើ {users} នាក់កំពុងប្រើឥឡូវនេះ។ ម្នាក់ៗអាចស្វែងរកបាន {searches} ដងក្នុងមួយនាទី។',
    previewBadge: 'កែទំព័រអតិថិជន',
    publicBadge: 'ទំព័រអតិថិជន',
    studioTitle: 'ផ្ទាំងកែទំព័រ',
    studioHint: 'កែសម្រួលទំព័រអតិថិជននៅទីនេះ។ ទំព័រសាធារណៈនៅតែអាចមើលបានតែប៉ុណ្ណោះ។',
    saveChanges: 'រក្សាទុក',
    savedPreview: 'មើលទំព័រសាធារណៈ',
    openPortal: 'បើកទំព័រអតិថិជន',
    businessInfo: 'ព័ត៌មានអាជីវកម្ម',
    businessName: 'ឈ្មោះអាជីវកម្ម',
    businessTagline: 'អត្ថបទខ្លី',
    phone: 'លេខទូរស័ព្ទ',
    email: 'អ៊ីមែល',
    address: 'អាសយដ្ឋាន',
    addressLink: 'តំណអាសយដ្ឋាន',
    addressLinkHint: 'ជាជម្រើស សម្រាប់តំណផែនទី ឬទិសដៅខាងក្រៅ ដែលបើកពេលអតិថិជនចុចអាសយដ្ឋាន។',
    media: 'រូបភាព',
    logoImage: 'រូបសញ្ញា',
    coverImage: 'រូបភាពផ្ទាំងខាងលើ',
    uploadImage: 'បញ្ចូលរូបភាព',
    clearImage: 'លុប',
    content: 'មាតិកាទំព័រ',
    portalTitle: 'ចំណងជើងទំព័រ',
    portalIntro: 'អត្ថបទណែនាំ',
    language: 'ភាសាទំព័រ',
    followApp: 'តាមកម្មវិធី',
    english: 'អង់គ្លេស',
    khmer: 'ខ្មែរ',
    links: 'តំណភ្ជាប់បណ្ដាញសង្គម',
    website: 'គេហទំព័រ',
    facebook: 'ហ្វេសប៊ុក',
    instagram: 'អ៊ីនស្តាក្រាម',
    telegram: 'តេលេក្រាម',
    display: 'ការបង្ហាញ',
    showCatalog: 'បង្ហាញកាតាឡុក',
    showMembership: 'បង្ហាញការស្វែងរកសមាជិក',
    showPrices: 'បង្ហាញតម្លៃលក់',
    priceDisplay: 'របៀបបង្ហាញតម្លៃ',
    points: 'ការកំណត់ពិន្ទុ',
    pointsPerUsd: 'ពិន្ទុក្នុង 1 ដុល្លារ',
    pointsPerKhr: 'ពិន្ទុក្នុង 1 រៀល',
    redeemPoints: 'ពិន្ទុដែលត្រូវប្រើ',
    redeemUsd: 'តម្លៃប្តូរជាដុល្លារ',
    redeemKhr: 'តម្លៃប្តូរជារៀល',
    products: 'ផលិតផល',
    membership: 'សមាជិកភាព',
    search: 'ស្វែងរកផលិតផល',
    searchPlaceholder: 'ស្វែងរកតាមឈ្មោះ ពិពណ៌នា ប្រភេទ ឬម៉ាក',
    category: 'ប្រភេទ',
    brand: 'ម៉ាក',
    branch: 'សាខា',
    stockStatus: 'ស្ថានភាពស្តុក',
    all: 'ទាំងអស់',
    allBranches: 'គ្រប់សាខា',
    inStock: 'មានស្តុក',
    lowStock: 'ស្តុកទាប',
    outOfStock: 'អស់ស្តុក',
    noProducts: 'មិនមានផលិតផលត្រូវនឹងតម្រងបច្ចុប្បន្នទេ។',
    price: 'តម្លៃ',
    priceHidden: 'លាក់តម្លៃ',
    noDescription: 'មិនមានពិពណ៌នា។',
    readOnly: 'អាចមើលបានតែប៉ុណ្ណោះ',
    customerUrl: 'តំណអតិថិជន',
    customerUrlHint: 'បច្ចុប្បន្នប្រើ path `/portal`។ អ្នកអាចបង្ហោះ path នេះជាមួយ Funnel សម្រាប់អតិថិជន។',
    membershipLookup: 'ស្វែងរកសមាជិកភាព',
    membershipPlaceholder: 'បញ្ចូលលេខសមាជិក',
    membershipLookupHint: 'អតិថិជនអាចមើលប្រវត្តិការទិញ ការត្រឡប់ និងពិន្ទុបានតែប៉ុណ្ណោះ។',
    lookup: 'ពិនិត្យសមាជិក',
    loadingPortal: 'កំពុងផ្ទុកទំព័រអតិថិជន...',
    checkingMembership: 'កំពុងពិនិត្យសមាជិក...',
    membershipRequired: 'សូមបញ្ចូលលេខសមាជិកជាមុន។',
    membershipNotFound: 'រកមិនឃើញលេខសមាជិកនេះទេ។',
    customer: 'អតិថិជន',
    memberSince: 'ជាសមាជិកតាំងពី',
    company: 'ក្រុមហ៊ុន',
    note: 'កំណត់ចំណាំ',
    pointsBalance: 'ពិន្ទុសរុប',
    pointsValue: 'តម្លៃពិន្ទុ',
    totalSales: 'សរុបការលក់',
    totalReturns: 'សរុបការត្រឡប់',
    purchaseHistory: 'ប្រវត្តិការទិញ',
    returnHistory: 'ប្រវត្តិការត្រឡប់',
    items: 'មុខទំនិញ',
    reason: 'មូលហេតុ',
    refund: 'ប្រាក់សងត្រឡប់',
    noSales: 'មិនទាន់មានការលក់សម្រាប់សមាជិកនេះទេ។',
    noReturns: 'មិនទាន់មានការត្រឡប់សម្រាប់សមាជិកនេះទេ។',
    branchView: 'ការមើលតាមសាខា',
    liveCatalog: 'ព័ត៌មានស្តុកបច្ចុប្បន្ន សម្រាប់អតិថិជនមើលបានតែប៉ុណ្ណោះ។',
    createdWith: 'កាតាឡុក និងសមាជិកភាពសម្រាប់អតិថិជន',
    publicPath: 'ផ្លូវសាធារណៈ',
  },
}

const PORTAL_TEXT_EXTRA = {
  en: {
    publicUrlLabel: 'Public customer URL',
    publicUrlHint: 'Use a different public domain or Funnel URL here when you publish the customer portal outside the admin link.',
    publicUrlPlaceholder: 'https://customers.example.com',
    openEmbeddedPreview: 'Open public preview',
    translateWidget: 'Enable public translate widget',
    translateWidgetHint: 'Public customers can switch languages with Google Translate. Internal Business OS translation stays separate.',
    refreshSeconds: 'Public refresh interval (seconds)',
    stockThresholdMode: 'Stock badge mode',
    stockThresholdModeProduct: 'Use each product threshold',
    stockThresholdModeGlobal: 'Use portal-wide thresholds',
    lowStockThreshold: 'Low stock threshold',
    outOfStockThreshold: 'Out of stock threshold',
    membershipInfoText: 'Membership info text',
    submissionFeature: 'Enable share submissions',
    submissionRewardPoints: 'Default reward points',
    submissionInstructions: 'Submission instructions',
    submissionInstructionsHint: 'Customers can only submit screenshots. Staff reviews and awards points inside Business OS.',
    portalPublishing: 'Publishing',
    portalCatalogSettings: 'Catalog settings',
    portalMembershipSettings: 'Membership settings',
    portalSubmissionSettings: 'Submission settings',
    staffAppliedOnly: 'Points are reviewed and applied by staff only. Customers cannot redeem them directly here.',
    publicTranslation: 'Language tools',
    externalPreviewNotice: 'The embedded preview uses the public customer URL you configured below.',
    syncSpeedHint: 'Lower values refresh faster but create more requests. Internal preview still reacts to sync events immediately.',
    stockThresholdHint: 'Global thresholds override the product-level stock badges on the customer portal only.',
    submissionDisabled: 'Share submissions are currently disabled.',
    visibility: 'Visibility',
    contactVisibility: 'Contact visibility',
    socialVisibility: 'Social visibility',
    mapCard: 'Store map',
    mapEmbed: 'Google map embed URL',
    mapEmbedHint: 'Paste a Google Maps link or embed URL. The portal will render it as an interactive map card.',
    showGoogleMap: 'Show Google map',
    showLogo: 'Show logo',
    showCover: 'Show cover image',
    showPhone: 'Show phone',
    showEmail: 'Show email',
    showAddress: 'Show address',
    showWebsite: 'Show website',
    showFacebook: 'Show Facebook',
    showInstagram: 'Show Instagram',
    showTelegram: 'Show Telegram',
    portalImageUploadHint: 'Upload stores a short file path, so portal settings stay clean.',
    openGallery: 'Open image gallery',
    prevImage: 'Prev',
    nextImage: 'Next',
    imageCount: '{current}/{total}',
    about: 'About',
    showAbout: 'Show about section',
    aboutTitle: 'About title',
    aboutContent: 'About content',
    aboutContentHint: 'Tell customers about your story, hours, policies, or services.',
    portalTheme: 'Portal theme',
    heroGradientStart: 'Header color 1',
    heroGradientMid: 'Header color 2',
    heroGradientEnd: 'Header color 3',
    jumpToPreview: 'Jump to preview',
    backToEditor: 'Back to editor',
    filterSummary: '{count} result(s)',
    filterCompactHint: 'Use quick filters to narrow products faster.',
    dotsLabel: 'Image {current} of {total}',
    portalAboutFallback: 'Add your business story in the editor so customers can quickly learn about your brand.',
    portalAssistant: 'AI assistant',
    portalAssistantSettings: 'AI assistant settings',
    portalAssistantHint: 'This floating helper suggests products from your live catalog and can include online references when the selected provider supports them.',
    assistantEnabled: 'Enable AI assistant',
    assistantTitle: 'Assistant title',
    assistantIntro: 'Assistant intro',
    assistantDisclaimer: 'Assistant disclaimer',
    assistantProvider: 'AI provider entry',
    assistantProviderAuto: 'Automatic (best available)',
    assistantPrompt: 'Extra prompt instructions',
    assistantPromptHint: 'Optional store-specific rules, such as tone or what categories to prioritize.',
    faq: 'FAQ',
    faqTitle: 'FAQ title',
    faqSettings: 'FAQ settings',
    faqHint: 'Add your most common customer questions here. Customers can open each answer one by one.',
    faqEnabled: 'Show FAQ section',
    addFaq: 'Add FAQ',
    faqQuestion: 'Question',
    faqAnswer: 'Answer',
    askAssistant: 'Ask AI assistant',
    assistantQuestion: 'What would you like help finding?',
    assistantQuestionPlaceholder: 'Example: I have oily acne-prone skin and want a gentle daily sunscreen.',
    assistantBrand: 'Preferred brand',
    assistantSkinType: 'Skin type',
    assistantConcerns: 'Skin concerns',
    assistantShoppingFor: 'Shopping for',
    assistantGoal: 'Goal / use case',
    assistantResults: 'Suggested matches',
    assistantFollowUps: 'Helpful follow-up questions',
    assistantUsageCompact: '{users} user(s) are using this right now. Each visitor can send {searches} search(es) per minute.',
    assistantNoProvider: 'Choose and test an AI provider in Library before enabling the portal assistant.',
    assistantNoAnswer: 'No AI answer yet. Ask a question to generate suggestions.',
    assistantLoading: 'Thinking...',
    assistantNotice: 'AI generated, for reference only.',
    assistantContactNote: 'For more accurate inquiries, please contact our store on Instagram or Facebook.',
    assistantEvidence: 'Online references',
    assistantWhy: 'Why this match',
    assistantUse: 'How to use',
    assistantCaution: 'Caution',
    assistantIngredients: 'Ingredients focus',
    assistantReviews: 'Online review summary',
    assistantReset: 'Clear',
    assistantOpen: 'Open assistant',
  },
  km: {
    customerUrlHint: 'កំណត់ path សាធារណៈផ្ទាល់ខ្លួននៅទីនេះ ហើយបង្ហោះ path នេះតាម Funnel សម្រាប់អតិថិជន ដើម្បីឲ្យតំណអតិថិជនពិបាកទាយពីផ្នែកគ្រប់គ្រង។',
    publicPathInput: 'ផ្លូវសាធារណៈផ្ទាល់ខ្លួន',
    publicPathPlaceholder: '/your-customer-link',
    pointsEarned: 'ពិន្ទុដែលទទួលបាន',
    pointsRedeemed: 'ពិន្ទុដែលបានប្រើ',
    pointsRewarded: 'ពិន្ទុរង្វាន់',
    redeemRule: 'ពិន្ទុអាចប្រើបានតែជាចំនួនគត់ប៉ុណ្ណោះ។ សូមប្រាប់បុគ្គលិកឲ្យអនុវត្តនៅពេល Checkout។',
    redeemSummary: 'ត្រូវការ {points} ពិន្ទុក្នុងមួយឯកតា។ បច្ចុប្បន្នអាចប្រើបាន {units} ឯកតា។',
    membershipDiscountTotal: 'បញ្ចុះតម្លៃសមាជិកដែលបានប្រើ',
    shareProofs: 'ចែករំលែក និងទទួលរង្វាន់',
    shareProofsHint: 'អតិថិជនអាចផ្ញើរូបថតបញ្ជាក់ពីការចែករំលែកអាជីវកម្ម ហើយបុគ្គលិកអាចពិនិត្យ និងផ្តល់ពិន្ទុនៅក្នុង Business OS។',
    sharePlatform: 'វេទិកា',
    sharePlatformPlaceholder: 'Facebook post, Instagram story, Telegram status...',
    shareNote: 'សាររបស់អតិថិជន',
    shareNotePlaceholder: 'សារបន្ថែមសម្រាប់ក្រុមហាង',
    sharePaste: 'បិទភ្ជាប់រូបថតនៅទីនេះ ឬផ្ទុកឡើងខាងក្រោម',
    shareUpload: 'ផ្ទុករូបថតឡើង',
    shareSubmit: 'ផ្ញើសម្រាប់ពិនិត្យ',
    shareSubmitting: 'កំពុងផ្ញើ...',
    shareRequirement: 'សូមបន្ថែមរូបថតយ៉ាងហោចណាស់មួយ មុនពេលផ្ញើ។',
    shareSubmitted: 'បានផ្ញើសំណើសម្រាប់ពិនិត្យរួចហើយ។',
    shareStatus: 'ស្ថានភាព',
    shareReward: 'រង្វាន់',
    shareReviewNote: 'កំណត់សម្គាល់ពិនិត្យ',
    sharePending: 'កំពុងរង់ចាំការពិនិត្យ',
    shareApproved: 'អនុម័ត',
    shareRejected: 'មិនអនុម័ត',
    noSubmissions: 'មិនទាន់មានសំណើចែករំលែកនៅឡើយទេ។',
    reviewQueue: 'ជួរពិនិត្យ',
    reviewQueueHint: 'អនុម័ត បដិសេធ និងផ្តល់ពិន្ទុសម្រាប់សំណើចែករំលែករបស់អតិថិជន។',
    approve: 'អនុម័ត',
    reject: 'បដិសេធ',
    pending: 'កំពុងរង់ចាំ',
    rewardPoints: 'ពិន្ទុរង្វាន់',
    reviewNotePlaceholder: 'កំណត់សម្គាល់ខាងក្នុង',
    reviewSaved: 'បានរក្សាទុកការពិនិត្យរួចហើយ។',
    invalidPublicPath: 'សូមជ្រើសរើស path សាធារណៈដែលមិនប្រើ /api, /uploads ឬ /health។',
    portalVisibilityRequired: 'សូមបើកយ៉ាងហោចណាស់កាតាឡុកទំនិញ ឬការស្វែងរកសមាជិក មុនពេលរក្សាទុកផតថល។',
  },
}

const DEFAULT_CONFIG = {
  businessName: 'Business OS',
  businessPhone: '',
  businessEmail: '',
  businessAddress: '',
  addressLink: '',
  businessTagline: '',
  googleMapsEmbed: '',
  showGoogleMap: true,
  businessLogo: '',
  businessFavicon: '',
  businessCover: '',
  showLogo: true,
  logoSize: 80,
  logoFit: 'cover',
  logoZoom: 100,
  logoPositionX: 50,
  logoPositionY: 50,
  showCover: true,
  showPhone: true,
  showEmail: true,
  showAddress: true,
  publicUrl: '',
  links: { website: '', facebook: '', instagram: '', telegram: '' },
  linkLabels: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' },
  showWebsite: true,
  showFacebook: true,
  showInstagram: true,
  showTelegram: true,
  title: 'Customer Portal',
  titleSize: 40,
  intro: 'Browse products and check membership details.',
  aiEnabled: true,
  aiTitle: 'Beauty Assistant',
  aiIntro: 'Tell us what you are shopping for and the assistant will suggest products from Leang Cosmetics.',
  aiDisclaimer: 'AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.',
  aiProviderId: null,
  aiPrompt: '',
  showFaq: true,
  faqTitle: 'Frequently asked questions',
  faqItems: [],
  showAbout: true,
  aboutTitle: 'About us',
  aboutContent: '',
  aboutBlocks: [],
  heroGradientStart: '#0f172a',
  heroGradientMid: '#14532d',
  heroGradientEnd: '#ea580c',
  language: 'en',
  languageSetting: 'auto',
  exchangeRate: 4100,
  translateWidgetEnabled: false,
  showCatalog: true,
  showMembership: true,
  showPrices: true,
  priceDisplay: 'USD',
  refreshSeconds: 20,
  stockThresholdMode: 'product',
  lowStockThreshold: 10,
  outOfStockThreshold: 0,
  gridColumnsMobile: 1,
  gridColumnsDesktop: 4,
  pointsBasis: 'usd',
  pointsPerUsd: 1,
  pointsPerKhr: 0,
  redeemPoints: 100,
  redeemValueUsd: 1,
  redeemValueKhr: 4100,
  showPointValue: true,
  membershipInfoText: 'Membership points are reviewed and applied by staff during checkout. Redemption uses whole units only.',
  submissionEnabled: true,
  submissionRewardPoints: 5,
  submissionInstructions: 'Share the business on social media, then upload screenshots here for staff review.',
  publicPath: '/customer-portal',
}

const PORTAL_CACHE_KEY = 'business-os.portal.cache.v2'

/** Resolve a portal-localized string with fallback order: extra -> base -> English -> provided fallback. */
function tt(lang, key, fallback) {
  return PORTAL_TEXT_EXTRA[lang]?.[key] || PORTAL_TEXT[lang]?.[key] || PORTAL_TEXT.en[key] || fallback
}

/** Parse UI setting flags stored as boolean-like string values. */
function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

/** Parse a finite numeric value or fall back. */
function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Restrict price display mode to supported options only. */
function normalizePriceDisplay(value) {
  return ['USD', 'KHR', 'BOTH'].includes(value) ? value : 'USD'
}

/** Normalize hex colors for customer portal theme controls. */
function normalizeHexColor(value, fallback) {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

/** Keep optional outbound portal links to full http/https URLs only. */
function normalizeExternalUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : ''
}

/** Convert hex color to rgba for layered hero background gradients. */
function hexToRgba(hex, alpha) {
  const safeHex = normalizeHexColor(hex, '#0f172a')
  const value = safeHex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  const safeAlpha = Number.isFinite(Number(alpha)) ? Number(alpha) : 1
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
}

/** Read cached portal payload to reduce visible loading delays on hard reload. */
function readPortalCache() {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PORTAL_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const ageMs = Date.now() - Number(parsed.cachedAt || 0)
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > (1000 * 60 * 20)) return null
    return parsed
  } catch (_) {
    return null
  }
}

/** Persist lightweight portal payload cache for fast first paint after refresh. */
function writePortalCache(payload) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      PORTAL_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        ...payload,
      })
    )
  } catch (_) {}
}

/** Normalize customer portal path input into safe route format. */
function normalizePortalPath(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

  return cleaned ? `/${cleaned}` : '/customer-portal'
}

/** Prevent customer portal path overlap with protected backend namespaces. */
function isReservedPortalPath(value) {
  return value === '/' || value === '/health' || value.startsWith('/api') || value.startsWith('/uploads')
}

/** Convert runtime portal config into editable key/value draft payload. */
function buildDraft(config) {
  return {
    business_name: config.businessName || '',
    business_phone: config.businessPhone || '',
    business_email: config.businessEmail || '',
    business_address: config.businessAddress || '',
    customer_portal_address_link: config.addressLink || '',
    customer_portal_business_tagline: config.businessTagline || '',
    customer_portal_google_maps_embed: config.googleMapsEmbed || '',
    customer_portal_show_google_map: !!config.showGoogleMap,
    customer_portal_logo_image: config.businessLogo || '',
    customer_portal_favicon_image: config.businessFavicon || '',
    customer_portal_logo_size: String(config.logoSize ?? 80),
    customer_portal_logo_fit: config.logoFit || 'cover',
    customer_portal_logo_zoom: String(config.logoZoom ?? 100),
    customer_portal_logo_position_x: String(config.logoPositionX ?? 50),
    customer_portal_logo_position_y: String(config.logoPositionY ?? 50),
    customer_portal_cover_image: config.businessCover || '',
    customer_portal_show_logo: !!config.showLogo,
    customer_portal_show_cover: !!config.showCover,
    customer_portal_show_phone: !!config.showPhone,
    customer_portal_show_email: !!config.showEmail,
    customer_portal_show_address: !!config.showAddress,
    customer_portal_public_url: config.publicUrl || '',
    customer_portal_website: config.links?.website || '',
    customer_portal_facebook: config.links?.facebook || '',
    customer_portal_instagram: config.links?.instagram || '',
    customer_portal_telegram: config.links?.telegram || '',
    customer_portal_website_label: config.linkLabels?.website || 'Website',
    customer_portal_facebook_label: config.linkLabels?.facebook || 'Facebook',
    customer_portal_instagram_label: config.linkLabels?.instagram || 'Instagram',
    customer_portal_telegram_label: config.linkLabels?.telegram || 'Telegram',
    customer_portal_show_website: !!config.showWebsite,
    customer_portal_show_facebook: !!config.showFacebook,
    customer_portal_show_instagram: !!config.showInstagram,
    customer_portal_show_telegram: !!config.showTelegram,
    customer_portal_title: config.title || '',
    customer_portal_title_size: String(config.titleSize ?? 40),
    customer_portal_intro: config.intro || '',
    customer_portal_ai_enabled: !!config.aiEnabled,
    customer_portal_ai_title: config.aiTitle || '',
    customer_portal_ai_intro: config.aiIntro || '',
    customer_portal_ai_disclaimer: config.aiDisclaimer || '',
    customer_portal_ai_provider_id: config.aiProviderId ? String(config.aiProviderId) : '',
    customer_portal_ai_prompt: config.aiPrompt || '',
    customer_portal_show_faq: !!config.showFaq,
    customer_portal_faq_title: config.faqTitle || '',
    customer_portal_faq_items: JSON.stringify(Array.isArray(config.faqItems) ? config.faqItems : []),
    customer_portal_show_about: !!config.showAbout,
    customer_portal_about_title: config.aboutTitle || '',
    customer_portal_about_content: config.aboutContent || '',
    customer_portal_about_blocks: serializeAboutBlocks(config.aboutBlocks || []),
    customer_portal_hero_gradient_start: config.heroGradientStart || '#0f172a',
    customer_portal_hero_gradient_mid: config.heroGradientMid || '#14532d',
    customer_portal_hero_gradient_end: config.heroGradientEnd || '#ea580c',
    customer_portal_path: config.publicPath || '/customer-portal',
    customer_portal_language: config.languageSetting || 'auto',
    customer_portal_translate_widget_enabled: !!config.translateWidgetEnabled,
    customer_portal_show_catalog: !!config.showCatalog,
    customer_portal_show_membership: !!config.showMembership,
    customer_portal_show_prices: !!config.showPrices,
    customer_portal_price_display: config.priceDisplay || 'USD',
    customer_portal_refresh_seconds: String(config.refreshSeconds ?? 20),
    customer_portal_stock_threshold_mode: config.stockThresholdMode || 'product',
    customer_portal_low_stock_threshold: String(config.lowStockThreshold ?? 10),
    customer_portal_out_of_stock_threshold: String(config.outOfStockThreshold ?? 0),
    customer_portal_grid_columns_mobile: String(config.gridColumnsMobile ?? 1),
    customer_portal_grid_columns_desktop: String(config.gridColumnsDesktop ?? 4),
    customer_portal_points_basis: config.pointsBasis || 'usd',
    customer_portal_points_per_usd: String(config.pointsPerUsd ?? 1),
    customer_portal_points_per_khr: String(config.pointsPerKhr ?? 0),
    customer_portal_redeem_points: String(config.redeemPoints ?? 100),
    customer_portal_redeem_value_usd: String(config.redeemValueUsd ?? 1),
    customer_portal_redeem_value_khr: String(config.redeemValueKhr ?? 4100),
    customer_portal_show_point_value: !!config.showPointValue,
    customer_portal_membership_info_text: config.membershipInfoText || '',
    customer_portal_submission_enabled: !!config.submissionEnabled,
    customer_portal_submission_reward_points: String(config.submissionRewardPoints ?? 5),
    customer_portal_submission_instructions: config.submissionInstructions || '',
  }
}

/** Merge editor draft back into display config with clamping and defaults. */
function applyDraft(config, draft) {
  const languageSetting = draft.customer_portal_language || config.languageSetting || 'auto'
  const resolvedLanguage = languageSetting === 'auto'
    ? (config.language || 'en')
    : languageSetting

  return {
    ...config,
    businessName: draft.business_name || config.businessName,
    businessPhone: draft.business_phone || '',
    businessEmail: draft.business_email || '',
    businessAddress: draft.business_address || '',
    addressLink: normalizeExternalUrl(draft.customer_portal_address_link || ''),
    businessTagline: draft.customer_portal_business_tagline || '',
    googleMapsEmbed: normalizeGoogleMapsEmbed(draft.customer_portal_google_maps_embed || config.googleMapsEmbed || ''),
    showGoogleMap: toBoolean(draft.customer_portal_show_google_map, config.showGoogleMap),
    businessLogo: draft.customer_portal_logo_image || '',
    businessFavicon: draft.customer_portal_favicon_image || '',
    logoSize: Math.min(144, Math.max(48, Math.round(toNumber(draft.customer_portal_logo_size, config.logoSize || 80)))),
    logoFit: draft.customer_portal_logo_fit === 'cover' ? 'cover' : 'contain',
    logoZoom: Math.min(180, Math.max(80, Math.round(toNumber(draft.customer_portal_logo_zoom, config.logoZoom || 100)))),
    logoPositionX: Math.min(100, Math.max(0, Math.round(toNumber(draft.customer_portal_logo_position_x, config.logoPositionX || 50)))),
    logoPositionY: Math.min(100, Math.max(0, Math.round(toNumber(draft.customer_portal_logo_position_y, config.logoPositionY || 50)))),
    businessCover: draft.customer_portal_cover_image || '',
    showLogo: toBoolean(draft.customer_portal_show_logo, config.showLogo),
    showCover: toBoolean(draft.customer_portal_show_cover, config.showCover),
    showPhone: toBoolean(draft.customer_portal_show_phone, config.showPhone),
    showEmail: toBoolean(draft.customer_portal_show_email, config.showEmail),
    showAddress: toBoolean(draft.customer_portal_show_address, config.showAddress),
    publicUrl: String(draft.customer_portal_public_url || '').trim(),
    links: {
      website: draft.customer_portal_website || '',
      facebook: draft.customer_portal_facebook || '',
      instagram: draft.customer_portal_instagram || '',
      telegram: draft.customer_portal_telegram || '',
    },
    linkLabels: {
      website: String(draft.customer_portal_website_label || config.linkLabels?.website || 'Website').trim() || 'Website',
      facebook: String(draft.customer_portal_facebook_label || config.linkLabels?.facebook || 'Facebook').trim() || 'Facebook',
      instagram: String(draft.customer_portal_instagram_label || config.linkLabels?.instagram || 'Instagram').trim() || 'Instagram',
      telegram: String(draft.customer_portal_telegram_label || config.linkLabels?.telegram || 'Telegram').trim() || 'Telegram',
    },
    showWebsite: toBoolean(draft.customer_portal_show_website, config.showWebsite),
    showFacebook: toBoolean(draft.customer_portal_show_facebook, config.showFacebook),
    showInstagram: toBoolean(draft.customer_portal_show_instagram, config.showInstagram),
    showTelegram: toBoolean(draft.customer_portal_show_telegram, config.showTelegram),
    title: draft.customer_portal_title || config.title,
    titleSize: Math.min(64, Math.max(28, Math.round(toNumber(draft.customer_portal_title_size, config.titleSize || 40)))),
    intro: draft.customer_portal_intro || config.intro,
    aiEnabled: toBoolean(draft.customer_portal_ai_enabled, config.aiEnabled),
    aiTitle: String(draft.customer_portal_ai_title || config.aiTitle || 'Beauty Assistant').trim() || 'Beauty Assistant',
    aiIntro: String(draft.customer_portal_ai_intro || config.aiIntro || '').trim(),
    aiDisclaimer: String(draft.customer_portal_ai_disclaimer || config.aiDisclaimer || 'AI generated, for reference only.').trim() || 'AI generated, for reference only.',
    aiProviderId: (() => {
      const id = Number(draft.customer_portal_ai_provider_id || config.aiProviderId || 0) || 0
      return id > 0 ? id : null
    })(),
    aiPrompt: String(draft.customer_portal_ai_prompt || config.aiPrompt || '').trim(),
    showFaq: toBoolean(draft.customer_portal_show_faq, config.showFaq),
    faqTitle: String(draft.customer_portal_faq_title || config.faqTitle || 'Frequently asked questions').trim() || 'Frequently asked questions',
    faqItems: (() => {
      try {
        const parsed = JSON.parse(draft.customer_portal_faq_items || JSON.stringify(config.faqItems || []))
        return Array.isArray(parsed)
          ? parsed
            .map((item, index) => ({
              id: String(item?.id || `faq-${index + 1}`).trim() || `faq-${index + 1}`,
              question: String(item?.question || '').trim(),
              answer: String(item?.answer || '').trim(),
            }))
            .filter((item) => item.question && item.answer)
          : []
      } catch (_) {
        return Array.isArray(config.faqItems) ? config.faqItems : []
      }
    })(),
    showAbout: toBoolean(draft.customer_portal_show_about, config.showAbout),
    aboutTitle: String(draft.customer_portal_about_title || config.aboutTitle || 'About us').trim() || 'About us',
    aboutContent: String(draft.customer_portal_about_content || config.aboutContent || '').trim(),
    aboutBlocks: normalizeAboutBlocks(draft.customer_portal_about_blocks || config.aboutBlocks || []),
    heroGradientStart: normalizeHexColor(draft.customer_portal_hero_gradient_start, config.heroGradientStart || '#0f172a'),
    heroGradientMid: normalizeHexColor(draft.customer_portal_hero_gradient_mid, config.heroGradientMid || '#14532d'),
    heroGradientEnd: normalizeHexColor(draft.customer_portal_hero_gradient_end, config.heroGradientEnd || '#ea580c'),
    publicPath: normalizePortalPath(draft.customer_portal_path || config.publicPath || '/customer-portal'),
    language: resolvedLanguage,
    languageSetting,
    translateWidgetEnabled: toBoolean(draft.customer_portal_translate_widget_enabled, config.translateWidgetEnabled),
    showCatalog: toBoolean(draft.customer_portal_show_catalog, config.showCatalog),
    showMembership: toBoolean(draft.customer_portal_show_membership, config.showMembership),
    showPrices: toBoolean(draft.customer_portal_show_prices, config.showPrices),
    priceDisplay: normalizePriceDisplay(draft.customer_portal_price_display || config.priceDisplay),
    refreshSeconds: Math.min(120, Math.max(5, Math.round(toNumber(draft.customer_portal_refresh_seconds, config.refreshSeconds)))),
    stockThresholdMode: draft.customer_portal_stock_threshold_mode === 'global' ? 'global' : 'product',
    lowStockThreshold: Math.max(0, toNumber(draft.customer_portal_low_stock_threshold, config.lowStockThreshold)),
    outOfStockThreshold: Math.max(0, toNumber(draft.customer_portal_out_of_stock_threshold, config.outOfStockThreshold)),
    gridColumnsMobile: Math.min(2, Math.max(1, Math.round(toNumber(draft.customer_portal_grid_columns_mobile, config.gridColumnsMobile || 1)))),
    gridColumnsDesktop: Math.min(6, Math.max(2, Math.round(toNumber(draft.customer_portal_grid_columns_desktop, config.gridColumnsDesktop || 4)))),
    pointsBasis: draft.customer_portal_points_basis === 'khr' ? 'khr' : 'usd',
    pointsPerUsd: toNumber(draft.customer_portal_points_per_usd, config.pointsPerUsd),
    pointsPerKhr: toNumber(draft.customer_portal_points_per_khr, config.pointsPerKhr),
    redeemPoints: Math.max(1, Math.floor(toNumber(draft.customer_portal_redeem_points, config.redeemPoints))),
    redeemValueUsd: Math.max(0, Math.round(toNumber(draft.customer_portal_redeem_value_usd, config.redeemValueUsd))),
    redeemValueKhr: (() => {
      const raw = Math.max(0, Math.round(toNumber(draft.customer_portal_redeem_value_khr, config.redeemValueKhr)))
      return raw === 0 ? 0 : Math.max(1000, Math.ceil(raw / 1000) * 1000)
    })(),
    showPointValue: toBoolean(draft.customer_portal_show_point_value, config.showPointValue),
    membershipInfoText: draft.customer_portal_membership_info_text || config.membershipInfoText,
    submissionEnabled: toBoolean(draft.customer_portal_submission_enabled, config.submissionEnabled),
    submissionRewardPoints: Math.max(0, Math.floor(toNumber(draft.customer_portal_submission_reward_points, config.submissionRewardPoints))),
    submissionInstructions: draft.customer_portal_submission_instructions || config.submissionInstructions,
  }
}

function statusClass(status) {
  if (status === 'out_of_stock') return 'bg-rose-100 text-rose-700 border-rose-200'
  if (status === 'low_stock') return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-emerald-100 text-emerald-700 border-emerald-200'
}

/** Resolve the visible quantity using selected branch filter. */
function getBranchQty(product, branchId) {
  if (!branchId || branchId === 'all') return Number(product.stock_quantity || 0)
  const match = (product.branch_stock || []).find((entry) => String(entry.branch_id) === String(branchId))
  return Number(match?.quantity || 0)
}

/** Compute stock badge state from product quantity and thresholds. */
function getStockStatus(product, qty, config = {}) {
  const useGlobal = config.stockThresholdMode === 'global'
  const outThreshold = Number(useGlobal ? config.outOfStockThreshold : product.out_of_stock_threshold || 0)
  const lowThreshold = Number(useGlobal ? config.lowStockThreshold : product.low_stock_threshold || 10)
  if (qty <= outThreshold) return 'out_of_stock'
  if (qty <= lowThreshold) return 'low_stock'
  return 'in_stock'
}

/** Build unique product gallery list with a max of 5 images. */
function normalizeProductGallery(product) {
  const source = Array.isArray(product?.image_gallery)
    ? product.image_gallery
    : (product?.image_path ? [product.image_path] : [])
  const unique = []
  const seen = new Set()
  for (const item of source) {
    const value = String(item || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    unique.push(value)
    if (unique.length >= 5) break
  }
  if (!unique.length && product?.image_path) unique.push(String(product.image_path))
  return unique
}

/** Format date/time strings robustly for public and editor views. */
function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(String(value).includes('T') ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

/** Render product price text according to selected portal display mode. */
function formatPortalPrice(usd, khr, config) {
  const usdValue = Number(usd || 0)
  const exchangeRate = Number(config.exchangeRate || 4100)
  const khrValue = khr != null ? Number(khr || 0) : usdValue * exchangeRate
  const usdText = `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const khrText = `${Math.round(khrValue).toLocaleString('en-US')} KHR`
  const display = normalizePriceDisplay(config.priceDisplay)
  if (display === 'KHR') return khrText
  if (display === 'BOTH') return `${usdText} / ${khrText}`
  return usdText
}

/** Shared shell block for portal sections. */
function SectionShell({ title, subtitle, action, children }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Summary metric tile used in top-level portal overview cards. */
function SummaryTile({ icon: Icon, label, value, tone }) {
  const tones = {
    blue: 'from-sky-600 to-blue-700 text-white',
    dark: 'from-slate-900 to-slate-700 text-white',
    green: 'from-emerald-600 to-teal-600 text-white',
    amber: 'from-amber-500 to-orange-500 text-white',
  }

  return (
    <div className={`rounded-[24px] bg-gradient-to-br p-4 shadow-sm ${tones[tone] || tones.dark}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">{label}</div>
          <div className="mt-2 text-2xl font-semibold">{value}</div>
        </div>
        <div className="rounded-2xl bg-white/15 p-3">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

/** Stock status badge component for product cards. */
function StatusPill({ language, status }) {
  const labelKey = status === 'out_of_stock'
    ? 'outOfStock'
    : status === 'low_stock'
      ? 'lowStock'
      : 'inStock'

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(status)}`}>
      {tt(language, labelKey, labelKey)}
    </span>
  )
}

/** Reusable image URL/file field with preview, upload, and clear actions. */
function ImageField({
  label,
  value,
  onUpload,
  onChooseExisting,
  onChange,
  onClear,
  onPreview,
  fieldId,
  uploadLabel = 'Upload',
  chooseLabel = 'Files',
  clearLabel = 'Clear',
  previewLabel = 'Preview',
  placeholder = 'https://... or upload below',
  hint = '',
}) {
  const displayValue = String(value || '').startsWith('data:image/')
    ? 'uploaded-image-data'
    : (value || '')
  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="block text-sm font-medium text-slate-700">{label}</label>
      <input id={fieldId} name={fieldId} autoComplete="off" className="input" value={displayValue} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={onUpload}>
          <Upload className="mr-2 inline h-4 w-4" />
          {uploadLabel}
        </button>
        {onChooseExisting ? <button type="button" className="btn-secondary text-sm" onClick={onChooseExisting}>{chooseLabel}</button> : null}
        {value ? (
          <button type="button" className="btn-secondary text-sm" onClick={onPreview}>
            <Eye className="mr-2 inline h-4 w-4" />
            {previewLabel}
          </button>
        ) : null}
        {value ? (
          <button type="button" className="btn-secondary text-sm" onClick={onClear}>
            {clearLabel}
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {value ? (
        <button
          type="button"
          className="block w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300"
          onClick={onPreview}
        >
          <div
            className="flex h-40 items-center justify-center rounded-2xl p-4"
            style={{
              backgroundColor: '#ffffff',
              backgroundImage: 'linear-gradient(45deg, rgba(148,163,184,0.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.08) 75%)',
              backgroundSize: '22px 22px',
              backgroundPosition: '0 0, 0 11px, 11px -11px, -11px 0px',
            }}
          >
            <img src={value} alt={label} className="max-h-full max-w-full object-contain" />
          </div>
        </button>
      ) : null}
    </div>
  )
}

/** Open picker for one image and return data URL for immediate preview/save. */
async function pickImageAsDataUrl() {
  const file = await new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => resolve(input.files?.[0] || null)
    input.click()
  })
  if (!file) return null

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

/** Open picker for multiple images and return data URLs. */
async function pickMultipleImagesAsDataUrls() {
  const files = await new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => resolve(Array.from(input.files || []))
    input.click()
  })

  const images = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })))

  return images.filter(Boolean)
}

/** Replace localized {token} placeholders with runtime values. */
function replaceVars(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (_match, key) => values?.[key] ?? '')
}

const PUBLIC_TRANSLATE_LANG_OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'en', label: 'English' },
  { value: 'km', label: 'Khmer' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ms', label: 'Malay' },
  { value: 'tr', label: 'Turkish' },
  { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' },
  { value: 'pl', label: 'Polish' },
  { value: 'cs', label: 'Czech' },
  { value: 'ro', label: 'Romanian' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'el', label: 'Greek' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
]

/** Apply Google Translate language selection by cookie + widget combo sync. */
function applyGoogleTranslateSelection(sourceLang, targetLang) {
  if (typeof document === 'undefined') return false
  const source = sourceLang === 'km' ? 'km' : 'en'
  const target = targetLang === 'original' ? source : targetLang
  const cookieValue = `googtrans=/${source}/${target}; path=/; max-age=31536000`
  document.cookie = cookieValue
  const host = window.location.hostname
  if (host && host.includes('.')) {
    document.cookie = `googtrans=/${source}/${target}; domain=.${host}; path=/; max-age=31536000`
  }
  const combo = document.querySelector('.goog-te-combo')
  if (!combo) return false
  combo.value = target
  combo.dispatchEvent(new Event('change', { bubbles: true }))
  window.setTimeout(() => {
    combo.value = target
    combo.dispatchEvent(new Event('change', { bubbles: true }))
  }, 120)
  return true
}

/** Main portal page component: editor mode (staff) and public mode (customers). */
export default function CatalogPage({ publicView = false }) {
  const { hasPermission, navigateTo, saveSettings, notify, user } = useApp()
  const { syncChannel } = useSync()
  const cachedPortalRef = useRef(readPortalCache())
  const cachedPortal = cachedPortalRef.current
  const [config, setConfig] = useState(() => ({
    ...DEFAULT_CONFIG,
    ...(cachedPortal?.config || {}),
  }))
  const [editorDraft, setEditorDraft] = useState(() => buildDraft({
    ...DEFAULT_CONFIG,
    ...(cachedPortal?.config || {}),
  }))
  const [editorDirty, setEditorDirty] = useState(false)
  const [editorSaving, setEditorSaving] = useState(false)
  const [products, setProducts] = useState(() => Array.isArray(cachedPortal?.products) ? cachedPortal.products : [])
  const [categories, setCategories] = useState(() => Array.isArray(cachedPortal?.categories) ? cachedPortal.categories : [])
  const [brands, setBrands] = useState(() => Array.isArray(cachedPortal?.brands) ? cachedPortal.brands : [])
  const [branches, setBranches] = useState(() => Array.isArray(cachedPortal?.branches) ? cachedPortal.branches : [])
  const [activeTab, setActiveTab] = useState('products')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState([])
  const [brandFilter, setBrandFilter] = useState([])
  const [branchFilter, setBranchFilter] = useState([])
  const [stockFilter, setStockFilter] = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [membershipNumber, setMembershipNumber] = useState('')
  const [membershipData, setMembershipData] = useState(null)
  const [membershipError, setMembershipError] = useState('')
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [portalError, setPortalError] = useState('')
  const [loading, setLoading] = useState(() => !(cachedPortal?.config || cachedPortal?.products?.length))
  const [submissionDraft, setSubmissionDraft] = useState({ platform: '', note: '', screenshots: [] })
  const [submissionSaving, setSubmissionSaving] = useState(false)
  const [reviewItems, setReviewItems] = useState([])
  const [reviewSavingId, setReviewSavingId] = useState(null)
  const [aiProviders, setAiProviders] = useState([])
  const [translateReady, setTranslateReady] = useState(false)
  const [translateTarget, setTranslateTarget] = useState('original')
  const [mobileHeroToolsOpen, setMobileHeroToolsOpen] = useState(false)
  const [productGalleryView, setProductGalleryView] = useState({ open: false, title: '', items: [], index: 0 })
  const [portalImageView, setPortalImageView] = useState({ open: false, title: '', images: [], index: 0 })
  const [filePicker, setFilePicker] = useState({ open: false, target: null, mediaType: 'image', title: 'Choose file' })
  const [activeEditorSection, setActiveEditorSection] = useState('branding')
  const [dragAboutBlockId, setDragAboutBlockId] = useState(null)
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantProfile, setAssistantProfile] = useState({
    brand: '',
    skinType: '',
    concerns: '',
    shoppingFor: '',
    goal: '',
  })
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantResponse, setAssistantResponse] = useState(null)
  const [assistantError, setAssistantError] = useState('')
  const [assistantExpandedProductId, setAssistantExpandedProductId] = useState(null)
  const [assistantUsage, setAssistantUsage] = useState(null)
  const [assistantRequestPolicy, setAssistantRequestPolicy] = useState(null)
  const [expandedFaqId, setExpandedFaqId] = useState(null)
  const deferredSearch = useDeferredValue(search)
  const loadRequestRef = useRef(0)
  const syncReloadTimerRef = useRef(null)
  const previewSectionRef = useRef(null)

  const canEdit = !publicView && hasPermission('settings')
  const previewConfig = useMemo(
    () => (canEdit ? applyDraft(config, editorDraft) : config),
    [canEdit, config, editorDraft]
  )
  const language = previewConfig.language === 'km' ? 'km' : 'en'
  const copy = (key, fallback) => tt(language, key, fallback)
  const resolveVisibleTab = (candidate, cfg = previewConfig) => {
    const visible = [
      cfg.showCatalog ? 'products' : null,
      cfg.showMembership ? 'membership' : null,
      cfg.showAbout ? 'about' : null,
      cfg.showFaq ? 'faq' : null,
      cfg.aiEnabled ? 'ai' : null,
    ].filter(Boolean)
    if (!visible.length) return 'products'
    return visible.includes(candidate) ? candidate : visible[0]
  }
  const generatedPublicUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${previewConfig.publicPath || '/customer-portal'}`
    : (previewConfig.publicPath || '/customer-portal')
  const publicPortalUrl = String(previewConfig.publicUrl || '').trim() || generatedPublicUrl
  const logoVersionSeed = [
    previewConfig.businessLogo,
    previewConfig.logoSize,
    previewConfig.logoZoom,
    previewConfig.logoPositionX,
    previewConfig.logoPositionY,
    previewConfig.logoFit,
  ].join('|')
  const faviconVersionSeed = [
    previewConfig.businessFavicon || previewConfig.businessLogo,
    previewConfig.businessFavicon ? 'portal-favicon' : 'logo-fallback',
    previewConfig.logoFit,
    previewConfig.logoZoom,
    previewConfig.logoPositionX,
    previewConfig.logoPositionY,
  ].join('|')
  const coverVersionSeed = [
    previewConfig.businessCover,
    previewConfig.heroGradientStart,
    previewConfig.heroGradientMid,
    previewConfig.heroGradientEnd,
  ].join('|')
  const versionedBusinessLogo = withAssetVersion(previewConfig.businessLogo, logoVersionSeed)
  const versionedBusinessFavicon = withAssetVersion(previewConfig.businessFavicon || previewConfig.businessLogo, faviconVersionSeed)
  const versionedBusinessCover = withAssetVersion(previewConfig.businessCover, coverVersionSeed)
  const aboutBlocks = useMemo(
    () => normalizeAboutBlocks(editorDraft.customer_portal_about_blocks || previewConfig.aboutBlocks || [], { keepEmpty: true }),
    [editorDraft.customer_portal_about_blocks, previewConfig.aboutBlocks]
  )
  const faqItems = useMemo(() => {
    const raw = editorDraft.customer_portal_faq_items || JSON.stringify(previewConfig.faqItems || [])
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.map((item, index) => ({
            id: String(item?.id || `faq-${index + 1}`).trim() || `faq-${index + 1}`,
            question: String(item?.question || '').trim(),
            answer: String(item?.answer || '').trim(),
          }))
        : []
    } catch (_) {
      return Array.isArray(previewConfig.faqItems) ? previewConfig.faqItems : []
    }
  }, [editorDraft.customer_portal_faq_items, previewConfig.faqItems])
  const assistantCategoryOptions = useMemo(() => {
    const names = categories.map((entry) => String(entry?.name || '').trim()).filter(Boolean)
    return Array.from(new Set([
      ...names,
      'Skincare',
      'Cosmetics',
      'Perfume',
      'Body care',
      'Hair care',
      'Cleanser',
      'Sunscreen',
    ])).sort((left, right) => left.localeCompare(right))
  }, [categories])

  useEffect(() => {
    setActiveTab((current) => resolveVisibleTab(current, previewConfig))
  }, [previewConfig.showCatalog, previewConfig.showMembership, previewConfig.showAbout, previewConfig.showFaq, previewConfig.aiEnabled])

  useEffect(() => {
    if (!publicView || !previewConfig.aiEnabled) {
      setAssistantUsage(null)
      setAssistantRequestPolicy(null)
      return
    }

    window.api.getPortalAiStatus()
      .then((result) => {
        setAssistantUsage(result?.usage || null)
      })
      .catch(() => {})
  }, [publicView, previewConfig.aiEnabled, previewConfig.aiProviderId])

  /** Open modal gallery for selected product image list. */
  function openProductGallery(product, startIndex = 0) {
    const items = normalizeProductGallery(product)
    if (!items.length) return
    const safeStart = Math.max(0, Math.min(startIndex, items.length - 1))
    setProductGalleryView({
      open: true,
      title: product?.name || copy('products', 'Products'),
      items,
      index: safeStart,
    })
  }

  /** Apply selected language via Google Translate widget and fallback refresh. */
  function changeTranslateTarget(nextTarget) {
    setTranslateTarget(nextTarget)
    if (!publicView || !previewConfig.translateWidgetEnabled) return
    const applied = applyGoogleTranslateSelection(language, nextTarget)
    if (!applied && typeof window !== 'undefined') {
      window.setTimeout(() => {
        applyGoogleTranslateSelection(language, nextTarget)
      }, 180)
    }
  }

  /** Fetch all portal data needed by current mode (public/editor). */
  async function loadPortal() {
    const requestId = ++loadRequestRef.current
    const [portalConfig, meta, portalProducts] = await Promise.all([
      window.api.getPortalConfig(),
      window.api.getPortalCatalogMeta(),
      window.api.getPortalCatalogProducts(),
    ])
    if (requestId !== loadRequestRef.current) return

    const nextConfig = { ...DEFAULT_CONFIG, ...portalConfig }
    const nextMeta = {
      categories: Array.isArray(meta?.categories) ? meta.categories : [],
      brands: Array.isArray(meta?.brands) ? meta.brands : [],
      branches: Array.isArray(meta?.branches) ? meta.branches : [],
    }
    const nextProducts = Array.isArray(portalProducts) ? portalProducts : []

    setConfig(nextConfig)
    if (!editorDirty) setEditorDraft(buildDraft(nextConfig))
    setCategories(nextMeta.categories)
    setBrands(nextMeta.brands)
    setBranches(nextMeta.branches)
    setProducts(nextProducts)
    setActiveTab((current) => resolveVisibleTab(current, nextConfig))

    writePortalCache({
      config: nextConfig,
      ...nextMeta,
      products: nextProducts,
      reviewItems: canEdit ? reviewItems : [],
    })

    if (!canEdit) return
    window.api.getAiProviders()
      .then((providerResult) => {
        if (requestId !== loadRequestRef.current) return
        setAiProviders(Array.isArray(providerResult?.items) ? providerResult.items : [])
      })
      .catch(() => {})

    window.api.getPortalSubmissionsForReview()
      .then((reviewData) => {
        if (requestId !== loadRequestRef.current) return
        const normalizedReviewItems = Array.isArray(reviewData)
          ? reviewData.map((item) => (
              item?.status === 'pending' && !Number(item?.reward_points)
                ? { ...item, reward_points: nextConfig.submissionRewardPoints }
                : item
            ))
          : []
        setReviewItems(normalizedReviewItems)
        writePortalCache({
          config: nextConfig,
          ...nextMeta,
          products: nextProducts,
          reviewItems: normalizedReviewItems,
        })
      })
      .catch(() => {})
  }

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const hasCachedData = !!(
          products.length
          || categories.length
          || brands.length
          || branches.length
          || cachedPortal
        )
        if (!hasCachedData) setLoading(true)
        setPortalError('')
        await loadPortal()
      } catch (error) {
        if (!cancelled) setPortalError(error?.message || 'Failed to load customer portal')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()

    if (!publicView) return () => { cancelled = true }

    const timer = window.setInterval(() => {
      loadPortal().catch(() => {})
    }, Math.max(5, Number(previewConfig.refreshSeconds || 20)) * 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [publicView, previewConfig.refreshSeconds])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    if (publicView) {
      document.body.setAttribute('data-public-portal', 'true')
      document.documentElement.setAttribute('data-public-portal', 'true')
    } else {
      document.body.removeAttribute('data-public-portal')
      document.documentElement.removeAttribute('data-public-portal')
    }
    return () => {
      document.body.removeAttribute('data-public-portal')
      document.documentElement.removeAttribute('data-public-portal')
    }
  }, [publicView])

  useEffect(() => {
    if (!publicView || typeof document === 'undefined') return undefined
    const previousTitle = document.title
    const titleText = String(previewConfig.businessName || previewConfig.title || 'Customer Portal').trim()
    document.title = titleText || 'Customer Portal'

    let iconEl = document.querySelector('link[rel="icon"]')
    let createdIcon = false
    let previousHref = ''
    if (iconEl) previousHref = iconEl.getAttribute('href') || ''
    if (!iconEl) {
      iconEl = document.createElement('link')
      iconEl.setAttribute('rel', 'icon')
      document.head.appendChild(iconEl)
      createdIcon = true
    }
    const iconSource = previewConfig.showLogo ? versionedBusinessFavicon : ''
    const faviconOptions = previewConfig.businessFavicon
      ? { fit: 'cover', zoom: 100, positionX: 50, positionY: 50 }
      : {
          fit: previewConfig.logoFit,
          zoom: previewConfig.logoZoom,
          positionX: previewConfig.logoPositionX,
          positionY: previewConfig.logoPositionY,
        }
    let cancelled = false

    if (iconSource) {
      createCircularFaviconDataUrl(iconSource, faviconOptions)
        .then((faviconHref) => {
          if (cancelled || !iconEl) return
          iconEl.setAttribute('href', faviconHref || iconSource)
        })
        .catch(() => {
          if (cancelled || !iconEl) return
          iconEl.setAttribute('href', iconSource)
        })
    }

    return () => {
      cancelled = true
      document.title = previousTitle
      if (createdIcon && iconEl) {
        iconEl.remove()
      } else if (iconEl) {
        if (previousHref) iconEl.setAttribute('href', previousHref)
        else iconEl.removeAttribute('href')
      }
    }
  }, [
    publicView,
    previewConfig.businessFavicon,
    previewConfig.businessLogo,
    previewConfig.businessName,
    previewConfig.logoFit,
    previewConfig.logoPositionX,
    previewConfig.logoPositionY,
    previewConfig.logoZoom,
    previewConfig.showLogo,
    previewConfig.title,
    versionedBusinessFavicon,
  ])

  useEffect(() => {
    if (!publicView || !previewConfig.translateWidgetEnabled) return undefined
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined

    const initId = 'business-os-portal-translate'
    setTranslateReady(false)
    window.businessOsPortalTranslateInit = () => {
      const container = document.getElementById(initId)
      if (!container || !window.google?.translate?.TranslateElement) return
      try {
        container.innerHTML = ''
        new window.google.translate.TranslateElement(
          {
            pageLanguage: language,
            includedLanguages: PUBLIC_TRANSLATE_LANG_OPTIONS
              .map((option) => option.value)
              .filter((value) => value !== 'original')
              .join(','),
            layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE,
            autoDisplay: false,
          },
          initId
        )
        setTranslateReady(true)
      } catch (_) {
        setTranslateReady(false)
      }
    }

    if (window.google?.translate?.TranslateElement) {
      window.businessOsPortalTranslateInit()
      return () => {}
    }

    let script = document.getElementById('business-os-portal-translate-script')
    if (!script) {
      script = document.createElement('script')
      script.id = 'business-os-portal-translate-script'
      script.src = 'https://translate.google.com/translate_a/element.js?cb=businessOsPortalTranslateInit'
      script.async = true
      document.body.appendChild(script)
    }

    return () => {}
  }, [publicView, previewConfig.translateWidgetEnabled, language])

  useEffect(() => {
    if (!syncChannel) return undefined
    if (!['products', 'settings', 'customers', 'sales', 'returns', 'branches', 'categories'].includes(syncChannel.channel)) {
      return undefined
    }

    if (syncReloadTimerRef.current) window.clearTimeout(syncReloadTimerRef.current)
    syncReloadTimerRef.current = window.setTimeout(() => {
      loadPortal().catch(() => {})
    }, 180)

    return () => {
      if (syncReloadTimerRef.current) {
        window.clearTimeout(syncReloadTimerRef.current)
        syncReloadTimerRef.current = null
      }
    }
  }, [syncChannel])

  useEffect(() => {
    if (!publicView || !previewConfig.translateWidgetEnabled || !translateReady) return undefined
    let tries = 0
    const maxTries = 60
    const timer = window.setInterval(() => {
      tries += 1
      const applied = applyGoogleTranslateSelection(language, translateTarget)
      if (applied || tries >= maxTries) {
        window.clearInterval(timer)
      }
    }, 150)
    const firstAttemptApplied = applyGoogleTranslateSelection(language, translateTarget)
    if (firstAttemptApplied) {
      window.clearInterval(timer)
    }
    return () => window.clearInterval(timer)
  }, [language, previewConfig.translateWidgetEnabled, publicView, translateReady, translateTarget])

  const filteredProducts = useMemo(() => {
    const terms = deferredSearch.toLowerCase().split(/[\s,]+/).map((term) => term.trim()).filter(Boolean)

    return products.filter((product) => {
      const haystack = [
        product.name,
        product.category,
        product.brand,
        product.description,
      ].join(' ').toLowerCase()

      if (terms.length > 0 && !terms.every((term) => haystack.includes(term))) return false
      if (categoryFilter.length && !categoryFilter.includes(product.category || '')) return false
      if (brandFilter.length && !brandFilter.includes(product.brand || '')) return false

      if (branchFilter.length) {
        const hasStockInSelectedBranch = branchFilter.some((branchId) => getBranchQty(product, branchId) > 0)
        if (!hasStockInSelectedBranch) return false
      }

      const statusBranch = branchFilter.length === 1 ? branchFilter[0] : 'all'
      const qty = getBranchQty(product, statusBranch)
      const status = getStockStatus(product, qty, previewConfig)
      if (stockFilter.length && !stockFilter.includes(status)) return false

      return true
    })
  }, [products, deferredSearch, categoryFilter, brandFilter, branchFilter, stockFilter, previewConfig])

  function toggleFilterValue(values, setter, value) {
    setter((current) => (
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    ))
  }

  function clearPortalFilters() {
    setCategoryFilter([])
    setBrandFilter([])
    setBranchFilter([])
    setStockFilter([])
  }

  function setDraft(key, value) {
    setEditorDirty(true)
    setEditorDraft((current) => ({ ...current, [key]: value }))
  }

  function openPortalImage(title, images, index = 0) {
    const safeImages = Array.isArray(images) ? images.filter(Boolean) : []
    if (!safeImages.length) return
    setPortalImageView({
      open: true,
      title: title || copy('openGallery', 'Open image gallery'),
      images: safeImages,
      index: Math.max(0, Math.min(index, safeImages.length - 1)),
    })
  }

  function setAboutBlocksDraft(nextBlocks) {
    setDraft('customer_portal_about_blocks', serializeAboutBlocks(nextBlocks))
  }

  function updateAboutBlock(blockId, key, value) {
    setAboutBlocksDraft(aboutBlocks.map((block) => (
      block.id === blockId ? { ...block, [key]: value } : block
    )))
  }

  function addAboutBlock(type) {
    setAboutBlocksDraft([...aboutBlocks, createAboutBlock(type)])
  }

  function moveAboutBlockBefore(dragId, targetId) {
    if (!dragId || !targetId || dragId === targetId) return
    const nextBlocks = [...aboutBlocks]
    const dragIndex = nextBlocks.findIndex((block) => block.id === dragId)
    const targetIndex = nextBlocks.findIndex((block) => block.id === targetId)
    if (dragIndex < 0 || targetIndex < 0) return
    const [draggedBlock] = nextBlocks.splice(dragIndex, 1)
    const insertIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex
    nextBlocks.splice(insertIndex, 0, draggedBlock)
    setAboutBlocksDraft(nextBlocks)
  }

  function removeAboutBlock(blockId) {
    setAboutBlocksDraft(aboutBlocks.filter((block) => block.id !== blockId))
  }

  function setFaqDraft(nextItems) {
    setDraft('customer_portal_faq_items', JSON.stringify(nextItems))
  }

  function addFaqItem() {
    setFaqDraft([
      ...faqItems,
      {
        id: `faq-${Date.now()}`,
        question: '',
        answer: '',
      },
    ])
  }

  function updateFaqItem(itemId, key, value) {
    setFaqDraft(faqItems.map((item) => (
      item.id === itemId ? { ...item, [key]: value } : item
    )))
  }

  function removeFaqItem(itemId) {
    setFaqDraft(faqItems.filter((item) => item.id !== itemId))
  }

  function clearAssistantState() {
    setAssistantQuestion('')
    setAssistantProfile({
      brand: '',
      skinType: '',
      concerns: '',
      shoppingFor: '',
      goal: '',
    })
    setAssistantResponse(null)
    setAssistantError('')
    setAssistantExpandedProductId(null)
    setAssistantRequestPolicy(null)
  }

  async function uploadPortalImage(accept = 'image/*') {
    try {
      const file = await new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = accept
        input.onchange = () => resolve(input.files?.[0] || null)
        input.click()
      })
      if (!file) return ''
      const uploaded = await window.api.uploadFileAsset({ file, userId: user?.id, userName: user?.name })
      if (!uploaded?.public_path) throw new Error(uploaded?.error || 'Image upload failed')
      return uploaded.public_path
    } catch (error) {
      notify(error?.message || 'Image upload failed', 'error')
      return ''
    }
  }

  async function uploadDraftImage(key) {
    const path = await uploadPortalImage('image/*')
    if (path) setDraft(key, path)
  }

  async function uploadAboutBlockMedia(blockId) {
    const block = aboutBlocks.find((entry) => entry.id === blockId)
    const accept = block?.type === 'video' ? 'video/*' : 'image/*'
    const path = await uploadPortalImage(accept)
    if (path) {
      updateAboutBlock(blockId, 'mediaUrl', path)
    }
  }

  function openFilePicker(target, mediaType = 'image', title = copy('openGallery', 'Choose file')) {
    setFilePicker({ open: true, target, mediaType, title })
  }

  function handleFilePickerSelect(publicPath) {
    const target = filePicker.target
    if (!target) return
    if (
      target === 'customer_portal_logo_image'
      || target === 'customer_portal_favicon_image'
      || target === 'customer_portal_cover_image'
    ) {
      setDraft(target, publicPath)
      return
    }
    if (String(target).startsWith('about:')) {
      updateAboutBlock(String(target).slice('about:'.length), 'mediaUrl', publicPath)
    }
  }

  async function savePortalDraft() {
    try {
      const normalizedPath = normalizePortalPath(editorDraft.customer_portal_path || '/customer-portal')
      if (isReservedPortalPath(normalizedPath)) {
        notify(copy('invalidPublicPath', 'Choose a public path outside /api, /uploads, and /health.'), 'error')
        return
      }
      if (
        !editorDraft.customer_portal_show_catalog
        && !editorDraft.customer_portal_show_membership
        && !editorDraft.customer_portal_show_about
        && !editorDraft.customer_portal_show_faq
        && !editorDraft.customer_portal_ai_enabled
      ) {
        notify(copy('portalVisibilityRequired', 'Enable at least one customer section before saving the portal.'), 'error')
        return
      }

      const sanitizedRefreshSeconds = Math.min(120, Math.max(5, Math.floor(toNumber(editorDraft.customer_portal_refresh_seconds, 20))))
      const sanitizedLowStockThreshold = Math.max(0, toNumber(editorDraft.customer_portal_low_stock_threshold, 10))
      const sanitizedOutOfStockThreshold = Math.max(0, toNumber(editorDraft.customer_portal_out_of_stock_threshold, 0))
      const sanitizedGridMobile = Math.min(2, Math.max(1, Math.round(toNumber(editorDraft.customer_portal_grid_columns_mobile, 1))))
        const sanitizedGridDesktop = Math.min(6, Math.max(2, Math.round(toNumber(editorDraft.customer_portal_grid_columns_desktop, 4))))
        const sanitizedLogoSize = Math.min(144, Math.max(48, Math.round(toNumber(editorDraft.customer_portal_logo_size, 80))))
        const sanitizedLogoZoom = Math.min(180, Math.max(80, Math.round(toNumber(editorDraft.customer_portal_logo_zoom, 100))))
        const sanitizedLogoPositionX = Math.min(100, Math.max(0, Math.round(toNumber(editorDraft.customer_portal_logo_position_x, 50))))
        const sanitizedLogoPositionY = Math.min(100, Math.max(0, Math.round(toNumber(editorDraft.customer_portal_logo_position_y, 50))))
        const sanitizedPublicUrl = String(editorDraft.customer_portal_public_url || '').trim()
      const sanitizedGoogleMapEmbed = normalizeGoogleMapsEmbed(editorDraft.customer_portal_google_maps_embed || '')
      if (sanitizedPublicUrl && !/^https?:\/\/.+/i.test(sanitizedPublicUrl)) {
        notify(copy('publicUrlHint', 'Use a full https:// URL for the public customer portal if you set one.'), 'error')
        return
      }
      if (editorDraft.customer_portal_google_maps_embed && !sanitizedGoogleMapEmbed) {
        notify(copy('mapEmbedHint', 'Paste a Google Maps link or embed URL. The portal will render it as an interactive map card.'), 'error')
        return
      }

      setEditorSaving(true)
      await saveSettings({
        business_name: editorDraft.business_name || '',
        business_phone: editorDraft.business_phone || '',
        business_email: editorDraft.business_email || '',
        business_address: editorDraft.business_address || '',
        customer_portal_address_link: normalizeExternalUrl(editorDraft.customer_portal_address_link || ''),
        customer_portal_business_tagline: editorDraft.customer_portal_business_tagline || '',
        customer_portal_google_maps_embed: sanitizedGoogleMapEmbed,
        customer_portal_show_google_map: editorDraft.customer_portal_show_google_map ? 'true' : 'false',
        customer_portal_logo_image: editorDraft.customer_portal_logo_image || '',
        customer_portal_favicon_image: editorDraft.customer_portal_favicon_image || '',
        customer_portal_logo_size: String(sanitizedLogoSize),
        customer_portal_logo_fit: editorDraft.customer_portal_logo_fit === 'cover' ? 'cover' : 'contain',
        customer_portal_logo_zoom: String(sanitizedLogoZoom),
        customer_portal_logo_position_x: String(sanitizedLogoPositionX),
        customer_portal_logo_position_y: String(sanitizedLogoPositionY),
        customer_portal_cover_image: editorDraft.customer_portal_cover_image || '',
        customer_portal_show_logo: editorDraft.customer_portal_show_logo ? 'true' : 'false',
        customer_portal_show_cover: editorDraft.customer_portal_show_cover ? 'true' : 'false',
        customer_portal_show_phone: editorDraft.customer_portal_show_phone ? 'true' : 'false',
        customer_portal_show_email: editorDraft.customer_portal_show_email ? 'true' : 'false',
        customer_portal_show_address: editorDraft.customer_portal_show_address ? 'true' : 'false',
        customer_portal_public_url: sanitizedPublicUrl,
        customer_portal_website: editorDraft.customer_portal_website || '',
        customer_portal_facebook: editorDraft.customer_portal_facebook || '',
        customer_portal_instagram: editorDraft.customer_portal_instagram || '',
        customer_portal_telegram: editorDraft.customer_portal_telegram || '',
        customer_portal_website_label: String(editorDraft.customer_portal_website_label || 'Website').trim() || 'Website',
        customer_portal_facebook_label: String(editorDraft.customer_portal_facebook_label || 'Facebook').trim() || 'Facebook',
        customer_portal_instagram_label: String(editorDraft.customer_portal_instagram_label || 'Instagram').trim() || 'Instagram',
        customer_portal_telegram_label: String(editorDraft.customer_portal_telegram_label || 'Telegram').trim() || 'Telegram',
        customer_portal_show_website: editorDraft.customer_portal_show_website ? 'true' : 'false',
        customer_portal_show_facebook: editorDraft.customer_portal_show_facebook ? 'true' : 'false',
        customer_portal_show_instagram: editorDraft.customer_portal_show_instagram ? 'true' : 'false',
        customer_portal_show_telegram: editorDraft.customer_portal_show_telegram ? 'true' : 'false',
        customer_portal_title: editorDraft.customer_portal_title || '',
        customer_portal_title_size: String(Math.min(64, Math.max(28, Math.round(toNumber(editorDraft.customer_portal_title_size, 40))))),
        customer_portal_intro: editorDraft.customer_portal_intro || '',
        customer_portal_ai_enabled: editorDraft.customer_portal_ai_enabled ? 'true' : 'false',
        customer_portal_ai_title: String(editorDraft.customer_portal_ai_title || '').trim(),
        customer_portal_ai_intro: String(editorDraft.customer_portal_ai_intro || '').trim(),
        customer_portal_ai_disclaimer: String(editorDraft.customer_portal_ai_disclaimer || '').trim(),
        customer_portal_ai_provider_id: String(editorDraft.customer_portal_ai_provider_id || '').trim(),
        customer_portal_ai_prompt: String(editorDraft.customer_portal_ai_prompt || '').trim(),
        customer_portal_show_faq: editorDraft.customer_portal_show_faq ? 'true' : 'false',
        customer_portal_faq_title: String(editorDraft.customer_portal_faq_title || '').trim(),
        customer_portal_faq_items: JSON.stringify(faqItems),
        customer_portal_show_about: editorDraft.customer_portal_show_about ? 'true' : 'false',
        customer_portal_about_title: String(editorDraft.customer_portal_about_title || '').trim(),
        customer_portal_about_content: String(editorDraft.customer_portal_about_content || '').trim(),
        customer_portal_about_blocks: serializeAboutBlocks(aboutBlocks),
        customer_portal_hero_gradient_start: normalizeHexColor(editorDraft.customer_portal_hero_gradient_start, '#0f172a'),
        customer_portal_hero_gradient_mid: normalizeHexColor(editorDraft.customer_portal_hero_gradient_mid, '#14532d'),
        customer_portal_hero_gradient_end: normalizeHexColor(editorDraft.customer_portal_hero_gradient_end, '#ea580c'),
        customer_portal_path: normalizedPath,
        customer_portal_language: editorDraft.customer_portal_language || 'auto',
        customer_portal_translate_widget_enabled: editorDraft.customer_portal_translate_widget_enabled ? 'true' : 'false',
        customer_portal_show_catalog: editorDraft.customer_portal_show_catalog ? 'true' : 'false',
        customer_portal_show_membership: editorDraft.customer_portal_show_membership ? 'true' : 'false',
        customer_portal_show_prices: editorDraft.customer_portal_show_prices ? 'true' : 'false',
        customer_portal_price_display: editorDraft.customer_portal_price_display || 'USD',
        customer_portal_refresh_seconds: String(sanitizedRefreshSeconds),
        customer_portal_stock_threshold_mode: editorDraft.customer_portal_stock_threshold_mode === 'global' ? 'global' : 'product',
        customer_portal_low_stock_threshold: String(sanitizedLowStockThreshold),
        customer_portal_out_of_stock_threshold: String(sanitizedOutOfStockThreshold),
        customer_portal_grid_columns_mobile: String(sanitizedGridMobile),
        customer_portal_grid_columns_desktop: String(sanitizedGridDesktop),
        customer_portal_submission_enabled: editorDraft.customer_portal_submission_enabled ? 'true' : 'false',
        customer_portal_submission_reward_points: String(Math.max(0, Math.floor(toNumber(editorDraft.customer_portal_submission_reward_points, previewConfig.submissionRewardPoints || 5)))),
        customer_portal_submission_instructions: editorDraft.customer_portal_submission_instructions || '',
      })
      setConfig((current) => applyDraft(current, editorDraft))
      setEditorDirty(false)
      await loadPortal()
    } catch (error) {
      notify(error?.message || 'Failed to save portal', 'error')
    } finally {
      setEditorSaving(false)
    }
  }

  async function askAssistant() {
    if (!previewConfig.aiEnabled) {
      notify(copy('assistantEnabled', 'Enable AI assistant'), 'error')
      return
    }
    if (!aiProviders.length && canEdit) {
      notify(copy('assistantNoProvider', 'Choose and test an AI provider in Library before enabling the portal assistant.'), 'error')
      return
    }
    if (!assistantQuestion.trim() && !Object.values(assistantProfile).some(Boolean)) {
      notify('Add a question or at least one shopping preference first.', 'error')
      return
    }

    setAssistantLoading(true)
    setAssistantError('')
    setAssistantExpandedProductId(null)
    try {
      const result = await window.api.askPortalAi({
        question: assistantQuestion.trim(),
        profile: assistantProfile,
      })
      setAssistantResponse(result || null)
      setAssistantUsage(result?.usage || null)
      setAssistantRequestPolicy(result?.requestPolicy || null)
    } catch (error) {
      setAssistantError(error?.message || 'Portal AI request failed')
      notify(error?.message || 'Portal AI request failed', 'error')
    } finally {
      setAssistantLoading(false)
    }
  }

  async function handleMembershipLookup() {
    const value = membershipNumber.trim()
    if (!value) {
      setMembershipError(copy('membershipRequired', 'Please enter a membership number.'))
      setMembershipData(null)
      return
    }

    try {
      setMembershipLoading(true)
      setMembershipError('')
      const result = await window.api.lookupPortalMembership(value)
      if (!result) {
        setMembershipData(null)
        setMembershipError(copy('membershipNotFound', 'Membership number not found.'))
        return
      }
      setMembershipData(result)
    } catch (error) {
      setMembershipData(null)
      setMembershipError(error?.message || 'Lookup failed')
    } finally {
      setMembershipLoading(false)
    }
  }

  async function addSubmissionImages(images) {
    const next = Array.isArray(images) ? images.filter(Boolean) : []
    if (!next.length) return
    setSubmissionDraft((current) => ({
      ...current,
      screenshots: [...current.screenshots, ...next].slice(0, 8),
    }))
  }

  async function handleSubmissionPaste(event) {
    const files = Array.from(event.clipboardData?.items || [])
      .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
      .filter(Boolean)

    if (!files.length) return
    event.preventDefault()
    const images = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Failed to read pasted image'))
      reader.readAsDataURL(file)
    })))
    addSubmissionImages(images)
  }

  async function handleSubmitShareProof() {
    if (!previewConfig.submissionEnabled) {
      notify(copy('submissionDisabled', 'Share submissions are currently disabled.'), 'error')
      return
    }
    const membershipNumberValue = membershipData?.customer?.membership_number || membershipNumber.trim()
    if (!membershipNumberValue) {
      setMembershipError(copy('membershipRequired', 'Please enter a membership number.'))
      return
    }
    if (!submissionDraft.screenshots.length) {
      notify(copy('shareRequirement', 'Add at least one screenshot before submitting.'), 'error')
      return
    }

    try {
      setSubmissionSaving(true)
      await window.api.createPortalSubmission({
        membershipNumber: membershipNumberValue,
        platform: submissionDraft.platform,
        note: submissionDraft.note,
        screenshots: submissionDraft.screenshots,
      })
      notify(copy('shareSubmitted', 'Submission sent for review.'), 'success')
      setSubmissionDraft({ platform: '', note: '', screenshots: [] })
      const refreshed = await window.api.lookupPortalMembership(membershipNumberValue)
      if (refreshed) setMembershipData(refreshed)
      if (canEdit) loadPortal().catch(() => {})
    } catch (error) {
      notify(error?.message || 'Submission failed', 'error')
    } finally {
      setSubmissionSaving(false)
    }
  }

  async function handleReviewSubmission(item, status) {
    try {
      setReviewSavingId(item.id)
      await window.api.reviewPortalSubmission(item.id, {
        status,
        reward_points: item.reward_points || 0,
        review_note: item.review_note || '',
        userId: user?.id,
        userName: user?.name,
      })
      notify(copy('reviewSaved', 'Review saved.'), 'success')
      await loadPortal()
      if (membershipData?.customer?.membership_number) {
        const refreshed = await window.api.lookupPortalMembership(membershipData?.customer?.membership_number)
        if (refreshed) setMembershipData(refreshed)
      }
    } catch (error) {
      notify(error?.message || 'Failed to save review', 'error')
    } finally {
      setReviewSavingId(null)
    }
  }

  const mapEmbedUrl = previewConfig.showGoogleMap
    ? normalizeGoogleMapsEmbed(previewConfig.googleMapsEmbed || '')
    : ''
  const socialLinks = [
    {
      key: 'website',
      enabled: previewConfig.showWebsite,
      label: String(previewConfig.linkLabels?.website || copy('website', 'Website')).trim() || copy('website', 'Website'),
      value: previewConfig.links?.website,
      icon: Globe,
    },
    {
      key: 'facebook',
      enabled: previewConfig.showFacebook,
      label: String(previewConfig.linkLabels?.facebook || copy('facebook', 'Facebook')).trim() || copy('facebook', 'Facebook'),
      value: previewConfig.links?.facebook,
      icon: Facebook,
    },
    {
      key: 'instagram',
      enabled: previewConfig.showInstagram,
      label: String(previewConfig.linkLabels?.instagram || copy('instagram', 'Instagram')).trim() || copy('instagram', 'Instagram'),
      value: previewConfig.links?.instagram,
      icon: Instagram,
    },
    {
      key: 'telegram',
      enabled: previewConfig.showTelegram,
      label: String(previewConfig.linkLabels?.telegram || copy('telegram', 'Telegram')).trim() || copy('telegram', 'Telegram'),
      value: previewConfig.links?.telegram,
      icon: Send,
    },
  ].filter((item) => item.enabled && item.value)

  const businessFacts = [
    { key: 'phone', enabled: previewConfig.showPhone, label: copy('phone', 'Phone'), value: previewConfig.businessPhone, href: previewConfig.businessPhone ? `tel:${previewConfig.businessPhone}` : '', icon: Phone },
    { key: 'email', enabled: previewConfig.showEmail, label: copy('email', 'Email'), value: previewConfig.businessEmail, href: previewConfig.businessEmail ? `mailto:${previewConfig.businessEmail}` : '', icon: Mail },
    { key: 'address', enabled: previewConfig.showAddress, label: copy('address', 'Address'), value: previewConfig.businessAddress, href: normalizeExternalUrl(previewConfig.addressLink), icon: MapPin },
  ].filter((item) => item.enabled && item.value)
  const addressFact = businessFacts.find((item) => item.key === 'address')
  const draftMapEmbedUrl = normalizeGoogleMapsEmbed(editorDraft.customer_portal_google_maps_embed || '')
  const redeemSummaryText = replaceVars(
    copy('redeemSummary', 'Minimum {points} points per unit. Available now: {units} unit(s).'),
    {
      points: membershipData?.points?.minimumRedeemPoints ?? previewConfig.redeemPoints,
      units: membershipData?.points?.redeemableUnits ?? 0,
    }
  )
  const mobileGridColumns = Math.min(2, Math.max(1, Math.round(toNumber(previewConfig.gridColumnsMobile, 1))))
  const desktopGridColumns = Math.min(6, Math.max(2, Math.round(toNumber(previewConfig.gridColumnsDesktop, 4))))
  const compactTwoColumnMobile = mobileGridColumns === 2
  const productGridClass = desktopGridColumns === 2
    ? 'lg:grid-cols-2'
    : desktopGridColumns === 3
      ? 'lg:grid-cols-2 xl:grid-cols-3'
      : desktopGridColumns === 4
        ? 'lg:grid-cols-2 xl:grid-cols-4'
        : desktopGridColumns === 5
          ? 'lg:grid-cols-3 xl:grid-cols-5'
          : 'lg:grid-cols-3 xl:grid-cols-6'
  const compactCatalogCards = desktopGridColumns >= 5 || (desktopGridColumns >= 4 && mobileGridColumns >= 2)
  const portalActiveFilterCount = categoryFilter.length + brandFilter.length + branchFilter.length + stockFilter.length
  const selectedStockBranch = branchFilter.length === 1 ? branchFilter[0] : 'all'

  const catalogSection = (
    <SectionShell
      title={copy('products', 'Products')}
      subtitle={copy('liveCatalog', 'Live inventory, customer-safe details only.')}
    >
      <div className="mb-5 space-y-3">
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:flex-row sm:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              id="portal-product-search"
              name="product_search"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              placeholder={copy('searchPlaceholder', 'Search products, category, or brand')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                filtersOpen ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              onClick={() => setFiltersOpen((current) => !current)}
            >
              {copy('filters', 'Filters')}
              {portalActiveFilterCount > 0 ? (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{portalActiveFilterCount}</span>
              ) : null}
            </button>
            {portalActiveFilterCount > 0 ? (
              <button type="button" className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100" onClick={clearPortalFilters}>
                {copy('clear', 'Clear')}
              </button>
            ) : null}
          </div>
        </div>

        {filtersOpen ? (
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{copy('category', 'Category')}</div>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {categories.map((category) => (
                  <label key={category.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={categoryFilter.includes(category.name)} onChange={() => toggleFilterValue(categoryFilter, setCategoryFilter, category.name)} />
                    <span className="truncate">{category.name}</span>
                  </label>
                ))}
                {!categories.length ? <div className="text-xs text-slate-400">{copy('all', 'All')}</div> : null}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{copy('brand', 'Brand')}</div>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {brands.map((brand) => (
                  <label key={brand} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={brandFilter.includes(brand)} onChange={() => toggleFilterValue(brandFilter, setBrandFilter, brand)} />
                    <span className="truncate">{brand}</span>
                  </label>
                ))}
                {!brands.length ? <div className="text-xs text-slate-400">{copy('all', 'All')}</div> : null}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{copy('branch', 'Branch')}</div>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {branches.map((branch) => (
                  <label key={branch.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={branchFilter.includes(String(branch.id))} onChange={() => toggleFilterValue(branchFilter, setBranchFilter, String(branch.id))} />
                    <span className="truncate">{branch.name}</span>
                  </label>
                ))}
                {!branches.length ? <div className="text-xs text-slate-400">{copy('allBranches', 'All branches')}</div> : null}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{copy('stockStatus', 'Stock status')}</div>
              <div className="space-y-1">
                {[
                  ['in_stock', copy('inStock', 'In Stock')],
                  ['low_stock', copy('lowStock', 'Low Stock')],
                  ['out_of_stock', copy('outOfStock', 'Out of Stock')],
                ].map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={stockFilter.includes(value)} onChange={() => toggleFilterValue(stockFilter, setStockFilter, value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 px-1 text-xs text-slate-500">
          <span>{portalActiveFilterCount > 0 ? `${portalActiveFilterCount} ${copy('selected', 'selected')}` : copy('filterCompactHint', 'Use quick filters to narrow products faster.')}</span>
          <span className="font-semibold text-slate-600">
            {replaceVars(copy('filterSummary', '{count} result(s)'), { count: filteredProducts.length })}
          </span>
        </div>
      </div>

      {portalError ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {portalError}
        </div>
      ) : null}

      <div className={`grid gap-3 ${mobileGridColumns === 1 ? 'grid-cols-1' : 'grid-cols-2'} ${productGridClass}`}>
        {filteredProducts.map((product) => {
          const qty = getBranchQty(product, selectedStockBranch)
          const status = getStockStatus(product, qty, previewConfig)
          const gallery = normalizeProductGallery(product)
          const primaryImage = gallery[0] || ''
          return (
            <article key={product.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
              <div
                className={`relative ${compactTwoColumnMobile ? 'aspect-[5/4] sm:aspect-[4/3]' : 'aspect-[5/4]'} overflow-hidden bg-slate-100 ${gallery.length ? 'cursor-zoom-in' : ''}`}
                onClick={() => {
                  if (gallery.length) openProductGallery(product, 0)
                }}
              >
                {primaryImage ? (
                  <ProductImg src={primaryImage} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-300">
                    <ShoppingBag className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute left-4 top-4">
                  <StatusPill language={language} status={status} />
                </div>
                {gallery.length > 1 ? (
                  <button
                    type="button"
                    className="absolute bottom-3 right-3 rounded-full border border-white/20 bg-slate-900/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
                    onClick={(event) => {
                      event.stopPropagation()
                      openProductGallery(product, 0)
                    }}
                  >
                    {replaceVars(copy('imageCount', '{current}/{total}'), { current: 1, total: gallery.length })}
                  </button>
                ) : null}
              </div>

              <div className={`space-y-2.5 ${compactCatalogCards ? 'p-3.5' : 'p-4'}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {product.category ? <span className="rounded-full bg-slate-100 px-2.5 py-1">{product.category}</span> : null}
                  {product.brand ? <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-cyan-700">{product.brand}</span> : null}
                </div>
                <div className={`${compactCatalogCards ? 'text-sm' : 'text-base'} font-semibold text-slate-900`}>{product.name}</div>
                <p className={`${compactCatalogCards ? 'min-h-[2.9rem] text-[11px] leading-5' : 'min-h-[3.2rem] text-xs leading-5'} text-slate-600`}>
                  {product.description || copy('noDescription', 'No description available.')}
                </p>

                <div className={`flex items-center justify-between rounded-2xl bg-slate-50 ${compactCatalogCards ? 'px-3 py-2' : 'px-3.5 py-2.5'}`}>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('price', 'Price')}</div>
                    <div className={`mt-1 font-semibold text-slate-900 ${compactCatalogCards ? 'text-xs' : 'text-sm'}`}>
                      {previewConfig.showPrices
                        ? formatPortalPrice(product.selling_price_usd, product.selling_price_khr, previewConfig)
                        : copy('priceHidden', 'Price hidden')}
                    </div>
                  </div>
                  {!compactCatalogCards ? <span className="text-xs text-slate-500">{copy('readOnly', 'Read-only for customers')}</span> : null}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {filteredProducts.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          {copy('noProducts', 'No products matched the current filters.')}
        </div>
      ) : null}
    </SectionShell>
  )

  const membershipSection = (
    <SectionShell
      title={copy('membershipLookup', 'Membership lookup')}
      subtitle={copy('membershipLookupHint', 'Customers can view purchases, returns, and points. They cannot edit anything.')}
    >
      <div className="rounded-[28px] bg-slate-950 p-5 text-white shadow-lg">
        <div className="grid gap-4 lg:grid-cols-[1.6fr,auto]">
          <label htmlFor="portal-membership-number" className="block">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('membership', 'Membership')}</div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <Ticket className="h-5 w-5 text-cyan-300" />
              <input
                id="portal-membership-number"
                name="membership_number"
                autoComplete="off"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
                placeholder={copy('membershipPlaceholder', 'Enter membership number')}
                value={membershipNumber}
                onChange={(event) => setMembershipNumber(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleMembershipLookup()
                }}
              />
            </div>
          </label>

          <button
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            onClick={handleMembershipLookup}
            disabled={membershipLoading}
          >
            <Search className="h-4 w-4" />
            {membershipLoading ? copy('checkingMembership', 'Checking membership...') : copy('lookup', 'Check membership')}
          </button>
        </div>

        {membershipError ? (
          <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {membershipError}
          </div>
        ) : null}
      </div>

      {membershipData ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1.2fr,1fr]">
            <SectionShell
              title={copy('customer', 'Customer')}
              subtitle={membershipData.customer?.name || ''}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('membership', 'Membership')}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{membershipData.customer?.membership_number || '-'}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('memberSince', 'Member since')}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(membershipData.customer?.created_at)}</div>
                </div>
                {membershipData.customer?.phone ? (
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('phone', 'Phone')}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{membershipData.customer.phone}</div>
                  </div>
                ) : null}
                {membershipData.customer?.email ? (
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('email', 'Email')}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{membershipData.customer.email}</div>
                  </div>
                ) : null}
                {membershipData.customer?.company ? (
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('company', 'Company')}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{membershipData.customer.company}</div>
                  </div>
                ) : null}
                {membershipData.customer?.notes ? (
                  <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('note', 'Note')}</div>
                    <div className="mt-2 text-sm text-slate-700">{membershipData.customer.notes}</div>
                  </div>
                ) : null}
              </div>
            </SectionShell>

            <div className="grid gap-4 sm:grid-cols-2">
              <SummaryTile
                icon={Sparkles}
                label={copy('pointsBalance', 'Point balance')}
                value={(membershipData.points?.balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                tone="blue"
              />
              {previewConfig.showPointValue ? (
                <SummaryTile
                  icon={BadgeDollarSign}
                  label={copy('pointsValue', 'Point value')}
                  value={formatPortalPrice(membershipData.points?.redeemValueUsd, membershipData.points?.redeemValueKhr, previewConfig)}
                  tone="green"
                />
              ) : null}
              <SummaryTile
                icon={Store}
                label={copy('totalSales', 'Sales total')}
                value={formatPortalPrice(membershipData.totals?.totalSalesUsd, membershipData.totals?.totalSalesKhr, previewConfig)}
                tone="dark"
              />
              <SummaryTile
                icon={RotateCcw}
                label={copy('totalReturns', 'Returns total')}
                value={formatPortalPrice(membershipData.totals?.totalReturnsUsd, membershipData.totals?.totalReturnsKhr, previewConfig)}
                tone="amber"
              />
              <SummaryTile
                icon={Store}
                label={copy('membershipDiscountTotal', 'Membership discounts used')}
                value={formatPortalPrice(membershipData.totals?.membershipDiscountUsd, membershipData.totals?.membershipDiscountKhr, previewConfig)}
                tone="dark"
              />
              <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 sm:col-span-2">
                <div className="font-semibold">{copy('redeemRule', 'Points can be used in whole units only. Ask staff to apply them during checkout.')}</div>
                <div className="mt-2 text-emerald-800">{redeemSummaryText}</div>
                {previewConfig.membershipInfoText ? (
                  <div className="mt-2 text-emerald-800">{previewConfig.membershipInfoText}</div>
                ) : null}
                <div className="mt-2 text-emerald-800">{copy('staffAppliedOnly', 'Points are reviewed and applied by staff only. Customers cannot redeem them directly here.')}</div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-emerald-800">
                  <span>{copy('pointsEarned', 'Points earned')}: {(membershipData.points?.earned || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  <span>{copy('pointsRedeemed', 'Points redeemed')}: {(membershipData.points?.redeemed || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  <span>{copy('pointsRewarded', 'Reward points')}: {(membershipData.points?.rewarded || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <SectionShell title={copy('purchaseHistory', 'Purchase history')} subtitle={copy('readOnly', 'Read-only for customers')}>
              <div className="space-y-3">
                {membershipData.sales?.length ? membershipData.sales.map((sale) => (
                  <article key={sale.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{sale.receipt_number || `#${sale.id}`}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(sale.created_at)}
                          {sale.branch_name ? ` • ${sale.branch_name}` : ''}
                        </div>
                      </div>
                      <StatusPill
                        language={language}
                        status={sale.sale_status === 'returned' ? 'out_of_stock' : sale.sale_status === 'partial_return' ? 'low_stock' : 'in_stock'}
                      />
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr,auto]">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('items', 'Items')}</div>
                        <div className="mt-1 text-sm text-slate-700">{sale.items_summary || '-'}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('price', 'Price')}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{formatPortalPrice(sale.total_usd, sale.total_khr, previewConfig)}</div>
                      </div>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    {copy('noSales', 'No sales found for this membership yet.')}
                  </div>
                )}
              </div>
            </SectionShell>

            <SectionShell title={copy('returnHistory', 'Return history')} subtitle={copy('readOnly', 'Read-only for customers')}>
              <div className="space-y-3">
                {membershipData.returns?.length ? membershipData.returns.map((entry) => (
                  <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{entry.return_number || `#${entry.id}`}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(entry.created_at)}
                          {entry.branch_name ? ` • ${entry.branch_name}` : ''}
                        </div>
                      </div>
                      <StatusPill language={language} status={entry.status === 'cancelled' ? 'out_of_stock' : 'low_stock'} />
                    </div>
                    <div className="mt-3 grid gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('items', 'Items')}</div>
                        <div className="mt-1 text-sm text-slate-700">{entry.items_summary || '-'}</div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('reason', 'Reason')}</div>
                          <div className="mt-1 text-sm text-slate-700">{entry.reason || '-'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('refund', 'Refund')}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{formatPortalPrice(entry.total_refund_usd, entry.total_refund_khr, previewConfig)}</div>
                        </div>
                      </div>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    {copy('noReturns', 'No returns found for this membership yet.')}
                  </div>
                )}
              </div>
            </SectionShell>
          </div>

          <SectionShell title={copy('shareProofs', 'Share & reward')} subtitle={copy('shareProofsHint', 'Customers can submit screenshots showing they shared the business. Staff reviews and awards points inside Business OS.')}>
            <div className="grid gap-5 xl:grid-cols-[1.2fr,1fr]">
              <div className="space-y-4">
                {previewConfig.submissionInstructions ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <div className="font-semibold text-slate-900">{copy('submissionInstructions', 'Submission instructions')}</div>
                    <div className="mt-1">{previewConfig.submissionInstructions}</div>
                  </div>
                ) : null}
                {!previewConfig.submissionEnabled ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {copy('submissionDisabled', 'Share submissions are currently disabled.')}
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="portal-share-platform" className="block text-sm font-medium text-slate-700">{copy('sharePlatform', 'Platform')}</label>
                    <input id="portal-share-platform" name="share_platform" autoComplete="off" className="input" disabled={!previewConfig.submissionEnabled} value={submissionDraft.platform} placeholder={copy('sharePlatformPlaceholder', 'Facebook post, Instagram story, Telegram status...')} onChange={(event) => setSubmissionDraft((current) => ({ ...current, platform: event.target.value }))} />
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('shareStatus', 'Status')}</div>
                    <div className="mt-2 font-medium text-slate-900">{copy('pending', 'Pending')}</div>
                  </div>
                </div>
                <div>
                  <label htmlFor="portal-share-note" className="block text-sm font-medium text-slate-700">{copy('shareNote', 'Customer note')}</label>
                  <textarea
                    id="portal-share-note"
                    name="share_note"
                    autoComplete="off"
                    className="input min-h-[120px] resize-none"
                    rows={5}
                    value={submissionDraft.note}
                    disabled={!previewConfig.submissionEnabled}
                    placeholder={copy('sharePaste', 'Paste screenshots here or upload below')}
                    onChange={(event) => setSubmissionDraft((current) => ({ ...current, note: event.target.value }))}
                    onPaste={handleSubmissionPaste}
                  />
                </div>
                <div className="flex flex-wrap gap-2 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
                  <button type="button" className="btn-secondary text-sm" disabled={!previewConfig.submissionEnabled} onClick={() => pickMultipleImagesAsDataUrls().then(addSubmissionImages).catch((error) => notify(error?.message || 'Image upload failed', 'error'))}>
                    <Upload className="mr-2 inline h-4 w-4" />
                    {copy('shareUpload', 'Upload screenshots')}
                  </button>
                  <button type="button" className="btn-primary text-sm" disabled={submissionSaving || !previewConfig.submissionEnabled} onClick={handleSubmitShareProof}>
                    {submissionSaving ? copy('shareSubmitting', 'Submitting...') : copy('shareSubmit', 'Submit for review')}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {submissionDraft.screenshots.map((image, index) => (
                    <div key={`${image.slice(0, 24)}-${index}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      <button
                        type="button"
                        className="block w-full"
                        onClick={() => openPortalImage(copy('shareProofs', 'Share & reward'), submissionDraft.screenshots, index)}
                      >
                      <img src={image} alt={`submission-${index + 1}`} className="h-36 w-full object-cover" />
                      </button>
                      <button
                        type="button"
                        className="w-full border-t border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-white"
                        onClick={() => setSubmissionDraft((current) => ({ ...current, screenshots: current.screenshots.filter((_, imageIndex) => imageIndex !== index) }))}
                      >
                        {copy('clearImage', 'Clear')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {(membershipData?.submissions?.length || 0) ? membershipData.submissions.map((submission) => (
                  <article key={submission.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{submission.platform || copy('shareProofs', 'Share & reward')}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDateTime(submission.created_at)}</div>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                        {submission.status === 'approved'
                          ? copy('shareApproved', 'Approved')
                          : submission.status === 'rejected'
                            ? copy('shareRejected', 'Rejected')
                            : copy('sharePending', 'Pending review')}
                      </div>
                    </div>
                    {submission.note ? <p className="mt-3 text-sm text-slate-700">{submission.note}</p> : null}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(submission.screenshots || []).map((image, index) => (
                        <button
                          key={`${submission.id}-${index}`}
                          type="button"
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                          onClick={() => openPortalImage(submission.platform || copy('shareProofs', 'Share & reward'), submission.screenshots || [], index)}
                        >
                          <img src={image} alt={`submission-${submission.id}-${index + 1}`} className="h-28 w-full object-cover" />
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
                      <span>{copy('shareReward', 'Reward')}: {(submission.reward_points || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} pts</span>
                      {submission.review_note ? <span>{copy('shareReviewNote', 'Review note')}: {submission.review_note}</span> : null}
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    {copy('noSubmissions', 'No share submissions yet.')}
                  </div>
                )}
              </div>
            </div>
          </SectionShell>
        </div>
      ) : null}
    </SectionShell>
  )

  const aboutSection = (
    <SectionShell
      title={previewConfig.aboutTitle || copy('about', 'About')}
      subtitle={copy('portalAboutFallback', 'Add your business story in the editor so customers can quickly learn about your brand.')}
    >
      <div className="space-y-4">
        {previewConfig.aboutContent ? (
          <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6">
            <p className="whitespace-pre-line text-sm leading-7 text-slate-700">{previewConfig.aboutContent}</p>
          </div>
        ) : null}
        {previewConfig.aboutBlocks?.length ? previewConfig.aboutBlocks.map((block) => (
          <div key={block.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            {block.mediaUrl ? (
              <button
                type="button"
                className="flex w-full items-center justify-center bg-slate-50 p-4"
                onClick={() => openPortalImage(block.title || previewConfig.aboutTitle || copy('about', 'About'), [block.mediaUrl])}
              >
                {block.type === 'video' ? (
                  <video src={block.mediaUrl} controls preload="metadata" className="max-h-[340px] w-full rounded-2xl bg-white object-contain" />
                ) : (
                  <img src={block.mediaUrl} alt={block.title || previewConfig.aboutTitle || copy('about', 'About')} className="max-h-[340px] w-full rounded-2xl object-contain" />
                )}
              </button>
            ) : null}
            <div className="space-y-3 p-6">
              {block.title ? <h3 className="text-lg font-semibold text-slate-900">{block.title}</h3> : null}
              {block.body ? <p className="whitespace-pre-line text-sm leading-7 text-slate-700">{block.body}</p> : null}
            </div>
          </div>
        )) : null}
        {mapEmbedUrl ? (
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                <MapPin className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-900">{copy('mapCard', 'Store map')}</div>
                {addressFact?.value ? <div className="text-xs text-slate-500">{addressFact.value}</div> : null}
              </div>
            </div>
            <iframe
              title="portal-about-map"
              src={mapEmbedUrl}
              className="h-64 w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : null}
        {!previewConfig.aboutContent && !previewConfig.aboutBlocks?.length && !mapEmbedUrl ? (
          <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6">
            <p className="text-sm text-slate-500">{copy('portalAboutFallback', 'Add your business story in the editor so customers can quickly learn about your brand.')}</p>
          </div>
        ) : null}
      </div>
    </SectionShell>
  )

  const publicFaqItems = Array.isArray(previewConfig.faqItems) ? previewConfig.faqItems.filter((item) => item?.question && item?.answer) : []
  const faqSection = (
    <SectionShell
      title={previewConfig.faqTitle || copy('faq', 'FAQ')}
      subtitle={copy('faqHint', 'Add your most common customer questions here. Customers can open each answer one by one.')}
    >
      <div className="space-y-3">
        {publicFaqItems.length ? publicFaqItems.map((item, index) => {
          const open = expandedFaqId === item.id
          return (
            <article key={item.id || index} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                onClick={() => setExpandedFaqId((current) => current === item.id ? null : item.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                    <HelpCircle className="h-4 w-4" />
                  </span>
                  <div className="text-sm font-semibold text-slate-900">{item.question}</div>
                </div>
                <span className="rounded-full bg-slate-100 p-2 text-slate-500">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
              </button>
              {open ? <div className="border-t border-slate-100 px-5 py-4 text-sm leading-7 text-slate-600">{item.answer}</div> : null}
            </article>
          )
        }) : (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            {copy('faqHint', 'Add your most common customer questions here. Customers can open each answer one by one.')}
          </div>
        )}
      </div>
    </SectionShell>
  )

  const aiUsageSummary = assistantUsage || null
  const questionCharLimit = Math.max(280, Math.min(1500, Number(assistantRequestPolicy?.questionMaxChars || 700) || 700))
  const aiSection = (
    <SectionShell
      title={previewConfig.aiTitle || copy('portalAssistant', 'AI assistant')}
      subtitle={previewConfig.aiIntro || copy('assistantNotice', 'AI generated, for reference only.')}
      action={(
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
          <Bot className="h-3.5 w-3.5" />
          AI query
        </span>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantBrand', 'Preferred brand')}</label>
                <select className="input mt-1" value={assistantProfile.brand} onChange={(event) => setAssistantProfile((current) => ({ ...current, brand: event.target.value }))}>
                  <option value="">{copy('all', 'All')}</option>
                  {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantSkinType', 'Skin type')}</label>
                <select className="input mt-1" value={assistantProfile.skinType} onChange={(event) => setAssistantProfile((current) => ({ ...current, skinType: event.target.value }))}>
                  <option value="">{copy('all', 'All')}</option>
                  {['Dry', 'Oily', 'Combination', 'Sensitive', 'Normal', 'Acne-prone'].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantShoppingFor', 'Shopping for')}</label>
                <select className="input mt-1" value={assistantProfile.shoppingFor} onChange={(event) => setAssistantProfile((current) => ({ ...current, shoppingFor: event.target.value }))}>
                  <option value="">{copy('all', 'All')}</option>
                  {assistantCategoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantGoal', 'Goal / use case')}</label>
                <input className="input mt-1" maxLength={180} value={assistantProfile.goal} onChange={(event) => setAssistantProfile((current) => ({ ...current, goal: event.target.value }))} placeholder="Daily use, brightening, long wear..." />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-sm font-medium text-slate-700">{copy('assistantConcerns', 'Skin concerns')}</label>
              <input className="input mt-1" maxLength={220} value={assistantProfile.concerns} onChange={(event) => setAssistantProfile((current) => ({ ...current, concerns: event.target.value }))} placeholder="Acne, sensitivity, dark spots, dryness..." />
            </div>

            <div className="mt-3">
              <label className="block text-sm font-medium text-slate-700">{copy('assistantQuestion', 'What would you like help finding?')}</label>
              <textarea className="input mt-1 resize-none" rows={5} maxLength={questionCharLimit} value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} placeholder={copy('assistantQuestionPlaceholder', 'Example: I have oily acne-prone skin and want a gentle daily sunscreen.')} />
              <div className="mt-1 text-right text-xs text-slate-500">{assistantQuestion.length}/{questionCharLimit}</div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-sm" onClick={askAssistant} disabled={assistantLoading}>
                <Send className="mr-2 inline h-4 w-4" />
                {assistantLoading ? copy('assistantLoading', 'Thinking...') : copy('askAssistant', 'Ask AI assistant')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={clearAssistantState}>
                <RotateCcw className="mr-2 inline h-4 w-4" />
                {copy('assistantReset', 'Clear')}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
              {replaceVars(copy('assistantUsageCompact', '{users} user(s) are using this right now. Each visitor can send {searches} search(es) per minute.'), {
                users: aiUsageSummary?.activeVisitors || 1,
                searches: assistantRequestPolicy?.perUserPerMinute || aiUsageSummary?.perUserPerMinute || 1,
              })}
            </div>

            <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-4 py-4 text-xs leading-6 text-amber-900">
              {previewConfig.aiDisclaimer || copy('assistantNotice', 'AI generated, for reference only.')}
            </div>
          </div>
        </div>

        {assistantError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{assistantError}</div> : null}

        {assistantResponse?.summary ? (
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('assistantResults', 'Suggested matches')}</div>
            <p className="mt-2 text-sm leading-7 text-slate-700">{assistantResponse.summary}</p>
            {assistantResponse.followUpQuestions?.length ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('assistantFollowUps', 'Helpful follow-up questions')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {assistantResponse.followUpQuestions.map((question) => (
                    <button key={question} type="button" className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm" onClick={() => setAssistantQuestion(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {assistantResponse?.recommendations?.length ? (
          <div className="space-y-3">
            {assistantResponse.recommendations.map((item) => {
              const open = assistantExpandedProductId === item.product_id
              return (
                <article key={item.product_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <button type="button" className="flex w-full items-start gap-3 px-4 py-4 text-left" onClick={() => setAssistantExpandedProductId((current) => current === item.product_id ? null : item.product_id)}>
                    {item.image_path ? (
                      <img src={item.image_path} alt={item.name} className="h-16 w-16 rounded-2xl object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{item.name}</div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{item.brand || 'No brand'}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{item.category || 'No category'} | {previewConfig.priceDisplay === 'KHR' ? `${item.selling_price_khr || 0} KHR` : `$${Number(item.selling_price_usd || 0).toFixed(2)}`}</div>
                      {item.reason ? <div className="mt-2 text-sm text-slate-600">{item.reason}</div> : null}
                    </div>
                    <span className="rounded-full bg-slate-100 p-2 text-slate-500">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                  </button>
                  {open ? (
                    <div className="border-t border-slate-100 px-4 py-4 text-sm text-slate-700">
                      {item.fit_summary ? <div><span className="font-semibold text-slate-900">{copy('assistantWhy', 'Why this match')}:</span> {item.fit_summary}</div> : null}
                      {item.how_to_use ? <div className="mt-2"><span className="font-semibold text-slate-900">{copy('assistantUse', 'How to use')}:</span> {item.how_to_use}</div> : null}
                      {item.cautions ? <div className="mt-2"><span className="font-semibold text-slate-900">{copy('assistantCaution', 'Caution')}:</span> {item.cautions}</div> : null}
                      {item.ingredients_focus?.length ? <div className="mt-2"><span className="font-semibold text-slate-900">{copy('assistantIngredients', 'Ingredients focus')}:</span> {item.ingredients_focus.join(', ')}</div> : null}
                      {item.online_review_summary ? <div className="mt-2"><span className="font-semibold text-slate-900">{copy('assistantReviews', 'Online review summary')}:</span> {item.online_review_summary}</div> : null}
                      {item.citations?.length ? (
                        <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('assistantEvidence', 'Online references')}</div>
                          <div className="mt-2 space-y-2">
                            {item.citations.map((citation, index) => (
                              <div key={`${item.product_id}-${index}`} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                                <div className="font-medium text-slate-900">{citation.title || citation.source || citation.url}</div>
                                {citation.note ? <div className="mt-1">{citation.note}</div> : null}
                                {citation.url ? <a href={citation.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sky-600 hover:underline"><ExternalLink className="h-3 w-3" />{citation.source || 'Open source'}</a> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : null}
      </div>
    </SectionShell>
  )

  const editorSections = [
    ['portal-section-branding', 'branding', copy('businessInfo', 'Business details')],
    ['portal-section-display', 'display', copy('display', 'Display settings')],
    ['portal-section-theme', 'about', copy('about', 'About')],
    ['portal-section-assistant', 'assistant', copy('portalAssistant', 'AI assistant')],
    ['portal-section-publish', 'publish', copy('portalPublishing', 'Publishing')],
    ['portal-section-submissions', 'submissions', copy('portalSubmissionSettings', 'Submission settings')],
  ]

  const editorPanel = canEdit ? (
    <aside id="portal-editor-top" className="space-y-5">
      <div className="sticky top-0 z-30 -mx-4 rounded-none border-y border-slate-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur sm:top-2 sm:mx-0 sm:rounded-2xl sm:border">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
            {editorSections.map(([sectionId, sectionKey, label]) => (
              <button
                key={sectionId}
                type="button"
                className={`whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold transition ${
                  activeEditorSection === sectionKey
                    ? 'bg-slate-950 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                onClick={() => setActiveEditorSection(sectionKey)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 lg:flex lg:justify-end">
            <button
              type="button"
              className="btn-secondary min-w-0 text-xs sm:text-sm"
              onClick={() => previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <Eye className="mr-1 inline h-4 w-4" />
              {copy('jumpToPreview', 'Jump to preview')}
            </button>
            <button className="btn-primary min-w-0 text-xs sm:text-sm" disabled={editorSaving || !editorDirty} onClick={savePortalDraft}>
              <Save className="mr-1 inline h-4 w-4" />
              {copy('saveChanges', 'Save changes')}
            </button>
          </div>
        </div>
      </div>
      <SectionShell
        title={copy('studioTitle', 'Portal Editor')}
        subtitle={copy('studioHint', 'Edit the customer-facing portal here. The public page remains read-only.')}
      >
        <div className="space-y-5">
          <div id="portal-section-display" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'display' ? '' : 'hidden'}`}>
            <div className="mb-2 text-sm font-semibold text-slate-900">{copy('display', 'Display settings')}</div>
            <div className="grid gap-3">
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showCatalog', 'Show product catalog')}</span>
                <input id="portal-show-catalog" name="customer_portal_show_catalog" type="checkbox" checked={!!editorDraft.customer_portal_show_catalog} onChange={(event) => setDraft('customer_portal_show_catalog', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showMembership', 'Show membership lookup')}</span>
                <input id="portal-show-membership" name="customer_portal_show_membership" type="checkbox" checked={!!editorDraft.customer_portal_show_membership} onChange={(event) => setDraft('customer_portal_show_membership', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showAbout', 'Show about section')}</span>
                <input id="portal-show-about" name="customer_portal_show_about" type="checkbox" checked={!!editorDraft.customer_portal_show_about} onChange={(event) => setDraft('customer_portal_show_about', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showPrices', 'Show selling prices')}</span>
                <input id="portal-show-prices" name="customer_portal_show_prices" type="checkbox" checked={!!editorDraft.customer_portal_show_prices} onChange={(event) => setDraft('customer_portal_show_prices', event.target.checked)} />
              </label>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-price-display" className="block text-sm font-medium text-slate-700">{copy('priceDisplay', 'Price display')}</label>
                <select id="portal-price-display" name="customer_portal_price_display" className="input" value={editorDraft.customer_portal_price_display || 'USD'} onChange={(event) => setDraft('customer_portal_price_display', event.target.value)}>
                  <option value="USD">USD</option>
                  <option value="KHR">KHR</option>
                  <option value="BOTH">Both</option>
                </select>
              </div>
              <div>
                <label htmlFor="portal-refresh-seconds" className="block text-sm font-medium text-slate-700">{copy('refreshSeconds', 'Public refresh interval (seconds)')}</label>
                <input id="portal-refresh-seconds" name="customer_portal_refresh_seconds" className="input" type="number" min="5" max="120" step="1" value={editorDraft.customer_portal_refresh_seconds || '20'} onChange={(event) => setDraft('customer_portal_refresh_seconds', event.target.value)} />
              </div>
              <div>
                <label htmlFor="portal-grid-mobile" className="block text-sm font-medium text-slate-700">{copy('gridColumnsMobile', 'Mobile grid columns')}</label>
                <input
                  id="portal-grid-mobile"
                  name="customer_portal_grid_columns_mobile"
                  className="input"
                  type="number"
                  min="1"
                  max="2"
                  step="1"
                  value={editorDraft.customer_portal_grid_columns_mobile || '1'}
                  onChange={(event) => setDraft('customer_portal_grid_columns_mobile', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="portal-grid-desktop" className="block text-sm font-medium text-slate-700">{copy('gridColumnsDesktop', 'Desktop grid columns')}</label>
                <input
                  id="portal-grid-desktop"
                  name="customer_portal_grid_columns_desktop"
                  className="input"
                  type="number"
                  min="2"
                  max="6"
                  step="1"
                  value={editorDraft.customer_portal_grid_columns_desktop || '4'}
                  onChange={(event) => setDraft('customer_portal_grid_columns_desktop', event.target.value)}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">{copy('syncSpeedHint', 'Lower values refresh faster but create more requests. Internal preview still reacts to sync events immediately.')}</p>
          </div>

          <div id="portal-section-theme" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'about' ? '' : 'hidden'}`}>
            <div className="mb-2 text-sm font-semibold text-slate-900">{copy('portalTheme', 'Portal theme')}</div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="portal-hero-gradient-start" className="block text-sm font-medium text-slate-700">{copy('heroGradientStart', 'Header color 1')}</label>
                <input
                  id="portal-hero-gradient-start"
                  name="customer_portal_hero_gradient_start"
                  className="input h-11"
                  type="color"
                  value={normalizeHexColor(editorDraft.customer_portal_hero_gradient_start, '#0f172a')}
                  onChange={(event) => setDraft('customer_portal_hero_gradient_start', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="portal-hero-gradient-mid" className="block text-sm font-medium text-slate-700">{copy('heroGradientMid', 'Header color 2')}</label>
                <input
                  id="portal-hero-gradient-mid"
                  name="customer_portal_hero_gradient_mid"
                  className="input h-11"
                  type="color"
                  value={normalizeHexColor(editorDraft.customer_portal_hero_gradient_mid, '#14532d')}
                  onChange={(event) => setDraft('customer_portal_hero_gradient_mid', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="portal-hero-gradient-end" className="block text-sm font-medium text-slate-700">{copy('heroGradientEnd', 'Header color 3')}</label>
                <input
                  id="portal-hero-gradient-end"
                  name="customer_portal_hero_gradient_end"
                  className="input h-11"
                  type="color"
                  value={normalizeHexColor(editorDraft.customer_portal_hero_gradient_end, '#ea580c')}
                  onChange={(event) => setDraft('customer_portal_hero_gradient_end', event.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="portal-about-title" className="block text-sm font-medium text-slate-700">{copy('aboutTitle', 'About title')}</label>
              <input
                id="portal-about-title"
                name="customer_portal_about_title"
                className="input"
                value={editorDraft.customer_portal_about_title || ''}
                onChange={(event) => setDraft('customer_portal_about_title', event.target.value)}
              />
            </div>
            <div className="mt-4">
              <label htmlFor="portal-about-content" className="block text-sm font-medium text-slate-700">{copy('aboutContent', 'About content')}</label>
              <textarea
                id="portal-about-content"
                name="customer_portal_about_content"
                className="input resize-none"
                rows={4}
                value={editorDraft.customer_portal_about_content || ''}
                onChange={(event) => setDraft('customer_portal_about_content', event.target.value)}
              />
              <p className="mt-2 text-xs text-slate-500">{copy('aboutContentHint', 'Tell customers about your story, hours, policies, or services.')}</p>
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">About blocks</div>
                  <p className="mt-1 text-xs text-slate-500">Add text, image, and video sections, then move them into the order you want customers to see.</p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                  <button type="button" className="btn-secondary text-sm" onClick={() => addAboutBlock('text')}>Add text</button>
                  <button type="button" className="btn-secondary text-sm" onClick={() => addAboutBlock('image')}>Add image</button>
                  <button type="button" className="btn-secondary text-sm" onClick={() => addAboutBlock('video')}>Add video</button>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                {aboutBlocks.length ? aboutBlocks.map((block, index) => (
                  <article
                    key={block.id}
                    draggable
                    onDragStart={() => setDragAboutBlockId(block.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      moveAboutBlockBefore(dragAboutBlockId, block.id)
                      setDragAboutBlockId(null)
                    }}
                    onDragEnd={() => setDragAboutBlockId(null)}
                    className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${dragAboutBlockId === block.id ? 'opacity-60' : ''}`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-900">
                        <button type="button" className="cursor-grab rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500" title="Drag to reorder">
                          ::
                        </button>
                        <span>
                          {getAboutBlockLabel(block.type)} #{index + 1}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => removeAboutBlock(block.id)}>Remove</button>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
                      <div className="space-y-4">
                        <div>
                          <label htmlFor={`portal-about-block-title-${block.id}`} className="block text-sm font-medium text-slate-700">Section title</label>
                          <input id={`portal-about-block-title-${block.id}`} className="input" value={block.title} onChange={(event) => updateAboutBlock(block.id, 'title', event.target.value)} />
                        </div>
                        <div>
                          <label htmlFor={`portal-about-block-body-${block.id}`} className="block text-sm font-medium text-slate-700">{block.type === 'text' ? 'Text content' : 'Caption / description'}</label>
                          <textarea id={`portal-about-block-body-${block.id}`} className="input resize-none" rows={block.type === 'text' ? 5 : 3} value={block.body} onChange={(event) => updateAboutBlock(block.id, 'body', event.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label htmlFor={`portal-about-block-media-${block.id}`} className="block text-sm font-medium text-slate-700">{block.type === 'video' ? 'Video URL' : 'Image URL'}</label>
                        <input id={`portal-about-block-media-${block.id}`} className="input" value={block.mediaUrl} placeholder={block.type === 'video' ? 'https://...' : 'https://... or upload below'} onChange={(event) => updateAboutBlock(block.id, 'mediaUrl', event.target.value)} />
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="btn-secondary text-sm" onClick={() => uploadAboutBlockMedia(block.id)}>
                            <Upload className="mr-2 inline h-4 w-4" />
                            {block.type === 'video' ? copy('uploadVideo', 'Upload video') : copy('uploadImage', 'Upload image')}
                          </button>
                          <button type="button" className="btn-secondary text-sm" onClick={() => openFilePicker(`about:${block.id}`, block.type === 'video' ? 'video' : 'image', block.title || copy('about', 'About'))}>
                            {copy('openFiles', 'Files')}
                          </button>
                          {block.mediaUrl && block.type !== 'video' ? (
                            <button type="button" className="btn-secondary text-sm" onClick={() => openPortalImage(block.title || copy('about', 'About'), [block.mediaUrl])}>
                              <Eye className="mr-2 inline h-4 w-4" />
                              {copy('openGallery', 'Open image gallery')}
                            </button>
                          ) : null}
                        </div>
                        {block.mediaUrl ? (
                          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3">
                            {block.type === 'video' ? (
                              <video src={block.mediaUrl} controls preload="metadata" className="max-h-56 w-full rounded-2xl bg-white object-contain" />
                            ) : (
                              <button type="button" className="flex w-full items-center justify-center rounded-2xl bg-slate-50 p-3" onClick={() => openPortalImage(block.title || copy('about', 'About'), [block.mediaUrl])}>
                                <img src={block.mediaUrl} alt={block.title || copy('about', 'About')} className="max-h-56 max-w-full object-contain" />
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    Add your first About block to build a richer page with reorderable text, images, and video.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div id="portal-section-assistant" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'assistant' ? '' : 'hidden'}`}>
            <div className="space-y-5">
              <div>
                <div className="text-sm font-semibold text-slate-900">{copy('portalAssistantSettings', 'AI assistant settings')}</div>
                <p className="mt-2 text-sm text-slate-600">{copy('portalAssistantHint', 'This customer-facing AI page suggests products from your live catalog and can include online references when the selected provider supports them.')}</p>
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('assistantEnabled', 'Enable AI assistant')}</span>
                <input type="checkbox" checked={!!editorDraft.customer_portal_ai_enabled} onChange={(event) => setDraft('customer_portal_ai_enabled', event.target.checked)} />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700">{copy('assistantTitle', 'Assistant title')}</label>
                  <input className="input mt-1" value={editorDraft.customer_portal_ai_title || ''} onChange={(event) => setDraft('customer_portal_ai_title', event.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">{copy('assistantProvider', 'AI provider entry')}</label>
                  <select className="input mt-1" value={editorDraft.customer_portal_ai_provider_id || ''} onChange={(event) => setDraft('customer_portal_ai_provider_id', event.target.value)}>
                    <option value="">{copy('assistantProviderAuto', 'Automatic (best available)')}</option>
                    {aiProviders.map((provider) => (
                      <option key={provider.id} value={String(provider.id)}>
                        {provider.name} | {provider.provider_label || provider.provider} | {provider.default_model || 'No model'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantIntro', 'Assistant intro')}</label>
                <textarea className="input mt-1 resize-none" rows={3} value={editorDraft.customer_portal_ai_intro || ''} onChange={(event) => setDraft('customer_portal_ai_intro', event.target.value)} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantDisclaimer', 'Assistant disclaimer')}</label>
                <textarea className="input mt-1 resize-none" rows={3} value={editorDraft.customer_portal_ai_disclaimer || ''} onChange={(event) => setDraft('customer_portal_ai_disclaimer', event.target.value)} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantPrompt', 'Extra prompt instructions')}</label>
                <textarea className="input mt-1 resize-none" rows={4} value={editorDraft.customer_portal_ai_prompt || ''} onChange={(event) => setDraft('customer_portal_ai_prompt', event.target.value)} />
                <p className="mt-2 text-xs text-slate-500">{copy('assistantPromptHint', 'Optional store-specific rules, such as tone or what categories to prioritize.')}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{copy('faqSettings', 'FAQ settings')}</div>
                    <p className="mt-1 text-xs text-slate-500">{copy('faqHint', 'Add your most common customer questions here. Customers can open each answer one by one.')}</p>
                  </div>
                  <button type="button" className="btn-secondary text-sm" onClick={addFaqItem}>{copy('addFaq', 'Add FAQ')}</button>
                </div>
                <div className="mt-4 grid gap-4">
                  <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-sm font-medium text-slate-700">{copy('faqEnabled', 'Show FAQ section')}</span>
                    <input type="checkbox" checked={!!editorDraft.customer_portal_show_faq} onChange={(event) => setDraft('customer_portal_show_faq', event.target.checked)} />
                  </label>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">{copy('faqTitle', 'FAQ title')}</label>
                    <input className="input mt-1" value={editorDraft.customer_portal_faq_title || ''} onChange={(event) => setDraft('customer_portal_faq_title', event.target.value)} />
                  </div>
                  <div className="space-y-3">
                    {faqItems.length ? faqItems.map((item, index) => (
                      <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{copy('faq', 'FAQ')} #{index + 1}</div>
                          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => removeFaqItem(item.id)}>Remove</button>
                        </div>
                        <div className="mt-3 grid gap-3">
                          <div>
                            <label className="block text-sm font-medium text-slate-700">{copy('faqQuestion', 'Question')}</label>
                            <input className="input mt-1" value={item.question} onChange={(event) => updateFaqItem(item.id, 'question', event.target.value)} />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700">{copy('faqAnswer', 'Answer')}</label>
                            <textarea className="input mt-1 resize-none" rows={3} value={item.answer} onChange={(event) => updateFaqItem(item.id, 'answer', event.target.value)} />
                          </div>
                        </div>
                      </article>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                        {copy('faqHint', 'Add your most common customer questions here. Customers can open each answer one by one.')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div id="portal-section-publish" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'publish' ? '' : 'hidden'}`}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ExternalLink className="h-4 w-4" />
              {copy('customerUrl', 'Customer URL')}
            </div>
            <div className="break-all rounded-xl bg-white px-3 py-2 text-sm text-slate-700">{generatedPublicUrl}</div>
            <p className="mt-2 text-xs text-slate-500">{copy('customerUrlHint', 'Set a custom public path here, then publish that path through a separate customer-facing Funnel so the customer link is harder to guess from the admin side.')}</p>
            <div className="mt-3">
              <label htmlFor="portal-public-path" className="block text-sm font-medium text-slate-700">{copy('publicPathInput', 'Custom public path')}</label>
              <input
                id="portal-public-path"
                name="customer_portal_path"
                className="input mt-1"
                value={editorDraft.customer_portal_path || ''}
                placeholder={copy('publicPathPlaceholder', '/your-customer-link')}
                onChange={(event) => setDraft('customer_portal_path', event.target.value)}
              />
            </div>
            <div className="mt-3">
              <label htmlFor="portal-public-url" className="block text-sm font-medium text-slate-700">{copy('publicUrlLabel', 'Public customer URL')}</label>
              <input
                id="portal-public-url"
                name="customer_portal_public_url"
                className="input mt-1"
                value={editorDraft.customer_portal_public_url || ''}
                placeholder={copy('publicUrlPlaceholder', 'https://customers.example.com')}
                onChange={(event) => setDraft('customer_portal_public_url', event.target.value)}
              />
              <p className="mt-2 text-xs text-slate-500">{copy('publicUrlHint', 'Use a different public domain or Funnel URL here when you publish the customer portal outside the admin link.')}</p>
            </div>
            <label className="mt-3 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-700">{copy('translateWidget', 'Enable public translate widget')}</div>
                <div className="mt-1 text-xs text-slate-500">{copy('translateWidgetHint', 'Public customers can switch languages with Google Translate. Internal Business OS translation stays separate.')}</div>
              </div>
              <input id="portal-translate-widget-enabled" name="customer_portal_translate_widget_enabled" type="checkbox" checked={!!editorDraft.customer_portal_translate_widget_enabled} onChange={(event) => setDraft('customer_portal_translate_widget_enabled', event.target.checked)} />
            </label>
            <a className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:text-sky-800" href={publicPortalUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {copy('openEmbeddedPreview', 'Open public preview')}
            </a>
          </div>

          <div id="portal-section-branding" className={`grid gap-4 ${activeEditorSection === 'branding' || activeEditorSection === 'submissions' ? '' : 'hidden'}`}>
            <div className={activeEditorSection === 'branding' ? 'grid gap-4' : 'hidden'}>
            <div>
              <label htmlFor="portal-business-name" className="block text-sm font-medium text-slate-700">{copy('businessName', 'Business name')}</label>
              <input id="portal-business-name" name="business_name" autoComplete="organization" className="input" value={editorDraft.business_name || ''} onChange={(event) => setDraft('business_name', event.target.value)} />
            </div>
            <div>
              <label htmlFor="portal-business-tagline" className="block text-sm font-medium text-slate-700">{copy('businessTagline', 'Short tagline')}</label>
              <input id="portal-business-tagline" name="customer_portal_business_tagline" autoComplete="off" className="input" value={editorDraft.customer_portal_business_tagline || ''} onChange={(event) => setDraft('customer_portal_business_tagline', event.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-business-phone" className="block text-sm font-medium text-slate-700">{copy('phone', 'Phone')}</label>
                <input id="portal-business-phone" name="business_phone" autoComplete="tel" className="input" value={editorDraft.business_phone || ''} onChange={(event) => setDraft('business_phone', event.target.value)} />
              </div>
              <div>
                <label htmlFor="portal-business-email" className="block text-sm font-medium text-slate-700">{copy('email', 'Email')}</label>
                <input id="portal-business-email" name="business_email" autoComplete="email" className="input" value={editorDraft.business_email || ''} onChange={(event) => setDraft('business_email', event.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="portal-business-address" className="block text-sm font-medium text-slate-700">{copy('address', 'Address')}</label>
              <textarea id="portal-business-address" name="business_address" autoComplete="street-address" className="input resize-none" rows={2} value={editorDraft.business_address || ''} onChange={(event) => setDraft('business_address', event.target.value)} />
            </div>
            <div>
              <label htmlFor="portal-address-link" className="block text-sm font-medium text-slate-700">{copy('addressLink', 'Address link')}</label>
              <input
                id="portal-address-link"
                name="customer_portal_address_link"
                autoComplete="url"
                className="input"
                placeholder="https://maps.google.com/..."
                value={editorDraft.customer_portal_address_link || ''}
                onChange={(event) => setDraft('customer_portal_address_link', event.target.value)}
              />
              <p className="mt-2 text-xs text-slate-500">{copy('addressLinkHint', 'Optional external map or directions link opened when customers tap the address.')}</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900">{copy('contactVisibility', 'Contact visibility')}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-phone">
                  <span className="text-sm text-slate-700">{copy('showPhone', 'Show phone')}</span>
                  <input id="portal-show-phone" name="customer_portal_show_phone" type="checkbox" checked={!!editorDraft.customer_portal_show_phone} onChange={(event) => setDraft('customer_portal_show_phone', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-email">
                  <span className="text-sm text-slate-700">{copy('showEmail', 'Show email')}</span>
                  <input id="portal-show-email" name="customer_portal_show_email" type="checkbox" checked={!!editorDraft.customer_portal_show_email} onChange={(event) => setDraft('customer_portal_show_email', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-address">
                  <span className="text-sm text-slate-700">{copy('showAddress', 'Show address')}</span>
                  <input id="portal-show-address" name="customer_portal_show_address" type="checkbox" checked={!!editorDraft.customer_portal_show_address} onChange={(event) => setDraft('customer_portal_show_address', event.target.checked)} />
                </label>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label htmlFor="portal-title" className="block text-sm font-medium text-slate-700">{copy('portalTitle', 'Portal title')}</label>
                  <input id="portal-title" name="customer_portal_title" autoComplete="off" className="input" value={editorDraft.customer_portal_title || ''} onChange={(event) => setDraft('customer_portal_title', event.target.value)} />
                </div>
                <div>
                  <label htmlFor="portal-title-size" className="block text-sm font-medium text-slate-700">{copy('portalTitleSize', 'Portal title size')}</label>
                  <input
                    id="portal-title-size"
                    name="customer_portal_title_size"
                    className="mt-2 w-full accent-slate-950"
                    type="range"
                    min="28"
                    max="64"
                    step="2"
                    value={editorDraft.customer_portal_title_size || '40'}
                    onChange={(event) => setDraft('customer_portal_title_size', event.target.value)}
                  />
                  <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_title_size || '40'}px</span>
                </div>
                <div>
                  <label htmlFor="portal-intro" className="block text-sm font-medium text-slate-700">{copy('portalIntro', 'Portal intro')}</label>
                  <textarea id="portal-intro" name="customer_portal_intro" autoComplete="off" className="input resize-none" rows={3} value={editorDraft.customer_portal_intro || ''} onChange={(event) => setDraft('customer_portal_intro', event.target.value)} />
                </div>

                <div>
                  <label htmlFor="portal-language" className="block text-sm font-medium text-slate-700">{copy('language', 'Portal language')}</label>
                  <select id="portal-language" name="customer_portal_language" className="input" value={editorDraft.customer_portal_language || 'auto'} onChange={(event) => setDraft('customer_portal_language', event.target.value)}>
                    <option value="auto">{copy('followApp', 'Follow app')}</option>
                    <option value="en">{copy('english', 'English')}</option>
                    <option value="km">{copy('khmer', 'Khmer')}</option>
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="portal-website" className="block text-sm font-medium text-slate-700">{copy('website', 'Website')}</label>
                    <input id="portal-website" name="customer_portal_website" autoComplete="url" className="input" value={editorDraft.customer_portal_website || ''} onChange={(event) => setDraft('customer_portal_website', event.target.value)} />
                    <input id="portal-website-label" name="customer_portal_website_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_website_label || ''} onChange={(event) => setDraft('customer_portal_website_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-facebook" className="block text-sm font-medium text-slate-700">{copy('facebook', 'Facebook')}</label>
                    <input id="portal-facebook" name="customer_portal_facebook" autoComplete="url" className="input" value={editorDraft.customer_portal_facebook || ''} onChange={(event) => setDraft('customer_portal_facebook', event.target.value)} />
                    <input id="portal-facebook-label" name="customer_portal_facebook_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_facebook_label || ''} onChange={(event) => setDraft('customer_portal_facebook_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-instagram" className="block text-sm font-medium text-slate-700">{copy('instagram', 'Instagram')}</label>
                    <input id="portal-instagram" name="customer_portal_instagram" autoComplete="url" className="input" value={editorDraft.customer_portal_instagram || ''} onChange={(event) => setDraft('customer_portal_instagram', event.target.value)} />
                    <input id="portal-instagram-label" name="customer_portal_instagram_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_instagram_label || ''} onChange={(event) => setDraft('customer_portal_instagram_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-telegram" className="block text-sm font-medium text-slate-700">{copy('telegram', 'Telegram')}</label>
                    <input id="portal-telegram" name="customer_portal_telegram" autoComplete="url" className="input" value={editorDraft.customer_portal_telegram || ''} onChange={(event) => setDraft('customer_portal_telegram', event.target.value)} />
                    <input id="portal-telegram-label" name="customer_portal_telegram_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_telegram_label || ''} onChange={(event) => setDraft('customer_portal_telegram_label', event.target.value)} />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">{copy('socialVisibility', 'Social visibility')}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-website">
                      <span className="text-sm text-slate-700">{copy('showWebsite', 'Show website')}</span>
                      <input id="portal-show-website" name="customer_portal_show_website" type="checkbox" checked={!!editorDraft.customer_portal_show_website} onChange={(event) => setDraft('customer_portal_show_website', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-facebook">
                      <span className="text-sm text-slate-700">{copy('showFacebook', 'Show Facebook')}</span>
                      <input id="portal-show-facebook" name="customer_portal_show_facebook" type="checkbox" checked={!!editorDraft.customer_portal_show_facebook} onChange={(event) => setDraft('customer_portal_show_facebook', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-instagram">
                      <span className="text-sm text-slate-700">{copy('showInstagram', 'Show Instagram')}</span>
                      <input id="portal-show-instagram" name="customer_portal_show_instagram" type="checkbox" checked={!!editorDraft.customer_portal_show_instagram} onChange={(event) => setDraft('customer_portal_show_instagram', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-telegram">
                      <span className="text-sm text-slate-700">{copy('showTelegram', 'Show Telegram')}</span>
                      <input id="portal-show-telegram" name="customer_portal_show_telegram" type="checkbox" checked={!!editorDraft.customer_portal_show_telegram} onChange={(event) => setDraft('customer_portal_show_telegram', event.target.checked)} />
                    </label>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">{copy('mapEmbed', 'Google map embed URL')}</div>
                <label htmlFor="portal-google-map-embed" className="sr-only">{copy('mapEmbed', 'Google map embed URL')}</label>
                <textarea
                  id="portal-google-map-embed"
                  name="customer_portal_google_maps_embed"
                  autoComplete="off"
                  className="input resize-none"
                  rows={4}
                  value={editorDraft.customer_portal_google_maps_embed || ''}
                  placeholder="<iframe src='https://www.google.com/maps/embed?...'></iframe>"
                  onChange={(event) => setDraft('customer_portal_google_maps_embed', event.target.value)}
                />
                <p className="mt-2 text-xs text-slate-500">{copy('mapEmbedHint', 'Paste a Google Maps link or embed URL. The portal will render it as an interactive map card.')}</p>
                <label className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-google-map">
                  <span className="text-sm text-slate-700">{copy('showGoogleMap', 'Show Google map')}</span>
                  <input id="portal-show-google-map" name="customer_portal_show_google_map" type="checkbox" checked={!!editorDraft.customer_portal_show_google_map} onChange={(event) => setDraft('customer_portal_show_google_map', event.target.checked)} />
                </label>
                {draftMapEmbedUrl ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <iframe title="portal-map-preview" src={draftMapEmbedUrl} className="h-48 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                  </div>
                ) : null}
              </div>
            </div>

            <ImageField
              label={copy('logoImage', 'Logo image')}
              value={editorDraft.customer_portal_logo_image}
              fieldId="portal-logo-image"
              onUpload={() => uploadDraftImage('customer_portal_logo_image')}
              onChooseExisting={() => openFilePicker('customer_portal_logo_image', 'image', copy('logoImage', 'Logo image'))}
              onChange={(value) => setDraft('customer_portal_logo_image', value)}
              onClear={() => setDraft('customer_portal_logo_image', '')}
              onPreview={() => openPortalImage(copy('logoImage', 'Logo image'), [editorDraft.customer_portal_logo_image])}
              uploadLabel={copy('uploadImage', 'Upload image')}
              chooseLabel={copy('openFiles', 'Files')}
              clearLabel={copy('clearImage', 'Clear')}
              previewLabel={copy('openGallery', 'Open image gallery')}
              hint={copy('portalImageUploadHint', 'Upload stores a short file path, so portal settings stay clean.')}
            />
            <ImageField
              label={copy('faviconImage', 'Browser tab icon')}
              value={editorDraft.customer_portal_favicon_image}
              fieldId="portal-favicon-image"
              onUpload={() => uploadDraftImage('customer_portal_favicon_image')}
              onChooseExisting={() => openFilePicker('customer_portal_favicon_image', 'image', copy('faviconImage', 'Browser tab icon'))}
              onChange={(value) => setDraft('customer_portal_favicon_image', value)}
              onClear={() => setDraft('customer_portal_favicon_image', '')}
              onPreview={() => openPortalImage(copy('faviconImage', 'Browser tab icon'), [editorDraft.customer_portal_favicon_image])}
              uploadLabel={copy('uploadImage', 'Upload image')}
              chooseLabel={copy('openFiles', 'Files')}
              clearLabel={copy('clearImage', 'Clear')}
              previewLabel={copy('openGallery', 'Open image gallery')}
              hint={copy('faviconHint', 'Shown in browser tabs and saved shortcuts. If empty, the circular logo is used automatically.')}
            />
            <label className="mt-1 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" htmlFor="portal-show-logo">
              <span className="text-sm font-medium text-slate-700">{copy('showLogo', 'Show logo')}</span>
              <input id="portal-show-logo" name="customer_portal_show_logo" type="checkbox" checked={!!editorDraft.customer_portal_show_logo} onChange={(event) => setDraft('customer_portal_show_logo', event.target.checked)} />
            </label>
              <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">{copy('logoSize', 'Logo size')}</span>
                <input
                  id="portal-logo-size"
                  name="customer_portal_logo_size"
                  className="mt-2 w-full accent-slate-950"
                  type="range"
                  min="48"
                  max="144"
                  step="4"
                  value={editorDraft.customer_portal_logo_size || '80'}
                  onChange={(event) => setDraft('customer_portal_logo_size', event.target.value)}
                />
                <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_logo_size || '80'}px</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{copy('logoFit', 'Logo fit')}</span>
                  <select
                    id="portal-logo-fit"
                    name="customer_portal_logo_fit"
                    className="input mt-2"
                    value={editorDraft.customer_portal_logo_fit || 'cover'}
                    onChange={(event) => setDraft('customer_portal_logo_fit', event.target.value)}
                  >
                    <option value="contain">{copy('fitContain', 'Fit inside')}</option>
                    <option value="cover">{copy('fitCover', 'Fill frame')}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Logo zoom</span>
                  <input
                    id="portal-logo-zoom"
                    name="customer_portal_logo_zoom"
                    className="mt-2 w-full accent-slate-950"
                    type="range"
                    min="80"
                    max="180"
                    step="5"
                    value={editorDraft.customer_portal_logo_zoom || '100'}
                    onChange={(event) => setDraft('customer_portal_logo_zoom', event.target.value)}
                  />
                  <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_logo_zoom || '100'}%</span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Horizontal position</span>
                  <input
                    id="portal-logo-position-x"
                    name="customer_portal_logo_position_x"
                    className="mt-2 w-full accent-slate-950"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={editorDraft.customer_portal_logo_position_x || '50'}
                    onChange={(event) => setDraft('customer_portal_logo_position_x', event.target.value)}
                  />
                  <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_logo_position_x || '50'}%</span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Vertical position</span>
                  <input
                    id="portal-logo-position-y"
                    name="customer_portal_logo_position_y"
                    className="mt-2 w-full accent-slate-950"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={editorDraft.customer_portal_logo_position_y || '50'}
                    onChange={(event) => setDraft('customer_portal_logo_position_y', event.target.value)}
                  />
                  <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_logo_position_y || '50'}%</span>
                </label>
              </div>
              {editorDraft.customer_portal_logo_image ? (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Header logo preview</div>
                <div
                  className="mt-3 rounded-[28px] p-4 text-white"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_start, '#0f172a')} 0%, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_mid, '#14532d')} 50%, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_end, '#ea580c')} 100%)`,
                  }}
                >
                    <div className="flex items-center gap-4">
                      <div
                        className="flex items-center justify-center overflow-hidden rounded-full border border-white/25 bg-white shadow-lg"
                        style={{
                          height: `${Math.min(144, Math.max(48, toNumber(editorDraft.customer_portal_logo_size, 80)))}px`,
                          width: `${Math.min(144, Math.max(48, toNumber(editorDraft.customer_portal_logo_size, 80)))}px`,
                        }}
                      >
                        <img
                          src={editorDraft.customer_portal_logo_image}
                          alt={copy('logoImage', 'Logo image')}
                          className="h-full w-full"
                          style={{
                            objectFit: editorDraft.customer_portal_logo_fit === 'cover' ? 'cover' : 'contain',
                            objectPosition: `${editorDraft.customer_portal_logo_position_x || '50'}% ${editorDraft.customer_portal_logo_position_y || '50'}%`,
                            transform: `scale(${Math.max(0.8, Math.min(1.8, (toNumber(editorDraft.customer_portal_logo_zoom, 100) || 100) / 100))})`,
                            transformOrigin: 'center',
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{editorDraft.business_name || previewConfig.businessName || 'Business OS'}</div>
                        <div className="mt-1 text-xs text-white/80">{editorDraft.customer_portal_business_tagline || previewConfig.businessTagline || 'Preview the circular logo frame on the live header.'}</div>
                      </div>
                    </div>
                  </div>
                </div>
            ) : null}

            <ImageField
              label={copy('coverImage', 'Cover image')}
              value={editorDraft.customer_portal_cover_image}
              fieldId="portal-cover-image"
              onUpload={() => uploadDraftImage('customer_portal_cover_image')}
              onChooseExisting={() => openFilePicker('customer_portal_cover_image', 'image', copy('coverImage', 'Cover image'))}
              onChange={(value) => setDraft('customer_portal_cover_image', value)}
              onClear={() => setDraft('customer_portal_cover_image', '')}
              onPreview={() => openPortalImage(copy('coverImage', 'Cover image'), [editorDraft.customer_portal_cover_image])}
              uploadLabel={copy('uploadImage', 'Upload image')}
              chooseLabel={copy('openFiles', 'Files')}
              clearLabel={copy('clearImage', 'Clear')}
              previewLabel={copy('openGallery', 'Open image gallery')}
              hint={copy('portalImageUploadHint', 'Upload stores a short file path, so portal settings stay clean.')}
            />
            <label className="mt-1 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" htmlFor="portal-show-cover">
              <span className="text-sm font-medium text-slate-700">{copy('showCover', 'Show cover image')}</span>
              <input id="portal-show-cover" name="customer_portal_show_cover" type="checkbox" checked={!!editorDraft.customer_portal_show_cover} onChange={(event) => setDraft('customer_portal_show_cover', event.target.checked)} />
            </label>
            </div>

            <div id="portal-section-submissions" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'display' ? '' : 'hidden'}`}>
              <div className="text-sm font-semibold text-slate-900">{copy('portalCatalogSettings', 'Catalog settings')}</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="portal-stock-threshold-mode" className="block text-sm font-medium text-slate-700">{copy('stockThresholdMode', 'Stock badge mode')}</label>
                  <select id="portal-stock-threshold-mode" name="customer_portal_stock_threshold_mode" className="input" value={editorDraft.customer_portal_stock_threshold_mode || 'product'} onChange={(event) => setDraft('customer_portal_stock_threshold_mode', event.target.value)}>
                    <option value="product">{copy('stockThresholdModeProduct', 'Use each product threshold')}</option>
                    <option value="global">{copy('stockThresholdModeGlobal', 'Use portal-wide thresholds')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="portal-low-stock-threshold" className="block text-sm font-medium text-slate-700">{copy('lowStockThreshold', 'Low stock threshold')}</label>
                  <input id="portal-low-stock-threshold" name="customer_portal_low_stock_threshold" className="input" type="number" min="0" step="0.01" value={editorDraft.customer_portal_low_stock_threshold || '10'} onChange={(event) => setDraft('customer_portal_low_stock_threshold', event.target.value)} />
                </div>
                <div>
                  <label htmlFor="portal-out-stock-threshold" className="block text-sm font-medium text-slate-700">{copy('outOfStockThreshold', 'Out of stock threshold')}</label>
                  <input id="portal-out-stock-threshold" name="customer_portal_out_of_stock_threshold" className="input" type="number" min="0" step="0.01" value={editorDraft.customer_portal_out_of_stock_threshold || '0'} onChange={(event) => setDraft('customer_portal_out_of_stock_threshold', event.target.value)} />
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">{copy('stockThresholdHint', 'Global thresholds override the product-level stock badges on the customer portal only.')}</p>
            </div>

            <div className={`rounded-2xl border border-sky-200 bg-sky-50 p-4 ${activeEditorSection === 'submissions' ? '' : 'hidden'}`}>
              <div className="text-sm font-semibold text-sky-900">{copy('portalMembershipSettings', 'Membership settings')}</div>
              <p className="mt-2 text-sm text-sky-800">
                {copy('pointsPageHint', 'Point earning rules, redemption values, customer point notes, and reward-point defaults are managed in Loyalty Points so this portal page can stay focused on customer-facing content.')}
              </p>
              <button type="button" className="btn-secondary mt-3 text-sm" onClick={() => navigateTo('loyalty_points')}>
                {copy('openPointsPage', 'Open Loyalty Points')}
              </button>
            </div>

            <div className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'submissions' ? '' : 'hidden'}`}>
              <div className="text-sm font-semibold text-slate-900">{copy('portalSubmissionSettings', 'Submission settings')}</div>
              <div className="mt-4 grid gap-4">
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{copy('submissionFeature', 'Enable share submissions')}</span>
                  <input id="portal-submission-enabled" name="customer_portal_submission_enabled" type="checkbox" checked={!!editorDraft.customer_portal_submission_enabled} onChange={(event) => setDraft('customer_portal_submission_enabled', event.target.checked)} />
                </label>
                <div>
                  <label htmlFor="portal-submission-instructions" className="block text-sm font-medium text-slate-700">{copy('submissionInstructions', 'Submission instructions')}</label>
                  <textarea id="portal-submission-instructions" name="customer_portal_submission_instructions" autoComplete="off" className="input mt-1 resize-none" rows={4} value={editorDraft.customer_portal_submission_instructions || ''} onChange={(event) => setDraft('customer_portal_submission_instructions', event.target.value)} />
                  <p className="mt-1 text-xs text-slate-500">{copy('submissionInstructionsHint', 'Customers can only submit screenshots. Staff reviews and awards points inside Business OS.')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionShell>

      <div className={activeEditorSection === 'submissions' ? '' : 'hidden'}>
      <SectionShell title={copy('reviewQueue', 'Review queue')} subtitle={copy('reviewQueueHint', 'Approve, reject, and award points for customer share submissions.')}>
        <div className="space-y-4">
          {reviewItems.length ? reviewItems.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.customer_name || item.membership_number || `#${item.id}`}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.membership_number || '-'}{item.platform ? ` • ${item.platform}` : ''}</div>
                </div>
                <div className="text-xs font-semibold text-slate-500">{formatDateTime(item.created_at)}</div>
              </div>
              {item.note ? <p className="mt-3 text-sm text-slate-700">{item.note}</p> : null}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(item.screenshots || []).map((image, index) => (
                  <button
                    key={`${item.id}-${index}`}
                    type="button"
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                    onClick={() => openPortalImage(item.customer_name || item.membership_number || `#${item.id}`, item.screenshots || [], index)}
                  >
                    <img src={image} alt={`review-${item.id}-${index + 1}`} className="h-28 w-full object-cover" />
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3">
                <div>
                  <label htmlFor={`portal-review-reward-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('rewardPoints', 'Reward points')}</label>
                  <input
                    id={`portal-review-reward-${item.id}`}
                    name={`portal_review_reward_${item.id}`}
                    className="input"
                    type="number"
                    min="0"
                    step="1"
                    value={item.reward_points || 0}
                    onChange={(event) => setReviewItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, reward_points: event.target.value } : entry))}
                  />
                </div>
                <div>
                  <label htmlFor={`portal-review-note-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('shareReviewNote', 'Review note')}</label>
                  <textarea
                    id={`portal-review-note-${item.id}`}
                    name={`portal_review_note_${item.id}`}
                    className="input resize-none"
                    rows={3}
                    value={item.review_note || ''}
                    placeholder={copy('reviewNotePlaceholder', 'Internal review note')}
                    onChange={(event) => setReviewItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, review_note: event.target.value } : entry))}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'approved')}>
                    {copy('approve', 'Approve')}
                  </button>
                  <button className="btn-secondary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'rejected')}>
                    {copy('reject', 'Reject')}
                  </button>
                  <button className="btn-secondary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'pending')}>
                    {copy('pending', 'Pending')}
                  </button>
                </div>
              </div>
            </article>
          )) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              {copy('noSubmissions', 'No share submissions yet.')}
            </div>
          )}
        </div>
      </SectionShell>
      </div>
    </aside>
  ) : null

  if (loading) {
    return (
    <div
      className={`${publicView ? 'min-h-screen w-full overflow-visible' : 'page-scroll flex-1 overflow-y-auto'} bg-[radial-gradient(circle_at_top,_#fef3c7,_#fff7ed_35%,_#f8fafc_80%)]`}
      style={publicView ? { touchAction: 'pan-y pinch-zoom', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}
    >
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="rounded-[32px] border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
            {copy('loadingPortal', 'Loading customer portal...')}
          </div>
        </div>
      </div>
    )
  }

  const previewTitle = String(previewConfig.title || previewConfig.businessName || '').trim()
  const previewBusinessName = String(previewConfig.businessName || '').trim()
  const showBrandLabel = previewBusinessName && previewBusinessName.toLowerCase() !== previewTitle.toLowerCase()
  const showHeroToolsPanel = false
  const showPortalToolsBar = publicView && previewConfig.translateWidgetEnabled

  return (
    <div
      className={`${publicView ? 'min-h-screen w-full overflow-visible' : 'page-scroll flex-1 overflow-y-auto'} bg-[radial-gradient(circle_at_top,_#fef3c7,_#fff7ed_28%,_#f8fafc_70%)]`}
      style={publicView ? { touchAction: 'pan-y pinch-zoom', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}
    >
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="space-y-6">
          {canEdit ? editorPanel : null}
          <div ref={previewSectionRef} className="space-y-6">
            {canEdit ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => document.getElementById('portal-editor-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  {copy('backToEditor', 'Back to editor')}
                </button>
              </div>
            ) : null}
            <section className="overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
              <div
                className="relative overflow-hidden px-6 py-8 text-white sm:px-8 sm:py-10"
                style={{
                  backgroundColor: normalizeHexColor(previewConfig.heroGradientStart, '#0f172a'),
                  backgroundImage: (previewConfig.showCover && versionedBusinessCover)
                    ? `linear-gradient(135deg, ${hexToRgba(previewConfig.heroGradientStart, 0.88)} 0%, ${hexToRgba(previewConfig.heroGradientMid, 0.74)} 55%, ${hexToRgba(previewConfig.heroGradientEnd, 0.72)} 100%), url(${versionedBusinessCover})`
                    : `linear-gradient(135deg, ${normalizeHexColor(previewConfig.heroGradientStart, '#0f172a')} 0%, ${normalizeHexColor(previewConfig.heroGradientMid, '#14532d')} 45%, ${normalizeHexColor(previewConfig.heroGradientEnd, '#ea580c')} 100%)`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18),_transparent_34%)]" />
                <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">
                      <Sparkles className="h-3.5 w-3.5" />
                      {publicView ? copy('publicBadge', 'Customer Portal') : copy('previewBadge', 'Portal Studio')}
                    </div>

                    <div className="mt-4 flex items-center gap-4">
                      <div
                        className="flex items-center justify-center overflow-hidden rounded-full border border-white/25 bg-white shadow-lg"
                        style={{
                          height: `${previewConfig.logoSize || 80}px`,
                          width: `${previewConfig.logoSize || 80}px`,
                        }}
                      >
                        {previewConfig.showLogo && versionedBusinessLogo ? (
                          <button
                            type="button"
                            className="flex h-full w-full items-center justify-center"
                            onClick={() => openPortalImage(previewConfig.businessName || copy('logoImage', 'Logo image'), [versionedBusinessLogo])}
                          >
                              <img
                                src={versionedBusinessLogo}
                                alt={previewConfig.businessName}
                                className="h-full w-full"
                                style={{
                                  objectFit: previewConfig.logoFit === 'cover' ? 'cover' : 'contain',
                                  objectPosition: `${previewConfig.logoPositionX || 50}% ${previewConfig.logoPositionY || 50}%`,
                                  transform: `scale(${Math.max(0.8, Math.min(1.8, (previewConfig.logoZoom || 100) / 100))})`,
                                  transformOrigin: 'center',
                                }}
                              />
                            </button>
                        ) : (
                          <span className="text-xl font-semibold">{(previewConfig.businessName || 'B').slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        {showBrandLabel ? (
                          <div className="notranslate text-sm font-semibold text-amber-100" translate="no">{previewConfig.businessName}</div>
                        ) : null}
                        {previewConfig.businessTagline ? (
                          <div className="mt-1 text-sm text-slate-100/90">{previewConfig.businessTagline}</div>
                        ) : null}
                      </div>
                    </div>

                    {previewTitle ? (
                      <h1
                        className="notranslate mt-5 font-semibold tracking-tight text-white"
                        style={{ fontSize: `${previewConfig.titleSize || 40}px`, lineHeight: 1.05 }}
                        translate="no"
                      >
                        {previewTitle}
                      </h1>
                    ) : null}
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-100 sm:text-base">{previewConfig.intro}</p>

                    {businessFacts.length || socialLinks.length ? (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {businessFacts.map((item) => {
                          const Icon = item.icon
                          const content = (
                            <>
                              <Icon className="h-4 w-4" />
                              {item.value}
                            </>
                          )
                          return item.href ? (
                            <a key={item.key} href={item.href} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/15">
                              {content}
                            </a>
                          ) : (
                            <span key={item.key} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-white/90">
                              {content}
                            </span>
                          )
                        })}
                        {socialLinks.map((item) => {
                          const Icon = item.icon
                          return (
                            <a
                              key={item.key}
                              href={item.value}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/15"
                            >
                              <Icon className="h-4 w-4" />
                              {item.label}
                            </a>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                  {showHeroToolsPanel ? (
                    <div className="w-full lg:w-[320px] xl:w-[360px]">
                      <div className="overflow-hidden rounded-3xl border border-white/15 bg-slate-900/35 shadow-xl backdrop-blur">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left lg:cursor-default" aria-expanded={mobileHeroToolsOpen}
                          onClick={() => setMobileHeroToolsOpen((current) => !current)}
                        >
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">
                            <Globe className="h-4 w-4" />
                            {copy('publicTranslation', 'Language tools')}
                          </div>
                          <span className="text-xs text-white/70 lg:hidden">{mobileHeroToolsOpen ? copy('showLess', 'Hide') : copy('viewMore', 'Open')}</span>
                        </button>
                        <div className={`${mobileHeroToolsOpen ? 'block' : 'hidden'} border-t border-white/15 px-4 py-3 lg:block`}>
                          {publicView && previewConfig.translateWidgetEnabled ? (
                            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/90">
                              <label className="block">
                                <span className="sr-only">{copy('language', 'Portal language')}</span>
                                <select
                                  id="portal-language-tools"
                                  name="portal_language_tools"
                                  className="w-full rounded-xl border border-white/20 bg-slate-950/30 px-3 py-2 text-sm text-white outline-none"
                                  value={translateTarget}
                                  onChange={(event) => changeTranslateTarget(event.target.value)}
                                >
                                  {PUBLIC_TRANSLATE_LANG_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value} className="text-slate-900">
                                      {option.value === 'original' ? copy('followApp', 'Original') : option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {!translateReady ? <div className="mt-2 text-xs text-white/70">{copy('preparingTranslations', 'Preparing translation tools...')}</div> : null}
                              <div className="mt-2">
                                <div id="business-os-portal-translate" />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                </div>
              </div>

              {showPortalToolsBar ? (
                <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-8">
                  <div className="flex justify-end">
                    <label className="inline-flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <Globe className="h-4 w-4 shrink-0 text-slate-500" />
                      <select
                        id="portal-language-tools"
                        name="portal_language_tools"
                        className="min-w-[132px] bg-transparent text-sm text-slate-700 outline-none"
                        value={translateTarget}
                        onChange={(event) => changeTranslateTarget(event.target.value)}
                      >
                        {PUBLIC_TRANSLATE_LANG_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.value === 'original' ? copy('followApp', 'Original') : option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="hidden">
                      <div id="business-os-portal-translate" />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="border-t border-slate-200 bg-white px-6 py-4 sm:px-8">
                <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                  {previewConfig.showCatalog ? (
                    <button
                      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === 'products' ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      onClick={() => setActiveTab('products')}
                    >
                      <ShoppingBag className="h-4 w-4" />
                      {copy('products', 'Products')}
                    </button>
                  ) : null}
                  {previewConfig.showMembership ? (
                    <button
                      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === 'membership' ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      onClick={() => setActiveTab('membership')}
                    >
                      <Ticket className="h-4 w-4" />
                      {copy('membership', 'Membership')}
                    </button>
                  ) : null}
                  {previewConfig.showAbout ? (
                    <button
                      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === 'about' ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      onClick={() => setActiveTab('about')}
                    >
                      <Store className="h-4 w-4" />
                      {copy('about', 'About')}
                    </button>
                  ) : null}
                  {previewConfig.showFaq ? (
                    <button
                      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === 'faq' ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      onClick={() => setActiveTab('faq')}
                    >
                      <HelpCircle className="h-4 w-4" />
                      {copy('faq', 'FAQ')}
                    </button>
                  ) : null}
                  {previewConfig.aiEnabled ? (
                    <button
                      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === 'ai' ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      onClick={() => setActiveTab('ai')}
                    >
                      <Bot className="h-4 w-4" />
                      {previewConfig.aiTitle || copy('portalAssistant', 'AI assistant')}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            {activeTab === 'products' && previewConfig.showCatalog ? catalogSection : null}
            {activeTab === 'membership' && previewConfig.showMembership ? membershipSection : null}
            {activeTab === 'about' && previewConfig.showAbout ? aboutSection : null}
            {activeTab === 'faq' && previewConfig.showFaq ? faqSection : null}
            {activeTab === 'ai' && previewConfig.aiEnabled ? aiSection : null}
          </div>
        </div>
        {false && productGalleryView.open && productGalleryView.items.length ? (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4"
            onClick={() => setProductGalleryView({ open: false, title: '', items: [], index: 0 })}
          >
            <div className="relative w-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
              <div className="absolute inset-y-0 left-3 z-20 flex items-center">
                <button
                  type="button"
                  className="rounded-full border border-white/15 bg-black/45 p-2 text-white transition hover:bg-black/60"
                  onClick={() => shiftProductGallery(-1)}
                  aria-label={copy('prevImage', 'Prev')}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              </div>
              <div className="absolute inset-y-0 right-3 z-20 flex items-center">
                <button
                  type="button"
                  className="rounded-full border border-white/15 bg-black/45 p-2 text-white transition hover:bg-black/60"
                  onClick={() => shiftProductGallery(1)}
                  aria-label={copy('nextImage', 'Next')}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              <div className="absolute right-3 top-3 z-20">
                <button
                  type="button"
                  className="rounded-full border border-white/15 bg-black/55 p-2 text-white transition hover:bg-black/70"
                  onClick={() => setProductGalleryView({ open: false, title: '', items: [], index: 0 })}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 shadow-2xl">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs text-white/80">
                  <span className="truncate">{productGalleryView.title}</span>
                  <span>
                    {replaceVars(copy('imageCount', '{current}/{total}'), {
                      current: productGalleryView.index + 1,
                      total: productGalleryView.items.length,
                    })}
                  </span>
                </div>
                <div className="flex h-[75vh] items-center justify-center bg-black">
                  <ProductImg
                    src={productGalleryView.items[productGalleryView.index]}
                    alt={productGalleryView.title}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="border-t border-white/10 bg-slate-950/85 px-4 py-3">
                  <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
                    {productGalleryView.items.map((_, index) => (
                      <button
                        key={`dot-${index}`}
                        type="button"
                        aria-label={replaceVars(copy('dotsLabel', 'Image {current} of {total}'), { current: index + 1, total: productGalleryView.items.length })}
                        className={`h-2.5 w-2.5 rounded-full transition ${index === productGalleryView.index ? 'bg-white' : 'bg-white/35 hover:bg-white/60'}`}
                        onClick={() => setProductGalleryView((current) => ({ ...current, index }))}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {productGalleryView.items.map((image, index) => (
                      <button
                        key={`thumb-${image}-${index}`}
                        type="button"
                        className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border transition ${index === productGalleryView.index ? 'border-cyan-300 ring-2 ring-cyan-300/60' : 'border-white/20 hover:border-white/50'}`}
                        onClick={() => setProductGalleryView((current) => ({ ...current, index }))}
                      >
                        <ProductImg src={image} alt={`${productGalleryView.title}-${index + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <ImageGalleryLightbox
          open={productGalleryView.open && !!productGalleryView.items.length}
          title={productGalleryView.title}
          images={productGalleryView.items}
          index={productGalleryView.index}
          onClose={() => setProductGalleryView({ open: false, title: '', items: [], index: 0 })}
          onIndexChange={(index) => setProductGalleryView((current) => ({ ...current, index }))}
          labels={{
            prev: copy('prevImage', 'Prev'),
            next: copy('nextImage', 'Next'),
            imageCount: copy('imageCount', '{current}/{total}'),
            dotsLabel: copy('dotsLabel', 'Image {current} of {total}'),
          }}
          renderImage={(src, alt, className) => (
            <ProductImg src={src} alt={alt} className={className} />
          )}
        />
        <FilePickerModal
          open={filePicker.open}
          title={filePicker.title}
          mediaType={filePicker.mediaType}
          onClose={() => setFilePicker({ open: false, target: null, mediaType: 'image', title: 'Choose file' })}
          onSelect={handleFilePickerSelect}
        />
        <ImageGalleryLightbox
          open={portalImageView.open && !!portalImageView.images.length}
          title={portalImageView.title}
          images={portalImageView.images}
          index={portalImageView.index}
          onClose={() => setPortalImageView({ open: false, title: '', images: [], index: 0 })}
          onIndexChange={(index) => setPortalImageView((current) => ({ ...current, index }))}
          labels={{
            prev: copy('prevImage', 'Prev'),
            next: copy('nextImage', 'Next'),
            imageCount: copy('imageCount', '{current}/{total}'),
            dotsLabel: copy('dotsLabel', 'Image {current} of {total}'),
          }}
        />
      </div>
    </div>
  )
}
