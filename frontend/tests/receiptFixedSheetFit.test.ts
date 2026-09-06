import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  SINGLE_SHEET_MAX_HEIGHT_MM,
  computeFixedSheetFit,
  computeImagePdfLayout,
  isSingleSheetHeight,
} from '../src/utils/receiptPdfLayout.ts'

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

const printSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')

// O1 (owner, Sep 6 2026): "Receipt at 80mm x 50mm is broken both ways --
// download->print squeezes/overflows the card; direct print paginates onto TWO
// pages." A fixed sheet has a hard height budget. Every export path has to
// resolve an over-tall card the same way: ONE page, scaled down, never split.

await runTest('an 80x50 card taller than the sheet fits onto ONE page at a scale below 1', () => {
  // ~58.8mm: the compact card with an address row plus the ABA account
  // name/number block, measured at 80mm wide.
  const fit = computeFixedSheetFit({ contentHeightMm: 58.8, sheetHeightMm: 50 })
  assert.equal(fit.fits, false, 'a 58.8mm card does not fit a 50mm sheet unscaled')
  assert.equal(fit.unscaledPageCount, 2, 'unscaled, the print engine has to break it across two pages')
  assert.ok(fit.scale < 1, `the fit factor must shrink the card, got ${fit.scale}`)
  assert.equal(fit.scale.toFixed(4), '0.8503')
  assert.equal(fit.scaledHeightMm.toFixed(2), '50.00', 'the fitted card must land exactly on the sheet')
})

await runTest('a card that already fits is never scaled or enlarged', () => {
  const fit = computeFixedSheetFit({ contentHeightMm: 44.7, sheetHeightMm: 50 })
  assert.equal(fit.fits, true)
  assert.equal(fit.scale, 1, 'a short card must print at full size, not stretched to the sheet')
  assert.equal(fit.unscaledPageCount, 1)
  assert.equal(fit.scaledHeightMm.toFixed(2), '44.70')
  assert.equal(fit.contentWidthPercent, 100)
})

await runTest('a card exactly the height of the sheet stays one unscaled page', () => {
  const fit = computeFixedSheetFit({ contentHeightMm: 50, sheetHeightMm: 50 })
  assert.equal(fit.fits, true)
  assert.equal(fit.scale, 1)
  assert.equal(fit.unscaledPageCount, 1, 'sub-millimetre rounding must not invent a second page')
})

await runTest('even the worst-case tall card resolves to a single page', () => {
  // Phone + address + ABA + QR + note measures ~83.6mm; a full A4-length
  // receipt forced onto a 50mm label is the pathological end of the same range.
  const tall = computeFixedSheetFit({ contentHeightMm: 83.6, sheetHeightMm: 50 })
  assert.equal(tall.unscaledPageCount, 2)
  assert.equal(tall.scale.toFixed(4), '0.5981')
  assert.equal(tall.scaledHeightMm.toFixed(2), '50.00')

  const extreme = computeFixedSheetFit({ contentHeightMm: 200, sheetHeightMm: 50 })
  assert.equal(extreme.unscaledPageCount, 4)
  assert.equal(extreme.scale, 0.25, 'no clamp may leave content taller than the sheet')
  assert.equal(extreme.scaledHeightMm.toFixed(2), '50.00')
})

await runTest('the fit reflows at a wider layout box so the card keeps the full sheet width', () => {
  const fit = computeFixedSheetFit({ contentHeightMm: 83.6, sheetHeightMm: 50 })
  // Render wider, then scale back down -- the same mechanism the operator
  // Scale setting already uses. Scaling in place would leave the card narrow
  // and gutter-centred, which is the "squeezed" half of the owner report.
  assert.equal(fit.contentWidthPercent.toFixed(2), (100 / fit.scale).toFixed(2))
  assert.ok(fit.contentWidthPercent > 100, 'an over-tall card must be laid out wider before shrinking')
})

await runTest('a fitted 80x50 raster fills the PDF page instead of sitting in side gutters', () => {
  const widthPt = (80 / 25.4) * 72
  const heightPt = (50 / 25.4) * 72
  const layout = computeImagePdfLayout({
    imageWidthPx: 800,
    imageHeightPx: 500,
    pageWidthPt: widthPt,
    fixedHeightPt: heightPt,
  })
  assert.equal(layout.pageHeightPt.toFixed(2), '141.73', 'the 80x50 MediaBox stays exact')
  assert.equal(layout.drawXPt.toFixed(2), '0.00', 'a sheet-shaped raster must not be centred in gutters')
  assert.equal(layout.drawYPt.toFixed(2), '0.00')
  assert.equal(layout.drawWidthPt.toFixed(2), widthPt.toFixed(2), 'the label must be used edge to edge')
  assert.equal(layout.drawHeightPt.toFixed(2), heightPt.toFixed(2))
})

await runTest('Print, PDF and Image inherit ONE shared fixed-sheet fit step', () => {
  assert.match(printSource, /import \{ computeFixedSheetFit, computeImagePdfLayout, isSingleSheetHeight \} from '\.\/receiptPdfLayout\.ts'/)
  assert.match(printSource, /const fixedSheetHeightMm = getPaperHeightMm\(printSettings\)/,
    'withReceiptElement must resolve the sheet height once for every export path')
  assert.match(printSource, /const fit = computeFixedSheetFit\(\{ contentHeightMm, sheetHeightMm: fixedSheetHeightMm \}\)/)
  assert.match(printSource, /inner\.style\.transform = `scale\(\$\{totalScale\}\)`/)
  assert.match(printSource, /inner\.style\.width = `\$\{100 \/ totalScale\}%`/)
  assert.match(printSource, /host\.style\.height = `\$\{fixedSheetHeightMm\}mm`/,
    'the host must be pinned to the sheet so the raster and the measured page are both exactly 80x50')
  assert.match(printSource, /host\.style\.overflow = 'hidden'/)
})

await runTest('a fixed sheet does not inherit the frozen on-screen card height', () => {
  // cloneElementWithInlineStyles bakes the computed `height` of the export
  // root, so a card measured on a narrow phone would otherwise be fitted
  // against blank space instead of its own content.
  assert.match(printSource, /cloned\.style\.height = 'auto'/)
  assert.match(printSource, /cloned\.style\.padding = printPadding/,
    'continuous rolls keep replacing the screen-shell padding with the operator margins')
})

await runTest('the print document consumes the layout flags so a single sheet cannot paginate', () => {
  assert.match(printSource, /const \{ markup, widthMm, pageHeightMm, continuousRoll, singleSheet \} = layout/,
    'continuousRoll was computed and returned but never read')
  assert.match(printSource, /const clipToOnePage = singleSheet && !continuousRoll/)
  assert.match(printSource, /const pageOverflow = clipToOnePage \? 'hidden' : 'visible'/)
  assert.match(printSource, /overflow: \$\{pageOverflow\} !important;/)
  // The html/body print rule used to force overflow visible unconditionally,
  // which is what let an over-tall 80x50 card spill onto page 2. Anchor on the
  // neighbouring declarations, and tolerate this checkout's CRLF endings -- a
  // `\n`-only pattern here silently matches nothing and asserts nothing.
  assert.doesNotMatch(printSource, /background: #ffffff;\r?\n\s*overflow: visible !important;/,
    'the printed page must not force overflow visible for a single sheet')
  assert.match(printSource, /const fixedFrameHeightCss = clipToOnePage/,
    'a single sheet pins the printed frame to the page height')
  assert.match(printSource, /singleSheet: isSingleSheetHeight\(fixedHeightMm\)/,
    'the layout must carry which kind of page this is')
})

await runTest('a document page keeps paginating instead of being squeezed onto one page', () => {
  // A4 297mm / Letter 279.4mm are stacks of pages: a 60-item receipt is
  // legitimately two pages there, and shrinking it to one would make it
  // unreadable. Only a card/label is a single physical ticket.
  assert.equal(isSingleSheetHeight(297), false, 'A4 must keep paginating')
  assert.equal(isSingleSheetHeight(279.4), false, 'Letter must keep paginating')
  assert.equal(isSingleSheetHeight(50), true, 'the 80x50 label is one physical ticket')
  assert.equal(isSingleSheetHeight(SINGLE_SHEET_MAX_HEIGHT_MM), true)
  assert.equal(isSingleSheetHeight(SINGLE_SHEET_MAX_HEIGHT_MM + 0.1), false)
  // Continuous rolls (58/72/80mm) resolve to a null height: their page grows.
  assert.equal(isSingleSheetHeight(null), false)
  assert.equal(isSingleSheetHeight(undefined), false)
  assert.equal(isSingleSheetHeight(0), false)
  assert.equal(isSingleSheetHeight(Number.NaN), false)

  assert.match(printSource, /const fitToOneSheet = isSingleSheetHeight\(fixedSheetHeightMm\)/)
  assert.match(printSource, /if \(fixedSheetHeightMm != null && fitToOneSheet\) \{/,
    'the fit step must not run for A4/Letter, or a long receipt would be shrunk to one page')
})

await runTest('the fit is measured only after the card assets have settled', () => {
  // An unfinished web font or a still-loading QR makes the card measure short,
  // and a short measurement decides an over-tall card needs no fit at all.
  const fitBlock = printSource.slice(
    printSource.indexOf('if (fixedSheetHeightMm != null && fitToOneSheet) {'),
    printSource.indexOf('const fit = computeFixedSheetFit('),
  )
  assert.ok(fitBlock.length > 0, 'the fixed-sheet fit block must exist')
  assert.match(fitBlock, /await waitForElementAssets\(host\)/,
    'measure the card only once its fonts and images are ready')
})

if (failed > 0) {
  process.exitCode = 1
}
