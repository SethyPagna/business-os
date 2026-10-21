// Scanner S1a (6.0.922): the press that opens the scanner starts the work the
// camera does not need to wait for.
//
// Before: BarcodeDetector.getSupportedFormats() was awaited only after the
// video was playing (a slow first call, on the critical path), and on iOS and
// desktop the ZXing chunk was fetched only after that. Now warmScanner() runs
// on pointerdown, in parallel with getUserMedia, and every press after the first
// finds the answers cached.
//
// Runs the real module through Vite's SSR loader, with a fake window, so the
// ZXing fetch it starts is observable as modules entering the module graph.
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WARMUP = '/src/components/products/scanning/scannerWarmup.ts'

const vite = await createServer({
  root: frontendRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  // Not the shared node_modules/.vite: this test must not write into the
  // junction every worktree reads.
  cacheDir: join(tmpdir(), 'business-os-scanner-warmup-vite'),
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  // SSR loading only: no browser dependency scan of the whole app.
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ['@zxing/library'] },
})

let failed = 0
async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Warmup = typeof import('../src/components/products/scanning/scannerWarmup.ts')

// Fresh module state (the formats cache and the fetch-started flag are
// per-module) and a fake window for each scenario.
async function loadWarmup(detector: unknown): Promise<Warmup> {
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: detector === undefined ? {} : { BarcodeDetector: detector } })
  vite.moduleGraph.invalidateAll()
  return await vite.ssrLoadModule(WARMUP) as Warmup
}

// invalidateAll() clears ssrModule on every node but keeps the node, so "loaded" is ssrModule, not presence.
const moduleLoaded = (pattern: RegExp) => [...vite.moduleGraph.idToModuleMap.values()].some((node) => pattern.test(node.id || '') && node.ssrModule)

// warmScanner() starts a fetch it does not report; let it land before the next
// scenario invalidates the module graph or the server closes under it.
async function settleFetch() {
  const decoder = await vite.ssrLoadModule('/src/components/products/scanning/barcodeFrameDecoder.ts') as { prefetchZxing: () => Promise<void> }
  await decoder.prefetchZxing()
}

async function until(condition: () => boolean, label: string, timeoutMs = 15000) {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  }
}

try {
  await runTest('the first warm-up starts fetching the retail ZXing readers, with no scan asking for them yet', async () => {
    class Detector {
      static async getSupportedFormats() { return ['ean_13'] }
    }
    const warmup = await loadWarmup(Detector)
    assert.equal(moduleLoaded(/oned[\\/]Code128Reader/), false, 'nothing is fetched before the press')
    warmup.warmScanner()
    await until(() => moduleLoaded(/oned[\\/]Code128Reader/) && moduleLoaded(/oned[\\/]MultiFormatUPCEANReader/), 'the retail readers to load')
    await settleFetch()
    assert.equal(moduleLoaded(/[\\/]qrcode[\\/]/), false, 'the warm-up must not pull in the QR decoder')
  })

  await runTest('three warm-ups ask the native detector for its supported formats exactly once', async () => {
    let calls = 0
    class Detector {
      static async getSupportedFormats() { calls += 1; return ['qr_code', 'ean_13'] }
    }
    const warmup = await loadWarmup(Detector)
    warmup.warmScanner()
    warmup.warmScanner()
    warmup.warmScanner()
    assert.deepEqual(await warmup.nativeSupportedFormats(), ['qr_code', 'ean_13'])
    // The scanner opening afterwards reads the same cached answer.
    assert.deepEqual(await warmup.nativeSupportedFormats(), ['qr_code', 'ean_13'])
    assert.equal(calls, 1, 'one getSupportedFormats call across three warm-ups and two reads')
    await settleFetch()
  })

  await runTest('no BarcodeDetector in this browser: the answer is [] (ZXing does the work) and nothing is cached against a later detector', async () => {
    const warmup = await loadWarmup(undefined)
    assert.deepEqual(await warmup.nativeSupportedFormats(), [])
    class Late {
      static async getSupportedFormats() { return ['ean_13'] }
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { BarcodeDetector: Late } })
    assert.deepEqual(await warmup.nativeSupportedFormats(), ['ean_13'])
  })

  await runTest('a detector that cannot list its formats answers null, so the scanner assumes the retail ones', async () => {
    class Unlisted {}
    const warmup = await loadWarmup(Unlisted)
    assert.equal(await warmup.nativeSupportedFormats(), null)
  })

  await runTest('a detector whose getSupportedFormats throws falls back to ZXing, says so once, and is not asked again', async () => {
    let calls = 0
    class Broken {
      static async getSupportedFormats(): Promise<string[]> { calls += 1; throw new Error('service unavailable') }
    }
    const warmup = await loadWarmup(Broken)
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { logged.push(args) }
    try {
      warmup.warmScanner()
      assert.deepEqual(await warmup.nativeSupportedFormats(), [])
      assert.deepEqual(await warmup.nativeSupportedFormats(), [])
    } finally {
      console.error = original
    }
    await settleFetch()
    assert.equal(calls, 1)
    assert.equal(logged.length, 1, 'the failure is reported, not swallowed')
    assert.match(String(logged[0][0]), /could not list its formats/)
  })

  await runTest('each press marks scanner:tap, keeping only the latest; the other steps mark on demand', async () => {
    const warmup = await loadWarmup(class { static async getSupportedFormats() { return [] } })
    performance.clearMarks()
    warmup.warmScanner()
    warmup.warmScanner()
    assert.equal(performance.getEntriesByName('scanner:tap').length, 1, 'two presses leave one tap mark, the latest')
    for (const step of ['stream', 'decoder-ready', 'read'] as const) {
      assert.equal(performance.getEntriesByName(`scanner:${step}`).length, 0)
      warmup.markScanner(step)
      assert.equal(performance.getEntriesByName(`scanner:${step}`).length, 1)
    }
    performance.clearMarks()
    await settleFetch()
  })
} finally {
  await vite.close()
  delete (globalThis as { window?: unknown }).window
}

if (failed > 0) process.exitCode = 1
