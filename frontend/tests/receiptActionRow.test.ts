import assert from 'node:assert/strict'
import fs from 'node:fs'

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

// N9(b) + N4 (owner, Sep 6 2026): "receipt action row order mirrored (Back on
// the left, Print/Image on the right; drop Open PDF)". Receipt.tsx owns the ONE
// action row every receipt render site shows -- POS after-sale, the Sales sale
// detail, and reprint from the Sales list all mount this component.
const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
const posSource = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const salesSource = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
const enPack = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const kmPack = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

await runTest('every receipt render site funnels through the one Receipt action row', () => {
  // If a second receipt toolbar is ever added, this list must grow with it --
  // the mirrored order and the dropped action are not allowed to diverge.
  assert.match(posSource, /import\('\.\.\/receipt\/Receipt'\)/, 'POS after-sale mounts the shared Receipt')
  assert.match(salesSource, /import\('\.\.\/receipt\/Receipt'\)/, 'the Sales detail / reprint mounts the shared Receipt')
  assert.match(posSource, /<Receipt\b/)
  assert.match(salesSource, /<Receipt\b/)
})

await runTest('no receipt action row still renders Open PDF', () => {
  assert.doesNotMatch(receiptSource, /open_pdf/, 'the Open PDF label must be gone from the receipt toolbar')
  assert.doesNotMatch(receiptSource, /openReceiptPdf/, 'the Open PDF action must be gone, not just its label')
  assert.doesNotMatch(receiptSource, /exportReceiptPdf\('open'/)
  assert.doesNotMatch(receiptSource, /exportBothSeparately\('open'\)/)
  assert.match(receiptSource, /type ReceiptExportMode = 'print' \| 'image'/,
    "the 'open' export mode must be retired, not left as an unreachable branch")
})

await runTest('the retired open_pdf key is gone from BOTH language packs', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(enPack, 'open_pdf'), false, 'en.json still carries open_pdf')
  assert.equal(Object.prototype.hasOwnProperty.call(kmPack, 'open_pdf'), false, 'km.json still carries open_pdf')
  // The settings Test Print keeps its own, differently-named action.
  assert.ok(enPack.open_test_pdf, 'Receipt Settings > Test Print keeps Open Test PDF')
  assert.ok(kmPack.open_test_pdf)
})

await runTest('the action row is mirrored: Back on the left, Print and Image on the right', () => {
  const backIdx = receiptSource.indexOf('onClick={onClose}')
  const printIdx = receiptSource.indexOf('<Printer className="h-4 w-4 shrink-0" />')
  const imageIdx = receiptSource.indexOf('<ImageDown className="h-4 w-4 shrink-0" />')
  assert.ok(backIdx > 0, 'the Back button must exist')
  assert.ok(printIdx > 0, 'the Print action must exist')
  assert.ok(imageIdx > 0, 'the Image action must exist')
  assert.ok(backIdx < printIdx, 'Back must precede Print in the toolbar')
  assert.ok(printIdx < imageIdx, 'Print must precede Image on the right side')
  assert.match(receiptSource, /className="ml-auto flex min-w-0 items-center justify-end gap-1\.5 sm:gap-2"/,
    'the export actions must be pushed to the right edge of the row')
})

await runTest('the row cannot overflow on small screens', () => {
  const toolbarStart = receiptSource.indexOf('flex flex-shrink-0 items-center gap-1.5 overflow-x-auto')
  assert.ok(toolbarStart > 0, 'the toolbar keeps its single-row, scroll-safe container')
  const toolbar = receiptSource.slice(toolbarStart, receiptSource.indexOf('<div className="flex flex-1 justify-center overflow-auto p-4">'))
  assert.ok(toolbar.length > 0)
  // Every action label collapses below sm; the icon and the 40px-class
  // btn-primary/btn-secondary hit target stay.
  const labels = toolbar.match(/<span className="[^"]*truncate[^"]*">/g) || []
  assert.ok(labels.length >= 3, `expected the Print/Image/Back labels, found ${labels.length}`)
  labels.forEach((label) => {
    assert.match(label, /hidden [^"]*sm:inline/, `a toolbar label stays visible below sm: ${label}`)
  })
  assert.doesNotMatch(toolbar, /\bpx-4\b/, 'no oversized padding may widen the row below sm')
})

if (failed > 0) {
  process.exitCode = 1
}
