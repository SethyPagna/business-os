import assert from 'node:assert/strict'
import { compressImageFile } from '../src/utils/imageCompression.ts'

const globals = globalThis as any
const encodedTypes: string[] = []
const canvases: any[] = []
let encode: (requested: string, call: number) => Blob | null
let calls = 0
let bitmapClosed = false
globals.HTMLCanvasElement = class { toBlob() {} }
globals.createImageBitmap = async () => ({ width: 500, height: 400, close() { bitmapClosed = true } })
globals.document = { createElement: () => {
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() {}, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }),
    toBlob(callback: (blob: Blob | null) => void, requested: string) {
      encodedTypes.push(requested)
      callback(encode(requested, ++calls))
    },
  }
  canvases.push(canvas)
  return canvas
} }
function bytes(type: string) { return new Blob([new TextEncoder().encode(type)], { type }) }
async function runCase(name: string, sourceType: string, encoder: typeof encode, expectedType: string, expectedExtension: string) {
  encodedTypes.length = 0; canvases.length = 0; calls = 0; bitmapClosed = false; encode = encoder
  const file = new File([new Uint8Array(200000)], `camera.${sourceType === 'image/png' ? 'png' : 'jpg'}`, { type: sourceType })
  const result = await compressImageFile(file)
  assert.equal(result.type, expectedType, `${name}: declared MIME must match encoder output`)
  assert.ok(result.name.endsWith(expectedExtension), `${name}: extension matches actual MIME`)
  assert.equal(await result.text(), expectedType, `${name}: bytes must not be relabeled`)
  assert.ok(bitmapClosed, `${name}: bitmap released`)
  assert.ok(canvases.every(c => c.width === 0 && c.height === 0), `${name}: canvas memory released`)
  console.log(`PASS ${name}`)
}
await runCase('unsupported WebP uses real JPEG fallback', 'image/jpeg', type => bytes(type === 'image/webp' ? 'image/png' : type), 'image/jpeg', '.jpg')
await runCase('unsupported WebP keeps PNG transparency format', 'image/png', type => bytes(type === 'image/webp' ? 'image/png' : type), 'image/png', '.png')
await runCase('encoder MIME changes after capability probe', 'image/jpeg', (type, call) => bytes(call === 1 ? type : 'image/png'), 'image/png', '.png')
await runCase('supported WebP retains encoded format', 'image/jpeg', type => bytes(type), 'image/webp', '.webp')
encode = () => null; calls = 0
const original = new File([new Uint8Array(100)], 'original.jpg', { type: 'image/jpeg' })
assert.equal(await compressImageFile(original), original, 'null encodes retain exact original')
encode = () => bytes('application/octet-stream'); calls = 0
assert.equal(await compressImageFile(original), original, 'unexpected encoder format retains original instead of relabeling')
console.log('PASS null and unexpected encoders retain original bytes')
