// Storefront legal content (N45): Privacy Policy, Terms & Conditions and
// Cookie Policy for the public customer portal.
//
// WHY THE TEXT LIVES HERE AND IN THE PACKS
// ----------------------------------------
// The storefront resolves its strings through PublicCatalogPage's `copy()`,
// which reads portalLanguagePacks.ts first and falls back to inline en/km
// text -- it never reaches src/lang/*.json (that lookup is prefixed
// `portalEditor.` and no such keys exist). The admin packs are also ~1MB and
// are loaded lazily by AppContext for the ADMIN app; pulling them onto a
// phone in Cambodia just to render a policy page would be the wrong trade.
//
// So the same shape AppContext already uses for CORE_ENGLISH_PACK applies
// here: the text is declared inline for the surface that must render it
// offline-cheap, and MIRRORED into en.json + km.json under the
// `portal_legal_*` namespace. tests/portalLegalContent.test.ts is the lock --
// it fails if a key exists here and not in a pack, or if the two ever drift.
//
// The pages are TEMPLATES. They interpolate the merchant's own business
// details from /api/portal/config and carry an explicit "have this reviewed"
// notice. Nothing here is legal advice.
import { fmtDateOnly } from '../../../utils/formatters.ts'

export type LegalPageKey = 'privacy' | 'terms' | 'cookies'

// Bump this (and the pack copies of the section text) whenever the wording
// changes materially. It is also the value stored on a portal account as
// `consent_version` at sign-up, so a later policy change is auditable.
export const PORTAL_LEGAL_LAST_UPDATED_ISO = '2026-09-07'
export const PORTAL_LEGAL_CONSENT_VERSION = `portal-legal-${PORTAL_LEGAL_LAST_UPDATED_ISO}`

export function formatLegalLastUpdated(iso: string = PORTAL_LEGAL_LAST_UPDATED_ISO): string {
  // dd/mm/yyyy, day-first, through the one app-wide date formatter.
  return fmtDateOnly(iso)
}

export type LegalBusinessDetails = {
  name: string
  legalName: string
  registrationNumber: string
  address: string
  phone: string
  email: string
}

// A section is a heading key plus one or more body keys, rendered in order.
export type LegalSection = { heading: string; bodies: readonly string[] }

export const LEGAL_PAGE_TITLE_KEY: Record<LegalPageKey, string> = {
  privacy: 'portal_legal_privacy_title',
  terms: 'portal_legal_terms_title',
  cookies: 'portal_legal_cookies_title',
}

export const LEGAL_PAGE_ORDER: readonly LegalPageKey[] = ['privacy', 'terms', 'cookies']

export function isLegalPageKey(value: unknown): value is LegalPageKey {
  return value === 'privacy' || value === 'terms' || value === 'cookies'
}

export const LEGAL_PAGE_SECTIONS: Record<LegalPageKey, readonly LegalSection[]> = {
  privacy: [
    { heading: 'portal_legal_privacy_who_h', bodies: ['portal_legal_privacy_who_b'] },
    { heading: 'portal_legal_privacy_collect_h', bodies: ['portal_legal_privacy_collect_b', 'portal_legal_privacy_collect_list'] },
    { heading: 'portal_legal_privacy_why_h', bodies: ['portal_legal_privacy_why_b'] },
    { heading: 'portal_legal_privacy_basis_h', bodies: ['portal_legal_privacy_basis_b'] },
    { heading: 'portal_legal_privacy_retention_h', bodies: ['portal_legal_privacy_retention_b'] },
    { heading: 'portal_legal_privacy_sharing_h', bodies: ['portal_legal_privacy_sharing_b', 'portal_legal_privacy_sharing_list'] },
    { heading: 'portal_legal_privacy_security_h', bodies: ['portal_legal_privacy_security_b'] },
    { heading: 'portal_legal_privacy_rights_h', bodies: ['portal_legal_privacy_rights_b'] },
    { heading: 'portal_legal_privacy_children_h', bodies: ['portal_legal_privacy_children_b'] },
    { heading: 'portal_legal_privacy_changes_h', bodies: ['portal_legal_privacy_changes_b'] },
  ],
  terms: [
    { heading: 'portal_legal_terms_catalogue_h', bodies: ['portal_legal_terms_catalogue_b'] },
    { heading: 'portal_legal_terms_prices_h', bodies: ['portal_legal_terms_prices_b'] },
    { heading: 'portal_legal_terms_nopayment_h', bodies: ['portal_legal_terms_nopayment_b'] },
    { heading: 'portal_legal_terms_membership_h', bodies: ['portal_legal_terms_membership_b'] },
    { heading: 'portal_legal_terms_account_h', bodies: ['portal_legal_terms_account_b'] },
    { heading: 'portal_legal_terms_ai_h', bodies: ['portal_legal_terms_ai_b'] },
    { heading: 'portal_legal_terms_use_h', bodies: ['portal_legal_terms_use_b'] },
    { heading: 'portal_legal_terms_ip_h', bodies: ['portal_legal_terms_ip_b'] },
    { heading: 'portal_legal_terms_liability_h', bodies: ['portal_legal_terms_liability_b'] },
    { heading: 'portal_legal_terms_law_h', bodies: ['portal_legal_terms_law_b'] },
  ],
  cookies: [
    { heading: 'portal_legal_cookies_what_h', bodies: ['portal_legal_cookies_what_b'] },
    { heading: 'portal_legal_cookies_consent_h', bodies: ['portal_legal_cookies_consent_b'] },
    { heading: 'portal_legal_cookies_table_h', bodies: ['portal_legal_cookies_table_b'] },
    { heading: 'portal_legal_cookies_third_h', bodies: ['portal_legal_cookies_third_b'] },
    { heading: 'portal_legal_cookies_clear_h', bodies: ['portal_legal_cookies_clear_b'] },
  ],
}

// The EXACT client-side storage this storefront uses. Every row was traced to
// a real write in the source, listed beside it -- nothing here is aspirational.
export type LegalStorageRow = {
  id: string
  name: string
  kindKey: string
  purposeKey: string
  lifetimeKey: string
}

export const LEGAL_STORAGE_ROWS: readonly LegalStorageRow[] = [
  // lib/portalSession.ts -- HttpOnly session cookie set on sign-in only.
  { id: 'bos_portal', name: 'bos_portal', kindKey: 'portal_legal_kind_cookie', purposeKey: 'portal_legal_store_session_p', lifetimeKey: 'portal_legal_store_session_l' },
  // portalTranslateController.ts -- written only when the visitor picks one of
  // the external-translation languages from the language menu.
  { id: 'googtrans', name: 'googtrans', kindKey: 'portal_legal_kind_cookie', purposeKey: 'portal_legal_store_googtrans_p', lifetimeKey: 'portal_legal_store_googtrans_l' },
  // portalBucket.ts
  { id: 'bucket', name: 'business-os-portal-bucket-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_bucket_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  { id: 'wishlist', name: 'business-os-portal-wishlist-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_wishlist_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // portalTranslateController.ts
  { id: 'translate', name: 'business-os:portal-translate-target', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_translate_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // PublicCatalogPage.tsx PUBLIC_PORTAL_CACHE_KEY (both storages)
  { id: 'cache', name: 'business-os-catalog-portal-cache', kindKey: 'portal_legal_kind_both', purposeKey: 'portal_legal_store_cache_p', lifetimeKey: 'portal_legal_store_cache_l' },
  // AppContext device settings -- theme + language choice.
  { id: 'device', name: 'businessos_device_settings', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_device_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // catalogAssetUrls.ts -- image host override.
  { id: 'assets', name: 'businessos_public_asset_base_url', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_assets_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // legal/PortalEmbedConsent.tsx -- written only when the visitor asks for
  // the map, so their answer is not asked for again on the next visit.
  { id: 'map-consent', name: 'business-os-portal-map-consent-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_map_consent_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
]

const EN: Record<string, string> = {
  // --- shared chrome -------------------------------------------------------
  portal_legal_policies: 'Policies',
  portal_legal_privacy_title: 'Privacy Policy',
  portal_legal_terms_title: 'Terms & Conditions',
  portal_legal_cookies_title: 'Cookie Policy',
  portal_legal_last_updated: 'Last updated {date}',
  portal_legal_close: 'Close',
  portal_legal_open_policies: 'Open policies menu',
  portal_legal_template_notice: 'This document is a template prepared for {name}. The business owner should have it reviewed by a qualified lawyer before relying on it. It is not legal advice.',
  portal_legal_identity_h: 'Business details',
  portal_legal_identity_legal_name: 'Registered name',
  portal_legal_identity_registration: 'Registration number',
  portal_legal_identity_address: 'Address',
  portal_legal_identity_phone: 'Phone',
  portal_legal_identity_email: 'Email',
  portal_legal_footer_rights: '© {year} {name}. All rights reserved.',
  portal_legal_footer_landmark: 'Site information and policies',

  // --- Privacy Policy ------------------------------------------------------
  portal_legal_privacy_who_h: 'Who we are',
  portal_legal_privacy_who_b: 'This online catalogue is operated by {legalName} ("we", "us"). The business details above are the contact point for anything in this policy.',
  portal_legal_privacy_collect_h: 'What we collect',
  portal_legal_privacy_collect_b: 'We keep the collection deliberately small. Browsing the catalogue needs no account and no personal details at all.',
  portal_legal_privacy_collect_list: 'If you create an account: your name, your phone number, a one-way encrypted form of your password (never the password itself), and a membership number. If you use the list or wishlist while signed in: the products you saved. If you send us social-media screenshots for a reward: the images you upload and any note you add. Automatically, for security and reliability: your IP address in short-lived rate-limit and sign-in-protection records, your browser type for the session record, and technical error reports when something breaks.',
  portal_legal_privacy_why_h: 'Why we use it',
  portal_legal_privacy_why_b: 'Your name and phone number identify your membership and let our staff reach you about an order or a reward. Your saved list follows you between devices. IP and session records exist only to stop password guessing and abuse of the public forms. Error reports exist only to fix faults.',
  portal_legal_privacy_basis_h: 'Your consent',
  portal_legal_privacy_basis_b: 'Creating an account is optional, and you are asked to agree to this policy and the Terms & Conditions before the account is created. You can withdraw that agreement at any time by asking us to close your account. Security records are kept because we need them to run the site safely.',
  portal_legal_privacy_retention_h: 'How long we keep it',
  portal_legal_privacy_retention_b: 'Rate-limit records are deleted after about a day, expired sign-in sessions are deleted automatically, and assistant chat logs are deleted after about thirty days. Account details, membership records and screenshots you send us are kept while your membership is active; ask us and we will delete them.',
  portal_legal_privacy_sharing_h: 'Who else sees it',
  portal_legal_privacy_sharing_b: 'We do not sell your data and we do not use advertising trackers.',
  portal_legal_privacy_sharing_list: 'Cloudflare hosts this site, its database and its images, so data passes through and is stored on their infrastructure. Error reports go to our error-monitoring provider. If the assistant is switched on, the question you type is sent to a third-party AI provider to produce an answer. If you choose an external translation language, your page text is sent to Google Translate. If the store map is shown and you choose to load it, Google receives that request. Links to Facebook, Instagram, Telegram, WhatsApp or Messenger open those apps, which then apply their own policies.',
  portal_legal_privacy_security_h: 'How we protect it',
  portal_legal_privacy_security_b: 'Passwords are stored only as a one-way hash. The sign-in cookie cannot be read by scripts, is limited to this site and is sent over HTTPS. Repeated failed attempts are locked out. No system is perfect, so please use a password you do not reuse elsewhere.',
  portal_legal_privacy_rights_h: 'Your choices',
  portal_legal_privacy_rights_b: 'You can ask us for a copy of what we hold about you, ask us to correct it, or ask us to delete your account and its data. Contact us using the business details above and allow us a reasonable time to confirm your identity first.',
  portal_legal_privacy_children_h: 'Children',
  portal_legal_privacy_children_b: 'This site is intended for adults. We do not knowingly create accounts for children under 16. If you believe a child has given us their details, contact us and we will delete them.',
  portal_legal_privacy_changes_h: 'Changes',
  portal_legal_privacy_changes_b: 'If this policy changes we will update the date at the top of this page. Continuing to use the site after a change means you accept the updated version.',

  // --- Terms & Conditions --------------------------------------------------
  portal_legal_terms_catalogue_h: 'This is an information catalogue',
  portal_legal_terms_catalogue_b: 'This site shows what {name} stocks. It is an invitation to contact us, not a binding offer, and nothing here forms a sales contract on its own.',
  portal_legal_terms_prices_h: 'Prices and availability',
  portal_legal_terms_prices_b: 'Prices, promotions and stock status are shown for guidance and can change without notice. Availability is per branch and can move while you browse. The price and the stock confirmed by our staff at the time of purchase is the one that applies.',
  portal_legal_terms_nopayment_h: 'No payment on this site',
  portal_legal_terms_nopayment_b: 'You cannot pay here. The list you build is a shortlist to show our team; payment happens in person or through the channel you agree with our staff. We will never ask for card or bank details through this site.',
  portal_legal_terms_membership_h: 'Membership and points',
  portal_legal_terms_membership_b: 'Membership points are reviewed and applied by our staff, and redemption uses whole units only. Points have no cash value, are not transferable, and we may correct a balance that was awarded in error.',
  portal_legal_terms_account_h: 'Your account',
  portal_legal_terms_account_b: 'Give accurate details, keep your password to yourself, and tell us if you think someone else is using your account. You are responsible for what is done through it. We may suspend an account that is used abusively.',
  portal_legal_terms_ai_h: 'The assistant',
  portal_legal_terms_ai_b: 'The assistant is generated by a third-party AI service, may be wrong, and is for general guidance only. It is not medical, dermatological or professional advice. Do not send it personal, health or payment information, and check anything important with our staff.',
  portal_legal_terms_use_h: 'Acceptable use',
  portal_legal_terms_use_b: 'Please do not attempt to break into, overload, scrape or disrupt this site, and do not upload unlawful, misleading or someone else\'s content. Screenshots you send us must be your own.',
  portal_legal_terms_ip_h: 'Content and trademarks',
  portal_legal_terms_ip_b: 'The layout, text and photographs on this site belong to {legalName} or to our suppliers, and brand names and product images remain the property of their owners. Please do not reuse them commercially without our permission.',
  portal_legal_terms_liability_h: 'Limits',
  portal_legal_terms_liability_b: 'We take care to keep this catalogue accurate and available, but we cannot promise it is error-free or never interrupted. To the extent the law allows, we are not liable for indirect or consequential loss arising from use of this site. Nothing here limits any right you have under Cambodian consumer protection law.',
  portal_legal_terms_law_h: 'Governing law',
  portal_legal_terms_law_b: 'These terms are governed by the laws of the Kingdom of Cambodia, and the courts of Cambodia have jurisdiction. If you have a complaint, contact us first using the business details above.',

  // --- Cookie Policy -------------------------------------------------------
  portal_legal_cookies_what_h: 'What this site stores',
  portal_legal_cookies_what_b: 'A cookie is a small file a site stores in your browser; local storage works the same way. This site uses only what it needs to work. There are no advertising or analytics cookies.',
  portal_legal_cookies_consent_h: 'Why there is no consent banner',
  portal_legal_cookies_consent_b: 'Everything in the table below is either strictly necessary to run the site or is created only after you ask for something -- signing in, saving a product, choosing a language or a theme. Storage of that kind does not require a consent banner. The one feature that would load a third party on its own, the store map, is not loaded until you tap to load it.',
  portal_legal_cookies_table_h: 'Exactly what is stored',
  portal_legal_cookies_table_b: 'This is the complete list.',
  portal_legal_cookies_third_h: 'Third parties',
  portal_legal_cookies_third_b: 'Choosing an external translation language loads Google Translate, and loading the store map loads Google Maps; both are Google services and may set their own cookies once loaded. Opening a Facebook, Instagram, Telegram, WhatsApp or Messenger link hands you to that app under its own policy. The assistant sends your question to a third-party AI provider. None of these run before you choose them.',
  portal_legal_cookies_clear_h: 'How to remove it',
  portal_legal_cookies_clear_b: 'Sign out to end the session cookie, and clear site data for this address in your browser settings to remove everything else. Clearing it removes your saved list, wishlist, language and theme on this device.',

  // --- storage table -------------------------------------------------------
  portal_legal_col_name: 'Name',
  portal_legal_col_kind: 'Type',
  portal_legal_col_purpose: 'Purpose',
  portal_legal_col_lifetime: 'Kept for',
  portal_legal_kind_cookie: 'Cookie',
  portal_legal_kind_local: 'Local storage',
  portal_legal_kind_both: 'Local and session storage',
  portal_legal_store_session_p: 'Keeps you signed in. Set only when you sign in, cannot be read by scripts, and is limited to this site.',
  portal_legal_store_session_l: 'Until you sign out or it expires',
  portal_legal_store_googtrans_p: 'Remembers the external translation language. Written only if you choose one of those languages.',
  portal_legal_store_googtrans_l: 'Until you return to the original language',
  portal_legal_store_bucket_p: 'Your list of products, so it survives a page reload.',
  portal_legal_store_wishlist_p: 'Your saved products.',
  portal_legal_store_translate_p: 'The language you chose for this site.',
  portal_legal_store_cache_p: 'A copy of the last catalogue page so the site opens quickly and works with a poor connection. Products only, nothing about you.',
  portal_legal_store_cache_l: 'About 20 minutes',
  portal_legal_store_device_p: 'Your light or dark theme choice on this device.',
  portal_legal_store_assets_p: 'Where product images are loaded from.',
  portal_legal_store_map_consent_p: 'Whether you chose to load the store map on this device.',
  portal_legal_store_until_cleared_l: 'Until you clear site data',

  // --- consent + embeds ----------------------------------------------------
  portal_legal_consent_label: 'I agree to the Terms & Conditions and the Privacy Policy.',
  portal_legal_consent_required: 'Please agree to the Terms & Conditions and Privacy Policy to create an account.',
  portal_legal_consent_read_terms: 'Read the Terms & Conditions',
  portal_legal_consent_read_privacy: 'Read the Privacy Policy',
  portal_legal_map_consent_b: 'The map is loaded from Google Maps, which can set its own cookies. Load it only if you want to.',
  portal_legal_map_consent_load: 'Load the map',
  portal_legal_map_consent_link: 'Open in Google Maps instead',

  // --- admin editor block --------------------------------------------------
  portal_legal_editor_block: 'Legal & business details',
  portal_legal_editor_hint: 'Shown in the storefront footer and filled into the privacy, terms and cookie pages. Leave a field blank to hide that line.',
  portal_legal_editor_legal_name: 'Registered business name',
  portal_legal_editor_legal_name_hint: 'The name the business is registered under, if it differs from the display name.',
  portal_legal_editor_registration: 'Business registration number',
  portal_legal_editor_registration_hint: 'Ministry of Commerce or tax registration number, if you have one.',
}

const KM: Record<string, string> = {
  portal_legal_policies: 'គោលការណ៍',
  portal_legal_privacy_title: 'គោលការណ៍ឯកជនភាព',
  portal_legal_terms_title: 'លក្ខខណ្ឌប្រើប្រាស់',
  portal_legal_cookies_title: 'គោលការណ៍ខូឃី',
  portal_legal_last_updated: 'ធ្វើបច្ចុប្បន្នភាពចុងក្រោយ {date}',
  portal_legal_close: 'បិទ',
  portal_legal_open_policies: 'បើកបញ្ជីគោលការណ៍',
  portal_legal_template_notice: 'ឯកសារនេះជាគំរូដែលរៀបចំសម្រាប់ {name}។ ម្ចាស់អាជីវកម្មគួរឱ្យមេធាវីជំនាញពិនិត្យមុននឹងប្រើ។ វាមិនមែនជាការប្រឹក្សាផ្នែកច្បាប់ទេ។',
  portal_legal_identity_h: 'ព័ត៌មានអាជីវកម្ម',
  portal_legal_identity_legal_name: 'ឈ្មោះចុះបញ្ជី',
  portal_legal_identity_registration: 'លេខចុះបញ្ជី',
  portal_legal_identity_address: 'អាសយដ្ឋាន',
  portal_legal_identity_phone: 'ទូរស័ព្ទ',
  portal_legal_identity_email: 'អ៊ីមែល',
  portal_legal_footer_rights: '© {year} {name}។ រក្សាសិទ្ធិគ្រប់យ៉ាង។',
  portal_legal_footer_landmark: 'ព័ត៌មាននិងគោលការណ៍របស់គេហទំព័រ',

  portal_legal_privacy_who_h: 'យើងជានរណា',
  portal_legal_privacy_who_b: 'កាតាឡុកអនឡាញនេះដំណើរការដោយ {legalName} ("យើង")។ ព័ត៌មានអាជីវកម្មខាងលើគឺជាចំណុចទំនាក់ទំនងសម្រាប់រឿងទាំងអស់ក្នុងគោលការណ៍នេះ។',
  portal_legal_privacy_collect_h: 'អ្វីដែលយើងប្រមូល',
  portal_legal_privacy_collect_b: 'យើងប្រមូលតិចតួចបំផុតដោយចេតនា។ ការមើលកាតាឡុកមិនត្រូវការគណនី ឬព័ត៌មានផ្ទាល់ខ្លួនអ្វីទាំងអស់។',
  portal_legal_privacy_collect_list: 'បើអ្នកបង្កើតគណនី៖ ឈ្មោះ លេខទូរស័ព្ទ ពាក្យសម្ងាត់ក្នុងទម្រង់អ៊ិនគ្រីបមួយផ្លូវ (មិនមែនពាក្យសម្ងាត់ដើមទេ) និងលេខសមាជិក។ បើអ្នកប្រើបញ្ជី ឬបញ្ជីចង់បានពេលចូលគណនី៖ ផលិតផលដែលអ្នករក្សាទុក។ បើអ្នកផ្ញើរូបថតអេក្រង់ពីបណ្តាញសង្គមដើម្បីទទួលរង្វាន់៖ រូបភាពនិងកំណត់សម្គាល់របស់អ្នក។ ដោយស្វ័យប្រវត្តិ សម្រាប់សុវត្ថិភាព៖ អាសយដ្ឋាន IP ក្នុងកំណត់ត្រាការពារការចូលរយៈពេលខ្លី ប្រភេទកម្មវិធីរុករកសម្រាប់កំណត់ត្រាវគ្គ និងរបាយការណ៍កំហុសបច្ចេកទេស។',
  portal_legal_privacy_why_h: 'ហេតុអ្វីយើងប្រើវា',
  portal_legal_privacy_why_b: 'ឈ្មោះនិងលេខទូរស័ព្ទបញ្ជាក់សមាជិកភាពរបស់អ្នក និងឱ្យបុគ្គលិកទាក់ទងអ្នកអំពីការបញ្ជាទិញ ឬរង្វាន់។ បញ្ជីដែលរក្សាទុកតាមអ្នកពីឧបករណ៍មួយទៅមួយ។ កំណត់ត្រា IP និងវគ្គមានតែដើម្បីទប់ស្កាត់ការទាយពាក្យសម្ងាត់និងការរំលោភបំពាន។ របាយការណ៍កំហុសមានតែដើម្បីជួសជុលបញ្ហា។',
  portal_legal_privacy_basis_h: 'ការយល់ព្រមរបស់អ្នក',
  portal_legal_privacy_basis_b: 'ការបង្កើតគណនីជាជម្រើស ហើយអ្នកត្រូវយល់ព្រមនឹងគោលការណ៍នេះនិងលក្ខខណ្ឌប្រើប្រាស់មុនពេលបង្កើតគណនី។ អ្នកអាចដកការយល់ព្រមនោះវិញគ្រប់ពេល ដោយស្នើឱ្យយើងបិទគណនីរបស់អ្នក។ កំណត់ត្រាសុវត្ថិភាពត្រូវរក្សាទុក ព្រោះយើងត្រូវការវាដើម្បីដំណើរការគេហទំព័រដោយសុវត្ថិភាព។',
  portal_legal_privacy_retention_h: 'យើងរក្សាទុករយៈពេលប៉ុន្មាន',
  portal_legal_privacy_retention_b: 'កំណត់ត្រាកំណត់អត្រាត្រូវលុបក្នុងរយៈពេលប្រហែលមួយថ្ងៃ វគ្គចូលដែលផុតកំណត់ត្រូវលុបស្វ័យប្រវត្តិ ហើយកំណត់ហេតុជជែកជំនួយការត្រូវលុបក្រោយប្រហែល ៣០ ថ្ងៃ។ ព័ត៌មានគណនី សមាជិកភាព និងរូបថតអេក្រង់ត្រូវរក្សាទុកខណៈសមាជិកភាពរបស់អ្នកនៅសកម្ម។ ស្នើមកយើង នោះយើងនឹងលុបវា។',
  portal_legal_privacy_sharing_h: 'នរណាផ្សេងទៀតឃើញវា',
  portal_legal_privacy_sharing_b: 'យើងមិនលក់ទិន្នន័យរបស់អ្នក ហើយមិនប្រើឧបករណ៍តាមដានផ្សាយពាណិជ្ជកម្មទេ។',
  portal_legal_privacy_sharing_list: 'Cloudflare ជាអ្នកបង្ហោះគេហទំព័រ មូលដ្ឋានទិន្នន័យ និងរូបភាព ដូច្នេះទិន្នន័យឆ្លងកាត់និងរក្សាទុកលើហេដ្ឋារចនាសម្ព័ន្ធរបស់ពួកគេ។ របាយការណ៍កំហុសទៅកាន់អ្នកផ្តល់សេវាតាមដានកំហុសរបស់យើង។ បើជំនួយការត្រូវបានបើក សំណួរដែលអ្នកវាយត្រូវផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបី។ បើអ្នកជ្រើសភាសាបកប្រែខាងក្រៅ អត្ថបទទំព័រត្រូវផ្ញើទៅ Google Translate។ បើអ្នកជ្រើសផ្ទុកផែនទីហាង Google ទទួលសំណើនោះ។ តំណ Facebook, Instagram, Telegram, WhatsApp ឬ Messenger បើកកម្មវិធីទាំងនោះ ដែលអនុវត្តគោលការណ៍ផ្ទាល់ខ្លួន។',
  portal_legal_privacy_security_h: 'យើងការពារវាយ៉ាងណា',
  portal_legal_privacy_security_b: 'ពាក្យសម្ងាត់ត្រូវរក្សាទុកជាសញ្ញាសម្ងាត់មួយផ្លូវតែប៉ុណ្ណោះ។ ខូឃីចូលគណនីមិនអាចអានដោយស្គ្រីប កំណត់តែលើគេហទំព័រនេះ និងផ្ញើតាម HTTPS។ ការព្យាយាមចូលខុសច្រើនដងត្រូវទប់ស្កាត់។ គ្មានប្រព័ន្ធណាល្អឥតខ្ចោះទេ ដូច្នេះសូមប្រើពាក្យសម្ងាត់ដែលអ្នកមិនប្រើកន្លែងផ្សេង។',
  portal_legal_privacy_rights_h: 'ជម្រើសរបស់អ្នក',
  portal_legal_privacy_rights_b: 'អ្នកអាចស្នើច្បាប់ចម្លងនៃទិន្នន័យដែលយើងមានអំពីអ្នក ស្នើកែតម្រូវ ឬស្នើលុបគណនីនិងទិន្នន័យរបស់វា។ សូមទាក់ទងតាមព័ត៌មានអាជីវកម្មខាងលើ ហើយផ្តល់ពេលសមរម្យឱ្យយើងផ្ទៀងផ្ទាត់អត្តសញ្ញាណជាមុនសិន។',
  portal_legal_privacy_children_h: 'កុមារ',
  portal_legal_privacy_children_b: 'គេហទំព័រនេះសម្រាប់មនុស្សពេញវ័យ។ យើងមិនបង្កើតគណនីសម្រាប់កុមារអាយុក្រោម ១៦ ឆ្នាំដោយដឹងខ្លួនទេ។ បើអ្នកជឿថាកុមារបានផ្តល់ព័ត៌មានមកយើង សូមទាក់ទងមក យើងនឹងលុបវា។',
  portal_legal_privacy_changes_h: 'ការផ្លាស់ប្តូរ',
  portal_legal_privacy_changes_b: 'បើគោលការណ៍នេះផ្លាស់ប្តូរ យើងនឹងធ្វើបច្ចុប្បន្នភាពកាលបរិច្ឆេទនៅខាងលើទំព័រនេះ។ ការបន្តប្រើគេហទំព័រក្រោយការផ្លាស់ប្តូរ មានន័យថាអ្នកទទួលយកកំណែថ្មី។',

  portal_legal_terms_catalogue_h: 'នេះជាកាតាឡុកព័ត៌មាន',
  portal_legal_terms_catalogue_b: 'គេហទំព័រនេះបង្ហាញអ្វីដែល {name} មានស្តុក។ វាជាការអញ្ជើញឱ្យទាក់ទងមកយើង មិនមែនជាការផ្តល់ជូនចងកាតព្វកិច្ចទេ ហើយគ្មានអ្វីនៅទីនេះបង្កើតកិច្ចសន្យាលក់ដោយខ្លួនឯងឡើយ។',
  portal_legal_terms_prices_h: 'តម្លៃនិងស្តុក',
  portal_legal_terms_prices_b: 'តម្លៃ ការផ្តល់ជូនពិសេស និងស្ថានភាពស្តុកបង្ហាញជាព័ត៌មានណែនាំ ហើយអាចប្តូរដោយមិនជូនដំណឹង។ ស្តុកខុសគ្នាតាមសាខា និងអាចប្តូរខណៈអ្នកកំពុងមើល។ តម្លៃនិងស្តុកដែលបុគ្គលិកបញ្ជាក់ពេលទិញ គឺជាតម្លៃដែលអនុវត្ត។',
  portal_legal_terms_nopayment_h: 'គ្មានការទូទាត់លើគេហទំព័រនេះ',
  portal_legal_terms_nopayment_b: 'អ្នកមិនអាចបង់ប្រាក់នៅទីនេះទេ។ បញ្ជីដែលអ្នកបង្កើតគឺសម្រាប់បង្ហាញក្រុមការងារយើង។ ការទូទាត់ធ្វើនៅហាង ឬតាមបណ្តាញដែលអ្នកព្រមព្រៀងជាមួយបុគ្គលិក។ យើងនឹងមិនសុំព័ត៌មានកាត ឬធនាគារតាមគេហទំព័រនេះឡើយ។',
  portal_legal_terms_membership_h: 'សមាជិកភាពនិងពិន្ទុ',
  portal_legal_terms_membership_b: 'ពិន្ទុសមាជិកភាពត្រូវពិនិត្យនិងអនុវត្តដោយបុគ្គលិក ហើយការប្តូរយកប្រើតែឯកតាពេញប៉ុណ្ណោះ។ ពិន្ទុគ្មានតម្លៃជាសាច់ប្រាក់ មិនអាចផ្ទេរបាន ហើយយើងអាចកែសមតុល្យដែលផ្តល់ដោយកំហុស។',
  portal_legal_terms_account_h: 'គណនីរបស់អ្នក',
  portal_legal_terms_account_b: 'សូមផ្តល់ព័ត៌មានត្រឹមត្រូវ រក្សាពាក្យសម្ងាត់ជាការសម្ងាត់ និងប្រាប់យើងបើអ្នកគិតថាមាននរណាម្នាក់ប្រើគណនីរបស់អ្នក។ អ្នកទទួលខុសត្រូវលើអ្វីដែលធ្វើតាមរយៈវា។ យើងអាចផ្អាកគណនីដែលប្រើដោយរំលោភបំពាន។',
  portal_legal_terms_ai_h: 'ជំនួយការ',
  portal_legal_terms_ai_b: 'ជំនួយការបង្កើតដោយសេវា AI ភាគីទីបី អាចខុស ហើយសម្រាប់ការណែនាំទូទៅតែប៉ុណ្ណោះ។ វាមិនមែនជាការប្រឹក្សាវេជ្ជសាស្ត្រ ស្បែក ឬវិជ្ជាជីវៈទេ។ សូមកុំផ្ញើព័ត៌មានផ្ទាល់ខ្លួន សុខភាព ឬការទូទាត់ទៅវា ហើយពិនិត្យរឿងសំខាន់ជាមួយបុគ្គលិក។',
  portal_legal_terms_use_h: 'ការប្រើប្រាស់ត្រឹមត្រូវ',
  portal_legal_terms_use_b: 'សូមកុំព្យាយាមទម្លុះ ធ្វើឱ្យលើសបន្ទុក ទាញយកទិន្នន័យដោយស្វ័យប្រវត្តិ ឬរំខានគេហទំព័រនេះ ហើយកុំបញ្ចូលខ្លឹមសារខុសច្បាប់ បំភាន់ ឬរបស់អ្នកដទៃ។ រូបថតអេក្រង់ដែលអ្នកផ្ញើមកត្រូវជារបស់អ្នកផ្ទាល់។',
  portal_legal_terms_ip_h: 'ខ្លឹមសារនិងពាណិជ្ជសញ្ញា',
  portal_legal_terms_ip_b: 'ប្លង់ អត្ថបទ និងរូបថតលើគេហទំព័រនេះជាកម្មសិទ្ធិរបស់ {legalName} ឬអ្នកផ្គត់ផ្គង់របស់យើង ហើយឈ្មោះម៉ាកនិងរូបភាពផលិតផលនៅជាកម្មសិទ្ធិរបស់ម្ចាស់វា។ សូមកុំប្រើឡើងវិញក្នុងគោលបំណងពាណិជ្ជកម្មដោយគ្មានការអនុញ្ញាត។',
  portal_legal_terms_liability_h: 'ដែនកំណត់',
  portal_legal_terms_liability_b: 'យើងខិតខំរក្សាកាតាឡុកនេះឱ្យត្រឹមត្រូវនិងអាចប្រើបាន ប៉ុន្តែយើងមិនអាចធានាថាគ្មានកំហុស ឬមិនដាច់ដំណើរការទេ។ ក្នុងវិសាលភាពដែលច្បាប់អនុញ្ញាត យើងមិនទទួលខុសត្រូវលើការខាតបង់ដោយប្រយោលឡើយ។ គ្មានអ្វីនៅទីនេះកំណត់សិទ្ធិរបស់អ្នកក្រោមច្បាប់គាំពារអ្នកប្រើប្រាស់កម្ពុជាទេ។',
  portal_legal_terms_law_h: 'ច្បាប់អនុវត្ត',
  portal_legal_terms_law_b: 'លក្ខខណ្ឌទាំងនេះស្ថិតក្រោមច្បាប់នៃព្រះរាជាណាចក្រកម្ពុជា ហើយតុលាការកម្ពុជាមានយុត្តាធិការ។ បើអ្នកមានបណ្តឹង សូមទាក់ទងយើងជាមុនតាមព័ត៌មានអាជីវកម្មខាងលើ។',

  portal_legal_cookies_what_h: 'អ្វីដែលគេហទំព័រនេះរក្សាទុក',
  portal_legal_cookies_what_b: 'ខូឃីជាឯកសារតូចមួយដែលគេហទំព័ររក្សាទុកក្នុងកម្មវិធីរុករករបស់អ្នក។ ការផ្ទុកមូលដ្ឋានដំណើរការស្រដៀងគ្នា។ គេហទំព័រនេះប្រើតែអ្វីដែលចាំបាច់។ គ្មានខូឃីផ្សាយពាណិជ្ជកម្ម ឬវិភាគទេ។',
  portal_legal_cookies_consent_h: 'ហេតុអ្វីគ្មានផ្ទាំងសុំការយល់ព្រម',
  portal_legal_cookies_consent_b: 'អ្វីៗក្នុងតារាងខាងក្រោមគឺចាំបាច់យ៉ាងតឹងរឹងសម្រាប់ដំណើរការគេហទំព័រ ឬបង្កើតតែក្រោយពេលអ្នកស្នើអ្វីមួយ — ចូលគណនី រក្សាទុកផលិតផល ជ្រើសភាសា ឬរូបរាង។ ការផ្ទុកបែបនេះមិនតម្រូវឱ្យមានផ្ទាំងសុំការយល់ព្រមទេ។ មុខងារតែមួយគត់ដែលនឹងផ្ទុកភាគីទីបីដោយខ្លួនឯង គឺផែនទីហាង ហើយវាមិនផ្ទុកទេរហូតដល់អ្នកចុចផ្ទុកវា។',
  portal_legal_cookies_table_h: 'អ្វីដែលរក្សាទុកពិតប្រាកដ',
  portal_legal_cookies_table_b: 'នេះជាបញ្ជីពេញលេញ។',
  portal_legal_cookies_third_h: 'ភាគីទីបី',
  portal_legal_cookies_third_b: 'ការជ្រើសភាសាបកប្រែខាងក្រៅផ្ទុក Google Translate ហើយការផ្ទុកផែនទីហាងផ្ទុក Google Maps។ ទាំងពីរជាសេវារបស់ Google ហើយអាចកំណត់ខូឃីផ្ទាល់ខ្លួនក្រោយពេលផ្ទុក។ ការបើកតំណ Facebook, Instagram, Telegram, WhatsApp ឬ Messenger នាំអ្នកទៅកម្មវិធីនោះក្រោមគោលការណ៍របស់វា។ ជំនួយការផ្ញើសំណួររបស់អ្នកទៅអ្នកផ្តល់សេវា AI ភាគីទីបី។ គ្មានមួយណាដំណើរការមុនអ្នកជ្រើសវាទេ។',
  portal_legal_cookies_clear_h: 'របៀបលុបវា',
  portal_legal_cookies_clear_b: 'ចាកចេញពីគណនីដើម្បីបញ្ចប់ខូឃីវគ្គ ហើយសម្អាតទិន្នន័យគេហទំព័រនេះក្នុងការកំណត់កម្មវិធីរុករក ដើម្បីលុបអ្វីៗផ្សេងទៀត។ ការសម្អាតនឹងលុបបញ្ជី បញ្ជីចង់បាន ភាសា និងរូបរាងរបស់អ្នកលើឧបករណ៍នេះ។',

  portal_legal_col_name: 'ឈ្មោះ',
  portal_legal_col_kind: 'ប្រភេទ',
  portal_legal_col_purpose: 'គោលបំណង',
  portal_legal_col_lifetime: 'រក្សាទុករយៈពេល',
  portal_legal_kind_cookie: 'ខូឃី',
  portal_legal_kind_local: 'ការផ្ទុកមូលដ្ឋាន',
  portal_legal_kind_both: 'ការផ្ទុកមូលដ្ឋាននិងវគ្គ',
  portal_legal_store_session_p: 'រក្សាឱ្យអ្នកនៅក្នុងគណនី។ កំណត់តែពេលអ្នកចូល មិនអាចអានដោយស្គ្រីប និងកំណត់តែលើគេហទំព័រនេះ។',
  portal_legal_store_session_l: 'រហូតដល់អ្នកចាកចេញ ឬវាផុតកំណត់',
  portal_legal_store_googtrans_p: 'ចងចាំភាសាបកប្រែខាងក្រៅ។ សរសេរតែបើអ្នកជ្រើសភាសាទាំងនោះ។',
  portal_legal_store_googtrans_l: 'រហូតដល់អ្នកត្រឡប់ទៅភាសាដើម',
  portal_legal_store_bucket_p: 'បញ្ជីផលិតផលរបស់អ្នក ដើម្បីកុំបាត់ពេលផ្ទុកទំព័រឡើងវិញ។',
  portal_legal_store_wishlist_p: 'ផលិតផលដែលអ្នករក្សាទុក។',
  portal_legal_store_translate_p: 'ភាសាដែលអ្នកជ្រើសសម្រាប់គេហទំព័រនេះ។',
  portal_legal_store_cache_p: 'ច្បាប់ចម្លងនៃទំព័រកាតាឡុកចុងក្រោយ ដើម្បីបើកលឿននិងដំណើរការពេលអ៊ីនធឺណិតខ្សោយ។ មានតែផលិតផល គ្មានអ្វីអំពីអ្នកទេ។',
  portal_legal_store_cache_l: 'ប្រហែល ២០ នាទី',
  portal_legal_store_device_p: 'ជម្រើសរូបរាងភ្លឺ ឬងងឹតលើឧបករណ៍នេះ។',
  portal_legal_store_assets_p: 'កន្លែងដែលរូបភាពផលិតផលត្រូវផ្ទុកមក។',
  portal_legal_store_map_consent_p: 'ថាតើអ្នកបានជ្រើសរើសផ្ទុកផែនទីហាងលើឧបករណ៍នេះឬអត់។',
  portal_legal_store_until_cleared_l: 'រហូតដល់អ្នកសម្អាតទិន្នន័យគេហទំព័រ',

  portal_legal_consent_label: 'ខ្ញុំយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព។',
  portal_legal_consent_required: 'សូមយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព ដើម្បីបង្កើតគណនី។',
  portal_legal_consent_read_terms: 'អានលក្ខខណ្ឌប្រើប្រាស់',
  portal_legal_consent_read_privacy: 'អានគោលការណ៍ឯកជនភាព',
  portal_legal_map_consent_b: 'ផែនទីផ្ទុកពី Google Maps ដែលអាចកំណត់ខូឃីផ្ទាល់ខ្លួន។ សូមផ្ទុកតែបើអ្នកចង់។',
  portal_legal_map_consent_load: 'ផ្ទុកផែនទី',
  portal_legal_map_consent_link: 'បើកក្នុង Google Maps ជំនួសវិញ',

  portal_legal_editor_block: 'ព័ត៌មានច្បាប់និងអាជីវកម្ម',
  portal_legal_editor_hint: 'បង្ហាញក្នុងជើងទំព័រហាង និងបំពេញក្នុងទំព័រឯកជនភាព លក្ខខណ្ឌ និងខូឃី។ ទុកទទេដើម្បីលាក់បន្ទាត់នោះ។',
  portal_legal_editor_legal_name: 'ឈ្មោះអាជីវកម្មចុះបញ្ជី',
  portal_legal_editor_legal_name_hint: 'ឈ្មោះដែលអាជីវកម្មចុះបញ្ជី បើខុសពីឈ្មោះបង្ហាញ។',
  portal_legal_editor_registration: 'លេខចុះបញ្ជីអាជីវកម្ម',
  portal_legal_editor_registration_hint: 'លេខចុះបញ្ជីក្រសួងពាណិជ្ជកម្ម ឬពន្ធដារ បើមាន។',
}

export const PORTAL_LEGAL_EN: Readonly<Record<string, string>> = EN
export const PORTAL_LEGAL_KM: Readonly<Record<string, string>> = KM

/**
 * Resolve one legal string for the storefront's current language target.
 * `km` is a first-party pack; every other target falls back to English (the
 * external Google-Translate widget translates the rendered DOM for those).
 */
export function legalText(target: string, key: string): string {
  if (String(target || '') === 'km') return KM[key] ?? EN[key] ?? ''
  return EN[key] ?? ''
}

/**
 * Fill {placeholders} from the merchant's own business details. Unknown
 * placeholders are left untouched so a typo shows up rather than silently
 * vanishing; `legalName` falls back to the display name so the sentence
 * still reads correctly for a shop that has not filled the field in.
 */
export function interpolateLegal(text: string, details: LegalBusinessDetails, year: number): string {
  const values: Record<string, string> = {
    name: details.name,
    legalName: details.legalName || details.name,
    registration: details.registrationNumber,
    address: details.address,
    phone: details.phone,
    email: details.email,
    year: String(year),
    date: formatLegalLastUpdated(),
  }
  return text.replace(/\{(name|legalName|registration|address|phone|email|year|date)\}/g, (match, token: string) => {
    const value = values[token]
    return value ? value : match
  })
}
