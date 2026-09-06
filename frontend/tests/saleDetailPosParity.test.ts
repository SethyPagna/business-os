import assert from 'node:assert/strict'
import './saleSettlementUi.test.ts'
import './paymentMethodRename.test.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeSaleDetailText } from '../src/components/sales/saleDetailText.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8')
const detail = read('../src/components/sales/SaleDetailModal.tsx')
const workflow = read('../src/components/sales/SaleStatusWorkflow.tsx')
// N19: the add-items pick IS the POS pick, so the parity check reads the POS
// sheet, the adapter that mounts it, and the pure staging rule -- not a
// private picker of this screen's own.
const optionSheet = read('../src/components/shared/ProductOptionSheet.tsx')
const posSheet = read('../src/components/pos/ProductDetailSheet.tsx')
const pos = read('../src/components/pos/POS.tsx')
const addLineRules = read('../src/components/sales/saleAddLines.ts')
const salesDir = path.resolve(here, '../src/components/sales')
const backend = read('../../cloudflare/src/routes/sales.ts')
const productSearchBackend = read('../../cloudflare/src/routes/products.ts')
const saleLineAdditionBackend = read('../../cloudflare/src/lib/saleLineAddition.ts')
const salesStatusBackend = read('../../cloudflare/src/lib/salesStatus.ts')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

assert.equal(sanitizeSaleDetailText('  Sok\u0007 Dara  '), 'Sok Dara')
assert.equal(sanitizeSaleDetailText('Sok Ã©'), 'Sok é')
assert.equal(sanitizeSaleDetailText('អ្នកដឹកជញ្ជូន\u0000 ល្អ'), 'អ្នកដឹកជញ្ជូន ល្អ')

// Generate the two legacy decoding failures from known UTF-8, including C1
// bytes that Windows-1252 displays as punctuation instead of Latin-1 controls.
const asLatin1 = (text: string) => Buffer.from(text, 'utf8').toString('latin1')
const asWindows1252 = (text: string) => new TextDecoder('windows-1252').decode(Buffer.from(text, 'utf8'))
for (const corrupt of [asLatin1, asWindows1252]) {
  for (const name of ['ដារ៉ា', 'អ្នកដឹកជញ្ជូន', 'José', 'Sok “Dara” — driver', 'Dara 🚚']) {
    assert.equal(sanitizeSaleDetailText(corrupt(name)), name)
    assert.equal(sanitizeSaleDetailText(`ដារ៉ា ${corrupt(name)} 李`), `ដារ៉ា ${name} 李`)
  }
  // U+17A0 ends in byte A0: normalizing whitespace before repair loses it.
  assert.equal(sanitizeSaleDetailText(corrupt('\u17a0')), '\u17a0')
  assert.equal(sanitizeSaleDetailText(`Chloé${corrupt('é')}ដារ៉ា`), 'Chloééដារ៉ា')
  for (let code = 0x1780; code <= 0x17ff; code += 1) {
    const char = String.fromCodePoint(code)
    assert.equal(sanitizeSaleDetailText(corrupt(char)), char)
    assert.equal(sanitizeSaleDetailText(char), char)
  }
}
assert.equal(sanitizeSaleDetailText('Sok Ã© ដារ៉ា'), 'Sok é ដារ៉ា')
assert.equal(sanitizeSaleDetailText('â€™'), '’')
assert.equal(sanitizeSaleDetailText('ðŸšš'), '🚚')

for (const name of [
  'ដារ៉ា', 'José', 'Chloé', 'Ângela', 'Ãlvaro', 'Đặng Thị Ánh', 'Łukasz',
  '李 🚚', 'Sok “Dara” — driver', 'a\u0301', 'Dara\u200dSok',
  'Ã', 'á', 'â', 'ð', 'Ã(', 'á\u009e', 'á\u009e(', 'â€',
  'â\u0082(', 'ð\u009f\u009a', 'ð\u0080\u0080\u0080', 'Â\u0080', 'Sok \ufffd Dara',
]) {
  assert.equal(sanitizeSaleDetailText(name), name, `preserve ${JSON.stringify(name)}`)
}
assert.equal(sanitizeSaleDetailText('Sok Ã( Ã© ដារ៉ា'), 'Sok Ã( é ដារ៉ា')
// One reversible layer per call; no recursive guesses on double corruption.
assert.equal(sanitizeSaleDetailText(asLatin1(asLatin1('é'))), asLatin1('é'))
assert.equal(sanitizeSaleDetailText('  0012 034 567  '), '0012 034 567')
assert.equal(sanitizeSaleDetailText('+855 (0)12-034-567'), '+855 (0)12-034-567')
assert.equal(sanitizeSaleDetailText(null), '')
assert.equal(sanitizeSaleDetailText(undefined), '')
assert.equal(sanitizeSaleDetailText(0), '0')

assert.match(detail, /placeholder=\{translateOr\('add_items_search_placeholder', 'Search by name or barcode'/)
assert.match(detail, /buildProductGroups\(addCandidates, new Map\(\), \{ preserveInputOrder: true \}\)/)
assert.match(detail, /pageSize: 8/)
assert.match(productSearchBackend, /paginateProductFamilies/)
assert.match(productSearchBackend, /familyMemberBaseWhereSql: hasSearchTerm \? 'p\.is_active = 1' : undefined/)
assert.match(productSearchBackend, /expandSearchResultsToNameSiblings\(env, items/)
assert.match(detail, /const choices = \(group\.sellableItems\.length \? group\.sellableItems : \[group\.leadProduct\]\)/)
assert.match(detail, /__groupChoices: choices/)
assert.match(detail, /addCandidateGroups\.map\(\(candidate\)/)
assert.doesNotMatch(detail, /addCandidateGroups\.map\([\s\S]{0,900}candidate\.barcode/)
assert.match(detail, /const addSearchInputRef = useRef<HTMLInputElement \| null>\(null\)/)
assert.match(detail, /ref=\{addSearchInputRef\}/)
// ---- N19: the add-items pick IS the POS pick ----
//
// Owner, 2026-09-06: "for add to item, the design when clicked should be like
// the POS, same identical design, don't create new." It was not. The shared
// option sheet answered which row and which branch, and then a SECOND,
// private modal -- SaleDetailProductPicker.tsx, its own Modal layout, its own
// option grid, its own lot list -- asked the received date, the quantity and
// the price all over again. These assertions pin identity, not resemblance.

// 1. The private modal is gone, and nothing references it.
assert.equal(fs.existsSync(path.resolve(salesDir, 'SaleDetailProductPicker.tsx')), false)
// The name survives only in the comment that records why it went; nothing
// imports or renders it.
assert.doesNotMatch(detail, /import[^\r\n]*SaleDetailProductPicker|<SaleDetailProductPicker/)

// 2. Import identity: this screen and the POS mount the SAME sheet module.
//    ProductOptionSheet is a thin adapter over it, never a twin.
assert.match(detail, /import ProductOptionSheet from '\.\.\/shared\/ProductOptionSheet\.tsx'/)
assert.match(optionSheet, /import ProductDetailSheet from '\.\.\/pos\/ProductDetailSheet\.tsx'/)
assert.match(pos, /const ProductDetailSheet = lazyRetry\(\(\) => import\('\.\/ProductDetailSheet'\)/)
assert.match(optionSheet, /<ProductDetailSheet/)

// 3. No second sheet implementation survives in the sales folder: nothing
//    named like a picker/sheet, and nothing there fetching a lot list of its
//    own -- the received-date question belongs to the one sheet.
for (const file of fs.readdirSync(salesDir)) {
  assert.doesNotMatch(file, /ProductPicker|ProductSheet/, `second product sheet in components/sales: ${file}`)
  if (!/\.tsx?$/.test(file)) continue
  assert.doesNotMatch(
    fs.readFileSync(path.resolve(salesDir, file), 'utf8'),
    /getProductBatches/,
    `components/sales/${file} fetches its own lot list instead of using the shared sheet`,
  )
}

// 4. It opens as a SALE (warehouse shown greyed with its count, never
//    selectable), at the sale's own branch, and it is handed the tracked
//    product ids so the sheet's OWN received-date step can engage. Without
//    them that step could never appear -- which is exactly why a second modal
//    had to ask the lot question.
assert.match(detail, /<ProductOptionSheet[\s\S]{0,900}intent="sell"[\s\S]{0,500}trackedBatchProductIds=\{trackedBatchProductIds\}/)
assert.match(detail, /activeBranchId=\{sale\.branch_id \?\? null\}/)
assert.match(detail, /getTrackedBatchProductIds\(sale\?\.branch_id \?\? null\)/)
// A FAILED lookup must not collapse into "nothing is batch-tracked" -- that
// would drop the step from an addition that needs one and move stock with no
// lot recorded. Same rule POS.tsx and TransferModal.tsx follow.
assert.doesNotMatch(detail, /getTrackedBatchProductIds[\s\S]{0,500}catch[\s\S]{0,160}setTrackedBatchProductIds\(new Set\(\)\)/)
assert.match(optionSheet, /trackedBatchProductIds=\{trackedBatchProductIds\}/)
assert.match(posSheet, /trackedBatchProductIds\?\.has\(Number\(row\.id\)\)|trackedBatchProductIds/)

// 5. Both portalled sheets keep the sale modal underneath inert. Naming only
//    one left the other dismissable by a backdrop click that also ran the
//    sale's own close guard.
assert.match(detail, /inert=\{addSheetGroup \|\| replacePicking \? true : undefined\}/)
assert.match(detail, /aria-hidden=\{addSheetGroup \|\| replacePicking \? true : undefined\}/)
assert.match(detail, /onClick=\{addSheetGroup \|\| replacePicking \? undefined : closeGuard\.requestClose\}/)
assert.match(detail, /<UnsavedChangesPrompt guard=\{closeGuard\}/)
assert.match(detail, /requestAnimationFrame\(\(\) => addSearchInputRef\.current\?\.focus\(\)\)/)
// 6. A barcode -- typed or scanned -- NARROWS the list and never auto-adds
//    (owner rule, every surface). The search effect may only set candidates;
//    the ONE call that stages a line sits inside the sheet's onPick, behind a
//    human choice.
const addSearchEffect = detail.slice(
  detail.indexOf('const text = addQuery.trim()'),
  detail.indexOf('// What makes two staged lines the SAME line'),
)
assert.ok(addSearchEffect.length > 100, 'add-items search effect not found')
assert.doesNotMatch(addSearchEffect, /setAddSheetGroup|setAddLines|stagedLineFromSheetPick/)
assert.equal((detail.match(/stagedLineFromSheetPick\(/g) || []).length, 1, 'exactly one call site')
assert.match(detail, /<ProductOptionSheet[\s\S]{0,1400}onPick=\{\(picked, selection\) => \{[\s\S]{0,300}stageAddLineFromPick\(/)
assert.match(detail, /const stageAddLineFromPick = [\s\S]{0,400}stagedLineFromSheetPick\(picked, selection\)/)
// The results list only OPENS the sheet; it never commits a pick.
assert.match(detail, /onSelect=\{\(\) => setAddSheetGroup\(candidate\)\}/)

// 7. The staged line still lands in addLines exactly as before, and the rule
//    that builds it is one testable module rather than this file's text --
//    tests/saleAddLines.test.ts evaluates it on data.
assert.match(detail, /from '\.\/saleAddLines\.ts'/)
assert.match(detail, /stagedLineFromSheetPick,/)
assert.match(addLineRules, /import \{ branchStockQuantity, type BranchStockRow \} from '\.\.\/pos\/productSheetState\.ts'/)
// POS behaviour: a pick adds ONE unit at the row's own selling price, and a
// repeat pick bumps the quantity instead of duplicating the row.
assert.match(addLineRules, /quantity: 1,/)
assert.match(addLineRules, /unitPriceUsd: price,/)
assert.match(addLineRules, /priceText: price > 0 \? String\(price\) : '0'/)
assert.match(addLineRules, /quantity: merged\[index\]\.quantity \+ next\.quantity/)
// The cap is the shelf the sheet was read at, narrowed by the picked lot --
// never the CROSS-BRANCH stock_quantity the private modal staged.
assert.match(addLineRules, /batchQuantity \?\? branchStockQuantity\(picked, selection\?\.branchId\) \?\? toNumber\(picked\.stock_quantity\)/)
// One implementation of "units at this branch", shared with the sheet itself.
assert.match(posSheet, /branchStockQuantity\(variant, branchId\) \?\? 0/)
assert.ok(en.no_stock_in_branch && km.no_stock_in_branch)
assert.ok(en.not_enough_stock && km.not_enough_stock)
assert.ok(en.add && km.add)
assert.match(detail, /unitPriceUsd: toNumber\(text\)/)
assert.match(detail, /batch_id: line\.batchId/)
assert.match(detail, /batch_label: line\.batchLabel/)
assert.match(detail, /batch_expiry_date: line\.batchExpiryDate/)
assert.match(detail, /applied_price_usd: line\.unitPriceUsd/)
// 7b. The staged lot caption prints ONE date. `line.batchLabel` is
//     batchDisplayLabel's answer, which for a lot with no custom code already
//     IS the received date (local, day-first); the caption appended the raw
//     UTC slice beside it -- "02/09/2026 · Received: 2026-09-01", one date
//     twice, in two formats, on two different days east of UTC. The rule is
//     data-tested in tests/saleAddLines.test.ts.
assert.doesNotMatch(detail, /batchReceivedAt\.slice\(0, 10\)/)
assert.match(detail, /\{stagedLineBatchCaption\(line, t\)\}/)
assert.match(addLineRules, /import \{ formatBatchReceivedDate \} from '\.\.\/\.\.\/utils\/batchLabel\.ts'/)
assert.match(addLineRules, /import \{ fmtDateOnly \} from '\.\.\/\.\.\/utils\/formatters\.ts'/)
assert.match(addLineRules, /!label\.includes\(received\)/)
// Dates render through the app's formatter; the raw ISO stays on the wire.
assert.match(addLineRules, /fmtDateOnly\(expiry\)/)
// Whether the rendered caption really carries ONE formatted date and never a
// raw ISO is asserted on DATA, not on this file's text:
// tests/saleAddLines.test.ts runs the caption for a lot received at
// "2026-09-01 18:30:00" and asserts neither '2026-09-01' nor the stored
// expiry ISO survives into it.
// Both caption keys already ship in both packs -- no new string.
assert.ok(en.received_date && km.received_date)
assert.ok(en.expiry_date && km.expiry_date)
assert.match(detail, /const addStockMoves = !Number\(sale\?\.stock_skipped \|\| 0\)/)
assert.doesNotMatch(detail, /addStockMoves =[^\r\n]*[\r\n]+\s*&& currentStatus !== 'awaiting_payment'/)
const addStockMovesExpression = detail.match(/const addStockMoves = ([^\r\n]+)/)?.[1]
assert.ok(addStockMovesExpression)
const additionMovesStock = new Function('sale', `return (${addStockMovesExpression})`) as (sale: { stock_skipped?: number }) => boolean
assert.equal(additionMovesStock({ stock_skipped: 1 }), false)
assert.equal(additionMovesStock({ stock_skipped: 0 }), true, 'accepted statuses, including awaiting_payment, move stock unless sticky-skipped')
// The stock guard moved WHOLE onto the staged row (it is the only place a
// quantity is typed now), and it still reads the cap the sheet handed over.
assert.match(detail, /const addHasStockError = addStockMoves/)
assert.match(detail, /line\.stockQuantity <= 0 \|\| line\.quantity > line\.stockQuantity/)
assert.match(detail, /addStockMoves && \(line\.stockQuantity <= 0 \|\| line\.quantity > line\.stockQuantity\)/)
assert.match(detail, /disabled=\{addSaving \|\| addLines\.length === 0 \|\| addHasStockError\}/)
assert.match(detail, /if \(!onAddItems \|\| !addLines\.length \|\| addHasStockError\) return/)
assert.doesNotMatch(detail, /More than the stock this product had a moment ago/)
assert.match(detail, /t\('no_stock_in_branch'\)/)
assert.doesNotMatch(detail, /'No Stock'/)
assert.match(backend, /batchId: Number\(item\.batch_id\) \|\| null/)
assert.match(backend, /allocateNewSaleLines\(/)
assert.match(backend, /branchId: Number\(item\.branch_id \|\| sale\.branch_id\) \|\| null/)
assert.match(saleLineAdditionBackend, /if \(!line\.branchId\) \{[\s\S]{0,160}cannot use a batch without a branch/)
assert.match(saleLineAdditionBackend, /if \(!line\.branchId \|\| line\.heldUnits <= 0\) continue/)
assert.match(salesStatusBackend, /\['completed', 'awaiting_payment', 'awaiting_delivery'\]/)

assert.match(detail, /<SaleStatusWorkflow/)
assert.match(workflow, /'closed' \| 'destination' \| 'review'/)
assert.match(workflow, /Choose destination status/)
assert.match(workflow, /getStatusLabel\(currentStatus, t\)/)
assert.match(workflow, /getStatusLabel\(selectedStatus, t\)/)
assert.match(workflow, /onClick=\{onConfirm\}/)

console.log('sale-detail POS parity and personalized status workflow tests passed')
