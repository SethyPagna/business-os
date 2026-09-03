// Typed mirror of the --z-* custom properties in styles/tokens.css, for the
// rare spot that needs a stacking value in JS (computing an inline z-index,
// comparing layers) rather than a CSS var. Keep the two in sync by hand;
// frontend/tests/kitTokens.test.ts pins both sides so a drift fails loudly.
//
// Values deliberately do NOT match the P2-1 brief's literal spec numbers
// (sticky:20/dropdown:30/fold:40/modal:50/modal-2:60/toast:70) for the
// four body-portal layers -- see the long comment on tokens.css's
// `--z-fold`/`--z-modal`/`--z-modal-2`/`--z-toast` declarations for why:
// this app already has an established global scale for elements portalled
// to document.body (Modal.tsx z-[1050], OtpModal's modal-over-modal
// z-[1060], App.tsx's toast z-[1100], etc.), and using small numbers here
// would silently sink every one of them below existing body-portal
// widgets. --sticky/--dropdown keep the spec's small values -- they are for
// page-local (non-portalled) stacking only.
export const zLayers = {
  /** Page-local sticky headers/rows (search+date rows, table thead). Never
   *  portalled -- competes only inside the page's own stacking context. */
  sticky: 20,
  /** Page-local, non-portalled dropdowns/menus. A PortalMenu/LazyPortalMenu-
   *  backed menu (e.g. OverflowMenu) carries its own fixed z-index (9999)
   *  and does not read this token. */
  dropdown: 30,
  /** Fold's floating panel (>=768px) / bottom sheet (<768px) -- portalled
   *  to document.body. Sits above BackgroundImportTracker/NotesWidget/
   *  NotificationCenter's dropdown (1000/1001/1010), below Modal. */
  fold: 1020,
  /** Level-3 deep-action modals (Modal.tsx). Matches Modal.tsx's own
   *  existing z-[1050] exactly -- see its in-file comment for the history
   *  of why that specific value was chosen. */
  modal: 1050,
  /** A modal opened from within another modal (e.g. OtpModal's inner
   *  step). Matches OtpModal's existing z-[1060]. */
  modal2: 1060,
  /** A modal opened from within a modal-over-modal -- the third and, so far,
   *  deepest real chain in the app: Products' ProductDetailModal (modal) ->
   *  ProductDetailReport's drill-down float, which portals to document.body
   *  itself (modal2) -> AttributeSupplierModal, opened from inside that float
   *  (modal3). Added by P2-4 Part 1b, which replaced ProductDetailReport's
   *  literal `z-[1070]`; before that the chain's top two tiers would have had
   *  to share 1060 and their order would have depended on portal insertion
   *  order rather than on intent. */
  modal3: 1070,
  /** Toast/snackbar notifications -- must outrank every modal. Matches
   *  App.tsx's existing toast z-[1100]. */
  toast: 1100,
} as const

export type ZLayerName = keyof typeof zLayers

/** `var(--z-<name>)` for inline styles that want to stay CSS-var-driven
 *  (so a future tokens.css edit doesn't require a JS change too) while
 *  still getting autocomplete/typo-safety on the layer name. */
export function zLayerVar(name: ZLayerName): string {
  // The two multi-word layer names are camelCase in JS and hyphenated in CSS
  // (`modal2` -> `--z-modal-2`, `modal3` -> `--z-modal-3`); every other name
  // is identical on both sides.
  const cssName = name === 'modal2' ? 'modal-2' : name === 'modal3' ? 'modal-3' : name
  return `var(--z-${cssName})`
}
