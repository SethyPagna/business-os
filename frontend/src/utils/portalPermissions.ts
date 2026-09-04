// Frontend mirror of the customer-portal settings buckets in
// cloudflare/src/routes/settings.ts (Part 557 slice 8). The storefront editor
// is broken into per-area write grants so a role can be given exactly the areas
// it manages:
//   portal_posts    -> posts / promo cards
//   portal_faq      -> FAQ
//   portal_about    -> About
//   customer_portal -> every OTHER customer_portal_* key ("portal config":
//                      branding, media, theme, catalog display, social, AI,
//                      maps, translations, publish, loyalty, submissions)
// Holding the broad `settings` grant (or admin) is a superset for all of them,
// exactly as the backend encodes, so no existing Settings admin regresses.
//
// Keep these three key sets identical to settings.ts's PORTAL_*_KEYS.

export const PORTAL_POSTS_KEYS = new Set<string>([
  'customer_portal_promo_items',
  'customer_portal_promotions_title',
  'customer_portal_promotions_intro',
  'customer_portal_show_promotions',
])
export const PORTAL_FAQ_KEYS = new Set<string>([
  'customer_portal_faq_items',
  'customer_portal_faq_title',
  'customer_portal_show_faq',
])
export const PORTAL_ABOUT_KEYS = new Set<string>([
  'customer_portal_about_title',
  'customer_portal_about_content',
  'customer_portal_about_blocks',
  'customer_portal_show_about',
])

export type PortalBucket = 'portal_posts' | 'portal_faq' | 'portal_about' | 'customer_portal'

// The portal bucket a given key writes through, or null if it is not a
// customer-portal key. Posts/FAQ/About come first so their specific keys win
// over the customer_portal_* catch-all.
export function portalBucketForKey(key: string): PortalBucket | null {
  if (PORTAL_POSTS_KEYS.has(key)) return 'portal_posts'
  if (PORTAL_FAQ_KEYS.has(key)) return 'portal_faq'
  if (PORTAL_ABOUT_KEYS.has(key)) return 'portal_about'
  if (key.startsWith('customer_portal_')) return 'customer_portal'
  return null
}

// The OTHER two settings buckets, mirrored from settings.ts so the portal
// editor's save (which also carries business_name/phone/email/address) filters
// exactly the way the backend accepts/rejects -- otherwise a business_identity
// grant would wrongly have its branding fields dropped. Keep in sync with
// settings.ts's BUSINESS_IDENTITY_KEYS / SALES_POLICY_KEYS.
const BUSINESS_IDENTITY_KEYS = new Set<string>([
  'business_name', 'business_phone', 'business_address', 'business_email', 'tax_id', 'business_website',
  'ui_app_favicon_image', 'ui_app_favicon_fit', 'ui_app_favicon_zoom', 'ui_app_favicon_position_x', 'ui_app_favicon_position_y',
])
const SALES_POLICY_KEYS = new Set<string>([
  'currency_usd_symbol', 'currency_khr_symbol', 'exchange_rate', 'change_exchange_rate', 'tax_rate',
  'display_currency', 'pos_show_item_discount', 'pos_payment_methods',
  'pos_wholesale_auto_enabled', 'pos_wholesale_auto_min_qty',
])

// The permission a given settings key requires, mirroring settings.ts's
// settingsBucketPermissionFor(); null means the plain `settings` grant.
export function settingsBucketForKey(key: string): string | null {
  if (BUSINESS_IDENTITY_KEYS.has(key)) return 'business_identity'
  if (SALES_POLICY_KEYS.has(key)) return 'sales_policy'
  return portalBucketForKey(key)
}

// Whether `hasPermission` grants the write for a single settings key, mirroring
// the backend's "bucket grant OR full settings" rule across ALL buckets. Admin
// is already folded into hasPermission() upstream, so it is not special-cased.
export function canWriteSettingKey(key: string, hasPermission: (p: string) => boolean): boolean {
  const bucket = settingsBucketForKey(key)
  if (!bucket) return hasPermission('settings')
  return hasPermission(bucket) || hasPermission('settings')
}
