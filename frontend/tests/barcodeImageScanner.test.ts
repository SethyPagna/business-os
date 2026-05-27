import assert from 'node:assert/strict'
import { scanBarcodeFromImageFile } from '../src/components/products/scanning/barcodeImageScanner.ts'

let failed = 0

type AsyncTestCallback = () => Promise<void>
type TestBarcodeImageElement = {
  onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null
  onerror: ((this: GlobalEventHandlers, ev: Event) => unknown) | null
  src: string
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
      loadZxingModule: async () => ({
        BrowserMultiFormatReader: class {
          async decodeFromImageElement(image: { src: string }) {
            assert.equal(image.src, 'data:image/png;base64,abc123')
            return {
              getText() {
                return 'SKU-001'
              },
            }
          }
        },
      }),
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
      loadZxingModule: async () => {
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
        loadZxingModule: async () => ({
          BrowserMultiFormatReader: class {
            async decodeFromImageElement() {
              return {
                getText() {
                  return ''
                },
              }
            }
          },
        }),
        createImage: createLoadedImage,
      },
    ),
    /could not find a barcode/i,
  )
})

if (failed > 0) {
  process.exitCode = 1
}
