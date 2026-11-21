// The three layers of the Products page, as class recipes (spec section 1 of the
// public web overhaul): page (ivory, painted by the shell), surface, field.
// Every recipe is solid: no opacity suffix, no blur, no transparent fill.
import { portalPrimaryValue } from './portalMultiValue.ts'

// A card, sheet or menu panel that sits over the page.
export const PRODUCT_SURFACE_CLASS = 'border border-stone-300 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900'

// The quiet tint of a secondary block: the filter panel, the About details rows, a segment track, a contact row, a notice. Light is warm #faf6ef with a
// #e3d9c8 border (PORTAL_TOKENS.light.inset / insetLine); dark keeps the neutral-800 fill it always had, with its neutral-700 border. The border is
// part of the recipe on purpose: two neighbouring functions never share a tone without a line between them (owner A61, 21 Nov 2026).
export const PRODUCT_INSET_CLASS = 'border border-[#e3d9c8] bg-[#faf6ef] dark:border-neutral-700 dark:bg-neutral-800'

// A section header band or an active state (the chosen segment, a hovered row): the light brand tint #f6ece0 with the dark ink.
export const PRODUCT_BAND_CLASS = 'border border-[#e3d9c8] bg-[#f6ece0] text-[#23201b] dark:border-neutral-600 dark:bg-neutral-700 dark:text-white'

// Inputs, the search field and select triggers. The line is stone-500 / neutral-500, not the
// spec's first-draft stone-400 / neutral-600: those measure 2.24:1 on ivory and 2.52:1 on the dark
// ground, under the 3:1 a control boundary needs (tests/portalProductSurfaces.test.ts).
export const PRODUCT_FIELD_CLASS = 'border border-stone-500 bg-white text-[#23201b] placeholder:text-stone-500 focus-visible:border-[#7a5c22] dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-400 dark:focus-visible:border-[#d6b56b]'

// A control that is "on" (the Filters button with filters set, a chosen chip).
export const PRODUCT_ACTIVE_CLASS = 'border-[#7a5c22] bg-[#7a5c22] text-white dark:border-[#d6b56b] dark:bg-[#d6b56b] dark:text-[#23201b]'

// A quiet control: a field's line and fill, brass on hover.
export const PRODUCT_CONTROL_CLASS = `${PRODUCT_FIELD_CLASS} hover:border-[#7a5c22] hover:text-[#7a5c22] dark:hover:border-[#d6b56b] dark:hover:text-[#d6b56b]`

// A pill that picks one value out of a row (View, Sort, stock status).
export const PRODUCT_CHIP_CLASS = 'border-stone-400 bg-white text-[#23201b] hover:border-[#7a5c22] hover:text-[#7a5c22] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-[#d6b56b] dark:hover:text-[#d6b56b]'

// Secondary text on a surface.
export const PRODUCT_MUTED_TEXT_CLASS = 'text-stone-600 dark:text-neutral-300'

// The stock label on a product photo or in the detail sheet: a solid pill, ink by status. The ink
// steps (rose-700, amber-800, emerald-700) all clear 4.5:1 on the white fill; in dark mode the -300
// steps clear it on neutral-900.
export function productStockBadge(status: string): { pillClass: string; dotClass: string } {
  const base = 'border border-stone-300 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900'
  if (status === 'out_of_stock') return { pillClass: `${base} text-rose-700 dark:text-rose-300`, dotClass: 'bg-rose-500' }
  if (status === 'low_stock') return { pillClass: `${base} text-amber-800 dark:text-amber-300`, dotClass: 'bg-amber-500' }
  return { pillClass: `${base} text-emerald-700 dark:text-emerald-300`, dotClass: 'bg-emerald-500' }
}

export type ProductMetaField = { kind: 'category' | 'brand'; text: string }

// The card's one meta line: category, then brand. A field the group heading above the card already
// says (View: brand puts every grouped card under its brand; View: category under its category) is
// left out, and so is a field the merchant hides. The promoted block above the first heading
// (`underGroupHeading` false) keeps both: its heading says "Promotions", not a brand.
export function productMetaFields(
  product: { category?: unknown; brand?: unknown; categories?: unknown; brands?: unknown },
  { showCategory, showBrand, groupField, underGroupHeading }: {
    showCategory: boolean
    showBrand: boolean
    groupField: 'brand' | 'category' | null
    underGroupHeading: boolean
  },
): ProductMetaField[] {
  const said = underGroupHeading ? groupField : null
  const fields: ProductMetaField[] = [
    { kind: 'category', text: showCategory && said !== 'category' ? portalPrimaryValue(product.category, product.categories) : '' },
    { kind: 'brand', text: showBrand && said !== 'brand' ? portalPrimaryValue(product.brand, product.brands) : '' },
  ]
  return fields.filter((field) => field.text)
}
