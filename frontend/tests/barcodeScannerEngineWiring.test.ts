// Scanner S1a (6.0.922) and S1b (6.0.935): the engine changes are wired where the
// app can see them.
//
// The behaviour is proved elsewhere (barcodeScanRoi, barcodeNativePlan,
// scannerWarmup, barcodeRetailDecoder, barcodeDecodeWorker, barcodeScannerState,
// barcodeCameraCleanup). This file pins the seams a refactor could cut without
// turning those red:
//  - ZXing is imported by deep path from one place, never from the package root
//    (the root drags the QR/DataMatrix/PDF417/Aztec/RSS decoders into the chunk),
//    and that place is worker-only;
//  - @zxing/browser is a test-only dependency, so it is a devDependency and the
//    third-party notices (runtime packages only) do not list it;
//  - both scan buttons start the warm-up on pointerdown;
//  - the camera loop (useBarcodeCamera.ts) uses the pure engine helpers and the
//    new camera constraint;
//  - the built decode worker fits its budget and is the only built file that
//    carries ZXing (skipped without a build).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts: string[]) => fs.readFileSync(path.join(frontend, ...parts), 'utf8')
const scanning = ['src', 'components', 'products', 'scanning']

let failed = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [full] : []
  })
}

runTest('no source file imports @zxing/library from its package root, or @zxing/browser at all', () => {
  const offenders: string[] = []
  for (const file of sourceFiles(path.join(frontend, 'src'))) {
    const source = fs.readFileSync(file, 'utf8')
    // A quoted specifier that ENDS at the package name is the root; deep paths continue with a slash.
    if (/['"`]@zxing\/library['"`]/.test(source)) offenders.push(`${path.relative(frontend, file)} imports the @zxing/library root`)
    if (/['"`]@zxing\/browser(?:\/[^'"`]*)?['"`]/.test(source)) offenders.push(`${path.relative(frontend, file)} imports @zxing/browser`)
  }
  assert.deepEqual(offenders, [])
})

runTest('the decoder reaches ZXing only through deep retail-reader paths', () => {
  const decoder = read(...scanning, 'barcodeZxing.ts')
  const specifiers = [...decoder.matchAll(/['"](@zxing\/library[^'"]*)['"]/g)].map((match) => match[1])
  assert.ok(specifiers.length >= 12, `expected the retail readers and their support classes, got ${specifiers.length}`)
  for (const specifier of specifiers) assert.match(specifier, /^@zxing\/library\/esm\/core\//, `${specifier} is not a deep core path`)
  const names = specifiers.map((specifier) => specifier.split('/').pop())
  for (const reader of ['MultiFormatUPCEANReader', 'Code128Reader', 'Code39Reader', 'ITFReader', 'HybridBinarizer', 'RGBLuminanceSource']) {
    assert.ok(names.includes(reader), `${reader} must be imported`)
  }
  for (const heavy of ['MultiFormatReader', 'MultiFormatOneDReader', 'QRCodeReader', 'DataMatrixReader', 'PDF417Reader', 'AztecReader', 'RSS14Reader', 'Code93Reader', 'CodaBarReader']) {
    assert.ok(!names.includes(heavy), `${heavy} must not be imported`)
  }
})

runTest('only the worker-side decoder file imports ZXing, so nothing on the main thread can', () => {
  const importers = sourceFiles(path.join(frontend, 'src'))
    .filter((file) => /['"`]@zxing\//.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(path.join(frontend, 'src'), file).replace(/\\/g, '/'))
  assert.deepEqual(importers, ['components/products/scanning/barcodeZxing.ts'])
})

runTest('@zxing/browser is a devDependency (tests only) and @zxing/library stays a runtime dependency', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.devDependencies['@zxing/browser'], '0.2.0')
  assert.equal(pkg.dependencies['@zxing/browser'], undefined)
  assert.ok(pkg.dependencies['@zxing/library'], '@zxing/library is what the scanner ships')

  const lock = JSON.parse(read('package-lock.json'))
  const root = lock.packages['']
  assert.equal(root.devDependencies['@zxing/browser'], '0.2.0')
  assert.equal(root.dependencies['@zxing/browser'], undefined)
  assert.equal(lock.packages['node_modules/@zxing/browser'].dev, true, 'the lock must mark it dev-only')
  assert.equal(lock.packages['node_modules/@zxing/library'].dev, undefined, '@zxing/library is not dev-only')

  const notices = read('public', 'THIRD_PARTY_NOTICES.txt')
  assert.doesNotMatch(notices, /@zxing\/browser@/, 'runtime-only notices must not list a test-only package')
  assert.match(notices, /@zxing\/library@0\.22\.0 \(Apache-2\.0\)/)
})

runTest('both scan buttons start the warm-up on pointerdown, beside the modal preload', () => {
  const wiring = /onPointerDown=\{\(\) => \{ preloadBarcodeScannerModal\(\); warmScanner\(\) \}\}/
  for (const [name, file] of [
    ['ScanSearchButton', ['src', 'components', 'shared', 'ScanSearchButton.tsx']],
    ['ProductForm barcode field', ['src', 'components', 'products', 'forms', 'ProductForm.tsx']],
  ] as const) {
    const source = read(...file)
    assert.match(source, /import \{ warmScanner \} from '[^']*scanning\/scannerWarmup\.ts'/, `${name} imports the warm-up`)
    assert.match(source, wiring, `${name} must warm the engine on pointerdown`)
    assert.equal((source.match(/warmScanner\(\)/g) || []).length, 1, `${name}: one warm-up trigger, on the press only`)
  }
})

runTest('the camera loop runs on the engine helpers: planned native formats, guided pick, timed ZXing join, 30 fps camera, marks', () => {
  const camera = read(...scanning, 'useBarcodeCamera.ts')
  const modal = read(...scanning, 'BarcodeScannerModal.tsx')
  assert.match(camera, /frameRate: \{ ideal: 30 \}/)
  assert.doesNotMatch(camera, /frameRate: \{[^}]*max:/, '30 fps is a preference, never a hard limit that can stop the camera opening')
  assert.match(camera, /planNativeFormats\(await nativeSupportedFormats\(\)\)/, 'the native detector is built from the planned formats')
  assert.match(camera, /NativeBarcodeDetector && nativeFormats\.length/, 'no retail formats means no native detector')
  assert.match(camera, /pickNativeRead\(results \|\| \[\], guide\)/, 'a native pass is resolved against the guide')
  assert.match(camera, /zxingHeadStartOver\(nativeStartedAtRef\.current, Date\.now\(\)\)/, 'ZXing joins after a fixed head start')
  assert.doesNotMatch(camera + modal, /NATIVE_MISSES_BEFORE_ZXING|nativeMissesRef/, 'the empty-frame count is gone')
  assert.doesNotMatch(camera + modal, /RETAIL_BARCODE_FORMATS/, 'the scanner no longer papers over an empty format list with the full retail list')
  assert.match(camera, /nextScanAtRef\.current = now \+ scanIntervalMs\(.*NATIVE_TICK_INTERVAL_MS/, 'the native cadence is the shared constant, slowed by the idle policy')
  for (const step of ['stream', 'decoder-ready', 'read']) assert.ok(camera.includes(`markScanner('${step}')`), `scanner:${step} must be marked`)
  assert.equal((camera.match(/markScanner\('decoder-ready'\)/g) || []).length, 1, 'decoder-ready is marked in one place')
  assert.equal((camera.match(/beginScanning\(video\)/g) || []).length, 2, 'the native path and the worker path both mark decoder-ready by beginning the scan')
  // A scan still only fills the caller's query: the value is emitted as read.
  assert.match(camera, /onDetected\(nextValue\)/)
  assert.doesNotMatch(camera, /replace\(\/\^0|padStart|parseInt|Number\(nextValue\)/, 'the scanner must not normalise the code')
})

runTest('the camera is released on every exit path that existed before (cleanup still stops the stream, and now the worker)', () => {
  const camera = read(...scanning, 'useBarcodeCamera.ts')
  const modal = read(...scanning, 'BarcodeScannerModal.tsx')
  const cleanup = camera.slice(camera.indexOf('const cleanup = useCallback'), camera.indexOf('const parkCamera'))
  assert.match(cleanup, /stopStream\(streamRef\.current\)/)
  assert.match(cleanup, /nativeStartedAtRef\.current = 0/, 'the head-start clock is reset with the rest of the session')
  assert.match(cleanup, /clientRef\.current\?\.terminate\(\)/, 'the decode worker ends with the camera session')
  assert.match(cleanup, /cancelFrameRef\.current\?\.\(\)/, 'the pending frame callback is cancelled')
  assert.match(cleanup, /idleRef\.current\?\.stop\(\)/, 'the idle clock stops with the session')
  for (const caller of ['const closeScanner', 'const parkCamera', 'handleVisibility', 'handlePageHide', 'watchCameraPermission']) {
    assert.ok(camera.includes(caller), `${caller} exit path still present`)
  }
  assert.match(modal, /const openPhotoPicker = useCallback\(\(\): void => \{\s*if \(photoBusy\) return\s*parkCamera\(\)/, 'the photo picker still releases the camera first')
})

runTest('built: ZXing is carried only by the decode worker, which fits 180 KB and has no MultiFormatReader (skipped without a build)', () => {
  const assets = path.join(frontend, 'dist', 'assets')
  if (!fs.existsSync(assets)) {
    console.log('  (skipped: no frontend/dist -- run `npm run build` first)')
    return
  }
  // DecodeHintType's enum survives minification and exists nowhere but ZXing.
  const zxingMark = /ASSUME_CODE_39_CHECK_DIGIT/
  const files = fs.readdirSync(assets).filter((name) => name.endsWith('.js'))
  const worker = files.filter((name) => /^barcodeDecode\.worker-[\w-]{8}\.js$/.test(name))
  assert.equal(worker.length, 1, `expected one decode worker asset, found ${worker.join(', ') || 'none'}`)
  const holders = files.filter((name) => zxingMark.test(fs.readFileSync(path.join(assets, name), 'utf8')))
  const vendorChunks = files.filter((name) => /^vendor-zxing-[\w-]{8}\.js$/.test(name))
  assert.ok(holders.includes(worker[0]), 'positive control: the worker really carries ZXing')
  assert.deepEqual(holders.filter((name) => name !== worker[0] && !vendorChunks.includes(name)), [], 'no chunk the page loads at startup or with the modal may carry ZXing')
  for (const name of files.filter((file) => file !== worker[0])) {
    const source = fs.readFileSync(path.join(assets, name), 'utf8')
    for (const vendor of vendorChunks) assert.ok(!source.includes(vendor), `${name} references ${vendor}; only the worker may`)
  }
  const bytes = holders.reduce((sum, name) => sum + fs.statSync(path.join(assets, name)).size, 0)
  console.log(`  measured: ${holders.join(' + ')} ${bytes} bytes raw`)
  assert.ok(bytes <= 180_000, `the worker side of the scanner is ${bytes} bytes raw; the budget is 180,000 (ZXing alone was 448,115 with the package root)`)
  const workerSource = fs.readFileSync(path.join(assets, worker[0]), 'utf8')
  assert.doesNotMatch(workerSource, /No MultiFormat Readers were able to detect the code/, 'MultiFormatReader is in the worker')
  // A worker is a separate script: whatever it needs is inside it.
  assert.doesNotMatch(workerSource, /(?:^|[;}])\s*import\s*[\w{*"']|\bimport\s*\(/, 'the decode worker must be self-contained')
  // The page reaches it by URL, from one of the files that does not carry ZXing.
  const referrers = files.filter((name) => fs.readFileSync(path.join(assets, name), 'utf8').includes(`/assets/${worker[0]}`))
  assert.ok(referrers.length >= 1 && !referrers.includes(worker[0]), 'something starts the worker by URL')
})

if (failed > 0) process.exitCode = 1
