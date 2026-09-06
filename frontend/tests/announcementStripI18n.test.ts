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
// This scans the SOURCE (not a render) because the component has no test
// harness in this suite; a raw hardcoded string in JSX is a fact about the
// file text regardless of how it renders. Each assertion below fails on the
// pre-fix file (base 6e3abfea) and passes once the string is routed through
// copy(...).

const ROOT = new URL('../', import.meta.url)
const rootPath = fileURLToPath(ROOT)
const readText = (rel: string): string => fs.readFileSync(path.join(rootPath, rel), 'utf8')
const readJson = (rel: string): Record<string, unknown> => JSON.parse(readText(rel)) as Record<string, unknown>

const SOURCE_REL = 'src/components/catalog/ManagePromotionsModal.tsx'
const source = readText(SOURCE_REL)

// --- 1. none of the raw hardcoded strings the audit found remain ---------

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

// --- 2. every one of those spots now calls copy() with the expected key --

const copyKeys = [
  'announcementStrip',
  'title',
  'subtitle',
  'badgeText',
  'badgeColor',
  'linksTo',
  'product',
  'showFrom',
  'showUntil',
  'visibleOnPortalNow',
  'noPromotionsYet',
  'clickNewPromotionHint',
  'dragToReorder',
  'newPromotion',
  'editPromotion',
]

for (const key of copyKeys) {
  const called = new RegExp(`copy\\(\\s*'${key}'`).test(source)
  assert.equal(called, true, `${SOURCE_REL} should call copy('${key}', ...) but no such call was found`)
}

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
// like title/product/dragToReorder/announcementStrip).
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
]

const KHMER_SCRIPT = /[ក-៿]/

for (const key of newKeys) {
  assert.equal(typeof en[key], 'string', `en.json is missing new key "${key}"`)
  assert.ok(en[key].length > 0, `en.json key "${key}" is empty`)
  assert.equal(typeof km[key], 'string', `km.json is missing new key "${key}"`)
  assert.ok(KHMER_SCRIPT.test(km[key]), `km.json key "${key}" ("${km[key]}") does not look like real Khmer text`)
}

// The keys this fix reused must already resolve in both packs (sanity check
// that the reuse claim in the audit -- "portalEditor.dragToReorder exists
// translated in both packs" -- actually holds).
for (const key of ['title', 'product', 'dragToReorder', 'announcementStrip']) {
  assert.equal(typeof en[key], 'string' , `en.json is missing reused key "${key}"`)
  assert.equal(typeof km[key], 'string', `km.json is missing reused key "${key}"`)
}

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
