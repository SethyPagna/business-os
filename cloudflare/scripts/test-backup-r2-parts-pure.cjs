// Pins the R2 multipart part-size contract of src/lib/backup.ts's
// R2StreamWriter -- the class every Cloudflare backup (cron, manual, section
// reset) streams its JSON through.
//
// Why this exists: from 2026-08-26 14:03Z every scheduled backup failed at
// complete() with R2 error 10048
//
//   completeMultipartUpload: All non-trailing parts must have the same length.
//
// The old writer flushed "as soon as >= 6 MiB was buffered", so each part was
// 6 MiB PLUS the overshoot of whatever string tipped it over, and consecutive
// parts differed by a few bytes. With <= 2 parts there is only one
// non-trailing part, so the rule passed trivially -- both surviving snapshots
// are two-part uploads -- and the first export needing a third part (~12 MiB)
// broke every run after it. R2 requires every non-trailing part to be
// IDENTICAL in size, not merely >= 5 MiB.
//
// Same approach as the other *-pure.cjs scripts: transpile the REAL source
// and drive the actual exported class through a fake R2MultipartUpload that
// records exactly what it was handed. Inputs are deliberately awkward:
// Khmer text and currency symbols (bytes != chars), string lengths that do
// not divide the part size, and totals that land below, across and exactly
// on part boundaries.
//
// Run: node scripts/test-backup-r2-parts-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

function load(relPath, stubs = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const Module = require('module')
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      mod.exports, require, mod, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return mod.exports
}

// backup.ts's runtime imports are ./r2 and ./backupRestoreStream; the writer
// touches neither, so they are inert stubs here (test-backup-pure.cjs
// exercises the real ones).
const { R2StreamWriter, R2_PART_BYTES } = load('lib/backup.ts', {
  './r2': {},
  './backupRestoreStream': {},
})

assert.strictEqual(typeof R2StreamWriter, 'function', 'R2StreamWriter must be exported')
assert.strictEqual(R2_PART_BYTES, 8 * 1024 * 1024, 'part size is 8 MiB')
assert.ok(R2_PART_BYTES >= 5 * 1024 * 1024 && R2_PART_BYTES <= 5 * 1024 * 1024 * 1024, 'inside R2 part bounds')

// --- fake R2MultipartUpload -----------------------------------------------

function fakeUpload() {
  const calls = { parts: [], completed: null, aborted: 0 }
  return {
    calls,
    async uploadPart(partNumber, body) {
      // R2 accepts string | ArrayBuffer | ArrayBufferView | ReadableStream |
      // Blob. Snapshot the bytes at call time (as R2 would consume them) so
      // a writer that later mutates a reused buffer would be caught.
      let bytes
      if (body instanceof Uint8Array) bytes = Uint8Array.from(body)
      else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body.slice(0))
      else if (typeof body === 'string') bytes = new TextEncoder().encode(body)
      else throw new Error(`unsupported part body ${Object.prototype.toString.call(body)}`)
      calls.parts.push({ partNumber, bytes })
      return { partNumber, etag: `etag-${partNumber}` }
    },
    async complete(parts) {
      calls.completed = parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
      return { key: 'fake', etag: 'etag-complete' }
    },
    async abort() {
      calls.aborted += 1
    },
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.bytes.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { out.set(p.bytes, offset); offset += p.bytes.byteLength }
  return out
}

// Builds a list of strings totalling exactly `targetBytes` UTF-8 bytes, from
// pieces whose byte lengths do not divide R2_PART_BYTES (72, 46, 66 and 14
// bytes, each holding 2- and/or 3-byte characters), so part boundaries fall in
// the middle of pieces and of multi-byte characters.
const PIECES = [
  '{"name":"ទឹកដោះគោ ខ្ទិះ","price":"៛12,500"},',   // Khmer + riel sign
  '{"name":"Café au lait €4.50 £3.99 ¥500"},',
  '{"sku":"A-1","note":"ស្ករ​ត្នោត ១kg $2.25"},',
  '{"x":"ab ¥"},',
]
for (const p of PIECES) {
  const bytes = encoder.encode(p).byteLength
  assert.notStrictEqual(bytes, p.length, `piece must have bytes != chars: ${p}`)
  assert.notStrictEqual(R2_PART_BYTES % bytes, 0, `piece byte length ${bytes} must not divide the part size`)
}

function buildInput(targetBytes) {
  const chunks = []
  let total = 0
  let i = 0
  while (total < targetBytes) {
    let piece = PIECES[i % PIECES.length]
    let bytes = encoder.encode(piece).byteLength
    if (total + bytes > targetBytes) {
      // Top up with ASCII so the total lands exactly on target.
      piece = 'x'.repeat(targetBytes - total)
      bytes = piece.length
    }
    chunks.push(piece)
    total += bytes
    i += 1
  }
  assert.strictEqual(total, targetBytes)
  return chunks
}

async function run(chunks) {
  const upload = fakeUpload()
  const writer = new R2StreamWriter(upload)
  for (const chunk of chunks) await writer.write(chunk)
  await writer.finish()
  return upload.calls
}

function assertContract(calls, chunks, expectedParts) {
  const input = chunks.join('')
  const inputBytes = encoder.encode(input)
  const { parts, completed } = calls
  assert.strictEqual(parts.length, expectedParts, `expected ${expectedParts} parts, got ${parts.length}`)
  // Part numbers 1..n, contiguous, uploaded in order.
  assert.deepStrictEqual(parts.map((p) => p.partNumber), parts.map((_, i) => i + 1))
  // complete() received exactly those parts, in order.
  assert.ok(completed, 'complete() must be called')
  assert.deepStrictEqual(completed.map((p) => p.partNumber), parts.map((p) => p.partNumber))
  // Every non-last part is EXACTLY one part size (R2 error 10048 otherwise).
  for (const p of parts.slice(0, -1)) {
    assert.strictEqual(p.bytes.byteLength, R2_PART_BYTES, `part ${p.partNumber} must be exactly ${R2_PART_BYTES} bytes, got ${p.bytes.byteLength}`)
  }
  // The trailing part is never empty and never a full-size-plus-overshoot.
  const last = parts[parts.length - 1]
  assert.ok(last.bytes.byteLength > 0, 'trailing part must not be zero-length')
  assert.ok(last.bytes.byteLength <= R2_PART_BYTES, 'trailing part must not exceed one part')
  // Concatenation is the exact input, byte for byte, and decodes cleanly
  // (a boundary inside a multi-byte character must not corrupt anything).
  const joined = concat(parts)
  assert.strictEqual(joined.byteLength, inputBytes.byteLength, 'total bytes must equal input bytes')
  assert.ok(Buffer.from(joined).equals(Buffer.from(inputBytes)), 'bytes must round-trip exactly')
  assert.strictEqual(decoder.decode(joined), input, 'decoded text must equal input')
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error && error.stack ? error.stack : error) }
}

;(async () => {
  await check('three-plus parts: every non-last part is exactly R2_PART_BYTES (the production failure)', async () => {
    // ~2.6 parts: the shape that failed in production once the export crossed ~12 MiB.
    const chunks = buildInput(Math.floor(R2_PART_BYTES * 2.6) + 7)
    assertContract(await run(chunks), chunks, 3)
  })

  await check('boundary lands inside a multi-byte Khmer character and still round-trips', async () => {
    // Force the first boundary to fall mid-character: fill to 1 byte before
    // the boundary with ASCII, then write a 3-byte Khmer character.
    const chunks = ['x'.repeat(R2_PART_BYTES - 1), 'ក', 'tail ៛']
    const calls = await run(chunks)
    assertContract(calls, chunks, 2)
    // The first part ends with only the first byte of the 3-byte character.
    assert.strictEqual(calls.parts[0].bytes[R2_PART_BYTES - 1], encoder.encode('ក')[0])
  })

  await check('total below one part: a single trailing part of the exact input size', async () => {
    const chunks = buildInput(12345)
    const calls = await run(chunks)
    assertContract(calls, chunks, 1)
    assert.strictEqual(calls.parts[0].bytes.byteLength, 12345)
  })

  await check('total exactly k x R2_PART_BYTES: k full parts and no empty trailing part', async () => {
    const chunks = buildInput(R2_PART_BYTES * 2)
    const calls = await run(chunks)
    assertContract(calls, chunks, 2)
    assert.strictEqual(calls.parts[1].bytes.byteLength, R2_PART_BYTES)
    assert.strictEqual(calls.completed.length, 2)
  })

  await check('total exactly one part: one full part, nothing trailing', async () => {
    const chunks = buildInput(R2_PART_BYTES)
    assertContract(await run(chunks), chunks, 1)
  })

  await check('one huge write spanning several parts is cut the same way as many small writes', async () => {
    const big = buildInput(Math.floor(R2_PART_BYTES * 3.5)).join('')
    const chunks = [big]
    assertContract(await run(chunks), chunks, 4)
  })

  await check('empty writes are ignored and never create a part', async () => {
    const chunks = ['', 'abc', '', 'ដេ']
    const calls = await run(chunks)
    assertContract(calls, chunks, 1)
  })

  await check('nothing written: complete() with no parts, no empty part uploaded (preserved behaviour)', async () => {
    const upload = fakeUpload()
    const writer = new R2StreamWriter(upload)
    await writer.finish()
    assert.strictEqual(upload.calls.parts.length, 0)
    assert.deepStrictEqual(upload.calls.completed, [])
  })

  await check('abort() calls upload.abort() and swallows an abort failure', async () => {
    const upload = fakeUpload()
    const writer = new R2StreamWriter(upload)
    await writer.write('partial')
    await writer.abort()
    assert.strictEqual(upload.calls.aborted, 1)
    assert.strictEqual(upload.calls.completed, null, 'abort must not complete')

    const failing = fakeUpload()
    failing.abort = async () => { throw new Error('network') }
    const writer2 = new R2StreamWriter(failing)
    await writer2.abort() // must not throw
  })

  await check('an uploaded part is never mutated by later writes (fresh buffer per part)', async () => {
    const upload = fakeUpload()
    const handed = []
    const origUploadPart = upload.uploadPart
    upload.uploadPart = async (n, body) => { handed.push(body); return origUploadPart(n, body) }
    const writer = new R2StreamWriter(upload)
    await writer.write('A'.repeat(R2_PART_BYTES))
    await writer.write('B'.repeat(10))
    await writer.finish()
    assert.strictEqual(handed.length, 2)
    assert.strictEqual(handed[0][0], 0x41, 'first part still starts with A after later writes')
    assert.strictEqual(handed[0][R2_PART_BYTES - 1], 0x41)
    assert.strictEqual(handed[1].byteLength, 10)
  })

  await check('writeBackupDocument-shaped document (test-backup-pure.cjs fake) survives 3 parts', async () => {
    // A sanity bridge to the other suite's fake: decode Uint8Array parts the
    // way its fake does and confirm the joined JSON parses.
    const rows = []
    let bytes = 2
    while (bytes < R2_PART_BYTES * 2.2) {
      const row = `{"id":${rows.length},"name":"ទំនិញ ${rows.length} €"}`
      rows.push(row)
      bytes += encoder.encode(row).byteLength + 1
    }
    const chunks = ['[', ...rows.map((r, i) => (i ? ',' : '') + r), ']']
    const calls = await run(chunks)
    assertContract(calls, chunks, 3)
    const json = Buffer.concat(calls.parts.map((p) => Buffer.from(p.bytes))).toString('utf8')
    assert.strictEqual(JSON.parse(json).length, rows.length)
  })

  console.log(`\n${passed} backup-r2-parts checks passed${failed ? `, ${failed} FAILED` : ''}`)
  if (failed) process.exit(1)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
