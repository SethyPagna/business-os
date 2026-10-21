// Scanner S1a (6.0.922): the engine changes are wired where the app can see them.
//
// The behaviour is proved elsewhere (barcodeScanRoi, barcodeNativePlan,
// scannerWarmup, barcodeRetailDecoder, barcodeScannerState). This file pins the
// seams a refactor could cut without turning those red:
//  - ZXing is imported by deep path from one place, never from the package root
//    (the root drags the QR/DataMatrix/PDF417/Aztec/RSS decoders into the chunk);
//  - @zxing/browser is a test-only dependency, so it is a devDependency and the
//    third-party notices (runtime packages only) do not list it;
//  - both scan buttons start the warm-up on pointerdown;
//  - the modal's loop uses the pure engine helpers and the new camera constraint;
//  - the built vendor-zxing chunk fits its budget (skipped without a build).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts: string[]) => fs.readFileSync(path.join(frontend, ...parts), 'utf8')

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
  const decoder = read('src', 'components', 'products', 'scanning', 'barcodeFrameDecoder.ts')
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

runTest('the modal runs the loop on the engine helpers: planned native formats, guided pick, timed ZXing join, 30 fps camera, marks', () => {
  const modal = read('src', 'components', 'products', 'scanning', 'BarcodeScannerModal.tsx')
  assert.match(modal, /frameRate: \{ ideal: 30 \}/)
  assert.doesNotMatch(modal, /frameRate: \{[^}]*max:/, '30 fps is a preference, never a hard limit that can stop the camera opening')
  assert.match(modal, /planNativeFormats\(await nativeSupportedFormats\(\)\)/, 'the native detector is built from the planned formats')
  assert.match(modal, /NativeBarcodeDetector && nativeFormats\.length/, 'no retail formats means no native detector')
  assert.match(modal, /pickNativeRead\(results \|\| \[\], guide\)/, 'a native pass is resolved against the guide')
  assert.match(modal, /zxingHeadStartOver\(nativeStartedAtRef\.current, Date\.now\(\)\)/, 'ZXing joins after a fixed head start')
  assert.doesNotMatch(modal, /NATIVE_MISSES_BEFORE_ZXING|nativeMissesRef/, 'the empty-frame count is gone')
  assert.doesNotMatch(modal, /RETAIL_BARCODE_FORMATS/, 'the modal no longer papers over an empty format list with the full retail list')
  assert.match(modal, /nextScanAtRef\.current = now \+ NATIVE_TICK_INTERVAL_MS/, 'the native cadence is the shared constant')
  for (const step of ['stream', 'decoder-ready', 'read']) assert.ok(modal.includes(`markScanner('${step}')`), `scanner:${step} must be marked`)
  assert.equal((modal.match(/markScanner\('decoder-ready'\)/g) || []).length, 2, 'native and ZXing paths both mark decoder-ready')
  // A scan still only fills the caller's query: the value is emitted as read.
  assert.match(modal, /onDetected\(nextValue\)/)
  assert.doesNotMatch(modal, /replace\(\/\^0|padStart|parseInt|Number\(nextValue\)/, 'the scanner must not normalise the code')
})

runTest('the camera is released on every exit path that existed before (cleanup still stops the stream)', () => {
  const modal = read('src', 'components', 'products', 'scanning', 'BarcodeScannerModal.tsx')
  const cleanup = modal.slice(modal.indexOf('const cleanup = useCallback'), modal.indexOf('const completeDetection'))
  assert.match(cleanup, /stopStream\(streamRef\.current\)/)
  assert.match(cleanup, /nativeStartedAtRef\.current = 0/, 'the head-start clock is reset with the rest of the session')
  for (const caller of ['const closeScanner', 'const openPhotoPicker', 'handleVisibility', 'handlePageHide', 'watchCameraPermission']) {
    assert.ok(modal.includes(caller), `${caller} exit path still present`)
  }
})

runTest('built vendor-zxing chunk is at most 180 KB raw and carries no MultiFormatReader (skipped without a build)', () => {
  const assets = path.join(frontend, 'dist', 'assets')
  if (!fs.existsSync(assets)) {
    console.log('  (skipped: no frontend/dist -- run `npm run build` first)')
    return
  }
  const chunks = fs.readdirSync(assets).filter((name) => /^vendor-zxing-[\w-]{8}\.js$/.test(name))
  assert.equal(chunks.length, 1, `expected one vendor-zxing chunk, found ${chunks.join(', ') || 'none'}`)
  const bytes = fs.statSync(path.join(assets, chunks[0])).size
  console.log(`  measured: ${chunks[0]} ${bytes} bytes raw`)
  assert.ok(bytes <= 180_000, `vendor-zxing is ${bytes} bytes raw; the budget is 180,000 (it was 448,115 with the package root)`)
  assert.doesNotMatch(fs.readFileSync(path.join(assets, chunks[0]), 'utf8'), /No MultiFormat Readers were able to detect the code/, 'MultiFormatReader is in the chunk')
})

if (failed > 0) process.exitCode = 1
