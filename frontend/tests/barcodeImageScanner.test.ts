import assert from 'node:assert/strict'
import { scanBarcodeFromImageFile, type PhotoImage } from '../src/components/products/scanning/barcodeImageScanner.ts'
import { createReadConfirmer, isAcceptableBarcodeRead, type PixelFrame } from '../src/components/products/scanning/barcodeFrameDecoder.ts'
import { rotateQuarter, runDecodeLadder } from '../src/components/products/scanning/barcodeLadder.ts'
import type { DecodeClient, DecodeFrames } from '../src/components/products/scanning/decodeWorkerClient.ts'

let failed = 0

type AsyncTestCallback = () => void | Promise<void>

function pixelFrame(value: number): PixelFrame {
  return { data: new Uint8ClampedArray(16).fill(value), width: 2, height: 2 }
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

// A decoded photo and the worker, both recording what happens to them.
function fakePhoto() {
  const source = { name: 'decoded photo' } as unknown as PhotoImage['source']
  const photo = { released: 0 }
  const image: PhotoImage = { source, width: 40, height: 30, release: () => { photo.released += 1 } }
  return { source, photo, openImage: async () => image }
}

function fakeClient(decode: (frames: DecodeFrames, tryHarder: boolean) => Promise<{ text: string; format: string } | null>, ready: Promise<void> = Promise.resolve()) {
  const record = { decodes: 0, terminated: 0 }
  ready.catch(() => {})
  const client: DecodeClient = {
    ready,
    isReady: true,
    busy: false,
    broken: null,
    decode: (frames, tryHarder) => { record.decodes += 1; return decode(frames, tryHarder) },
    terminate: () => { record.terminated += 1 },
  }
  return { record, acquireClient: () => client }
}

const noNative = { getNativeBarcodeDetector: () => null }
const grabRegions = () => ({ centre: () => pixelFrame(7), full: () => pixelFrame(9) })

await runTest('scanBarcodeFromImageFile hands the photo to the worker with TRY_HARDER and returns what it decodes', async () => {
  const { photo, openImage } = fakePhoto()
  const { record, acquireClient } = fakeClient(async (frames, tryHarder) => {
    assert.equal(tryHarder, true, 'a photo gets the whole ladder, TRY_HARDER included')
    assert.equal(frames.centre.data[0], 7, 'the worker must get the pixels grabbed from the decoded photo')
    assert.equal(frames.full?.data[0], 9, 'and the whole picture beside the centre')
    return { text: 'SKU-001', format: 'code_128' }
  })
  const value = await scanBarcodeFromImageFile({ name: 'photo.png' }, { ...noNative, openImage, grabRegions, acquireClient })

  assert.equal(value, 'SKU-001')
  assert.equal(record.decodes, 1)
  assert.equal(record.terminated, 1, 'the worker is stopped when the photo is read')
  assert.equal(photo.released, 1, 'the decoded photo is released')
})

await runTest('scanBarcodeFromImageFile uses native BarcodeDetector on the decoded photo before starting a worker', async () => {
  const { source, photo, openImage } = fakePhoto()
  let workerStarted = false
  const value = await scanBarcodeFromImageFile(
    { name: 'native-photo.png' },
    {
      openImage,
      acquireClient: () => { workerStarted = true; throw new Error('the worker should not start when the native detector succeeds') },
      getNativeBarcodeDetector: () => class {
        static async getSupportedFormats() {
          return ['qr_code', 'ean_13']
        }

        async detect(image: unknown) {
          assert.equal(image, source, 'the detector reads the decoded photo itself, not a data URL')
          return [{ rawValue: 'NATIVE-001' }]
        }
      },
    },
  )

  assert.equal(value, 'NATIVE-001')
  assert.equal(workerStarted, false)
  assert.equal(photo.released, 1)
})

await runTest('scanBarcodeFromImageFile rejects a photo the worker finds nothing in, and still stops it', async () => {
  const { photo, openImage } = fakePhoto()
  const { record, acquireClient } = fakeClient(async () => null)
  await assert.rejects(
    () => scanBarcodeFromImageFile({ name: 'photo.png' }, { ...noNative, openImage, grabRegions, acquireClient }),
    /could not find a barcode/i,
  )
  assert.equal(record.terminated, 1)
  assert.equal(photo.released, 1)
})

await runTest('a worker that cannot start fails the scan with its own message, and the photo is still released', async () => {
  const { photo, openImage } = fakePhoto()
  const { record, acquireClient } = fakeClient(async () => null, Promise.reject(new Error('decoder failed to start')))
  await assert.rejects(
    () => scanBarcodeFromImageFile({ name: 'photo.png' }, { ...noNative, openImage, grabRegions, acquireClient }),
    /decoder failed to start/,
  )
  assert.equal(record.decodes, 0, 'nothing is sent to a worker that never became ready')
  assert.equal(record.terminated, 1)
  assert.equal(photo.released, 1)
})

await runTest('a native photo read skips a marketing QR and asks only for retail formats', async () => {
  let requestedFormats: string[] = []
  const { openImage } = fakePhoto()
  const value = await scanBarcodeFromImageFile(
    { name: 'box.png' },
    {
      openImage,
      acquireClient: () => { throw new Error('the worker should not start when the native read is good') },
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
    },
  )
  assert.deepEqual(requestedFormats, ['ean_13'])
  assert.equal(value, '3348901729222', 'the QR and the bad check digit must both be passed over')
})

await runTest('a native detector that reads none of our formats is never built: the worker reads the photo', async () => {
  const { openImage } = fakePhoto()
  let constructed = 0
  const { record, acquireClient } = fakeClient(async () => ({ text: '3348901729222', format: 'ean_13' }))
  const value = await scanBarcodeFromImageFile(
    { name: 'qr-only.png' },
    {
      openImage,
      grabRegions,
      acquireClient,
      getNativeBarcodeDetector: () => class {
        static async getSupportedFormats() { return ['qr_code'] }
        constructor() { constructed += 1 }
        async detect(): Promise<unknown[]> { return [] }
      },
    },
  )
  assert.equal(value, '3348901729222')
  assert.equal(constructed, 0, 'a detector with no retail format must not be built with the retail list anyway')
  assert.equal(record.decodes, 1)
})

await runTest('a native detector that throws is logged and the worker still reads the photo', async () => {
  const { openImage } = fakePhoto()
  const { acquireClient } = fakeClient(async () => ({ text: 'SKU-001', format: 'code_128' }))
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => { logged.push(args) }
  try {
    const value = await scanBarcodeFromImageFile({ name: 'photo.png' }, {
      openImage,
      grabRegions,
      acquireClient,
      getNativeBarcodeDetector: () => class {
        static async getSupportedFormats() { return ['ean_13'] }
        async detect(): Promise<unknown[]> { throw new Error('detector service down') }
      },
    })
    assert.equal(value, 'SKU-001')
  } finally {
    console.error = original
  }
  assert.equal(logged.length, 1, 'the native failure is reported, not swallowed')
  assert.match(String(logged[0][0]), /native detector could not read the photo/)
})

await runTest('the default photo open is createImageBitmap(file): no data URL, and the bitmap is closed', async () => {
  const file = { name: 'photo.webp' }
  const bitmap = { width: 64, height: 48, closed: 0, close() { this.closed += 1 } }
  const opened: unknown[] = []
  const globals = globalThis as unknown as { createImageBitmap?: unknown }
  const original = globals.createImageBitmap
  globals.createImageBitmap = async (input: unknown) => { opened.push(input); return bitmap }
  try {
    const { acquireClient } = fakeClient(async () => ({ text: 'SKU-001', format: 'code_128' }))
    const value = await scanBarcodeFromImageFile(file, {
      ...noNative,
      grabRegions: (source, width, height) => {
        assert.equal(source as unknown, bitmap, 'the grabber reads the bitmap')
        assert.deepEqual([width, height], [64, 48])
        return grabRegions()
      },
      acquireClient,
    })
    assert.equal(value, 'SKU-001')
  } finally {
    globals.createImageBitmap = original
  }
  assert.deepEqual(opened, [file])
  assert.equal(bitmap.closed, 1)
})

await runTest('when createImageBitmap rejects the photo, the DOM image decoder reads it from an object URL that is then revoked', async () => {
  const globals = globalThis as unknown as { createImageBitmap?: unknown; Image?: unknown }
  const originalBitmap = globals.createImageBitmap
  const originalImage = globals.Image
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const urls = { created: [] as unknown[], revoked: [] as string[] }
  globals.createImageBitmap = async () => { throw new Error('HEIC not supported') }
  class FakeImage {
    naturalWidth = 80
    naturalHeight = 60
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  }
  globals.Image = FakeImage
  URL.createObjectURL = (blob) => { urls.created.push(blob); return 'blob:photo' }
  URL.revokeObjectURL = (url) => { urls.revoked.push(url) }
  try {
    const { acquireClient } = fakeClient(async () => ({ text: 'SKU-001', format: 'code_128' }))
    const file = new Blob(['x'])
    const value = await scanBarcodeFromImageFile(file, {
      ...noNative,
      grabRegions: (source, width, height) => {
        assert.ok(source instanceof FakeImage)
        assert.deepEqual([width, height], [80, 60])
        return grabRegions()
      },
      acquireClient,
    })
    assert.equal(value, 'SKU-001')
    assert.deepEqual(urls.created, [file])
    assert.deepEqual(urls.revoked, ['blob:photo'])
  } finally {
    globals.createImageBitmap = originalBitmap
    globals.Image = originalImage
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
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

await runTest('a frame sent without the whole picture skips the steps that need it', () => {
  const seen: string[] = []
  const decode = (frame: { width: number; height: number }) => {
    seen.push(`${frame.width}x${frame.height}`)
    return null
  }
  const guideOnly = { centre: () => ({ data: new Uint8ClampedArray(6 * 4).fill(90), width: 6, height: 4 }) }
  const { attempts } = runDecodeLadder(guideOnly, decode)
  assert.equal(attempts, 4, 'only the four guide-area steps run')
  assert.deepEqual(seen, ['6x4', '4x6', '6x4', '4x6'])
  seen.length = 0
  runDecodeLadder(guideOnly, decode, { tryHarder: true })
  assert.deepEqual(seen.slice(4), ['6x4', '4x6'], 'the TRY_HARDER guide steps still run; the full-picture ones do not')
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
