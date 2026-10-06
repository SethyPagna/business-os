// Lane LI (branch cutover language packs): the English the Worker sends for each refusal that reaches a user is the
// English of a pack key, word for word, and names no branch.
//
// A refusal that reaches the browser is restated from the language pack by its CODE (frontend/src/api/
// actionHistoryTransport.ts REPLAY_REFUSAL_KEYS, components/returns/helpers/returnRefusalError.ts, api/
// branchRuleErrors.ts). The English the Worker also sends is the fallback for a caller that cannot map the code, and
// it must not become a second wording: a Khmer-pack edit that is not mirrored here, or a Worker sentence that names
// "Shop" or "LC Store" (the names are data: Shop becomes "Old Shop", Warehouse becomes "LC Store"), is a defect.
//
// What is pinned:
//   1. branchCutoverHistory.ts and undoAppliers.ts say the same two undo-closed sentences, both equal to the packs'
//      undo_refused_closed_branch_* English (the redo packs differ only in the first word, as for every refusal).
//   2. branchEffect.ts's retired-branch refusal equals en.branch_retired_no_successor, and the code is the key.
//   3. canonicalBranchIdentity.ts's identity-lock refusal keeps its pinned sentence (it names Shop and Warehouse); the pack
//      text is role-neutral and the frontend maps the sentence and the code to it.
//   4. The import routing preview note keeps its English (a pinned test elsewhere) and also carries a code + params.
//   5. None of these sentences names Shop, Warehouse, LC Store or Old Shop.
//
// Run: node scripts/test-cutover-li-pack-parity-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')

let failed = 0
function runTest(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const root = path.join(__dirname, '..', '..')
const src = (rel) => fs.readFileSync(path.join(root, 'cloudflare', 'src', rel), 'utf8')
const en = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'src', 'lang', 'en.json'), 'utf8'))
const km = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'src', 'lang', 'km.json'), 'utf8'))

// `export const NAME = '...'` (optionally continued on the next line), single-quoted, no escapes in these sentences.
function constant(rel, name) {
  const match = new RegExp(`export const ${name} =\\s*'([^']*)'`).exec(src(rel))
  assert.ok(match, `${rel} exports ${name} as a plain string`)
  return match[1]
}
const NAMES = /\b(?:Shop|Warehouse|LC Store|Old Shop)\b/

runTest('the undo-closed sentences: history module, applier table and the pack say the same thing', () => {
  const retired = constant('lib/branchCutoverHistory.ts', 'UNDO_CLOSED_BRANCH_RETIRED_MESSAGE')
  const move = constant('lib/branchCutoverHistory.ts', 'UNDO_CLOSED_BRANCH_CUTOVER_MOVE_MESSAGE')
  assert.equal(retired, en.undo_refused_closed_branch_retired)
  assert.equal(move, en.undo_refused_closed_branch_cutover_move)
  const appliers = src('lib/undoAppliers.ts')
  assert.ok(appliers.includes(`code: 'undo_closed_branch_retired',\r\n    message: '${retired}',`) || appliers.includes(`code: 'undo_closed_branch_retired',\n    message: '${retired}',`),
    'undoAppliers.ts carries the same retired-branch sentence')
  assert.ok(appliers.includes(`code: 'undo_closed_branch_cutover_move',\r\n    message: '${move}',`) || appliers.includes(`code: 'undo_closed_branch_cutover_move',\n    message: '${move}',`),
    'undoAppliers.ts carries the same move sentence')
  // The redo pack differs from the undo pack only in its first word.
  assert.equal(en.redo_refused_closed_branch_retired, en.undo_refused_closed_branch_retired.replace(/^Undo closed:/, 'Redo closed:'))
  assert.equal(en.redo_refused_closed_branch_cutover_move, en.undo_refused_closed_branch_cutover_move.replace(/^Undo closed:/, 'Redo closed:'))
})

runTest('the retired-branch refusal: the Worker English is the pack English and the code is the pack key', () => {
  const code = constant('lib/branchEffect.ts', 'BRANCH_RETIRED_NO_SUCCESSOR_CODE')
  assert.equal(code, 'branch_retired_no_successor')
  assert.equal(constant('lib/branchEffect.ts', 'BRANCH_RETIRED_NO_SUCCESSOR_ERROR'), en[code])
  assert.ok(km[code] && /[ក-៿]/.test(km[code]) && km[code] !== en[code], 'and the Khmer pack has it')
})

runTest('the identity-lock refusal: the code is the pack key, the pack text names no branch, the Worker sentence is the one the frontend maps', () => {
  const code = constant('lib/canonicalBranchIdentity.ts', 'CANONICAL_BRANCH_IDENTITY_CODE')
  assert.equal(code, 'canonical_branch_identity_locked')
  assert.ok(km[code] && /[ក-៿]/.test(km[code]) && km[code] !== en[code], 'the Khmer pack has it')
  assert.doesNotMatch(en[code], NAMES, 'the pack text is role-neutral')
  // The Worker sentence names Shop and Warehouse and is pinned by test-undo-appliers-pure.cjs, so it is NOT the pack text;
  // the frontend restates it by code, and by this exact sentence when the code is missing.
  const worker = constant('lib/canonicalBranchIdentity.ts', 'CANONICAL_BRANCH_IDENTITY_ERROR')
  const ruleErrors = fs.readFileSync(path.join(root, 'frontend', 'src', 'api', 'branchRuleErrors.ts'), 'utf8')
  assert.ok(ruleErrors.includes(`['${worker}', 'canonical_branch_identity_locked']`), 'branchRuleErrors.ts maps the Worker sentence to the pack key')
})

runTest('no sentence the Worker sends for these refusals names a branch', () => {
  for (const [rel, name] of [
    ['lib/branchCutoverHistory.ts', 'UNDO_CLOSED_BRANCH_RETIRED_MESSAGE'],
    ['lib/branchCutoverHistory.ts', 'UNDO_CLOSED_BRANCH_CUTOVER_MOVE_MESSAGE'],
    ['lib/branchEffect.ts', 'BRANCH_RETIRED_NO_SUCCESSOR_ERROR'],
    ['lib/branchRoleGuards.ts', 'BRANCH_NOT_SELLABLE_ERROR'],
    ['lib/branchRoleGuards.ts', 'TRANSFER_DIRECTION_ERROR'],
  ]) assert.doesNotMatch(constant(rel, name), NAMES, `${name}`)
})

runTest('the import routing note keeps its pinned English and also carries a code and its values', () => {
  const lib = src('lib/stockActionImport.ts')
  // test-stock-action-import-pure.cjs pins the English ("Shop 2 + Warehouse 3 -> LC Store 5"); this only checks the form.
  assert.ok(lib.includes("slotLabel = { shop: 'Shop', warehouse: 'Warehouse', store: 'Store' }"), 'the English labels the pinned test expects')
  assert.ok(lib.includes("code: 'stock_import_branch_routing' as const"))
  assert.ok(lib.includes("branch: entry.refs[0].branchName, total: entry.value"))
  assert.ok(en.stock_import_branch_routing.includes('{branch}') && en.stock_import_branch_routing.includes('{columns}') && en.stock_import_branch_routing.includes('{total}'))
  assert.ok(km.stock_import_branch_routing.includes('{branch}') && km.stock_import_branch_routing.includes('{columns}') && km.stock_import_branch_routing.includes('{total}'))
  assert.ok(lib.includes(`errors.push('${en.stock_import_quantity_required}')`), 'the reworded quantity sentence is the pack English')
  assert.ok(src('lib/stockActionCatalog.ts').includes('...(row.branchNoteDetails?.[index] ?? {})'), 'the catalog forwards the code on the warning')
  assert.ok(src('lib/importEngine.ts').includes('code?: string; params?: Record<string, string | number>'), 'ImportRowWarning allows them')
})

runTest('the sale, transfer and expense refusals are role-neutral and equal the pack English of the key named after their code', () => {
  const guards = 'lib/branchRoleGuards.ts'
  const pairs = [
    ['BRANCH_NOT_SELLABLE_CODE', 'BRANCH_NOT_SELLABLE_ERROR'],
    ['SALE_BRANCH_MISMATCH_CODE', 'SALE_BRANCH_MISMATCH_ERROR'],
    ['SALE_IDENTITY_CONFLICT_CODE', 'SALE_IDENTITY_CONFLICT_ERROR'],
    ['UNRECORDED_STOCK_LINE_CODE', 'UNRECORDED_STOCK_LINE_ERROR'],
  ]
  for (const [codeName, errorName] of pairs) {
    const code = constant(guards, codeName)
    assert.equal(constant(guards, errorName), en[code], `${errorName} is en.${code}`)
    assert.ok(km[code] && /[ក-៿]/.test(km[code]) && km[code] !== en[code], `km.${code}`)
    assert.doesNotMatch(en[code], NAMES, code)
  }
  // The transfer sentences have no code constant of their own: transfer_direction_invalid -> transfer_branches_pair_only,
  // canonical_branch_configuration_invalid -> the key of the same name.
  assert.equal(constant(guards, 'TRANSFER_DIRECTION_ERROR'), en.transfer_branches_pair_only)
  assert.equal(constant('lib/canonicalBranchIdentity.ts', 'CANONICAL_BRANCH_CONFIGURATION_ERROR'), en.canonical_branch_configuration_invalid)
  assert.equal(constant('lib/canonicalBranchIdentity.ts', 'CANONICAL_BRANCH_CONFIGURATION_CODE'), 'canonical_branch_configuration_invalid')
  // True before AND after the cutover: neither says Shop, Warehouse, "two" branches or "exactly one active".
  for (const key of ['transfer_branches_pair_only', 'canonical_branch_configuration_invalid', 'pos_warehouse_not_sellable', 'transfer_source_warehouse_only', 'transfer_canonical_pair_only']) {
    assert.doesNotMatch(en[key], /\b(?:Shop|Warehouse|LC Store|Old Shop|two operating|exactly one)\b/, key)
    assert.ok(km[key] && /[ក-៿]/.test(km[key]), `km.${key}`)
  }
  // The expense writers' sentences live in routes/fees.ts (tests load it with its imports wired by name).
  const fees = src('routes/fees.ts')
  for (const code of ['fee_branch_invalid', 'fee_sale_invalid', 'fee_sale_branch_mismatch']) {
    assert.ok(fees.includes(`error: '${en[code]}', code: '${code}'`), `fees.ts sends en.${code} with its code`)
    assert.ok(km[code] && /[ក-៿]/.test(km[code]), `km.${code}`)
  }
})

runTest('no refusal literal in the sale or expense routes names the Shop or the Warehouse', () => {
  for (const rel of ['routes/sales.ts', 'routes/fees.ts']) {
    const text = src(rel)
    const named = []
    for (const match of text.matchAll(/(?:error|message):\s*(['"`])([^'"`\r\n]*)\1/g)) {
      if (NAMES.test(match[2])) named.push(match[2])
    }
    assert.deepEqual(named, [], `${rel} has refusal sentences that name a branch`)
  }
  const sales = src('routes/sales.ts')
  assert.equal((sales.match(/NOT_SELLING_BRANCH_BODY, 400\)/g) || []).length, 8)
  assert.equal((sales.match(/SALE_BRANCH_MISMATCH_BODY, 400\)/g) || []).length, 4)
  assert.doesNotMatch(sales, /SHOP_ONLY_SALE_ERROR/)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('cutover LI pack parity tests passed')
