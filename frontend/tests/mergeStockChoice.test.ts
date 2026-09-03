// "What happens when I save one and the other child row also has stock?"
//
// Keeping one of a name-twin pair used to fold the discarded row's stock onto
// the keeper SILENTLY -- including rows the reviewer had explicitly marked
// Remove -- and the product form's "that name already exists" collision was a
// dead-end alert(). Merging the stock in and writing it off give OPPOSITE
// inventory answers, so the operator has to say which, with the real numbers
// in front of them, on EVERY surface that resolves a twin.
//
// This pins the shape of that contract:
//   1. one shared flow (useMergeStockChoice) -- not three divergent copies;
//   2. the question is asked through the shared ConfirmDialog, never
//      window.confirm, and never with an option pre-selected;
//   3. both dispositions are offered, with the lot/branch/summing behaviour
//      spelled out and the per-branch stock shown;
//   4. the price a merge would quietly raise is shown before -> after;
//   5. all three twin-resolving surfaces route through the shared flow;
//   6. the transport can carry the answer, and the server's refusal
//      (stock_choice_required) reaches the UI with its breakdown attached.
//
// Run: node tests/mergeStockChoice.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]): string => readFileSync(join(here, '..', 'src', ...parts), 'utf8')

const dialog = read('components', 'products', 'MergeStockChoiceDialog.tsx')
const hook = read('components', 'products', 'useMergeStockChoice.tsx')
const duplicatesTab = read('components', 'products', 'ProductDuplicatesTab.tsx')
const productsPage = read('components', 'products', 'Products.tsx')
const productForm = read('components', 'products', 'forms', 'ProductForm.tsx')
const transport = read('api', 'productWriteTransport.ts')
const http = read('api', 'http.ts')
const en = JSON.parse(read('lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('lang', 'km.json')) as Record<string, string>

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

test('the choice is asked through the shared ConfirmDialog, never window.confirm', () => {
  assert.match(dialog, /import ConfirmDialog from '\.\.\/shared\/ConfirmDialog'/)
  assert.match(dialog, /<ConfirmDialog/)
  // Comments discuss window.confirm on purpose (it is what these replaced), so
  // strip them before looking for a real call.
  const code = (src: string): string => src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [label, src] of [['dialog', dialog], ['hook', hook], ['duplicates tab', duplicatesTab]] as const) {
    assert.ok(!/window\.confirm|[^.\w]confirm\(/.test(code(src)), `${label} must not fall back to a native confirm()`)
  }
})

test('both dispositions are offered and neither is pre-selected', () => {
  assert.match(dialog, /value: 'merge'/)
  assert.match(dialog, /value: 'write_off'/)
  // Starting unanswered is the point: a pre-selected option would let a
  // distracted Enter pick a disposition nobody chose.
  assert.match(dialog, /useState<MergeStockChoice \| null>\(null\)/)
  assert.match(dialog, /confirmDisabled=\{needsChoice && !choice\}/)
  assert.match(dialog, /danger=\{choice === 'write_off' \|\| identityDiffers\}/, 'writing stock off is the destructive branch')
})

test('MERGE explains that same-lot same-branch quantities are ADDED, not replaced', () => {
  const hint = en.merge_stock_choice_merge_hint
  assert.ok(hint, 'merge_stock_choice_merge_hint must ship in the pack')
  assert.match(hint, /lot code/i)
  assert.match(hint, /batch number/i)
  assert.match(hint, /branch/i)
  assert.match(hint, /added together/i)
})

test('REMOVE explains the balancing stock movement (reason, who, when)', () => {
  const hint = en.merge_stock_choice_write_off_hint
  assert.ok(hint, 'merge_stock_choice_write_off_hint must ship in the pack')
  assert.match(hint, /stock movement/i)
  assert.match(hint, /reason/i)
  assert.match(hint, /ledger/i)
})

test('the dialog shows the stock the discarded row actually holds, per branch and per lot', () => {
  assert.match(dialog, /impact\.branches\.map/)
  assert.match(dialog, /branch\.quantity/)
  assert.match(dialog, /branch\.lotCount/)
  assert.match(dialog, /impact\.totalQuantity/)
  assert.match(dialog, /impact\.lotCount/)
})

test('a merge that would raise the keeper\'s price says so, before -> after per field', () => {
  assert.match(dialog, /pricing\?\.changes/)
  assert.match(dialog, /change\.from/)
  assert.match(dialog, /change\.to/)
  for (const field of ['selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr']) {
    assert.ok(dialog.includes(field), `${field} must have a label in the price-change table`)
  }
  assert.match(hook, /const wouldReprice = Boolean\(pricing\?\.changes\?\.length\)/)
  assert.match(hook, /if \(!needsChoice && !wouldReprice && !crossIdentity && !fillsCost\)/, 'a silent reprice must still stop for confirmation')
})

test('there is ONE shared flow, and all three twin-resolving surfaces use it', () => {
  assert.match(hook, /export function useMergeStockChoice/)
  for (const [label, src] of [
    ['Conflicts/duplicates tab', duplicatesTab],
    ['products list exact-duplicate resolver', productsPage],
    ['product form collision path', productForm],
  ] as const) {
    assert.match(src, /useMergeStockChoice/, `${label} must route through the shared flow`)
    assert.match(src, /mergeWithChoice\(/, `${label} must merge through mergeWithChoice`)
    assert.match(src, /\{mergeStockChoiceDialog\}/, `${label} must render the dialog`)
  }
  // No surface may reach past the flow and merge without an answer.
  for (const [label, src] of [['duplicates tab', duplicatesTab], ['products page', productsPage], ['product form', productForm]] as const) {
    assert.ok(!/mergePossiblySameProducts\(/.test(src), `${label} must not call the raw merge transport directly`)
  }
})

test('saving a product into an existing twin offers the merge instead of dead-ending', () => {
  assert.match(productForm, /duplicateCollisionFrom\(error\)/)
  assert.match(productForm, /'duplicate_product'/, 'the 409 the server sends is what opens the merge')
  assert.match(productForm, /if \(outcome === 'merged'\)/)
})

test('the transport carries the answer and the server refusal keeps its breakdown', () => {
  assert.match(transport, /stock\?: 'merge' \| 'write_off'/)
  assert.match(transport, /stock \? \{ keepId, mergeId, stock \} : \{ keepId, mergeId \}/,
    'an unanswered merge must omit the field so the server can refuse rather than guess')
  assert.match(transport, /merge-preview/)
  assert.match(http, /error\.stockImpact = parsed\?\.stockImpact \|\| null/)
  assert.match(hook, /'stock_choice_required'/, 'the server refusal must reopen the same dialog')
})

test('every new string ships in BOTH packs', () => {
  const keys = [
    'merge_stock_choice_title', 'merge_stock_choice_lead', 'merge_stock_choice_lead_empty',
    'merge_stock_choice_merge', 'merge_stock_choice_merge_hint',
    'merge_stock_choice_write_off', 'merge_stock_choice_write_off_hint',
    'merge_stock_choice_note', 'merge_price_change_title', 'merge_price_change_hint',
    'merge_duplicate_confirm_title', 'bulk_merge_cancelled_count', 'special_price_khr',
  ]
  for (const key of keys) {
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.ok(/[ក-៿]/.test(km[key]), `km.json ${key} is not actually Khmer`)
  }
  // The Conflicts hint has to tell reviewers the stock question exists before
  // they hit it mid-merge.
  assert.match(en.product_duplicates_hint, /still holds stock/i)
  assert.ok(/[ក-៿]/.test(km.product_duplicates_hint))
})

test('a barcode or cost mismatch is NEVER auto-merged', () => {
  // Name + barcode + cost is the identity rule: a row differing on barcode or
  // cost is a legitimate sibling child row, not a duplicate. Bulk merge only
  // ever automates a pair that agrees on all of them (a GTIN-14/EAN-13 leading
  // zero being the one documented equivalence).
  const guard = duplicatesTab.slice(
    duplicatesTab.indexOf('function clusterIsSafeAutoMerge'),
    duplicatesTab.indexOf('function chooseAutomaticKeeper'),
  )
  assert.ok(guard, 'the auto-merge guard must exist')
  assert.match(guard, /normalizeProductGroupName\(a\.name\) !== normalizeProductGroupName\(b\.name\)/)
  // Costs are judged by the SHARED cost ruling (compareCosts, both currencies
  // inside it), never by a local equality test: a cost of 0/NULL is missing,
  // not different, and only a genuine difference blocks the automatic path.
  // The truth table itself is pinned in tests/productCostRuling.test.ts.
  assert.match(guard, /compareCosts\(a, b\) === 'differs'/, 'a real cost mismatch must block the automatic path')
  assert.match(guard, /cleanupBarcode\(a\.barcode\) === cleanupBarcode\(b\.barcode\)/,
    'only a leading-zero-equivalent barcode may auto-merge')
  assert.match(duplicatesTab, /targets\.filter\(clusterIsSafeAutoMerge\)/, 'bulk merge must run through the guard')
})

test('a cross-identity merge says which field differs, and is never silent', () => {
  assert.match(dialog, /identity && !identity\.same && identity\.differs\.length/)
  for (const field of ['name', 'barcode', 'cost_price_usd', 'cost_price_khr']) {
    assert.ok(dialog.includes(field), `${field} must have a label in the identity table`)
  }
  assert.match(dialog, /diff\.keeper/)
  assert.match(dialog, /diff\.discarded/)
  assert.match(dialog, /danger=\{choice === 'write_off' \|\| identityDiffers\}/,
    'moving stock onto a different-identity row is a destructive-looking decision')
  // The hook must stop for it even when there is no stock and no price to move.
  assert.match(hook, /const crossIdentity = Boolean\(identity && !identity\.same && identity\.differs\.length\)/)
  assert.match(hook, /if \(!needsChoice && !wouldReprice && !crossIdentity && !fillsCost\)/)
  assert.ok(en.merge_identity_differs_title && km.merge_identity_differs_title)
  assert.match(en.merge_stock_choice_merge_cross_identity, /different barcode or cost/i)
})

test('every child row under the name is swept -- no rows[0], no LIMIT 1', () => {
  // The list surfaces loop EVERY member/removal rather than acting on the first.
  assert.match(productsPage, /info\.members\.filter\(\(m\) => Number\(m\.id\) !== Number\(keepId\)\)/)
  assert.match(productsPage, /for \(const other of others\)/)
  assert.match(duplicatesTab, /for \(const other of removals\)/)
})

test('the explanations live in InfoHints, not inline prose', () => {
  assert.match(dialog, /<InfoHint/)
  assert.match(dialog, /text=\{option\.hint\}/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll mergeStockChoice tests passed')
