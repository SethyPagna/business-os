// Real-browser proof for the live camera loop with the decoder in a Worker (lane 6.0.935).
//
// Everything else about the live path is proved with stand-ins (a fake camera, a
// Worker that runs the handler in-process). This runs the real thing in Chrome:
// the real useBarcodeCamera hook, Chrome's fake camera fed a generated video of an
// EAN-13 (--use-file-for-fake-video-capture), requestVideoFrameCallback, canvas
// read-back from a playing <video>, transfer of the pixel buffers to a real module
// Worker, ZXing in that Worker, and the two-agreeing-reads rule.
//
// Scenario 1: the code is on screen. The scan must read it, exactly as encoded,
//   once, close itself, end every camera track and terminate the worker.
// Scenario 2: nothing readable is on screen for the whole run. No read, no false
//   positive, and (the point of the Worker) no main-thread task over 50 ms while
//   the camera runs; then closing ends every track and terminates the worker.
//   A positive control follows the close: the page blocks its own main thread for
//   150 ms and the same observer must report it, or "no long task" proves nothing.
//
// Run: node tests/barcodeLiveCameraBrowser.test.ts
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const CODE = '5901234123457'
const WIDTH = 640
const HEIGHT = 480
const FRAMES = 10

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
function ean13Modules(code: string): string {
  const d = [...code].map(Number)
  const left = d.slice(1, 7).map((digit, i) => (PARITY[d[0]][i] === 'L' ? L : G)[digit]).join('')
  const right = d.slice(7).map((digit) => L[digit].replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0'))).join('')
  return `101${left}01010${right}101`
}

/** A Y4M video (I420) of one still picture: a pale card with the barcode centred on it, or a plain card. */
function y4m(withCode: boolean): Buffer {
  const luma = Buffer.alloc(WIDTH * HEIGHT, 225)
  if (withCode) {
    const modules = ean13Modules(CODE)
    const scale = 3
    const left = Math.floor((WIDTH - modules.length * scale) / 2)
    for (let y = HEIGHT / 2 - 90; y < HEIGHT / 2 + 90; y += 1) {
      for (let m = 0; m < modules.length; m += 1) if (modules[m] === '1') luma.fill(25, y * WIDTH + left + m * scale, y * WIDTH + left + (m + 1) * scale)
    }
  }
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2) * 2, 128)
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma])
  return Buffer.concat([Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`), ...Array.from({ length: FRAMES }, () => frame)])
}

const ZXING_DEEP_IMPORTS = [
  'core/BarcodeFormat', 'core/DecodeHintType', 'core/BinaryBitmap', 'core/RGBLuminanceSource', 'core/common/HybridBinarizer',
  'core/NotFoundException', 'core/ChecksumException', 'core/FormatException',
  'core/oned/OneDReader', 'core/oned/MultiFormatUPCEANReader', 'core/oned/Code39Reader', 'core/oned/Code128Reader', 'core/oned/ITFReader',
].map((name) => `@zxing/library/esm/${name}`)

// The page: the real hook driving a plain <video>, laid out like the scanner's (object-fit: cover).
const page = String.raw`
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useBarcodeCamera } from '/src/components/products/scanning/useBarcodeCamera.ts'
import { markScanner } from '/src/components/products/scanning/scannerWarmup.ts'

const messages = { scanUnsupported: 'unsupported', cameraDocumentBlocked: 'document-blocked', cameraPermissionBlocked: 'blocked', scanPermissionDenied: 'denied', scanFailed: 'failed', scanFallbackActive: 'fallback', scanPromptDismissed: 'dismissed' }
const state = window.__scan = { detected: [], closed: 0, status: 'starting', camera: null }

function Page() {
  const camera = useBarcodeCamera({ open: true, messages, onDetected: (value) => state.detected.push(value), onClose: () => { state.closed += 1 } })
  state.camera = camera
  state.status = camera.status
  const live = camera.status === 'starting' || camera.status === 'scanning'
  return React.createElement('div', { style: { width: '360px', height: '380px', position: 'relative', overflow: 'hidden', background: '#000' } },
    live ? React.createElement('video', { ref: camera.videoRef, muted: true, autoPlay: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'cover' } }) : null)
}

markScanner('tap')
createRoot(document.getElementById('root')).render(React.createElement(Page))
window.__scannerPageReady = true
`

// Recorded before any page script runs: every stream the camera hands out, every
// Worker started (and whether it was terminated), and every main-thread task over 50 ms.
const instrumentation = `
window.__streams = []
const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
navigator.mediaDevices.getUserMedia = async (constraints) => {
  const stream = await getUserMedia(constraints)
  window.__streams.push(stream)
  return stream
}
window.__workers = []
const NativeWorker = window.Worker
window.Worker = class extends NativeWorker {
  constructor(...args) {
    super(...args)
    const record = { terminated: 0, posted: 0 }
    window.__workers.push(record)
    const terminate = this.terminate.bind(this)
    this.terminate = () => { record.terminated += 1; terminate() }
    const postMessage = this.postMessage.bind(this)
    this.postMessage = (...message) => { record.posted += 1; postMessage(...message) }
  }
}
window.__longTasks = []
new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push({ start: entry.startTime, duration: entry.duration }) }).observe({ type: 'longtask' })
`

const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => candidate && existsSync(candidate))
const workDir = mkdtempSync(join(tmpdir(), 'bos-live-camera-'))

const server = await createServer({
  root, logLevel: 'error',
  cacheDir: join(tmpdir(), 'business-os-scanner-live-camera-vite'),
  optimizeDeps: { include: ['react', 'react-dom/client', ...ZXING_DEEP_IMPORTS] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'scanner-live-camera', enforce: 'pre',
    resolveId(id) { return id === 'virtual:scanner-live-camera' ? '\0scanner-live-camera' : null },
    async load(id) {
      if (id === '\0scanner-live-camera') return (await transformWithEsbuild(page, 'page.js', { loader: 'js' })).code
      return null
    },
    configureServer(app) {
      app.middlewares.use('/scanner-live-camera', async (_request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end(await app.transformIndexHtml('/scanner-live-camera', '<!doctype html><html><body><div id="root"></div><script type="module" src="/@id/virtual:scanner-live-camera"></script></body></html>'))
      })
    },
  }],
})
await server.listen()
const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`

interface Snapshot {
  detected: string[]
  closed: number
  status: string
  streams: Array<Array<{ readyState: string }>>
  workers: Array<{ terminated: number; posted: number }>
  longTasks: Array<{ start: number; duration: number }>
  controlAt: number | undefined
  marks: Record<string, number | undefined>
}

async function run(withCode: boolean, during: (browserPage: import('@playwright/test').Page) => Promise<void>): Promise<Snapshot> {
  const video = join(workDir, withCode ? 'ean13.y4m' : 'blank.y4m').replace(/\\/g, '/')
  writeFileSync(video, y4m(withCode))
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  })
  try {
    const context = await browser.newContext()
    await context.grantPermissions(['camera'], { origin })
    const browserPage = await context.newPage()
    browserPage.on('pageerror', (error) => { throw error })
    await browserPage.addInitScript(instrumentation)
    // A loaded machine can take minutes to optimise dependencies on first load.
    await browserPage.goto(`${origin}/scanner-live-camera`, { timeout: 240_000 })
    await browserPage.waitForFunction(() => (window as any).__scannerPageReady === true, null, { timeout: 240_000 })
    await during(browserPage)
    return await snapshot(browserPage)
  } finally {
    await browser.close()
  }
}

function snapshot(browserPage: import('@playwright/test').Page): Promise<Snapshot> {
  return browserPage.evaluate(() => {
    const w = window as any
    const mark = (name: string) => performance.getEntriesByName(`scanner:${name}`)[0]?.startTime
    return {
      detected: [...w.__scan.detected],
      closed: w.__scan.closed,
      status: w.__scan.status,
      streams: w.__streams.map((stream: MediaStream) => stream.getTracks().map((track) => ({ readyState: track.readyState }))),
      workers: w.__workers.map((record: { terminated: number; posted: number }) => ({ terminated: record.terminated, posted: record.posted })),
      longTasks: [...w.__longTasks],
      controlAt: w.__controlAt as number | undefined,
      marks: { tap: mark('tap'), stream: mark('stream'), decoderReady: mark('decoder-ready'), read: mark('read') },
    }
  })
}

let failed = 0
try {
  try {
    const result = await run(true, async (browserPage) => {
      await browserPage.waitForFunction(() => (window as any).__scan.closed > 0, null, { timeout: 30_000 })
      await browserPage.waitForTimeout(300)
    })
    assert.deepEqual(result.detected, [CODE], 'the camera must read the code exactly as encoded, once')
    assert.equal(result.closed, 1, 'and close itself once')
    assert.equal(result.streams.length, 1, 'one camera stream')
    assert.deepEqual(result.streams[0].map((track) => track.readyState), result.streams[0].map(() => 'ended'), 'every camera track is ended after the read')
    assert.equal(result.workers.length, 1, 'one decode worker')
    assert.deepEqual(result.workers.map((worker) => worker.terminated), [1], 'terminated exactly once')
    assert.ok(result.workers[0].posted >= 1, 'the frames really went to the worker')
    const { tap, stream, decoderReady, read } = result.marks
    assert.ok(tap !== undefined && stream !== undefined && decoderReady !== undefined && read !== undefined, 'all four timing marks were set')
    const scanning = result.longTasks.filter((task) => task.start >= decoderReady!)
    const worst = Math.max(0, ...scanning.map((task) => task.duration))
    console.log(`PASS the live loop reads the on-screen EAN-13 in Chrome through the worker: tap -> camera ${Math.round(stream! - tap!)} ms, -> decoder ready ${Math.round(decoderReady! - tap!)} ms, -> read ${Math.round(read! - tap!)} ms; main-thread tasks over 50 ms while scanning: ${scanning.length} (worst ${Math.round(worst)} ms)`)
    assert.ok(read! - tap! < 8_000, `tap to read took ${Math.round(read! - tap!)} ms`)
  } catch (error) {
    failed += 1
    console.error('FAIL the live loop reads the on-screen EAN-13 in Chrome through the worker')
    console.error(error)
  }

  try {
    const result = await run(false, async (browserPage) => {
      await browserPage.waitForFunction(() => performance.getEntriesByName('scanner:decoder-ready').length > 0, null, { timeout: 30_000 })
      await browserPage.waitForTimeout(3_000)
      await browserPage.evaluate(() => (window as any).__scan.camera.closeScanner())
      await browserPage.waitForTimeout(300)
      // Positive control: a deliberate 150 ms block of the main thread. It must be a
      // scheduled task: the evaluate call itself runs outside the scheduler, and
      // Chrome does not report that as a long task.
      await browserPage.evaluate(() => new Promise<void>((done) => {
        const w = window as any
        setTimeout(() => {
          w.__controlAt = performance.now()
          while (performance.now() < w.__controlAt + 150) { /* hold the main thread */ }
          done()
        }, 0)
      }))
      await browserPage.waitForTimeout(300)
    })
    assert.deepEqual(result.detected, [], 'a card with no barcode on it must never produce a read')
    assert.equal(result.closed, 1, 'closing is reported once')
    assert.deepEqual(result.streams[0].map((track) => track.readyState), result.streams[0].map(() => 'ended'), 'every camera track is ended after close')
    assert.deepEqual(result.workers.map((worker) => worker.terminated), [1], 'the worker is terminated exactly once')
    assert.ok(result.workers[0].posted >= 5, `3 s of an unreadable camera must hand the worker many frames, not ${result.workers[0].posted}; otherwise "no long task" proves nothing`)
    assert.ok(result.controlAt !== undefined, 'the control ran')
    const control = result.longTasks.filter((task) => task.start >= result.controlAt! - 50)
    assert.ok(control.some((task) => task.duration >= 100), `the observer must see a deliberate 150 ms block (saw ${JSON.stringify(control)}); otherwise "no long task" proves nothing`)
    const scanning = result.longTasks.filter((task) => task.start >= result.marks.decoderReady! && task.start < result.controlAt! - 50)
    const worst = Math.max(0, ...scanning.map((task) => task.duration))
    console.log(`PASS an unreadable camera hands the worker ${result.workers[0].posted} frames in 3 s with ${scanning.length} main-thread tasks over 50 ms (worst ${Math.round(worst)} ms), then closes clean`)
    assert.equal(scanning.length, 0, `main-thread tasks over 50 ms while scanning: ${JSON.stringify(scanning)}`)
  } catch (error) {
    failed += 1
    console.error('FAIL an unreadable camera costs the main thread nothing over 50 ms and closes clean')
    console.error(error)
  }
} finally {
  await server.close()
  rmSync(workDir, { recursive: true, force: true })
}
if (failed > 0) process.exitCode = 1
