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
