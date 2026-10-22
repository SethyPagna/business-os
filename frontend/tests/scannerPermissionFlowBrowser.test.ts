// Real-browser proof for the camera permission flow (lane 6.0.953, owner 22 Oct 2026: "make sure
// that barcode scanner don't ask for allow ... if it doesn't load then it asks").
//
// Everything else about this flow is proved over a fake camera in tests/scannerCameraScenarios.test.ts.
// This runs the real useBarcodeCamera hook in Chrome with its fake camera, so the claims that rest on
// what the browser does are measured, not assumed:
//
//   1. An allowed camera opens with ONE getUserMedia call and nothing on the page asks for anything.
//   2. Hiding the page ends every camera track in the same task as the visibilitychange event, and
//      coming back opens the camera again with no tap (the real browser accepts a gesture-less start).
//   3. Closing the scanner ends every track in the same task as the close.
//   4. A remembered camera that no longer exists is not an error in Chrome: the preference is an
//      `ideal`, so ONE call opens the default camera. (The app still has a fallback for browsers that
//      reject it; that path is in the scenarios test.)
//   5. A browser that blocks the prompt (--deny-permission-prompts) is reported as a block at once,
//      after one request, and never retried by itself.
//
// Run: node tests/scannerPermissionFlowBrowser.test.ts
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))

const ZXING_DEEP_IMPORTS = [
  'core/BarcodeFormat', 'core/DecodeHintType', 'core/BinaryBitmap', 'core/RGBLuminanceSource', 'core/common/HybridBinarizer',
  'core/NotFoundException', 'core/ChecksumException', 'core/FormatException',
  'core/oned/OneDReader', 'core/oned/MultiFormatUPCEANReader', 'core/oned/Code39Reader', 'core/oned/Code128Reader', 'core/oned/ITFReader',
].map((name) => `@zxing/library/esm/${name}`)

// The page: the real hook with a plain <video>, and its state published for the test to read.
const page = String.raw`
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useBarcodeCamera } from '/src/components/products/scanning/useBarcodeCamera.ts'

const messages = { scanUnsupported: 'unsupported', cameraDocumentBlocked: 'document-blocked', cameraPermissionBlocked: 'blocked', cameraBusy: 'busy', scanFailed: 'failed', scanPromptDismissed: 'dismissed' }
const state = window.__scan = { status: 'starting', error: '', camera: null }

function Page() {
  const camera = useBarcodeCamera({ open: true, messages, onDetected: () => {}, onClose: () => {} })
  state.camera = camera
  state.status = camera.status
  state.error = camera.error
  const live = camera.status === 'starting' || camera.status === 'scanning'
  return React.createElement('div', { style: { width: '360px', height: '380px', position: 'relative', overflow: 'hidden', background: '#000' } },
    live ? React.createElement('video', { ref: camera.videoRef, muted: true, autoPlay: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'cover' } }) : null)
}

createRoot(document.getElementById('root')).render(React.createElement(Page))
window.__scannerPageReady = true
`

// Recorded before any page script runs: every getUserMedia call and the stream it returned.
const instrumentation = `
window.__requests = 0
window.__streams = []
const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
navigator.mediaDevices.getUserMedia = async (constraints) => {
  window.__requests += 1
  const stream = await getUserMedia(constraints)
  window.__streams.push(stream)
  return stream
}
// The page is "hidden" or "visible" as the test says; the hook reads document.visibilityState.
let visibility = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
window.__setVisibility = (state) => { visibility = state; document.dispatchEvent(new Event('visibilitychange')) }
window.__trackStates = () => window.__streams.map((stream) => stream.getTracks().map((track) => track.readyState))
`

const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => candidate && existsSync(candidate))
const workDir = mkdtempSync(join(tmpdir(), 'bos-permission-flow-'))

const server = await createServer({
  root, logLevel: 'error',
  cacheDir: join(tmpdir(), 'business-os-scanner-live-camera-vite'),
  optimizeDeps: { include: ['react', 'react-dom/client', ...ZXING_DEEP_IMPORTS] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'scanner-permission-flow', enforce: 'pre',
    resolveId(id) { return id === 'virtual:scanner-permission-flow' ? '\0scanner-permission-flow' : null },
    async load(id) {
      if (id === '\0scanner-permission-flow') return (await transformWithEsbuild(page, 'page.js', { loader: 'js' })).code
      return null
    },
    configureServer(app) {
      app.middlewares.use('/scanner-permission-flow', async (_request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end(await app.transformIndexHtml('/scanner-permission-flow', '<!doctype html><html><body><div id="root"></div><script type="module" src="/@id/virtual:scanner-permission-flow"></script></body></html>'))
      })
    },
  }],
})
await server.listen()
const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`

interface Scenario {
  /** Chrome's own prompt: auto-accepted (a granted camera) or auto-blocked. */
  prompt: 'accept' | 'block'
  /** localStorage before the page loads. */
  storage?: Record<string, string>
}

async function run(scenario: Scenario, during: (browserPage: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--use-fake-device-for-media-stream',
      scenario.prompt === 'accept' ? '--use-fake-ui-for-media-stream' : '--deny-permission-prompts',
    ],
  })
  try {
    const context = await browser.newContext()
    if (scenario.prompt === 'accept') await context.grantPermissions(['camera'], { origin })
    const browserPage = await context.newPage()
    browserPage.on('pageerror', (error) => { throw error })
    await browserPage.addInitScript(instrumentation)
    if (scenario.storage) await browserPage.addInitScript((entries) => { for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value) }, scenario.storage)
    // A loaded machine can take minutes to optimise dependencies on first load.
    await browserPage.goto(`${origin}/scanner-permission-flow`, { timeout: 240_000 })
    await browserPage.waitForFunction(() => (window as any).__scannerPageReady === true, null, { timeout: 240_000 })
    await during(browserPage)
  } finally {
    await browser.close()
  }
}

const requests = (browserPage: Page) => browserPage.evaluate(() => (window as any).__requests as number)
const trackStates = (browserPage: Page) => browserPage.evaluate(() => (window as any).__trackStates() as string[][])
const bodyText = (browserPage: Page) => browserPage.evaluate(() => document.body.innerText.trim())
const waitForStatus = (browserPage: Page, wanted: string) =>
  browserPage.waitForFunction((expected) => (window as any).__scan.status === expected, wanted, { timeout: 30_000 })

let failed = 0
async function runTest(name: string, scenario: Scenario, during: (browserPage: Page) => Promise<void>): Promise<void> {
  try {
    await run(scenario, during)
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

try {
  await runTest('an allowed camera opens with one request and the page asks for nothing', { prompt: 'accept' }, async (browserPage) => {
    await waitForStatus(browserPage, 'scanning')
    assert.equal(await requests(browserPage), 1, 'one getUserMedia call')
    assert.equal(await bodyText(browserPage), '', 'no text on the page: no "allow", no "start"')
    assert.deepEqual(await trackStates(browserPage), [['live']])
  })

  await runTest('hiding the page ends the track in the same task, and coming back opens the camera again with no tap', { prompt: 'accept' }, async (browserPage) => {
    await waitForStatus(browserPage, 'scanning')
    const whileHidden = await browserPage.evaluate(() => {
      const w = window as any
      w.__setVisibility('hidden')
      return w.__trackStates() as string[][]
    })
    assert.deepEqual(whileHidden, [['ended']], 'every track ended inside the visibilitychange event itself')
    await browserPage.evaluate(() => (window as any).__setVisibility('visible'))
    await waitForStatus(browserPage, 'scanning')
    assert.equal(await requests(browserPage), 2, 'the camera was requested again by the page itself')
    assert.deepEqual(await trackStates(browserPage), [['ended'], ['live']], 'the second camera is running')
    assert.equal(await bodyText(browserPage), '', 'and nothing was shown or asked on the way')
  })

  await runTest('closing the scanner ends every track in the same task as the close', { prompt: 'accept' }, async (browserPage) => {
    await waitForStatus(browserPage, 'scanning')
    const atClose = await browserPage.evaluate(() => {
      const w = window as any
      w.__scan.camera.closeScanner()
      return w.__trackStates() as string[][]
    })
    assert.deepEqual(atClose, [['ended']])
  })

  await runTest('a remembered camera that is gone opens the default camera with one request and no error', { prompt: 'accept', storage: { 'business-os-scanner-camera-v1': 'this-camera-was-unplugged' } }, async (browserPage) => {
    await waitForStatus(browserPage, 'scanning')
    assert.equal(await requests(browserPage), 1, 'a preference that cannot be met is not an error')
    assert.equal(await bodyText(browserPage), '')
  })

  await runTest('a browser that blocks the prompt is a block at once: one request, then the block line, and no retry by itself', { prompt: 'block' }, async (browserPage) => {
    await waitForStatus(browserPage, 'blocked')
    assert.equal(await requests(browserPage), 1, 'one request, no loop')
    assert.equal(await browserPage.evaluate(() => (window as any).__scan.error as string), 'blocked')
    await browserPage.waitForTimeout(1_500)
    assert.equal(await requests(browserPage), 1, 'still one: nothing retries a block')
  })
} finally {
  await server.close()
  rmSync(workDir, { recursive: true, force: true })
}
if (failed > 0) process.exitCode = 1
