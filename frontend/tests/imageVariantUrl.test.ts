import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  computeVariantDimensions,
  hasImageVariant,
  imageVariantSrcSet,
  storedUploadName,
  THUMBNAIL_VARIANT_WIDTH,
  toImageVariantPath,
} from '../src/utils/imageVariantUrl.ts'
import { appendImageThumbnails, createImageThumbnails, thumbnailFieldName } from '../src/utils/imageCompression.ts'

// Image variants: the URL a thumbnail asks for, the thumbnails the browser
// makes at upload time, and the components / transports that use them.
// Every case is one the plausible wrong implementation fails.

async function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn()
  console.log('PASS', name)
}

await runCase('a plain upload path maps to the w320 variant path', () => {
  assert.equal(toImageVariantPath('/uploads/shirt-1758844800000-ab12cd34.jpg'), '/uploads/_v/w320/shirt-1758844800000-ab12cd34.jpg')
  assert.equal(toImageVariantPath('/uploads/shirt-1-aa.png', 640), '/uploads/_v/w640/shirt-1-aa.png')
  assert.equal(THUMBNAIL_VARIANT_WIDTH, 320)
})

await runCase('a bare uploads/ path and a ?v= cache-buster are normalised, never copied into the variant URL', () => {
  assert.equal(toImageVariantPath('uploads/a-1-bb.webp'), '/uploads/_v/w320/a-1-bb.webp')
  assert.equal(toImageVariantPath('/uploads/a-1-bb.webp?v=3'), '/uploads/_v/w320/a-1-bb.webp')
  assert.equal(toImageVariantPath('/uploads/a-1-bb.webp#x'), '/uploads/_v/w320/a-1-bb.webp')
})

await runCase('names with spaces or Khmer keep their raw form (the browser encodes them exactly as for the original)', () => {
  assert.equal(toImageVariantPath('/uploads/Nivea Cream 100ml-1758844800000-ab12cd34.jpg'), '/uploads/_v/w320/Nivea Cream 100ml-1758844800000-ab12cd34.jpg')
  assert.equal(toImageVariantPath('/uploads/ក្រែម-1758844800000-ab12cd34.jpg'), '/uploads/_v/w320/ក្រែម-1758844800000-ab12cd34.jpg')
})

await runCase('values that are not a plain stored image keep the original URL (null)', () => {
  for (const value of [
    '', null, undefined, 'https://cdn.example/uploads/a.jpg', 'http://x/uploads/a.jpg', 'data:image/png;base64,AAAA', 'blob:https://x/1',
    '/uploads/_v/w320/a-1.jpg', '/uploads/_v-a.jpg', '/uploads/a/b.jpg', '/uploads/..', '/uploads/.', '/uploads/',
    '/uploads/anim-1-aa.gif', '/uploads/clip-1-aa.mp4', '/uploads/doc.pdf', '/uploads/noext', '/uploads/file.bin', '/uploads/.jpg',
    '/uploads/percent%20name-1.jpg', '/uploads/back\\slash.jpg', '/elsewhere/a.jpg', 'a.jpg',
  ]) {
    assert.equal(toImageVariantPath(value as string), null, String(value))
  }
  assert.equal(storedUploadName('/uploads/a-1.jpg'), 'a-1.jpg')
  assert.equal(storedUploadName('https://x/uploads/a-1.jpg'), null)
})

await runCase('hasImageVariant refuses a name longer than the Worker accepts', () => {
  assert.equal(hasImageVariant(`${'a'.repeat(252)}.jpg`), false)
  assert.equal(hasImageVariant(`${'a'.repeat(251)}.jpg`), true)
})

await runCase('srcset lists both widths through the caller\'s resolver, or is empty when there is no variant', () => {
  const resolve = (path: string) => `https://shop.example${path}`
  assert.equal(
    imageVariantSrcSet('/uploads/a-1.jpg', resolve),
    'https://shop.example/uploads/_v/w320/a-1.jpg 320w, https://shop.example/uploads/_v/w640/a-1.jpg 640w',
  )
  assert.equal(imageVariantSrcSet('https://cdn.example/a.jpg', resolve), '')
  assert.equal(imageVariantSrcSet('/uploads/anim.gif', resolve), '')
})

await runCase('computeVariantDimensions scales by WIDTH and never enlarges (the Worker\'s fit: scale-down)', () => {
  assert.deepEqual(computeVariantDimensions(2560, 1920, 320), { width: 320, height: 240 })
  assert.deepEqual(computeVariantDimensions(1000, 2000, 320), { width: 320, height: 640 })
  assert.deepEqual(computeVariantDimensions(200, 100, 320), { width: 200, height: 100 })
  assert.deepEqual(computeVariantDimensions(320, 320, 320), { width: 320, height: 320 })
  assert.deepEqual(computeVariantDimensions(0, 0, 320), { width: 1, height: 1 })
  assert.deepEqual(computeVariantDimensions(Number.NaN, 5, 320), { width: 1, height: 1 })
})

// ---------------------------------------------------- createImageThumbnails
// A fake DOM: a canvas that records its size and encodes to a blob of the type
// the test asks for (a browser without WebP encoding answers image/png).
type Canvas = { width: number; height: number; getContext: () => unknown; toBlob: (cb: (blob: Blob | null) => void, type: string, quality?: number) => void }
const made: Canvas[] = []
let encodeAs: string | null = 'webp'
let decodeSize = { width: 4000, height: 3000 }
let decodeFails = false
const globals = globalThis as Record<string, unknown>
const saved = { document: globals.document, HTMLCanvasElement: globals.HTMLCanvasElement, createImageBitmap: globals.createImageBitmap }
globals.HTMLCanvasElement = class { toBlob() {} }
globals.document = {
  createElement: () => {
    const canvas: Canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob: (cb, type) => cb(encodeAs === null ? null : new Blob([new Uint8Array(1000)], { type: encodeAs === 'webp' ? type : encodeAs })),
    }
    made.push(canvas)
    return canvas
  },
}
globals.createImageBitmap = async () => {
  if (decodeFails) throw new Error('cannot decode')
  return { ...decodeSize, close() {} }
}
const photo = new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' })

await runCase('createImageThumbnails makes a 320 and a 640 WebP, scaled by width, and releases every canvas', async () => {
  made.length = 0
  encodeAs = 'webp'
  decodeSize = { width: 2560, height: 1920 }
  const thumbnails = await createImageThumbnails(photo)
  assert.deepEqual(thumbnails.map((t) => t.width), [320, 640])
  assert.ok(thumbnails.every((t) => t.blob.type === 'image/webp'))
  assert.ok(made.every((c) => c.width === 0 && c.height === 0), 'every canvas backing store is released')
})

await runCase('a source narrower than a width is not enlarged (w640 of a 400 px photo stays 400 px)', async () => {
  made.length = 0
  encodeAs = 'webp'
  decodeSize = { width: 400, height: 400 }
  const sizes: Array<[number, number]> = []
  const original = (globals.document as { createElement: () => Canvas }).createElement
  ;(globals.document as { createElement: () => Canvas }).createElement = () => {
    const canvas = original()
    const toBlob = canvas.toBlob
    canvas.toBlob = (cb, type, quality) => { sizes.push([canvas.width, canvas.height]); toBlob(cb, type, quality) }
    return canvas
  }
  const thumbnails = await createImageThumbnails(photo)
  ;(globals.document as { createElement: () => Canvas }).createElement = original
  assert.deepEqual(sizes, [[320, 320], [400, 400]], 'w320 is scaled down, w640 stays at the source size')
  assert.equal(thumbnails.length, 2)
})

await runCase('a browser that answers toBlob(webp) with a PNG yields NO thumbnails (the Worker would refuse them anyway)', async () => {
  encodeAs = 'image/png'
  decodeSize = { width: 2560, height: 1920 }
  assert.deepEqual(await createImageThumbnails(photo), [])
})

await runCase('an encode failure or a decode failure yields [] and never throws', async () => {
  encodeAs = null
  decodeFails = false
  assert.deepEqual(await createImageThumbnails(photo), [])
  encodeAs = 'webp'
  decodeFails = true
  const loadFailure = await createImageThumbnails(photo).catch(() => 'threw')
  assert.notEqual(loadFailure, 'threw')
  decodeFails = false
})

await runCase('GIF, video and non-image files get no thumbnails', async () => {
  encodeAs = 'webp'
  for (const file of [new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' }), new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' }), new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' })]) {
    assert.deepEqual(await createImageThumbnails(file), [], file.name)
  }
})

await runCase('no Canvas support yields [] (Node, workers, old browsers)', async () => {
  const keep = globals.document
  globals.document = undefined
  assert.deepEqual(await createImageThumbnails(photo), [])
  globals.document = keep
})

globals.document = saved.document
globals.HTMLCanvasElement = saved.HTMLCanvasElement
globals.createImageBitmap = saved.createImageBitmap

await runCase('appendImageThumbnails uses the fields the Worker reads (variant_w320 / variant_w640)', () => {
  const form = new FormData()
  appendImageThumbnails(form, [{ width: 320, blob: new Blob(['a'], { type: 'image/webp' }) }, { width: 640, blob: new Blob(['b'], { type: 'image/webp' }) }])
  assert.deepEqual((form as unknown as { keys(): Iterable<string> }).keys ? [...(form as unknown as { keys(): Iterable<string> }).keys()] : [], ['variant_w320', 'variant_w640'])
  assert.equal(thumbnailFieldName(320), 'variant_w320')
  const worker = fs.readFileSync(new URL('../../cloudflare/src/lib/imageVariantStore.ts', import.meta.url), 'utf8')
  assert.match(worker, /return `variant_w\$\{width\}`/, 'the Worker reads the same field names')
})

// ----------------------------------------------------------- source shape
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

await runCase('POS and Products thumbnails request the variant, without the build stamp, and fall back to the original once', () => {
  for (const file of ['../src/components/pos/ProductImage.tsx', '../src/components/products/shared/primitives.tsx']) {
    const source = read(file)
    assert.match(source, /toImageVariantPath\(safeSrc\)/, file)
    assert.match(source, /resolvePublicAssetUrl\(variantPath, \{ unversioned: true \}\)/, `${file}: variant URL must not carry ?v=<build>`)
    assert.match(source, /if \(variantPath\) \{ setVariantFailedFor\(safeSrc\); return \}/, `${file}: a failed variant shows the original before the image is marked broken`)
  }
})

await runCase('the storefront card and flyout strip opt in; the lightbox and hero do not', () => {
  assert.match(read('../src/components/catalog/CatalogProductsSection.tsx'), /<CatalogProductImage thumbnail sizes="[^"]+" src=\{primaryImage\}/)
  assert.match(read('../src/components/catalog/ProductDetailFlyout.tsx'), /<CatalogProductImage thumbnail src=\{image\}/)
  assert.doesNotMatch(read('../src/components/catalog/CatalogPreviewSurface.tsx'), /CatalogProductImage thumbnail/, 'the lightbox shows the large original')
  const images = read('../src/components/catalog/catalogImages.tsx')
  assert.match(images, /thumbnail && variantFailedFor !== safeSrc/)
  assert.match(images, /if \(variantPath\) \{ setVariantFailedFor\(safeSrc\); return \}/)
})

await runCase('both browser upload writers send thumbnails (product image upload, Library upload)', () => {
  const product = read('../src/api/productImageUploadTransport.ts')
  assert.equal((product.match(/appendImageThumbnails\(form, await createImageThumbnails\(compressed\)\)/g) || []).length, 2, 'the File branch and the data-URL branch')
  assert.match(read('../src/api/fileTransport.ts'), /if \(isCompressibleImageFile\(uploadFile\)\) appendImageThumbnails\(form, await createImageThumbnails\(uploadFile\)\)/)
})
