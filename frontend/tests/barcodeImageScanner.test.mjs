import assert from 'node:assert/strict'
import { scanBarcodeFromImageFile } from '../src/components/products/barcodeImageScanner.mjs'

let failed = 0

async function runTest(name, fn) {
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
          async decodeFromImageElement(image) {
            assert.equal(image.src, 'data:image/png;base64,abc123')
            return {
              getText() {
                return 'SKU-001'
              },
            }
          }
        },
      }),
      createImage: () => ({
        set src(value) {
          this._src = value
          queueMicrotask(() => this.onload?.())
        },
        get src() {
          return this._src
        },
      }),
    },
  )

  assert.equal(value, 'SKU-001')
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
        createImage: () => ({
          set src(value) {
            this._src = value
            queueMicrotask(() => this.onload?.())
          },
          get src() {
            return this._src
          },
        }),
      },
    ),
    /could not find a barcode/i,
  )
})

if (failed > 0) {
  process.exitCode = 1
}
