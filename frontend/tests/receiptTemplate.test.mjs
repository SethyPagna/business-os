import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_TEMPLATE } from '../src/components/receipt-settings/constants.js'
import { parseReceiptTemplate, serializeReceiptTemplate } from '../src/components/receipt-settings/template.js'

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

await runTest('parseReceiptTemplate merges stored values with defaults', () => {
  const parsed = parseReceiptTemplate(JSON.stringify({
    font_size: 15,
    custom_footer: 'Thanks!',
  }))

  assert.equal(parsed.font_size, 15)
  assert.equal(parsed.custom_footer, 'Thanks!')
  assert.equal(parsed.align_header, DEFAULT_TEMPLATE.align_header)
})

await runTest('serializeReceiptTemplate keeps default fields available for preview and print', () => {
  const serialized = serializeReceiptTemplate({ show_discount: false })
  const reparsed = JSON.parse(serialized)

  assert.equal(reparsed.show_discount, false)
  assert.equal(reparsed.footer_separator, DEFAULT_TEMPLATE.footer_separator)
  assert.equal(Array.isArray(reparsed.field_order), true)
})

await runTest('receipt preview remains strict-CSP compatible and binds buttons outside markup', () => {
  const source = fs.readFileSync(new URL('../src/utils/printReceipt.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /onclick\s*=/i)
  assert.doesNotMatch(source, /<script[\s>]/i)
  assert.match(source, /data-receipt-action="print"/)
  assert.match(source, /data-receipt-action="close"/)
  assert.match(source, /function attachPrintablePreviewActions/)
})

if (failed > 0) {
  process.exitCode = 1
}
