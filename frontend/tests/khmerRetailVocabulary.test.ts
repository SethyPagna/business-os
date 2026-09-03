// Pins the Khmer retail vocabulary the shop owner dictated, plus the
// one-word-per-concept glossary the rest of the pack was normalised onto.
//
// Why a test and not a comment: the Khmer pack has been written key-by-key
// by many sessions, and the same concept kept drifting into three different
// words (a batch was បាច់ / ឡូត / ឡុត; a return was ការប្រគល់មកវិញ /
// ការត្រឡប់ / ការបង្វិលត្រឡប់). A later session "fixing" one screen in
// isolation silently re-forks the vocabulary, and nothing catches it until
// a shopkeeper reads two screens side by side. verify:i18n cannot see any of
// this -- it only checks that a referenced key exists in both packs.
//
// The terms in DICTATED are not style preferences: the shop owner named them
// exactly (2026-09-03: "instead of after stock = ក្រោយ it is ស្តុកចុងក្រោយ,
// Current Stock = ស្តុកបច្ចុប្បន្ន, Batch name change Date in ថ្ងៃចូល..
// Before Stock = ស្តុកពីមុន"). Do not relax them.
//
// Run: node tests/khmerRetailVocabulary.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

type Pack = Record<string, unknown>

const readPack = (name: string): Pack =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lang', `${name}.json`), 'utf8')) as Pack

// AppContext flattens the nested `common` and `pages` groups into the same
// flat namespace, last write wins (517 top-level keys are shadowed that way).
// Resolve exactly the way the app does, or this test asserts against a value
// the UI never renders.
function flatten(input: unknown, target: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== 'object') return target
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value == null) continue
    if (Array.isArray(value)) continue
    if (typeof value === 'object') { flatten(value, target); continue }
    target[key] = String(value)
  }
  return target
}

const en = flatten(readPack('en'))
const km = flatten(readPack('km'))

// --- 1. the dictated stock vocabulary ------------------------------------

const DICTATED: Array<[key: string, khmer: string, why: string]> = [
  ['before_qty', 'ស្តុកពីមុន', 'stock-change list: the quantity before the movement'],
  ['after_qty', 'ស្តុកចុងក្រោយ', 'stock-change list: the quantity after the movement'],
  ['current_stock', 'ស្តុកបច្ចុប្បន្ន', 'the stock a product has right now'],
  ['label_stock', 'ស្តុកបច្ចុប្បន្ន', 'product detail / POS sheet stock row -- same number, same words'],
  ['batch_date', 'ថ្ងៃចូល', 'the batch date staff type: the day the stock came in'],
  ['received_date', 'ថ្ងៃចូល', 'same day, same word -- one concept must not carry two names'],
]

for (const [key, khmer, why] of DICTATED) {
  assert.equal(km[key], khmer, `km.json "${key}" must stay ${khmer} (${why})`)
}

// before → after is shown as one label on the product report; it must be
// built from the same two words the list column headers use.
assert.equal(
  km.before_after, `${km.before_qty} → ${km.after_qty}`,
  'km.json "before_after" must be built from the same two dictated terms',
)

console.log(`PASS ${DICTATED.length + 1} dictated Khmer stock terms are intact`)

// --- 2. one Khmer word per concept ---------------------------------------
//
// `forbidden` lists the rival renderings that were in the pack before the
// 2026-09-03 normalisation. A key opts out only by being named in `except`.

type GlossaryRule = {
  concept: string
  canonical: string
  /** rival spellings; a RegExp where a lookaround is needed to spare a real word */
  forbidden: Array<string | RegExp>
  except?: string[]
}

const GLOSSARY: GlossaryRule[] = [
  // Sep 4 2026: the concept is no longer called a batch at all. The owner's
  // own dictation ("Batch name change Date in ថ្ងៃចូល") IS the batch ->
  // received date rename in Khmer, so ថ្ងៃចូល -- already the pinned value of
  // batch_date and received_date above -- became the one word for the record
  // itself too, and បាច់ joined ឡូត/ឡុត as a rival spelling.
  //
  // The three exceptions are a DIFFERENT word that happens to be spelled the
  // same: a "batch session" is the multi-line review flow, and a "defective
  // batch" is a return reason the shop writes. Neither is a stock record.
  // (អាប់ឡូត is "upload" and merely contains ឡូត; ចាំបាច់ is "necessary" and
  // merely contains បាច់ -- spare both.)
  {
    concept: 'batch / lot / received date',
    canonical: 'ថ្ងៃចូល',
    forbidden: [/(?<!ចាំ)បាច់/, /(?<!អាប់)ឡូត/, 'ឡុត'],
    except: ['confirm_apply_inventory_batch', 'inventory_batch_session', 'reason_defective_batch'],
  },
  { concept: 'customer', canonical: 'អតិថិជន', forbidden: ['អ្នកទិញ'], except: ['fee_by_customer', 'pos_customer_pays', 'customer_pays'] },
  { concept: 'cost', canonical: 'ថ្លៃដើម', forbidden: ['តម្លៃដើម'] },
  { concept: 'variant', canonical: 'ជម្រើស', forbidden: ['វ៉ារ្យ៉ង់', 'វ៉ារីយ៉ង់'] },
  // ទាន់សម័យ is "up to date" and merely contains សម័យ -- spare it.
  { concept: 'session', canonical: 'វគ្គ', forbidden: [/(?<!ទាន់)សម័យ/] },
  { concept: 'refresh', canonical: 'ផ្ទុកឡើងវិញ', forbidden: ['ស្រស់ថ្មី'] },
  { concept: 'update', canonical: 'ធ្វើបច្ចុប្បន្នភាព', forbidden: ['អាប់ដេត'] },
  { concept: 'margin', canonical: 'អត្រាចំណេញ', forbidden: ['ម៉ាសែន'] },
  { concept: 'thermal paper', canonical: 'ក្រដាសកម្ដៅ', forbidden: ['សាំងចង្ចាំ'] },
  { concept: 'print', canonical: 'បោះពុម្ព', forbidden: ['ព្រីន'] },
  { concept: 'portal', canonical: 'គេហទំព័រ', forbidden: ['ផតថល'] },
  { concept: 'settle', canonical: 'ដោះស្រាយ', forbidden: ['សម្រះ'] },
  { concept: 'barcode', canonical: 'បាកូដ', forbidden: ['បារកូដ'] },
  { concept: 'reason', canonical: 'មូលហេតុ', forbidden: ['ហេតុផល'] },
  // ការត្រឡប់វិញ is "revert" (undo an action), a different concept from a
  // customer bringing goods back.
  { concept: 'return (noun)', canonical: 'ការប្រគល់មកវិញ', forbidden: [/ការត្រឡប់(?!វិញ)/, 'បងវិល', 'ការបង្វិលត្រឡប់'] },
]

const violations: string[] = []
for (const rule of GLOSSARY) {
  const allowed = new Set(rule.except || [])
  for (const [key, value] of Object.entries(km)) {
    if (allowed.has(key)) continue
    for (const bad of rule.forbidden) {
      const hit = typeof bad === 'string' ? value.includes(bad) : bad.test(value)
      if (hit) violations.push(`${rule.concept}: "${key}" uses ${bad}, the pack says ${rule.canonical} -- ${value}`)
    }
  }
}
assert.deepEqual(violations, [], `Khmer vocabulary forked again:\n  ${violations.join('\n  ')}`)
console.log(`PASS ${GLOSSARY.length} Khmer glossary terms are used consistently across the pack`)

// --- 3. no English left where Khmer is expected --------------------------
//
// Loanwords Cambodian shop staff actually say (POS, CSV, QR, brand and font
// names) stay. What is banned is a Khmer value byte-identical to a multi-word
// English sentence -- that is an untranslated string, not a loanword, and
// verify:i18n passes it happily because the key exists in both packs.

const untranslated = Object.keys(en).filter((key) => {
  const source = en[key]
  if (km[key] !== source) return false
  if (!/[A-Za-z]/.test(source)) return false
  // up to three tokens is a name/format/acronym (POS, Google Drive, JPG/PNG/WEBP)
  return source.trim().split(/\s+/).length > 3
})
assert.deepEqual(untranslated, [], `these keys are still raw English in km.json:\n  ${untranslated.join('\n  ')}`)
console.log('PASS no multi-word English sentence is left untranslated in km.json')

// --- 4. placeholders survive translation ---------------------------------
//
// A Khmer value that drops a {placeholder} its English source carries renders
// a sentence with the number missing. The reverse is deliberate in a few
// places: some call sites .replace('{n}', ...) on a string whose English never
// had the count (BulkImportModal "Match & Import Images", ServerPage online
// devices), so km carrying an extra {n} shows the shopkeeper more, not less.

const placeholders = (value: string) => new Set([...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((m) => m[0]))
const dropped = Object.keys(en).filter((key) => {
  if (km[key] === undefined) return false
  const kmHas = placeholders(km[key])
  return [...placeholders(en[key])].some((token) => !kmHas.has(token))
})
assert.deepEqual(dropped, [], `these Khmer strings lost a placeholder their English source carries:\n  ${dropped.join('\n  ')}`)
console.log('PASS every Khmer string keeps the placeholders its English source carries')
