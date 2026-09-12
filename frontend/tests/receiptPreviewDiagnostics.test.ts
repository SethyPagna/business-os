import assert from 'node:assert/strict'
import { RECEIPT_PREVIEW_COPY, receiptPreviewDiagnosticLines, receiptPreviewSettings } from '../src/utils/receiptPreviewDiagnostics.ts'
import { buildPrintablePreviewDocument, PRINT_DEFAULTS } from '../src/utils/printReceipt.ts'

assert.deepEqual(receiptPreviewSettings(), { scalePercent: 100, marginsMm: [4, 4, 4, 4] })
assert.deepEqual(receiptPreviewSettings({ scale: '85', marginTop: '0', marginRight: '1.5', marginBottom: '2', marginLeft: '3' }),
  { scalePercent: 85, marginsMm: [0, 1.5, 2, 3] })
assert.deepEqual(receiptPreviewSettings({ scale: '999', marginTop: '-4', marginRight: 'invalid' }),
  { scalePercent: 150, marginsMm: [0, 4, 4, 4] })
assert.equal(receiptPreviewSettings({ scale: '1' }).scalePercent, 50)
assert.equal(receiptPreviewSettings({ scale: 'NaN' }).scalePercent, 100)

console.log('PASS receipt preview reports effective scale and margins without changing settings')

for (const height of [165.31, 426.72, 701.89]) {
  const layout = { markup: '<div id="receipt-proof">ITEM40 TOTAL QR</div>', widthMm: 80, pageHeightMm: height, continuousRoll: true, singleSheet: false,
    previewSettings: receiptPreviewSettings({ scale: '85', marginTop: '0', marginRight: '1', marginBottom: '2', marginLeft: '3' }) }
  const html = buildPrintablePreviewDocument(layout, { printSettings: PRINT_DEFAULTS })
  assert.ok(html.includes(`Requested paper: 80 × ${height} mm`))
  assert.ok(html.includes('App scale: 85%'), 'captured render settings win over newer popup options')
  assert.ok(html.includes('0 / 1 / 2 / 3 mm'))
  assert.ok(html.includes(RECEIPT_PREVIEW_COPY.receipt_preview_roll_warning))
  assert.ok(html.includes(`size: 80mm ${height.toFixed(2)}mm;`), 'diagnostics do not change the requested page size')
  assert.ok(html.includes(layout.markup), 'receipt markup is untouched')
  assert.match(html, /\.receipt-toolbar, \.receipt-note \{ display: none !important; \}/)
  assert.ok(html.indexOf('data-receipt-print-diagnostics="true"') < html.indexOf('<div class="receipt-stage">'), 'diagnostics stay in the non-printing toolbar')
}
console.log('PASS 1/20/40-item measured roll diagnostics preserve physical page and receipt markup')

const card = { widthMm: 80, pageHeightMm: 50, continuousRoll: false, singleSheet: true }
const cardLines = receiptPreviewDiagnosticLines(card, receiptPreviewSettings())
assert.ok(cardLines.some((line) => line.includes('Single card')))
assert.ok(cardLines.includes(RECEIPT_PREVIEW_COPY.receipt_preview_card_note))
assert.ok(!cardLines.includes(RECEIPT_PREVIEW_COPY.receipt_preview_roll_warning))
const documentLines = receiptPreviewDiagnosticLines({ ...card, widthMm: 98, pageHeightMm: 148, singleSheet: false }, receiptPreviewSettings())
assert.ok(documentLines.some((line) => line.includes('Fixed-size document')))
assert.equal(documentLines.length, 3)
console.log('PASS separate single-card and fixed-document diagnostics do not claim continuous behavior')

const localized = buildPrintablePreviewDocument({ ...card, markup: '<div>UNCHANGED</div>' }, {
  printSettings: PRINT_DEFAULTS,
  previewTranslate: (key) => key === 'receipt_preview_requested_paper' ? 'ក្រដាស <script>bad</script>' : key,
})
assert.ok(localized.includes('ក្រដាស &lt;script&gt;bad&lt;/script&gt;'))
assert.ok(!localized.includes('<script>bad</script>'))
assert.ok(localized.includes('App scale'), 'unloaded/key-echo translations fall back safely')
console.log('PASS localized diagnostic copy is escaped and missing translations have readable fallback')
