import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const TRANSPORT_SOURCE = path.resolve(process.env.FILE_TRANSPORT_SOURCE || path.join(FRONTEND, 'src', 'api', 'fileTransport.ts'))

type Pack = Record<string, unknown>
const readPack = (name: string): Pack => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', `${name}.json`), 'utf8')) as Pack
const EN = readPack('en')
const KM = readPack('km')

let uiLanguage = 'en'
Object.assign(globalThis, {
  document: { documentElement: { getAttribute: (name: string) => (name === 'lang' ? uiLanguage : null) } },
})

type FakeTimer = { id: number; delay: number; run: () => void; live: boolean }
let timers: FakeTimer[] = []
const fakeSetTimeout = (run: () => void, delay: number): number => {
  const timer = { id: timers.length + 1, delay, run, live: true }
  timers.push(timer)
  return timer.id
}
const fakeClearTimeout = (id: number): void => {
  const timer = timers.find((entry) => entry.id === id)
  if (timer) timer.live = false
}
const fire = (timer: FakeTimer): void => {
  assert.ok(timer.live, 'the timer was already cleared, so it can never fire')
  timer.live = false
  timer.run()
}
const liveTimers = (): FakeTimer[] => timers.filter((timer) => timer.live)

class FakeXhr {
  static all: FakeXhr[] = []
  upload: Record<string, unknown> = {}
  status = 0
  responseText = ''
  withCredentials = false
  onload: () => void = () => {}
  onerror: () => void = () => {}
  onabort: () => void = () => {}
  sent = false
  aborted = false
  completed = false
  constructor() { FakeXhr.all.push(this) }
  open() {}
  setRequestHeader() {}
  send() { this.sent = true }
  abort() {
    if (this.completed || this.aborted) return
    this.aborted = true
    this.onabort()
  }
  respond(status: number, body: string) {
    if (this.aborted || this.completed) return
    this.completed = true
    this.status = status
    this.responseText = body
    this.onload()
  }
}
Object.assign(globalThis, { XMLHttpRequest: FakeXhr })

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
    isCompressibleImageFile: () => false,
    compressImageFile: async (file: File) => file,
    createImageThumbnails: async () => [],
    appendImageThumbnails: () => {},
  },
  '/multipartHeaders.ts': { buildMultipartHeaders: () => ({}) },
  '/deviceInfo.ts': { getClientDeviceInfo: () => ({}) },
  '/actorQuery.ts': { getCurrentUserContext: () => ({ userId: 1, userName: 'owner' }) },
  '/query.ts': { buildQueryString: () => '', appendQuery: (value: string) => value },
}

function loadTransport(): Record<string, any> {
  const source = fs.readFileSync(TRANSPORT_SOURCE, 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', 'setTimeout', 'clearTimeout', code)(mod, mod.exports, (request: string) => {
    const stub = Object.entries(STUBS).find(([suffix]) => request.endsWith(suffix))
    if (!stub) throw new Error(`fileTransport.ts imports ${request}, which this harness does not provide`)
    return stub[1]
  }, fakeSetTimeout, fakeClearTimeout)
  return mod.exports
}

const files = loadTransport()

const MB = 1024 * 1024
const videoFile = (name: string, bytes: number): File => new File([new Uint8Array(bytes)], name, { type: 'video/mp4' })
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const OK_BODY = JSON.stringify({ id: 1, public_path: '/uploads/x', media_type: 'video' })

type Outcome = { state: 'pending' } | { state: 'resolved'; value: unknown } | { state: 'rejected'; error: Error & { code?: unknown } }
function track(promise: Promise<unknown>): { outcome: () => Outcome; done: Promise<void> } {
  let outcome: Outcome = { state: 'pending' }
  const done = promise.then(
    (value) => { outcome = { state: 'resolved', value } },
    (error) => { outcome = { state: 'rejected', error } },
  )
  return { outcome: () => outcome, done }
}

async function startUpload(file: File, extra: Record<string, unknown> = {}) {
  const request = track(files.uploadFileAsset({ file, userId: 1, userName: 'owner', ...extra }))
  await settle()
  const xhr = FakeXhr.all[FakeXhr.all.length - 1]
  return { request, xhr }
}

const failures: string[] = []
async function runCase(name: string, body: () => Promise<void> | void): Promise<void> {
  uiLanguage = 'en'
  timers = []
  FakeXhr.all = []
  try {
    await body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

await runCase('the timeout grows with the file: 30 s plus 4 s per started MB, capped at 180 s', () => {
  const ms = files.uploadTimeoutMs as (bytes: number) => number
  assert.equal(ms(0), 30_000)
  assert.equal(ms(Number.NaN), 30_000)
  assert.equal(ms(-5), 30_000)
  assert.equal(ms(1), 34_000)
  assert.equal(ms(MB), 34_000)
  assert.equal(ms(MB + 1), 38_000)
  assert.equal(ms(10 * MB), 70_000)
  assert.equal(ms(25 * MB), 130_000)
  assert.equal(ms(37 * MB), 178_000)
  assert.equal(ms(38 * MB), 180_000)
  assert.equal(ms(500 * MB), 180_000)
})

await runCase('the request carries its own timer, sized to the file, and it is armed before the bytes go out', async () => {
  const small = await startUpload(videoFile('small.mp4', MB))
  assert.equal(FakeXhr.all.length, 1)
  assert.equal(small.xhr.sent, true)
  assert.equal(liveTimers().length, 1, 'no timer was armed: nothing can stop a stalled upload')
  assert.equal(liveTimers()[0].delay, 34_000)
  small.xhr.respond(200, OK_BODY)
  await small.request.done

  timers = []
  const large = await startUpload(videoFile('large.mp4', 20 * MB))
  assert.equal(liveTimers()[0].delay, 110_000, 'a 20 MB file got the same short timer as a 1 MB file')
  large.xhr.respond(200, OK_BODY)
  await large.request.done
})

await runCase('a stalled upload is stopped by aborting the request, and says so in the person\'s language', async () => {
  for (const language of ['en', 'km']) {
    uiLanguage = language
    timers = []
    FakeXhr.all = []
    const { request, xhr } = await startUpload(videoFile('stalled.mp4', 3 * MB))
    assert.equal(xhr.aborted, false)
    assert.equal(request.outcome().state, 'pending')
    fire(liveTimers()[0])
    assert.equal(xhr.aborted, true, `${language}: the timer fired but the request is still running`)
    await request.done
    const outcome = request.outcome()
    assert.equal(outcome.state, 'rejected', language)
    if (outcome.state !== 'rejected') return
    assert.equal(outcome.error.code, 'upload_timeout', language)
    assert.equal(outcome.error.message, String((language === 'en' ? EN : KM).upload_timed_out), language)
    assert.equal(liveTimers().length, 0)
  }
})

await runCase('a retry after a timeout reaches the server once: the stalled request is dead, only the retry completes', async () => {
  const file = videoFile('retry.mp4', 3 * MB)
  const first = await startUpload(file)
  fire(liveTimers()[0])
  await first.request.done
  assert.equal(first.request.outcome().state, 'rejected')

  first.xhr.respond(200, OK_BODY)
  assert.equal(first.xhr.completed, false, 'the abandoned request still completed: a retry would now be a duplicate')

  const second = await startUpload(file)
  second.xhr.respond(200, OK_BODY)
  await second.request.done
  assert.equal(second.request.outcome().state, 'resolved')
  assert.equal(FakeXhr.all.length, 2)
  assert.equal(FakeXhr.all.filter((xhr) => xhr.completed).length, 1, 'more than one request completed for one picked file')
  assert.equal(liveTimers().length, 0)
})

await runCase('a finished upload clears its timer, whether it succeeded, was refused, or failed to connect', async () => {
  const ok = await startUpload(videoFile('ok.mp4', MB))
  ok.xhr.respond(200, OK_BODY)
  await ok.request.done
  assert.equal(ok.request.outcome().state, 'resolved')
  assert.equal(liveTimers().length, 0, 'success left a timer that would abort a finished request')

  const refused = await startUpload(videoFile('refused.mp4', MB))
  refused.xhr.respond(400, JSON.stringify({ error: 'Uploaded file is empty' }))
  await refused.request.done
  assert.equal(refused.request.outcome().state, 'rejected')
  assert.equal(liveTimers().length, 0, 'a refusal left a timer running')

  const offline = await startUpload(videoFile('offline.mp4', MB))
  offline.xhr.onerror()
  await offline.request.done
  assert.equal(offline.request.outcome().state, 'rejected')
  assert.equal(liveTimers().length, 0, 'a connection error left a timer running')
})

await runCase('closing the screen aborts the request and reads as a cancel, never as a timeout', async () => {
  const controller = new AbortController()
  const { request, xhr } = await startUpload(videoFile('closed.mp4', 3 * MB), { signal: controller.signal })
  controller.abort()
  assert.equal(xhr.aborted, true)
  await request.done
  const outcome = request.outcome()
  assert.equal(outcome.state, 'rejected')
  if (outcome.state !== 'rejected') return
  assert.equal(outcome.error.code, 'upload_cancelled')
  assert.equal(outcome.error.message, 'Upload cancelled')
  assert.equal(liveTimers().length, 0, 'the timer outlived the cancelled request')
})

await runCase('a signal that is already aborted never sends a byte or arms a timer', async () => {
  const controller = new AbortController()
  controller.abort()
  const { request, xhr } = await startUpload(videoFile('late.mp4', 3 * MB), { signal: controller.signal })
  await request.done
  assert.equal(request.outcome().state, 'rejected')
  assert.equal(xhr.sent, false)
  assert.equal(timers.length, 0)
})

await runCase('both packs carry the timeout message, Khmer in km, and the code fallback equals en.json', () => {
  const english = String(EN.upload_timed_out)
  const khmer = String(KM.upload_timed_out)
  assert.ok(english.trim() && khmer.trim())
  assert.match(khmer, /[ក-៿]/)
  assert.notEqual(english, khmer)
  assert.ok(fs.readFileSync(TRANSPORT_SOURCE, 'utf8').includes(`'${english}'`), 'fileTransport.ts English fallback differs from en.json')
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS upload timeouts abort the request, scale with the file, and a retry uploads once')
