// The three layers of the Products page, as class recipes (spec section 1 of the
// public web overhaul): page (ivory, painted by the shell), surface, field.
// Every recipe is solid: no opacity suffix, no blur, no transparent fill.

// A card, sheet or menu panel that sits over the page.
export const PRODUCT_SURFACE_CLASS = 'border border-stone-300 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900'

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
