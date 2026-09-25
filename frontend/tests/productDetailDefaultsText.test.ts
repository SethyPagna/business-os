// P3-L3 item B: the premade Caution / Need More Details wording is offered
// in the portal editor as a one-tap "Use suggested text", never written to
// settings on its own (Part 328: an admin must accept it), and the Worker
// serves the SAVED value to every product's detail flyout.
//
// Run: node tests/productDetailDefaultsText.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PRODUCT_CAUTION_SUGGESTED_TEXT,
  PRODUCT_CAUTION_SUGGESTED_TEXT_KM,
  PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT,
  PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT_KM,
  resolveProductDetailDefault,
} from '../src/components/catalog/productDetailDefaultsText.ts'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// 1. The wording itself: two complete sentences the shop can stand behind,
//    no mojibake, and the caution really is a caution.
for (const [name, text] of [
  ['caution', PRODUCT_CAUTION_SUGGESTED_TEXT],
  ['need-more-details', PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT],
] as const) {
  assert.ok(text.length > 100, `${name} suggested text is a real paragraph`)
  assert.ok(text.endsWith('.'), `${name} suggested text ends as a sentence`)
  assert.doesNotMatch(text, /Ã|â€|�/, `${name} suggested text is mojibake`)
}
assert.match(PRODUCT_CAUTION_SUGGESTED_TEXT, /For external use only/)
assert.match(PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT, /^Contact us/)

// 2. The editor offers it for BOTH fields through the same control: the
//    suggestion is the placeholder and the one-tap value, keyed to the
//    settings key the Save path already persists.
const editor = read('src/components/catalog/CatalogEditorSurface.tsx')
assert.match(editor, /import \{ PRODUCT_CAUTION_SUGGESTED_TEXT, PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT \} from '\.\/productDetailDefaultsText\.ts'/)
for (const [settingKey, constant] of [
  ['customer_portal_product_caution_default', 'PRODUCT_CAUTION_SUGGESTED_TEXT'],
  ['customer_portal_product_need_more_details_default', 'PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT'],
]) {
  const field = new RegExp(`<SuggestedTextField[^>]*settingKey="${settingKey}"[^>]*suggestedText=\\{${constant}\\}`, 's')
  assert.match(editor, field, `${settingKey} is offered the ${constant} suggestion`)
}
const control = editor.slice(editor.indexOf('function SuggestedTextField'), editor.indexOf('export default function CatalogEditorSurface'))
assert.match(control, /placeholder=\{suggestedText\}/, 'the suggestion is still shown as the placeholder')
assert.match(control, /onClick=\{\(\) => setDraft\(settingKey, suggestedText\)\}/, 'one tap writes the suggestion into the draft')
assert.match(control, /\{value\.trim\(\) \? null : \(/, 'the button hides once the field holds text, so a tap never overwrites it')
assert.doesNotMatch(editor, /Follow the instructions on the product packaging/, 'the wording lives in productDetailDefaultsText.ts only')

// 3. Both packs label the tap.
for (const pack of ['en', 'km']) {
  const json = JSON.parse(read(`src/lang/${pack}.json`)) as Record<string, unknown>
  assert.ok(String(json.productDefaultsUseSuggested || '').trim(), `${pack}.json has productDefaultsUseSuggested`)
}

// 4. The Worker serves the saved value (commit 1de16b4a, ported): the flyout
//    reads productCautionDefault / productNeedMoreDetailsDefault from the
//    public config, so nothing here depends on the editor's live preview.
const worker = read('../cloudflare/src/routes/portal.ts')
assert.match(worker, /productCautionDefault: settings\.customer_portal_product_caution_default \|\| ''/)
assert.match(worker, /productNeedMoreDetailsDefault: settings\.customer_portal_product_need_more_details_default \|\| ''/)

// 5. Owner, 2026-09-25: the owner's texts ARE the default whenever a product
//    has no value of its own -- with nothing saved in settings too, which is
//    the state that used to show "No product-specific caution has been added
//    yet." / "Contact us for more product details." instead.
assert.equal(PRODUCT_CAUTION_SUGGESTED_TEXT, 'Follow the instructions on the product packaging and use the product only as directed. Stop use if unexpected irritation, discomfort, or another adverse reaction occurs. Contact us if you need help confirming the exact variant or usage details before purchase. For external use only. Avoid contact with eyes.')
assert.equal(PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT, 'Contact us if you need additional product details, variant confirmation, usage guidance, or help comparing suitable options. Consider how the product fits into your existing routine and what finish, function, or application style you want. For products where ingredients, shade compatibility, or personal suitability matter, check the exact packaging details before use.')
for (const [name, text] of [['caution', PRODUCT_CAUTION_SUGGESTED_TEXT_KM], ['need-more-details', PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT_KM]] as const) {
  assert.match(text, /^[ក-៿᧠-᧿\s]+$/u,`${name} Khmer text is Khmer only (no English left in)`)
  assert.ok(text.endsWith('។'), `${name} Khmer text ends as a Khmer sentence`)
}
// Same number of sentences as the English it translates (5 and 3).
assert.equal(PRODUCT_CAUTION_SUGGESTED_TEXT_KM.split('។').filter(Boolean).length, 5)
assert.equal(PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT_KM.split('។').filter(Boolean).length, 3)

// Nothing saved: owner text in the page language.
assert.equal(resolveProductDetailDefault('caution', '', 'km'), PRODUCT_CAUTION_SUGGESTED_TEXT_KM)
assert.equal(resolveProductDetailDefault('caution', undefined, 'en'), PRODUCT_CAUTION_SUGGESTED_TEXT)
assert.equal(resolveProductDetailDefault('need_more_details', '   ', 'km'), PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT_KM)
assert.equal(resolveProductDetailDefault('need_more_details', null, 'fr'), PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT, 'Google languages translate from the English page')
// The merchant's own saved text wins, in every language.
assert.equal(resolveProductDetailDefault('caution', ' Patch test first. ', 'km'), 'Patch test first.')
// "Use suggested text" saved the English owner text (reflowed whitespace and
// all): a Khmer page still gets Khmer.
assert.equal(resolveProductDetailDefault('caution', PRODUCT_CAUTION_SUGGESTED_TEXT.replace(/\. /g, '.\n'), 'km'), PRODUCT_CAUTION_SUGGESTED_TEXT_KM)

// 6. The flyout uses the resolver for both, and no longer has a generic
//    last-resort line of its own.
const flyout = read('src/components/catalog/ProductDetailFlyout.tsx')
assert.match(flyout, /: \[resolveProductDetailDefault\('caution', cautionDefault, language\)\]/, 'caution falls back to the owner default')
assert.match(flyout, /const needMoreDetailsText = resolveProductDetailDefault\('need_more_details', needMoreDetailsDefault, language\)/)
assert.doesNotMatch(flyout, /No product-specific caution has been added yet|Contact us for more product details\./)
const surface = read('src/components/catalog/CatalogPreviewSurface.tsx')
assert.match(surface, /needMoreDetailsDefault=\{productDetailNeedMoreDetailsDefault\}\s*language=\{translateTarget\}/,'the flyout is told the page language')

console.log('productDetailDefaultsText tests passed')
