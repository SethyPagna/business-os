// The policies tell visitors what the storefront really does with their browser:
//   - Privacy has a Translation section: Chinese (both scripts), French and Spanish are produced by
//     Google Translate in the visitor's browser when they pick one, the page text is then sent to Google,
//     and nothing is sent on Khmer or English.
//   - The cookie table has a row for every storage key the storefront writes, and no row for a key that
//     no longer exists. googtrans is the one row with no writer in this tree: Google Translate sets it
//     (the controller that loads it belongs to the language menu).
//
// Run: node tests/portalLegalTranslateDisclosure.test.ts
import assert from 'node:assert/strict'
import ts from 'typescript'
import { LEGAL_PAGE_SECTIONS, LEGAL_STORAGE_ROWS, PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'
import { AI_CONSENT_STORAGE_KEY } from '../src/components/catalog/legal/aiProviderDisclosure.ts'
import { parseSource, storefrontModules } from './storefrontCopyScan.ts'

// 1. The privacy paragraph.
const privacySections = LEGAL_PAGE_SECTIONS.privacy
const translation = privacySections.find((section) => section.heading === 'portal_legal_privacy_translate_h')
assert.ok(translation, 'the Privacy Policy has no Translation section')
assert.deepEqual(translation.bodies, ['portal_legal_privacy_translate_b'], 'the Translation section is one paragraph')
const en = PORTAL_LEGAL_EN.portal_legal_privacy_translate_b
const km = PORTAL_LEGAL_KM.portal_legal_privacy_translate_b
for (const fact of [/Simplified Chinese, Traditional Chinese, French and Spanish/, /Google Translate in your browser when you pick one of them/, /page text is then sent to Google/, /If you stay on Khmer or English, nothing is sent to Google/]) {
  assert.match(en, fact, `the English Translation paragraph lost: ${fact}`)
}
assert.match(en, /^[^]*\.$/, 'the paragraph ends in a full stop')
assert.equal(en.split('. ').length, 3, 'three plain sentences')
for (const fact of [/ចិនសាមញ្ញ/, /ចិនប្រពៃណី/, /បារាំង/, /អេស្ប៉ាញ/, /Google Translate/, /ភាសាខ្មែរ ឬអង់គ្លេស/, /គ្មានអ្វីត្រូវបានផ្ញើទៅ Google/]) {
  assert.match(km, fact, `the Khmer Translation paragraph lost: ${fact}`)
}
assert.equal(PORTAL_LEGAL_EN.portal_legal_privacy_translate_h, 'Translation')
assert.match(PORTAL_LEGAL_EN.portal_legal_cookies_third_b, /Google Translate, which sets the googtrans cookie/)
assert.match(PORTAL_LEGAL_KM.portal_legal_cookies_third_b, /Google Translate ដែលកំណត់ខូឃី googtrans/)

// 2. The rows.
const rowByName = new Map(LEGAL_STORAGE_ROWS.map((row) => [row.name, row]))
const googtrans = rowByName.get('googtrans')
assert.ok(googtrans, 'no googtrans row')
assert.equal(googtrans.kindKey, 'portal_legal_kind_cookie')
assert.match(PORTAL_LEGAL_EN[googtrans.purposeKey], /only after you pick Simplified Chinese, Traditional Chinese, French or Spanish/)
assert.equal(rowByName.get(AI_CONSENT_STORAGE_KEY)?.kindKey, 'portal_legal_kind_local', 'the assistant-consent key has a local-storage row')
assert.match(PORTAL_LEGAL_EN[rowByName.get(AI_CONSENT_STORAGE_KEY)!.purposeKey], /agreed on this device to send questions to the assistant/)
assert.match(PORTAL_LEGAL_EN[rowByName.get('business-os-portal-list-images-v1')!.purposeKey], /Pictures for the products in your list, on this device/)

// 3. Every storage key the storefront names in code has a row, and every row names a key that exists.
const KEY_SHAPE = /^(business-os-portal-[a-z-]+-v1|business-os:portal-[a-z-]+)$/
const keysInCode = new Map<string, string>()
for (const file of storefrontModules()) {
  const source = parseSource(file)
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) && KEY_SHAPE.test(node.text)) keysInCode.set(node.text, file)
    ts.forEachChild(node, visit)
  }
  visit(source)
}
for (const [key, file] of keysInCode) {
  assert.ok(rowByName.has(key), `${key} is written by ${file.split('src').pop()} but the cookie table has no row for it`)
}
const CODE_FREE_ROWS = new Set(['bos_portal', 'googtrans', 'Business OS app-shell/static caches', 'businessos_device_settings', 'businessos_public_asset_base_url'])
const everyKeyInSrc = new Set(keysInCode.keys())
for (const row of LEGAL_STORAGE_ROWS) {
  if (CODE_FREE_ROWS.has(row.name)) continue
  assert.ok(everyKeyInSrc.has(row.name), `the cookie table row ${row.name} names a key no storefront file uses`)
}

console.log(`portalLegalTranslateDisclosure: Translation section and ${LEGAL_STORAGE_ROWS.length} storage rows match the code`)
