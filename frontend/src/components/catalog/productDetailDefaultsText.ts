// The premade Caution / Need More Details wording the portal editor offers
// for the storefront's product detail view (Part 328: an admin must ACCEPT
// it -- it is never written to settings on its own).
//
// Until 2026-09-14 this text existed only as the two textareas' placeholders
// in CatalogEditorSurface.tsx, so "accepting" it meant retyping it. The
// owner's "premade caution and need more detail ... haven't been applied"
// is exactly that gap: the editor now offers a one-tap "Use suggested text"
// that writes THIS text into the draft, and the normal Save path persists
// it (customer_portal_product_caution_default /
// customer_portal_product_need_more_details_default), which
// buildPortalConfig then serves to every product's detail flyout.
//
// Same reasoning as faqStarterText.ts for living in a React-free module:
// the app is speaking on the merchant's behalf here, and
// tests/productDetailDefaultsText.test.ts imports the one copy of the
// wording instead of keeping its own.
export const PRODUCT_CAUTION_SUGGESTED_TEXT = 'Follow the instructions on the product packaging and use the product only as directed. Stop use if unexpected irritation, discomfort, or another adverse reaction occurs. Contact us if you need help confirming the exact variant or usage details before purchase. For external use only. Avoid contact with eyes.'

export const PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT = 'Contact us if you need additional product details, variant confirmation, usage guidance, or help comparing suitable options. Consider how the product fits into your existing routine and what finish, function, or application style you want. For products where ingredients, shade compatibility, or personal suitability matter, check the exact packaging details before use.'

// Owner, 2026-09-25: these two texts are the defaults "whenever a product has
// no specific value" -- on the storefront, not only in the editor. Part 328
// still stands for SETTINGS (nothing is written on the merchant's behalf);
// what changed is the flyout's last resort. Before this, an unsaved setting
// fell through to "No product-specific caution has been added yet." / "Contact
// us for more product details.", so the owner's own wording never reached a
// single product unless an admin had tapped "Use suggested text" and saved.
//
// Khmer versions, for the storefront's default language. Faithful to the
// English sentence by sentence; "variant" is rendered as the product's exact
// type/shade (ប្រភេទ), which is what the shop means by it.
export const PRODUCT_CAUTION_SUGGESTED_TEXT_KM = 'សូមធ្វើតាមការណែនាំនៅលើកញ្ចប់ផលិតផល ហើយប្រើប្រាស់ផលិតផលតាមការណែនាំតែប៉ុណ្ណោះ។ សូមឈប់ប្រើប្រាស់ ប្រសិនបើមានការរលាក ភាពមិនស្រួល ឬប្រតិកម្មមិនល្អផ្សេងទៀតដែលមិនបានរំពឹងទុកកើតឡើង។ សូមទាក់ទងមកយើង ប្រសិនបើអ្នកត្រូវការជំនួយក្នុងការបញ្ជាក់ប្រភេទផលិតផលឱ្យបានច្បាស់ ឬព័ត៌មានលម្អិតអំពីរបៀបប្រើប្រាស់ មុនពេលទិញ។ សម្រាប់ប្រើប្រាស់ខាងក្រៅតែប៉ុណ្ណោះ។ ជៀសវាងកុំឱ្យប៉ះភ្នែក។'

export const PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT_KM = 'សូមទាក់ទងមកយើង ប្រសិនបើអ្នកត្រូវការព័ត៌មានលម្អិតបន្ថែមអំពីផលិតផល ការបញ្ជាក់ប្រភេទផលិតផល ការណែនាំអំពីរបៀបប្រើប្រាស់ ឬជំនួយក្នុងការប្រៀបធៀបជម្រើសដែលសមស្រប។ សូមពិចារណាថាតើផលិតផលនេះសមនឹងទម្លាប់ប្រចាំថ្ងៃរបស់អ្នកយ៉ាងដូចម្តេច និងលទ្ធផលលើស្បែក មុខងារ ឬរបៀបលាបដែលអ្នកចង់បាន។ សម្រាប់ផលិតផលដែលគ្រឿងផ្សំ ភាពត្រូវគ្នានៃពណ៌ ឬភាពសមស្របផ្ទាល់ខ្លួនមានសារៈសំខាន់ សូមពិនិត្យព័ត៌មានលម្អិតនៅលើកញ្ចប់ឱ្យបានច្បាស់មុនពេលប្រើប្រាស់។'

export type ProductDetailDefaultKind = 'caution' | 'need_more_details'

const OWNER_DEFAULTS: Record<ProductDetailDefaultKind, { en: string; km: string }> = {
  caution: { en: PRODUCT_CAUTION_SUGGESTED_TEXT, km: PRODUCT_CAUTION_SUGGESTED_TEXT_KM },
  need_more_details: { en: PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT, km: PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT_KM },
}

const collapse = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

/**
 * The text a product with no value of its own shows for Caution / Need More
 * Details. Order: the merchant's saved portal-wide text, else the owner's
 * default in the page language (Khmer on a Khmer page, English otherwise --
 * any other language is Google-translated from the English page).
 *
 * A saved value that IS the English suggestion (what "Use suggested text"
 * writes) counts as the owner default, so a Khmer page still gets Khmer
 * instead of the English copy the button happened to save.
 */
export function resolveProductDetailDefault(kind: ProductDetailDefaultKind, configured: unknown, language: unknown): string {
  const owner = OWNER_DEFAULTS[kind]
  const saved = String(configured ?? '').trim()
  if (saved && collapse(saved) !== collapse(owner.en)) return saved
  return String(language ?? '').trim().toLowerCase() === 'km' ? owner.km : owner.en
}
