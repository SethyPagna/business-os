// Owner, 10 Nov 2026: a Show Delivery Address switch "did not stick". The
// settings toggle read !!value while the receipt reads value !== false, so a
// stored null/0 showed OFF in settings and still printed the address. A toggle
// must read each key the way the renderer does.
//
// Run: node tests/receiptTemplateFlags.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RECEIPT_DEFAULT_ON_FLAGS, receiptFlagOn } from '../src/utils/receiptTemplateFlags.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

for (const [value, expected] of [[undefined, true], [true, true], [false, false], [null, true], [0, true], ['false', true], ['', true]] as const) {
  assert.equal(receiptFlagOn({ delivery_show_address: value }, 'delivery_show_address'), expected, `default-on key, stored ${JSON.stringify(value)}`)
}
for (const [value, expected] of [[undefined, false], [true, true], [false, false], [null, false], [0, false], ['x', true]] as const) {
  assert.equal(receiptFlagOn({ show_subtotal: value }, 'show_subtotal'), expected, `truthy key, stored ${JSON.stringify(value)}`)
}
assert.equal(receiptFlagOn(null, 'show_subtotal'), false)

const receipt = read('src/components/receipt/Receipt.tsx')
const settings = read('src/components/receipt-settings/ReceiptSettings.tsx')
const constants = read('src/components/receipt-settings/constants.ts')
const fieldKeys = Array.from(constants.matchAll(/\{ key: '([a-z_]+)', label: T\(/g), (match) => match[1]).filter((key) => key !== 'item_separator')
assert.ok(fieldKeys.length > 30, 'the All Fields list was found')

// Every field the settings page lists agrees with the renderer's reading of it.
for (const key of fieldKeys) {
  const readsNotFalse = new RegExp(`tpl\\.${key} !== false`).test(receipt)
  assert.equal(RECEIPT_DEFAULT_ON_FLAGS.has(key), readsNotFalse, `${key}: the toggle and Receipt.tsx must read it the same way`)
  if (RECEIPT_DEFAULT_ON_FLAGS.has(key)) {
    const anyRead = (receipt.match(new RegExp(`tpl\\.${key}\\b`, 'g')) || []).length
    const notFalseRead = (receipt.match(new RegExp(`tpl\\.${key} !== false`, 'g')) || []).length
    assert.equal(anyRead, notFalseRead, `${key}: Receipt.tsx must not read it two ways`)
  }
}
for (const key of RECEIPT_DEFAULT_ON_FLAGS) assert.match(receipt, new RegExp(`tpl\\.${key} !== false`), `${key} is read as !== false by the renderer`)

// No hand-written toggle on the page reads a default-on key with !!.
for (const key of RECEIPT_DEFAULT_ON_FLAGS) assert.doesNotMatch(settings, new RegExp(`!!tpl\\.${key}\\b`), `${key}: the settings page must not read it with !!`)
assert.match(settings, /value=\{tpl\.delivery_show_address !== false\}/)
assert.match(settings, /value=\{tpl\.delivery_show_fee !== false\}/)
assert.match(read('src/components/receipt-settings/AllFieldsPanel.tsx'), /value=\{receiptFlagOn\(tpl, field\.key\)\}/)

console.log('receiptTemplateFlags.test.ts OK')
