import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildSingleImagePdf } from '../src/utils/printReceipt.ts'
import { computeImagePageSegments } from '../src/utils/receiptPdfLayout.ts'

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

await runTest('continuous 80mm PDF remains one exact content-height roll page', () => {
  const text = pdfText(buildSingleImagePdf({
    imageBytes: fakeJpeg,
    imageWidthPx: 800,
    imageHeightPx: 2400,
    pageWidthPt: mmToPt(80),
  }))
  assert.equal(pageCount(text), 1)
  assert.equal(mediaBoxes(text)[0], '0 0 226.77 680.31')
  const [[width, height, x, y]] = drawMatrices(text)
  assert.equal(width.toFixed(2), mmToPt(80).toFixed(2))
  assert.equal(height.toFixed(2), '680.31')
  assert.equal(x, 0)
  assert.equal(y, 0)
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
})

await runTest('direct continuous print delegates page length to the driver while retaining receipt width', () => {
  const source = fs.readFileSync(new URL('../src/utils/printReceipt.ts', import.meta.url), 'utf8')
  assert.match(source, /const pageSizeCss = continuousRoll \? 'auto'/)
  assert.match(source, /const documentHeightCss = clipToOnePage[\s\S]*height: auto !important;[\s\S]*min-height: 0 !important;/)
  assert.match(source, /width: \$\{widthMm\}mm !important;/,
    'the receipt content remains at its configured 58/72/80 mm width')
  assert.doesNotMatch(source, /\.slice\(0, 260\)/,
    'the text fallback must not silently discard late receipt items or totals')
})

if (failed > 0) process.exitCode = 1
