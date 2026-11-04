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

// Draft keys are stored without their shared prefix: every portal key is customer_portal_<name> except the business identity ones, which
// are written out in full. (A key can still be found by grepping its <name> and the prefix together in buildDraft.)
const portalKeys = (names: string): string[] => names.split(' ').map((name) => 'customer_portal_' + name)

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
      'business_name',
      ...portalKeys(
        'business_tagline intro logo_image show_logo logo_size logo_fit logo_zoom logo_position_x logo_position_y ' +
        'cover_image show_cover hero_gradient_start hero_gradient_mid hero_gradient_end'
      ),
    ],
  },
  {
    id: 'contact',
    domId: 'portal-section-contact',
    icon: 'phone',
    label: ['web_editor_section_contact', 'Contact', 'ទំនាក់ទំនង'],
    grants: ['customer_portal'],
    keys: [
      'business_phone',
      'business_email',
      'business_address',
      'business_legal_name',
      'business_registration_number',
      // Written out in full: a bare telegram_label would read as a Settings-only row name to the guard in bootstrapSettingsReaders.test.ts.
      'customer_portal_telegram_label',
      ...portalKeys(
        'address_link show_phone show_email show_address website website_label show_website facebook facebook_label ' +
        'show_facebook instagram instagram_label show_instagram telegram show_telegram contact_messenger ' +
        'contact_messenger_label show_contact_messenger contact_telegram contact_telegram_label show_contact_telegram ' +
        'contact_instagram contact_instagram_label show_contact_instagram contact_whatsapp contact_whatsapp_label ' +
        'show_contact_whatsapp contact_phone contact_phone_label show_contact_phone google_maps_embed show_google_map'
      ),
    ],
  },
  {
    id: 'products',
    domId: 'portal-section-products',
    icon: 'shopping-bag',
    label: ['web_editor_section_products', 'Products', 'ផលិតផល'],
    grants: ['customer_portal'],
    keys: [
      ...portalKeys(
        'show_catalog show_prices show_out_of_stock_products show_stock_status show_product_brand show_product_category ' +
        'show_product_discount price_display refresh_seconds grid_columns_auto grid_columns_mobile grid_columns_desktop ' +
        'show_top_seller_badge show_top_product_badge show_recommended_badge show_promotion_badge show_new_arrival_badge ' +
        'highlight_rank_limit recommended_product_ids product_caution_default product_need_more_details_default ' +
        'stock_threshold_mode low_stock_threshold out_of_stock_threshold'
      ),
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
      ...portalKeys(
        'announcement_enabled announcement_text_en announcement_text_km announcement_link announcement_start ' +
        'announcement_end show_promotions promotions_title promotions_intro promo_items'
      ),
    ],
  },
  {
    id: 'about',
    domId: 'portal-section-about',
    icon: 'store',
    label: ['web_editor_section_about', 'About', 'អំពី'],
    grants: ['portal_about'],
    keys: [
      ...portalKeys('show_about about_title about_image about_image_alt about_content about_blocks'),
    ],
  },
  {
    id: 'faq',
    domId: 'portal-section-faq',
    icon: 'help-circle',
    label: ['web_editor_section_faq', 'FAQ', 'សំណួរញឹកញាប់'],
    grants: ['portal_faq'],
    keys: [
      ...portalKeys('show_faq faq_title faq_items'),
    ],
  },
  {
    id: 'features',
    domId: 'portal-section-features',
    icon: 'layout-grid',
    label: ['web_editor_section_features', 'Features', 'មុខងារ'],
    grants: ['customer_portal'],
    keys: [
      ...portalKeys(
        'ai_enabled ai_title ai_provider_id ai_intro ai_disclaimer ai_prompt path public_url translate_widget_enabled ' +
        'translations language submission_enabled submission_instructions'
      ),
    ],
  },
]

// Draft keys no field edits: carried by buildDraft and the save payload, but never typed into.
export const HIDDEN_DRAFT_KEYS: readonly string[] = portalKeys(
  'favicon_image title title_size show_membership points_basis points_per_usd points_per_khr redeem_points ' +
  'redeem_value_usd redeem_value_khr show_point_value membership_info_text submission_reward_points'
)

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

/** The element ids a tab panel is labelled by: the tab on a wide screen, the picker button below 768 px. */
export const sectionTabId = (id: EditorSectionId): string => 'portal-tab-' + id
export const SECTION_PICKER_ID = 'portal-section-picker'

export const EDITOR_SECTION_STORAGE_KEY = 'business-os-website-editor-section-v1'
type SectionStorage = Pick<Storage, 'getItem' | 'setItem'>

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
