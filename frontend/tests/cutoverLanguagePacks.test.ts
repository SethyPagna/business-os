// Lane LI (branch cutover language packs): the strings the cutover lanes added or reworded, as a pair.
//
// verify:i18n proves the two packs have the same keys. It cannot prove the text is right, so this pins what the
// cutover needs from the text: one vocabulary for the one event, no sentence that names a branch (the names are data:
// Shop becomes "Old Shop", Warehouse becomes "LC Store"), Khmer that is Khmer, placeholders that match, and every
// Worker refusal that reaches a user going through a code and a pack key rather than raw English.
//
// The Worker half (its English constants equal the pack's English) is
// cloudflare/scripts/test-cutover-li-pack-parity-pure.cjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { importRowDetailText, importRowMessageText, importWarningText, IMPORT_ROW_SENTENCES, IMPORT_WARNING_CODES } from '../src/components/imports/importRowText.ts'
import { branchRuleErrorKey, branchRuleMessageKey, localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
const trFrom = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] ?? fallback
const KHMER = /[ក-៿]/

// Every key the cutover lanes added or reworded for users. Each must be a real pair.
const CLOSED_FAMILY = [
  'history_undo_closed_branch_retired', 'history_undo_closed_branch_cutover_move',
  'undo_refused_closed_branch_retired', 'undo_refused_closed_branch_cutover_move',
  'redo_refused_closed_branch_retired', 'redo_refused_closed_branch_cutover_move',
]
// The branch-rule refusals, including the three legacy keys that no longer have a call site (they carry the neutral text so
// a stray render can never say Shop or Warehouse) and the sale/expense refusals the Worker now sends by code.
const BRANCH_RULES = [
  'branch_not_sellable', 'transfer_branches_pair_only', 'transfer_single_branch', 'canonical_branch_configuration_invalid',
  'pos_warehouse_not_sellable', 'transfer_source_warehouse_only', 'transfer_canonical_pair_only',
  'sale_branch_mismatch', 'sale_identity_conflict', 'unrecorded_stock_line_invalid',
  'fee_branch_invalid', 'fee_sale_invalid', 'fee_sale_branch_mismatch',
]
const REFUSALS = ['branch_retired_no_successor', 'canonical_branch_identity_locked']
const IMPORT_TEXT = ['stock_import_branch_routing', 'stock_import_quantity_required']
const ALL = [...CLOSED_FAMILY, ...BRANCH_RULES, ...REFUSALS, ...IMPORT_TEXT]

runTest('every cutover string is a pair: present in both packs, Khmer script in km, not a copy of the English', () => {
  for (const key of ALL) {
    assert.ok(typeof en[key] === 'string' && en[key].trim(), `en.${key}`)
    assert.ok(typeof km[key] === 'string' && km[key].trim(), `km.${key}`)
    assert.match(km[key], KHMER, `km.${key} is Khmer`)
    assert.notEqual(km[key], en[key], `km.${key} is not the English`)
  }
})

runTest('placeholders match: km carries exactly the {names} en does', () => {
  const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  for (const key of ALL) assert.equal(names(km[key]), names(en[key]), `${key} placeholders`)
  assert.equal(names(en.stock_import_branch_routing), 'branch,columns,total')
})

runTest('no sentence names a branch: the names are data, so the text says "the old branch" and "a selling branch"', () => {
  // stock_import_quantity_required is the exception: shop / warehouse / store there are the sheet's column names.
  for (const key of ALL.filter((key) => key !== 'stock_import_quantity_required')) {
    for (const pack of [en, km]) assert.doesNotMatch(pack[key], /\b(Shop|Warehouse|LC Store|Old Shop)\b/, `${key}: ${pack[key]}`)
  }
})

runTest('the branch-rule sentences are true both before and after the cutover: no count of branches, no "exactly one"', () => {
  // Before the cutover two branches are active; after it only one is. A sentence that says "the two operating branches" or
  // "exactly one active Shop and one active Warehouse" is wrong in one of the two states.
  for (const key of BRANCH_RULES) assert.doesNotMatch(en[key], /\b(?:two operating|exactly one|the two)\b/i, `en.${key}: ${en[key]}`)
})

runTest('one word for the one event: the closed-by-consolidation family says "consolidation", never "merge"', () => {
  for (const key of CLOSED_FAMILY) {
    assert.match(en[key], /consolidation/, `en.${key}`)
    assert.doesNotMatch(en[key], /merge/i, `en.${key} would read like the product-merge closure`)
  }
  // The product-merge closure keeps its own word; the two families must stay distinguishable.
  assert.match(en.history_undo_closed_merged, /merged/)
  // The Khmer for the event is the same phrase everywhere it appears.
  for (const key of CLOSED_FAMILY) assert.ok(km[key].includes('ការបញ្ចូលសាខា'), `km.${key} uses ការបញ្ចូលសាខា`)
})

runTest('an undo/redo refusal says which action, that it is closed, and that nothing changed', () => {
  for (const [key, word, khmer] of [
    ['undo_refused_closed_branch_retired', 'Undo', 'ត្រឡប់វិញ'], ['undo_refused_closed_branch_cutover_move', 'Undo', 'ត្រឡប់វិញ'],
    ['redo_refused_closed_branch_retired', 'Redo', 'ធ្វើឡើងវិញ'], ['redo_refused_closed_branch_cutover_move', 'Redo', 'ធ្វើឡើងវិញ'],
  ] as const) {
    assert.ok(en[key].startsWith(`${word} closed:`), `en.${key}`)
    assert.match(en[key], /Nothing was changed\.$/)
    assert.ok(km[key].includes(khmer), `km.${key} names the action`)
    assert.ok(km[key].includes('គ្មានអ្វីត្រូវបានផ្លាស់ប្ដូរទេ'), `km.${key} says nothing changed`)
  }
  assert.match(en.undo_refused_closed_branch_retired, /Make a new change instead/)
  assert.ok(km.undo_refused_closed_branch_retired.includes('សូមធ្វើការផ្លាស់ប្ដូរថ្មីជំនួសវិញ'))
})

runTest('the code-fallback English in the call sites is the pack English, one statement', () => {
  const bar = read('src/components/shared/ActionHistoryBar.tsx')
  for (const key of ['history_undo_closed_branch_retired', 'history_undo_closed_branch_cutover_move']) {
    assert.ok(bar.includes(`T('${key}', '${en[key]}')`), `ActionHistoryBar falls back to the pack English for ${key}`)
  }
  const refusal = read('src/components/returns/helpers/returnRefusalError.ts')
  assert.ok(refusal.includes(`'branch_retired_no_successor': '${en.branch_retired_no_successor}'`))
})

runTest('the retired-branch refusal is restated by code from the pack key named after the code', () => {
  assert.match(read('src/components/returns/helpers/returnRefusalError.ts'), /'branch_retired_no_successor':/)
  assert.ok(en.branch_retired_no_successor && km.branch_retired_no_successor, 'the key is the code')
  assert.match(en.branch_retired_no_successor, /inactive branch/)
  assert.ok(km.branch_retired_no_successor.includes('សាខាអសកម្ម'), 'km says inactive branch with the pack word for inactive')
})

runTest('the identity lock is restated by code and by the Worker sentence, as the role-neutral pack text, in both languages', () => {
  // The Worker sentence names Shop and Warehouse and is pinned by cloudflare/scripts/test-undo-appliers-pure.cjs, so it
  // stays; the operator reads the pack text, which names no branch.
  const worker = 'Branches are fixed to Shop and Warehouse. You can edit their details, but you cannot add, rename, deactivate, or delete a branch.'
  assert.ok(read('../cloudflare/src/lib/canonicalBranchIdentity.ts').includes(worker), 'the Worker still sends this sentence')
  assert.equal(en.canonical_branch_identity_locked, 'Branches are managed by the system. You can edit the details of a branch, but you cannot add, rename, deactivate, or delete a branch.')
  assert.equal(branchRuleErrorKey({ code: 'canonical_branch_identity_locked', message: 'anything' }), 'canonical_branch_identity_locked')
  assert.equal(branchRuleMessageKey(worker), 'canonical_branch_identity_locked')
  assert.equal(branchRuleMessageKey(`Error: ${worker}`), 'canonical_branch_identity_locked', 'a decorated message')
  assert.equal(localizeBranchRuleError(worker, (key) => km[key]), km.canonical_branch_identity_locked)
  assert.equal(localizeBranchRuleError(worker, (key) => en[key]), en.canonical_branch_identity_locked)
})

runTest('the import routing note is restated from the pack with its values, in both languages', () => {
  const warning = {
    kind: 'other', message: 'Shop 5 + Warehouse 3 -> LC Store 8', code: 'stock_import_branch_routing',
    params: { columns: 'shop 5 + warehouse 3', branch: 'LC Store', total: 8 },
  }
  assert.equal(importWarningText(warning, trFrom(en)), 'Columns combined at LC Store: shop 5 + warehouse 3 = 8')
  const khmer = importWarningText(warning, trFrom(km))
  assert.match(khmer, KHMER)
  for (const value of ['LC Store', 'shop 5 + warehouse 3', '8']) assert.ok(khmer.includes(value), `km names ${value}`)
  assert.ok(!/[{}]/.test(khmer), 'every placeholder is filled')
  // A branch name that itself reads like a placeholder is printed as it is, not substituted again.
  assert.equal(importWarningText({ ...warning, params: { ...warning.params, branch: 'Counter {total}' } }, trFrom(en)),
    'Columns combined at Counter {total}: shop 5 + warehouse 3 = 8')
})

runTest('a warning without its code, with an unknown code, or with any param missing keeps the Worker English', () => {
  const english = 'Shop 5 + Warehouse 3 -> LC Store 8'
  const params = { columns: 'shop 5 + warehouse 3', branch: 'LC Store', total: 8 }
  assert.equal(importWarningText({ kind: 'other', message: english }, trFrom(km)), english)
  assert.equal(importWarningText({ kind: 'other', message: english, code: 'toString', params }, trFrom(km)), english, 'no prototype key is a code')
  assert.equal(importWarningText({ kind: 'other', message: english, code: 'something_new', params }, trFrom(km)), english)
  for (const broken of [null, undefined, [], {}, { ...params, branch: '  ' }, { ...params, total: Number.NaN }, { columns: 'shop 5' }]) {
    assert.equal(importWarningText({ kind: 'other', message: english, code: 'stock_import_branch_routing', params: broken as never }, trFrom(km)), english, JSON.stringify(broken))
  }
  // A pack without the key still reads, in English.
  assert.equal(importWarningText({ kind: 'other', message: english, code: 'stock_import_branch_routing', params }, (_key, fallback) => fallback), english)
})

runTest('the row message restates the reworded quantity sentence in place and leaves every other sentence alone', () => {
  const sentence = 'Enter a shop, warehouse or store quantity.'
  assert.equal(importRowMessageText(sentence, trFrom(en)), sentence)
  assert.equal(importRowMessageText(sentence, trFrom(km)), km.stock_import_quantity_required)
  assert.equal(importRowMessageText(`Name or barcode is required. ${sentence}`, trFrom(km)), `Name or barcode is required. ${km.stock_import_quantity_required}`)
  assert.equal(importRowMessageText('Prices must be non-negative numbers.', trFrom(km)), 'Prices must be non-negative numbers.')
  assert.equal(importRowMessageText(null, trFrom(km)), '')
  assert.ok(km.stock_import_quantity_required.includes('shop, warehouse'), 'the column names stay as the sheet spells them')
})

runTest('the Details cell: an error message wins, else the warnings joined, else a dash', () => {
  const routing = { kind: 'other', message: 'Shop 1 + Warehouse 2 -> LC Store 3', code: 'stock_import_branch_routing', params: { columns: 'shop 1 + warehouse 2', branch: 'LC Store', total: 3 } }
  assert.equal(importRowDetailText({ message: null, warnings: [routing] }, trFrom(km)), km.stock_import_branch_routing.replace('{branch}', 'LC Store').replace('{columns}', 'shop 1 + warehouse 2').replace('{total}', '3'))
  assert.equal(importRowDetailText({ message: 'Name or barcode is required.', warnings: [routing] }, trFrom(km)), 'Name or barcode is required.')
  assert.equal(importRowDetailText({ message: null, warnings: [routing, { kind: 'stock_action_conflict', message: 'Stock changed.' }] }, trFrom(en)),
    'Columns combined at LC Store: shop 1 + warehouse 2 = 3 · Stock changed.')
  assert.equal(importRowDetailText({ message: '', warnings: [] }, trFrom(km)), '—')
})

runTest('the review table renders its Details cell through the helper, and the tables name real pack keys', () => {
  const screen = read('src/components/imports/ServerImportReviewScreen.tsx')
  assert.ok(screen.includes('{importRowDetailText(row, tr)}'), 'the Details cell uses the helper')
  assert.doesNotMatch(screen, /\(row\.warnings \|\| \[\]\)\.map\(\(warning\) => warning\.message\)/, 'no raw warning.message join is left')
  for (const spec of Object.values(IMPORT_WARNING_CODES)) assert.ok(en[spec.key] && km[spec.key], spec.key)
  for (const [, key] of IMPORT_ROW_SENTENCES) assert.ok(en[key] && km[key], key)
})

runTest('the Worker still sends the code, the params and the sentence the helper restates', () => {
  const importLib = read('../cloudflare/src/lib/stockActionImport.ts')
  assert.ok(importLib.includes("code: 'stock_import_branch_routing' as const"), 'the note carries its code')
  assert.ok(importLib.includes('params: { columns:'), 'and its values')
  assert.ok(importLib.includes(`errors.push('${en.stock_import_quantity_required}')`), 'the quantity sentence is the pack English')
  assert.ok(read('../cloudflare/src/lib/stockActionCatalog.ts').includes('...(row.branchNoteDetails?.[index] ?? {})'), 'the catalog forwards code + params on the warning')
})

runTest('the sheet-mode help names every quantity column the template accepts, in the packs and in the modal fallbacks', () => {
  const modal = read('src/components/products/import/StockActionImportModal.tsx')
  for (const key of ['stock_import_mode_direct_help', 'stock_import_mode_reconcile_help']) {
    assert.ok(en[key].startsWith('shop/warehouse/store '), `en.${key} lists shop/warehouse/store`)
    assert.ok(km[key].startsWith('shop/warehouse/store '), `km.${key} lists shop/warehouse/store`)
    // The modal's Khmer fallback is a shorter sentence than the pack's (it predates this lane); the column list is what must agree.
    assert.ok(modal.includes(`tr('${key}', '${en[key]}', 'shop/warehouse/store `), `the modal fallbacks for ${key} list the same three columns, the English is the pack text`)
  }
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('cutover language pack tests passed')
