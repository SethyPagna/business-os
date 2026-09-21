import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ReceiptSettings.tsx rendered the receipt-language chooser (values en / km /
// both, template field receipt_language) with hard-coded English labels in
// three places: the Language-section cards
// (['en', 'English', 'English only'], ...), the desktop live-preview header
// pills (['en', 'EN'], ...) and the same pills duplicated inside the mobile
// preview sheet. The printable receipt viewer (Receipt.tsx) carried a fourth
// copy of the same switcher (['en', 'EN'], ['km', 'KH'], ['both', 'KH/EN']).
// A Khmer-language shop saw raw English in all four spots.
//
// The fix keeps ONE RECEIPT_LANGUAGE_OPTIONS constant in
// receipt-settings/constants.ts and reuses it at all four call sites. Each row
// carries the pack key AND the English fallback (t() returns the bare key until
// the lazy language pack resolves, and this file's convention is
// `t(key) || 'Fallback'`), plus the short code the printable receipt's toolbar
// shows below `sm` so that row stays one line on a phone (the full keyed word
// is the accessible name and the sm+ text). Labels reuse the existing
// `english` / `khmer` / `both` keys; the descriptions are three new
// `receipt_language_{en,km,both}_desc` keys with real Khmer in km.json.

const ROOT = new URL('../', import.meta.url)
const rootPath = fileURLToPath(ROOT)
const read = (rel: string) => fs.readFileSync(path.join(rootPath, rel), 'utf8')

const src = read('src/components/receipt-settings/ReceiptSettings.tsx')
const constants = read('src/components/receipt-settings/constants.ts')
const receipt = read('src/components/receipt/Receipt.tsx')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, unknown>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, unknown>

// --- One shared constant, exported from constants.ts and imported by both ---

const constantMatch = constants.match(/export const RECEIPT_LANGUAGE_OPTIONS = \[([\s\S]*?)\] as const/)
assert.ok(constantMatch, 'receipt-settings/constants.ts must export the RECEIPT_LANGUAGE_OPTIONS constant')
const rows = constantMatch![1].split('\n').map((line) => line.trim()).filter((line) => line.startsWith('{'))
assert.equal(rows.length, 3, 'RECEIPT_LANGUAGE_OPTIONS must hold exactly three rows')

const expectedRows = [
  { value: 'en', labelKey: 'english', descKey: 'receipt_language_en_desc', code: 'EN' },
  { value: 'km', labelKey: 'khmer', descKey: 'receipt_language_km_desc', code: 'KM' },
  { value: 'both', labelKey: 'both', descKey: 'receipt_language_both_desc', code: 'EN/KM' },
]
expectedRows.forEach((row, index) => {
  const line = rows[index]
  for (const [field, value] of Object.entries(row)) {
    assert.ok(line.includes(`${field}: '${value}'`), `row ${index} must be the '${row.value}' option with ${field}: '${value}' (order en, km, both)`)
  }
  assert.match(line, /label: '[A-Z][^']+'/, `row ${index} must carry an English label fallback`)
  assert.match(line, /desc: '[A-Z][^']+'/, `row ${index} must carry an English description fallback`)
})

assert.ok(!src.includes('const RECEIPT_LANGUAGE_OPTIONS'), 'ReceiptSettings.tsx must not keep a private copy of the constant')
assert.match(
  src,
  /import \{[^}]*RECEIPT_LANGUAGE_OPTIONS[^}]*\} from '\.\/constants'/,
  'ReceiptSettings.tsx must import RECEIPT_LANGUAGE_OPTIONS from ./constants',
)
assert.ok(
  receipt.includes("import { RECEIPT_LANGUAGE_OPTIONS } from '../receipt-settings/constants'"),
  'Receipt.tsx must import RECEIPT_LANGUAGE_OPTIONS from ../receipt-settings/constants',
)

// --- All six keys exist in both packs, non-empty, with real Khmer in km ------

const KHMER_SCRIPT = /[ក-៿]/
for (const key of ['english', 'khmer', 'both', 'receipt_language_en_desc', 'receipt_language_km_desc', 'receipt_language_both_desc']) {
  const enVal = en[key]
  const kmVal = km[key]
  assert.ok(typeof enVal === 'string' && enVal.length > 0, `en.json missing non-empty '${key}'`)
  assert.ok(typeof kmVal === 'string' && kmVal.length > 0, `km.json missing non-empty '${key}'`)
  assert.notEqual(kmVal, enVal, `km.json '${key}' looks untranslated (identical to the English value)`)
  assert.match(String(kmVal), KHMER_SCRIPT, `km.json '${key}' must contain Khmer script, got ${JSON.stringify(kmVal)}`)
}

// --- No remaining hard-coded literals in either chooser ---------------------

const bannedLiterals = ["'EN'", "'KH'", "'KH/EN'", "'English only'", "'Khmer only'", "'Bilingual EN + KH'"]
for (const [name, text] of [['ReceiptSettings.tsx', src], ['Receipt.tsx', receipt]] as const) {
  for (const literal of bannedLiterals) {
    assert.ok(!text.includes(literal), `${name} must not hard-code the literal ${literal} anymore`)
  }
}

// --- The constant is used at all four call sites, keyed with a fallback -----

const settingsUses = (src.match(/RECEIPT_LANGUAGE_OPTIONS\.map\(/g) || []).length
assert.equal(
  settingsUses,
  3,
  `ReceiptSettings.tsx: RECEIPT_LANGUAGE_OPTIONS.map( must appear exactly 3 times (cards + two preview pill rows), found ${settingsUses}`,
)
assert.equal(
  (src.match(/\{t\(option\.labelKey\) \|\| option\.label\}/g) || []).length,
  3,
  'ReceiptSettings.tsx must label all three chooser rows through t(labelKey) || English fallback',
)
assert.ok(src.includes('{t(option.descKey) || option.desc}'), 'ReceiptSettings.tsx cards must describe through t(descKey) || English fallback')
assert.ok(src.includes("setT('receipt_language', option.value)"), 'ReceiptSettings.tsx must still write option.value to receipt_language')

assert.equal(
  (receipt.match(/RECEIPT_LANGUAGE_OPTIONS\.map\(/g) || []).length,
  1,
  'Receipt.tsx: the printable receipt switcher must render from RECEIPT_LANGUAGE_OPTIONS exactly once',
)
assert.ok(receipt.includes('onClick={() => setLang(option.value)}'), 'Receipt.tsx switcher must still call setLang with the option value')
assert.ok(
  receipt.includes('<span className="sm:hidden">{option.code}</span>'),
  'Receipt.tsx switcher must show the short code below sm so the toolbar stays one line on a phone',
)
assert.ok(
  receipt.includes('<span className="hidden sm:inline">{t?.(option.labelKey) || option.label}</span>'),
  'Receipt.tsx switcher must show the keyed word from sm up',
)
assert.ok(
  receipt.includes('aria-label={t?.(option.labelKey) || option.label}'),
  'Receipt.tsx switcher must name each option by its keyed word for assistive tech',
)

console.log(
  'PASS receipt-language choosers (ReceiptSettings cards + preview pills, printable Receipt switcher) share one RECEIPT_LANGUAGE_OPTIONS constant: keyed labels with English fallbacks, real Khmer in km.json, short codes below sm on the receipt toolbar',
)
