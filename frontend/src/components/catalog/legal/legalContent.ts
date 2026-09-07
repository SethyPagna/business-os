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
  portal_legal_close: 'Close',
  portal_legal_open_policies: 'Open policies menu',
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

  // --- Privacy Policy ------------------------------------------------------
  portal_legal_privacy_who_h: 'Who we are',
  portal_legal_privacy_who_b: 'This online catalogue is operated by the seller identified in the verified business details above ("we", "us"). Those details are the contact point for anything in this policy.',
  portal_legal_privacy_collect_h: 'What we collect',
  portal_legal_privacy_collect_b: 'We keep the collection deliberately small. Browsing the catalogue needs no account and no personal details at all.',
  portal_legal_privacy_collect_list: 'If you create an account: your name, phone number, a one-way password verifier (never the password itself), the membership identifier assigned to the account, and the policy version, time and language you accepted. If you use the list or wishlist while signed in: the products you saved. If you ask the assistant after confirming its notice: the question and any shopping preferences you choose. If you send social-media screenshots after confirming both consent statements: the images, platform, optional note, review status and consent record. For abuse prevention, the application stores keyed one-way identifiers derived from request or phone data instead of raw IP addresses or phone numbers in rate-limit and sign-in-protection records. Minimized technical error details may be sent to Sentry when something breaks.',
  portal_legal_privacy_why_h: 'Why we use it',
  portal_legal_privacy_why_b: 'Your name and phone number identify your membership and let our staff reach you about an order or a reward. Your saved list follows you between devices. IP and session records exist only to stop password guessing and abuse of the public forms. Error reports exist only to fix faults.',
  portal_legal_privacy_basis_h: 'Your consent',
  portal_legal_privacy_basis_b: 'Creating an account is optional, and you are asked to agree to this policy and the Terms & Conditions before the account is created. You can withdraw that agreement at any time by asking us to close your account. Security records are kept because we need them to run the site safely.',
  portal_legal_privacy_retention_h: 'How long we keep it',
  portal_legal_privacy_retention_b: 'Application rate-limit and inactive sign-in-protection records are removed after about a day. A signed-in session can last up to 399 days and may renew while it is actively used; signing out revokes it, and expired or revoked server records are removed. Assistant logs are removed after about thirty days. Submitted images are removed about ninety days after staff review; an unreviewed submission and its images are removed after about one hundred and eighty days. The reviewed submission row may remain as part of the points record after its images are removed. Account and membership records remain until the business resolves a verified request or must keep them for an operational or legal reason. Sentry applies its configured error-event retention.',
  portal_legal_privacy_sharing_h: 'Who else sees it',
  portal_legal_privacy_sharing_b: 'The current storefront does not include advertising trackers. Account and submission data is used only for the purposes described in this notice unless this notice and the required consent are updated first.',
  portal_legal_privacy_sharing_list: 'Cloudflare hosts this site, its database, its images and its security logs, so your data passes through and is stored on their infrastructure. Application error reports go to Sentry. Product photographs may be optimised by Cloudinary; screenshots you send us are not. If the assistant is switched on, the question you type is sent to a third-party AI provider to produce an answer. If you choose an external translation language, your page text is sent to Google Translate. If you choose to load the store map, Google receives that request. Links to Facebook, Instagram, Telegram, WhatsApp or Messenger open those apps, which then apply their own policies.',
  portal_legal_privacy_security_h: 'How we protect it',
  portal_legal_privacy_security_b: 'Passwords are stored only as a one-way verifier and must be at least six characters. The sign-in cookie cannot be read by scripts, is limited to this site and is sent over HTTPS. Repeated failed attempts are slowed down. Screenshots you send us use private object keys and authenticated staff access. No system is perfect, so please use a password you do not reuse elsewhere.',
  portal_legal_privacy_rights_h: 'Your choices',
  portal_legal_privacy_rights_b: 'You may request access to, correction of, or deletion of information linked to your account. Contact us using the verified business details above. We may first ask for information needed to confirm your identity, and we will explain if a record must be retained for an operational or legal reason.',
  portal_legal_privacy_children_h: 'Children',
  portal_legal_privacy_children_b: 'Accounts and optional submissions are intended for people who can give valid consent. If you are a parent or guardian and believe a child supplied information through this site, contact us so the business can investigate and respond.',
  portal_legal_privacy_changes_h: 'Changes',
  portal_legal_privacy_changes_b: 'If this policy changes we will update the date at the top. A current policy version and acceptance time are recorded when consent is requested; simply continuing to browse is not treated as acceptance.',

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
  portal_legal_terms_account_b: 'Create an account only if you can give valid consent. Give accurate details, keep your password to yourself, and tell us if you think someone else is using your account. We may suspend an account that is used abusively.',
  portal_legal_terms_ai_h: 'The assistant',
  portal_legal_terms_ai_b: 'The assistant is generated by a third-party AI service, may be wrong, and is for general guidance only. It is not medical, dermatological or professional advice. Do not send it personal, health or payment information, and check anything important with our staff.',
  portal_legal_terms_use_h: 'Acceptable use',
  portal_legal_terms_use_b: 'Please do not attempt to break into, overload, scrape or disrupt this site, and do not upload unlawful, misleading or someone else\'s content. Screenshots you send us must be your own.',
  portal_legal_terms_ip_h: 'Content and trademarks',
  portal_legal_terms_ip_b: 'Brand names, trademarks, product images and other material may belong to their respective rights holders. This page does not claim that the store owns or is licensed to reuse every item shown. Contact the store using the verified details above if you have a concern about specific content.',
  portal_legal_terms_liability_h: 'Limits',
  portal_legal_terms_liability_b: 'We take care to keep this catalogue accurate and available, but we cannot promise it is error-free or never interrupted. To the extent the law allows, we are not liable for indirect or consequential loss arising from use of this site. Nothing here limits any right you have under Cambodian consumer protection law.',
  portal_legal_terms_law_h: 'Governing law',
  portal_legal_terms_law_b: 'These terms are governed by the laws of the Kingdom of Cambodia, and the courts of Cambodia have jurisdiction. If you have a complaint, contact us first using the business details above.',

  // --- Cookie Policy -------------------------------------------------------
  portal_legal_cookies_what_h: 'What this site stores',
  portal_legal_cookies_what_b: 'A cookie is a small file a site stores in your browser; local storage works the same way. This site uses only what it needs to work. There are no advertising or analytics cookies.',
  portal_legal_cookies_consent_h: 'Necessary and requested storage',
  portal_legal_cookies_consent_b: 'The application uses storage needed for core functions, and creates optional third-party storage only after you request the related feature. The store map stays blocked until you choose to load it; choosing an external translation language loads Google Translate. This description does not claim that one banner rule applies in every country or to every future feature.',
  portal_legal_cookies_table_h: 'Exactly what is stored',
  portal_legal_cookies_table_b: 'This table lists browser storage managed by the current storefront code. A third-party service may add its own storage after you choose to load that service.',
  portal_legal_cookies_third_h: 'Third parties',
  portal_legal_cookies_third_b: 'Choosing an external translation language loads Google Translate, which receives the page text and writes a googtrans cookie for this site; loading the store map loads Google Maps. Both are Google services and may set their own cookies once loaded. Opening a Facebook, Instagram, Telegram, WhatsApp or Messenger link hands you to that app under its own policy. The assistant sends your question to a third-party AI provider. None of these run before you choose them.',
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
  portal_legal_store_googtrans_p: 'Remembers the external translation language. Written only if you choose one of those languages.',
  portal_legal_store_googtrans_l: 'Until you return to the original language',
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
  portal_legal_close: 'បិទ',
  portal_legal_open_policies: 'បើកបញ្ជីគោលការណ៍',
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

  portal_legal_privacy_who_h: 'យើងជានរណា',
  portal_legal_privacy_who_b: 'កាតាឡុកអនឡាញនេះដំណើរការដោយអ្នកលក់ដែលមានអត្តសញ្ញាណក្នុងព័ត៌មានអាជីវកម្មដែលបានផ្ទៀងផ្ទាត់ខាងលើ ("យើង")។ ព័ត៌មាននោះជាចំណុចទំនាក់ទំនងសម្រាប់រឿងទាំងអស់ក្នុងគោលការណ៍នេះ។',
  portal_legal_privacy_collect_h: 'អ្វីដែលយើងប្រមូល',
  portal_legal_privacy_collect_b: 'យើងប្រមូលតិចតួចបំផុតដោយចេតនា។ ការមើលកាតាឡុកមិនត្រូវការគណនី ឬព័ត៌មានផ្ទាល់ខ្លួនអ្វីទាំងអស់។',
  portal_legal_privacy_collect_list: 'បើអ្នកបង្កើតគណនី៖ ឈ្មោះ លេខទូរស័ព្ទ ទិន្នន័យផ្ទៀងផ្ទាត់ពាក្យសម្ងាត់មួយទិស (មិនមែនពាក្យសម្ងាត់ដើមទេ) លេខសម្គាល់សមាជិក និងកំណែ ពេលវេលា និងភាសានៃគោលការណ៍ដែលអ្នកបានយល់ព្រម។ បើអ្នកប្រើបញ្ជីទិញ ឬបញ្ជីចង់បានពេលចូលគណនី៖ ផលិតផលដែលអ្នករក្សាទុក។ បើអ្នកសួរជំនួយការក្រោយបញ្ជាក់ការជូនដំណឹង៖ សំណួរ និងចំណូលចិត្តទិញទំនិញដែលអ្នកជ្រើស។ បើអ្នកផ្ញើរូបថតអេក្រង់បណ្តាញសង្គមក្រោយបញ្ជាក់ការយល់ព្រមទាំងពីរ៖ រូបភាព បណ្ដាញ កំណត់ចំណាំស្រេចចិត្ត ស្ថានភាពពិនិត្យ និងកំណត់ត្រាយល់ព្រម។ សម្រាប់ទប់ស្កាត់ការរំលោភបំពាន កម្មវិធីរក្សាលេខសម្គាល់មួយទិសដែលបង្កើតដោយសោសម្ងាត់ពីទិន្នន័យសំណើ ឬទូរស័ព្ទ ជំនួសឱ្យ IP ឬលេខទូរស័ព្ទដើមក្នុងកំណត់ត្រាកំណត់សំណើ និងការពារការចូល។ ព័ត៌មានកំហុសបច្ចេកទេសដែលបានកាត់បន្ថយអាចផ្ញើទៅ Sentry ពេលមានបញ្ហា។',
  portal_legal_privacy_why_h: 'ហេតុអ្វីយើងប្រើវា',
  portal_legal_privacy_why_b: 'ឈ្មោះនិងលេខទូរស័ព្ទបញ្ជាក់សមាជិកភាពរបស់អ្នក និងឱ្យបុគ្គលិកទាក់ទងអ្នកអំពីការបញ្ជាទិញ ឬរង្វាន់។ បញ្ជីដែលរក្សាទុកតាមអ្នកពីឧបករណ៍មួយទៅមួយ។ កំណត់ត្រា IP និងវគ្គមានតែដើម្បីទប់ស្កាត់ការទាយពាក្យសម្ងាត់និងការរំលោភបំពាន។ របាយការណ៍កំហុសមានតែដើម្បីជួសជុលបញ្ហា។',
  portal_legal_privacy_basis_h: 'ការយល់ព្រមរបស់អ្នក',
  portal_legal_privacy_basis_b: 'ការបង្កើតគណនីជាជម្រើស ហើយអ្នកត្រូវយល់ព្រមនឹងគោលការណ៍នេះនិងលក្ខខណ្ឌប្រើប្រាស់មុនពេលបង្កើតគណនី។ អ្នកអាចដកការយល់ព្រមនោះវិញគ្រប់ពេល ដោយស្នើឱ្យយើងបិទគណនីរបស់អ្នក។ កំណត់ត្រាសុវត្ថិភាពត្រូវរក្សាទុក ព្រោះយើងត្រូវការវាដើម្បីដំណើរការគេហទំព័រដោយសុវត្ថិភាព។',
  portal_legal_privacy_retention_h: 'យើងរក្សាទុករយៈពេលប៉ុន្មាន',
  portal_legal_privacy_retention_b: 'កំណត់ត្រាកំណត់សំណើ និងការពារការចូលដែលអសកម្ម ត្រូវបានដកចេញក្រោយប្រហែលមួយថ្ងៃ។ វគ្គចូលគណនីអាចមានរហូតដល់ ៣៩៩ថ្ងៃ និងអាចបន្តពេលប្រើសកម្ម; ការចាកចេញនឹងលុបសិទ្ធិវគ្គ ហើយកំណត់ត្រាវគ្គផុតកំណត់ ឬត្រូវបានដកសិទ្ធិនឹងត្រូវដកចេញ។ កំណត់ត្រាជំនួយការ ត្រូវបានដកចេញក្រោយប្រហែល៣០ថ្ងៃ។ រូបភាពដែលបានផ្ញើ ត្រូវបានដកចេញប្រហែល៩០ថ្ងៃក្រោយបុគ្គលិកពិនិត្យ; សំណើមិនបានពិនិត្យ និងរូបភាព ត្រូវបានដកចេញក្រោយប្រហែល១៨០ថ្ងៃ។ ជួរកំណត់ត្រាសំណើដែលបានពិនិត្យអាចនៅសល់ជាកំណត់ត្រាពិន្ទុ បន្ទាប់ពីរូបភាពត្រូវបានដកចេញ។ កំណត់ត្រាគណនី និងសមាជិកភាពនៅសល់រហូតដល់អាជីវកម្មដោះស្រាយសំណើដែលបានផ្ទៀងផ្ទាត់ ឬត្រូវរក្សាទុកសម្រាប់មូលហេតុប្រតិបត្តិការ ឬច្បាប់។ Sentry អនុវត្តរយៈពេលរក្សាទុកកំហុសដែលបានកំណត់។',
  portal_legal_privacy_sharing_h: 'នរណាផ្សេងទៀតឃើញវា',
  portal_legal_privacy_sharing_b: 'ហាងអនឡាញបច្ចុប្បន្នមិនមានឧបករណ៍តាមដានសម្រាប់ការផ្សាយពាណិជ្ជកម្មទេ។ ទិន្នន័យគណនី និងការដាក់ស្នើ ត្រូវបានប្រើសម្រាប់តែគោលបំណងដែលពណ៌នាក្នុងសេចក្ដីជូនដំណឹងនេះ លុះត្រាតែសេចក្ដីជូនដំណឹង និងការយល់ព្រមដែលត្រូវការ ត្រូវបានធ្វើបច្ចុប្បន្នភាពជាមុន។',
  portal_legal_privacy_sharing_list: 'Cloudflare បង្ហោះគេហទំព័រនេះ មូលដ្ឋានទិន្នន័យ រូបភាព និងកំណត់ត្រាសុវត្ថិភាព ដូច្នេះទិន្នន័យរបស់អ្នកឆ្លងកាត់ និងរក្សាទុកនៅលើហេដ្ឋារចនាសម្ព័ន្ធរបស់ពួកគេ។ របាយការណ៍កំហុសកម្មវិធីផ្ញើទៅ Sentry។ រូបភាពផលិតផលអាចកែលម្អដោយ Cloudinary ប៉ុន្តែរូបថតអេក្រង់ដែលអ្នកផ្ញើមកមិនផ្ញើទៅទេ។ បើជំនួយការត្រូវបានបើក សំណួរដែលអ្នកវាយបញ្ចូលផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបីដើម្បីបង្កើតចម្លើយ។ បើអ្នកជ្រើសភាសាបកប្រែខាងក្រៅ អត្ថបទទំព័រផ្ញើទៅ Google Translate។ បើអ្នកជ្រើសផ្ទុកផែនទីហាង Google ទទួលសំណើនោះ។ តំណទៅ Facebook, Instagram, Telegram, WhatsApp ឬ Messenger បើកកម្មវិធីទាំងនោះ ដែលអនុវត្តគោលការណ៍ផ្ទាល់របស់ខ្លួន។',
  portal_legal_privacy_security_h: 'យើងការពារវាយ៉ាងណា',
  portal_legal_privacy_security_b: 'ពាក្យសម្ងាត់រក្សាទុកតែជាទិន្នន័យផ្ទៀងផ្ទាត់មួយទិស និងត្រូវមានយ៉ាងតិច៦តួអក្សរ។ ខូឃីចូលគណនីមិនអាចអានដោយស្គ្រីប កំណត់តែសម្រាប់គេហទំព័រនេះ និងផ្ញើតាម HTTPS។ ការសាកល្បងចូលខុសច្រើនដងត្រូវបន្ថយល្បឿន។ រូបថតអេក្រង់ដែលអ្នកផ្ញើមក ប្រើសោឯកជន និងតម្រូវឱ្យបុគ្គលិកចូលគណនី។ គ្មានប្រព័ន្ធណាល្អឥតខ្ចោះ ដូច្នេះសូមប្រើពាក្យសម្ងាត់ដែលអ្នកមិនប្រើនៅកន្លែងផ្សេង។',
  portal_legal_privacy_rights_h: 'ជម្រើសរបស់អ្នក',
  portal_legal_privacy_rights_b: 'អ្នកអាចស្នើមើល កែតម្រូវ ឬលុបព័ត៌មានដែលភ្ជាប់នឹងគណនីរបស់អ្នក។ សូមទាក់ទងតាមព័ត៌មានអាជីវកម្មដែលបានផ្ទៀងផ្ទាត់ខាងលើ។ យើងអាចសុំព័ត៌មានដើម្បីបញ្ជាក់អត្តសញ្ញាណជាមុន ហើយនឹងពន្យល់បើកំណត់ត្រាណាមួយត្រូវរក្សាទុកសម្រាប់មូលហេតុប្រតិបត្តិការ ឬច្បាប់។',
  portal_legal_privacy_children_h: 'កុមារ',
  portal_legal_privacy_children_b: 'គណនី និងការផ្ញើស្រេចចិត្ត មានសម្រាប់មនុស្សដែលអាចផ្តល់ការយល់ព្រមត្រឹមត្រូវ។ បើអ្នកជាឪពុកម្តាយ ឬអាណាព្យាបាល ហើយជឿថាកុមារបានផ្តល់ព័ត៌មានតាមគេហទំព័រនេះ សូមទាក់ទងដើម្បីឱ្យអាជីវកម្មស៊ើបអង្កេត និងឆ្លើយតប។',
  portal_legal_privacy_changes_h: 'ការផ្លាស់ប្តូរ',
  portal_legal_privacy_changes_b: 'បើគោលការណ៍នេះផ្លាស់ប្តូរ យើងនឹងធ្វើបច្ចុប្បន្នភាពកាលបរិច្ឆេទខាងលើ។ កំណែគោលការណ៍ និងពេលវេលាយល់ព្រមបច្ចុប្បន្ន ត្រូវបានកត់ត្រាពេលស្នើការយល់ព្រម; ការបន្តមើលគេហទំព័រ មិនត្រូវបានចាត់ទុកជាការយល់ព្រមទេ។',

  portal_legal_terms_catalogue_h: 'នេះជាកាតាឡុកព័ត៌មាន',
  portal_legal_terms_catalogue_b: 'គេហទំព័រនេះបង្ហាញអ្វីដែល {name} មានស្តុក។ វាជាការអញ្ជើញឱ្យទាក់ទងមកយើង មិនមែនជាការផ្តល់ជូនចងកាតព្វកិច្ចទេ ហើយគ្មានអ្វីនៅទីនេះបង្កើតកិច្ចសន្យាលក់ដោយខ្លួនឯងឡើយ។',
  portal_legal_terms_prices_h: 'តម្លៃនិងស្តុក',
  portal_legal_terms_prices_b: 'តម្លៃ ការផ្តល់ជូនពិសេស និងស្ថានភាពស្តុកបង្ហាញជាព័ត៌មានណែនាំ ហើយអាចប្តូរដោយមិនជូនដំណឹង។ ស្តុកខុសគ្នាតាមសាខា និងអាចប្តូរខណៈអ្នកកំពុងមើល។ តម្លៃនិងស្តុកដែលបុគ្គលិកបញ្ជាក់ពេលទិញ គឺជាតម្លៃដែលអនុវត្ត។',
  portal_legal_terms_nopayment_h: 'គ្មានការទូទាត់លើគេហទំព័រនេះ',
  portal_legal_terms_nopayment_b: 'អ្នកមិនអាចបង់ប្រាក់នៅទីនេះទេ។ បញ្ជីដែលអ្នកបង្កើតគឺសម្រាប់បង្ហាញក្រុមការងារយើង។ ការទូទាត់ធ្វើនៅហាង ឬតាមបណ្តាញដែលអ្នកព្រមព្រៀងជាមួយបុគ្គលិក។ យើងនឹងមិនសុំព័ត៌មានកាត ឬធនាគារតាមគេហទំព័រនេះឡើយ។',
  portal_legal_terms_membership_h: 'សមាជិកភាពនិងពិន្ទុ',
  portal_legal_terms_membership_b: 'ពិន្ទុសមាជិកភាពត្រូវពិនិត្យនិងអនុវត្តដោយបុគ្គលិក ហើយការប្តូរយកប្រើតែឯកតាពេញប៉ុណ្ណោះ។ ពិន្ទុគ្មានតម្លៃជាសាច់ប្រាក់ មិនអាចផ្ទេរបាន ហើយយើងអាចកែសមតុល្យដែលផ្តល់ដោយកំហុស។',
  portal_legal_terms_account_h: 'គណនីរបស់អ្នក',
  portal_legal_terms_account_b: 'សូមបង្កើតគណនីតែបើអ្នកអាចផ្តល់ការយល់ព្រមត្រឹមត្រូវ។ សូមផ្តល់ព័ត៌មានត្រឹមត្រូវ រក្សាពាក្យសម្ងាត់ជាឯកជន ហើយប្រាប់យើងបើអ្នកគិតថាមាននរណាម្នាក់ប្រើគណនីរបស់អ្នក។ យើងអាចផ្អាកគណនីដែលប្រើដោយរំលោភបំពាន។',
  portal_legal_terms_ai_h: 'ជំនួយការ',
  portal_legal_terms_ai_b: 'ជំនួយការបង្កើតដោយសេវា AI ភាគីទីបី អាចខុស ហើយសម្រាប់ការណែនាំទូទៅតែប៉ុណ្ណោះ។ វាមិនមែនជាការប្រឹក្សាវេជ្ជសាស្ត្រ ស្បែក ឬវិជ្ជាជីវៈទេ។ សូមកុំផ្ញើព័ត៌មានផ្ទាល់ខ្លួន សុខភាព ឬការទូទាត់ទៅវា ហើយពិនិត្យរឿងសំខាន់ជាមួយបុគ្គលិក។',
  portal_legal_terms_use_h: 'ការប្រើប្រាស់ត្រឹមត្រូវ',
  portal_legal_terms_use_b: 'សូមកុំព្យាយាមទម្លុះ ធ្វើឱ្យលើសបន្ទុក ទាញយកទិន្នន័យដោយស្វ័យប្រវត្តិ ឬរំខានគេហទំព័រនេះ ហើយកុំបញ្ចូលខ្លឹមសារខុសច្បាប់ បំភាន់ ឬរបស់អ្នកដទៃ។ រូបថតអេក្រង់ដែលអ្នកផ្ញើមកត្រូវជារបស់អ្នកផ្ទាល់។',
  portal_legal_terms_ip_h: 'ខ្លឹមសារនិងពាណិជ្ជសញ្ញា',
  portal_legal_terms_ip_b: 'ឈ្មោះម៉ាក ពាណិជ្ជសញ្ញា រូបភាពផលិតផល និងសម្ភារៈផ្សេងទៀត អាចជាកម្មសិទ្ធិរបស់ម្ចាស់សិទ្ធិរៀងៗខ្លួន។ ទំព័រនេះមិនអះអាងថាហាងជាម្ចាស់ ឬមានអាជ្ញាប័ណ្ណប្រើគ្រប់ធាតុដែលបង្ហាញទេ។ សូមទាក់ទងហាងតាមព័ត៌មានដែលបានផ្ទៀងផ្ទាត់ខាងលើ បើអ្នកមានបញ្ហាអំពីខ្លឹមសារជាក់លាក់។',
  portal_legal_terms_liability_h: 'ដែនកំណត់',
  portal_legal_terms_liability_b: 'យើងខិតខំរក្សាកាតាឡុកនេះឱ្យត្រឹមត្រូវនិងអាចប្រើបាន ប៉ុន្តែយើងមិនអាចធានាថាគ្មានកំហុស ឬមិនដាច់ដំណើរការទេ។ ក្នុងវិសាលភាពដែលច្បាប់អនុញ្ញាត យើងមិនទទួលខុសត្រូវលើការខាតបង់ដោយប្រយោលឡើយ។ គ្មានអ្វីនៅទីនេះកំណត់សិទ្ធិរបស់អ្នកក្រោមច្បាប់គាំពារអ្នកប្រើប្រាស់កម្ពុជាទេ។',
  portal_legal_terms_law_h: 'ច្បាប់អនុវត្ត',
  portal_legal_terms_law_b: 'លក្ខខណ្ឌទាំងនេះស្ថិតក្រោមច្បាប់នៃព្រះរាជាណាចក្រកម្ពុជា ហើយតុលាការកម្ពុជាមានយុត្តាធិការ។ បើអ្នកមានបណ្តឹង សូមទាក់ទងយើងជាមុនតាមព័ត៌មានអាជីវកម្មខាងលើ។',

  portal_legal_cookies_what_h: 'អ្វីដែលគេហទំព័រនេះរក្សាទុក',
  portal_legal_cookies_what_b: 'ខូឃីជាឯកសារតូចមួយដែលគេហទំព័ររក្សាទុកក្នុងកម្មវិធីរុករករបស់អ្នក។ ការផ្ទុកមូលដ្ឋានដំណើរការស្រដៀងគ្នា។ គេហទំព័រនេះប្រើតែអ្វីដែលចាំបាច់។ គ្មានខូឃីផ្សាយពាណិជ្ជកម្ម ឬវិភាគទេ។',
  portal_legal_cookies_consent_h: 'ការផ្ទុកចាំបាច់ និងតាមសំណើ',
  portal_legal_cookies_consent_b: 'កម្មវិធីប្រើការផ្ទុកដែលត្រូវការសម្រាប់មុខងារស្នូល ហើយបង្កើតការផ្ទុកភាគីទីបីស្រេចចិត្តតែបន្ទាប់ពីអ្នកស្នើមុខងារនោះ។ ផែនទីហាងត្រូវបានរារាំងរហូតដល់អ្នកជ្រើសផ្ទុក; ការជ្រើសភាសាបកប្រែខាងក្រៅនឹងផ្ទុក Google Translate។ សេចក្ដីពិពណ៌នានេះមិនអះអាងថាច្បាប់ផ្ទាំងសុំការយល់ព្រមតែមួយ អនុវត្តនៅគ្រប់ប្រទេស ឬមុខងារនាពេលអនាគតទេ។',
  portal_legal_cookies_table_h: 'អ្វីដែលរក្សាទុកពិតប្រាកដ',
  portal_legal_cookies_table_b: 'តារាងនេះរាយការផ្ទុកក្នុងកម្មវិធីរុករក ដែលកូដទំព័រហាងបច្ចុប្បន្នគ្រប់គ្រង។ សេវាភាគីទីបីអាចបន្ថែមការផ្ទុកផ្ទាល់ខ្លួន បន្ទាប់ពីអ្នកជ្រើសផ្ទុកសេវានោះ។',
  portal_legal_cookies_third_h: 'ភាគីទីបី',
  portal_legal_cookies_third_b: 'ការជ្រើសភាសាបកប្រែខាងក្រៅផ្ទុក Google Translate ដែលទទួលអត្ថបទទំព័រ និងសរសេរខូឃី googtrans សម្រាប់គេហទំព័រនេះ ហើយការផ្ទុកផែនទីហាងផ្ទុក Google Maps។ ទាំងពីរជាសេវា Google ហើយអាចកំណត់ខូឃីផ្ទាល់ខ្លួនបន្ទាប់ពីផ្ទុក។ ការបើកតំណ Facebook, Instagram, Telegram, WhatsApp ឬ Messenger នាំអ្នកទៅកម្មវិធីនោះក្រោមគោលការណ៍ផ្ទាល់របស់វា។ ជំនួយការផ្ញើសំណួររបស់អ្នកទៅអ្នកផ្តល់សេវា AI ភាគីទីបី។ គ្មានមួយណាដំណើរការមុនអ្នកជ្រើសរើសទេ។',
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
  portal_legal_store_googtrans_p: 'ចងចាំភាសាបកប្រែខាងក្រៅ។ សរសេរតែបើអ្នកជ្រើសភាសាទាំងនោះ។',
  portal_legal_store_googtrans_l: 'រហូតដល់អ្នកត្រឡប់ទៅភាសាដើម',
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
