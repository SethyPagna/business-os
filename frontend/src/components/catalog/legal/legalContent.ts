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
// `consent_version` at sign-up, so a later policy change is auditable. The
// Worker (lib/portalAccounts.ts) moves with it and lists which earlier
// versions still count, so a bump never signs customers out by itself.
export const PORTAL_LEGAL_LAST_UPDATED_ISO = '2026-09-30'
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
    { heading: 'portal_legal_privacy_scam_h', bodies: ['portal_legal_privacy_scam_b'] },
    { heading: 'portal_legal_privacy_rights_h', bodies: ['portal_legal_privacy_rights_b'] },
    { heading: 'portal_legal_privacy_children_h', bodies: ['portal_legal_privacy_children_b'] },
    { heading: 'portal_legal_privacy_changes_h', bodies: ['portal_legal_privacy_changes_b'] },
  ],
  terms: [
    { heading: 'portal_legal_terms_catalogue_h', bodies: ['portal_legal_terms_catalogue_b'] },
    { heading: 'portal_legal_terms_prices_h', bodies: ['portal_legal_terms_prices_b'] },
    { heading: 'portal_legal_terms_nopayment_h', bodies: ['portal_legal_terms_nopayment_b'] },
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
  // portalBucket.ts
  { id: 'bucket', name: 'business-os-portal-bucket-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_bucket_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  { id: 'wishlist', name: 'business-os-portal-wishlist-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_wishlist_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // portalLanguageOptions.ts
  { id: 'translate', name: 'business-os:portal-translate-target', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_translate_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // public-runtime/service-worker.ts -- app shell and same-origin static
  // assets. Cache names are versioned and old versions are pruned on update.
  { id: 'cache-storage', name: 'Business OS app-shell/static caches', kindKey: 'portal_legal_kind_cache', purposeKey: 'portal_legal_store_cache_storage_p', lifetimeKey: 'portal_legal_store_cache_storage_l' },
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
  portal_legal_updated_notice: 'We updated our privacy policy and terms on {date}.',
  portal_legal_close: 'Close',
  portal_legal_template_notice: 'This document is a template prepared for {name}. The business owner should have it reviewed by a qualified lawyer before relying on it. It is not legal advice.',
  portal_legal_identity_h: 'Business details',
  portal_legal_identity_legal_name: 'Registered name',
  portal_legal_identity_registration: 'Registration number',
  portal_legal_identity_address: 'Address',
  portal_legal_identity_phone: 'Phone',
  portal_legal_identity_email: 'Email',
  portal_legal_footer_rights: 'Site operated by {name}.',
  portal_legal_footer_content_concerns: 'If something on this site is about you, or you are concerned about an image, contact {email}. We will review the request and may ask for information needed to identify the content and the person making the request.',
  portal_legal_footer_landmark: 'Site information and policies',
  // P-public-9 footer column headings.
  portal_legal_footer_contact: 'Contact',
  portal_legal_footer_quick_links: 'Quick links',
  portal_legal_footer_follow: 'Follow us',

  // --- Privacy Policy ------------------------------------------------------
  portal_legal_privacy_who_h: 'Who we are',
  portal_legal_privacy_who_b: 'Welcome! This online catalogue is run by the shop in the verified business details above ("we", "us"), which is also where to reach us about your information.',
  portal_legal_privacy_collect_h: 'What we keep',
  portal_legal_privacy_collect_b: 'You can browse the whole catalogue as a guest, with no account and no personal details.',
  portal_legal_privacy_collect_list: 'If you create an account, we keep your name, phone number, membership ID, a one-way code made from your password (never the password itself), and which policy version you agreed to, when and in which language. If you save products while signed in, we keep that list. If you ask the assistant something, we keep the question and any preferences you share. We do not keep billing information and never ask for it. Short-lived security records use one-way codes instead of raw IP addresses or phone numbers, and brief error reports may go to Sentry.',
  portal_legal_privacy_why_h: 'Why we keep it',
  portal_legal_privacy_why_b: 'We keep your account details only so we know who is who and to keep your account safe. Security records only stop password guessing and misuse, and error reports only help us fix problems.',
  portal_legal_privacy_basis_h: 'Your agreement',
  portal_legal_privacy_basis_b: 'Creating an account is up to you, and we ask you to agree to this policy and the Terms & Conditions first. To change your mind, just ask us to close your account.',
  portal_legal_privacy_retention_h: 'How long we keep it',
  portal_legal_privacy_retention_b: 'Security records are removed after about a day. A sign-in lasts up to 399 days and can renew while you use it; signing out ends it at once. Assistant questions are removed after about thirty days. Pictures sent for review are removed about ninety days after review, or after about 180 days if never reviewed; a short note of the review may stay. Your account stays until you ask us to close it, unless a record must be kept for an operational or legal reason. Sentry keeps error reports for its own set period.',
  portal_legal_privacy_sharing_h: 'Who else sees it',
  portal_legal_privacy_sharing_b: 'This site has no advertising trackers, and we use your details only for what this policy describes.',
  portal_legal_privacy_sharing_list: 'Cloudflare hosts the site, its data, images and security records. Error reports go to Sentry, and Cloudinary may resize product photos. Assistant questions go to a third-party AI provider for the answer. Google receives the request if you choose to load the store map. Social media links open those apps, which follow their own policies.',
  portal_legal_privacy_security_h: 'How we protect it',
  portal_legal_privacy_security_b: 'Your password is stored only as a one-way code and needs at least six characters. The sign-in cookie cannot be read by scripts, stays on this site and travels over HTTPS, and repeated wrong attempts are slowed down. Please use a password you do not use anywhere else.',
  portal_legal_privacy_scam_h: 'Watch out for scams',
  portal_legal_privacy_scam_b: 'Payment details are never collected through this site, and we will never ask for them. Please never give your bank details, card numbers or passwords to anyone who asks, even someone who says they are from our shop. If that happens, it is a scam: do not reply, and let us know using the business details above.',
  portal_legal_privacy_rights_h: 'Your choices',
  portal_legal_privacy_rights_b: 'You can ask to see, correct or delete the information linked to your account using the verified business details above. We may first check that it is really you, and we will tell you if a record must be kept for an operational or legal reason.',
  portal_legal_privacy_children_h: 'Children',
  portal_legal_privacy_children_b: 'Accounts are for people who can agree to these policies themselves. If you think a child has given us information, please contact us and we will look into it.',
  portal_legal_privacy_changes_h: 'Changes',
  portal_legal_privacy_changes_b: 'If we change this policy, we update the date at the top. We record which version you agreed to and when; just browsing the site never counts as agreeing.',

  // --- Terms & Conditions --------------------------------------------------
  portal_legal_terms_catalogue_h: 'This is a catalogue',
  portal_legal_terms_catalogue_b: 'This site shows what {name} has in stock so you can browse and plan your visit. It is an invitation to get in touch, not a binding offer or a sales contract.',
  portal_legal_terms_prices_h: 'Prices and stock',
  portal_legal_terms_prices_b: 'Prices, offers and stock are a guide and can change without notice, and stock differs by branch. The price and stock our staff confirm when you buy are the ones that apply.',
  portal_legal_terms_nopayment_h: 'No payment on this site',
  portal_legal_terms_nopayment_b: 'You cannot pay on this site. Your list is a shortlist to show our team; you pay in person or in a way you agree with our staff. We keep no billing information, and payment details are never collected through this site. We will never ask for your bank details, card numbers or passwords, so anyone who does, even if they say they are us, is trying to scam you.',
  portal_legal_terms_account_h: 'Your account',
  portal_legal_terms_account_b: 'Create an account only if you can agree to these terms yourself. Give accurate details, keep your password private, and tell us if someone else may be using your account. We may pause an account that is misused.',
  portal_legal_terms_ai_h: 'The assistant',
  portal_legal_terms_ai_b: 'The assistant is run by a third-party AI service. It can be wrong and gives general guidance only, not medical, skin-care or professional advice. Please do not share personal, health or payment details with it, and check anything important with our staff.',
  portal_legal_terms_use_h: 'Fair use',
  portal_legal_terms_use_b: 'Please do not try to break into, overload, scrape or disrupt this site, or upload anything unlawful, misleading or belonging to someone else. Anything you send us must be yours or shared with permission.',
  portal_legal_terms_ip_h: 'Content and trademarks',
  portal_legal_terms_ip_b: 'Brand names, trademarks, product images and other material may belong to their respective rights holders. This page does not claim that the store owns or is licensed to reuse every item shown. Contact the store using the verified details above if you have a concern about specific content.',
  portal_legal_terms_liability_h: 'Limits',
  portal_legal_terms_liability_b: 'We work hard to keep this catalogue accurate and available, but cannot promise it is always error-free. As far as the law allows, we are not liable for indirect loss from using this site. Nothing here limits your rights under Cambodian consumer protection law.',
  portal_legal_terms_law_h: 'Governing law',
  portal_legal_terms_law_b: 'These terms follow the laws of the Kingdom of Cambodia, and the courts of Cambodia have jurisdiction. If anything goes wrong, please talk to us first; we are glad to help.',

  // --- Cookie Policy -------------------------------------------------------
  portal_legal_cookies_what_h: 'What this site stores',
  portal_legal_cookies_what_b: 'A cookie is a small file a site stores in your browser; local storage works the same way. This site uses only what it needs to work. There are no advertising or analytics cookies.',
  portal_legal_cookies_consent_h: 'Necessary and requested storage',
  portal_legal_cookies_consent_b: 'The application uses storage needed for core functions, and creates optional third-party storage only after you request the related feature. The store map stays blocked until you choose to load it. This description does not claim that one banner rule applies in every country or to every future feature.',
  portal_legal_cookies_table_h: 'Exactly what is stored',
  portal_legal_cookies_table_b: 'This table lists browser storage managed by the current storefront code. A third-party service may add its own storage after you choose to load that service.',
  portal_legal_cookies_third_h: 'Third parties',
  portal_legal_cookies_third_b: 'Loading the store map loads Google Maps, a Google service that may set its own cookies once loaded. Opening a Facebook, Instagram, Telegram, WhatsApp or Messenger link hands you to that app under its own policy. The assistant sends your question to a third-party AI provider. None of these run before you choose them.',
  portal_legal_cookies_clear_h: 'How to remove it',
  portal_legal_cookies_clear_b: 'Sign out to end the session cookie. Use the unload control beside the map to forget the saved map choice. Clear site data for this address in your browser settings to remove everything else; this removes your saved list, wishlist, language and theme on this device.',

  // --- storage table -------------------------------------------------------
  portal_legal_col_name: 'Name',
  portal_legal_col_kind: 'Type',
  portal_legal_col_purpose: 'Purpose',
  portal_legal_col_lifetime: 'Kept for',
  portal_legal_kind_cookie: 'Cookie',
  portal_legal_kind_local: 'Local storage',
  portal_legal_kind_both: 'Local and session storage',
  portal_legal_kind_cache: 'Cache Storage',
  portal_legal_store_session_p: 'Keeps you signed in. Set only when you sign in, cannot be read by scripts, and is limited to this site.',
  portal_legal_store_session_l: 'Up to about 13 months. It may renew after sustained account use; signing out deletes it.',
  portal_legal_store_bucket_p: 'Your list of products, so it survives a page reload.',
  portal_legal_store_wishlist_p: 'Your saved products.',
  portal_legal_store_translate_p: 'The language you chose for this site.',
  portal_legal_store_cache_p: 'A copy of the last catalogue page so the site opens quickly and works with a poor connection. Products only, nothing about you.',
  portal_legal_store_cache_l: 'About 20 minutes',
  portal_legal_store_cache_storage_p: 'Same-origin app-shell and static files used to load the storefront and support a poor connection. It does not contain account or submission records.',
  portal_legal_store_cache_storage_l: 'Until replaced by a newer cache version or you clear site data',
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
  portal_legal_map_consent_revoke: 'Unload map and forget this choice',

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
  portal_legal_updated_notice: 'យើងបានធ្វើបច្ចុប្បន្នភាពគោលការណ៍ឯកជនភាព និងលក្ខខណ្ឌប្រើប្រាស់ នៅ {date}។',
  portal_legal_close: 'បិទ',
  portal_legal_template_notice: 'ឯកសារនេះជាគំរូដែលរៀបចំសម្រាប់ {name}។ ម្ចាស់អាជីវកម្មគួរឱ្យមេធាវីជំនាញពិនិត្យមុននឹងប្រើ។ វាមិនមែនជាការប្រឹក្សាផ្នែកច្បាប់ទេ។',
  portal_legal_identity_h: 'ព័ត៌មានអាជីវកម្ម',
  portal_legal_identity_legal_name: 'ឈ្មោះចុះបញ្ជី',
  portal_legal_identity_registration: 'លេខចុះបញ្ជី',
  portal_legal_identity_address: 'អាសយដ្ឋាន',
  portal_legal_identity_phone: 'ទូរស័ព្ទ',
  portal_legal_identity_email: 'អ៊ីមែល',
  portal_legal_footer_rights: 'គេហទំព័រនេះដំណើរការដោយ {name}។',
  portal_legal_footer_content_concerns: 'បើមានខ្លឹមសារអំពីអ្នក ឬអ្នកបារម្ភអំពីរូបភាពណាមួយ សូមទាក់ទង {email}។ យើងនឹងពិនិត្យសំណើ ហើយអាចសុំព័ត៌មានដែលត្រូវការដើម្បីសម្គាល់ខ្លឹមសារ និងអ្នកដាក់សំណើ។',
  portal_legal_footer_landmark: 'ព័ត៌មាននិងគោលការណ៍របស់គេហទំព័រ',
  portal_legal_footer_contact: 'ទំនាក់ទំនង',
  portal_legal_footer_quick_links: 'តំណភ្ជាប់រហ័ស',
  portal_legal_footer_follow: 'តាមដានយើង',

  portal_legal_privacy_who_h: 'យើងជានរណា',
  portal_legal_privacy_who_b: 'សូមស្វាគមន៍! កាតាឡុកអនឡាញនេះដំណើរការដោយហាងក្នុងព័ត៌មានអាជីវកម្មដែលបានផ្ទៀងផ្ទាត់ខាងលើ ("យើង") ដែលក៏ជាកន្លែងសម្រាប់ទាក់ទងយើងអំពីព័ត៌មានរបស់អ្នកផងដែរ។',
  portal_legal_privacy_collect_h: 'អ្វីដែលយើងរក្សាទុក',
  portal_legal_privacy_collect_b: 'អ្នកអាចមើលកាតាឡុកទាំងមូលជាភ្ញៀវ ដោយមិនចាំបាច់មានគណនី ឬផ្តល់ព័ត៌មានផ្ទាល់ខ្លួនអ្វីឡើយ។',
  portal_legal_privacy_collect_list: 'បើអ្នកបង្កើតគណនី យើងរក្សាទុកឈ្មោះ លេខទូរស័ព្ទ លេខសមាជិក កូដមួយទិសដែលបង្កើតពីពាក្យសម្ងាត់របស់អ្នក (មិនមែនពាក្យសម្ងាត់ផ្ទាល់ទេ) និងកំណែគោលការណ៍ដែលអ្នកបានយល់ព្រម ពេលវេលា និងភាសា។ បើអ្នករក្សាទុកផលិតផលពេលចូលគណនី យើងរក្សាបញ្ជីនោះ។ បើអ្នកសួរជំនួយការ យើងរក្សាទុកសំណួរ និងចំណូលចិត្តដែលអ្នកចែករំលែក។ យើងមិនរក្សាទុកព័ត៌មានទូទាត់ប្រាក់ ហើយក៏មិនដែលសុំវាដែរ។ កំណត់ត្រាសុវត្ថិភាពរយៈពេលខ្លីប្រើកូដមួយទិស ជំនួសឱ្យ IP ឬលេខទូរស័ព្ទដើម ហើយរបាយការណ៍កំហុសខ្លីៗអាចផ្ញើទៅ Sentry។',
  portal_legal_privacy_why_h: 'ហេតុអ្វីយើងរក្សាទុក',
  portal_legal_privacy_why_b: 'យើងរក្សាព័ត៌មានគណនីរបស់អ្នក គ្រាន់តែដើម្បីដឹងថានរណាជានរណា និងរក្សាសុវត្ថិភាពគណនីរបស់អ្នកប៉ុណ្ណោះ។ កំណត់ត្រាសុវត្ថិភាពមានតែដើម្បីទប់ស្កាត់ការទាយពាក្យសម្ងាត់ និងការប្រើខុសគោលបំណង ហើយរបាយការណ៍កំហុសគ្រាន់តែជួយយើងជួសជុលបញ្ហា។',
  portal_legal_privacy_basis_h: 'ការយល់ព្រមរបស់អ្នក',
  portal_legal_privacy_basis_b: 'ការបង្កើតគណនីគឺអាស្រ័យលើអ្នក ហើយយើងសុំឱ្យអ្នកយល់ព្រមនឹងគោលការណ៍នេះ និងលក្ខខណ្ឌប្រើប្រាស់ជាមុនសិន។ បើប្តូរចិត្ត គ្រាន់តែស្នើឱ្យយើងបិទគណនីរបស់អ្នក។',
  portal_legal_privacy_retention_h: 'យើងរក្សាទុករយៈពេលប៉ុន្មាន',
  portal_legal_privacy_retention_b: 'កំណត់ត្រាសុវត្ថិភាពត្រូវបានលុបក្រោយប្រហែលមួយថ្ងៃ។ ការចូលគណនីនៅបានរហូតដល់ ៣៩៩ ថ្ងៃ ហើយអាចបន្តពេលអ្នកប្រើ; ការចាកចេញបញ្ចប់វាភ្លាមៗ។ សំណួរជំនួយការត្រូវបានលុបក្រោយប្រហែល ៣០ ថ្ងៃ។ រូបភាពដែលផ្ញើមកឱ្យពិនិត្យត្រូវបានលុបប្រហែល ៩០ ថ្ងៃក្រោយការពិនិត្យ ឬក្រោយប្រហែល ១៨០ ថ្ងៃ បើមិនបានពិនិត្យ; កំណត់ចំណាំខ្លីនៃការពិនិត្យអាចនៅសល់។ គណនីរបស់អ្នកនៅរហូតដល់អ្នកស្នើឱ្យបិទ លើកលែងតែកំណត់ត្រាត្រូវរក្សាទុកសម្រាប់មូលហេតុប្រតិបត្តិការ ឬច្បាប់។ Sentry រក្សារបាយការណ៍កំហុសតាមរយៈពេលដែលខ្លួនកំណត់។',
  portal_legal_privacy_sharing_h: 'នរណាផ្សេងទៀតឃើញវា',
  portal_legal_privacy_sharing_b: 'គេហទំព័រនេះគ្មានឧបករណ៍តាមដានសម្រាប់ការផ្សាយពាណិជ្ជកម្មទេ ហើយយើងប្រើព័ត៌មានរបស់អ្នកសម្រាប់តែអ្វីដែលគោលការណ៍នេះពណ៌នាប៉ុណ្ណោះ។',
  portal_legal_privacy_sharing_list: 'Cloudflare បង្ហោះគេហទំព័រ ទិន្នន័យ រូបភាព និងកំណត់ត្រាសុវត្ថិភាព។ របាយការណ៍កំហុសផ្ញើទៅ Sentry ហើយ Cloudinary អាចកែទំហំរូបភាពផលិតផល។ សំណួរជំនួយការផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបី ដើម្បីរៀបចំចម្លើយ។ Google ទទួលសំណើ បើអ្នកជ្រើសផ្ទុកផែនទីហាង។ តំណបណ្តាញសង្គមបើកកម្មវិធីទាំងនោះ ដែលអនុវត្តគោលការណ៍ផ្ទាល់ខ្លួន។',
  portal_legal_privacy_security_h: 'យើងការពារវាយ៉ាងណា',
  portal_legal_privacy_security_b: 'ពាក្យសម្ងាត់របស់អ្នករក្សាទុកតែជាកូដមួយទិស ហើយត្រូវមានយ៉ាងតិច ៦ តួអក្សរ។ ខូឃីចូលគណនីមិនអាចអានដោយស្គ្រីប នៅតែលើគេហទំព័រនេះ និងផ្ញើតាម HTTPS ហើយការសាកល្បងខុសច្រើនដងត្រូវបន្ថយល្បឿន។ សូមប្រើពាក្យសម្ងាត់ដែលអ្នកមិនប្រើនៅកន្លែងផ្សេង។',
  portal_legal_privacy_scam_h: 'ប្រយ័ត្នការបោកប្រាស់',
  portal_legal_privacy_scam_b: 'យើងមិនដែលប្រមូលព័ត៌មានទូទាត់ប្រាក់តាមគេហទំព័រនេះទេ ហើយនឹងមិនសុំវាឡើយ។ សូមកុំផ្តល់ព័ត៌មានគណនីធនាគារ លេខកាត ឬពាក្យសម្ងាត់របស់អ្នក ទៅនរណាម្នាក់ដែលសុំ ទោះបីគេអះអាងថាមកពីហាងយើងក៏ដោយ។ បើមានរឿងបែបនេះ វាជាការបោកប្រាស់៖ សូមកុំឆ្លើយតប ហើយប្រាប់យើងតាមព័ត៌មានអាជីវកម្មខាងលើ។',
  portal_legal_privacy_rights_h: 'ជម្រើសរបស់អ្នក',
  portal_legal_privacy_rights_b: 'អ្នកអាចស្នើមើល កែតម្រូវ ឬលុបព័ត៌មានដែលភ្ជាប់នឹងគណនីរបស់អ្នក តាមព័ត៌មានអាជីវកម្មដែលបានផ្ទៀងផ្ទាត់ខាងលើ។ យើងអាចពិនិត្យជាមុនថាពិតជាអ្នក ហើយនឹងប្រាប់អ្នក បើកំណត់ត្រាណាមួយត្រូវរក្សាទុកសម្រាប់មូលហេតុប្រតិបត្តិការ ឬច្បាប់។',
  portal_legal_privacy_children_h: 'កុមារ',
  portal_legal_privacy_children_b: 'គណនីមានសម្រាប់អ្នកដែលអាចយល់ព្រមនឹងគោលការណ៍ទាំងនេះដោយខ្លួនឯង។ បើអ្នកគិតថាកុមារបានផ្តល់ព័ត៌មានមកយើង សូមទាក់ទងយើង ហើយយើងនឹងពិនិត្យមើល។',
  portal_legal_privacy_changes_h: 'ការផ្លាស់ប្តូរ',
  portal_legal_privacy_changes_b: 'បើយើងផ្លាស់ប្តូរគោលការណ៍នេះ យើងនឹងធ្វើបច្ចុប្បន្នភាពកាលបរិច្ឆេទខាងលើ។ យើងកត់ត្រាកំណែដែលអ្នកបានយល់ព្រម និងពេលវេលា។ ការគ្រាន់តែមើលគេហទំព័រ មិនត្រូវបានចាត់ទុកជាការយល់ព្រមទេ។',

  portal_legal_terms_catalogue_h: 'នេះជាកាតាឡុក',
  portal_legal_terms_catalogue_b: 'គេហទំព័រនេះបង្ហាញអ្វីដែល {name} មានស្តុក ដើម្បីឱ្យអ្នករុករក និងរៀបចំការមកហាង។ វាជាការអញ្ជើញឱ្យទាក់ទងមកយើង មិនមែនជាការផ្តល់ជូនដែលចងកាតព្វកិច្ច ឬកិច្ចសន្យាលក់ទេ។',
  portal_legal_terms_prices_h: 'តម្លៃនិងស្តុក',
  portal_legal_terms_prices_b: 'តម្លៃ ការផ្តល់ជូនពិសេស និងស្តុក គ្រាន់តែជាការណែនាំ អាចប្តូរដោយមិនជូនដំណឹង ហើយស្តុកខុសគ្នាតាមសាខា។ តម្លៃនិងស្តុកដែលបុគ្គលិកបញ្ជាក់នៅពេលទិញ គឺជាអ្វីដែលអនុវត្ត។',
  portal_legal_terms_nopayment_h: 'គ្មានការទូទាត់លើគេហទំព័រនេះ',
  portal_legal_terms_nopayment_b: 'អ្នកមិនអាចបង់ប្រាក់នៅលើគេហទំព័រនេះទេ។ បញ្ជីរបស់អ្នកគឺសម្រាប់បង្ហាញក្រុមការងារយើង ហើយអ្នកបង់ប្រាក់នៅហាង ឬតាមវិធីដែលអ្នកព្រមព្រៀងជាមួយបុគ្គលិក។ យើងមិនរក្សាទុកព័ត៌មានទូទាត់ប្រាក់ ហើយមិនដែលប្រមូលវាតាមគេហទំព័រនេះទេ។ យើងនឹងមិនសុំព័ត៌មានគណនីធនាគារ លេខកាត ឬពាក្យសម្ងាត់របស់អ្នកឡើយ ដូច្នេះអ្នកណាដែលសុំ ទោះបីអះអាងថាជាយើងក៏ដោយ គឺកំពុងព្យាយាមបោកប្រាស់អ្នក។',
  portal_legal_terms_account_h: 'គណនីរបស់អ្នក',
  portal_legal_terms_account_b: 'សូមបង្កើតគណនីតែបើអ្នកអាចយល់ព្រមនឹងលក្ខខណ្ឌទាំងនេះដោយខ្លួនឯង។ សូមផ្តល់ព័ត៌មានត្រឹមត្រូវ រក្សាពាក្យសម្ងាត់ជាការសម្ងាត់ ហើយប្រាប់យើងបើអាចមាននរណាម្នាក់ផ្សេងប្រើគណនីរបស់អ្នក។ យើងអាចផ្អាកគណនីដែលត្រូវបានប្រើខុសគោលបំណង។',
  portal_legal_terms_ai_h: 'ជំនួយការ',
  portal_legal_terms_ai_b: 'ជំនួយការដំណើរការដោយសេវា AI ភាគីទីបី។ វាអាចខុស ហើយផ្តល់តែការណែនាំទូទៅ មិនមែនជាការប្រឹក្សាវេជ្ជសាស្ត្រ ការថែរក្សាស្បែក ឬវិជ្ជាជីវៈទេ។ សូមកុំចែករំលែកព័ត៌មានផ្ទាល់ខ្លួន សុខភាព ឬការទូទាត់ជាមួយវា ហើយពិនិត្យរឿងសំខាន់ៗជាមួយបុគ្គលិករបស់យើង។',
  portal_legal_terms_use_h: 'ការប្រើប្រាស់ត្រឹមត្រូវ',
  portal_legal_terms_use_b: 'សូមកុំព្យាយាមទម្លុះ ធ្វើឱ្យលើសបន្ទុក ទាញយកទិន្នន័យដោយស្វ័យប្រវត្តិ ឬរំខានគេហទំព័រនេះ ឬបញ្ចូលអ្វីដែលខុសច្បាប់ បំភាន់ ឬជារបស់អ្នកដទៃ។ អ្វីដែលអ្នកផ្ញើមកយើង ត្រូវជារបស់អ្នក ឬមានការអនុញ្ញាត។',
  portal_legal_terms_ip_h: 'ខ្លឹមសារនិងពាណិជ្ជសញ្ញា',
  portal_legal_terms_ip_b: 'ឈ្មោះម៉ាក ពាណិជ្ជសញ្ញា រូបភាពផលិតផល និងសម្ភារៈផ្សេងទៀត អាចជាកម្មសិទ្ធិរបស់ម្ចាស់សិទ្ធិរៀងៗខ្លួន។ ទំព័រនេះមិនអះអាងថាហាងជាម្ចាស់ ឬមានអាជ្ញាប័ណ្ណប្រើគ្រប់ធាតុដែលបង្ហាញទេ។ សូមទាក់ទងហាងតាមព័ត៌មានដែលបានផ្ទៀងផ្ទាត់ខាងលើ បើអ្នកមានបញ្ហាអំពីខ្លឹមសារជាក់លាក់។',
  portal_legal_terms_liability_h: 'ដែនកំណត់',
  portal_legal_terms_liability_b: 'យើងខិតខំរក្សាកាតាឡុកនេះឱ្យត្រឹមត្រូវ និងអាចប្រើបាន ប៉ុន្តែមិនអាចធានាថាវាគ្មានកំហុសជានិច្ចទេ។ ក្នុងវិសាលភាពដែលច្បាប់អនុញ្ញាត យើងមិនទទួលខុសត្រូវលើការខាតបង់ដោយប្រយោលពីការប្រើគេហទំព័រនេះឡើយ។ គ្មានអ្វីនៅទីនេះកំណត់សិទ្ធិរបស់អ្នកក្រោមច្បាប់គាំពារអ្នកប្រើប្រាស់កម្ពុជាទេ។',
  portal_legal_terms_law_h: 'ច្បាប់អនុវត្ត',
  portal_legal_terms_law_b: 'លក្ខខណ្ឌទាំងនេះស្ថិតក្រោមច្បាប់នៃព្រះរាជាណាចក្រកម្ពុជា ហើយតុលាការកម្ពុជាមានយុត្តាធិការ។ បើមានបញ្ហាអ្វី សូមនិយាយជាមួយយើងជាមុនសិន។ យើងរីករាយនឹងជួយអ្នក។',

  portal_legal_cookies_what_h: 'អ្វីដែលគេហទំព័រនេះរក្សាទុក',
  portal_legal_cookies_what_b: 'ខូឃីជាឯកសារតូចមួយដែលគេហទំព័ររក្សាទុកក្នុងកម្មវិធីរុករករបស់អ្នក។ ការផ្ទុកមូលដ្ឋានដំណើរការស្រដៀងគ្នា។ គេហទំព័រនេះប្រើតែអ្វីដែលចាំបាច់។ គ្មានខូឃីផ្សាយពាណិជ្ជកម្ម ឬវិភាគទេ។',
  portal_legal_cookies_consent_h: 'ការផ្ទុកចាំបាច់ និងតាមសំណើ',
  portal_legal_cookies_consent_b: 'កម្មវិធីប្រើការផ្ទុកដែលត្រូវការសម្រាប់មុខងារស្នូល ហើយបង្កើតការផ្ទុកភាគីទីបីស្រេចចិត្តតែបន្ទាប់ពីអ្នកស្នើមុខងារនោះ។ ផែនទីហាងត្រូវបានរារាំងរហូតដល់អ្នកជ្រើសផ្ទុក។ សេចក្ដីពិពណ៌នានេះមិនអះអាងថាច្បាប់ផ្ទាំងសុំការយល់ព្រមតែមួយ អនុវត្តនៅគ្រប់ប្រទេស ឬមុខងារនាពេលអនាគតទេ។',
  portal_legal_cookies_table_h: 'អ្វីដែលរក្សាទុកពិតប្រាកដ',
  portal_legal_cookies_table_b: 'តារាងនេះរាយការផ្ទុកក្នុងកម្មវិធីរុករក ដែលកូដទំព័រហាងបច្ចុប្បន្នគ្រប់គ្រង។ សេវាភាគីទីបីអាចបន្ថែមការផ្ទុកផ្ទាល់ខ្លួន បន្ទាប់ពីអ្នកជ្រើសផ្ទុកសេវានោះ។',
  portal_legal_cookies_third_h: 'ភាគីទីបី',
  portal_legal_cookies_third_b: 'ការផ្ទុកផែនទីហាងផ្ទុក Google Maps ដែលជាសេវា Google ហើយអាចកំណត់ខូឃីផ្ទាល់ខ្លួនបន្ទាប់ពីផ្ទុក។ ការបើកតំណ Facebook, Instagram, Telegram, WhatsApp ឬ Messenger នាំអ្នកទៅកម្មវិធីនោះក្រោមគោលការណ៍ផ្ទាល់របស់វា។ ជំនួយការផ្ញើសំណួររបស់អ្នកទៅអ្នកផ្តល់សេវា AI ភាគីទីបី។ គ្មានមួយណាដំណើរការមុនអ្នកជ្រើសរើសទេ។',
  portal_legal_cookies_clear_h: 'របៀបលុបវា',
  portal_legal_cookies_clear_b: 'ចាកចេញពីគណនីដើម្បីបញ្ចប់ខូឃីវគ្គ។ ប្រើប៊ូតុងបិទនៅក្បែរផែនទី ដើម្បីលុបជម្រើសផែនទីដែលបានរក្សាទុក។ សម្អាតទិន្នន័យគេហទំព័រនេះក្នុងការកំណត់កម្មវិធីរុករក ដើម្បីលុបអ្វីៗផ្សេងទៀត រួមទាំងបញ្ជី បញ្ជីចង់បាន ភាសា និងរូបរាងរបស់អ្នកលើឧបករណ៍នេះ។',

  portal_legal_col_name: 'ឈ្មោះ',
  portal_legal_col_kind: 'ប្រភេទ',
  portal_legal_col_purpose: 'គោលបំណង',
  portal_legal_col_lifetime: 'រក្សាទុករយៈពេល',
  portal_legal_kind_cookie: 'ខូឃី',
  portal_legal_kind_local: 'ការផ្ទុកមូលដ្ឋាន',
  portal_legal_kind_both: 'ការផ្ទុកមូលដ្ឋាននិងវគ្គ',
  portal_legal_kind_cache: 'ឃ្លាំងសម្ងាត់ Cache Storage',
  portal_legal_store_session_p: 'រក្សាឱ្យអ្នកនៅក្នុងគណនី។ កំណត់តែពេលអ្នកចូល មិនអាចអានដោយស្គ្រីប និងកំណត់តែលើគេហទំព័រនេះ។',
  portal_legal_store_session_l: 'រហូតដល់ប្រហែល ១៣ ខែ។ វាអាចបន្តបន្ទាប់ពីការប្រើគណនីជាបន្តបន្ទាប់ ហើយការចាកចេញនឹងលុបវា។',
  portal_legal_store_bucket_p: 'បញ្ជីផលិតផលរបស់អ្នក ដើម្បីកុំបាត់ពេលផ្ទុកទំព័រឡើងវិញ។',
  portal_legal_store_wishlist_p: 'ផលិតផលដែលអ្នករក្សាទុក។',
  portal_legal_store_translate_p: 'ភាសាដែលអ្នកជ្រើសសម្រាប់គេហទំព័រនេះ។',
  portal_legal_store_cache_p: 'ច្បាប់ចម្លងនៃទំព័រកាតាឡុកចុងក្រោយ ដើម្បីបើកលឿននិងដំណើរការពេលអ៊ីនធឺណិតខ្សោយ។ មានតែផលិតផល គ្មានអ្វីអំពីអ្នកទេ។',
  portal_legal_store_cache_l: 'ប្រហែល ២០ នាទី',
  portal_legal_store_cache_storage_p: 'ឯកសារស្នូលកម្មវិធី និងឯកសារថេរដែលមកពីគេហទំព័រដូចគ្នា សម្រាប់ផ្ទុកទំព័រហាង និងគាំទ្រអ៊ីនធឺណិតខ្សោយ។ វាមិនមានកំណត់ត្រាគណនី ឬការផ្ញើទេ។',
  portal_legal_store_cache_storage_l: 'រហូតដល់ជំនួសដោយកំណែឃ្លាំងសម្ងាត់ថ្មី ឬអ្នកសម្អាតទិន្នន័យគេហទំព័រ',
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
  portal_legal_map_consent_revoke: 'បិទផែនទី និងលុបជម្រើសនេះពីឧបករណ៍',

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
 * Resolve one legal string for the storefront's current language: Khmer for
 * `km`, English for anything else.
 */
export function legalText(target: string, key: string): string {
  if (String(target || '') === 'km') return KM[key] ?? EN[key] ?? ''
  return EN[key] ?? ''
}

/**
 * Fill {placeholders} from the merchant's own business details. Unknown
 * placeholders are left untouched so a typo shows up rather than silently
 * vanishing. A display/trade name is never substituted for a registered name.
 */
export function interpolateLegal(text: string, details: LegalBusinessDetails, year: number): string {
  const values: Record<string, string> = {
    name: details.name,
    legalName: details.legalName,
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
