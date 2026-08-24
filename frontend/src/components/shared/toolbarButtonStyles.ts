// One shared pattern for the "Manage" / "Add X" buttons that sit in a
// page's top toolbar row (Products/Inventory/Sales' Manage dropdown
// trigger, Fees' Add Fee button, Users' Add user / Create role, etc).
//
// Before this file existed, every page hand-rolled its own version of
// this Tailwind string, and they'd quietly drifted apart: Products'
// HeaderActions.tsx had `flex-1 sm:flex-none` (equal-width on mobile,
// natural/compact width on desktop -- the deliberate fix from an
// earlier "actions button can be made tighter" ask, see that file's own
// comment), but Sales.tsx and Inventory.tsx's Manage buttons used
// `w-full` inside a `flex-1` wrapper with no `sm:flex-none` cap, so they
// kept stretching to fill all available width on large screens instead
// of settling to their content size. Fees' "Add Fee" button skipped this
// sizing pattern entirely and fell back to `.btn-primary`'s own
// min-height, which reads too small/plain next to pages that do use
// this pattern. Users' "Add user"/"Create role" buttons had `flex-1`
// with no desktop cap either, so they over-widened the same way.
// (User-reported, Aug 23 2026: "History/Manage/Product button sizing on
// large screens" + "manage/add buttons on other pages too wide/long in
// some places and too small in others, Fees named explicitly.")
//
// Import this instead of retyping the sizing string, so a future
// tweak to the pattern (e.g. a different mobile breakpoint) only needs
// one edit.

// Fixed height + icon/label sizing, independent of how wide the button
// is allowed to grow.
export const TOOLBAR_BUTTON_BASE =
  'inline-flex h-9 items-center justify-center gap-1.5 overflow-hidden rounded-xl px-3 text-xs font-semibold sm:text-sm'

// Equal-share width on the narrowest screens (so a row of 2-3 toolbar
// buttons stays easy to tap edge-to-edge), settling to natural content
// width from `sm` up instead of stretching across the whole row.
export const TOOLBAR_BUTTON_WIDTH = 'min-w-0 flex-1 sm:flex-none'

export const TOOLBAR_BUTTON_SIZING = `${TOOLBAR_BUTTON_BASE} ${TOOLBAR_BUTTON_WIDTH}`

// Ready-to-use className strings for the two common toolbar-button
// looks: the neutral "Manage" trigger (secondary) and a primary action
// like "Add product" / "Add Fee" / "Add user".
export const manageToolbarButtonClassName = `btn-secondary ${TOOLBAR_BUTTON_SIZING}`
export const primaryToolbarButtonClassName = `btn-primary ${TOOLBAR_BUTTON_SIZING}`
