import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const WORKER = path.resolve(here, '..', '..', 'cloudflare')
const TRANSPORT_SOURCE = path.resolve(process.env.FILE_TRANSPORT_SOURCE || path.join(FRONTEND, 'src', 'api', 'fileTransport.ts'))

type Pack = Record<string, unknown>
const readPack = (name: string): Pack => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', `${name}.json`), 'utf8')) as Pack
const EN = readPack('en')
const KM = readPack('km')
const readJson = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'))

let uiLanguage = 'en'
Object.assign(globalThis, {
  document: { documentElement: { getAttribute: (name: string) => (name === 'lang' ? uiLanguage : null) } },
})

type Sent = { name: string; type: string; size: number; sha: string }
let xhrSends = 0
let xhrReply = { status: 200, body: JSON.stringify({ id: 1, public_path: '/uploads/x', media_type: 'image' }) }
let sent: Sent | null = null
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
  send(form: FormData) {
    xhrSends += 1
    const file = form.get('file') as File
    file.arrayBuffer().then((buffer) => {
      sent = { name: file.name, type: file.type, size: file.size, sha: createHash('sha256').update(new Uint8Array(buffer)).digest('hex') }
      this.status = xhrReply.status
      this.responseText = xhrReply.body
      this.onload()
    })
  }
}
Object.assign(globalThis, { XMLHttpRequest: FixtureXhr })

let imageCompressions: File[] = []
const COMPRESSED_NAME = 'photo-compressed.webp'
const trap = (what: string) => new Proxy({}, { get() { throw new Error(`${what} was loaded: client-side video compression is back`) } })

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
  '/imageCompression.ts': {
    isCompressibleImageFile: (file: File) => /^image\//i.test(file.type),
    compressImageFile: async (file: File) => {
      imageCompressions.push(file)
      return new File([new Uint8Array(8)], COMPRESSED_NAME, { type: 'image/webp' })
    },
    createImageThumbnails: async () => [],
    appendImageThumbnails: () => {},
  },
  '/videoCompression.ts': trap('utils/videoCompression.ts'),
  '/multipartHeaders.ts': { buildMultipartHeaders: () => ({}) },
  '/deviceInfo.ts': { getClientDeviceInfo: () => ({}) },
  '/actorQuery.ts': { getCurrentUserContext: () => ({ userId: 1, userName: 'owner' }) },
  '/query.ts': { buildQueryString: () => '', appendQuery: (value: string) => value },
}

function loadTransport(): Record<string, any> {
  const source = fs.readFileSync(TRANSPORT_SOURCE, 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => {
    const stub = Object.entries(STUBS).find(([suffix]) => request.endsWith(suffix))
    if (!stub) throw new Error(`fileTransport.ts imports ${request}, which this harness does not provide`)
    return stub[1]
  })
  return mod.exports
}

const files = loadTransport()

const MB = 1024 * 1024
function videoFile(name: string, type: string, bytes: number): File {
  const data = new Uint8Array(bytes)
  data.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])
  for (let i = 64; i < bytes; i += 4099) data[i] = (i * 31) & 0xff
  return new File([data], name, { type })
}
const shaOf = async (file: File) => createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex')

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
  xhrSends = 0
  sent = null
  imageCompressions = []
  xhrReply = { status: 200, body: JSON.stringify({ id: 1, public_path: '/uploads/x', media_type: 'image' }) }
  try {
    await body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

const workerSource = fs.readFileSync(path.join(WORKER, 'src', 'routes', 'files.ts'), 'utf8')
const workerLimitMegabytes = Number(workerSource.match(/const MAX_UPLOAD_BYTES = (\d+) \* 1024 \* 1024/)?.[1])
const workerTooLargeTemplate = workerSource.match(/error: `(File is too large \(max \$\{Math\.floor\(MAX_UPLOAD_BYTES \/ \(1024 \* 1024\)\)\}MB\))`/)?.[1]

await runCase('a 3 MB video uploads exactly as picked: same name, type, size and bytes, and never reaches an image or video compressor', async () => {
  const video = videoFile('Lipstick Promo.mov', 'video/quicktime', 3 * MB)
  const expected = await shaOf(video)
  await files.uploadFileAsset({ file: video, userId: 1, userName: 'owner' })
  assert.equal(xhrSends, 1)
  assert.deepEqual(sent, { name: 'Lipstick Promo.mov', type: 'video/quicktime', size: 3 * MB, sha: expected })
  assert.equal(imageCompressions.length, 0, 'a video was handed to the image compressor')
})

await runCase('every video container the Library accepts uploads untouched, above and below the old 2 MB compression floor', async () => {
  for (const [name, type, bytes] of [['a.mp4', 'video/mp4', 2 * MB + 1], ['b.webm', 'video/webm', 5 * MB], ['c.mov', 'video/quicktime', 1024], ['d.mkv', '', 4 * MB]] as const) {
    const video = videoFile(name, type, bytes)
    const expected = await shaOf(video)
    await files.uploadFileAsset({ file: video })
    assert.deepEqual(sent, { name, type, size: bytes, sha: expected }, name)
  }
  assert.equal(imageCompressions.length, 0)
})

await runCase('an image is still compressed before it is sent', async () => {
  const photo = new File([new Uint8Array(4 * MB)], 'photo.jpg', { type: 'image/jpeg' })
  await files.uploadFileAsset({ file: photo })
  assert.equal(imageCompressions.length, 1)
  assert.equal(imageCompressions[0], photo)
  assert.equal(sent?.name, COMPRESSED_NAME)
  assert.equal(sent?.type, 'image/webp')
  assert.equal(sent?.size, 8)
})

await runCase('a video over the Worker limit is refused on the device, in English and Khmer, before any byte is sent', async () => {
  assert.equal(workerLimitMegabytes, 25, 'the Worker upload limit moved; update MAX_UPLOAD_MEGABYTES in api/fileTransport.ts and this case')
  const video = videoFile('long.mp4', 'video/mp4', 25 * MB + 1)
  for (const language of ['en', 'km']) {
    uiLanguage = language
    const error = await rejection(files.uploadFileAsset({ file: video }))
    const pack = language === 'en' ? EN : KM
    assert.equal(error.message, String(pack.upload_file_too_large).replace('{mb}', '25'), language)
    assert.equal(error.code, 'upload_too_large')
    assert.match(error.message, /25/)
    assert.equal(xhrSends, 0, `${language}: the oversized video was sent`)
  }
})

await runCase('a video exactly at the Worker limit is still sent', async () => {
  const video = videoFile('edge.mp4', 'video/mp4', 25 * MB)
  await files.uploadFileAsset({ file: video })
  assert.equal(xhrSends, 1)
  assert.equal(sent?.size, 25 * MB)
})

await runCase('if the Worker or the edge still refuses for size, the person gets the same message in their language', async () => {
  assert.ok(workerTooLargeTemplate, 'the Worker upload route no longer words its size refusal as File is too large (max NMB)')
  const workerMessage = `File is too large (max ${workerLimitMegabytes}MB)`
  const video = videoFile('clip.mp4', 'video/mp4', 3 * MB)
  for (const language of ['en', 'km']) {
    uiLanguage = language
    const pack = language === 'en' ? EN : KM
    const expected = String(pack.upload_file_too_large).replace('{mb}', '25')
    xhrReply = { status: 400, body: JSON.stringify({ error: workerMessage }) }
    assert.equal((await rejection(files.uploadFileAsset({ file: video }))).message, expected, `${language}: Worker 400`)
    xhrReply = { status: 413, body: '' }
    assert.equal((await rejection(files.uploadFileAsset({ file: video }))).message, expected, `${language}: edge 413`)
  }
})

await runCase('other upload failures keep their own message', async () => {
  const video = videoFile('clip.mp4', 'video/mp4', 3 * MB)
  xhrReply = { status: 400, body: JSON.stringify({ error: 'Uploaded file is empty' }) }
  assert.equal((await rejection(files.uploadFileAsset({ file: video }))).message, 'File upload failed: Uploaded file is empty')
})

await runCase('both packs carry the size message with the same {mb} slot, Khmer in km, and the code fallback equals en.json', () => {
  const english = String(EN.upload_file_too_large)
  const khmer = String(KM.upload_file_too_large)
  assert.ok(english.includes('{mb}') && khmer.includes('{mb}'))
  assert.match(khmer, /[ក-៿]/)
  assert.notEqual(english, khmer)
  assert.ok(fs.readFileSync(TRANSPORT_SOURCE, 'utf8').includes(`'${english}'`), 'fileTransport.ts English fallback differs from en.json')
})

await runCase('the ffmpeg packages, their loader and their runtime download are gone from the app', () => {
  const frontendPackage = readJson(path.join(FRONTEND, 'package.json'))
  const lock = readJson(path.join(FRONTEND, 'package-lock.json'))
  const declared = Object.keys({ ...frontendPackage.dependencies, ...frontendPackage.devDependencies })
  assert.deepEqual(declared.filter((name) => /ffmpeg/i.test(name)), [])
  assert.deepEqual(Object.keys(lock.packages).filter((key) => /ffmpeg/i.test(key)), [])
  assert.deepEqual(Object.keys(lock.packages[''].dependencies).filter((name) => /ffmpeg/i.test(name)), [])
  assert.equal(fs.existsSync(path.join(FRONTEND, 'src', 'utils', 'videoCompression.ts')), false)
  const offenders: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx|json|css|html)$/.test(entry.name)) continue
      if (/ffmpeg|unpkg\.com|videoCompression/i.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(FRONTEND, full).replace(/\\/g, '/'))
    }
  }
  walk(path.join(FRONTEND, 'src'))
  assert.deepEqual(offenders, [])
  assert.doesNotMatch(fs.readFileSync(path.join(FRONTEND, 'vite.config.ts'), 'utf8'), /ffmpeg|unpkg\.com/i)
  assert.doesNotMatch(fs.readFileSync(path.join(FRONTEND, 'public', '_headers'), 'utf8'), /unpkg\.com/i)
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS file uploads: videos go up as picked, images are still compressed, and an oversized file is refused in the person\'s language')
