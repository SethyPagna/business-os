// Real-browser proof for the scanner's decode ladder (lane 6.0.877).
//
// Owner report, 20 Oct 2026: a Dior box held upright -- its EAN-13 standing on
// end, printed dark on silver foil with glare -- would not scan. The default
// ZXing reader thresholds each row on that row's own histogram (so the pale
// label on a dark box reads as blank) and, fed RGB pixels, never rotates.
//
// 1. The owner's photo, read from the Records folder where it is kept. It is
//    private: never copied into the repo. Absent file = SKIP, not failure.
// 2. Self-contained fixtures drawn on a canvas here: EAN-13 at ~17% luminance
//    difference, turned 90 degrees, under a glare gradient, blurred and
//    noisy. Each case first asserts the default reader MISSES it, so a fixture
//    that became too easy fails instead of passing vacuously.
// Each case also runs the live loop on the on-screen guide area the modal decodes (S1a), not just the photo centre.
// Prints per-frame decode times, default reader vs ladder tick.
//
// Run: node tests/barcodeLowContrastBrowser.test.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer, transformWithEsbuild } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const ownerPhoto = process.env.SCANNER_OWNER_PHOTO
  || 'C:/Users/mrkl6/Downloads/Projects/BusinessOS/Records/Consolidation/2026-10-20/scanner-fixtures/dior-silver-vertical-3348901729222.webp'
const hasOwnerPhoto = existsSync(ownerPhoto)
// The decoder imports the retail readers by deep path; pre-bundling them up
// front keeps a mid-run dependency discovery from reloading the page.
const ZXING_DEEP_IMPORTS = [
  'core/BarcodeFormat', 'core/DecodeHintType', 'core/BinaryBitmap', 'core/RGBLuminanceSource', 'core/common/HybridBinarizer',
  'core/NotFoundException', 'core/ChecksumException', 'core/FormatException',
  'core/oned/OneDReader', 'core/oned/MultiFormatUPCEANReader', 'core/oned/Code39Reader', 'core/oned/Code128Reader', 'core/oned/ITFReader',
].map((name) => `@zxing/library/esm/${name}`)

const fixture = String.raw`
import { BrowserMultiFormatReader } from '@zxing/browser'
import { scanBarcodeFromImageFile } from '/src/components/products/scanning/barcodeImageScanner.ts'
import { SCAN_GUIDE_BOX, createFrameGrabber, createReadConfirmer, loadLumaDecoder, runDecodeLadder } from '/src/components/products/scanning/barcodeFrameDecoder.ts'

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
function ean13Modules(code) {
  let modules = '101'
  for (let i = 1; i <= 6; i += 1) modules += (PARITY[+code[0]][i - 1] === 'L' ? L : G)[+code[i]]
  modules += '01010'
  for (let i = 7; i <= 12; i += 1) modules += L[+code[i]].replace(/./g, (bit) => bit === '0' ? '1' : '0')
  return modules + '101'
}

// A pale label on a dark box, bars only ~17% darker than the label.
function drawFixture({ width = 1280, height = 720, code, module = 4, rotate = true, label = 200, bar = 165, glare = 0.5, noise = 6, blur = 0.8 }) {
  const bits = ean13Modules(code)
  const lw = (bits.length + 22) * module
  const lh = Math.round(lw * 0.45)
  const tag = document.createElement('canvas')
  tag.width = lw; tag.height = lh
  const t = tag.getContext('2d')
  t.fillStyle = 'rgb(' + label + ',' + label + ',' + (label + 4) + ')'; t.fillRect(0, 0, lw, lh)
  t.fillStyle = 'rgb(' + bar + ',' + bar + ',' + (bar + 6) + ')'
  for (let i = 0; i < bits.length; i += 1) if (bits[i] === '1') t.fillRect((11 + i) * module, lh * 0.08, module, lh * 0.84)
  const sharp = document.createElement('canvas')
  sharp.width = width; sharp.height = height
  const s = sharp.getContext('2d')
  s.fillStyle = '#2a2d3a'; s.fillRect(0, 0, width, height)
  s.save(); s.translate(width / 2, height / 2); if (rotate) s.rotate(Math.PI / 2); s.drawImage(tag, -lw / 2, -lh / 2); s.restore()
  const shine = s.createLinearGradient(0, 0, width, height)
  shine.addColorStop(0, 'rgba(255,255,255,0)'); shine.addColorStop(0.55, 'rgba(255,255,255,' + glare + ')'); shine.addColorStop(1, 'rgba(255,255,255,0)')
  s.fillStyle = shine; s.fillRect(0, 0, width, height)
  const out = document.createElement('canvas')
  out.width = width; out.height = height
  const o = out.getContext('2d', { willReadFrequently: true })
  o.filter = 'blur(' + blur + 'px)'; o.drawImage(sharp, 0, 0); o.filter = 'none'
  const pixels = o.getImageData(0, 0, width, height)
  let seed = 7
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) >>> 0
    const n = ((seed >>> 16) % (2 * noise + 1)) - noise
    pixels.data[i] += n; pixels.data[i + 1] += n; pixels.data[i + 2] += n
  }
  o.putImageData(pixels, 0, 0)
  return out
}

function defaultReaderMs(source) {
  const reader = new BrowserMultiFormatReader()
  const started = performance.now()
  let text = ''
  try { text = reader.decodeFromCanvas(source).getText() } catch (_) {}
  return { text, ms: performance.now() - started }
}

// The live loop: one 40 ms ladder tick per frame, two agreeing reads to win.
// guide is the on-screen scan box the modal decodes (none: a photo's centre).
async function liveTicks(source, maxTicks = 40, guide) {
  const decode = await loadLumaDecoder()
  const grab = createFrameGrabber(guide)
  const confirm = createReadConfirmer()
  let step = 0
  const tickMs = []
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const started = performance.now()
    const { read, nextStep } = runDecodeLadder(grab(source, source.width, source.height), decode, { startStep: step, deadline: Date.now() + 40 })
    step = nextStep
    const won = confirm(read, 'zxing')
    tickMs.push(performance.now() - started)
    if (won) return { text: won, ticks: tick, tickMs }
  }
  return { text: '', ticks: maxTicks, tickMs }
}

const canvasFile = (canvas, name) => new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], name, { type: 'image/png' })), 'image/png'))
const noNative = { getNativeBarcodeDetector: () => null }

window.runScannerCases = async (withPhoto) => {
  const results = []
  if (withPhoto) {
    const blob = await (await fetch('/__owner-photo')).blob()
    const image = new Image()
    image.src = URL.createObjectURL(blob)
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
    const before = defaultReaderMs(canvas)
    const started = performance.now()
    let photo = ''
    try { photo = await scanBarcodeFromImageFile(new File([blob], 'dior.webp', { type: blob.type }), noNative) } catch (error) { photo = 'ERROR ' + error.message }
    const photoMs = performance.now() - started
    const live = await liveTicks(canvas)
    const guided = await liveTicks(canvas, 40, SCAN_GUIDE_BOX)
    results.push({ name: 'owner photo (Dior, silver foil, vertical)', expected: '3348901729222', before, photo, photoMs, live, guided })
  }
  const cases = [
    { name: 'EAN-13 turned 90deg, 17% contrast, glare, 1280x720', code: '5901234123457' },
    { name: 'EAN-13 turned 90deg, 17% contrast, glare, 1920x1080', code: '4006381333931', width: 1920, height: 1080 },
    { name: 'EAN-13 upright, 17% contrast, glare, 1280x720', code: '5901234123457', rotate: false },
    { name: 'EAN-13 turned 90deg, 15% contrast, glare, 3px modules', code: '4006381333931', module: 3, bar: 170 },
  ]
  for (const options of cases) {
    const canvas = drawFixture(options)
    const before = defaultReaderMs(canvas)
    const started = performance.now()
    let photo = ''
    try { photo = await scanBarcodeFromImageFile(await canvasFile(canvas, 'fixture.png'), noNative) } catch (error) { photo = 'ERROR ' + error.message }
    const photoMs = performance.now() - started
    const live = await liveTicks(canvas)
    const guided = await liveTicks(canvas, 40, SCAN_GUIDE_BOX)
    results.push({ name: options.name, expected: options.code, before, photo, photoMs, live, guided })
  }
  return results
}
window.__scannerFixtureReady = true
`

const server = await createServer({
  root, logLevel: 'error',
  // The decoder is a dynamic import; optimising it up front, in a cache no
  // other test shares, stops a mid-run re-optimisation from invalidating the
  // page's module URLs.
  cacheDir: join(tmpdir(), 'business-os-scanner-low-contrast-vite'),
  optimizeDeps: { include: ['@zxing/library', '@zxing/browser', ...ZXING_DEEP_IMPORTS] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(join(root, 'node_modules'))] } },
  plugins: [{
    name: 'scanner-low-contrast', enforce: 'pre',
    resolveId(id) { return id === 'virtual:scanner-low-contrast' ? '\0scanner-low-contrast' : null },
    async load(id) {
      if (id === '\0scanner-low-contrast') return (await transformWithEsbuild(fixture, 'fixture.js', { loader: 'js' })).code
      return null
    },
    configureServer(app) {
      app.middlewares.use('/__owner-photo', (_request, response) => {
        response.setHeader('content-type', 'image/webp')
        response.end(readFileSync(ownerPhoto))
      })
      app.middlewares.use('/scanner-low-contrast', async (_request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end(await app.transformIndexHtml('/scanner-low-contrast', '<!doctype html><html><body><script type="module" src="/@id/virtual:scanner-low-contrast"></script></body></html>'))
      })
    },
  }],
})
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => candidate && existsSync(candidate))
await server.listen()
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let failed = 0
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const page = await browser.newPage()
  const address = server.httpServer!.address() as { port: number }
  // A loaded machine can take minutes to optimise dependencies on first load.
  await page.goto(`http://127.0.0.1:${address.port}/scanner-low-contrast`, { timeout: 240_000 })
  await page.waitForFunction(() => (window as any).__scannerFixtureReady === true, null, { timeout: 240_000 })
  if (!hasOwnerPhoto) console.log(`SKIP owner photo case: ${ownerPhoto} is not on this machine (private fixture, never in the repo)`)
  const results = await page.evaluate((withPhoto) => (window as any).runScannerCases(withPhoto), hasOwnerPhoto) as Array<{
    name: string
    expected: string
    before: { text: string; ms: number }
    photo: string
    photoMs: number
    live: { text: string; ticks: number; tickMs: number[] }
    guided: { text: string; ticks: number; tickMs: number[] }
  }>
  const ms = (value: number) => `${Math.round(value)} ms`
  for (const result of results) {
    try {
      assert.notEqual(result.before.text, result.expected, `${result.name}: the default ZXing reader must miss this fixture, or it no longer proves anything`)
      assert.equal(result.photo, result.expected, `${result.name}: the photo path must read the barcode`)
      assert.equal(result.live.text, result.expected, `${result.name}: the live loop must confirm the barcode`)
      assert.equal(result.guided.text, result.expected, `${result.name}: the live loop decoding the on-screen guide area must confirm the barcode`)
      const worstTick = Math.max(...result.live.tickMs)
      console.log(`PASS ${result.name}: default reader ${result.before.text ? `read ${result.before.text}` : 'missed'} in ${ms(result.before.ms)}/frame; photo path ${ms(result.photoMs)}; live loop confirmed in ${result.live.ticks} ticks, guide area in ${result.guided.ticks} (avg ${ms(result.live.tickMs.reduce((a, b) => a + b, 0) / result.live.tickMs.length)}, worst ${ms(worstTick)}/tick)`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${result.name}`)
      console.error(error)
      console.error(JSON.stringify(result))
    }
  }
  assert.equal(results.length, hasOwnerPhoto ? 5 : 4, 'every case must report')
} finally {
  await browser?.close()
  await server.close()
}
if (failed > 0) process.exitCode = 1
