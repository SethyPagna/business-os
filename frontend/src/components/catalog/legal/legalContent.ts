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

// PORTAL_LEGAL_LAST_UPDATED_ISO is the date the policy pages show; it moves with every wording change.
// PORTAL_LEGAL_CONSENT_VERSION moves only when a change asks something new of an account: the Worker accepts
// only this version, so moving it makes every account agree again. Wording that asks nothing new moves the
// date alone (owner, 30 Sep 2026: existing accounts stay valid and the site says the policy was updated).
// Bump the version (and the pack copies of the section text) whenever the wording
// changes materially. It is also the value stored on a portal account as
// `consent_version`, so a later policy change is auditable. The Worker
// (lib/portalAccounts.ts) moves with it and accepts only this version: since
// 20 Oct 2026 (age-16 wording) every earlier account agrees again through the
// re-consent prompt (ConsentRenewalPrompt).
export const PORTAL_LEGAL_LAST_UPDATED_ISO = '2026-11-25'
export const PORTAL_LEGAL_CONSENT_VERSION = 'portal-legal-2026-10-20'

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
    { heading: 'portal_legal_privacy_translate_h', bodies: ['portal_legal_privacy_translate_b'] },
    { heading: 'portal_legal_privacy_ai_h', bodies: ['portal_legal_privacy_ai_b'] },
    { heading: 'portal_legal_privacy_security_h', bodies: ['portal_legal_privacy_security_b'] },
    { heading: 'portal_legal_privacy_scam_h', bodies: ['portal_legal_privacy_scam_b'] },
    { heading: 'portal_legal_privacy_rights_h', bodies: ['portal_legal_privacy_rights_b'] },
    { heading: 'portal_legal_privacy_children_h', bodies: ['portal_legal_privacy_children_b'] },
    { heading: 'portal_legal_privacy_changes_h', bodies: ['portal_legal_privacy_changes_b'] },
  ],
  terms: [
    { heading: 'portal_legal_terms_catalogue_h', bodies: ['portal_legal_terms_catalogue_b'] },
    { heading: 'portal_legal_terms_prices_h', bodies: ['portal_legal_terms_prices_b'] },
    { heading: 'portal_legal_terms_returns_h', bodies: ['portal_legal_terms_returns_b'] },
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
  // portalSignedInMarker.ts -- a time stamp, no personal data: tells every tab on this browser that someone signed in. Removed on sign-out.
  { id: 'signed-in', name: 'business-os:portal-signed-in', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_signedin_p', lifetimeKey: 'portal_legal_store_signedin_l' },
  // public-runtime/service-worker.ts -- app shell and same-origin static
  // assets. Cache names are versioned and old versions are pruned on update.
  { id: 'cache-storage', name: 'Business OS app-shell/static caches', kindKey: 'portal_legal_kind_cache', purposeKey: 'portal_legal_store_cache_storage_p', lifetimeKey: 'portal_legal_store_cache_storage_l' },
  // Set by this site (the translate controller) and by Google's script when the visitor picks one of the four. This site clears it on Khmer, English or a pause.
  { id: 'googtrans', name: 'googtrans', kindKey: 'portal_legal_kind_cookie', purposeKey: 'portal_legal_store_googtrans_p', lifetimeKey: 'portal_legal_store_googtrans_l' },
  // portalLanguageOptions.ts -- a one-shot flag written only when the account panel is open as translation is switched off; deleted when read.
  { id: 'reopen-account', name: 'business-os:portal-reopen-account', kindKey: 'portal_legal_kind_session', purposeKey: 'portal_legal_store_reopen_p', lifetimeKey: 'portal_legal_store_reopen_l' },
  // AppContext device settings -- theme + language choice.
  { id: 'device', name: 'businessos_device_settings', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_device_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // catalogAssetUrls.ts -- image host override.
  { id: 'assets', name: 'businessos_public_asset_base_url', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_assets_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // portalAnnouncement.ts -- written only when the visitor closes the announcement bar, so it stays closed until the shop changes the message.
  { id: 'announcement', name: 'business-os-portal-announcement-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_announcement_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // legal/aiProviderDisclosure.ts AI_CONSENT_STORAGE_KEY -- written when the visitor agrees to send questions to the assistant, removed when they withdraw.
  { id: 'ai-consent', name: 'business-os-portal-ai-consent-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_ai_consent_p', lifetimeKey: 'portal_legal_store_ai_consent_l' },
  // portalListImages.ts -- the picture paths of products added to the list in this browser.
  { id: 'list-images', name: 'business-os-portal-list-images-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_list_images_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
  // catalogPagination.tsx -- the page size the visitor picked.
  { id: 'page-size', name: 'business-os-portal-page-size-v1', kindKey: 'portal_legal_kind_local', purposeKey: 'portal_legal_store_page_size_p', lifetimeKey: 'portal_legal_store_until_cleared_l' },
]

const EN: Record<string, string> = {
  // --- shared chrome -------------------------------------------------------
  portal_legal_policies: 'Policies',
  portal_legal_privacy_title: 'Privacy Policy',
  portal_legal_terms_title: 'Terms & Conditions',
  portal_legal_cookies_title: 'Cookie Policy',
  portal_legal_last_updated: 'Last updated {date}',
  portal_legal_updated_notice: 'We updated our privacy policy and terms on {date}.',
  portal_legal_official_notice: 'English and Khmer are the official text. The Simplified Chinese, Traditional Chinese, French and Spanish versions are machine translations by Google. If a translation differs, the English or Khmer text applies.',
  portal_legal_close: 'Close',
  portal_legal_template_notice: 'This document is a template prepared for {name}. The business owner should have it reviewed by a qualified lawyer before relying on it. It is not legal advice.',
  portal_legal_identity_h: 'Business details',
  portal_legal_identity_legal_name: 'Registered name',
  portal_legal_identity_registration: 'Registration number',
  portal_legal_identity_address: 'Shop address',
  portal_legal_identity_phone: 'Phone',
  portal_legal_identity_email: 'Email',
  portal_legal_footer_rights: 'Site operated by {name}.',
  portal_legal_footer_independent: 'Leang Cosmetics is an independent beauty retailer in Cambodia.',
  portal_legal_business_fallback: 'This business',
  portal_legal_footer_content_concerns: 'If something on this site is about you, or you are concerned about an image, contact {email}. We review every request and ask only for the information needed to identify the content and the person making the request.',
  portal_legal_footer_landmark: 'Site information and policies',
  // P-public-9 footer column headings.
  portal_legal_footer_contact: 'Contact',
  portal_legal_footer_quick_links: 'Quick links',
  portal_legal_footer_notices: 'Open-source notices',

  // --- Privacy Policy ------------------------------------------------------
  portal_legal_privacy_who_h: 'Who we are',
  portal_legal_privacy_who_b: 'This online catalogue is run by the shop named in the verified business details above ("we", "us").',
  portal_legal_privacy_collect_h: 'The data we keep',
  portal_legal_privacy_collect_b: 'You can browse the whole catalogue as a guest, with no account and no personal details.',
  portal_legal_privacy_collect_list: 'If you create an account, we keep your name, phone number, membership ID, and a one-way hash made from your password (the password itself is never stored). We also keep which version of our Privacy Policy and Terms you agreed to, when you agreed, and in which language. If you save products while signed in, we keep that list. If you ask the AI assistant a question, we keep the question and any preferences you share with the assistant. If you send us pictures for review (when that option is on), we keep them together with the platform name you give, your note and your consent. We do not keep billing information and never ask for it. Short-lived security records use one-way codes instead of raw IP addresses or phone numbers. Brief error reports go to Sentry.',
  portal_legal_privacy_why_h: 'Why we keep it',
  portal_legal_privacy_why_b: 'We keep your account details only to know who is who and to keep your account safe. We use security records only to stop password guessing and other misuse of this site. We use error reports only to fix problems.',
  portal_legal_privacy_basis_h: 'Your consent',
  portal_legal_privacy_basis_b: 'Creating an account is your choice. Before you create one, we ask you to agree to this policy and the Terms & Conditions. To change your mind, ask us to close your account.',
  portal_legal_privacy_retention_h: 'How long we keep it',
  portal_legal_privacy_retention_b: 'We delete security records after 1 day. You stay signed in for up to 399 days. If you use the site while signed in after the first 200 days, your sign-in starts again with a full 399 days. Signing out ends your sign-in at once. We delete the questions you ask the AI assistant after 30 days. We delete pictures sent for review 90 days after the review. If no one reviews them, we delete them 180 days after you send them. We keep a short record of each picture review. We keep your account until you ask us to close it. Sentry keeps error reports for a period that Sentry sets.',
  portal_legal_privacy_sharing_h: 'Who else receives your data',
  portal_legal_privacy_sharing_b: 'This site has no advertising trackers, and we use your details only for what this policy describes.',
  portal_legal_privacy_sharing_list: 'Cloudflare hosts the site, its data, images and security records. Error reports go to Sentry, and Cloudinary resizes some product photos. Google receives a request when you open the About page, because the store map loads there. Social media links open those apps, which follow their own policies.',
  portal_legal_privacy_translate_h: 'Translation',
  portal_legal_privacy_translate_b: 'The Simplified Chinese, Traditional Chinese, French and Spanish versions of this site are machine translations. Google Translate makes them in your browser when you pick one of these languages. The page text is then sent to Google. If you stay on Khmer or English, nothing is sent to Google. Translation is paused while you are signed in or while the account panel is open.',
  portal_legal_privacy_ai_h: 'The assistant',
  portal_legal_privacy_ai_b: 'The questions you ask the AI assistant go to a third-party AI provider and are processed outside Cambodia. We delete our own copy after 30 days.',
  portal_legal_privacy_ai_off: 'The assistant is off and no AI provider receives any data from this site.',
  portal_legal_privacy_ai_named: 'The questions you ask the AI assistant go to {providers} and are processed outside Cambodia. We delete our own copy after 30 days.',
  portal_legal_ai_provider_terms: '{provider} terms',
  portal_legal_privacy_security_h: 'How we protect it',
  portal_legal_privacy_security_b: 'We never store your password itself, only a one-way hash made from it that cannot be turned back into the password. Your password needs at least 10 characters. The sign-in cookie cannot be read by scripts, stays on this site and travels over HTTPS. After repeated wrong attempts, you must wait longer before each new sign-in attempt. Use a password that you do not use anywhere else.',
  portal_legal_privacy_scam_h: 'Watch out for scams',
  portal_legal_privacy_scam_b: 'Payment details are never collected through this site, and we will never ask for them. Never give your bank details, card numbers or passwords to anyone who asks, even someone who says they are from our shop. Anyone who asks for them is a scammer. Do not reply, and tell us using the business details above.',
  portal_legal_privacy_rights_h: 'Your rights',
  portal_legal_privacy_rights_b: 'To see, correct or delete the information linked to your account, contact us using the verified business details above. We first check that it is really you. If we must keep a record for an operational or legal reason, we tell you.',
  portal_legal_privacy_children_h: 'Minimum age',
  portal_legal_privacy_children_b: 'You must be 16 or older to have an account. You must be legally able to agree to these policies yourself. If you think someone under 16 has given us information, contact us and we will look into it.',
  portal_legal_privacy_changes_h: 'Changes to this policy',
  portal_legal_privacy_changes_b: 'If we change this policy, we update the date at the top. Just browsing the site never counts as agreeing.',

  // --- Terms & Conditions --------------------------------------------------
  portal_legal_terms_catalogue_h: 'This is a catalogue',
  portal_legal_terms_catalogue_b: 'This site shows what {name} has in stock so you can browse and plan your visit. It is an invitation to get in touch, not a binding offer or a sales contract.',
  portal_legal_terms_prices_h: 'Prices and stock',
  portal_legal_terms_prices_b: 'Prices, offers and stock are a guide and can change without notice. Each branch has its own stock. The price and stock our staff confirm when you buy are the ones that apply.',
  portal_legal_terms_returns_h: 'Return policy',
  portal_legal_terms_returns_b: 'You can return an unopened item within 7 days. Bring the receipt.',
  portal_legal_terms_nopayment_h: 'You cannot pay on this site',
  portal_legal_terms_nopayment_b: 'You cannot pay on this site. Your list is a shortlist to show our team; you pay in person or in a way you agree with our staff. We keep no billing information, and payment details are never collected through this site. We will never ask for your bank details, card numbers or passwords, so anyone who does, even if they say they are us, is trying to scam you.',
  portal_legal_terms_account_h: 'Your account',
  portal_legal_terms_account_b: 'Create an account only if you are 16 or older. You must be legally able to agree to these terms yourself. Give accurate details and keep your password private. Tell us if you think someone else is using your account. We pause any account that is misused.',
  portal_legal_terms_ai_h: 'The assistant',
  portal_legal_terms_ai_b: 'The assistant is run by a third-party AI service. It can be wrong and gives general guidance only, not medical, skin-care or professional advice. Please do not share personal, health or payment details with it, and check anything important with our staff.',
  portal_legal_terms_use_h: 'Rules for using this site',
  portal_legal_terms_use_b: 'Do not break into this site, overload it, collect its data with automated tools, or stop it from working normally. Do not send us or post anything unlawful, misleading or owned by someone else. Anything you send us must be yours, or you must have the owner\'s permission to share it.',
  portal_legal_terms_ip_h: 'Content and trademarks',
  portal_legal_terms_ip_b: 'Brand names, trademarks, and any pictures or text the shop did not create belong to their owners. This page does not claim that the shop owns, or has a licence to reuse, every picture or text shown here. If you have a concern about specific content, contact the shop using the verified details above.',
  portal_legal_terms_liability_h: 'Limits of our liability',
  portal_legal_terms_liability_b: 'We cannot promise that this catalogue is error-free or always available. As far as the law allows, we are not liable for indirect loss from using this site. Nothing in these terms limits your rights under Cambodian consumer protection law.',
  portal_legal_terms_law_h: 'Governing law',
  portal_legal_terms_law_b: 'These terms follow the laws of the Kingdom of Cambodia, and the courts of Cambodia have jurisdiction. Please contact us first if there is a problem.',

  // --- Cookie Policy -------------------------------------------------------
  portal_legal_cookies_what_h: 'What this site stores',
  portal_legal_cookies_what_b: 'A cookie is a small file that a site stores in your browser. Local storage works the same way. This site stores only what it needs to work. There are no advertising or analytics cookies.',
  portal_legal_cookies_consent_h: 'Necessary and third-party storage',
  portal_legal_cookies_consent_b: 'The store map on the About page comes from Google Maps. It loads when you open About, and Google sets its own cookies then. Apart from the map, third-party storage is created only after you turn on the feature that uses it.',
  portal_legal_cookies_table_h: 'Full list of what this site stores',
  portal_legal_cookies_table_b: 'This table lists the browser storage that this storefront\'s code manages. Third-party services add their own storage. See Third-party services.',
  portal_legal_cookies_third_h: 'Third-party services',
  portal_legal_cookies_third_b: 'Opening the About page loads Google Maps, a Google service that sets its own cookies. Picking Simplified Chinese, Traditional Chinese, French or Spanish loads Google Translate. This site and the Google translation script set the googtrans cookie to remember that choice. This site deletes that cookie when you go back to Khmer or English, or when translation is paused. Opening a Facebook, Instagram, Telegram, WhatsApp or Messenger link takes you to that app, under its own policy. The assistant sends your question to a third-party AI provider. Apart from the map, none of these run before you choose them.',
  portal_legal_cookies_clear_h: 'How to remove it',
  portal_legal_cookies_clear_b: 'Sign out to end the session cookie. To remove everything else this site stores, clear site data for this address in your browser settings. This removes your saved list, wishlist, language and theme on this device.',

  // --- storage table -------------------------------------------------------
  portal_legal_col_name: 'Storage name',
  portal_legal_col_kind: 'Storage type',
  portal_legal_col_purpose: 'Purpose',
  portal_legal_col_lifetime: 'How long it is kept',
  portal_legal_kind_cookie: 'Cookie',
  portal_legal_kind_local: 'Local storage',
  portal_legal_kind_both: 'Local and session storage',
  portal_legal_kind_cache: 'Cache Storage',
  portal_legal_kind_session: 'Session storage',
  portal_legal_store_session_p: 'Keeps you signed in. Set only when you sign in, cannot be read by scripts, and is limited to this site.',
  portal_legal_store_session_l: 'Up to 399 days. If you use your account after the first 200 days, this cookie is renewed for 399 days from that day. Signing out deletes this cookie, not your account.',
  portal_legal_store_bucket_p: 'Your list of products, so it survives a page reload.',
  portal_legal_store_wishlist_p: 'Your saved products.',
  portal_legal_store_translate_p: 'The language you chose for this site.',
  portal_legal_store_cache_storage_p: 'Same-origin app-shell and static files used to load the storefront and support a poor connection. It does not contain account or submission records.',
  portal_legal_store_cache_storage_l: 'Until replaced by a newer cache version or you clear site data',
  portal_legal_store_device_p: 'Stores your light or dark theme choice for this device.',
  portal_legal_store_assets_p: 'Where product images are loaded from.',
  portal_legal_store_announcement_p: 'Remembers which shop announcement you closed on this device, so that it stays closed until the shop changes it.',
  portal_legal_store_googtrans_p: 'Set by this site and by Google\'s translation script when you pick Simplified Chinese, Traditional Chinese, French or Spanish, to remember that choice. This site clears it when you go back to Khmer or English, or when translation is paused.',
  portal_legal_store_googtrans_l: 'Deleted when you switch to Khmer or English, when translation is paused, or when you clear site data',
  portal_legal_store_ai_consent_p: 'Stores whether you agreed to send questions to the AI assistant. It is kept on this device only.',
  portal_legal_store_ai_consent_l: 'Until you withdraw consent or clear site data',
  portal_legal_store_list_images_p: 'Pictures for the products in your list, on this device.',
  portal_legal_store_page_size_p: 'Stores how many products you show on each page.',
  portal_legal_store_until_cleared_l: 'Until you clear site data',
  portal_legal_store_reopen_p: 'This site uses it to reopen the account panel once after translation is switched off. This site deletes this item as soon as it reads it.',
  portal_legal_store_reopen_l: 'Until the page reloads or the tab closes',
  portal_legal_store_signedin_p: 'Remembers on this device that someone signed in, so page translation by Google stays off. Holds a time, no personal data.',
  portal_legal_store_signedin_l: 'Deleted when you sign out or when you clear site data',

  // --- consent + embeds ----------------------------------------------------
  portal_legal_consent_required: 'Please confirm you are 16 or older and agree to the Terms & Conditions and Privacy Policy to create an account.',
  portal_legal_consent_required_signin: 'Please confirm you are 16 or older and agree to the Terms & Conditions and Privacy Policy to sign in.',
  portal_legal_renew_title: 'Confirm to keep using your account',
  portal_legal_renew_body: 'Our terms now set a minimum age of 16. Please confirm to keep using your account.',
  portal_legal_renew_agree: 'Agree',
  portal_legal_renew_required: 'Please tick the box to continue.',

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
  portal_legal_official_notice: 'អត្ថបទជាភាសាអង់គ្លេស និងភាសាខ្មែរជាអត្ថបទផ្លូវការ។ កំណែភាសាចិនសាមញ្ញ ចិនប្រពៃណី បារាំង និងអេស្ប៉ាញ ជាការបកប្រែដោយម៉ាស៊ីនរបស់ Google។ បើការបកប្រែខុសគ្នា អត្ថបទជាភាសាអង់គ្លេស ឬភាសាខ្មែរត្រូវអនុវត្ត។',
  portal_legal_close: 'បិទ',
  portal_legal_template_notice: 'ឯកសារនេះជាគំរូដែលរៀបចំសម្រាប់ {name}។ ម្ចាស់អាជីវកម្មគួរឱ្យមេធាវីជំនាញពិនិត្យមុននឹងប្រើ។ វាមិនមែនជាការប្រឹក្សាផ្នែកច្បាប់ទេ។',
  portal_legal_identity_h: 'ព័ត៌មានអាជីវកម្ម',
  portal_legal_identity_legal_name: 'ឈ្មោះចុះបញ្ជី',
  portal_legal_identity_registration: 'លេខចុះបញ្ជី',
  portal_legal_identity_address: 'អាសយដ្ឋានហាង',
  portal_legal_identity_phone: 'ទូរស័ព្ទ',
  portal_legal_identity_email: 'អ៊ីមែល',
  portal_legal_footer_rights: 'គេហទំព័រនេះដំណើរការដោយ {name}។',
  portal_legal_footer_independent: 'Leang Cosmetics ជាអ្នកលក់រាយផលិតផលសម្រស់ឯករាជ្យនៅកម្ពុជា។',
  portal_legal_business_fallback: 'អាជីវកម្មនេះ',
  portal_legal_footer_content_concerns: 'បើមានខ្លឹមសារអំពីអ្នក ឬអ្នកបារម្ភអំពីរូបភាពណាមួយ សូមទាក់ទង {email}។ យើងពិនិត្យរាល់សំណើ ហើយសុំតែព័ត៌មានដែលត្រូវការ ដើម្បីសម្គាល់ខ្លឹមសារ និងអ្នកដាក់សំណើ។',
  portal_legal_footer_landmark: 'ព័ត៌មាននិងគោលការណ៍របស់គេហទំព័រ',
  portal_legal_footer_contact: 'ទំនាក់ទំនង',
  portal_legal_footer_quick_links: 'តំណភ្ជាប់រហ័ស',
  portal_legal_footer_notices: 'សេចក្ដីជូនដំណឹងប្រភពបើកចំហ',

  portal_legal_privacy_who_h: 'យើងជានរណា',
  portal_legal_privacy_who_b: 'កាតាឡុកអនឡាញនេះដំណើរការដោយហាងដែលមានឈ្មោះក្នុងព័ត៌មានអាជីវកម្មដែលបានផ្ទៀងផ្ទាត់ខាងលើ ("យើង")។',
  portal_legal_privacy_collect_h: 'ទិន្នន័យដែលយើងរក្សាទុក',
  portal_legal_privacy_collect_b: 'អ្នកអាចមើលកាតាឡុកទាំងមូលជាភ្ញៀវ ដោយមិនចាំបាច់មានគណនី ឬផ្តល់ព័ត៌មានផ្ទាល់ខ្លួនអ្វីឡើយ។',
  portal_legal_privacy_collect_list: 'បើអ្នកបង្កើតគណនី យើងរក្សាទុកឈ្មោះ លេខទូរស័ព្ទ លេខសមាជិក និងកូដមួយទិសដែលបង្កើតពីពាក្យសម្ងាត់របស់អ្នក (យើងមិនរក្សាទុកពាក្យសម្ងាត់ផ្ទាល់ទេ)។ យើងក៏រក្សាទុកកំណែនៃគោលការណ៍ឯកជនភាព និងលក្ខខណ្ឌប្រើប្រាស់ដែលអ្នកបានយល់ព្រម ពេលវេលាដែលអ្នកយល់ព្រម និងភាសាដែលអ្នកប្រើពេលយល់ព្រម។ បើអ្នករក្សាទុកផលិតផលពេលចូលគណនី យើងរក្សាទុកបញ្ជីនោះ។ បើអ្នកសួរសំណួរជំនួយការ AI យើងរក្សាទុកសំណួរ និងចំណូលចិត្តណាដែលអ្នកចែករំលែកជាមួយជំនួយការ។ បើអ្នកផ្ញើរូបភាពមកឱ្យយើងពិនិត្យ (ពេលជម្រើសនោះបើក) យើងរក្សាទុករូបភាពទាំងនោះជាមួយឈ្មោះវេទិកាដែលអ្នកផ្តល់ កំណត់ចំណាំ និងការយល់ព្រមរបស់អ្នក។ យើងមិនរក្សាទុកព័ត៌មានទូទាត់ប្រាក់ ហើយក៏មិនដែលសុំវាដែរ។ កំណត់ត្រាសុវត្ថិភាពរយៈពេលខ្លីប្រើកូដមួយទិស ជំនួសឱ្យអាសយដ្ឋាន IP ឬលេខទូរស័ព្ទដើម។ របាយការណ៍កំហុសខ្លីៗផ្ញើទៅ Sentry។',
  portal_legal_privacy_why_h: 'ហេតុអ្វីយើងរក្សាទុក',
  portal_legal_privacy_why_b: 'យើងរក្សាទុកព័ត៌មានគណនីរបស់អ្នក ដើម្បីដឹងថានរណាជានរណា និងរក្សាសុវត្ថិភាពគណនីរបស់អ្នកប៉ុណ្ណោះ។ យើងប្រើកំណត់ត្រាសុវត្ថិភាព ដើម្បីទប់ស្កាត់ការទាយពាក្យសម្ងាត់ និងការប្រើគេហទំព័រនេះខុសគោលបំណងផ្សេងទៀតប៉ុណ្ណោះ។ យើងប្រើរបាយការណ៍កំហុស ដើម្បីជួសជុលបញ្ហាប៉ុណ្ណោះ។',
  portal_legal_privacy_basis_h: 'ការយល់ព្រមរបស់អ្នក',
  portal_legal_privacy_basis_b: 'ការបង្កើតគណនីជាជម្រើសរបស់អ្នក។ មុនពេលអ្នកបង្កើតគណនី យើងសុំឱ្យអ្នកយល់ព្រមនឹងគោលការណ៍នេះ និងលក្ខខណ្ឌប្រើប្រាស់។ បើអ្នកប្តូរចិត្ត សូមស្នើឱ្យយើងបិទគណនីរបស់អ្នក។',
  portal_legal_privacy_retention_h: 'យើងរក្សាទុករយៈពេលប៉ុន្មាន',
  portal_legal_privacy_retention_b: 'យើងលុបកំណត់ត្រាសុវត្ថិភាពបន្ទាប់ពី ១ ថ្ងៃ។ អ្នកនៅតែចូលគណនីបានរហូតដល់ ៣៩៩ ថ្ងៃ។ បើអ្នកប្រើគេហទំព័រពេលចូលគណនី បន្ទាប់ពី ២០០ ថ្ងៃដំបូង ការចូលគណនីរបស់អ្នកចាប់ផ្តើមឡើងវិញជាមួយ ៣៩៩ ថ្ងៃពេញ។ ការចាកចេញបញ្ចប់ការចូលគណនីរបស់អ្នកភ្លាមៗ។ យើងលុបសំណួរដែលអ្នកសួរជំនួយការ AI បន្ទាប់ពី ៣០ ថ្ងៃ។ យើងលុបរូបភាពដែលផ្ញើមកពិនិត្យ ៩០ ថ្ងៃបន្ទាប់ពីការពិនិត្យ។ បើគ្មានអ្នកពិនិត្យទេ យើងលុបវា ១៨០ ថ្ងៃបន្ទាប់ពីអ្នកផ្ញើ។ យើងរក្សាកំណត់ត្រាខ្លីនៃការពិនិត្យរូបភាពនីមួយៗ។ យើងរក្សាគណនីរបស់អ្នករហូតដល់អ្នកស្នើឱ្យយើងបិទ។ Sentry រក្សារបាយការណ៍កំហុសក្នុងរយៈពេលដែល Sentry កំណត់។',
  portal_legal_privacy_sharing_h: 'អ្នកផ្សេងទៀតដែលទទួលទិន្នន័យរបស់អ្នក',
  portal_legal_privacy_sharing_b: 'គេហទំព័រនេះគ្មានឧបករណ៍តាមដានសម្រាប់ការផ្សាយពាណិជ្ជកម្មទេ ហើយយើងប្រើព័ត៌មានរបស់អ្នកសម្រាប់តែអ្វីដែលគោលការណ៍នេះពណ៌នាប៉ុណ្ណោះ។',
  portal_legal_privacy_sharing_list: 'Cloudflare បង្ហោះគេហទំព័រ ទិន្នន័យ រូបភាព និងកំណត់ត្រាសុវត្ថិភាព។ របាយការណ៍កំហុសផ្ញើទៅ Sentry ហើយ Cloudinary កែទំហំរូបភាពផលិតផលខ្លះ។ Google ទទួលសំណើ នៅពេលអ្នកបើកទំព័រអំពីយើង ព្រោះផែនទីហាងផ្ទុកនៅទីនោះ។ តំណបណ្តាញសង្គមបើកកម្មវិធីទាំងនោះ ដែលអនុវត្តគោលការណ៍ផ្ទាល់ខ្លួន។',
  portal_legal_privacy_translate_h: 'ការបកប្រែ',
  portal_legal_privacy_translate_b: 'កំណែភាសាចិនសាមញ្ញ ចិនប្រពៃណី បារាំង និងអេស្ប៉ាញនៃគេហទំព័រនេះ ជាការបកប្រែដោយម៉ាស៊ីន។ Google Translate ធ្វើការបកប្រែទាំងនោះនៅក្នុងកម្មវិធីរុករករបស់អ្នក ពេលអ្នកជ្រើសរើសមួយក្នុងចំណោមភាសាទាំងនេះ។ បន្ទាប់មក អត្ថបទទំព័រត្រូវបានផ្ញើទៅ Google។ បើអ្នកនៅភាសាខ្មែរ ឬអង់គ្លេស គ្មានអ្វីត្រូវបានផ្ញើទៅ Google ទេ។ ការបកប្រែត្រូវបានផ្អាក ពេលអ្នកចូលគណនី ឬពេលផ្ទាំងគណនីបើក។',
  portal_legal_privacy_ai_h: 'ជំនួយការ',
  portal_legal_privacy_ai_b: 'សំណួរដែលអ្នកសួរជំនួយការ AI ត្រូវផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបី ហើយដំណើរការក្រៅប្រទេសកម្ពុជា។ យើងលុបច្បាប់ចម្លងរបស់យើងផ្ទាល់បន្ទាប់ពី ៣០ ថ្ងៃ។',
  portal_legal_privacy_ai_off: 'ជំនួយការត្រូវបានបិទ ហើយគ្មានអ្នកផ្តល់សេវា AI ណាទទួលទិន្នន័យពីគេហទំព័រនេះទេ។',
  portal_legal_privacy_ai_named: 'សំណួរដែលអ្នកសួរជំនួយការ AI ត្រូវផ្ញើទៅ {providers} ហើយដំណើរការក្រៅប្រទេសកម្ពុជា។ យើងលុបច្បាប់ចម្លងរបស់យើងផ្ទាល់បន្ទាប់ពី ៣០ ថ្ងៃ។',
  portal_legal_ai_provider_terms: 'លក្ខខណ្ឌរបស់ {provider}',
  portal_legal_privacy_security_h: 'យើងការពារវាយ៉ាងណា',
  portal_legal_privacy_security_b: 'យើងមិនរក្សាទុកពាក្យសម្ងាត់ផ្ទាល់របស់អ្នកទេ គឺរក្សាតែកូដមួយទិសដែលបង្កើតពីវា ដែលមិនអាចបំប្លែងត្រឡប់ជាពាក្យសម្ងាត់វិញបានឡើយ។ ពាក្យសម្ងាត់របស់អ្នកត្រូវមានយ៉ាងតិច ១០ តួអក្សរ។ ខូឃីចូលគណនីមិនអាចអានដោយស្គ្រីប នៅតែលើគេហទំព័រនេះ និងផ្ញើតាម HTTPS។ បន្ទាប់ពីការសាកល្បងខុសច្រើនដង អ្នកត្រូវរង់ចាំយូរជាងមុន មុនពេលសាកល្បងចូលគណនីម្តងទៀត។ សូមប្រើពាក្យសម្ងាត់ដែលអ្នកមិនប្រើនៅកន្លែងផ្សេង។',
  portal_legal_privacy_scam_h: 'ប្រយ័ត្នការបោកប្រាស់',
  portal_legal_privacy_scam_b: 'យើងមិនដែលប្រមូលព័ត៌មានទូទាត់ប្រាក់តាមគេហទំព័រនេះទេ ហើយនឹងមិនសុំវាឡើយ។ សូមកុំផ្តល់ព័ត៌មានគណនីធនាគារ លេខកាត ឬពាក្យសម្ងាត់របស់អ្នក ទៅនរណាម្នាក់ដែលសុំ ទោះបីគេអះអាងថាមកពីហាងយើងក៏ដោយ។ អ្នកណាដែលសុំព័ត៌មានទាំងនោះ គឺជាអ្នកបោកប្រាស់។ សូមកុំឆ្លើយតប ហើយប្រាប់យើងតាមព័ត៌មានអាជីវកម្មខាងលើ។',
  portal_legal_privacy_rights_h: 'សិទ្ធិរបស់អ្នក',
  portal_legal_privacy_rights_b: 'ដើម្បីមើល កែតម្រូវ ឬលុបព័ត៌មានដែលភ្ជាប់នឹងគណនីរបស់អ្នក សូមទាក់ទងយើងតាមព័ត៌មានអាជីវកម្មដែលបានផ្ទៀងផ្ទាត់ខាងលើ។ យើងពិនិត្យជាមុនថាពិតជាអ្នក។ បើយើងត្រូវរក្សាទុកកំណត់ត្រាមួយ ដោយសារមូលហេតុប្រតិបត្តិការ ឬច្បាប់ យើងនឹងប្រាប់អ្នក។',
  portal_legal_privacy_children_h: 'អាយុអប្បបរមា',
  portal_legal_privacy_children_b: 'អ្នកត្រូវមានអាយុ ១៦ ឆ្នាំឡើងទៅ ដើម្បីមានគណនី។ អ្នកត្រូវមានសមត្ថភាពតាមច្បាប់ក្នុងការយល់ព្រមនឹងគោលការណ៍ទាំងនេះដោយខ្លួនឯង។ បើអ្នកគិតថាអ្នកដែលមានអាយុក្រោម ១៦ ឆ្នាំបានផ្តល់ព័ត៌មានមកយើង សូមទាក់ទងយើង ហើយយើងនឹងពិនិត្យមើល។',
  portal_legal_privacy_changes_h: 'ការផ្លាស់ប្តូរគោលការណ៍នេះ',
  portal_legal_privacy_changes_b: 'បើយើងផ្លាស់ប្តូរគោលការណ៍នេះ យើងនឹងធ្វើបច្ចុប្បន្នភាពកាលបរិច្ឆេទខាងលើ។ ការគ្រាន់តែមើលគេហទំព័រ មិនត្រូវបានចាត់ទុកជាការយល់ព្រមទេ។',

  portal_legal_terms_catalogue_h: 'នេះជាកាតាឡុក',
  portal_legal_terms_catalogue_b: 'គេហទំព័រនេះបង្ហាញអ្វីដែល {name} មានស្តុក ដើម្បីឱ្យអ្នករុករក និងរៀបចំការមកហាង។ វាជាការអញ្ជើញឱ្យទាក់ទងមកយើង មិនមែនជាការផ្តល់ជូនដែលចងកាតព្វកិច្ច ឬកិច្ចសន្យាលក់ទេ។',
  portal_legal_terms_prices_h: 'តម្លៃនិងស្តុក',
  portal_legal_terms_prices_b: 'តម្លៃ ការផ្តល់ជូនពិសេស និងស្តុក គ្រាន់តែជាការណែនាំ ហើយអាចប្តូរដោយមិនជូនដំណឹង។ សាខានីមួយៗមានស្តុករបស់ខ្លួន។ តម្លៃនិងស្តុកដែលបុគ្គលិកបញ្ជាក់នៅពេលអ្នកទិញ គឺជាអ្វីដែលអនុវត្ត។',
  portal_legal_terms_returns_h: 'គោលការណ៍ប្រគល់ទំនិញមកវិញ',
  portal_legal_terms_returns_b: 'អ្នកអាចប្រគល់ទំនិញដែលមិនទាន់បើកមកវិញក្នុងរយៈពេល ៧ ថ្ងៃ។ សូមនាំវិក្កយបត្រមកជាមួយ។',
  portal_legal_terms_nopayment_h: 'អ្នកមិនអាចបង់ប្រាក់នៅលើគេហទំព័រនេះបានទេ',
  portal_legal_terms_nopayment_b: 'អ្នកមិនអាចបង់ប្រាក់នៅលើគេហទំព័រនេះទេ។ បញ្ជីរបស់អ្នកគឺសម្រាប់បង្ហាញក្រុមការងារយើង ហើយអ្នកបង់ប្រាក់នៅហាង ឬតាមវិធីដែលអ្នកព្រមព្រៀងជាមួយបុគ្គលិក។ យើងមិនរក្សាទុកព័ត៌មានទូទាត់ប្រាក់ ហើយមិនដែលប្រមូលវាតាមគេហទំព័រនេះទេ។ យើងនឹងមិនសុំព័ត៌មានគណនីធនាគារ លេខកាត ឬពាក្យសម្ងាត់របស់អ្នកឡើយ ដូច្នេះអ្នកណាដែលសុំ ទោះបីអះអាងថាជាយើងក៏ដោយ គឺកំពុងព្យាយាមបោកប្រាស់អ្នក។',
  portal_legal_terms_account_h: 'គណនីរបស់អ្នក',
  portal_legal_terms_account_b: 'សូមបង្កើតគណនីតែបើអ្នកមានអាយុ ១៦ ឆ្នាំឡើងទៅ។ អ្នកត្រូវមានសមត្ថភាពតាមច្បាប់ក្នុងការយល់ព្រមនឹងលក្ខខណ្ឌទាំងនេះដោយខ្លួនឯង។ សូមផ្តល់ព័ត៌មានត្រឹមត្រូវ ហើយរក្សាពាក្យសម្ងាត់ជាការសម្ងាត់។ សូមប្រាប់យើង បើអ្នកគិតថាមាននរណាម្នាក់ផ្សេងកំពុងប្រើគណនីរបស់អ្នក។ យើងផ្អាកគណនីណាដែលត្រូវបានប្រើខុសគោលបំណង។',
  portal_legal_terms_ai_h: 'ជំនួយការ',
  portal_legal_terms_ai_b: 'ជំនួយការដំណើរការដោយសេវា AI ភាគីទីបី។ វាអាចខុស ហើយផ្តល់តែការណែនាំទូទៅ មិនមែនជាការប្រឹក្សាវេជ្ជសាស្ត្រ ការថែរក្សាស្បែក ឬវិជ្ជាជីវៈទេ។ សូមកុំចែករំលែកព័ត៌មានផ្ទាល់ខ្លួន សុខភាព ឬការទូទាត់ជាមួយវា ហើយពិនិត្យរឿងសំខាន់ៗជាមួយបុគ្គលិករបស់យើង។',
  portal_legal_terms_use_h: 'ច្បាប់សម្រាប់ការប្រើប្រាស់គេហទំព័រនេះ',
  portal_legal_terms_use_b: 'សូមកុំលួចចូលគេហទំព័រនេះ ធ្វើឱ្យវាលើសបន្ទុក ប្រមូលទិន្នន័យរបស់វាដោយប្រើឧបករណ៍ស្វ័យប្រវត្តិ ឬរារាំងវាមិនឱ្យដំណើរការជាធម្មតា។ សូមកុំផ្ញើមកយើង ឬបង្ហោះអ្វីដែលខុសច្បាប់ បំភាន់ ឬជារបស់អ្នកដទៃ។ អ្វីដែលអ្នកផ្ញើមកយើង ត្រូវតែជារបស់អ្នក ឬអ្នកត្រូវមានការអនុញ្ញាតពីម្ចាស់ក្នុងការចែករំលែកវា។',
  portal_legal_terms_ip_h: 'ខ្លឹមសារនិងពាណិជ្ជសញ្ញា',
  portal_legal_terms_ip_b: 'ឈ្មោះម៉ាក ពាណិជ្ជសញ្ញា និងរូបភាព ឬអត្ថបទណាដែលហាងមិនបានបង្កើត ជាកម្មសិទ្ធិរបស់ម្ចាស់សិទ្ធិរៀងៗខ្លួន។ ទំព័រនេះមិនអះអាងថាហាងជាម្ចាស់ ឬមានអាជ្ញាប័ណ្ណប្រើឡើងវិញនូវរូបភាព ឬអត្ថបទទាំងអស់ដែលបង្ហាញនៅទីនេះឡើយ។ បើអ្នកមានកង្វល់អំពីខ្លឹមសារជាក់លាក់ សូមទាក់ទងហាងតាមព័ត៌មានដែលបានផ្ទៀងផ្ទាត់ខាងលើ។',
  portal_legal_terms_liability_h: 'ដែនកំណត់នៃការទទួលខុសត្រូវរបស់យើង',
  portal_legal_terms_liability_b: 'យើងមិនអាចធានាថាកាតាឡុកនេះគ្មានកំហុស ឬអាចប្រើបានជានិច្ចទេ។ ក្នុងវិសាលភាពដែលច្បាប់អនុញ្ញាត យើងមិនទទួលខុសត្រូវលើការខាតបង់ដោយប្រយោលពីការប្រើគេហទំព័រនេះឡើយ។ គ្មានអ្វីនៅក្នុងលក្ខខណ្ឌទាំងនេះកំណត់សិទ្ធិរបស់អ្នកក្រោមច្បាប់កម្ពុជាស្ដីពីកិច្ចការពារអ្នកប្រើប្រាស់ទេ។',
  portal_legal_terms_law_h: 'ច្បាប់អនុវត្ត',
  portal_legal_terms_law_b: 'លក្ខខណ្ឌទាំងនេះស្ថិតក្រោមច្បាប់នៃព្រះរាជាណាចក្រកម្ពុជា ហើយតុលាការកម្ពុជាមានយុត្តាធិការ។ សូមទាក់ទងយើងជាមុនសិន បើមានបញ្ហា។',

  portal_legal_cookies_what_h: 'អ្វីដែលគេហទំព័រនេះរក្សាទុក',
  portal_legal_cookies_what_b: 'ខូឃីជាឯកសារតូចមួយដែលគេហទំព័ររក្សាទុកក្នុងកម្មវិធីរុករករបស់អ្នក។ ការផ្ទុកមូលដ្ឋានដំណើរការស្រដៀងគ្នា។ គេហទំព័រនេះរក្សាទុកតែអ្វីដែលវាត្រូវការដើម្បីដំណើរការ។ គ្មានខូឃីផ្សាយពាណិជ្ជកម្ម ឬវិភាគទេ។',
  portal_legal_cookies_consent_h: 'ការផ្ទុកចាំបាច់ និងការផ្ទុកភាគីទីបី',
  portal_legal_cookies_consent_b: 'ផែនទីហាងនៅទំព័រអំពីយើងមកពី Google Maps។ វាផ្ទុកពេលអ្នកបើកទំព័រអំពីយើង ហើយ Google កំណត់ខូឃីផ្ទាល់ខ្លួនរបស់ខ្លួននៅពេលនោះ។ ក្រៅពីផែនទី ការផ្ទុកភាគីទីបីត្រូវបានបង្កើតតែបន្ទាប់ពីអ្នកបើកមុខងារដែលប្រើវាប៉ុណ្ណោះ។',
  portal_legal_cookies_table_h: 'បញ្ជីពេញលេញនៃអ្វីដែលគេហទំព័រនេះរក្សាទុក',
  portal_legal_cookies_table_b: 'តារាងនេះរាយការផ្ទុកក្នុងកម្មវិធីរុករក ដែលកូដទំព័រហាងនេះគ្រប់គ្រង។ សេវាភាគីទីបីបន្ថែមការផ្ទុកផ្ទាល់ខ្លួនរបស់ខ្លួន។ សូមមើល «សេវាភាគីទីបី»។',
  portal_legal_cookies_third_h: 'សេវាភាគីទីបី',
  portal_legal_cookies_third_b: 'ការបើកទំព័រអំពីយើងផ្ទុក Google Maps ដែលជាសេវារបស់ Google ហើយកំណត់ខូឃីផ្ទាល់ខ្លួនរបស់ខ្លួន។ ការជ្រើសរើសភាសាចិនសាមញ្ញ ចិនប្រពៃណី បារាំង ឬអេស្ប៉ាញ ផ្ទុក Google Translate។ គេហទំព័រនេះ និងស្គ្រីបបកប្រែរបស់ Google កំណត់ខូឃី googtrans ដើម្បីចងចាំជម្រើសនោះ។ គេហទំព័រនេះលុបខូឃីនោះ ពេលអ្នកត្រឡប់ទៅភាសាខ្មែរ ឬអង់គ្លេស ឬពេលការបកប្រែត្រូវបានផ្អាក។ ការបើកតំណ Facebook, Instagram, Telegram, WhatsApp ឬ Messenger នាំអ្នកទៅកម្មវិធីនោះ ក្រោមគោលការណ៍ផ្ទាល់របស់វា។ ជំនួយការផ្ញើសំណួររបស់អ្នកទៅអ្នកផ្តល់សេវា AI ភាគីទីបី។ ក្រៅពីផែនទី គ្មានសេវាទាំងនេះដំណើរការមុនអ្នកជ្រើសរើសវាទេ។',
  portal_legal_cookies_clear_h: 'របៀបលុបវា',
  portal_legal_cookies_clear_b: 'ចាកចេញពីគណនីដើម្បីបញ្ចប់ខូឃីវគ្គ។ ដើម្បីលុបអ្វីៗផ្សេងទៀតដែលគេហទំព័រនេះរក្សាទុក សូមសម្អាតទិន្នន័យគេហទំព័រនេះក្នុងការកំណត់កម្មវិធីរុករក។ វាលុបបញ្ជី បញ្ជីចង់បាន ភាសា និងរូបរាងរបស់អ្នកលើឧបករណ៍នេះ។',

  portal_legal_col_name: 'ឈ្មោះការផ្ទុក',
  portal_legal_col_kind: 'ប្រភេទការផ្ទុក',
  portal_legal_col_purpose: 'គោលបំណង',
  portal_legal_col_lifetime: 'រយៈពេលដែលវាត្រូវបានរក្សាទុក',
  portal_legal_kind_cookie: 'ខូឃី',
  portal_legal_kind_local: 'ការផ្ទុកមូលដ្ឋាន',
  portal_legal_kind_both: 'ការផ្ទុកមូលដ្ឋាននិងវគ្គ',
  portal_legal_kind_cache: 'ឃ្លាំងសម្ងាត់ Cache Storage',
  portal_legal_kind_session: 'ការផ្ទុកវគ្គ',
  portal_legal_store_session_p: 'រក្សាឱ្យអ្នកនៅក្នុងគណនី។ កំណត់តែពេលអ្នកចូល មិនអាចអានដោយស្គ្រីប និងកំណត់តែលើគេហទំព័រនេះ។',
  portal_legal_store_session_l: 'រហូតដល់ ៣៩៩ ថ្ងៃ។ បើអ្នកប្រើគណនីក្រោយ ២០០ ថ្ងៃដំបូង ខូឃីនេះត្រូវបន្តរយៈពេល ៣៩៩ ថ្ងៃ គិតពីថ្ងៃនោះ។ ការចាកចេញលុបខូឃីនេះ មិនមែនលុបគណនីរបស់អ្នកទេ។',
  portal_legal_store_bucket_p: 'បញ្ជីផលិតផលរបស់អ្នក ដើម្បីកុំបាត់ពេលផ្ទុកទំព័រឡើងវិញ។',
  portal_legal_store_wishlist_p: 'ផលិតផលដែលអ្នករក្សាទុក។',
  portal_legal_store_translate_p: 'ភាសាដែលអ្នកជ្រើសសម្រាប់គេហទំព័រនេះ។',
  portal_legal_store_cache_storage_p: 'ឯកសារស្នូលកម្មវិធី និងឯកសារថេរដែលមកពីគេហទំព័រដូចគ្នា សម្រាប់ផ្ទុកទំព័រហាង និងគាំទ្រអ៊ីនធឺណិតខ្សោយ។ វាមិនមានកំណត់ត្រាគណនី ឬការផ្ញើទេ។',
  portal_legal_store_cache_storage_l: 'រហូតដល់ជំនួសដោយកំណែឃ្លាំងសម្ងាត់ថ្មី ឬអ្នកសម្អាតទិន្នន័យគេហទំព័រ',
  portal_legal_store_device_p: 'រក្សាទុកជម្រើសរូបរាងភ្លឺ ឬងងឹតរបស់អ្នកសម្រាប់ឧបករណ៍នេះ។',
  portal_legal_store_assets_p: 'កន្លែងដែលរូបភាពផលិតផលត្រូវផ្ទុកមក។',
  portal_legal_store_announcement_p: 'ចងចាំសេចក្តីជូនដំណឹងរបស់ហាងណាដែលអ្នកបានបិទលើឧបករណ៍នេះ ដើម្បីឱ្យវានៅបិទ រហូតដល់ហាងផ្លាស់ប្តូរវា។',
  portal_legal_store_googtrans_p: 'គេហទំព័រនេះ និងស្គ្រីបបកប្រែរបស់ Google កំណត់វា ពេលអ្នកជ្រើសភាសាចិនសាមញ្ញ ចិនប្រពៃណី បារាំង ឬអេស្ប៉ាញ ដើម្បីចងចាំជម្រើសនោះ។ គេហទំព័រនេះលុបវា ពេលអ្នកត្រឡប់ទៅភាសាខ្មែរ ឬអង់គ្លេស ឬពេលការបកប្រែផ្អាក។',
  portal_legal_store_googtrans_l: 'លុបពេលអ្នកប្តូរទៅភាសាខ្មែរ ឬអង់គ្លេស ពេលការបកប្រែត្រូវបានផ្អាក ឬពេលអ្នកសម្អាតទិន្នន័យគេហទំព័រ',
  portal_legal_store_ai_consent_p: 'រក្សាទុកថាតើអ្នកបានយល់ព្រមផ្ញើសំណួរទៅជំនួយការ AI ឬអត់។ វាត្រូវបានរក្សាទុកតែលើឧបករណ៍នេះប៉ុណ្ណោះ។',
  portal_legal_store_ai_consent_l: 'រហូតដល់អ្នកដកការយល់ព្រម ឬសម្អាតទិន្នន័យគេហទំព័រ',
  portal_legal_store_list_images_p: 'រូបភាពសម្រាប់ផលិតផលក្នុងបញ្ជីរបស់អ្នក លើឧបករណ៍នេះ។',
  portal_legal_store_page_size_p: 'រក្សាទុកចំនួនផលិតផលដែលអ្នកបង្ហាញក្នុងមួយទំព័រ។',
  portal_legal_store_until_cleared_l: 'រហូតដល់អ្នកសម្អាតទិន្នន័យគេហទំព័រ',
  portal_legal_store_reopen_p: 'គេហទំព័រនេះប្រើវាដើម្បីបើកផ្ទាំងគណនីឡើងវិញម្តង បន្ទាប់ពីបិទការបកប្រែ។ គេហទំព័រនេះលុបធាតុនេះភ្លាមៗ នៅពេលវាអានរួច។',
  portal_legal_store_reopen_l: 'រហូតដល់ទំព័រផ្ទុកឡើងវិញ ឬបិទផ្ទាំង',
  portal_legal_store_signedin_p: 'ចងចាំនៅលើឧបករណ៍នេះថាមានអ្នកចូលគណនី ដើម្បីឱ្យការបកប្រែទំព័រដោយ Google នៅបិទ។ រក្សាទុកតែម៉ោង គ្មានទិន្នន័យផ្ទាល់ខ្លួនទេ។',
  portal_legal_store_signedin_l: 'លុបពេលអ្នកចាកចេញពីគណនី ឬពេលអ្នកសម្អាតទិន្នន័យគេហទំព័រ',

  portal_legal_consent_required: 'សូមបញ្ជាក់ថាអ្នកមានអាយុ ១៦ ឆ្នាំឡើងទៅ ហើយយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព ដើម្បីបង្កើតគណនី។',
  portal_legal_consent_required_signin: 'សូមបញ្ជាក់ថាអ្នកមានអាយុ ១៦ ឆ្នាំឡើងទៅ ហើយយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព ដើម្បីចូលគណនី។',
  portal_legal_renew_title: 'បញ្ជាក់ដើម្បីបន្តប្រើគណនីរបស់អ្នក',
  portal_legal_renew_body: 'លក្ខខណ្ឌរបស់យើងកំណត់អាយុអប្បបរមា ១៦ ឆ្នាំ។ សូមបញ្ជាក់ដើម្បីបន្តប្រើគណនីរបស់អ្នក។',
  portal_legal_renew_agree: 'យល់ព្រម',
  portal_legal_renew_required: 'សូមធីកប្រអប់ដើម្បីបន្ត។',

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
 * The one way a surface asks for a legal string: the storefront language pack first, then the declared English / Khmer text. The
 * policy reader and the dock's language picker both read the official-text notice through this, so the two can never disagree.
 */
export function legalCopy(copy: (key: string, fallback?: string, fallbackKm?: string) => string, key: string): string {
  return copy(key, legalText('en', key), legalText('km', key))
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

// ---------------------------------------------------------------------------
// Protected facts (owner, 21 Nov 2026: keep Google Translate, but "make sure crucial and vital information are not
// translated or affected").
//
// Google translates each piece of text between two untranslated spans on its own, so a span in the middle of a sentence
// breaks the sentence. Measured 21 Nov 2026 on the three policy pages: with numbers, units, dates and brand names wrapped,
// zh-CN read "16 or 18 years old" and "problems may occur" for the sign-in rule; without any wrapping (round 1, 644
// pieces in four languages) every number and unit came out right and only the shop's own name was translated. So only
// the shop's own details (name, registered name, registration number, address, phone, e-mail) and the AI provider names
// are protected: exact strings passed in as `literals`. Everything else stays in its sentence. The visible text never
// changes: the segments always join back to the exact input (tests/portalLegalProtectFacts.test.ts pins that).
// ---------------------------------------------------------------------------
export type LegalTextSegment = { text: string; protect: boolean }

const WORD_CHAR = /[A-Za-z0-9]/
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Cuts `text` into segments, each either plain text or one of the `literals` (the shop's details, the AI provider names),
 * which are protected wherever they occur as whole words (3 characters or more); the longest literal wins where two start at the same place. The segments
 * always join back to `text`.
 */
export function protectLegalFacts(text: string, literals: readonly string[] = []): LegalTextSegment[] {
  const source = String(text ?? '')
  const found: Array<{ start: number; end: number }> = []
  for (const value of literals) {
    if (value.trim().length < 3) continue
    for (const match of source.matchAll(new RegExp(escapeRegExp(value), 'g'))) {
      const start = match.index ?? 0
      const end = start + match[0].length
      // A whole word only: 'Leang' inside 'Leangkor' or '16' inside '160' is not the shop's detail (no look-behind, for older Safari).
      if (WORD_CHAR.test(value.charAt(0)) && WORD_CHAR.test(source.charAt(start - 1))) continue
      if (WORD_CHAR.test(value.charAt(value.length - 1)) && WORD_CHAR.test(source.charAt(end))) continue
      found.push({ start, end })
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const segments: LegalTextSegment[] = []
  let cursor = 0
  for (const hit of found) {
    if (hit.start < cursor) continue
    if (hit.start > cursor) segments.push({ text: source.slice(cursor, hit.start), protect: false })
    segments.push({ text: source.slice(hit.start, hit.end), protect: true })
    cursor = hit.end
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), protect: false })
  return segments
}

/**
 * Google trims the spaces at the edges of the text it translates, so a fact between two translated pieces ends up glued to
 * its neighbours ("dans7 daysApportez", measured 21 Nov 2026). The spaces next to a fact move inside its untranslated span,
 * where Google leaves them. The segments still join back to the input.
 */
export function padProtectedSegments(segments: readonly LegalTextSegment[]): LegalTextSegment[] {
  const out = segments.map((part) => ({ ...part }))
  for (let index = 0; index < out.length; index += 1) {
    if (!out[index].protect) continue
    const before = out[index - 1]
    if (before && !before.protect) {
      const lead = before.text.match(/\s+$/)?.[0] || ''
      before.text = before.text.slice(0, before.text.length - lead.length)
      out[index].text = lead + out[index].text
    }
    const after = out[index + 1]
    if (after && !after.protect) {
      const trail = after.text.match(/^\s+/)?.[0] || ''
      after.text = after.text.slice(trail.length)
      out[index].text += trail
    }
  }
  return out.filter((part) => part.text)
}

// Owner, 21 Nov 2026: a one-word homonym the translator turned into a biscuit ("Galleta", "曲奇饼"). The cell is the
// word for the storage type, so it is kept in the official language.
export const LEGAL_KEEP_OFFICIAL_KEYS: readonly string[] = ['portal_legal_kind_cookie']
