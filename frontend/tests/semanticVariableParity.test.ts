// The app has two kinds of names for stock and delivery data:
// database/wire identifiers (lot_code, batch_id, delivery_actual_cost_usd)
// and the words an operator sees. This guard keeps those layers connected
// without renaming a migration column or leaking an identifier into a label.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function flatten(input: unknown, target: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return target
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, target)
    else if (value != null) target[key] = String(value)
  }
  return target
}

const en = flatten(JSON.parse(read('src/lang/en.json')))
const km = flatten(JSON.parse(read('src/lang/km.json')))
assert.deepEqual(Object.keys(en).sort(), Object.keys(km).sort(), 'English and Khmer packs must have identical flattened keys')

const placeholders = (value: string): string[] => [...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((m) => m[0]).sort()
for (const key of Object.keys(en)) {
  assert.deepEqual(placeholders(en[key]), placeholders(km[key]), `placeholder variables differ for ${key}`)
}

const canonical: Record<string, [string, string]> = {
  lot: ['received date', 'ថ្ងៃចូល'],
  batch: ['Received date', 'ថ្ងៃចូល'],
  batch_date: ['Received date', 'ថ្ងៃចូល'],
  received_date: ['Received date', 'ថ្ងៃចូល'],
  delivery_fee: ['Delivery fee', 'ថ្លៃដឹក'],
  delivery_actual_cost: ['Actual delivery cost', 'ថ្លៃដឹកដើម'],
  record_kind_delivery_cost_changed: ['Actual delivery cost changed', 'ប្តូរថ្លៃដឹកដើម'],
  amend_actual_cost_title: ['Correct the actual delivery cost?', 'កែថ្លៃដឹកដើម?'],
  amend_actual_cost_new: ['New actual delivery cost', 'ថ្លៃដឹកដើមថ្មី'],
  rpt_delivery_cost: ['Actual delivery cost', 'ថ្លៃដឹកដើម'],
  no_actual_delivery_cost: ['No actual delivery cost', 'គ្មានថ្លៃដឹកដើម'],
  telegram_cat_stock_in_desc: ['Product, quantity, branch, reason, and received date', 'ផលិតផល បរិមាណ សាខា មូលហេតុ និងថ្ងៃចូល'],
  fast_stock_auto_lot: ['Oldest received dates first', 'ថ្ងៃចូលចាស់បំផុតមុន'],
  selected_conflict_lots: ['received dates', 'ថ្ងៃចូល'],
  selected_conflict_no_lots: ['No received dates', 'គ្មានថ្ងៃចូល'],
  stock_session_no_lot_to_edit: ['Every line was created at 0 — no received date to edit or reverse.', 'គ្រប់ជួរបានបង្កើតដោយចំនួន 0 — គ្មានថ្ងៃចូលត្រូវកែ ឬបញ្ច្រាសទេ។'],
  reason_defective_batch: ['Defective received stock', 'ស្តុកចូលមានបញ្ហា'],
  confirm_deactivate_batch_details: ['Deactivate received date {batch} for {product}? It will no longer be available for new stock operations.', 'បិទដំណើរការថ្ងៃចូល {batch} សម្រាប់ {product} មែនទេ? វានឹងលែងអាចប្រើសម្រាប់ប្រតិបត្តិការស្តុកថ្មីទៀតហើយ។'],
  confirm_receive_batch_details: ['Receive {quantity} {unit} of {product} into {branch}, using received date {lot}? This posts stock movement(s).', 'ទទួល {quantity} {unit} នៃ {product} ចូល {branch} ដោយប្រើថ្ងៃចូល {lot} មែនទេ? វានឹងកត់ត្រាចលនាស្តុក។'],
  confirm_update_batch_details: ['Update received date {batch} for {product}?{note}', 'ធ្វើបច្ចុប្បន្នភាពថ្ងៃចូល {batch} សម្រាប់ {product} មែនទេ?{note}'],
  credit_awaiting_payment: ['Not Paid', 'ប្រាក់ជំពាក់'],
  pos_status_awaiting_payment_desc: ['Not Paid — stock deducted', 'ប្រាក់ជំពាក់ — ស្តុកត្រូវបានកាត់'],
  delivery_fee_position_after: ['After items', 'ក្រោយបញ្ជីទំនិញ'],
  delivery_fee_position_after_desc: ['Delivery fee shown after the items, before totals', 'បង្ហាញក្រោយបញ្ជីទំនិញ មុនចំនួនសរុប'],
  delivery_fee_position_totals_desc: ['Delivery fee shown inside the totals section', 'បង្ហាញក្នុងផ្នែកចំនួនសរុប (សរុបរង ការបញ្ចុះតម្លៃ និងពន្ធ — ណែនាំ)'],
  sales_import_stock_help: ['This just records history and links each line to a product -- it never changes stock on its own. The one exception is sale_status "returned" / "partial_return": that restocks the returned_quantity (batch_label optional, to restock a specific received date).', 'វាគ្រាន់តែកត់ត្រាប្រវត្តិ និងភ្ជាប់ជួរនីមួយៗទៅផលិតផល — វាមិនកែស្តុកដោយខ្លួនឯងទេ។ ករណីលើកលែងតែមួយគត់គឺ sale_status «returned» / «partial_return»៖ វានឹងបញ្ចូល returned_quantity ទៅស្តុកវិញ (batch_label ជាជម្រើស សម្រាប់បញ្ចូលទៅថ្ងៃចូលជាក់លាក់)។'],
  payment: ['Payment', 'ការទូទាត់'],
  delivery: ['Delivery', 'ការដឹកជញ្ជូន'],
}
for (const [key, [english, khmer]] of Object.entries(canonical)) {
  assert.equal(en[key], english, `English definition drifted for ${key}`)
  assert.equal(km[key], khmer, `Khmer definition drifted for ${key}`)
}

// Canonical finance and operator labels. These are aliases used by different
// surfaces, so a pack edit must not quietly reintroduce “purchase price”,
// “courier cost”, or a second translation for the same amount.
const conciseAliases: Record<string, [string, string, string][]> = {
  'cost price': [
    ['cost_price', 'Cost price', 'ថ្លៃដើម'],
    ['cost_price_usd', 'Cost price (USD)', 'ថ្លៃដើម (ដុល្លារ)'],
    ['cost_price_khr', 'Cost price (KHR)', 'ថ្លៃដើម (រៀល)'],
    ['cost_in_usd_label', 'Cost price (USD)', 'ថ្លៃដើម (ដុល្លារ)'],
    ['cost_in_khr_label', 'Cost price (KHR)', 'ថ្លៃដើម (រៀល)'],
    ['label_cost_purchase', 'Cost price', 'ថ្លៃដើម'],
  ],
  'selling price': [
    ['selling_price', 'Selling price', 'តម្លៃលក់'],
    ['label_selling_price', 'Selling price', 'តម្លៃលក់'],
  ],
  'delivery fee charged': [
    ['delivery_charged', 'Delivery fee charged', 'ថ្លៃដឹកគិតពីអតិថិជន'],
    ['rpt_delivery_charged', 'Delivery fee charged', 'ថ្លៃដឹកគិតពីអតិថិជន'],
    ['rpt_delivery_collected', 'Delivery fee charged', 'ថ្លៃដឹកគិតពីអតិថិជន'],
  ],
  'actual delivery cost': [
    ['delivery_actual_cost', 'Actual delivery cost', 'ថ្លៃដឹកដើម'],
    ['rpt_delivery_cost', 'Actual delivery cost', 'ថ្លៃដឹកដើម'],
    ['rpt_delivery_paid', 'Actual delivery cost', 'ថ្លៃដឹកដើម'],
  ],
  'delivery profit': [
    ['delivery_margin', 'Delivery profit', 'ចំណេញថ្លៃដឹក'],
    ['rpt_delivery_margin', 'Delivery profit', 'ចំណេញថ្លៃដឹក'],
    ['rpt_delivery_net', 'Delivery profit', 'ចំណេញថ្លៃដឹក'],
  ],
  'store-paid delivery fee': [
    ['delivery_absorbed', 'Store-paid delivery fee', 'ថ្លៃដឹកហាងចេញ'],
    ['store_paid_delivery', 'Store-paid delivery fee', 'ថ្លៃដឹកហាងចេញ'],
    ['rpt_store_delivery', 'Store-paid delivery fee', 'ថ្លៃដឹកហាងចេញ'],
  ],
}
for (const [concept, entries] of Object.entries(conciseAliases)) {
  for (const [key, english, khmer] of entries) {
    assert.equal(en[key], english, `English ${concept} label drifted for ${key}`)
    assert.equal(km[key], khmer, `Khmer ${concept} label drifted for ${key}`)
  }
}

// Long operator guidance must use the same received-date vocabulary as the
// compact labels; the machine-facing legacy column names remain covered by
// the CSV compatibility copy and are intentionally not renamed here.
assert.match(en.product_duplicates_hint, /received-date records/)
assert.match(en.merge_stock_choice_merge_hint, /received-date record/)
assert.match(en.merge_stock_choice_write_off_hint, /received-date records/)
assert.match(en.stock_set_down_hint, /received date/)
assert.match(en.identity_link_over_note, /received-date records/)
assert.match(en.selected_conflict_review_intro, /confirming the merge/)
assert.match(en.selected_conflict_move_stock, /received-date records/)
assert.match(en.merge_duplicates_trail_soft_delete, /received-date/)
assert.match(en.rfid_requirement_mapping, /received-date record/)
assert.match(en.rfid_workflow_receiving_desc, /supplier received-date records/)
for (const key of ['product_duplicates_hint', 'merge_stock_choice_merge_hint', 'merge_stock_choice_write_off_hint', 'stock_set_down_hint', 'identity_link_over_note', 'selected_conflict_review_intro', 'selected_conflict_move_stock', 'merge_duplicates_trail_soft_delete']) {
  assert.doesNotMatch(en[key], /\blots?\b|\bbatches?\b/i, `stale stock-record vocabulary remains in ${key}`)
}

const batchLabel = read('src/utils/batchLabel.ts')
assert.match(batchLabel, /received_at\?\: string \| null/)
assert.match(batchLabel, /const dateLabel = formatBatchReceivedDate\(batch\.received_at\) \|\| codeAsDate/)
assert.match(batchLabel, /export function lotCodeAsDate/)
assert.match(batchLabel, /export function batchDisplayLabel/)
assert.match(batchLabel, /batchWord = 'Received date'/)

const recordRules = read('src/utils/saleRecords.ts')
assert.match(recordRules, /actual_delivery_cost_usd: \{ key: 'delivery_actual_cost', format: 'money' \}/)
assert.match(recordRules, /payment_details: \{ key: 'payment_details', format: 'text' \}/)
assert.match(recordRules, /payment: \{ key: 'payment', format: 'text' \}/)
assert.match(recordRules, /delivery: \{ key: 'delivery', format: 'text' \}/)

// Every field the Worker can emit must have a browser rule. A missing rule
// silently turns a structured snapshot into the generic Value changed row.
const workerSaleRecords = read('../cloudflare/src/lib/saleRecords.ts')
const fieldBlock = workerSaleRecords.match(/export const SALE_RECORD_FIELDS = \[([\s\S]*?)\] as const/)
assert.ok(fieldBlock, 'Worker sale-record field list must remain discoverable')
const workerFields = [...fieldBlock![1].matchAll(/'([^']+)'/g)].map((match) => match[1])
for (const field of workerFields) {
  assert.match(recordRules, new RegExp(`\\b${field}: \\{`), `browser sale-record rule missing for Worker field ${field}`)
}
const frontendKindsBlock = recordRules.match(/export const SALE_RECORD_KINDS = \[([\s\S]*?)\] as const/)
const workerKindsBlock = workerSaleRecords.match(/export const SALE_RECORD_KINDS = \[([\s\S]*?)\] as const/)
assert.ok(frontendKindsBlock && workerKindsBlock, 'Worker and browser sale-record kind lists must remain discoverable')
const frontendKinds = [...frontendKindsBlock![1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()
const workerKinds = [...workerKindsBlock![1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()
assert.deepEqual(frontendKinds, workerKinds, 'Worker and browser sale-record kinds must match')
for (const kind of workerKinds) {
  assert.ok(en[`record_kind_${kind}`], `English record label missing for ${kind}`)
  assert.ok(km[`record_kind_${kind}`], `Khmer record label missing for ${kind}`)
}

const telegramLang = read('../cloudflare/src/lib/telegramLang.ts')
assert.match(telegramLang, /receivedDate: \{ en: 'Received date', km: 'ថ្ងៃចូល' \}/)
assert.match(telegramLang, /deliveryCost: \{ en: 'Actual delivery cost', km: 'ថ្លៃដឹកដើម' \}/)
assert.doesNotMatch(telegramLang, /lot: \{ en: 'Lot', km: 'បាច់' \}/)

const telegram = read('../cloudflare/src/lib/telegram.ts')
assert.match(telegram, /const received = receivedDateText\(/)
assert.match(telegram, /received \? `Received date: \$\{received\}`/)
assert.match(telegram, /\(received date \$\{cleanLine\(received, 40\)\}\)/)
assert.doesNotMatch(telegram, /`Lot: \$\{change\.lot\}/)

// Visible fallback copy is a second translation path when a legacy/partial
// pack is loaded. It must describe the same domain terms as the canonical
// packs, otherwise an operator can see “batch/lot” or the old stock rule even
// though the loaded language file is correct.
for (const rel of [
  'src/components/inventory/Inventory.tsx',
  'src/components/products/forms/StockAdjustModal.tsx',
  'src/components/inventory/ManageBatchesModal.tsx',
  'src/components/inventory/ReceiveBatchModal.tsx',
  'src/components/products/forms/BulkAddStockModal.tsx',
  'src/components/pos/POS.tsx',
  'src/components/products/surfaces/ProductDetailModal.tsx',
  'src/components/products/ProductsImageOnlyView.tsx',
  'src/components/returns/helpers/returnOptions.ts',
  'src/components/returns/NewReturnModal.tsx',
  'src/components/returns/ReturnDetailModal.tsx',
  'src/components/returns/ReturnsListSurface.tsx',
]) {
  const source = read(rel)
  assert.doesNotMatch(source, /['\"][^'\"\r\n]*(?:Select a batch first|Batch updated|Batch deactivated|Batch date|Batch code|Receive Batch|oldest batch first|stock held|Order placed, payment pending - stock held|same batch when known|damaged lot|\w+ batches? recorded\.)[^'\"\r\n]*['\"]/, `${rel} contains stale visible fallback terminology`)
}
assert.equal(en.pos_status_awaiting_payment_desc.includes('stock held'), false)
assert.equal(km.pos_status_awaiting_payment_desc.includes('កាន់ទុក'), false)
assert.equal(km.avatar_uploaded.includes('អាប់ថ្ងៃចូល'), false, 'upload copy must not use received-date wording')
assert.equal(en.delivery_position_after_desc, en.delivery_fee_position_after_desc, 'receipt position aliases must share one English definition')
assert.equal(km.delivery_position_after_desc, km.delivery_fee_position_after_desc, 'receipt position aliases must share one Khmer definition')
assert.equal(en.delivery_position_totals_desc, en.delivery_fee_position_totals_desc, 'receipt totals aliases must share one English definition')
assert.equal(km.delivery_position_totals_desc, km.delivery_fee_position_totals_desc, 'receipt totals aliases must share one Khmer definition')

const saleDetail = read('src/components/sales/SaleDetailModal.tsx')
assert.doesNotMatch(saleDetail, /ថ្លៃដឹកជញ្ជូនពិតប្រាកដ/)
assert.match(saleDetail, /translateOr\('delivery_actual_cost', 'Actual delivery cost', 'ថ្លៃដឹកដើម'\)/)
assert.match(saleDetail, /translateOr\('amend_actual_cost_new', 'New actual delivery cost', 'ថ្លៃដឹកដើមថ្មី'\)/)

for (const rel of [
  'src/components/inventory/InventoryStockModals.tsx',
  'src/components/inventory/FastStockInModal.tsx',
  'src/components/inventory/ReceiveBatchModal.tsx',
  'src/components/branches/TransferModal.tsx',
  'src/components/contacts/SupplierInvoicesSection.tsx',
  'src/components/products/surfaces/ProductRowParts.tsx',
  'src/components/sales/SalesImportModal.tsx',
]) {
  const source = read(rel)
  assert.doesNotMatch(source, /កូដបាច់|ទៅឡូតជាក់លាក់/, `${rel} must use received-date wording in its fallback copy`)
}
const receipt = read('src/components/receipt/Receipt.tsx')
assert.match(receipt, /delivery: 'ថ្លៃដឹក:'/)

console.log(`PASS semantic variable parity: ${Object.keys(en).length} keys, canonical stock/delivery labels, placeholders, records, Telegram and receipt fallbacks`)
