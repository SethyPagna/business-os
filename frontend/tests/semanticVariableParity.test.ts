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
  delivery_fee: ['Delivery Fee', 'ថ្លៃដឹក'],
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
  payment: ['Payment', 'ការទូទាត់'],
  delivery: ['Delivery', 'ការដឹកជញ្ជូន'],
}
for (const [key, [english, khmer]] of Object.entries(canonical)) {
  assert.equal(en[key], english, `English definition drifted for ${key}`)
  assert.equal(km[key], khmer, `Khmer definition drifted for ${key}`)
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
