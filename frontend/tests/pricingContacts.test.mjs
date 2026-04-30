import assert from 'node:assert/strict'
import { calculateProductDiscount, formatPriceNumber, normalizePriceValue } from '../src/utils/pricing.js'
import {
  CONTACT_OPTION_LIMIT,
  parseContactOptionsFromImportRow,
  parseStoredContactOptions,
  serializeContactOptions,
} from '../src/components/contacts/contactOptionUtils.js'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('normalizePriceValue always rounds up to two decimals', () => {
  assert.equal(normalizePriceValue(1), 1)
  assert.equal(normalizePriceValue(3), 3)
  assert.equal(normalizePriceValue(1.001), 1.01)
  assert.equal(normalizePriceValue(2.111), 2.12)
  assert.equal(formatPriceNumber(1), '1.00')
  assert.equal(formatPriceNumber(3), '3.00')
  assert.equal(formatPriceNumber(1.001), '1.01')
})

await runTest('calculateProductDiscount keeps promotion pricing separate from special price', () => {
  const product = {
    selling_price_usd: 10,
    selling_price_khr: 41000,
    special_price_usd: 6,
    special_price_khr: 24600,
    discount_enabled: 1,
    discount_type: 'fixed',
    discount_amount_usd: 1.005,
    discount_label: 'Promo',
  }
  const discount = calculateProductDiscount(product, 4100)
  assert.equal(discount.active, true)
  assert.equal(discount.discount_amount_usd, 1.01)
  assert.equal(discount.applied_price_usd, 8.99)
})

await runTest('parseContactOptionsFromImportRow limits imported contact options to three', () => {
  const row = {
    contact_label_1: 'Primary',
    contact_name_1: 'A',
    contact_phone_1: '111',
    contact_email_1: 'a@example.com',
    contact_address_1: 'Addr A',
    contact_label_2: 'Backup',
    contact_name_2: 'B',
    contact_phone_2: '222',
    contact_email_2: 'b@example.com',
    contact_address_2: 'Addr B',
    contact_label_3: 'Warehouse',
    contact_name_3: 'C',
    contact_phone_3: '333',
    contact_email_3: 'c@example.com',
    contact_address_3: 'Addr C',
    contact_label_4: 'Overflow',
    contact_name_4: 'D',
    contact_phone_4: '444',
    contact_email_4: 'd@example.com',
    contact_address_4: 'Addr D',
  }

  const options = parseContactOptionsFromImportRow(row, { mode: 'address' })
  assert.equal(options.length, CONTACT_OPTION_LIMIT)
  assert.deepEqual(options.map((option) => option.label), ['Primary', 'Backup', 'Warehouse'])
})

await runTest('serializeContactOptions round-trips structured contact options', () => {
  const raw = serializeContactOptions([
    { label: 'Primary', name: 'Alice', phone: '123', email: 'a@example.com', address: 'Street A' },
    { label: 'Backup', name: 'Bob', phone: '456', email: 'b@example.com', address: 'Street B' },
  ])

  const parsed = parseStoredContactOptions(raw, { legacyField: 'address' })
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].name, 'Alice')
  assert.equal(parsed[1].phone, '456')
})

if (failed > 0) {
  process.exitCode = 1
}
