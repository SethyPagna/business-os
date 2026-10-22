// Scanner S1a (6.0.922): which engine runs, which native result wins, and what
// counts as a real read.
//
// Before: a native BarcodeDetector that listed no retail formats (QR only, or
// nothing) was still built "with the retail list anyway", then given 1.5 s of
// empty frames before ZXing joined; the loop took the FIRST native result, so a
// second code on the box could win over the one in the guide; and a 2-character
// Code 128 "read" (noise forming a start/stop pattern) was accepted.
import assert from 'node:assert/strict'
import {
  NATIVE_ONLY_MS,
  NATIVE_TICK_INTERVAL_MS,
  RETAIL_BARCODE_FORMATS,
  isAcceptableBarcodeRead,
  pickNativeRead,
  planNativeFormats,
  zxingHeadStartOver,
} from '../src/components/products/scanning/barcodeFrameDecoder.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('a native detector that lists no retail format is skipped: ZXing starts at once', () => {
  assert.deepEqual(planNativeFormats([]), [], 'an empty list means the detector reads nothing of ours')
  assert.deepEqual(planNativeFormats(['qr_code']), [], 'QR only is not a retail format')
  assert.deepEqual(planNativeFormats(['qr_code', 'data_matrix', 'pdf417', 'aztec']), [])
  assert.deepEqual(planNativeFormats([null, undefined, 5, '']), [], 'junk entries are not formats')
})

runTest('a native detector that lists retail formats is asked for exactly those', () => {
  assert.deepEqual(planNativeFormats(['qr_code', 'ean_13', 'data_matrix', 'code_128']), ['ean_13', 'code_128'])
  assert.deepEqual(planNativeFormats([...RETAIL_BARCODE_FORMATS, 'qr_code']), RETAIL_BARCODE_FORMATS)
})

runTest('a detector that cannot list its formats is assumed to read the retail ones, as before', () => {
  const plan = planNativeFormats(null)
  assert.deepEqual(plan, RETAIL_BARCODE_FORMATS)
  assert.notEqual(plan, RETAIL_BARCODE_FORMATS, 'a copy, so a caller cannot mutate the shared list')
})

const IN_GUIDE = { x: 400, y: 300, width: 200, height: 100 }
const GUIDE = { x: 100, y: 200, width: 800, height: 400 }
const OUTSIDE_BOX = { x: 0, y: 0, width: 60, height: 40 }
const EAN_A = '3348901729222'
const EAN_B = '4006381333931'

runTest('a code inside the guide beats the first code the detector listed', () => {
  const read = pickNativeRead([
    { rawValue: EAN_A, format: 'ean_13', boundingBox: OUTSIDE_BOX },
    { rawValue: EAN_B, format: 'ean_13', boundingBox: IN_GUIDE },
  ], GUIDE)
  assert.deepEqual(read, { text: EAN_B, format: 'ean_13' })
})

runTest('a code only outside the guide still reads, so a framing slip does not lose a good scan', () => {
  assert.deepEqual(
    pickNativeRead([{ rawValue: EAN_A, format: 'ean_13', boundingBox: OUTSIDE_BOX }], GUIDE),
    { text: EAN_A, format: 'ean_13' },
  )
})

runTest('only the box CENTRE counts: a box that overlaps the guide edge but centres outside is outside', () => {
  const straddling = { x: 40, y: 300, width: 100, height: 100 } // centre x = 90 < guide.x
  const read = pickNativeRead([
    { rawValue: EAN_A, format: 'ean_13', boundingBox: straddling },
    { rawValue: EAN_B, format: 'ean_13', boundingBox: IN_GUIDE },
  ], GUIDE)
  assert.equal(read?.text, EAN_B)
})

runTest('results with no box (older detectors) keep the old first-acceptable order', () => {
  const read = pickNativeRead([
    { rawValue: EAN_A, format: 'ean_13' },
    { rawValue: EAN_B, format: 'ean_13', boundingBox: null },
  ], GUIDE)
  assert.equal(read?.text, EAN_A)
})

runTest('an unacceptable result inside the guide (bad check digit, marketing QR) never beats a good one outside', () => {
  const read = pickNativeRead([
    { rawValue: '3348901729223', format: 'ean_13', boundingBox: IN_GUIDE },
    { rawValue: 'https://example.com', format: 'qr_code', boundingBox: IN_GUIDE },
    { rawValue: EAN_B, format: 'ean_13', boundingBox: OUTSIDE_BOX },
  ], GUIDE)
  assert.equal(read?.text, EAN_B)
  assert.equal(pickNativeRead([], GUIDE), null)
  assert.equal(pickNativeRead([{ rawValue: '', format: 'ean_13', boundingBox: IN_GUIDE }], GUIDE), null)
})

runTest('the code is returned exactly as read: no leading-zero or UPC folding in the scanner', () => {
  assert.equal(pickNativeRead([{ rawValue: '036000291452', format: 'upc_a', boundingBox: IN_GUIDE }], GUIDE)?.text, '036000291452')
  assert.equal(pickNativeRead([{ rawValue: '0036000291452', format: 'ean_13', boundingBox: IN_GUIDE }], GUIDE)?.text, '0036000291452')
})

runTest('Code 128, Code 39 and ITF reads shorter than 4 characters are noise', () => {
  assert.equal(isAcceptableBarcodeRead({ text: '12', format: 'code_128' }), false)
  assert.equal(isAcceptableBarcodeRead({ text: 'AB', format: 'code_39' }), false)
  assert.equal(isAcceptableBarcodeRead({ text: '123', format: 'itf' }), false)
  assert.equal(isAcceptableBarcodeRead({ text: '1234', format: 'code_128' }), true)
  assert.equal(isAcceptableBarcodeRead({ text: 'SKU-001', format: 'code_39' }), true)
  assert.equal(isAcceptableBarcodeRead({ text: '12345678', format: 'itf' }), true)
  assert.equal(isAcceptableBarcodeRead({ text: ' 12 ', format: 'code_128' }), false, 'length is measured after trimming')
})

runTest('the length floor leaves every other format and the checksum rules alone', () => {
  assert.equal(isAcceptableBarcodeRead({ text: EAN_A, format: 'ean_13' }), true)
  assert.equal(isAcceptableBarcodeRead({ text: '3348901729223', format: 'ean_13' }), false, 'a bad check digit still loses')
  assert.equal(isAcceptableBarcodeRead({ text: '96385074', format: 'ean_8' }), true)
  assert.equal(isAcceptableBarcodeRead({ text: 'ABC', format: 'qr_code' }), false, 'a non-retail native format is still refused')
  assert.equal(isAcceptableBarcodeRead({ text: 'NATIVE-001', format: '' }), true, 'a read that names no format is accepted as before')
})

runTest('ZXing joins after a fixed 1,000 ms head start at a 120 ms native cadence', () => {
  assert.equal(NATIVE_ONLY_MS, 1000)
  assert.equal(NATIVE_TICK_INTERVAL_MS, 120)
  assert.equal(zxingHeadStartOver(5000, 5000 + 999), false)
  assert.equal(zxingHeadStartOver(5000, 5000 + 1000), true)
  assert.equal(zxingHeadStartOver(5000, 5000 + 1001), true)
  // The old rule was "6 empty frames", which at 120 ms would have been 720 ms.
  assert.equal(zxingHeadStartOver(0, 6 * NATIVE_TICK_INTERVAL_MS), false, 'the head start is a time, not a frame count')
})

if (failed > 0) process.exitCode = 1
