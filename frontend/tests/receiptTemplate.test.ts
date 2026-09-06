import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_TEMPLATE } from '../src/components/receipt-settings/constants.ts'
import { parseReceiptTemplate, serializeReceiptTemplate } from '../src/components/receipt-settings/template.ts'
import { computeImagePdfLayout } from '../src/utils/receiptPdfLayout.ts'
import { normalizeReceiptPrintSettings, normalizeReceiptTemplate, RECEIPT_TEMPLATE_REVISION, DEFAULT_RECEIPT_TEMPLATE } from '../src/utils/receiptAppliedConfig.ts'

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

await runTest('high-contrast bold receipt printing is enabled by default and can be disabled', () => {
  assert.equal(normalizeReceiptPrintSettings({}).highContrastBold, true)
  assert.equal(normalizeReceiptPrintSettings({ highContrastBold: true }).highContrastBold, true)
  assert.equal(normalizeReceiptPrintSettings({ highContrastBold: false }).highContrastBold, false)
  assert.equal(normalizeReceiptPrintSettings(JSON.stringify({ highContrastBold: 'false' })).highContrastBold, false)
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
  assert.match(source, /data-receipt-action="print">Print<\/button>/)
  assert.doesNotMatch(source, /Print \/ Save PDF/)
  assert.match(source, /data-receipt-action="close"/)
  assert.match(source, /function attachPrintablePreviewActions/)
})

await runTest('high-contrast print mode forces solid black bold text through every export path', () => {
  const printSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  const cssSource = fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')

  assert.match(printSource, /function applyHighContrastBold/)
  assert.match(printSource, /style\.setProperty\('color', '#000000', 'important'\)/)
  assert.match(printSource, /style\.setProperty\('font-weight', '700', 'important'\)/)
  assert.match(printSource, /applyHighContrastBold\(host, printSettings\)/)
  assert.match(printSource, /Helvetica-Bold/)
  assert.match(receiptSource, /data-receipt-high-contrast=\{highContrastBold \? 'true' : 'false'\}/)
  assert.match(cssSource, /\[data-receipt-high-contrast='true'\] \*/)
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
  assert.match(source, /\.receipt-frame \{[\s\S]*width: \$\{widthMm\}mm;[\s\S]*padding: 0;/)
  assert.doesNotMatch(source, /width: calc\(\$\{widthMm\}mm \+ 32px\)/)
  assert.match(source, /host\.style\.padding = isElementContent \? '0' : printPadding/,
    'a receipt component must not receive a second outer print margin')
  assert.match(source, /cloned\.style\.padding = printPadding/,
    'continuous receipt margins should replace the screen-shell padding')
  assert.match(source, /descendant\.style\.height = 'auto'/,
    'wrapped receipt rows must be allowed to grow in the printable clone')
})

await runTest('fixed 80x50 PDF layout keeps exact dimensions and fits tall content proportionally', () => {
  const widthPt = (80 / 25.4) * 72
  const heightPt = (50 / 25.4) * 72
  const layout = computeImagePdfLayout({
    imageWidthPx: 800,
    imageHeightPx: 1600,
    pageWidthPt: widthPt,
    fixedHeightPt: heightPt,
  })
  assert.equal(layout.pageHeightPt.toFixed(2), '141.73', '80x50 must not silently grow to the image height')
  assert.equal(layout.drawWidthPt.toFixed(2), '70.87')
  assert.equal(layout.drawHeightPt.toFixed(2), '141.73')
  assert.equal(layout.drawXPt.toFixed(2), '77.95', 'tall content should be centered horizontally')
  assert.equal(layout.drawYPt.toFixed(2), '0.00')
})

await runTest('continuous 80mm PDF layout remains one content-height page', () => {
  const widthPt = (80 / 25.4) * 72
  const layout = computeImagePdfLayout({
    imageWidthPx: 800,
    imageHeightPx: 1600,
    pageWidthPt: widthPt,
  })
  assert.equal(layout.pageHeightPt.toFixed(2), '453.54')
  assert.equal(layout.drawWidthPt.toFixed(2), '226.77')
  assert.equal(layout.drawHeightPt.toFixed(2), '453.54')
  assert.equal(layout.drawXPt.toFixed(2), '0.00')
  assert.equal(layout.drawYPt.toFixed(2), '0.00')
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

await runTest('receipt rasterization stays exportable on Chromium and iOS instead of using a tainted foreignObject canvas', () => {
  const utilSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(utilSource, /await import\('html2canvas'\)/)
  assert.match(utilSource, /allowTaint: false/)
  assert.match(utilSource, /useCORS: true/)
  assert.doesNotMatch(utilSource, /const svg\s*=/)
  assert.doesNotMatch(utilSource, /new Blob\(\[svg\]/)
})

await runTest('receipt layout keeps Khmer labels, item columns, and row-aware image fallback', () => {
  const utilSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.match(receiptSource, /const RECEIPT_KHMER_LABELS/)
  assert.match(receiptSource, /បង្កាន់ដៃ/)
  assert.doesNotMatch(receiptSource, /áž/)
  // FOUR columns since Sep 4 2026 (item / qty / price / total), three when a
  // shop switches the price column off, and ONE track so the header row and
  // the item rows can never disagree about the count. Since N33 (owner, Sep 6
  // 2026, "make them compact... especially name") that track is
  // receiptItemGridTemplate() in utils/receiptItemColumns -- shared with
  // printReceipt.ts's paper re-layout, which used to keep a drifted copy.
  // receiptCompactRows.test.ts renders the component and states the geometry.
  assert.match(receiptSource, /const itemGridStyle: CSSProperties = \{/)
  assert.match(receiptSource, /gridTemplateColumns: receiptItemGridTemplate\(showUnitPriceCol\)/)
  assert.equal(
    (receiptSource.match(/style=\{itemGridStyle\}/g) || []).length,
    2,
    'the header row and the item rows must both read the shared track'
  )
  assert.match(receiptSource, /data-receipt-cell="line-total"/)
  assert.doesNotMatch(receiptSource, /getStatusLabel/)
  assert.doesNotMatch(receiptSource, /<Row label=\{labelFor\(lang, 'status'\)/)
  assert.doesNotMatch(receiptSource, /@\s*\{fmtUSD\(unitUsd\)\}/)
  // B5: actions resolve their target per variant -- the full receipt's ref
  // or the 80x50 card's -- and with the card enabled, Print offers BOTH
  // sizes as explicit variants.
  assert.match(receiptSource, /const target = variant === 'compact' \? compactPrintRef\.current : printRef\.current/)
  assert.match(receiptSource, /const exportReceiptVariant = async/)
  assert.match(receiptSource, /printTools\.printReceipt\(target,\s*\{[\s\S]*title,/)
  // N4 (owner, Sep 6 2026): the Open PDF action is gone, so the receipt
  // exports through Print and Image only -- see receiptActionRow.test.ts.
  assert.doesNotMatch(receiptSource, /printTools\.openReceiptPdf/)
  assert.match(receiptSource, /const defaultVariant: ReceiptVariant = 'full'/,
    'Image must export the detailed receipt, not silently use the 80x50 summary card')
  assert.match(receiptSource, /void exportReceiptPdf\('image', 'compact'\)/)
  assert.match(receiptSource, /void exportBothSeparately\('image'\)/)
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

await runTest('receipt discounts stay beside the charged price and printable grids reflow instead of clipping', () => {
  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  const previewSource = fs.readFileSync(new URL('../src/components/receipt-settings/ReceiptPreview.tsx', import.meta.url), 'utf8')
  const printSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')

  // The saving still belongs to the price, but the price is now a UNIT price
  // in its own column, so the parenthesised figure is the cut on one unit --
  // the owner's photo reads `28.00 (-7.00)` there, then `21.00` in Total.
  assert.match(receiptSource, /\{fmtUSD\(unitUsd\)\}[\s\S]*\(-\{fmtUSD\(unitSavingsUsd\)\}\)/,
    'the per-unit saving should be rendered next to the unit price in the Price cell')
  assert.match(receiptSource, /const lineUsd = figures\.chargedUnitUsd \* qty/,
    'the Total column carries the net line, which is what the printed Subtotal sums')
  assert.doesNotMatch(receiptSource, /\{qty\} × \{fmtUSD\(unitUsd\)\}/,
    'the qty × unit subline duplicated the Price column once that column existed')
  assert.doesNotMatch(receiptSource, /line-through text-gray-400/,
    'the receipt should not add a separate crossed-out price block beneath the product name')
  assert.match(previewSource, /businessDateTimeId\(previewNow\)/)
  assert.match(previewSource, /created_at: previewNow\.toISOString\(\)/)
  assert.doesNotMatch(previewSource, /receipt_number: '20260831-143000'/)
  // N33 (owner, Sep 6 2026): the exporter no longer carries its own literal
  // track list. It had drifted from what the component renders (3.6rem/3.2rem
  // here against 3.9rem/3.4rem there, 4.25rem against 4.6rem on the label
  // rows), so a column change reached the screen and never reached paper. Both
  // sides now read utils/receiptItemColumns; receiptCompactRows.test.ts pins
  // the resulting geometry.
  assert.match(printSource, /line\.style\.gridTemplateColumns = receiptItemGridTemplate\(false\)/)
  assert.match(printSource, /line\.style\.gridTemplateColumns = RECEIPT_ROW_GRID_TEMPLATE/)
  assert.doesNotMatch(printSource, /gridTemplateColumns = 'minmax\(0,1fr\)/,
    'no literal track may come back into the exporter -- that is the copy that drifted')
  // On paper the tracks are recomputed from the printable box, so the count
  // has to follow the cells. Three tracks under a four-cell row would wrap the
  // line total onto a row of its own -- invisible on screen, wrong on paper.
  assert.match(printSource, /const hasLineTotal = Boolean\(line\.querySelector\(.\[data-receipt-cell="line-total"\].\)\)/)
  assert.match(printSource, /line\.style\.gridTemplateColumns = receiptItemGridTemplate\(true\)/)
  // ...and the canvas fallback (iOS / tainted-foreignObject) draws four fields
  // rather than folding price and total into one right-aligned slot.
  assert.match(printSource, /const hasTotalColumn = parts\.length >= 4/)
  assert.match(printSource, /return compactValues\.slice\(0, 4\)\.join\('\\t'\)/)
  assert.match(printSource, /node\.style\.overflowX = 'visible'/)
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

await runTest('text_contrast survives a parseReceiptTemplate/serializeReceiptTemplate round trip alongside other fields', () => {
  const serialized = serializeReceiptTemplate({ text_contrast: 'maximum', font_size: 13 })
  const reparsed = parseReceiptTemplate(serialized)
  assert.equal(reparsed.text_contrast, 'maximum')
  assert.equal(reparsed.font_size, 13)

  const withoutField = parseReceiptTemplate(JSON.stringify({ font_size: 11 }))
  assert.equal(withoutField.text_contrast, DEFAULT_TEMPLATE.text_contrast,
    'a stored template predating this setting must default to normal, not undefined')
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

// --- KHR sub-lines are Grand-Total-only (template revision 2) --------------
// These four lock the fix for a real trap: a saved template overrides the
// defaults, so flipping DEFAULT_RECEIPT_TEMPLATE alone silently does nothing
// for any business that has ever opened Receipt Settings (it auto-saves the
// whole template). The revision upgrade is what actually clears them.

await runTest('KHR sub-lines default off; only the grand total keeps KHR', () => {
  assert.equal(DEFAULT_RECEIPT_TEMPLATE.show_item_khr, false)
  assert.equal(DEFAULT_RECEIPT_TEMPLATE.show_discount_khr, false)
  assert.equal(DEFAULT_RECEIPT_TEMPLATE.show_membership_discount_khr, false)
  assert.equal(DEFAULT_RECEIPT_TEMPLATE.show_delivery_khr, false)
  assert.equal(DEFAULT_RECEIPT_TEMPLATE.show_total_khr, true)
})

await runTest('a pre-revision saved template with KHR sub-lines ON is upgraded OFF', () => {
  const upgraded = normalizeReceiptTemplate({
    show_item_khr: true,
    show_discount_khr: true,
    show_membership_discount_khr: true,
    show_delivery_khr: true,
    show_total_khr: true,
    font_size: 15,
  })
  assert.equal(upgraded.show_item_khr, false, 'per-item KHR must be cleared')
  assert.equal(upgraded.show_discount_khr, false)
  assert.equal(upgraded.show_membership_discount_khr, false)
  assert.equal(upgraded.show_delivery_khr, false)
  assert.equal(upgraded.show_total_khr, true, 'grand-total KHR must survive')
  assert.equal(upgraded.font_size, 15, 'unrelated saved values must survive')
  assert.equal(upgraded.template_revision, RECEIPT_TEMPLATE_REVISION)
})

await runTest('once stamped, a deliberate re-enable is NOT overwritten again', () => {
  const reEnabled = normalizeReceiptTemplate({
    template_revision: RECEIPT_TEMPLATE_REVISION,
    show_item_khr: true,
    show_delivery_khr: true,
  })
  assert.equal(reEnabled.show_item_khr, true, 'upgrade must run once, not every load')
  assert.equal(reEnabled.show_delivery_khr, true)
})

await runTest('the receipt says Delivery, never Driver', () => {
  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.ok(!/'Driver:'/.test(receiptSource), 'the Driver label must be gone from the receipt')
  assert.match(receiptSource, /driver: 'Delivery:'/, 'the delivery-contact row is labelled Delivery')
  assert.match(receiptSource, /delivery: 'Delivery Fee:'/, 'the fee row stays distinct from the contact row')
})

if (failed > 0) {
  process.exitCode = 1
}
