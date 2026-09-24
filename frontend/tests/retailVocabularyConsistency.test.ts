// Canonical retail vocabulary contract.
// User-facing labels may have different keys for compatibility, but the same
// concept must read the same way in English and Khmer. Internal API/database
// names such as `credit`, `batch_id`, and `lot_code` stay unchanged.

import assert from 'node:assert/strict'
import fs from 'node:fs'

const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

const same = (keys: string[], expectedEn: string, expectedKm: string): void => {
  for (const key of keys) {
    assert.equal(en[key], expectedEn, `en.${key} must use the canonical label`)
    assert.equal(km[key], expectedKm, `km.${key} must use the canonical label`)
  }
}

same(['received_date', 'batch', 'batch_date', 'csv_info_batch_label'], 'Received date', 'ថ្ងៃចូល')
same(['cost_price', 'purchase_price'], 'Cost price', 'ថ្លៃដើម')
same(['selling_price', 'selling_price_to_customer'], 'Selling price', 'តម្លៃលក់')
same(['wholesale_price'], 'Wholesale price', 'តម្លៃបោះដុំ')
same(['delivery_actual_cost'], 'Actual delivery cost', 'ថ្លៃដឹកដើម')
same(['delivery_fee', 'delivery_fee_label'], 'Delivery fee', 'ថ្លៃដឹក')
same(['supplier_credit', 'credit_open', 'on_credit'], 'Not Paid', 'ប្រាក់ជំពាក់')
same(['credit_awaiting_payment'], 'Not Paid — awaiting payment', 'ប្រាក់ជំពាក់ — រង់ចាំការទូទាត់')
assert.equal(en.ar_overpaid, 'Overpaid')
assert.equal(km.ar_overpaid, 'ប្រាក់លើស')

assert.match(en.csv_info_batch, /received date/i, 'CSV guidance must define batch as received date')
assert.match(km.csv_info_batch, /ថ្ងៃចូល/, 'Khmer CSV guidance must define batch as received date')
assert.ok(en.batch_code_preview.includes('Received-date'), 'the derived code is described as date-derived')
assert.ok(km.batch_code_preview.includes('ថ្ងៃចូល'), 'the Khmer derived code is tied to received date')

// Store credit is a different settlement instrument from an unpaid balance;
// keep that distinction explicit while customer/supplier debt uses Not Paid.
assert.equal(en.settlement_credit, 'Store Credit')
assert.equal(km.settlement_credit, 'ឥណទានហាង')

console.log('PASS retail vocabulary consistency')
