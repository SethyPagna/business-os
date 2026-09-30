// T18 (board R7): every word the one conflict resolver shows exists in BOTH
// language packs, in real Khmer, with the same placeholders, and the English
// fallback written at the call site is the English pack value.
//
// Scope is the resolver's own files (shared/Resolve*.tsx), so the next file of
// the flow is covered the moment it is added. Every `tr('key', 'Fallback')`
// call counts, not only resolve_* keys: a reused key such as 'previous' reaches
// the owner on the same screen.
//
// Run: node tests/resolveI18nKeys.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const frontend = path.resolve(import.meta.dirname, '..')
const shared = path.join(frontend, 'src', 'components', 'shared')
const readPack = (name: string): Record<string, string> => JSON.parse(fs.readFileSync(path.join(frontend, 'src', 'lang', name), 'utf8'))
const en = readPack('en.json')
const km = readPack('km.json')

const CALL = /\btr\(\s*'([a-z0-9_]+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g
const KHMER = /[ក-៿]/
const slots = (value: string) => [...new Set(value.match(/\{[a-zA-Z_]+\}/g) ?? [])].sort()

type Pack = Record<string, string | undefined>
function problemsIn(file: string, source: string, packs: { en: Pack; km: Pack }): string[] {
  const problems: string[] = []
  for (const [, key, fallback] of source.matchAll(CALL)) {
    const english = packs.en[key]
    const khmer = packs.km[key]
    if (typeof english !== 'string' || !english.trim()) { problems.push(`${file}: '${key}' missing from en.json`); continue }
    if (typeof khmer !== 'string' || !khmer.trim()) { problems.push(`${file}: '${key}' missing from km.json`); continue }
    if (!KHMER.test(khmer) || khmer === english) problems.push(`${file}: km.json '${key}' is not Khmer ("${khmer}")`)
    if (slots(english).join() !== slots(khmer).join()) problems.push(`${file}: '${key}' placeholders differ (en ${slots(english)} / km ${slots(khmer)})`)
    if (fallback !== english) problems.push(`${file}: '${key}' fallback "${fallback}" is not the en.json value "${english}"`)
  }
  return problems
}

const files = fs.readdirSync(shared).filter((name) => /^Resolve.*\.tsx$/.test(name)).sort()
assert.ok(files.includes('ResolveGrid.tsx'), `the sweep must reach the grid (found ${files.join(', ')})`)

let calls = 0
let resolveKeys = 0
const problems: string[] = []
for (const name of files) {
  const source = fs.readFileSync(path.join(shared, name), 'utf8')
  for (const [, key] of source.matchAll(CALL)) { calls += 1; if (key.startsWith('resolve_')) resolveKeys += 1 }
  problems.push(...problemsIn(name, source, { en, km }))
  // A bare t('resolve_x') with no fallback would print the key itself when a
  // pack is still loading; the resolver always passes the English fallback.
  for (const [bare] of source.matchAll(/\bt\(\s*'resolve_[a-z0-9_]+'\s*\)/g)) problems.push(`${name}: ${bare} has no fallback`)
}
assert.deepEqual(problems, [], 'resolver text must be complete in both packs')
assert.ok(calls >= 20 && resolveKeys >= 15, `the scan must see the resolver's calls (saw ${calls} calls, ${resolveKeys} resolve_* keys)`)

// Positive control: a checker that answers "clean" for everything is
// indistinguishable from a broken one, so hand it each failure it exists for.
const control = [
  "tr('resolve_ghost', 'Ghost')",
  "tr('resolve_final', 'Result')",
  "tr('resolve_english', 'Same')",
  "tr('resolve_slot', 'Hi {name}')",
].join('\n')
const controlProblems = problemsIn('control.tsx', control, {
  en: { resolve_final: 'Final', resolve_english: 'Same', resolve_slot: 'Hi {name}' },
  km: { resolve_final: 'លទ្ធផល', resolve_english: 'Same', resolve_slot: 'សួស្ដី' },
})
assert.equal(controlProblems.length, 4, `each seeded defect is caught once:\n${controlProblems.join('\n')}`)
assert.ok(controlProblems.some((line) => line.includes("'resolve_ghost' missing from en.json")))
assert.ok(controlProblems.some((line) => line.includes("'resolve_final' fallback")))
assert.ok(controlProblems.some((line) => line.includes("km.json 'resolve_english' is not Khmer")))
assert.ok(controlProblems.some((line) => line.includes("'resolve_slot' placeholders differ")))

console.log(`PASS resolver text: ${calls} calls (${resolveKeys} resolve_*) across ${files.join(', ')} resolve in both packs`)

// UI-CONFLICTS 3.6 (30 Sep 2026): the words the owner asked for exist in both
// packs, and the retired ones (the kept-record row, the per-row info hints,
// "stopped before finishing", the Keep/Merge card hints) are gone from both
// packs and from every conflict surface, so none can come back as a zombie.
const ADDED = ['resolve_select_hint', 'resolve_not_applied', 'resolve_apply_unknown', 'resolve_refusal_stock_session_settled',
  'resolve_refusal_invalid_merge_numeric', 'resolve_refusal_merge_failed', 'resolve_merge_in_toggle', 'resolve_keep_separate_toggle',
  'resolve_name_invalid', 'resolve_text_invalid', 'resolve_price_invalid']
const RETIRED = ['resolve_product_kept', 'resolve_product_kept_hint', 'resolve_record_kept', 'resolve_record_kept_hint', 'resolve_how_to',
  'resolve_how_to_label', 'resolve_follows_kept', 'resolve_product_barcode_hint', 'resolve_cost_hint', 'resolve_selling_hint',
  'resolve_stock_hint', 'resolve_membership_hint', 'resolve_storefront_hint', 'resolve_history_hint', 'resolve_apply_failed',
  'dup_decide_all_hint', 'dup_pick_one_keep', 'resolve_duplicate_inline_hint', 'product_duplicates_how', 'resolve_disposition_label']
for (const key of ADDED) {
  assert.ok(en[key]?.trim(), `en ${key}`)
  assert.ok(KHMER.test(km[key] ?? ''), `km ${key} is Khmer`)
  assert.equal(slots(en[key]).join(), slots(km[key]).join(), `${key} placeholders`)
}
assert.equal(en.resolve_select_hint, 'Select the details you want to keep; review the final result.', "the owner's own words")
const surfaces = ['components/shared/ResolveGrid.tsx', 'components/shared/ResolveModal.tsx', 'components/products/productResolveAdapter.ts',
  'components/contacts/contactResolveAdapter.ts', 'components/products/ProductDuplicatesTab.tsx', 'components/contacts/DuplicatesTab.tsx']
  .map((rel) => [rel, fs.readFileSync(path.join(frontend, 'src', rel), 'utf8')] as const)
const quoted = (source: string, key: string) => ["'", '"', '`'].some((mark) => source.includes(`${mark}${key}${mark}`))
for (const key of RETIRED) {
  assert.equal(key in en || key in km, false, `${key} is retired from both packs`)
  for (const [rel, source] of surfaces) assert.equal(quoted(source, key), false, `${rel} still reads ${key}`)
}
// Positive control for the source judge.
assert.equal(quoted("tr(t, 'resolve_product_kept', 'Product kept')", 'resolve_product_kept'), true)
console.log(`PASS 3.6: ${ADDED.length} keys added in both packs, ${RETIRED.length} retired keys gone from the packs and the conflict surfaces`)
