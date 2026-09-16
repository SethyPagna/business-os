import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Guards the two language packs against the failure modes that are silent in
// a running app:
//
//   1. A key used in source but missing from en.json. The UI then renders the
//      raw key ("add_to_cart") or a fallback, and nobody notices until a
//      screenshot.
//   2. The two packs drifting apart, so a string is translated in one
//      language and missing in the other.
//
// (1) exists specifically because this suite also removed ~640 genuinely dead
// keys. Deleting unused translations is safe only if something immediately
// catches an over-delete; this is that something.

const ROOT = new URL('../', import.meta.url)
const rootPath = fileURLToPath(ROOT)

const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(rootPath, rel), 'utf8')) as Record<string, unknown>

const en = readJson('src/lang/en.json')
const km = readJson('src/lang/km.json')

// --- 1. the packs agree on their key set ---------------------------------

const enKeys = new Set(Object.keys(en))
const kmKeys = new Set(Object.keys(km))
const missingInKm = [...enKeys].filter((k) => !kmKeys.has(k)).sort()
const missingInEn = [...kmKeys].filter((k) => !enKeys.has(k)).sort()

assert.deepEqual(missingInKm, [], 'every English key needs a Khmer entry')
assert.deepEqual(missingInEn, [], 'km.json has keys en.json does not -- likely a stale key left behind')
console.log(`PASS en.json and km.json share the same ${enKeys.size} keys`)

// Template-generated lookups such as `${section.tKey}_desc` are invisible to
// the static source regex below. Shared date presets also need top-level keys:
// the same names nested under a feature object do not satisfy t('key').
const requiredPairedTopLevelKeys = [
  'last_7_days',
  'last_30_days',
  'perm_section_full_access_desc',
  'perm_section_pos_desc',
  'perm_section_sales_desc',
]

for (const key of requiredPairedTopLevelKeys) {
  assert.equal(typeof en[key], 'string', `English top-level translation missing: ${key}`)
  assert.equal(typeof km[key], 'string', `Khmer top-level translation missing: ${key}`)
  assert.notEqual(km[key], en[key], `Khmer top-level translation falls back to English: ${key}`)
}
console.log('PASS shared date presets and dynamic permission descriptions have paired top-level translations')

const expectedPermissionReviewDescriptions = {
  perm_branches_review_desc: {
    en: 'Under Partial Access, viewing and exporting branches work directly. Editing the canonical Shop or Warehouse details goes to the Review/Approval queue for an admin to approve or reject. Transferring stock between branches and repairing misplaced stock both require Full Access.',
    km: 'ក្រោមសិទ្ធិមួយផ្នែក ការមើល និងការនាំចេញសាខា អាចធ្វើបានផ្ទាល់។ ការកែសម្រួលព័ត៌មានលម្អិតរបស់ហាង ឬឃ្លាំងដែលបានកំណត់ជាផ្លូវការ ត្រូវចូលទៅក្នុងជួរត្រួតពិនិត្យ/អនុម័ត ដើម្បីឱ្យអ្នកគ្រប់គ្រងអនុម័ត ឬបដិសេធ។ ការផ្ទេរស្តុករវាងសាខា និងការជួសជុលស្តុកខុសកន្លែង ទាមទារសិទ្ធិពេញលេញ។',
  },
  perm_fees_review_desc: {
    en: 'Under Partial Access, create, edit, search, and export all work directly. Only delete goes to the Review/Approval queue for an admin to approve or reject.',
    km: 'ក្រោមសិទ្ធិមួយផ្នែក ការបង្កើត កែសម្រួល ស្វែងរក និងនាំចេញ អាចធ្វើបានផ្ទាល់។ មានតែការលុបប៉ុណ្ណោះដែលត្រូវចូលទៅក្នុងជួរត្រួតពិនិត្យ/អនុម័ត ដើម្បីឱ្យអ្នកគ្រប់គ្រងអនុម័ត ឬបដិសេធ។',
  },
}

for (const [key, expected] of Object.entries(expectedPermissionReviewDescriptions)) {
  assert.equal(en[key], expected.en, `English permission guidance drifted: ${key}`)
  assert.equal(km[key], expected.km, `Khmer permission guidance drifted: ${key}`)
}
console.log('PASS Branch and Expense Partial Access guidance stays paired with executable action authority')

// --- 2. every key the source asks for actually exists --------------------

function collectSources(dir: string, out: string[] = []): string[] {
  const abs = path.join(rootPath, dir)
  if (!fs.existsSync(abs)) return out
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lang') continue
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSources(rel, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(fs.readFileSync(path.join(rootPath, rel), 'utf8'))
  }
  return out
}

const sources = collectSources('src').join('\n')

// This codebase looks translations up two different ways, and only ONE of
// them degrades safely when the key is absent:
//
//   tr('key', 'Fallback') / T(...) / safeT(...) / copy(...)
//       These compare the result against the key and substitute the
//       fallback, so a missing entry renders correct English. A gap here is
//       a translation-coverage gap, not a bug.
//
//   t('key') || 'Fallback'
//       BROKEN. AppContext's t() returns THE KEY ITSELF when it cannot
//       resolve one, and a non-empty string is truthy, so `||` never fires.
//       A missing entry renders the raw key -- users saw literal
//       "keep_this_one" and "merging" in the Contacts duplicates screen
//       because of exactly this.
//
// Only the second form is asserted, because only the second form is a
// visible defect. Asserting the first would fail on ~100 deliberate
// fallback call sites and train people to ignore this test.
const BARE_LOOKUP = /\bt\(\s*'([a-z][a-z0-9_]*)'\s*\)/g
const WITH_FALLBACK = /\b(?:tr|T|safeT|copy)\(\s*'([a-z][a-z0-9_]*)'\s*,/g

const bare = new Set<string>()
for (const match of sources.matchAll(BARE_LOOKUP)) bare.add(match[1])
const withFallback = new Set<string>()
for (const match of sources.matchAll(WITH_FALLBACK)) withFallback.add(match[1])

const rendersRawKey = [...bare].filter((key) => !enKeys.has(key) && !withFallback.has(key)).sort()

assert.deepEqual(
  rendersRawKey,
  [],
  'these are read with bare t() and are missing from en.json, so the UI renders the raw key '
    + `(t() returns the key, so any \`|| 'fallback'\` beside it never fires):\n  ${rendersRawKey.join('\n  ')}`,
)
console.log(`PASS all ${bare.size} bare t() lookups resolve to a real key`)

// Coverage is reported, not enforced -- a number that can be watched
// without blocking anyone.
const fallbackOnly = [...withFallback].filter((key) => !enKeys.has(key))
if (fallbackOnly.length) {
  console.log(
    `NOTE ${fallbackOnly.length} keys rely on their in-code English fallback and have no pack entry, `
    + 'so Khmer users see English for them. Not a defect; tracked as translation coverage.',
  )
}

// --- 3. no key is an empty string ----------------------------------------

const blank = [...enKeys].filter((k) => String(en[k] ?? '').trim() === '').sort()
assert.deepEqual(blank, [], 'a blank English string renders as nothing at all')

const blankKm = [...kmKeys].filter((k) => String(km[k] ?? '').trim() === '').sort()
assert.deepEqual(blankKm, [], 'a blank Khmer string renders as nothing at all')
console.log('PASS no blank strings in either pack')

console.log('\nlangKeyIntegrity tests passed')
