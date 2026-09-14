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
  PRODUCT_NEED_MORE_DETAILS_SUGGESTED_TEXT,
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

console.log('productDetailDefaultsText tests passed')
