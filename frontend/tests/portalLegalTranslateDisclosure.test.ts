// The policies tell visitors what the storefront really does with their browser:
//   - Privacy has a Translation section: Chinese (both scripts), French and Spanish are produced by
//     Google Translate in the visitor's browser when they pick one, the page text is then sent to Google,
//     and nothing is sent on Khmer or English.
//   - The cookie table has a row for every storage key the storefront writes, and no row for a key that
//     no longer exists. googtrans is set by the site's own translate controller and by Google's translation script when a visitor
//     picks one of the four languages, and this site clears it when they go back or translation is paused. Translation is paused while
//     signed in or with the account panel open, and the Translation section says so.
//
// Run: node tests/portalLegalTranslateDisclosure.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { LEGAL_PAGE_SECTIONS, LEGAL_STORAGE_ROWS, PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'
import { AI_CONSENT_STORAGE_KEY } from '../src/components/catalog/legal/aiProviderDisclosure.ts'
import { parseSource, storefrontModules } from './storefrontCopyScan.ts'
import { parseText, retiredKeyUseProblems } from './retiredStorageKeyUses.ts'

// 1. The privacy paragraph.
const privacySections = LEGAL_PAGE_SECTIONS.privacy
const translation = privacySections.find((section) => section.heading === 'portal_legal_privacy_translate_h')
assert.ok(translation, 'the Privacy Policy has no Translation section')
assert.deepEqual(translation.bodies, ['portal_legal_privacy_translate_b'], 'the Translation section is one paragraph')
const en = PORTAL_LEGAL_EN.portal_legal_privacy_translate_b
const km = PORTAL_LEGAL_KM.portal_legal_privacy_translate_b
for (const fact of [/Simplified Chinese, Traditional Chinese, French and Spanish/, /machine translations/, /Google Translate makes them in your browser when you pick one of these languages/, /page text is then sent to Google/, /If you stay on Khmer or English, nothing is sent to Google/]) {
  assert.match(en, fact, `the English Translation paragraph lost: ${fact}`)
}
assert.match(en, /^[^]*\.$/, 'the paragraph ends in a full stop')
assert.equal(en.split('. ').length, 5, 'five plain sentences')
assert.match(en, /Translation is paused while you are signed in or while the account panel is open.$/)
for (const fact of [/ចិនសាមញ្ញ/, /ចិនប្រពៃណី/, /បារាំង/, /អេស្ប៉ាញ/, /Google Translate/, /ភាសាខ្មែរ ឬអង់គ្លេស/, /គ្មានអ្វីត្រូវបានផ្ញើទៅ Google/, /ការបកប្រែត្រូវបានផ្អាក ពេលអ្នកចូលគណនី ឬពេលផ្ទាំងគណនីបើក។$/]) {
  assert.match(km, fact, `the Khmer Translation paragraph lost: ${fact}`)
}
assert.equal(PORTAL_LEGAL_EN.portal_legal_privacy_translate_h, 'Translation')
// Nobody has verified in a browser who writes googtrans: this site does, and Google's widget sets it too. The text must say both and neither alone.
const EN_POLICY_WRITERS = /This site and the Google translation script set the googtrans cookie to remember that choice\. This site deletes that cookie when you go back to Khmer or English, or when translation is paused\./
const KM_POLICY_WRITERS = /គេហទំព័រនេះ និងស្គ្រីបបកប្រែរបស់ Google កំណត់ខូឃី googtrans ដើម្បីចងចាំជម្រើសនោះ។ គេហទំព័រនេះលុបខូឃីនោះ ពេលអ្នកត្រឡប់ទៅភាសាខ្មែរ ឬអង់គ្លេស ឬពេលការបកប្រែត្រូវបានផ្អាក។/
assert.match(PORTAL_LEGAL_EN.portal_legal_cookies_third_b, EN_POLICY_WRITERS)
assert.doesNotMatch(PORTAL_LEGAL_EN.portal_legal_cookies_third_b, /Google's script reads it/, 'nobody verified that Google only reads it')
assert.doesNotMatch(PORTAL_LEGAL_EN.portal_legal_cookies_third_b, /which sets the googtrans cookie/, 'Google alone does not set googtrans')
assert.doesNotMatch(PORTAL_LEGAL_EN.portal_legal_cookies_third_b, /This site (?:itself )?writes the googtrans/, 'the site is not the only writer')
assert.match(PORTAL_LEGAL_KM.portal_legal_cookies_third_b, KM_POLICY_WRITERS)
assert.doesNotMatch(PORTAL_LEGAL_KM.portal_legal_cookies_third_b, /ដែលកំណត់ខូឃី googtrans/)
assert.doesNotMatch(PORTAL_LEGAL_KM.portal_legal_cookies_third_b, /គេហទំព័រនេះ(?:ផ្ទាល់)?សរសេរខូឃី googtrans/, 'the site is not the only writer')
// The writers sentence is one sentence of the paragraph: exactly one sentence may mention googtrans, so a second one cannot be added unnoticed.
const EN_SENTENCES = (text: string) => text.split(/\.\s+|\.$|;/).filter(Boolean)
const KM_SENTENCES = (text: string) => text.split(/។|;/).map((part) => part.trim()).filter(Boolean)
const googtransSentences = (sentences: string[]) => sentences.filter((sentence) => sentence.includes('googtrans')).length
assert.ok(EN_SENTENCES(PORTAL_LEGAL_EN.portal_legal_cookies_third_b).length >= 5, 'the English paragraph splits into its sentences')
assert.ok(KM_SENTENCES(PORTAL_LEGAL_KM.portal_legal_cookies_third_b).length >= 5, 'the Khmer paragraph splits into its sentences')
assert.equal(googtransSentences(EN_SENTENCES(PORTAL_LEGAL_EN.portal_legal_cookies_third_b)), 1, 'exactly one English sentence mentions googtrans')
assert.equal(googtransSentences(KM_SENTENCES(PORTAL_LEGAL_KM.portal_legal_cookies_third_b)), 1, 'exactly one Khmer sentence mentions googtrans')
const semicolonEn = PORTAL_LEGAL_EN.portal_legal_cookies_third_b.replace('or when translation is paused.', "or when translation is paused; Google's script alone also sets googtrans.")
const semicolonKm = PORTAL_LEGAL_KM.portal_legal_cookies_third_b.replace('ឬពេលការបកប្រែត្រូវបានផ្អាក។', "ឬពេលការបកប្រែត្រូវបានផ្អាក; Google's script alone also sets googtrans។")
assert.notEqual(semicolonEn, PORTAL_LEGAL_EN.portal_legal_cookies_third_b, 'control: the semicolon EN mutation changed the text')
assert.notEqual(semicolonKm, PORTAL_LEGAL_KM.portal_legal_cookies_third_b, 'control: the semicolon KM mutation changed the text')
assert.equal(googtransSentences(EN_SENTENCES(semicolonEn)), 2, 'control: a claim joined by a semicolon is counted (EN)')
assert.equal(googtransSentences(KM_SENTENCES(semicolonKm)), 2, 'control: a claim joined by a semicolon is counted (KM)')
const policyExtraEn = PORTAL_LEGAL_EN.portal_legal_cookies_third_b + ' The googtrans cookie is also written by Google alone.'
const policyExtraKm = PORTAL_LEGAL_KM.portal_legal_cookies_third_b + ' ស្គ្រីបរបស់ Google ក៏សរសេរ googtrans ផងដែរ។'
assert.notEqual(policyExtraEn, PORTAL_LEGAL_EN.portal_legal_cookies_third_b, 'control: the extra-sentence EN mutation changed the text')
assert.notEqual(policyExtraKm, PORTAL_LEGAL_KM.portal_legal_cookies_third_b, 'control: the extra-sentence KM mutation changed the text')
assert.equal(googtransSentences(EN_SENTENCES(policyExtraEn)), 2, 'control: a second English googtrans sentence is counted')
assert.equal(googtransSentences(KM_SENTENCES(policyExtraKm)), 2, 'control: a second Khmer googtrans sentence is counted')
// Controls: a text that says the site alone writes it, or Google alone does, must fail these patterns.
const policyClauseKm = PORTAL_LEGAL_KM.portal_legal_cookies_third_b.replace('ដើម្បីចងចាំជម្រើសនោះ។', 'ដើម្បីចងចាំជម្រើសនោះ ហើយស្គ្រីបរបស់ Google តែមួយគត់កំណត់វាផងដែរ។')
assert.notEqual(policyClauseKm, PORTAL_LEGAL_KM.portal_legal_cookies_third_b, 'control: the inserted-clause KM policy mutation changed the text')
assert.doesNotMatch(policyClauseKm, KM_POLICY_WRITERS, 'control: a contradicting clause inside the Khmer policy sentence is rejected')
const siteAloneEn = PORTAL_LEGAL_EN.portal_legal_cookies_third_b.replace('This site and the Google translation script set the googtrans cookie', 'This site writes the googtrans cookie')
const googleAloneEn = PORTAL_LEGAL_EN.portal_legal_cookies_third_b.replace('This site and the Google translation script set the googtrans cookie', 'The Google translation script sets the googtrans cookie')
const siteAloneKm = PORTAL_LEGAL_KM.portal_legal_cookies_third_b.replace('គេហទំព័រនេះ និងស្គ្រីបបកប្រែរបស់ Google កំណត់ខូឃី', 'គេហទំព័រនេះសរសេរខូឃី')
const googleAloneKm = PORTAL_LEGAL_KM.portal_legal_cookies_third_b.replace('គេហទំព័រនេះ និងស្គ្រីបបកប្រែរបស់ Google កំណត់ខូឃី', 'ស្គ្រីបបកប្រែរបស់ Google កំណត់ខូឃី')
assert.notEqual(siteAloneEn, PORTAL_LEGAL_EN.portal_legal_cookies_third_b, 'control: the site-alone EN replacement changed the text')
assert.notEqual(googleAloneEn, PORTAL_LEGAL_EN.portal_legal_cookies_third_b, 'control: the Google-alone EN replacement changed the text')
assert.notEqual(siteAloneKm, PORTAL_LEGAL_KM.portal_legal_cookies_third_b, 'control: the site-alone KM replacement changed the text')
assert.notEqual(googleAloneKm, PORTAL_LEGAL_KM.portal_legal_cookies_third_b, 'control: the Google-alone KM replacement changed the text')
assert.doesNotMatch(siteAloneEn, EN_POLICY_WRITERS, 'control: the site-alone wording is rejected')
assert.doesNotMatch(googleAloneEn, EN_POLICY_WRITERS, 'control: the Google-alone wording is rejected')
assert.doesNotMatch(siteAloneKm, KM_POLICY_WRITERS, 'control: the Khmer site-alone wording is rejected')
assert.doesNotMatch(googleAloneKm, KM_POLICY_WRITERS, 'control: the Khmer Google-alone wording is rejected')

// 2. The rows.
const rowByName = new Map(LEGAL_STORAGE_ROWS.map((row) => [row.name, row]))
const googtrans = rowByName.get('googtrans')
assert.ok(googtrans, 'no googtrans row')
assert.equal(googtrans.kindKey, 'portal_legal_kind_cookie')
const EN_ROW_WRITERS = /^Set by this site and by Google's translation script when you pick Simplified Chinese, Traditional Chinese, French or Spanish, to remember that choice\. This site clears it when you go back to Khmer or English, or when translation is paused\.$/
const KM_ROW_WRITERS = /^គេហទំព័រនេះ និងស្គ្រីបបកប្រែរបស់ Google កំណត់វា ពេលអ្នកជ្រើសភាសាចិនសាមញ្ញ ចិនប្រពៃណី បារាំង ឬអេស្ប៉ាញ ដើម្បីចងចាំជម្រើសនោះ។ គេហទំព័រនេះលុបវា ពេលអ្នកត្រឡប់ទៅភាសាខ្មែរ ឬអង់គ្លេស ឬពេលការបកប្រែផ្អាក។$/
assert.match(PORTAL_LEGAL_EN[googtrans.purposeKey], EN_ROW_WRITERS)
assert.doesNotMatch(PORTAL_LEGAL_EN[googtrans.purposeKey], /Set by Google Translate/)
assert.doesNotMatch(PORTAL_LEGAL_EN[googtrans.purposeKey], /Written by this site/, 'the site is not the only writer')
assert.match(PORTAL_LEGAL_KM[googtrans.purposeKey], KM_ROW_WRITERS)
assert.doesNotMatch(PORTAL_LEGAL_KM[googtrans.purposeKey], /កំណត់ដោយ Google Translate/)
assert.doesNotMatch(PORTAL_LEGAL_KM[googtrans.purposeKey], /^គេហទំព័រនេះសរសេរ/, 'the site is not the only writer')
const rowSiteAloneEn = PORTAL_LEGAL_EN[googtrans.purposeKey].replace("Set by this site and by Google's translation script", 'Written by this site')
const rowGoogleAloneEn = PORTAL_LEGAL_EN[googtrans.purposeKey].replace("Set by this site and by Google's translation script", "Set by Google's translation script")
const rowSiteAloneKm = PORTAL_LEGAL_KM[googtrans.purposeKey].replace('គេហទំព័រនេះ និងស្គ្រីបបកប្រែរបស់ Google កំណត់វា', 'គេហទំព័រនេះសរសេរវា')
const rowGoogleAloneKm = PORTAL_LEGAL_KM[googtrans.purposeKey].replace('គេហទំព័រនេះ និងស្គ្រីបបកប្រែរបស់ Google កំណត់វា', 'ស្គ្រីបបកប្រែរបស់ Google កំណត់វា')
assert.notEqual(rowSiteAloneEn, PORTAL_LEGAL_EN[googtrans.purposeKey], 'control: the site-alone EN row replacement changed the text')
assert.notEqual(rowGoogleAloneEn, PORTAL_LEGAL_EN[googtrans.purposeKey], 'control: the Google-alone EN row replacement changed the text')
assert.notEqual(rowSiteAloneKm, PORTAL_LEGAL_KM[googtrans.purposeKey], 'control: the site-alone KM row replacement changed the text')
assert.notEqual(rowGoogleAloneKm, PORTAL_LEGAL_KM[googtrans.purposeKey], 'control: the Google-alone KM row replacement changed the text')
const rowClauseKm = PORTAL_LEGAL_KM[googtrans.purposeKey].replace('ពេលអ្នកជ្រើស', 'ពេលអ្នកជ្រើស ហើយស្គ្រីបរបស់ Google តែមួយគត់កំណត់វាផងដែរ')
assert.notEqual(rowClauseKm, PORTAL_LEGAL_KM[googtrans.purposeKey], 'control: the inserted-clause KM row mutation changed the text')
assert.doesNotMatch(rowClauseKm, KM_ROW_WRITERS, 'control: a contradicting clause inside the Khmer row wording is rejected')
const rowExtraKm = PORTAL_LEGAL_KM[googtrans.purposeKey] + ' ស្គ្រីបរបស់ Google ក៏សរសេរវាផងដែរ។'
assert.notEqual(rowExtraKm, PORTAL_LEGAL_KM[googtrans.purposeKey], 'control: the extra-sentence KM row mutation changed the text')
assert.doesNotMatch(rowExtraKm, KM_ROW_WRITERS, 'control: a sentence appended after the Khmer row wording is rejected')
assert.doesNotMatch(rowSiteAloneEn, EN_ROW_WRITERS, 'control: the site-alone row wording is rejected')
assert.doesNotMatch(rowGoogleAloneEn, EN_ROW_WRITERS, 'control: the Google-alone row wording is rejected')
assert.doesNotMatch(rowSiteAloneKm, KM_ROW_WRITERS, 'control: the Khmer site-alone row wording is rejected')
assert.doesNotMatch(rowGoogleAloneKm, KM_ROW_WRITERS, 'control: the Khmer Google-alone row wording is rejected')
// No hedge word: same patterns as tests/publicLegalNoHedges.test.ts (owner rule 16 Sep: policies state facts plainly). Keep in step with that test.
const EN_HEDGE = /\b(?:may|might|perhaps|possibly|approximately|roughly|generally|around \d)\b|\babout (?:an? (?:hour|day|week|month|year)|one|two|thirty|ninety|\d+)\b/i
const KM_HEDGE = /ប្រហែល|អាចនឹង|ភាគច្រើន|ជាទូទៅ|ប្រមាណ|ពេលខ្លះ|ជួនកាល|ស្ទើរតែ/
const KM_CAN_ALSO = /អាច[^។]*ដែរ/
const KM_BARE_CAN = /អាច/
for (const text of [PORTAL_LEGAL_EN[googtrans.purposeKey], PORTAL_LEGAL_EN.portal_legal_cookies_third_b]) assert.doesNotMatch(text, EN_HEDGE, 'googtrans wording hedges')
for (const text of [PORTAL_LEGAL_KM[googtrans.purposeKey], PORTAL_LEGAL_KM.portal_legal_cookies_third_b]) { assert.doesNotMatch(text, KM_HEDGE); assert.doesNotMatch(text, KM_CAN_ALSO, 'Khmer "can also" is a hedge'); assert.doesNotMatch(text, KM_BARE_CAN, 'the googtrans wording states facts: no "can" at all') }
for (const real of [PORTAL_LEGAL_KM[googtrans.purposeKey], PORTAL_LEGAL_KM.portal_legal_cookies_third_b]) {
  const canned = real.replace('កំណត់', 'អាចកំណត់')
  assert.notEqual(canned, real, 'control: the can-set replacement changed the text')
  assert.match(canned, KM_BARE_CAN, 'control: the bare-can check rejects a "can set" rewrite')
}
// The declaration must match line for line, flags included, from a line start, so a commented-out or flag-dropped copy does not count.
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const declaredVerbatim = (source: string, name: string, pattern: RegExp) => new RegExp(`^const ${name} = /${escapeRe(pattern.source)}/${pattern.flags}\\r?\\n`, 'm').test(source)
const hedgeTestSource = fs.readFileSync(new URL('./publicLegalNoHedges.test.ts', import.meta.url), 'utf8')
for (const [name, pattern] of [['EN_HEDGE', EN_HEDGE], ['KM_HEDGE', KM_HEDGE], ['KM_CAN_ALSO', KM_CAN_ALSO]] as const) {
  assert.ok(declaredVerbatim(hedgeTestSource, name, pattern), `${name} here differs from the one in publicLegalNoHedges.test.ts`)
}
const enDeclaration = `const EN_HEDGE = /${EN_HEDGE.source}/${EN_HEDGE.flags}`
assert.ok(declaredVerbatim(`${enDeclaration}\r\n`, 'EN_HEDGE', EN_HEDGE), 'control: the matcher accepts the exact declaration with CRLF')
assert.ok(declaredVerbatim(`x\n${enDeclaration}\n`, 'EN_HEDGE', EN_HEDGE), 'control: the matcher accepts the exact declaration with LF')
assert.ok(!declaredVerbatim(`${enDeclaration.replace(/i$/, '')}\n`, 'EN_HEDGE', EN_HEDGE), 'control: a dropped i flag is rejected')
assert.ok(!declaredVerbatim(`// ${enDeclaration}\n`, 'EN_HEDGE', EN_HEDGE), 'control: a commented-out declaration is rejected')
assert.ok(!declaredVerbatim(`const KM_HEDGE = /${KM_HEDGE.source}/i\n`, 'KM_HEDGE', KM_HEDGE), 'control: a flag added to a Khmer pattern is rejected')
assert.match('Google\'s translation script may also write it', EN_HEDGE, 'control: the hedge pattern catches the retired wording')
assert.match('ក៏អាចសរសេរវាដែរ', KM_CAN_ALSO, 'control: the Khmer can-also pattern catches the retired wording')
assert.match(PORTAL_LEGAL_EN[googtrans.lifetimeKey], /translation is paused/)
assert.equal(rowByName.get(AI_CONSENT_STORAGE_KEY)?.kindKey, 'portal_legal_kind_local', 'the assistant-consent key has a local-storage row')
assert.match(PORTAL_LEGAL_EN[rowByName.get(AI_CONSENT_STORAGE_KEY)!.purposeKey], /Stores whether you agreed to send questions to the AI assistant\. It is kept on this device only/)
assert.match(PORTAL_LEGAL_EN[rowByName.get('business-os-portal-list-images-v1')!.purposeKey], /Pictures for the products in your list, on this device/)

// 3. Every storage key the storefront names in code has a row, and every row names a key that exists.
const KEY_SHAPE = /^(business-os-portal-[a-z-]+-v1|business-os:portal-[a-z-]+)$/
const keysInCode = new Map<string, string>()
const RETIRED_KEYS_REMOVED_AT_FIRST_PAINT = new Set(['business-os-portal-map-consent-v1'])
for (const file of storefrontModules()) {
  const source = parseSource(file)
  const visit = (node: ts.Node) => {
    // A retired key named only in first paint's removal list is the opposite of storing: nothing writes it, so it gets no row. Exempt by exact key AND file.
    if (ts.isStringLiteral(node) && KEY_SHAPE.test(node.text)) {
      // D1 (d15fix2): the exemption holds only while EVERY use of the retired key in this file is a removal. A setItem, a getItem, a second literal or RETIRED_PORTAL_STORAGE_KEYS[1] makes it a stored key that needs a row.
      const removedOnly = RETIRED_KEYS_REMOVED_AT_FIRST_PAINT.has(node.text) && /publicFirstPaint\.ts$/.test(file) && retiredKeyUseProblems(source).length === 0
      if (!removedOnly) keysInCode.set(node.text, file)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
for (const [key, file] of keysInCode) {
  assert.ok(rowByName.has(key), `${key} is written by ${file.split('src').pop()} but the cookie table has no row for it`)
}
for (const file of storefrontModules()) {
  assert.deepEqual(retiredKeyUseProblems(parseSource(file)), [], `${file.split('src').pop()} uses a retired storage key for something other than removing it`)
}
// Controls: the real first-paint file, with each of the reviewer's surviving mutants added, must be reported. Without these the exemption above could rot back to "exact key and file".
{
  const firstPaintFile = storefrontModules().find((file) => /publicFirstPaint\.ts$/.test(file))
  assert.ok(firstPaintFile, 'control: publicFirstPaint.ts is a storefront module')
  const real = fs.readFileSync(firstPaintFile, 'utf8')
  const anchor = 'export function clearRetiredPortalCache(): void {'
  assert.ok(real.includes(anchor), 'control: the anchor line for the mutants exists')
  const withExtra = (extra: string) => parseText(real.replace(anchor, `${extra}\n${anchor}`), firstPaintFile)
  assert.deepEqual(retiredKeyUseProblems(parseText(real, firstPaintFile)), [], 'control: the real file is clean')
  const mutants: Array<[string, string]> = [
    ['writes the retired key by its constant', "export function rememberMapChoice(): void {\n  globalThis.window?.localStorage?.setItem(RETIRED_PORTAL_MAP_CONSENT_KEY, 'granted')\n}\n"],
    ['writes the retired key through RETIRED_PORTAL_STORAGE_KEYS[1]', "export function rememberMapChoice(): void {\n  globalThis.window?.localStorage?.setItem(RETIRED_PORTAL_STORAGE_KEYS[1], 'granted')\n}\n"],
    ['reads the retired key', "export function mapChosen(): boolean {\n  return globalThis.window?.localStorage?.getItem(RETIRED_PORTAL_MAP_CONSENT_KEY) === 'granted'\n}\n"],
    ['writes the retired key as a second literal', "export function rememberMapChoice(): void {\n  globalThis.window?.localStorage?.setItem('business-os-portal-map-consent-v1', 'granted')\n}\n"],
    ['writes the retired key as a template literal', 'export function rememberMapChoice(): void {\n  globalThis.window?.localStorage?.setItem(`business-os-portal-map-consent-v1`, \'granted\')\n}\n'],
    ['writes the retired key through a copy of the list', "export function rememberMapChoice(): void {\n  const [, consent] = [...RETIRED_PORTAL_STORAGE_KEYS]\n  globalThis.window?.localStorage?.setItem(consent, 'granted')\n}\n"],
    ['sets a cookie from the retired key', "export function rememberMapChoice(): void {\n  document.cookie = RETIRED_PORTAL_MAP_CONSENT_KEY + '=granted'\n}\n"],
    ['reads the retired key in the removal loop', "export function peek(): void {\n  for (const key of RETIRED_PORTAL_STORAGE_KEYS) globalThis.window?.localStorage?.getItem(key)\n}\n"],
  ]
  for (const [label, extra] of mutants) {
    assert.ok(retiredKeyUseProblems(withExtra(extra)).length > 0, `control: a first-paint file that ${label} is reported, so the removal-only exemption would not apply`)
  }
}
const CODE_FREE_ROWS = new Set(['bos_portal', 'googtrans', 'Business OS app-shell/static caches', 'businessos_device_settings', 'businessos_public_asset_base_url'])
const everyKeyInSrc = new Set(keysInCode.keys())
for (const row of LEGAL_STORAGE_ROWS) {
  if (CODE_FREE_ROWS.has(row.name)) continue
  assert.ok(everyKeyInSrc.has(row.name), `the cookie table row ${row.name} names a key no storefront file uses`)
}

console.log(`portalLegalTranslateDisclosure: Translation section and ${LEGAL_STORAGE_ROWS.length} storage rows match the code`)
