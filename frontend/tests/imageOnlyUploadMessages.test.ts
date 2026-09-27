// S-uploads2b: each image-only upload surface refuses a file in its OWN
// words, in the person's language.
//
// Before this, a product image or an avatar the Worker refused for its type
// showed the Library's message -- "The Library only stores images (JPEG, PNG,
// WebP, GIF, AVIF) and videos (MP4, MOV, WebM)" -- which offers videos a
// product image or an avatar can never be, and is English on a Khmer screen.
// The avatar's other path even showed the Worker's raw JSON body. A video
// picked as a product image was uploaded whole just to be refused, and the
// avatar path went through the Library endpoint, which stores videos.
//
// Now the product-image surface (api/productImageUploadTransport.ts) and the
// avatar surface (api/fileTransport.ts's uploadUserAvatar) each map every
// Worker refusal of a file's TYPE to their own pack message naming "JPEG,
// PNG, WebP, GIF or AVIF", read from the language the UI shows; video/audio
// is refused on the device; a file the Library stored as a video is not taken
// as an avatar. A refusal for what an image contains, every other failure,
// and the Library's own uploads keep their messages.
//
// The Worker's refusal sentences are fed in from the Worker itself
// (cloudflare/src/lib/uploadSecurity.ts's exports and the routes' inline
// texts), so rewording one on the Worker without the client fails here.
// The transports run for real (esbuild -> CommonJS) with only their network,
// compression and scope helpers stubbed.
//
// IMAGE_ONLY_MESSAGES_FRONTEND_ROOT points the transports and packs at
// another checkout's frontend (the fail-on-base proof); packages and the
// Worker sources still resolve from this checkout.
//
// Run: node tests/imageOnlyUploadMessages.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import {
  EMBEDDED_MARKUP_MESSAGE,
  MISMATCHED_UPLOAD_MESSAGE,
  UNSUPPORTED_IMAGE_MESSAGE,
  UNSUPPORTED_UPLOAD_MESSAGE,
} from '../../cloudflare/src/lib/uploadSecurity.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(process.env.IMAGE_ONLY_MESSAGES_FRONTEND_ROOT || path.join(here, '..'))
const WORKER = path.resolve(here, '..', '..', 'cloudflare')

type Pack = Record<string, unknown>
const readPack = (name: string): Pack => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', `${name}.json`), 'utf8')) as Pack
const EN = readPack('en')
const KM = readPack('km')
const PRODUCT = { en: EN.product_image_unsupported_type, km: KM.product_image_unsupported_type } as Record<string, unknown>
const AVATAR = { en: EN.avatar_unsupported_type, km: KM.avatar_unsupported_type } as Record<string, unknown>

// The routes' own refusal of a non-image claim, read from the Worker source.
function routeNonImageRefusal(route: string): string {
  const source = fs.readFileSync(path.join(WORKER, 'src', 'routes', route), 'utf8')
  const match = source.match(/mediaType !== 'image'\) return c\.json\(\{ (?:success: false, )?error: '([^']+)' \}, 400\)/)
  assert.ok(match, `${route}: the upload route's non-image refusal moved`)
  return match[1]
}
const PRODUCT_ROUTE_REFUSAL = routeNonImageRefusal('products.ts')
const AVATAR_ROUTE_REFUSAL = routeNonImageRefusal('users.ts')

// --- the browser the transports expect ------------------------------------

let uiLanguage = 'en'
Object.assign(globalThis, {
  document: { documentElement: { getAttribute: (name: string) => (name === 'lang' ? uiLanguage : null) } },
})

let fetchCalls = 0
let fetchReply: () => Response = () => new Response('{}', { status: 200 })
Object.assign(globalThis, { fetch: async () => { fetchCalls += 1; return fetchReply() } })

let xhrSends = 0
let xhrReply = { status: 200, body: '{}' }
class FixtureXhr {
  upload: Record<string, unknown> = {}
  status = 0
  responseText = ''
  withCredentials = false
  onload: () => void = () => {}
  onerror: () => void = () => {}
  onabort: () => void = () => {}
  open() {}
  setRequestHeader() {}
  abort() {}
  send() {
    xhrSends += 1
    this.status = xhrReply.status
    this.responseText = xhrReply.body
    queueMicrotask(() => this.onload())
  }
}
Object.assign(globalThis, { XMLHttpRequest: FixtureXhr })

const STUBS: Record<string, unknown> = {
  '/lang/en.json': EN,
  '/lang/km.json': KM,
  '/http.ts': {
    getSyncServerUrl: () => 'https://fixture.invalid',
    requireLiveServerWrite() {},
    apiFetch: async () => { throw new Error('apiFetch is not part of an upload') },
    route: async () => { throw new Error('route is not part of an upload') },
  },
  '/actorReadScope.ts': { captureActorReadScope: () => ({}), assertActorReadScope() {}, assertActorSessionDispatchAllowed() {} },
  '/imageCompression.ts': { compressImageFile: async (file: File) => file, isCompressibleImageFile: () => false },
  '/videoCompression.ts': { compressVideoFile: async (file: File) => file, isCompressibleVideoFile: () => false },
  '/mediaUpload.ts': { canonicalizePersistedMediaPath: (value: unknown) => String(value || '') },
  '/multipartHeaders.ts': { buildMultipartHeaders: () => ({}) },
  '/deviceInfo.ts': { getClientDeviceInfo: () => ({}) },
  '/actorQuery.ts': { getCurrentUserContext: () => ({ userId: 1, userName: 'owner' }) },
  '/query.ts': { buildQueryString: () => '', appendQuery: (value: string) => value },
}

function loadTransport(name: string): Record<string, any> {
  const source = fs.readFileSync(path.join(FRONTEND, 'src', 'api', `${name}.ts`), 'utf8')
  // dynamic-import off: the packs' import() becomes require(), served below.
  const code = transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => {
    const stub = Object.entries(STUBS).find(([suffix]) => request.endsWith(suffix))
    if (!stub) throw new Error(`${name}.ts imports ${request}, which this harness does not provide`)
    return stub[1]
  })
  return mod.exports
}

const products = loadTransport('productImageUploadTransport')
const files = loadTransport('fileTransport')

// --- fixtures ---------------------------------------------------------------

const bytes = (...values: number[]) => new Uint8Array(values)
const jpegFile = () => new File([bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46)], 'photo.jpg', { type: 'image/jpeg' })
const pngFile = () => new File([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)], 'avatar.png', { type: 'image/png' })
const mp4File = () => new File([bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32)], 'clip.mp4', { type: 'video/mp4' })
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='
const MP4_DATA_URL = 'data:video/mp4;base64,AAAAGGZ0eXBtcDQy'
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function rejection(promise: Promise<unknown>): Promise<Error & { code?: unknown }> {
  try {
    const value = await promise
    throw new assert.AssertionError({ message: `expected a refusal, got ${JSON.stringify(value)}` })
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error
    return error as Error & { code?: unknown }
  }
}

const failures: string[] = []
async function runCase(name: string, body: () => Promise<void> | void): Promise<void> {
  uiLanguage = 'en'
  fetchCalls = 0
  xhrSends = 0
  try {
    await body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

const TYPE_REFUSALS = [UNSUPPORTED_UPLOAD_MESSAGE, UNSUPPORTED_IMAGE_MESSAGE, MISMATCHED_UPLOAD_MESSAGE]

// --- the packs --------------------------------------------------------------

await runCase('both packs carry each surface its own images-only message naming JPEG, PNG, WebP, GIF or AVIF, with no video in it', () => {
  for (const key of ['product_image_unsupported_type', 'avatar_unsupported_type']) {
    const english = EN[key]
    const khmer = KM[key]
    assert.equal(typeof english, 'string', `en.json has no ${key}`)
    assert.equal(typeof khmer, 'string', `km.json has no ${key}`)
    assert.ok(String(english).includes('JPEG, PNG, WebP, GIF or AVIF'), `en ${key}: ${english}`)
    assert.ok(String(khmer).includes('JPEG, PNG, WebP, GIF ឬ AVIF'), `km ${key}: ${khmer}`)
    assert.match(String(khmer), /[ក-៿]/, `km ${key} is not Khmer`)
    assert.notEqual(khmer, english)
    assert.doesNotMatch(String(english), /video|MP4|MOV|WebM|Library/i, `en ${key} offers what the surface cannot take`)
    assert.doesNotMatch(String(khmer), /វីដេអូ|MP4|MOV|WebM|បណ្ណាល័យ/i, `km ${key} offers what the surface cannot take`)
  }
  assert.notEqual(EN.product_image_unsupported_type, EN.avatar_unsupported_type, 'one message for two surfaces')
  assert.notEqual(KM.product_image_unsupported_type, KM.avatar_unsupported_type, 'one message for two surfaces')
  // The English each transport falls back to when a pack cannot load is the pack's own.
  const productSource = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'productImageUploadTransport.ts'), 'utf8')
  const fileSource = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'fileTransport.ts'), 'utf8')
  assert.ok(productSource.includes(`'${EN.product_image_unsupported_type}'`), 'productImageUploadTransport.ts English fallback differs from en.json')
  assert.ok(fileSource.includes(`'${EN.avatar_unsupported_type}'`), 'fileTransport.ts English fallback differs from en.json')
})

// --- product images -----------------------------------------------------------

await runCase('product image: every Worker refusal of a file type shows the product-image message, in English and in Khmer', async () => {
  for (const refusal of [...TYPE_REFUSALS, PRODUCT_ROUTE_REFUSAL]) {
    for (const language of ['en', 'km']) {
      uiLanguage = language
      fetchReply = json(400, { success: false, error: refusal })
      const error = await rejection(products.uploadProductImage({ file: jpegFile(), fileName: 'photo.jpg' }))
      assert.doesNotMatch(error.message, /Library|video/i, `${language}: the product-image surface showed the Library's words`)
      assert.equal(error.message, PRODUCT[language], `${language}, Worker said: ${refusal}`)
      assert.equal(error.code, 'unsupported_image_type')
      const fromGallery = await rejection(products.uploadProductImage({ filePath: PNG_DATA_URL, fileName: 'gallery.png' }))
      assert.equal(fromGallery.message, PRODUCT[language], `${language}, gallery data URL, Worker said: ${refusal}`)
    }
  }
})

await runCase('product image: a refusal for what the image contains, and every other failure, keep their own message', async () => {
  for (const other of [EMBEDDED_MARKUP_MESSAGE, 'Image could not be normalized within the upload safety limit.', 'Too many product image uploads. Try again shortly.']) {
    fetchReply = json(400, { success: false, error: other })
    assert.equal((await rejection(products.uploadProductImage({ file: jpegFile() }))).message, other)
  }
  fetchReply = () => new Response('upstream down', { status: 502 })
  assert.equal((await rejection(products.uploadProductImage({ file: jpegFile() }))).message, 'upstream down')
})

await runCase('product image: a video is refused on the device with the product-image message and never uploaded', async () => {
  fetchReply = json(400, { success: false, error: PRODUCT_ROUTE_REFUSAL })
  for (const language of ['en', 'km']) {
    uiLanguage = language
    fetchCalls = 0
    assert.equal((await rejection(products.uploadProductImage({ file: mp4File(), fileName: 'clip.mp4' }))).message, PRODUCT[language])
    assert.equal((await rejection(products.uploadProductImage({ filePath: MP4_DATA_URL, fileName: 'clip.mp4' }))).message, PRODUCT[language])
    assert.equal(fetchCalls, 0, `${language}: the video was sent to the Worker`)
  }
})

await runCase('product image: an accepted image still returns its stored path', async () => {
  fetchReply = json(200, { data: { public_path: '/uploads/photo.webp' } })
  const stored = await products.uploadProductImage({ file: jpegFile() }) as { public_path?: string }
  assert.equal(stored.public_path, '/uploads/photo.webp')
  assert.equal(fetchCalls, 1)
})

// --- avatars ----------------------------------------------------------------

await runCase('avatar: every Worker refusal of a file type shows the avatar message, in English and in Khmer, on both upload paths', async () => {
  for (const language of ['en', 'km']) {
    uiLanguage = language
    // The profile screen's path: the Library endpoint, which answers with the Library message.
    xhrReply = { status: 400, body: JSON.stringify({ error: UNSUPPORTED_UPLOAD_MESSAGE, code: 'unsupported_file_type' }) }
    const viaLibrary = await rejection(files.uploadUserAvatar({ file: pngFile() }))
    assert.doesNotMatch(viaLibrary.message, /Library|video/i, `${language}: the avatar surface showed the Library's words`)
    assert.equal(viaLibrary.message, AVATAR[language], `${language}, Library endpoint`)
    assert.equal(viaLibrary.code, 'unsupported_image_type')
    // The data-URL path: POST /api/users/avatar-upload.
    for (const refusal of [...TYPE_REFUSALS, AVATAR_ROUTE_REFUSAL]) {
      fetchReply = json(400, { error: refusal })
      assert.equal((await rejection(files.uploadUserAvatar({ filePath: PNG_DATA_URL, fileName: 'avatar.png' }))).message, AVATAR[language], `${language}, avatar-upload said: ${refusal}`)
    }
  }
})

await runCase('avatar: a video is refused on the device, and a file the Library stored as a video is not taken as the avatar', async () => {
  xhrReply = { status: 200, body: JSON.stringify({ id: 9, public_path: '/uploads/clip.mp4', media_type: 'video', mime_type: 'video/mp4' }) }
  fetchReply = json(200, { path: '/uploads/clip.mp4' })
  for (const language of ['en', 'km']) {
    uiLanguage = language
    xhrSends = 0
    fetchCalls = 0
    assert.equal((await rejection(files.uploadUserAvatar({ file: mp4File() }))).message, AVATAR[language])
    assert.equal(xhrSends, 0, `${language}: the video was sent to the Library`)
    assert.equal((await rejection(files.uploadUserAvatar({ filePath: MP4_DATA_URL, fileName: 'clip.mp4' }))).message, AVATAR[language])
    assert.equal(fetchCalls, 0, `${language}: the video was sent to avatar-upload`)
  }
  // Named and typed as a picture, stored by its bytes as a video.
  const disguised = new File([bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32)], 'avatar.png', { type: 'image/png' })
  uiLanguage = 'en'
  assert.equal((await rejection(files.uploadUserAvatar({ file: disguised }))).message, AVATAR.en)
})

await runCase('avatar: other failures keep their own message, as the Worker sentence rather than its JSON body', async () => {
  const tooLarge = 'Avatar image is too large to save (over 1MB after your browser attempted to compress it). Please try again, or pick a smaller image.'
  fetchReply = json(400, { error: tooLarge })
  assert.equal((await rejection(files.uploadUserAvatar({ filePath: PNG_DATA_URL, fileName: 'avatar.png' }))).message, `Avatar upload failed: ${tooLarge}`)
  xhrReply = { status: 400, body: JSON.stringify({ error: EMBEDDED_MARKUP_MESSAGE, code: 'unsupported_file_type' }) }
  assert.equal((await rejection(files.uploadUserAvatar({ file: pngFile() }))).message, `File upload failed: ${EMBEDDED_MARKUP_MESSAGE}`)
})

await runCase('avatar: an accepted image still returns its path', async () => {
  xhrReply = { status: 200, body: JSON.stringify({ id: 4, public_path: '/uploads/avatar.webp', media_type: 'image', mime_type: 'image/webp' }) }
  const stored = await files.uploadUserAvatar({ file: pngFile() }) as { path?: string }
  assert.equal(stored.path, '/uploads/avatar.webp')
  assert.equal(xhrSends, 1)
})

// --- the Library keeps its own message --------------------------------------

await runCase('Library: its own uploads keep the Library message, which does offer videos', async () => {
  uiLanguage = 'km'
  xhrReply = { status: 400, body: JSON.stringify({ error: UNSUPPORTED_UPLOAD_MESSAGE, code: 'unsupported_file_type' }) }
  assert.equal((await rejection(files.uploadFileAsset({ file: pngFile() }))).message, `File upload failed: ${UNSUPPORTED_UPLOAD_MESSAGE}`)
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS image-only upload surfaces: product images and avatars refuse a file type in their own words, in both languages; the Library keeps its message')
