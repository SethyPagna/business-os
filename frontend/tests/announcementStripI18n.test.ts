import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Regression lock for audit finding i18n:7 (ManagePromotionsModal.tsx / the
// "Announcement Strip" editor): the modal defined its own copy() helper and
// used it for a handful of labels, but hardcoded the modal title, seven form
// labels, the empty-state copy + hint, and the drag-handle aria-label as raw
// English -- so a Khmer session saw English text throughout this editor.
//
// Round 2 (adversarial verifier) found the first pass missed: the two
// DateEntryInput aria-labels (still bare even though their visible labels
// were routed), the "Links to: {x}" / "No link" summary line, the product
// picker's "Select a product…" placeholder, and a long tail of remaining
// bare strings (Cancel/Save/Active/Hidden/Edit/Delete, the delete confirm,
// every toast/validation message, and the input placeholders). This file
// locks all of it down.
//
// This scans the SOURCE (not a render) because the component has no test
// harness in this suite; a raw hardcoded string in JSX/JS is a fact about
// the file text regardless of how it renders. Each assertion below fails on
// the pre-fix file (base 6e3abfea) and passes once the string is routed
// through copy(...).

const ROOT = new URL('../', import.meta.url)
const rootPath = fileURLToPath(ROOT)
const readText = (rel: string): string => fs.readFileSync(path.join(rootPath, rel), 'utf8')
const readJson = (rel: string): Record<string, unknown> => JSON.parse(readText(rel)) as Record<string, unknown>

const SOURCE_REL = 'src/components/catalog/ManagePromotionsModal.tsx'
const source = readText(SOURCE_REL)

// --- 1. none of the raw hardcoded strings the audit found (round 1) remain -

const rawPatterns: Array<[string, RegExp]> = [
  ['modal title', /title="Announcement Strip"/],
  ['Title label', /className="font-medium text-gray-700 dark:text-gray-300">Title \*</],
  ['Subtitle label', /className="font-medium text-gray-700 dark:text-gray-300">Subtitle</],
  ['Badge text label', /className="font-medium text-gray-700 dark:text-gray-300">Badge text</],
  ['Badge color label', /className="font-medium text-gray-700 dark:text-gray-300">Badge color</],
  ['Links to label', /className="font-medium text-gray-700 dark:text-gray-300">Links to</],
  ['Product label', /className="font-medium text-gray-700 dark:text-gray-300">Product \*</],
  ['Show from label', /className="font-medium text-gray-700 dark:text-gray-300">Show from \(optional\)</],
  ['Show until label', /className="font-medium text-gray-700 dark:text-gray-300">Show until \(optional\)</],
  ['Visible now label', /className="font-medium text-gray-700 dark:text-gray-300">Visible on the portal now</],
  ['empty state', /className="text-sm text-gray-500 dark:text-gray-400">No promotions yet\.</],
  ['empty state hint', /Click "New promotion" above to add your first banner\.</],
  ['drag aria-label', /aria-label="Drag to reorder"/],
  // "New promotion above the form" button (JSX text child, not the copy()'d
  // ternary heading and not the quoted fragment inside clickNewPromotionHint).
  ['New promotion button text', />\s*New promotion\s*</],
  // The section heading ternary that swapped between the two raw literals.
  ['New/Edit promotion heading ternary', /'new' \? 'New promotion' : 'Edit promotion'/],
]

for (const [label, pattern] of rawPatterns) {
  assert.equal(pattern.test(source), false, `${SOURCE_REL} still hardcodes the ${label} instead of routing it through copy()`)
}

// --- 1b. round-2 findings: bare strings the adversarial verifier caught ----
// Plain substring checks (not regex) so backtick/template-literal patterns
// don't need escaping. Each needle is the EXACT unrouted form that exists
// verbatim on base 6e3abfea; the fix changes the surrounding code (wraps the
// literal in copy(...) or moves it into a JSON value) so the needle itself
// disappears from the source even though the same English word may still
// appear elsewhere as a copy() fallback argument.
const rawNeedles: Array<[string, string]> = [
  // The two DateEntryInput aria-labels stayed bare even though the visible
  // <span> labels right above them were already routed through copy().
  ['Show-from aria-label', 'ariaLabel="Show from"'],
  ['Show-until aria-label', 'ariaLabel="Show until"'],
  // The per-row "Links to: {x}" / "No link" summary line.
  ['Links-to template prefix', '`Links to: ${'],
  ["'No link' literal (unrouted)", ": 'No link'"],
  // The product AppSelect's placeholder option.
  ["'Select a product…' option label", "label: 'Select a product…'"],
  // Toast / validation strings -- anchored on the call site so a copy()
  // fallback argument carrying the same English text does not false-match.
  ['load-promotions error (unrouted)', "getErrorMessage(error, 'Failed to load promotions')"],
  ['image-upload thrown message (unrouted)', "|| 'Image upload failed')"],
  ['image-upload caught fallback (unrouted)', "getErrorMessage(error, 'Image upload failed')"],
  ['title-required validation (unrouted)', "return 'Title is required'"],
  ['choose-product validation (unrouted)', "return 'Choose a product to link to'"],
  ['enter-link-url validation (unrouted)', "return 'Enter a link URL'"],
  ['end-date validation (unrouted)', "return 'End date must be after start date'"],
  ['promotion-created toast (unrouted)', "notify('Promotion created', 'success')"],
  ['promotion-updated toast (unrouted)', "notify('Promotion updated', 'success')"],
  ['save-promotion error (unrouted)', "getErrorMessage(error, 'Failed to save promotion')"],
  ['delete confirm (unrouted)', 'window.confirm(`Delete "${promo.title}"? This can\'t be undone.`)'],
  ['promotion-deleted toast (unrouted)', "notify('Promotion deleted', 'success')"],
  ['delete-promotion error (unrouted)', "getErrorMessage(error, 'Failed to delete promotion')"],
  ['update-promotion error (unrouted)', "getErrorMessage(error, 'Failed to update promotion')"],
  ['save-order error (unrouted)', "getErrorMessage(error, 'Failed to save new order')"],
  // Placeholders.
  ['title placeholder', 'placeholder="Summer Sale"'],
  ['subtitle placeholder', 'placeholder="20% off all skincare this week"'],
  ['badge text placeholder', 'placeholder="SALE"'],
  ['link URL placeholder', 'placeholder="/catalog?category=Skincare or https://…"'],
  // Save/Cancel/Active/Hidden/Edit/Delete.
  ["Saving/Save-promotion ternary", "'Saving…' : 'Save promotion'"],
  ["Active/Hidden ternary", "'Active' : 'Hidden'"],
  ['Edit title attr', 'title="Edit"'],
  ['Delete title attr', 'title="Delete"'],
  ['Edit aria-label template', 'aria-label={`Edit ${promo.title}`}'],
  ['Delete aria-label template', 'aria-label={`Delete ${promo.title}`}'],
  ['Edit visible label', 'sm:inline">Edit</span>'],
  ['Delete visible label', 'sm:inline">Delete</span>'],
]

for (const [label, needle] of rawNeedles) {
  assert.equal(source.includes(needle), false, `${SOURCE_REL} still hardcodes the ${label} instead of routing it through copy()`)
}

// The bare Cancel button text child (">Cancel</button>") -- regex because it
// must not false-match the copy('cancel', 'Cancel') fallback string.
assert.equal(/>\s*Cancel\s*<\/button>/.test(source), false, `${SOURCE_REL} still hardcodes the Cancel button text instead of routing it through copy()`)

// --- 2. every one of those spots now calls copy() with the expected key --

const copyKeys = [
  'announcementStrip',
  'announcementStripIntro',
  'title',
  'subtitle',
  'badgeText',
  'badgeColor',
  'linksTo',
  'product',
  'showFrom',
  'showFromAria',
  'showUntil',
  'showUntilAria',
  'visibleOnPortalNow',
  'noPromotionsYet',
  'clickNewPromotionHint',
  'dragToReorder',
  'newPromotion',
  'editPromotion',
  'noLink',
  'genericProductLabel',
  'selectProduct',
  'promotionTitlePlaceholder',
  'promotionSubtitlePlaceholder',
  'badgeTextPlaceholder',
  'linkUrlPlaceholder',
  'loadPromotionsFailed',
  'image_upload_failed',
  'titleRequired',
  'chooseProductToLink',
  'enterLinkUrl',
  'endDateAfterStart',
  'promotionCreated',
  'promotionUpdated',
  'savePromotionFailed',
  'deletePromotionConfirm',
  'promotionDeleted',
  'deletePromotionFailed',
  'updatePromotionFailed',
  'saveOrderFailed',
  'cancel',
  'saving',
  'savePromotion',
  'active',
  'hiddenBadge',
  'edit',
  'editItemAria',
  'delete',
  'deleteItemAria',
]

for (const key of copyKeys) {
  const called = new RegExp(`copy\\(\\s*'${key}'`).test(source)
  assert.equal(called, true, `${SOURCE_REL} should call copy('${key}', ...) but no such call was found`)
}

// The two aria-label interpolations must use the {name} placeholder from the
// JSON value, not rebuild the old template-literal form.
assert.ok(/copy\('editItemAria', 'Edit \{name\}'\)\.replace\('\{name\}', promo\.title\)/.test(source), `${SOURCE_REL} editItemAria call should interpolate promo.title via .replace('{name}', ...)`)
assert.ok(/copy\('deleteItemAria', 'Delete \{name\}'\)\.replace\('\{name\}', promo\.title\)/.test(source), `${SOURCE_REL} deleteItemAria call should interpolate promo.title via .replace('{name}', ...)`)
assert.ok(/copy\('deletePromotionConfirm', 'Delete "\{name\}"\? This can\\'t be undone\.'\)\.replace\('\{name\}', promo\.title\)/.test(source), `${SOURCE_REL} deletePromotionConfirm call should interpolate promo.title via .replace('{name}', ...)`)

// --- 3. both packs carry every key this modal now asks for, in Khmer -----

const flatten = (input: Record<string, unknown>, target: Record<string, string> = {}): Record<string, string> => {
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue
    if (typeof value === 'object' && !Array.isArray(value)) flatten(value as Record<string, unknown>, target)
    else target[key] = String(value)
  }
  return target
}

const en = flatten(readJson('src/lang/en.json'))
const km = flatten(readJson('src/lang/km.json'))

// Keys this fix newly introduced (as opposed to reused, pre-existing keys
// like title/product/dragToReorder/announcementStrip/cancel/saving/active/
// edit/delete/image_upload_failed).
const newKeys = [
  'subtitle',
  'badgeText',
  'badgeColor',
  'linksTo',
  'showFrom',
  'showUntil',
  'visibleOnPortalNow',
  'noPromotionsYet',
  'clickNewPromotionHint',
  'newPromotion',
  'editPromotion',
  // round 2
  'showFromAria',
  'showUntilAria',
  'noLink',
  'genericProductLabel',
  'selectProduct',
  'promotionTitlePlaceholder',
  'promotionSubtitlePlaceholder',
  'badgeTextPlaceholder',
  'linkUrlPlaceholder',
  'loadPromotionsFailed',
  'titleRequired',
  'chooseProductToLink',
  'enterLinkUrl',
  'endDateAfterStart',
  'promotionCreated',
  'promotionUpdated',
  'savePromotionFailed',
  'deletePromotionConfirm',
  'promotionDeleted',
  'deletePromotionFailed',
  'updatePromotionFailed',
  'saveOrderFailed',
  'savePromotion',
  'hiddenBadge',
  'editItemAria',
  'deleteItemAria',
  'announcementStripIntro',
]

const KHMER_SCRIPT = /[ក-៿]/

for (const key of newKeys) {
  assert.equal(typeof en[key], 'string', `en.json is missing new key "${key}"`)
  assert.ok(en[key].length > 0, `en.json key "${key}" is empty`)
  assert.equal(typeof km[key], 'string', `km.json is missing new key "${key}"`)
  assert.ok(KHMER_SCRIPT.test(km[key]), `km.json key "${key}" ("${km[key]}") does not look like real Khmer text`)
}

// The keys this fix reused must already resolve in both packs (sanity check
// that the reuse claim -- e.g. "portalEditor.dragToReorder exists translated
// in both packs" -- actually holds).
for (const key of ['title', 'product', 'dragToReorder', 'announcementStrip', 'cancel', 'saving', 'active', 'edit', 'delete', 'image_upload_failed']) {
  assert.equal(typeof en[key], 'string', `en.json is missing reused key "${key}"`)
  assert.equal(typeof km[key], 'string', `km.json is missing reused key "${key}"`)
}

// The {name}/{name} interpolation placeholders must survive verbatim in both
// packs -- otherwise .replace('{name}', ...) silently no-ops and the alert
// text names nobody.
for (const key of ['editItemAria', 'deleteItemAria']) {
  assert.ok(en[key].includes('{name}'), `en.json "${key}" ("${en[key]}") must contain the {name} placeholder`)
  assert.ok(km[key].includes('{name}'), `km.json "${key}" ("${km[key]}") must contain the {name} placeholder`)
}
assert.ok(en['deletePromotionConfirm'].includes('{name}'), `en.json "deletePromotionConfirm" must contain the {name} placeholder`)
assert.ok(km['deletePromotionConfirm'].includes('{name}'), `km.json "deletePromotionConfirm" must contain the {name} placeholder`)

// --- 4. the empty-state hint must name the button it actually renders -----
// clickNewPromotionHint quotes a label ("New promotion" in en, "ប្រូម៉ូសិនថ្មី"
// in km) that has to be the exact text the New-promotion button renders via
// copy('newPromotion', ...) -- otherwise the hint can point at a label the
// button never shows. Extract the quoted fragment from each pack's hint and
// tie it directly to that pack's newPromotion value.
const extractQuoted = (value: string): string => {
  const match = /"([^"]+)"/.exec(value)
  assert.ok(match, `could not find a quoted fragment inside "${value}"`)
  return match![1]
}

assert.equal(
  extractQuoted(en['clickNewPromotionHint']),
  en['newPromotion'],
  `en.json clickNewPromotionHint quotes "${extractQuoted(en['clickNewPromotionHint'])}" but the New-promotion button renders "${en['newPromotion']}"`,
)
assert.equal(
  extractQuoted(km['clickNewPromotionHint']),
  km['newPromotion'],
  `km.json clickNewPromotionHint quotes "${extractQuoted(km['clickNewPromotionHint'])}" but the New-promotion button renders "${km['newPromotion']}"`,
)

console.log('PASS announcementStripI18n: ManagePromotionsModal routes every audited label through copy(), and both packs carry the keys')
