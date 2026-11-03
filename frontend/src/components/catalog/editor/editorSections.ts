// The Website Editor's seven sections (EDITOR-REDESIGN-REFRESH, ED-1a): which draft key is edited where, which write
// grant opens a section, and where a refused save sends the person.
//
// Pure data and pure functions, no React and no icons (EditorSectionNav maps `icon` to the drawing), so the unit tests can
// load it directly.
//
// This module sits under catalog/editor/, so vite.config.ts files it in the lazy `catalog-editor` chunk -- and that chunk
// already imports the `catalog` chunk. CatalogPage therefore imports only the TYPE EditorSectionId from here (erased from the
// build) and gates the sections with a literal that a test pins equal to `grants` below; a run-time import would close a
// catalog <-> catalog-editor cycle and pull the editor into the page's static closure.
import type { EditorTextKey } from './editorText.ts'

export const EDITOR_SECTION_IDS = ['shop', 'contact', 'products', 'posts', 'about', 'faq', 'features'] as const
export type EditorSectionId = (typeof EDITOR_SECTION_IDS)[number]
/** The sections the person may see, as CatalogPage hands them to the surface. */
export type EditorSection = EditorSectionId

// The four write grants of utils/portalPermissions.ts. A section opens for a person holding ANY of its grants.
export type EditorGrant = 'customer_portal' | 'portal_posts' | 'portal_about' | 'portal_faq'
export type EditorSectionIcon = 'images' | 'phone' | 'shopping-bag' | 'megaphone' | 'store' | 'help-circle' | 'layout-grid'

export type EditorSectionDef = {
  id: EditorSectionId
  domId: `portal-section-${EditorSectionId}`
  icon: EditorSectionIcon
  /** key, English, Khmer: the arguments of ed(). */
  label: readonly [EditorTextKey, string, string]
  grants: readonly EditorGrant[]
  /** Every draft key a field in this section writes. */
  keys: readonly string[]
}

// A field lives in the section whose gate is the grant that saves it: show_about is About's, the header colours and the
// product-page texts are config's. The business identity fields (name, phone, email, address, registered name and number)
// save through a fifth grant that has no section; they stay in the config sections until ED-2 shows them read-only for a
// person without that grant.
export const EDITOR_SECTIONS: readonly EditorSectionDef[] = [
  {
    id: 'shop',
    domId: 'portal-section-shop',
    icon: 'images',
    label: ['web_editor_section_shop', 'Shop', 'ហាង'],
    grants: ['customer_portal'],
    keys: [
      'business_name', 'customer_portal_business_tagline', 'customer_portal_intro',
      'customer_portal_logo_image', 'customer_portal_show_logo', 'customer_portal_logo_size', 'customer_portal_logo_fit',
      'customer_portal_logo_zoom', 'customer_portal_logo_position_x', 'customer_portal_logo_position_y',
      'customer_portal_cover_image', 'customer_portal_show_cover',
      'customer_portal_hero_gradient_start', 'customer_portal_hero_gradient_mid', 'customer_portal_hero_gradient_end',
    ],
  },
  {
    id: 'contact',
    domId: 'portal-section-contact',
    icon: 'phone',
    label: ['web_editor_section_contact', 'Contact', 'ទំនាក់ទំនង'],
    grants: ['customer_portal'],
    keys: [
      'business_phone', 'business_email', 'business_address', 'customer_portal_address_link',
      'business_legal_name', 'business_registration_number',
      'customer_portal_show_phone', 'customer_portal_show_email', 'customer_portal_show_address',
      'customer_portal_website', 'customer_portal_website_label', 'customer_portal_show_website',
      'customer_portal_facebook', 'customer_portal_facebook_label', 'customer_portal_show_facebook',
      'customer_portal_instagram', 'customer_portal_instagram_label', 'customer_portal_show_instagram',
      'customer_portal_telegram', 'customer_portal_telegram_label', 'customer_portal_show_telegram',
      'customer_portal_contact_messenger', 'customer_portal_contact_messenger_label', 'customer_portal_show_contact_messenger',
      'customer_portal_contact_telegram', 'customer_portal_contact_telegram_label', 'customer_portal_show_contact_telegram',
      'customer_portal_contact_instagram', 'customer_portal_contact_instagram_label', 'customer_portal_show_contact_instagram',
      'customer_portal_contact_whatsapp', 'customer_portal_contact_whatsapp_label', 'customer_portal_show_contact_whatsapp',
      'customer_portal_contact_phone', 'customer_portal_contact_phone_label', 'customer_portal_show_contact_phone',
      'customer_portal_google_maps_embed', 'customer_portal_show_google_map',
    ],
  },
  {
    id: 'products',
    domId: 'portal-section-products',
    icon: 'shopping-bag',
    label: ['web_editor_section_products', 'Products', 'ផលិតផល'],
    grants: ['customer_portal'],
    keys: [
      'customer_portal_show_catalog', 'customer_portal_show_prices', 'customer_portal_show_out_of_stock_products',
      'customer_portal_show_stock_status', 'customer_portal_show_product_brand', 'customer_portal_show_product_category',
      'customer_portal_show_product_discount', 'customer_portal_price_display', 'customer_portal_refresh_seconds',
      'customer_portal_grid_columns_auto', 'customer_portal_grid_columns_mobile', 'customer_portal_grid_columns_desktop',
      'customer_portal_show_top_seller_badge', 'customer_portal_show_top_product_badge', 'customer_portal_show_recommended_badge',
      'customer_portal_show_promotion_badge', 'customer_portal_show_new_arrival_badge', 'customer_portal_highlight_rank_limit',
      'customer_portal_recommended_product_ids',
      'customer_portal_product_caution_default', 'customer_portal_product_need_more_details_default',
      'customer_portal_stock_threshold_mode', 'customer_portal_low_stock_threshold', 'customer_portal_out_of_stock_threshold',
    ],
  },
  {
    id: 'posts',
    domId: 'portal-section-posts',
    icon: 'megaphone',
    label: ['web_editor_section_posts', 'Posts', 'ប្រកាស'],
    // Top of page (the announcement bar) is config's; the promotion cards are posts'.
    grants: ['customer_portal', 'portal_posts'],
    keys: [
      'customer_portal_announcement_enabled', 'customer_portal_announcement_text_en', 'customer_portal_announcement_text_km',
      'customer_portal_announcement_link', 'customer_portal_announcement_start', 'customer_portal_announcement_end',
      'customer_portal_show_promotions', 'customer_portal_promotions_title', 'customer_portal_promotions_intro', 'customer_portal_promo_items',
    ],
  },
  {
    id: 'about',
    domId: 'portal-section-about',
    icon: 'store',
    label: ['web_editor_section_about', 'About', 'អំពី'],
    grants: ['portal_about'],
    keys: [
      'customer_portal_show_about', 'customer_portal_about_title', 'customer_portal_about_image', 'customer_portal_about_image_alt',
      'customer_portal_about_content', 'customer_portal_about_blocks',
    ],
  },
  {
    id: 'faq',
    domId: 'portal-section-faq',
    icon: 'help-circle',
    label: ['web_editor_section_faq', 'FAQ', 'សំណួរញឹកញាប់'],
    grants: ['portal_faq'],
    keys: ['customer_portal_show_faq', 'customer_portal_faq_title', 'customer_portal_faq_items'],
  },
  {
    id: 'features',
    domId: 'portal-section-features',
    icon: 'layout-grid',
    label: ['web_editor_section_features', 'Features', 'មុខងារ'],
    grants: ['customer_portal'],
    keys: [
      'customer_portal_ai_enabled', 'customer_portal_ai_title', 'customer_portal_ai_provider_id', 'customer_portal_ai_intro',
      'customer_portal_ai_disclaimer', 'customer_portal_ai_prompt',
      'customer_portal_path', 'customer_portal_public_url', 'customer_portal_translate_widget_enabled', 'customer_portal_translations',
      'customer_portal_language',
      'customer_portal_submission_enabled', 'customer_portal_submission_instructions',
    ],
  },
]

// Draft keys no field edits: carried by buildDraft and the save payload, but never typed into.
export const HIDDEN_DRAFT_KEYS: readonly string[] = [
  'customer_portal_favicon_image', 'customer_portal_title', 'customer_portal_title_size', 'customer_portal_show_membership',
  'customer_portal_points_basis', 'customer_portal_points_per_usd', 'customer_portal_points_per_khr', 'customer_portal_redeem_points',
  'customer_portal_redeem_value_usd', 'customer_portal_redeem_value_khr', 'customer_portal_show_point_value',
  'customer_portal_membership_info_text', 'customer_portal_submission_reward_points',
]

const SECTION_OF_KEY: ReadonlyMap<string, EditorSectionId> = new Map(
  EDITOR_SECTIONS.flatMap((section) => section.keys.map((key): [string, EditorSectionId] => [key, section.id])),
)

export function sectionIdForKey(key: string): EditorSectionId | null {
  return SECTION_OF_KEY.get(key) ?? null
}

/** The sections holding an unsaved edit: the dirty dots. */
export function dirtySectionIds(editedKeys: ReadonlySet<string>): Set<EditorSectionId> {
  const dirty = new Set<EditorSectionId>()
  for (const key of editedKeys) {
    const id = sectionIdForKey(key)
    if (id) dirty.add(id)
  }
  return dirty
}

// ---- the section the editor opens on --------------------------------------------------------------------------------

export const EDITOR_SECTION_STORAGE_KEY = 'business-os-website-editor-section-v1'
type SectionStorage = Pick<Storage, 'getItem' | 'setItem'>
/** The element ids a tab panel is labelled by: the tab on a wide screen, the picker button below 768 px. */
export const sectionTabId = (id: EditorSectionId): string => 'portal-tab-' + id
export const SECTION_PICKER_ID = 'portal-section-picker'


function browserStorage(): SectionStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readStoredEditorSection(storage: SectionStorage | null = browserStorage()): string | null {
  try {
    return storage?.getItem(EDITOR_SECTION_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function writeStoredEditorSection(id: EditorSectionId, storage: SectionStorage | null = browserStorage()): void {
  try {
    storage?.setItem(EDITOR_SECTION_STORAGE_KEY, id)
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
}

/** The stored section if this role can see it, else the first section it can. */
export function landingEditorSection(stored: string | null, visible: readonly EditorSectionId[]): EditorSectionId {
  return visible.find((id) => id === stored) ?? visible[0] ?? 'shop'
}

// ---- where a refused save sends the person --------------------------------------------------------------------------

type FieldTarget = { section: EditorSectionId; elementId: string }

const FIELD_TARGETS: Readonly<Record<string, FieldTarget>> = {
  customer_portal_path: { section: 'features', elementId: 'portal-public-path' },
  customer_portal_public_url: { section: 'features', elementId: 'portal-public-url' },
  customer_portal_translations: { section: 'features', elementId: 'portal-translations-json' },
  customer_portal_google_maps_embed: { section: 'contact', elementId: 'portal-google-map-embed' },
  // The at-least-one-section rule is named at the first switch.
  customer_portal_show_catalog: { section: 'products', elementId: 'portal-show-catalog' },
  customer_portal_announcement_link: { section: 'posts', elementId: 'portal-announcement-link' },
  customer_portal_announcement_end: { section: 'posts', elementId: 'portal-announcement-end' },
  customer_portal_about_image: { section: 'about', elementId: 'portal-about-image' },
  customer_portal_logo_image: { section: 'shop', elementId: 'portal-logo-image' },
  customer_portal_cover_image: { section: 'shop', elementId: 'portal-cover-image' },
}

/**
 * The section and element id a refused field points at. `field` is what savePortalDraft names: a draft key, or a list
 * position such as `promo_items[1].linkUrl`, resolved here through the ids of the cards and blocks on screen.
 */
export function editorFieldTarget(field: string, ids: { promo: readonly string[]; about: readonly string[] }): FieldTarget | null {
  const fixed = FIELD_TARGETS[field]
  if (fixed) return fixed
  const listed = field.match(/^(promo_items|about_blocks)\[(\d+)\]\.(linkUrl|mediaUrl)$/)
  if (!listed) return null
  const [, list, position, property] = listed
  if (list === 'promo_items') {
    const id = ids.promo[Number(position)]
    if (!id) return null
    return { section: 'posts', elementId: property === 'linkUrl' ? `portal-promo-link-${id}` : `portal-promo-image-${id}` }
  }
  const id = ids.about[Number(position)]
  return id ? { section: 'about', elementId: `portal-about-block-media-${id}` } : null
}
