// Scanner S1b (6.0.935): ZXing and the whole decode ladder run in a Worker.
//
// Before: the camera loop, the ladder and ZXing shared the main thread. The first
// ladder step always ran (12-80 ms of ZXing per view, by the code's own
// measurement) and the next tick waited as long as the last one took, so about
// half the main thread was spent decoding; each tick allocated about 1 MB of
// grayscale and the contrast pass 15 MB of float tables.
//
// This proves the worker's side with the real ZXing readers (through Vite's SSR
// loader, like barcodeRetailDecoder): the frame handler decodes a drawn EAN-13
// and misses a blank frame, the arrays it keeps between frames never leak one
// frame into the next, the script's message wiring works, and nothing the main
// thread loads can reach the ladder or ZXing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createServer } from 'vite'
import type { DecodeReply, DecodeRequest, PixelFrame } from '../src/components/products/scanning/barcodeFrameDecoder.ts'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scanningDir = join(frontendRoot, 'src/components/products/scanning')
const SCANNING = '/src/components/products/scanning'

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// --- fixtures: EAN-13 modules ("1" = bar) -> a grayscale frame -> RGBA --------

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = L.map((code) => code.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0')))
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

function ean13Modules(code: string): string {
  const d = [...code].map(Number)
  const left = d.slice(1, 7).map((digit, i) => (PARITY[d[0]][i] === 'L' ? L : G)[digit]).join('')
  return `101${left}01010${d.slice(7).map((digit) => R[digit]).join('')}101`
}

const WIDTH = (95 + 24) * 3
const HEIGHT = 60

function lumaOfCode(code: string, { turned = false } = {}): { data: Uint8ClampedArray; width: number; height: number } {
  const columns = `${'0'.repeat(12)}${ean13Modules(code)}${'0'.repeat(12)}`
  const data = new Uint8ClampedArray(WIDTH * HEIGHT).fill(255)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let c = 0; c < columns.length; c += 1) if (columns[c] === '1') data.fill(0, y * WIDTH + c * 3, y * WIDTH + (c + 1) * 3)
  }
  if (!turned) return { data, width: WIDTH, height: HEIGHT }
  // A quarter turn, so the bars run across the frame.
  const out = new Uint8ClampedArray(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) out[x * HEIGHT + (HEIGHT - 1 - y)] = data[y * WIDTH + x]
  return { data: out, width: HEIGHT, height: WIDTH }
}

function toPixels(luma: { data: Uint8ClampedArray; width: number; height: number }): PixelFrame {
  const data = new Uint8ClampedArray(luma.width * luma.height * 4)
  for (let i = 0; i < luma.data.length; i += 1) data.fill(luma.data[i], i * 4, i * 4 + 3), (data[i * 4 + 3] = 255)
  return { data, width: luma.width, height: luma.height }
}

const eanFrame = (code: string, options?: { turned?: boolean }) => toPixels(lumaOfCode(code, options))
const blankFrame = (value = 255): PixelFrame => toPixels({ data: new Uint8ClampedArray(WIDTH * HEIGHT).fill(value), width: WIDTH, height: HEIGHT })
const request = (id: number, centre: PixelFrame, full?: PixelFrame, tryHarder = false): DecodeRequest => ({ id, centre, full, tryHarder })

const vite = await createServer({
  root: frontendRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  cacheDir: join(tmpdir(), 'business-os-scanner-decode-worker-vite'),
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  ssr: { noExternal: ['@zxing/library'] },
  plugins: [{
    // Lets one test make the worker script's ZXing import fail at build time.
    name: 'zxing-failure',
    enforce: 'pre',
    resolveId(id, importer) {
      if ((globalThis as { __failZxing?: boolean }).__failZxing && /barcodeZxing\.ts$/.test(id) && /barcodeDecode\.worker\.ts$/.test(importer || '')) return '\0failing-zxing'
      return null
    },
    load(id) {
      return id === '\0failing-zxing' ? "export function createLumaDecoder() { throw new Error('zxing missing') }" : null
    },
  }],
})

type Handler = typeof import('../src/components/products/scanning/barcodeDecodeHandler.ts')
type Zxing = typeof import('../src/components/products/scanning/barcodeZxing.ts')
type Ladder = typeof import('../src/components/products/scanning/barcodeLadder.ts')

try {
  const { createDecodeHandler } = await vite.ssrLoadModule(`${SCANNING}/barcodeDecodeHandler.ts`) as Handler
  const { createLumaDecoder } = await vite.ssrLoadModule(`${SCANNING}/barcodeZxing.ts`) as Zxing
  const ladder = await vite.ssrLoadModule(`${SCANNING}/barcodeLadder.ts`) as Ladder
  const decoder = createLumaDecoder()
  const read = (id: number, text: string): DecodeReply => ({ type: 'read', id, read: { text, format: 'ean_13' } })

  await runTest('the frame handler decodes a drawn EAN-13 and answers with the request id', () => {
    const reply = createDecodeHandler(decoder).handle(request(7, eanFrame('5901234123457')))
    assert.deepEqual(reply, read(7, '5901234123457'))
  })

  await runTest('the frame handler reports a blank frame as a plain miss, white or black', () => {
    const handler = createDecodeHandler(decoder)
    assert.deepEqual(handler.handle(request(1, blankFrame(255))), { type: 'read', id: 1, read: null })
    assert.deepEqual(handler.handle(request(2, blankFrame(0), blankFrame(0), true)), { type: 'read', id: 2, read: null })
  })

  await runTest('a code standing on its end is read through the rotated steps', () => {
    const reply = createDecodeHandler(decoder).handle(request(3, eanFrame('4006381333931', { turned: true })))
    assert.deepEqual(reply, read(3, '4006381333931'))
  })

  await runTest('a code outside the guide is found only when the whole picture is sent too', () => {
    const handler = createDecodeHandler(decoder)
    const code = eanFrame('5901234123457')
    assert.deepEqual(handler.handle(request(4, blankFrame())), { type: 'read', id: 4, read: null }, 'a guide-only frame with nothing in it has nothing to find')
    assert.deepEqual(handler.handle(request(5, blankFrame(), code)), read(5, '5901234123457'), 'the same code in the whole-picture region is read')
  })

  await runTest('a read ZXing makes but the shop would not accept (bad check digit) is a miss', () => {
    // 5901234123456 is the right EAN-13 with its check digit changed.
    assert.deepEqual(createDecodeHandler(decoder).handle(request(6, eanFrame('5901234123456'))), { type: 'read', id: 6, read: null })
  })

  await runTest('a decoder fault is reported with the request id, and the handler keeps working', () => {
    let calls = 0
    const handler = createDecodeHandler(() => {
      calls += 1
      if (calls === 1) throw new Error('reader exploded')
      if (calls === 2) throw 'not an Error'
      return { text: '5901234123457', format: 'ean_13' }
    })
    assert.deepEqual(handler.handle(request(8, blankFrame())), { type: 'failed', id: 8, message: 'reader exploded' })
    assert.deepEqual(handler.handle(request(9, blankFrame())), { type: 'failed', id: 9, message: 'The barcode decoder failed.' })
    assert.deepEqual(handler.handle(request(10, blankFrame())), read(10, '5901234123457'))
  })

  await runTest('arrays kept between frames never leak one frame into the next: a mixed sequence reads the same as fresh handlers', () => {
    const shared = createDecodeHandler(decoder)
    const sequence: Array<[PixelFrame, PixelFrame | undefined, string | null]> = [
      [eanFrame('5901234123457'), undefined, '5901234123457'],
      [blankFrame(), undefined, null],
      [eanFrame('4006381333931', { turned: true }), undefined, '4006381333931'],
      [blankFrame(255), blankFrame(0), null],
      [eanFrame('5901234123457'), eanFrame('4006381333931'), '5901234123457'],
      [blankFrame(), undefined, null],
      [eanFrame('4006381333931', { turned: true }), undefined, '4006381333931'],
    ]
    sequence.forEach(([centre, full, expected], index) => {
      const fresh = createDecodeHandler(decoder).handle(request(index, centre, full))
      const reused = shared.handle(request(index, centre, full))
      assert.deepEqual(reused, fresh, `frame ${index}: the reused handler must answer what a fresh one does`)
      assert.deepEqual(reused, { type: 'read', id: index, read: expected && { text: expected, format: 'ean_13' } })
    })
  })

  // A kept summed-area table is only valid if its first row and column are zero.
  // The rotated view of a frame has the same table LENGTH but another stride, so
  // the first frame's cells land where the second expects zeros.
  await runTest('the integral tables of a kept array are cleared at their edges: a rotated view of the same size matches a fresh one', () => {
    let seed = 11
    const noise = new Uint8ClampedArray(100 * 50).map(() => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) & 255 })
    const upright = { data: noise, width: 100, height: 50 }
    const turned = ladder.rotateQuarter(upright)
    for (const transform of [ladder.thresholdLocalMean, ladder.normalizeLocalContrast]) {
      const scratch = ladder.createScratch()
      transform(upright, scratch, 'first')
      const afterPoison = transform(turned, scratch, 'second')
      const fresh = transform(turned, ladder.FRESH_ARRAYS, 'second')
      assert.deepEqual([...afterPoison.data], [...fresh.data], `${transform.name} on a kept table must equal a fresh one`)
    }
  })

  await runTest('Scratch keeps an array while its slot and length are asked for again, and hands out a new one when either changes', () => {
    const scratch = ladder.createScratch()
    const first = scratch.array('gray', Uint8ClampedArray, 16)
    assert.equal(scratch.array('gray', Uint8ClampedArray, 16), first, 'same slot, same length: the same array')
    assert.notEqual(scratch.array('other', Uint8ClampedArray, 16), first, 'another slot never shares an array')
    const longer = scratch.array('gray', Uint8ClampedArray, 32)
    assert.notEqual(longer, first)
    assert.equal(longer.length, 32)
    assert.notEqual(ladder.FRESH_ARRAYS.array('gray', Uint8ClampedArray, 16), ladder.FRESH_ARRAYS.array('gray', Uint8ClampedArray, 16), 'the fresh allocator never reuses')
  })

  // --- the worker script itself ------------------------------------------------

  const scope = globalThis as unknown as { self?: unknown }
  async function runWorkerScript(failZxing: boolean) {
    const posted: DecodeReply[] = []
    const listeners: Array<(event: { data: DecodeRequest }) => void> = []
    scope.self = {
      postMessage: (message: DecodeReply) => { posted.push(message) },
      addEventListener: (_type: string, listener: (event: { data: DecodeRequest }) => void) => { listeners.push(listener) },
    }
    ;(globalThis as { __failZxing?: boolean }).__failZxing = failZxing
    vite.moduleGraph.invalidateAll()
    try {
      await vite.ssrLoadModule(`${SCANNING}/barcodeDecode.worker.ts`)
    } finally {
      delete scope.self
      ;(globalThis as { __failZxing?: boolean }).__failZxing = false
    }
    return { posted, listeners }
  }

  await runTest('the worker script says ready once ZXing is built, then answers each message with the handler\'s reply', async () => {
    const { posted, listeners } = await runWorkerScript(false)
    assert.deepEqual(posted, [{ type: 'ready' }])
    assert.equal(listeners.length, 1)
    listeners[0]({ data: request(21, eanFrame('5901234123457')) })
    assert.deepEqual(posted[1], read(21, '5901234123457'))
    listeners[0]({ data: request(22, blankFrame()) })
    assert.deepEqual(posted[2], { type: 'read', id: 22, read: null })
  })

  await runTest('a worker whose ZXing cannot be built says so instead of going silent, and answers no frames', async () => {
    const { posted, listeners } = await runWorkerScript(true)
    assert.deepEqual(posted, [{ type: 'failed', message: 'zxing missing' }])
    assert.equal(listeners.length, 0, 'no message listener is left behind a decoder that does not exist')
  })
} catch (error) {
  // The checks below read source and still run when the worker-side modules do not load.
  failed += 1
  console.error('FAIL the worker-side modules could not be loaded, so the decoder tests above did not run')
  console.error(error)
} finally {
  await vite.close()
}

// --- nothing on the main thread can reach the ladder or ZXing -----------------

// The files a page loads, and the packages they import, by following every import
// (static, dynamic and re-export; type-only ones are erased) the way the bundler
// would. A `new Worker(new URL(...))` is not an import: the worker is a separate script.
function importClosure(entry: string): { files: Set<string>; packages: Set<string> } {
  const seen = new Set<string>()
  const packages = new Set<string>()
  const visit = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const specifiers: string[] = []
    const walk = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : undefined
        const typeOnly = ts.isImportDeclaration(node)
          ? Boolean(clause?.isTypeOnly)
          : node.isTypeOnly
        const allNamedTypeOnly = Boolean(clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly))
        if (!typeOnly && !allNamedTypeOnly) specifiers.push(node.moduleSpecifier.text)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        specifiers.push(node.arguments[0].text)
      }
      ts.forEachChild(node, walk)
    }
    walk(ast)
    for (const specifier of specifiers.filter((value) => !value.startsWith('.'))) packages.add(specifier)
    for (const specifier of specifiers.filter((value) => value.startsWith('.'))) {
      const base = resolve(dirname(file), specifier)
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
        .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      assert.ok(target, `unresolved import: ${file} -> ${specifier}`)
      visit(target)
    }
  }
  visit(join(frontendRoot, entry))
  return { files: seen, packages }
}

const WORKER_SIDE = ['barcodeLadder.ts', 'barcodeZxing.ts', 'barcodeDecodeHandler.ts', 'barcodeDecode.worker.ts']
const inScanning = (name: string) => join(scanningDir, name)

await runTest('the walker sees the worker script reach the ladder, the handler and ZXing (positive control)', () => {
  const { files, packages } = importClosure('src/components/products/scanning/barcodeDecode.worker.ts')
  for (const name of WORKER_SIDE.filter((file) => file !== 'barcodeDecode.worker.ts')) assert.ok(files.has(inScanning(name)), `${name} is reachable from the worker script`)
  assert.ok([...packages].some((name) => name.startsWith('@zxing/')), 'and it imports ZXing')
})

await runTest('nothing the main thread loads can reach the ladder, the handler, the worker script or ZXing', () => {
  for (const entry of [
    'src/components/products/scanning/BarcodeScannerModal.tsx',
    'src/components/products/scanning/useBarcodeCamera.ts',
    'src/components/products/scanning/barcodeImageScanner.ts',
    'src/components/products/scanning/scannerWarmup.ts',
    'src/components/shared/ScanSearchButton.tsx',
  ]) {
    const { files, packages } = importClosure(entry)
    for (const name of WORKER_SIDE) assert.ok(!files.has(inScanning(name)), `${entry} must not import ${name}: it would pull the decoder back onto the main thread`)
    assert.deepEqual([...packages].filter((name) => name.startsWith('@zxing/')), [], `${entry} must not reach ZXing, whatever the file is called`)
  }
})

await runTest('no runDecodeLadder( or loadLumaDecoder( is left on the main thread, and only decodeWorkerClient starts the worker', () => {
  const mainThread = fs.readdirSync(scanningDir).filter((name) => /\.tsx?$/.test(name) && !WORKER_SIDE.includes(name))
  assert.ok(mainThread.includes('BarcodeScannerModal.tsx'), 'the main-thread files were found')
  for (const name of mainThread) {
    const source = fs.readFileSync(join(scanningDir, name), 'utf8')
    assert.doesNotMatch(source, /\brunDecodeLadder\(|\bloadLumaDecoder\(|\bcreateLumaDecoder\(/, `${name} decodes on the main thread`)
    if (name !== 'decodeWorkerClient.ts') assert.doesNotMatch(source, /new Worker\(/, `${name} must start the worker through decodeWorkerClient`)
  }
  assert.ok(mainThread.includes('useBarcodeCamera.ts') && mainThread.includes('decodeWorkerClient.ts'), 'the camera hook and the worker client are the main-thread side of the split')
  assert.match(
    fs.readFileSync(join(scanningDir, 'decodeWorkerClient.ts'), 'utf8'),
    /new Worker\(new URL\('\.\/barcodeDecode\.worker\.ts', import\.meta\.url\), \{ type: 'module' \}\)/,
    'the literal form Vite recognises and bundles as a worker',
  )
})

await runTest('the warm-up every page loads reaches the worker client only through a dynamic import, so it adds nothing to startup', () => {
  const warmup = fs.readFileSync(join(scanningDir, 'scannerWarmup.ts'), 'utf8')
  assert.doesNotMatch(warmup, /^import[^\n]*decodeWorkerClient/m, 'a static import would put the client in the always-loaded chunk (+1.8 KB raw on every route, the storefront included)')
  assert.match(warmup, /import\('\.\/decodeWorkerClient\.ts'\)\.then\(\(client\) => client\.warmDecodeClient\(\)\)/)
})

if (failed > 0) process.exitCode = 1
