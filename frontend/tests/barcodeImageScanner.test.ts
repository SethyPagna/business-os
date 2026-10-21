import assert from 'node:assert/strict'
import { scanBarcodeFromImageFile } from '../src/components/products/scanning/barcodeImageScanner.ts'
import { createReadConfirmer, isAcceptableBarcodeRead, rotateQuarter, runDecodeLadder } from '../src/components/products/scanning/barcodeFrameDecoder.ts'

let failed = 0

type AsyncTestCallback = () => void | Promise<void>
type TestBarcodeImageElement = {
  onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null
  onerror: ((this: GlobalEventHandlers, ev: Event) => unknown) | null
  src: string
}

function grayFrame(value: number) {
  return { data: new Uint8ClampedArray(16).fill(value), width: 4, height: 4 }
}

function createLoadedImage(): TestBarcodeImageElement {
  let currentSrc = ''
  const image: TestBarcodeImageElement = {
    onload: null,
    onerror: null,
    set src(value: string) {
      currentSrc = value
      queueMicrotask(() => image.onload?.call(globalThis as unknown as GlobalEventHandlers, new Event('load')))
    },
    get src() {
      return currentSrc
    },
  }
  return image
}

async function runTest(name: string, fn: AsyncTestCallback) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('scanBarcodeFromImageFile returns the decoded image value', async () => {
  const value = await scanBarcodeFromImageFile(
    { name: 'photo.png' },
    {
      readDataUrl: async () => 'data:image/png;base64,abc123',
      loadDecoder: async () => (frame) => {
        assert.equal(frame.data[0], 7, 'the decoder must read the pixels grabbed from the loaded photo')
        return { text: 'SKU-001', format: 'code_128' }
      },
      grabRegions: (image) => {
        assert.equal(image.src, 'data:image/png;base64,abc123')
        return { centre: () => grayFrame(7), full: () => grayFrame(7) }
      },
      createImage: createLoadedImage,
    },
  )

  assert.equal(value, 'SKU-001')
})

await runTest('scanBarcodeFromImageFile uses native BarcodeDetector before loading zxing', async () => {
  let zxingLoaded = false
  const value = await scanBarcodeFromImageFile(
    { name: 'native-photo.png' },
    {
      readDataUrl: async () => 'data:image/png;base64,native123',
      loadDecoder: async () => {
        zxingLoaded = true
        throw new Error('zxing should not load when native detector succeeds')
      },
      getNativeBarcodeDetector: () => class {
        static async getSupportedFormats() {
          return ['qr_code', 'ean_13']
        }

        async detect(image: { src: string }) {
          assert.equal(image.src, 'data:image/png;base64,native123')
          return [{ rawValue: 'NATIVE-001' }]
        }
      },
      createImage: createLoadedImage,
    },
  )

  assert.equal(value, 'NATIVE-001')
  assert.equal(zxingLoaded, false)
})

await runTest('scanBarcodeFromImageFile rejects empty image results', async () => {
  await assert.rejects(
    () => scanBarcodeFromImageFile(
      { name: 'photo.png' },
      {
        readDataUrl: async () => 'data:image/png;base64,abc123',
        loadDecoder: async () => () => null,
        grabRegions: () => ({ centre: () => grayFrame(0), full: () => grayFrame(0) }),
        createImage: createLoadedImage,
      },
    ),
    /could not find a barcode/i,
  )
})

await runTest('a native photo read skips a marketing QR and asks only for retail formats', async () => {
  let requestedFormats: string[] = []
  const value = await scanBarcodeFromImageFile(
    { name: 'box.png' },
    {
      readDataUrl: async () => 'data:image/png;base64,box',
      loadDecoder: async () => { throw new Error('zxing should not load when the native read is good') },
      getNativeBarcodeDetector: () => class {
        static async getSupportedFormats() { return ['qr_code', 'ean_13', 'data_matrix'] }
        constructor(options: { formats: string[] }) { requestedFormats = options.formats }
        async detect() {
          return [
            { rawValue: 'https://www.dior.com/x', format: 'qr_code' },
            { rawValue: '3348901729223', format: 'ean_13' },
            { rawValue: '3348901729222', format: 'ean_13' },
          ]
        }
      },
      createImage: createLoadedImage,
    },
  )
  assert.deepEqual(requestedFormats, ['ean_13'])
  assert.equal(value, '3348901729222', 'the QR and the bad check digit must both be passed over')
})

await runTest('EAN/UPC reads are accepted only with a valid check digit', () => {
  const ok = (text: string, format: string) => isAcceptableBarcodeRead({ text, format })
  assert.equal(ok('3348901729222', 'ean_13'), true)
  assert.equal(ok('3348901729223', 'ean_13'), false, 'one wrong digit must fail the checksum')
  assert.equal(ok('3348901729322', 'ean_13'), false)
  assert.equal(ok('334890172922', 'ean_13'), false, 'a short EAN-13 is not an EAN-13')
  assert.equal(ok('96385074', 'ean_8'), true)
  assert.equal(ok('96385075', 'ean_8'), false)
  assert.equal(ok('036000291452', 'upc_a'), true)
  assert.equal(ok('036000291453', 'upc_a'), false)
  assert.equal(ok('01234565', 'upc_e'), true, 'UPC-E checks against its UPC-A expansion')
  assert.equal(ok('01234566', 'upc_e'), false)
  assert.equal(ok('SKU-001', 'code_128'), true)
  assert.equal(ok('', 'code_128'), false)
  assert.equal(ok('33489O1729222', 'ean_13'), false)
  assert.equal(ok('https://www.dior.com/x', 'qr_code'), false, 'a QR is not a retail product code')
})

await runTest('a live ZXing read wins only when the next read agrees; a native read wins alone', () => {
  const confirm = createReadConfirmer()
  const good = { text: '3348901729222', format: 'ean_13' }
  assert.equal(confirm(good, 'zxing'), null, 'one ZXing read is not enough')
  assert.equal(confirm(null, 'zxing'), null)
  assert.equal(confirm(good, 'zxing'), '3348901729222', 'misses between two agreeing reads do not reset them')

  const swap = createReadConfirmer()
  assert.equal(swap({ text: '5901234123457', format: 'ean_13' }, 'zxing'), null)
  assert.equal(swap(good, 'zxing'), null, 'a different value replaces the candidate instead of winning')
  assert.equal(swap(good, 'zxing'), '3348901729222')

  const bad = createReadConfirmer()
  assert.equal(bad({ text: '3348901729223', format: 'ean_13' }, 'zxing'), null)
  assert.equal(bad({ text: '3348901729223', format: 'ean_13' }, 'zxing'), null, 'agreeing on a bad check digit is still a bad read')
  assert.equal(createReadConfirmer()(good, 'native'), '3348901729222')
  assert.equal(createReadConfirmer()({ text: '3348901729223', format: 'ean_13' }, 'native'), null)
})

await runTest('the live ladder stops at its time budget and the next frame resumes where it stopped', () => {
  const seen: string[] = []
  const decode = (frame: { width: number; height: number }, tryHarder: boolean) => {
    seen.push(`${frame.width}x${frame.height}${tryHarder ? '!' : ''}`)
    return null
  }
  const regions = {
    centre: () => ({ data: new Uint8ClampedArray(6 * 4).fill(90), width: 6, height: 4 }),
    full: () => ({ data: new Uint8ClampedArray(10 * 8).fill(90), width: 10, height: 8 }),
  }
  let clock = 0
  const first = runDecodeLadder(regions, decode, { deadline: 5, now: () => { clock += 10; return clock } })
  assert.equal(first.attempts, 1, 'past the deadline only the first step runs')
  assert.equal(first.nextStep, 1)
  const rest = runDecodeLadder(regions, decode, { startStep: first.nextStep })
  assert.equal(rest.attempts, 8, 'with no deadline the resumed run covers one full cycle')
  assert.deepEqual(seen, ['6x4', '4x6', '6x4', '4x6', '10x8', '8x10', '10x8', '8x10', '6x4'], 'centre then full; each upright then turned; wraps to the start')
  seen.length = 0
  runDecodeLadder(regions, decode, { tryHarder: true })
  assert.deepEqual(seen.slice(8), ['6x4!', '4x6!', '10x8!', '8x10!'], 'TRY_HARDER only after the whole fast tier, and only when asked')
})

await runTest('a quarter turn moves the left column to the top row', () => {
  const turned = rotateQuarter({ data: Uint8ClampedArray.from([1, 2, 3, 4, 5, 6]), width: 3, height: 2 })
  assert.equal(turned.width, 2)
  assert.equal(turned.height, 3)
  assert.deepEqual([...turned.data], [4, 1, 5, 2, 6, 3])
})

if (failed > 0) {
  process.exitCode = 1
}
