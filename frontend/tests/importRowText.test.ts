import assert from 'node:assert/strict'
import fs from 'node:fs'
import { IMPORT_ROW_CODES, importRowDetailText, importRowMessageText, importWarningText } from '../src/components/imports/importRowText.ts'
import { localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
const translate = (key: string, fallback: string) => km[key] || fallback
const codes = ['stock_session_query_budget_exceeded', 'customer_return_over_plan_budget', 'stock_import_unit_over_tier_budget', 'stock_import_reconcile_over_tier_budget', 'import_queue_required']
for (const code of codes) {
  assert.ok(km[code], code)
  assert.equal(importRowDetailText({ code, message: 'Saved Worker English' }, translate), km[code])
  assert.equal(localizeBranchRuleError(`${code}: Saved Worker English`, key => km[key]), km[code])
}
assert.equal(importRowMessageText('Unexpected vendor failure', translate, 'vendor_unknown'), 'Unexpected vendor failure')
assert.equal(localizeBranchRuleError('vendor_unknown: original detail', key => km[key]), 'vendor_unknown: original detail')
assert.equal(importRowMessageText('Enter a shop, warehouse or store quantity. Other detail.', translate), `${km.stock_import_quantity_required} Other detail.`)
assert.equal(importWarningText({ code: 'stock_import_branch_routing', message: 'Original', params: {} }, translate), 'Original')
assert.equal(importWarningText({ code: 'stock_import_branch_routing', message: 'Original', params: {branch:'LC',columns:'A + B',total:4} }, translate), km.stock_import_branch_routing.replace('{branch}','LC').replace('{columns}','A + B').replace('{total}','4'))
console.log('PASS Khmer saved row/job codes; unknown errors and existing warning details retained')

// The inventory import's own row sentences (cloudflare/src/lib/importEngine.ts): a coded row with the values its sentence
// names is restated from the pack key named after the code; anything less keeps the Worker's English.
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const holders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
for (const [code, specs] of Object.entries(IMPORT_ROW_CODES)) for (const spec of specs) {
  assert.ok(typeof km[spec.key] === 'string' && typeof en[spec.key] === 'string', `${spec.key} is in both packs`)
  assert.ok(/[\u1780-\u17FF]/.test(km[spec.key]) && km[spec.key] !== en[spec.key], `${spec.key}: the Khmer is Khmer`)
  assert.deepEqual(holders(km[spec.key]), holders(en[spec.key]), `${spec.key}: Khmer and English name the same placeholders`)
  for (const name of holders(en[spec.key])) assert.ok(spec.params.includes(name), `${code}: placeholder {${name}} is one of the params the Worker sends`)
}
const stock = { onHand: 4, branch: 'LC Store', quantity: 6 }
assert.equal(importRowDetailText({ code: 'import_insufficient_branch_stock', params: stock, message: 'Only 4 on hand at LC Store -- cannot remove 6.' }, translate),
  'នៅ LC Store មានតែ 4 ក្នុងស្តុក — មិនអាចដកចេញ 6 បានទេ។')
assert.equal(importRowDetailText({ code: 'import_insufficient_branch_stock', params: { ...stock, afterEarlierRows: 1 }, message: 'Worker English' }, translate),
  'នៅ LC Store មានតែ 4 ក្នុងស្តុក បន្ទាប់ពីជួរដេកមុននេះ — មិនអាចដកចេញ 6 បានទេ។')
assert.equal(importRowDetailText({ code: 'import_insufficient_branch_stock', params: { ...stock, onHand: 0 }, message: 'x' }, translate).includes(' 0 '), true, 'a zero is a value, not a missing param')
assert.equal(importRowDetailText({ code: 'import_insufficient_branch_stock', params: { onHand: 4, branch: 'LC Store' }, message: 'Worker English' }, translate), 'Worker English', 'a missing param keeps the Worker English')
assert.equal(importRowDetailText({ code: 'import_insufficient_branch_stock', message: 'Only 4 on hand at LC Store -- cannot remove 6.' }, translate), 'Only 4 on hand at LC Store -- cannot remove 6.', 'a row saved before params existed keeps the Worker English')
assert.equal(importRowDetailText({ code: 'import_duplicate_count_row', params: { row: 3, branch: 'LC Store' }, message: 'x' }, translate), km.import_duplicate_count_row.replace('{row}', '3').replace('{branch}', 'LC Store'))
assert.equal(importRowDetailText({ code: 'import_mixed_direction_rows', params: { product: 'Rose Toner', branch: 'LC Store' }, message: 'x' }, translate), km.import_mixed_direction_rows.replace('{product}', 'Rose Toner').replace('{branch}', 'LC Store'))
// A product or branch name that reads like a placeholder is printed as it is, in one pass.
assert.equal(importRowDetailText({ code: 'import_mixed_direction_rows', params: { product: '{branch}', branch: 'LC Store' }, message: 'x' }, translate),
  km.import_mixed_direction_rows.replace(/\{(\w+)\}/g, (_token: string, name: string) => ({ product: '{branch}', branch: 'LC Store' } as Record<string, string>)[name]))
// The field a product was matched on is a word of the language.
const matched = (field: string) => importRowDetailText({ code: 'inventory_import_match_many_products', params: { field, value: 'DUP-1', count: 2 }, message: 'x' }, translate)
assert.ok(matched('sku').startsWith(`${km.sku} "DUP-1"`) && matched('barcode').startsWith(`${km.barcode} "DUP-1"`), 'sku and barcode are named in Khmer')
assert.equal(importRowDetailText({ code: 'inventory_import_product_not_found', message: 'Product not found for sku/barcode' }, translate), km.inventory_import_product_not_found, 'a coded row with no params needs none')
assert.equal(importRowDetailText({ code: 'inventory_import_zero_receipt', message: 'x' }, translate), km.inventory_import_zero_receipt)
assert.equal(importRowDetailText({ code: 'inventory_import_vendor_unknown', params: { a: 1 }, message: 'Unexpected vendor failure' }, translate), 'Unexpected vendor failure', 'an unknown code keeps its message')
// The English UI shows the pack text, which is the Worker's sentence word for word.
const english = (key: string, fallback: string) => en[key] || fallback
assert.equal(importRowDetailText({ code: 'import_duplicate_count_row', params: { row: 3, branch: 'LC Store' }, message: 'x' }, english),
  'Row 3 already counts this product at LC Store. Keep one count per product and branch.')
console.log('PASS inventory import row codes restated in Khmer from params; missing params, old rows and unknown codes keep the Worker English')

// The unified stock import's own sentences (cloudflare/src/lib/stockActionImport.ts), found in the joined row message. The
// Worker's real text is pinned to the pack English by cloudflare/scripts/test-stock-import-row-sentences-pure.cjs.
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_token: string, name: string) => String(values[name]))
const batchEnglish = 'Received date "SHIP-1" belongs to 2 matching product rows; choose the exact row.'
assert.equal(importRowMessageText(batchEnglish, translate), fill(km.stock_import_batch_ambiguous, { batch: 'SHIP-1', count: 2 }))
assert.equal(importRowMessageText(batchEnglish, english), batchEnglish, 'the English UI reads the Worker sentence word for word')
const severalEnglish = 'Name/barcode match 3 product rows; merge the exact duplicates before importing.'
assert.equal(importRowMessageText(severalEnglish, translate), fill(km.stock_import_match_several_rows, { count: 3 }))
assert.equal(importRowMessageText(severalEnglish, english), severalEnglish)
const barcodeEnglish = 'Barcode 8851234567890 matches 2 products; add the product name so the right row is chosen.'
assert.equal(importRowMessageText(barcodeEnglish, translate), fill(km.stock_import_barcode_matches_several, { barcode: '8851234567890', count: 2 }))
assert.equal(importRowMessageText(barcodeEnglish, english), barcodeEnglish)
// Beside another sentence in the joined message, and with a value that reads like a placeholder: restated in place, in one pass.
assert.equal(importRowMessageText(`Name or barcode is required. Barcode {count} matches 2 products; add the product name so the right row is chosen.`, translate),
  `${km.stock_import_name_or_barcode_required} ${fill(km.stock_import_barcode_matches_several, { barcode: '{count}', count: 2 })}`)
assert.equal(importRowMessageText('Date must be mm/dd/yyyy (month first, as this column has always been) or yyyy-mm-dd.', translate), km.stock_import_date_invalid)
// The numeric-parse sentences carry a per-field name from the shared parser and stay as the Worker wrote them.
assert.equal(importRowMessageText('Invalid shop quantity', translate), 'Invalid shop quantity')
console.log('PASS unified stock import row sentences restated in Khmer in place; the English UI and unknown sentences are unchanged')
