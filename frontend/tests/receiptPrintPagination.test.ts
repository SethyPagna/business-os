import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildPrintablePreviewDocument,
  buildSingleImagePdf,
  capDriverFormMargins,
  getDriverFormWidthMm,
  measureContinuousRollPageHeightMm,
  printsOnPrinterPaper,
  remeasureContinuousRollBeforePrint,
  resolveReceiptPageGeometry,
  writeContinuousRollPageSize,
} from '../src/utils/printReceipt.ts'
import { computeImagePageSegments, isSingleSheetPaperSize } from '../src/utils/receiptPdfLayout.ts'
import { DEFAULT_RECEIPT_PRINT_SETTINGS, normalizeReceiptPrintSettings, receiptRenditionPrintSettings } from '../src/utils/receiptAppliedConfig.ts'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const mmToPt = (mm: number): number => mm * 72 / 25.4
const pdfText = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1')
const pageCount = (text: string): number => (text.match(/\/Type\s*\/Page\b/g) || []).length
const mediaBoxes = (text: string): string[] => Array.from(text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g), (match) => match[1])
const drawMatrices = (text: string): number[][] => Array.from(
  text.matchAll(/(-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\n\/Im0/g),
  (match) => match.slice(1).map(Number),
)

const fakeJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])

await runTest('98x148 PDF pages keep 1/10/25-item receipt rasters full width and paginate', () => {
  // Actual Chromium receipt measurements at 98 mm from the regression:
  // 1 item=468px, 10=936px, 25=1716px at a 370px receipt width.
  const cases = [
    { items: 1, heightPx: 468, pages: 1 },
    { items: 10, heightPx: 936, pages: 2 },
    { items: 25, heightPx: 1716, pages: 4 },
  ]
  for (const sample of cases) {
    const text = pdfText(buildSingleImagePdf({
      imageBytes: fakeJpeg,
      imageWidthPx: 370,
      imageHeightPx: sample.heightPx,
      pageWidthPt: mmToPt(98),
      pageHeightPt: mmToPt(148),
      singleSheet: false,
      title: `${sample.items} items`,
    }))
    assert.equal(pageCount(text), sample.pages, `${sample.items} items use the expected physical page count`)
    assert.equal(mediaBoxes(text).length, sample.pages)
    assert.ok(mediaBoxes(text).every((box) => box === '0 0 277.80 419.53'), 'every page stays exactly 98x148 mm')
    const matrices = drawMatrices(text)
    assert.equal(matrices.length, sample.pages)
    assert.ok(matrices.every(([width, , x]) => Math.abs(width - mmToPt(98)) < 0.01 && x === 0),
      `${sample.items} items remain full-width instead of being centered in narrow gutters`)
  }
})

await runTest('continuous 80mm PDF remains one exact content-height roll page for 1/10/25 items', () => {
  const samples = [
    { items: 1, heightPx: 1248 },
    { items: 10, heightPx: 2486 },
    { items: 25, heightPx: 4550 },
  ]
  let previousHeight = 0
  for (const sample of samples) {
    const text = pdfText(buildSingleImagePdf({
      imageBytes: fakeJpeg,
      imageWidthPx: 800,
      imageHeightPx: sample.heightPx,
      pageWidthPt: mmToPt(80),
    }))
    assert.equal(pageCount(text), 1, `${sample.items} items remain one variable-height PDF page`)
    const [[width, height, x, y]] = drawMatrices(text)
    assert.equal(width.toFixed(2), mmToPt(80).toFixed(2))
    assert.ok(height > previousHeight, 'page height grows with receipt content')
    assert.equal(x, 0)
    assert.equal(y, 0)
    assert.equal(mediaBoxes(text)[0], `0 0 226.77 ${height.toFixed(2)}`)
    previousHeight = height
  }
})

await runTest('fixed document pages stop at receipt-row boundaries instead of slicing text', () => {
  assert.deepEqual(computeImagePageSegments({
    imageHeightPx: 1000,
    pageCapacityPx: 400,
    breakOffsetsPx: [120, 360, 590, 810, 940],
  }), [
    { startPx: 0, endPx: 360 },
    { startPx: 360, endPx: 590 },
    { startPx: 590, endPx: 940 },
    { startPx: 940, endPx: 1000 },
  ])
  assert.deepEqual(computeImagePageSegments({
    imageHeightPx: 900,
    pageCapacityPx: 400,
    breakOffsetsPx: [700],
  }), [
    { startPx: 0, endPx: 400 },
    { startPx: 400, endPx: 700 },
    { startPx: 700, endPx: 900 },
  ], 'an over-tall atomic region still advances without an infinite loop')

  const source = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(source, /classList\.contains\('py-1\.5'\)\s*\|\|\s*parent\?\.classList\.contains\('border-y-2'\)/,
    'item wrappers and the complete totals panel are measured as atomic page-break blocks')
})

await runTest('explicit 80x50 card remains one fitted sheet', () => {
  const text = pdfText(buildSingleImagePdf({
    imageBytes: fakeJpeg,
    imageWidthPx: 800,
    imageHeightPx: 1600,
    pageWidthPt: mmToPt(80),
    pageHeightPt: mmToPt(50),
    singleSheet: true,
  }))
  assert.equal(pageCount(text), 1)
  assert.equal(mediaBoxes(text)[0], '0 0 226.77 141.73')
  const [[width, height, x, y]] = drawMatrices(text)
  assert.equal(width.toFixed(2), '70.87')
  assert.equal(height.toFixed(2), '141.73')
  assert.equal(x.toFixed(2), '77.95')
  assert.equal(y, 0)

  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.match(receiptSource, /const compactPrintSettings = receiptRenditionPrintSettings\(appliedPrintSettings, 'card'\)/,
    'the actual compact Print/PDF caller prints with the card rendition settings')
  assert.equal(receiptRenditionPrintSettings({ ...DEFAULT_RECEIPT_PRINT_SETTINGS, paperSize: 'custom' }, 'card').paperSize, '80x50mm',
    'the card keeps the named single-card preset, never an arbitrary custom document')
})

await runTest('direct continuous print keeps a VALID width-by-measured-height @page (never `auto` combined with a length), and never a forced page break', () => {
  const samples = [
    { items: 1, heightMm: 124.83 },
    { items: 10, heightMm: 248.65 },
    { items: 25, heightMm: 455.03 },
  ]
  for (const sample of samples) {
    const itemIds = Array.from({ length: sample.items }, (_, index) => `ITEM-${index + 1}`)
    const markup = `<section>${itemIds.join('|')}|TOTAL|QR-SYMBOL</section>`
    const html = buildPrintablePreviewDocument({
      markup,
      widthMm: 80,
      pageHeightMm: sample.heightMm,
      continuousRoll: true,
      singleSheet: false,
    })
    // 2026-09-15 (owner, real 80mm print photos) + coordinator review:
    // `size: 80mm auto` is INVALID CSS (a length combined with `auto` is a
    // parse error under CSS Paged Media, which only accepts `auto` alone,
    // one/two lengths, or a page-size keyword) -- the whole @page declaration
    // is dropped and the printer falls back to its own default document
    // size. That is exactly the a4d99ac0/943e9884 failure (Sep 12) repeated.
    // The fallback baked into the initial markup must stay a VALID explicit
    // width x height.
    assert.match(html, new RegExp(`size: 80mm ${sample.heightMm.toFixed(2)}mm`),
      `${sample.items} items keep a valid explicit fallback @page size`)
    assert.doesNotMatch(html, /size:\s*[\d.]+mm\s+auto/, `${sample.items} items: size is never a length combined with auto`)
    assert.doesNotMatch(html, /size:\s*auto\s*[,;)]/, `${sample.items} items: size never falls back to the printer default document size`)
    // No fixed/min height forced on the print root -- it grows with content.
    assert.doesNotMatch(html, /height:\s*[\d.]+mm !important/,
      `${sample.items} items: no fixed page height on the print root`)
    assert.match(html, /height:\s*auto !important/)
    assert.match(html, /min-height:\s*0 !important/)
    assert.match(html, /width: 80mm !important/)
    assert.doesNotMatch(html, /transform:\s*scale\(/)
    // Nothing forces a page break: no break-inside / page-break-inside rule
    // anywhere in the document (that is what pushed the whole QR block onto
    // its own physical strip when the measured height came up short).
    assert.doesNotMatch(html, /break-inside/, `${sample.items} items: no break-inside rule anywhere`)
    assert.doesNotMatch(html, /page-break-inside/, `${sample.items} items: no page-break-inside rule anywhere`)
    assert.doesNotMatch(html, /page-break-before/, `${sample.items} items: no page-break-before rule anywhere`)
    assert.doesNotMatch(html, /break-before/, `${sample.items} items: no break-before rule anywhere`)
    for (const id of itemIds) assert.ok(html.includes(id), `${id} is retained`)
    assert.ok(html.includes('TOTAL'))
    assert.ok(html.includes('QR-SYMBOL'))
    // Everything -- items, totals and the QR footer -- lives inside the ONE
    // print container; the markup was never split into more than one
    // `.receipt-frame`.
    assert.equal((html.match(/class="receipt-frame"/g) || []).length, 1,
      `${sample.items} items render inside exactly one print container`)
    // The dedicated, initially-empty stylesheet the in-document re-measure
    // overwrites right before print(), and the visible length diagnostic it
    // also updates.
    assert.match(html, /<style id="receipt-page-size"><\/style>/)
    assert.match(html, new RegExp(`data-receipt-length-line="true">Receipt length: ${sample.heightMm}`),
      'the app-measured length shows in the toolbar diagnostics before the in-document re-measure runs')
  }

  const source = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.slice\(0, 260\)/,
    'the text fallback must not silently discard late receipt items or totals')
})

await runTest('a genuine fixed sheet (80x50 card / A4 / Letter / custom height) keeps its explicit @page height and break-avoidance, and never carries a length line', () => {
  const html = buildPrintablePreviewDocument({
    markup: '<section>ITEM-1|TOTAL|QR-SYMBOL</section>',
    widthMm: 80,
    pageHeightMm: 50,
    continuousRoll: false,
    singleSheet: true,
  })
  assert.match(html, /size: 80mm 50\.00mm/)
  assert.doesNotMatch(html, /size:\s*80mm auto/)
  assert.match(html, /break-inside: avoid-page/, 'a real single card still keeps its content from bleeding onto a second card')
  assert.doesNotMatch(html, /data-receipt-length-line/, 'a fixed sheet is already fitted to its explicit height; it has no roll length to report')
})

function makeFakeReceiptFrame(scrollHeightPx: number, renderedWidthPx: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({ width: renderedWidthPx, height: 0 }),
    scrollHeight: scrollHeightPx,
    offsetWidth: renderedWidthPx,
    offsetHeight: scrollHeightPx,
  } as unknown as HTMLElement
}

await runTest('measureContinuousRollPageHeightMm reads the ACTUAL print document (fake DOM), not the app off-screen estimate', () => {
  // 1800px tall at a 300px-wide frame standing in for 80mm: 1800 * (80/300)
  // = 480mm content, +3mm safety buffer = 483mm.
  const fakeDoc = { querySelector: (selector: string) => (selector === '.receipt-frame' ? makeFakeReceiptFrame(1800, 300) : null) } as unknown as Document
  assert.equal(measureContinuousRollPageHeightMm(fakeDoc, 80), 483)

  const noFrameDoc = { querySelector: () => null } as unknown as Document
  assert.equal(measureContinuousRollPageHeightMm(noFrameDoc, 80), null, 'a document with no .receipt-frame is a safe null, never a throw')

  const zeroWidthDoc = { querySelector: () => makeFakeReceiptFrame(1800, 0) } as unknown as Document
  assert.equal(measureContinuousRollPageHeightMm(zeroWidthDoc, 80), null, 'a zero-width frame cannot be converted to mm; stay null rather than divide by zero')
})

await runTest('writeContinuousRollPageSize overwrites #receipt-page-size with a VALID @page rule, never `auto`', () => {
  let written = ''
  const fakeStyleEl = { set textContent(value: string) { written = value } } as unknown as HTMLElement
  const fakeDoc = { getElementById: (id: string) => (id === 'receipt-page-size' ? fakeStyleEl : null) } as unknown as Document
  writeContinuousRollPageSize(fakeDoc, 80, 187.416)
  assert.equal(written, '@page { size: 80mm 187.42mm; margin: 0; }')
  assert.doesNotMatch(written, /auto/)

  // Missing element (a fixed-sheet document, or a print with no JS) must not throw.
  const noStyleDoc = { getElementById: () => null } as unknown as Document
  assert.doesNotThrow(() => writeContinuousRollPageSize(noStyleDoc, 80, 187.42))
})

await runTest('remeasureContinuousRollBeforePrint runs the @page rewrite AND the visible length update together, and is a no-op for a fixed sheet', () => {
  let pageSizeCss = ''
  const fakeStyleEl = { set textContent(value: string) { pageSizeCss = value } } as unknown as HTMLElement
  let lengthText = ''
  const fakeLengthEl = { set textContent(value: string) { lengthText = value } } as unknown as HTMLElement
  const fakeDoc = {
    querySelector: (selector: string) => {
      if (selector === '.receipt-frame') return makeFakeReceiptFrame(1800, 300)
      if (selector === '[data-receipt-length-line]') return fakeLengthEl
      return null
    },
    getElementById: (id: string) => (id === 'receipt-page-size' ? fakeStyleEl : null),
  } as unknown as Document

  remeasureContinuousRollBeforePrint(fakeDoc, { markup: '', widthMm: 80, pageHeightMm: 100, continuousRoll: true, singleSheet: false })
  assert.equal(pageSizeCss, '@page { size: 80mm 483.00mm; margin: 0; }')
  assert.match(lengthText, /483/)

  pageSizeCss = ''
  lengthText = ''
  remeasureContinuousRollBeforePrint(fakeDoc, { markup: '', widthMm: 80, pageHeightMm: 50, continuousRoll: false, singleSheet: true })
  assert.equal(pageSizeCss, '', 'a fixed sheet already fitted to its explicit height must never be rewritten')
  assert.equal(lengthText, '')

  // A throwing measurement must never propagate and block the print.
  const throwingDoc = { querySelector: () => { throw new Error('boom') } } as unknown as Document
  assert.doesNotThrow(() => remeasureContinuousRollBeforePrint(throwingDoc, { markup: '', widthMm: 80, pageHeightMm: 100, continuousRoll: true, singleSheet: false }))
})

await runTest('both print delivery paths re-measure inside the actual print document, right before print()', () => {
  const source = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  // Preview-window path: waits for the document's own fonts/images, THEN
  // re-measures, THEN calls print() -- in that order, both on the Print
  // button and on the auto-print schedule.
  assert.match(source,
    /const printNow = async \(\) => \{[\s\S]{0,200}await waitForFrameAssets\(previewWindow, doc\)[\s\S]{0,200}remeasureContinuousRollBeforePrint\(doc, layout, options\.previewTranslate\)[\s\S]{0,120}previewWindow\.print\?\.\(\)/,
    'the preview window re-measures after asset-wait and before print()')
  assert.match(source, /printButton\?\.addEventListener\('click', \(\) => \{ void printNow\(\) \}\)/)
  assert.match(source, /const schedulePrint = \(\) => previewWindow\.setTimeout\?\.\(\(\) => \{ void printNow\(\) \}, 240\)/)
  // Hidden-iframe path: printHtmlInHiddenFrame already awaits fonts/images
  // internally; the beforePrint hook re-measures right before IT prints.
  assert.match(source,
    /printHtmlInHiddenFrame\(html, \{[\s\S]{0,400}beforePrint: \(_win, frameDoc\) => \{ remeasureContinuousRollBeforePrint\(frameDoc, layout, options\.previewTranslate\) \}/,
    'the hidden-iframe path re-measures via beforePrint before it calls print()')

  const surfaceSource = fs.readFileSync(new URL('../src/utils/printSurface.ts', import.meta.url), 'utf8')
  assert.match(surfaceSource, /await waitForFrameAssets\(frameWindow, frameDocument\)[\s\S]{0,200}if \(options\.beforePrint\)/,
    'printHtmlInHiddenFrame invokes beforePrint AFTER assets settle and BEFORE print()')
  assert.match(surfaceSource, /if \(!printed\) frameWindow\.print\(\)/)
})

// --- P7-receipt-page-modes: pageSizeMode fallbacks -------------------------

await runTest('resolveReceiptPageGeometry: measured mode (default) keeps the in-document remeasured roll behaviour unchanged', () => {
  const geometry = resolveReceiptPageGeometry({ fixedHeightMm: null, measuredHeightMm: 300, savedPageSizeMode: 'measured', fixedPageLengthMm: '100' })
  assert.equal(geometry.pageHeightMm, 301)
  assert.equal(geometry.continuousRoll, true)
  assert.equal(geometry.pageSizeMode, 'measured')

  const html = buildPrintablePreviewDocument({
    markup: '<section>ITEM-1</section>',
    widthMm: 80,
    pageHeightMm: geometry.pageHeightMm,
    continuousRoll: geometry.continuousRoll,
    singleSheet: false,
    pageSizeMode: geometry.pageSizeMode,
  })
  assert.match(html, /size: 80mm 301\.00mm/, 'measured mode keeps an explicit measured @page size')
  assert.match(html, /data-receipt-length-line="true"/, 'measured mode still shows the pre-print length diagnostic')
})

await runTest('resolveReceiptPageGeometry: a missing/undefined saved pageSizeMode (pre-feature settings, the exact production shape reported 2026-09-16) now defaults to driver-forms', () => {
  const geometry = resolveReceiptPageGeometry({ fixedHeightMm: null, measuredHeightMm: 200, savedPageSizeMode: undefined, fixedPageLengthMm: undefined })
  assert.equal(geometry.pageSizeMode, 'driver-forms')
  assert.equal(geometry.continuousRoll, false)
  // The content estimate only; driver-forms sends no page size (below).
  assert.equal(geometry.pageHeightMm, 201)
})

await runTest('resolveReceiptPageGeometry: fixed mode with a 25-item receipt uses the explicit 80x100mm page and paginates instead of clipping', () => {
  const geometry = resolveReceiptPageGeometry({ fixedHeightMm: null, measuredHeightMm: 455.03, savedPageSizeMode: 'fixed', fixedPageLengthMm: '100' })
  assert.equal(geometry.pageHeightMm, 100)
  assert.equal(geometry.continuousRoll, false)
  assert.equal(geometry.pageSizeMode, 'fixed')

  const itemIds = Array.from({ length: 25 }, (_, index) => `ITEM-${index + 1}`)
  const html = buildPrintablePreviewDocument({
    markup: `<section>${itemIds.join('|')}</section>`,
    widthMm: 80,
    pageHeightMm: geometry.pageHeightMm,
    continuousRoll: geometry.continuousRoll,
    singleSheet: false,
    pageSizeMode: geometry.pageSizeMode,
  })
  assert.match(html, /size: 80mm 100\.00mm/, 'fixed mode emits an explicit 80x100mm page')
  assert.doesNotMatch(html, /overflow: hidden !important/, 'a fixed-length document page never clips a long receipt')
  assert.match(html, /overflow: visible !important/, 'content keeps flowing onto further 100mm pages instead of being cut')
  for (const id of itemIds) assert.ok(html.includes(id), `${id} is retained, none of the 25 items are dropped`)
  assert.match(html, /break-inside: avoid-page/, 'fixed-length pagination still keeps an item/row from being sliced across two pages')
  assert.doesNotMatch(html, /data-receipt-length-line="true">Receipt length/, 'fixed mode has a chosen page length, not a measured roll length to report')
})

await runTest('resolveReceiptPageGeometry: driver mode emits NO @page size token at all, only margin: 0, and is not remeasured', () => {
  const geometry = resolveReceiptPageGeometry({ fixedHeightMm: null, measuredHeightMm: 248.65, savedPageSizeMode: 'driver', fixedPageLengthMm: '100' })
  assert.equal(geometry.continuousRoll, false, 'driver mode must never be re-measured in-document')
  assert.equal(geometry.pageSizeMode, 'driver')

  const html = buildPrintablePreviewDocument({
    markup: '<section>ITEM-1|ITEM-2</section>',
    widthMm: 80,
    pageHeightMm: geometry.pageHeightMm,
    continuousRoll: geometry.continuousRoll,
    singleSheet: false,
    pageSizeMode: geometry.pageSizeMode,
  })
  const pageRuleMatch = html.match(/@page\s*\{([^}]*)\}/)
  assert.ok(pageRuleMatch, 'the document still has an @page rule')
  assert.doesNotMatch(pageRuleMatch![1], /size:/, 'driver mode leaves the printer driver\'s own registered page/form in charge')
  assert.match(pageRuleMatch![1], /margin:\s*0;/, 'margins stay zero even with no explicit size')

  // remeasureContinuousRollBeforePrint is gated on layout.continuousRoll,
  // which driver mode sets to false -- the in-document remeasure that
  // rewrites #receipt-page-size must be skipped for this mode.
  let rewritten = false
  const fakeStyleEl = { set textContent(_value: string) { rewritten = true } } as unknown as HTMLElement
  const fakeDoc = { getElementById: (id: string) => (id === 'receipt-page-size' ? fakeStyleEl : null), querySelector: () => null } as unknown as Document
  remeasureContinuousRollBeforePrint(fakeDoc, { markup: '', widthMm: 80, pageHeightMm: geometry.pageHeightMm, continuousRoll: geometry.continuousRoll, singleSheet: false, pageSizeMode: geometry.pageSizeMode })
  assert.equal(rewritten, false, 'driver mode never overwrites #receipt-page-size in-document')
})

await runTest('resolveReceiptPageGeometry: auto-longest emits one explicit longest-roll @page size with page-break-after avoid', () => {
  const geometry = resolveReceiptPageGeometry({ fixedHeightMm: null, measuredHeightMm: 455.03, savedPageSizeMode: 'auto-longest', fixedPageLengthMm: '100' })
  assert.equal(geometry.pageHeightMm, 3276)
  assert.equal(geometry.continuousRoll, false)
  assert.equal(geometry.pageSizeMode, 'auto-longest')

  const html = buildPrintablePreviewDocument({
    markup: '<section>ITEM-1</section>',
    widthMm: 80,
    pageHeightMm: geometry.pageHeightMm,
    continuousRoll: geometry.continuousRoll,
    singleSheet: false,
    pageSizeMode: geometry.pageSizeMode,
  })
  assert.match(html, /size: 80mm 3276\.00mm/, 'auto-longest emits one explicit page as long as the printer\'s longest supported roll')
  assert.match(html, /page-break-after:\s*avoid/, 'auto-longest guards against a driver paginating anyway')
})

// --- driver-forms (2026-09-16 owner report; 2026-09-23 print photo) ---
// Chrome never switches the dialog's paper to match a CSS @page size: a
// smaller CSS page is centred on the chosen paper (the blank band above the
// receipt) and a taller one is shrunk or split, and the print document lays
// out taller than the app's estimate, so a form picked from that estimate
// (the 2026-09-16 design) could still split. With no size the receipt starts
// at the top of whatever paper is chosen; on the longest form the driver
// trims the unused paper and cuts at the end of the receipt.

await runTest('resolveReceiptPageGeometry: driver-forms sends NO @page size for any receipt length, never clips, keeps rows intact across a page break, and is not remeasured', () => {
  for (const measuredHeightMm of [150, 250, 380, 700, 900]) {
    const geometry = resolveReceiptPageGeometry({ fixedHeightMm: null, measuredHeightMm, savedPageSizeMode: 'driver-forms' })
    assert.equal(geometry.pageHeightMm, measuredHeightMm + 1, `${measuredHeightMm}mm: the content estimate, not a page length`)
    assert.equal(geometry.continuousRoll, false)
    assert.equal(geometry.pageSizeMode, 'driver-forms')

    const layout = {
      markup: '<section>ITEM-1|ITEM-2</section>',
      widthMm: 72,
      pageHeightMm: geometry.pageHeightMm,
      continuousRoll: geometry.continuousRoll,
      singleSheet: false,
      pageSizeMode: geometry.pageSizeMode,
    }
    const html = buildPrintablePreviewDocument(layout)
    const pageRuleMatch = html.match(/@page\s*\{([^}]*)\}/)
    assert.ok(pageRuleMatch, 'the document still has an @page rule')
    assert.doesNotMatch(pageRuleMatch![1], /size:/, `${measuredHeightMm}mm: the print dialog's paper is the page`)
    assert.match(pageRuleMatch![1], /margin:\s*0;/, 'no page margin on top of the receipt margins')
    assert.match(html, /width: 72mm !important;/, 'the receipt still prints at the full 72mm paper width')
    assert.doesNotMatch(html, /overflow: hidden !important/, `${measuredHeightMm}mm: a receipt longer than the chosen paper is never clipped`)
    assert.match(html, /break-inside: avoid-page/, `${measuredHeightMm}mm: a split onto a shorter paper still keeps an item/row intact`)
    assert.doesNotMatch(html, /data-receipt-length-line="true">Receipt length/, 'no measured roll length is reported for a size that is not sent')

    let rewritten = false
    const fakeStyleEl = { set textContent(_value: string) { rewritten = true } } as unknown as HTMLElement
    const fakeDoc = { getElementById: (id: string) => (id === 'receipt-page-size' ? fakeStyleEl : null), querySelector: () => null } as unknown as Document
    remeasureContinuousRollBeforePrint(fakeDoc, layout)
    assert.equal(rewritten, false, 'the in-document remeasure never writes a page size back in')
  }
})

await runTest('capDriverFormMargins: driver-forms prints with no top margin and at most 1mm sides, keeping the bottom margin and every other setting', () => {
  const capped = capDriverFormMargins({ ...DEFAULT_RECEIPT_PRINT_SETTINGS, marginTop: '4', marginRight: '4', marginBottom: '4', marginLeft: '0.5', scale: '90' })
  assert.equal(capped.marginTop, '0', 'the printer already feeds ~11mm of blank paper ahead of the receipt after each cut')
  assert.equal(capped.marginRight, '1')
  assert.equal(capped.marginLeft, '0.5', 'a side margin under the cap is kept')
  assert.equal(capped.marginBottom, '4', 'the gap before the cut is kept')
  assert.equal(capped.scale, '90')
  assert.equal(DEFAULT_RECEIPT_PRINT_SETTINGS.marginTop, '4', 'the saved settings are not mutated')

  const printSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(printSource, /const hostPrintSettings = printsOnDriverForms \? capDriverFormMargins\(printSettings\) : printSettings/,
    'only the driver-forms print path uses the capped margins; PDF and image keep the configured ones')
})

await runTest('resolveReceiptPageGeometry: a document sheet (A4/Letter/custom height) always resolves to measured bookkeeping regardless of the saved pageSizeMode', () => {
  for (const savedPageSizeMode of ['measured', 'fixed', 'driver', 'auto-longest', 'driver-forms', undefined]) {
    for (const fixedHeightMm of [297, 279.4, 150]) {
      const geometry = resolveReceiptPageGeometry({ fixedHeightMm, measuredHeightMm: 999, savedPageSizeMode, fixedPageLengthMm: '150' })
      assert.equal(geometry.pageHeightMm, fixedHeightMm, `paperSize's own explicit height wins regardless of pageSizeMode=${savedPageSizeMode}`)
      assert.equal(geometry.continuousRoll, false)
      assert.equal(geometry.pageSizeMode, 'measured')
    }
  }
  assert.equal(isSingleSheetPaperSize('80x50mm'), true, '80x50mm keeps its existing fit-to-one-card identity')
  assert.equal(isSingleSheetPaperSize('A4'), false)
})

// 2026-09-23: the 80x50 card is enabled in production and prints on the same
// roll printer as the full receipt. With the longest paper chosen once in the
// print dialog (72 x 800mm), a card that kept `@page size: 80mm 50mm` was
// centred on that paper, about 37cm down the strip.
await runTest('resolveReceiptPageGeometry: the 80x50 card follows the printer-paper modes and keeps its one-card height', () => {
  for (const savedPageSizeMode of ['driver-forms', 'driver', undefined]) {
    const geometry = resolveReceiptPageGeometry({ fixedHeightMm: 50, measuredHeightMm: 999, savedPageSizeMode, singleSheet: true })
    assert.equal(geometry.pageHeightMm, 50, `${savedPageSizeMode}: still one 50mm card`)
    assert.equal(geometry.continuousRoll, false)
    assert.equal(geometry.pageSizeMode, savedPageSizeMode || 'driver-forms', `${savedPageSizeMode}: no @page size, like the roll`)
  }
  for (const savedPageSizeMode of ['measured', 'fixed', 'auto-longest']) {
    const geometry = resolveReceiptPageGeometry({ fixedHeightMm: 50, measuredHeightMm: 999, savedPageSizeMode, singleSheet: true })
    assert.equal(geometry.pageSizeMode, 'measured', `${savedPageSizeMode}: the modes that send a size keep the card's explicit 80 x 50mm page`)
  }

  const html = buildPrintablePreviewDocument({
    markup: '<section>SHOP|TOTAL|ABA</section>',
    widthMm: 72,
    pageHeightMm: 50,
    continuousRoll: false,
    singleSheet: true,
    pageSizeMode: 'driver-forms',
  })
  const pageRule = html.match(/@page\s*\{([^}]*)\}/)
  assert.ok(pageRule)
  assert.doesNotMatch(pageRule![1], /size:/, 'the print dialog paper is the page, so the card starts at its top')
  assert.match(pageRule![1], /margin:\s*0;/)
  assert.match(html, /width: 72mm !important;/, 'the card prints at the printer paper width')
  assert.match(html, /height: 50\.00mm !important;/, 'still clipped to one card')
  assert.match(html, /overflow: hidden !important/)
  assert.match(html, /break-inside: avoid-page/)
  assert.doesNotMatch(html, /data-receipt-length-line/)

  const printSource = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(printSource, /const printsOnDriverForms = printsOnPrinterPaper\(printSettings\)/,
    'driver-forms renders the card at the printer paper width too')
  assert.match(printSource, /\}, hostPrintSettings, \{ cardFromTopEdge: printsOnDriverForms && singleSheet \}\)/,
    'only the driver-forms print path drops the card top padding')
  assert.match(printSource, /else if \(cardFromTopEdge\) cloned\.style\.paddingTop = '0'/)
  assert.equal((printSource.match(/cardFromTopEdge/g) || []).length, 4,
    'declared, defaulted, used once, passed once: PDF and image never drop the card padding')
})

// Sep 23 2026: one predicate decides "prints on the printer paper" for the
// print path and for the Print Settings panel that describes it.
await runTest('printsOnPrinterPaper: in driver-forms the roll and the 80x50 card print on the printer paper; a document sheet and the other modes do not', () => {
  const production = normalizeReceiptPrintSettings({ paperSize: '80mm', marginTop: '4', marginRight: '4', marginBottom: '4', marginLeft: '4', scale: '100' })
  assert.equal(printsOnPrinterPaper(production), true, 'production settings (no saved mode) print on the printer paper')
  assert.equal(printsOnPrinterPaper(receiptRenditionPrintSettings(production, 'card')), true, 'the card prints on the same printer paper')
  for (const paperSize of ['58mm', '72mm']) {
    assert.equal(printsOnPrinterPaper({ ...production, paperSize }), true, paperSize)
  }
  for (const paperSize of ['A4', 'letter']) {
    assert.equal(printsOnPrinterPaper({ ...production, paperSize }), false, paperSize + ' keeps its own sheet')
  }
  assert.equal(printsOnPrinterPaper({ ...production, paperSize: 'custom', customHeight: '150' }), false, 'a custom sheet keeps its own size')
  for (const pageSizeMode of ['measured', 'fixed', 'driver', 'auto-longest'] as const) {
    assert.equal(printsOnPrinterPaper({ ...production, pageSizeMode }), false, pageSizeMode)
  }
  const printed = capDriverFormMargins(production)
  assert.equal(getDriverFormWidthMm(production) - Number(printed.marginLeft) - Number(printed.marginRight), 70,
    'the panel reads "Paper 72mm · content 70mm" for production, as it prints')
})

await runTest('normalizeReceiptPrintSettings: pageSizeMode/fixedPageLengthMm default and migrate existing saved settings', () => {
  // 2026-09-16 (owner report + two Chrome print-dialog photos): the default
  // changed from 'measured' to 'driver-forms' -- a page height the printer
  // driver has no matching registered form for is exactly what forced the
  // owner to pick a form by hand and left scaled-in side margins.
  assert.equal(DEFAULT_RECEIPT_PRINT_SETTINGS.pageSizeMode, 'driver-forms')
  assert.equal(DEFAULT_RECEIPT_PRINT_SETTINGS.fixedPageLengthMm, '100')
  assert.equal(DEFAULT_RECEIPT_PRINT_SETTINGS.driverFormWidthMm, '72')
  assert.ok(!('driverFormHeightsMm' in DEFAULT_RECEIPT_PRINT_SETTINGS), 'driver-forms picks no form height any more (no @page size)')

  // A settings blob saved before this feature existed (no pageSizeMode key at
  // all) -- the exact shape of the live org's settings when the owner filed
  // this report -- must migrate to 'driver-forms', not throw and not stay on
  // the old 'measured' default.
  const migrated = normalizeReceiptPrintSettings({ paperSize: '80mm', scale: '100' })
  assert.equal(migrated.pageSizeMode, 'driver-forms')
  assert.equal(migrated.fixedPageLengthMm, '100')
  assert.equal(migrated.driverFormWidthMm, '72')

  const savedFixed = normalizeReceiptPrintSettings({ paperSize: '80mm', pageSizeMode: 'fixed', fixedPageLengthMm: '150' })
  assert.equal(savedFixed.pageSizeMode, 'fixed')
  assert.equal(savedFixed.fixedPageLengthMm, '150')

  const savedMeasured = normalizeReceiptPrintSettings({ paperSize: '80mm', pageSizeMode: 'measured' })
  assert.equal(savedMeasured.pageSizeMode, 'measured', 'an explicit saved measured mode is never silently upgraded to driver-forms')

  // A corrupted/foreign value must never resolve to anything but the current default.
  const bogus = normalizeReceiptPrintSettings({ pageSizeMode: 'nonsense-mode', fixedPageLengthMm: '-40' })
  assert.equal(bogus.pageSizeMode, 'driver-forms')
  assert.equal(bogus.fixedPageLengthMm, '100')

  // driverFormWidthMm: zero/negative/non-numeric collapse to 72. A blob an
  // older client saved with the retired form-height list reads without it.
  const customForms = normalizeReceiptPrintSettings({ driverFormWidthMm: '58', driverFormHeightsMm: [400, 210, 800] })
  assert.equal(customForms.driverFormWidthMm, '58')
  assert.ok(!('driverFormHeightsMm' in customForms), 'the retired list is not carried into the normalized settings')
  const badForms = normalizeReceiptPrintSettings({ driverFormWidthMm: '-10' })
  assert.equal(badForms.driverFormWidthMm, '72')
})

if (failed > 0) process.exitCode = 1
