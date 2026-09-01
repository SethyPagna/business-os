import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_TEMPLATE } from '../src/components/receipt-settings/constants.ts'
import { parseReceiptTemplate, serializeReceiptTemplate } from '../src/components/receipt-settings/template.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
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

await runTest('compact ABA receipt and KHR visibility settings survive a template round trip', () => {
  const serialized = serializeReceiptTemplate({
    sales_receipt_enabled: true,
    sales_receipt_aba_account_name: 'Leang Beauty',
    sales_receipt_aba_account_number: '123 456 789',
    sales_receipt_aba_qr_image: '/uploads/aba-payment.webp',
    sales_receipt_note: 'received_payment',
    show_discount_khr: false,
    show_membership_discount_khr: false,
    show_delivery_khr: false,
  })
  const reparsed = parseReceiptTemplate(serialized)

  assert.equal(reparsed.sales_receipt_enabled, true)
  assert.equal(reparsed.sales_receipt_aba_account_name, 'Leang Beauty')
  assert.equal(reparsed.sales_receipt_aba_account_number, '123 456 789')
  assert.equal(reparsed.sales_receipt_aba_qr_image, '/uploads/aba-payment.webp')
  assert.equal(reparsed.sales_receipt_note, 'received_payment')
  assert.equal(reparsed.show_discount_khr, false)
  assert.equal(reparsed.show_membership_discount_khr, false)
  assert.equal(reparsed.show_delivery_khr, false)
})

await runTest('receipt preview remains strict-CSP compatible and binds buttons outside markup', () => {
  const source = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /onclick\s*=/i)
  assert.doesNotMatch(source, /<script[\s>]/i)
  assert.match(source, /data-receipt-action="print"/)
  assert.match(source, /data-receipt-action="close"/)
  assert.match(source, /function attachPrintablePreviewActions/)
})

await runTest('print export normalizes receipt root width inside paper frame', () => {
  const source = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(source, /function normalizeReceiptContentWidth/)
  assert.match(source, /data-receipt-export-root="true"/)
  assert.match(source, /node\.style\.maxWidth = '100%'/)
  assert.match(source, /normalizeReceiptContentWidth\(cloneElementWithInlineStyles\(content\)\)/)
})


await runTest('thermal print keeps configured margins inside paper and uses one measured page', () => {
  const source = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(source, /const measuredHeightMm = renderedHeightPx \* \(widthMm \/ renderedWidthPx\)/)
  assert.match(source, /const pageHeightMm = fixedHeightMm \?\? Math\.max\(1, measuredHeightMm \+ 1\)/)
  assert.match(source, /size: \$\{widthMm\}mm \$\{pageHeightMm\.toFixed\(2\)\}mm;/)
  assert.match(source, /clone\.style\.minWidth = `\$\{widthMm\}mm`/)
  assert.doesNotMatch(source, /clone\.style\.padding = '0'/)
  assert.doesNotMatch(source, /node\.style\.width = `\$\{widthMm\}mm`[\s\S]{0,120}node\.style\.maxWidth = `\$\{widthMm\}mm`/)
  assert.match(source, /\.receipt-frame > \*[\s\S]*page-break-inside: avoid/)
  assert.match(source, /root\.style\.margin = '0'/)
})

await runTest('receipt export supports PNG image download from the same rendered receipt', () => {
  const utilSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.match(utilSource, /export async function createReceiptImageBlob/)
  assert.match(utilSource, /type:\s*'image\/png'/)
  assert.match(utilSource, /export async function downloadReceiptImage/)
  assert.match(utilSource, /\.png/)
  assert.match(receiptSource, /loadReceiptPrintModule/)
  assert.match(receiptSource, /printTools\.downloadReceiptImage/)
  assert.match(receiptSource, /receipt_image_short|saving_image/)
})

await runTest('receipt layout keeps Khmer labels, item columns, and row-aware image fallback', () => {
  const utilSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.match(receiptSource, /const RECEIPT_KHMER_LABELS/)
  assert.match(receiptSource, /បង្កាន់ដៃ/)
  assert.doesNotMatch(receiptSource, /áž/)
  assert.match(receiptSource, /grid-cols-\[minmax\(0,1fr\)_2\.8rem_minmax\(4\.6rem,auto\)\]/)
  assert.doesNotMatch(receiptSource, /getStatusLabel/)
  assert.doesNotMatch(receiptSource, /<Row label=\{labelFor\(lang, 'status'\)/)
  assert.doesNotMatch(receiptSource, /@\s*\{fmtUSD\(unitUsd\)\}/)
  // B5: actions resolve their target per variant -- the full receipt's ref
  // or the 80x50 card's -- and with the card enabled, Print offers BOTH
  // sizes as explicit variants.
  assert.match(receiptSource, /const target = variant === 'compact' \? compactPrintRef\.current : printRef\.current/)
  assert.match(receiptSource, /printTools\.printReceipt\(target,\s*\{[\s\S]*title:\s*''/)
  assert.match(receiptSource, /printTools\.openReceiptPdf\(target,\s*\{[\s\S]*title:\s*''/)
  assert.match(receiptSource, /exportReceiptPdf\('print', 'compact'\)/)
  assert.match(receiptSource, /exportReceiptPdf\('print', 'full'\)/)
  assert.match(receiptSource, /data-receipt-line="true"/)
  assert.match(receiptSource, /data-receipt-cell="qty"/)
  assert.match(utilSource, /function wrapReceiptFallbackLine/)
  assert.match(utilSource, /function wrapCanvasText/)
  assert.match(utilSource, /function drawClippedText/)
  assert.match(utilSource, /const nameMaxWidth = Math\.max\(92, qtyX - paddingX - 18\)/)
  assert.match(utilSource, /querySelectorAll\?\.\('\[data-receipt-line="true"\]'\)/)
  assert.match(utilSource, /if \(markedLines\.length\) return markedLines/)
})

await runTest('compact receipt output uses ABA details and configurable secondary KHR rows', () => {
  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.match(receiptSource, /sales_receipt_enabled === true/)
  assert.match(receiptSource, /sales_receipt_aba_account_name/)
  assert.match(receiptSource, /sales_receipt_aba_account_number/)
  assert.match(receiptSource, /sales_receipt_aba_qr_image/)
  assert.match(receiptSource, /sales_receipt_note === 'received_payment'/)
  assert.match(receiptSource, /tpl\.show_discount_khr !== false/)
  assert.match(receiptSource, /tpl\.show_membership_discount_khr !== false/)
  assert.match(receiptSource, /tpl\.show_delivery_khr !== false/)
})

await runTest('receipt asset inlining uses bounded workers', () => {
  const utilSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(utilSource, /const RECEIPT_ASSET_INLINE_CONCURRENCY = 3/)
  assert.match(utilSource, /async function mapReceiptAssets/)
  assert.match(utilSource, /Math\.min\(RECEIPT_ASSET_INLINE_CONCURRENCY, list\.length\)/)
  assert.match(utilSource, /await mapReceiptAssets\(images, async \(image\) =>/)
  assert.match(utilSource, /await mapReceiptAssets\(nodes, async \(node\) =>/)
  assert.doesNotMatch(utilSource, /Promise\.all\(images\.map/)
  assert.doesNotMatch(utilSource, /Promise\.all\(nodes\.map/)
})

if (failed > 0) {
  process.exitCode = 1
}
