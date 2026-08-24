// Standalone unit tests for src/lib/zipReader.ts -- pure-JS ZIP reader used
// by the ZIP-based bulk image import route. No D1/wrangler dependency (pure
// module), so this transpiles and loads the real file directly, same
// technique as test-import-image-match.cjs.
//
// Builds real ZIP archives at test time (both compression method 0/stored
// and method 8/deflate, plus deliberately-malformed buffers) using Node's
// zlib and a hand-rolled ZIP writer, so this exercises the actual binary
// parsing path rather than mocking it away.
//
// Run: node scripts/test-zip-reader.cjs

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'zipReader.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'zipReader.ts',
})

const moduleObj = { exports: {} }
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))

const { readCentralDirectory, isRealFileEntry, extractZipEntry, ZipFormatError } = moduleObj.exports

// --- Node < 18's global scope lacks DecompressionStream/Blob/Response in
// some setups; this repo's target runtime (workerd) always has them, but
// guard here so the test gives a clear message instead of a cryptic
// ReferenceError on an unusual Node build.
assert.ok(typeof DecompressionStream !== 'undefined', 'This Node build lacks global DecompressionStream -- use Node 18+')

// --- Minimal ZIP writer (local file header + central directory + EOCD),
// just enough to produce archives this reader should accept. CRC32 via
// zlib.crc32 (Node 20.12+) with a manual fallback table for older Node.
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip(files) {
  // files: [{ name, data: Buffer, method: 0|8 }]
  const localChunks = []
  const centralChunks = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const rawData = file.data
    const method = file.method
    const payload = method === 8 ? zlib.deflateRawSync(rawData) : rawData
    const crc = crc32(rawData)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed
    localHeader.writeUInt16LE(0, 6) // flags
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(0, 10) // mod time
    localHeader.writeUInt16LE(0, 12) // mod date
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(payload.length, 18)
    localHeader.writeUInt32LE(rawData.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra length

    localChunks.push(localHeader, nameBuf, payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(0, 8) // flags
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(0, 12) // mod time
    centralHeader.writeUInt16LE(0, 14) // mod date
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(payload.length, 20)
    centralHeader.writeUInt32LE(rawData.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra length
    centralHeader.writeUInt16LE(0, 32) // comment length
    centralHeader.writeUInt16LE(0, 34) // disk number
    centralHeader.writeUInt16LE(0, 36) // internal attrs
    centralHeader.writeUInt32LE(file.externalAttrs || 0, 38)
    centralHeader.writeUInt32LE(offset, 42) // local header offset

    centralChunks.push(centralHeader, nameBuf)

    offset += localHeader.length + nameBuf.length + payload.length
  }

  const localSection = Buffer.concat(localChunks)
  const centralSection = Buffer.concat(centralChunks)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk with central dir
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralSection.length, 12)
  eocd.writeUInt32LE(localSection.length, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([localSection, centralSection, eocd])
}

async function run() {
  // 1. Round-trip: one stored entry, one deflated entry, a directory entry,
  // and a macOS junk entry -- covers isRealFileEntry filtering too.
  const jpgData = Buffer.from('fake-jpeg-bytes-'.repeat(50), 'utf8')
  const pngData = Buffer.from('fake-png-bytes-'.repeat(80), 'utf8')
  const zip = buildZip([
    { name: 'photos/', data: Buffer.alloc(0), method: 0, externalAttrs: 0x10 },
    { name: 'photos/product-1.jpg', data: jpgData, method: 0 },
    { name: 'photos/product-2.png', data: pngData, method: 8 },
    { name: '__MACOSX/photos/._product-1.jpg', data: Buffer.from('junk'), method: 0 },
    { name: 'photos/.DS_Store', data: Buffer.from('junk'), method: 0 },
  ])

  const entries = readCentralDirectory(zip)
  assert.strictEqual(entries.length, 5, 'should read all 5 central directory entries')

  const realEntries = entries.filter(isRealFileEntry)
  assert.strictEqual(realEntries.length, 2, 'isRealFileEntry should filter out the dir, __MACOSX, and .DS_Store entries')
  assert.deepStrictEqual(realEntries.map((e) => e.fileName).sort(), ['photos/product-1.jpg', 'photos/product-2.png'])

  const stored = entries.find((e) => e.fileName === 'photos/product-1.jpg')
  const deflated = entries.find((e) => e.fileName === 'photos/product-2.png')
  assert.strictEqual(stored.compressionMethod, 0)
  assert.strictEqual(deflated.compressionMethod, 8)

  const storedOut = await extractZipEntry(zip, stored)
  assert.strictEqual(Buffer.from(storedOut).toString('utf8'), jpgData.toString('utf8'), 'stored entry should extract byte-identical')

  const deflatedOut = await extractZipEntry(zip, deflated)
  assert.strictEqual(Buffer.from(deflatedOut).toString('utf8'), pngData.toString('utf8'), 'deflated entry should decompress byte-identical')

  const dirEntry = entries.find((e) => e.fileName === 'photos/')
  assert.strictEqual(dirEntry.isDirectory, true, 'trailing-slash entry should be flagged as a directory')

  // 2. Malformed input handling -- every failure mode should throw
  // ZipFormatError specifically (the import route branches on this type
  // to report a clean per-file error instead of a raw exception).
  assert.throws(() => readCentralDirectory(Buffer.from('too small')), ZipFormatError, 'tiny buffer should fail with ZipFormatError')
  assert.throws(() => readCentralDirectory(Buffer.alloc(100)), ZipFormatError, 'buffer with no EOCD signature should fail with ZipFormatError')

  const truncated = zip.subarray(0, zip.length - 30)
  assert.throws(() => readCentralDirectory(truncated), ZipFormatError, 'truncated central directory should fail with ZipFormatError')

  // 3. Decompression-bomb guard: claimed uncompressed size over the cap
  // must be rejected before any decompression is attempted.
  const bombEntry = { ...deflated, uncompressedSize: 200 * 1024 * 1024 }
  await assert.rejects(() => extractZipEntry(zip, bombEntry), ZipFormatError, 'oversized uncompressedSize should be rejected before decompressing')

  // 4. Size-mismatch guard: a compressed payload that decompresses to a
  // different size than the central directory claims should be caught,
  // not silently accepted (guards against a corrupted/crafted entry).
  const lyingEntry = { ...deflated, uncompressedSize: deflated.uncompressedSize + 1 }
  await assert.rejects(() => extractZipEntry(zip, lyingEntry), ZipFormatError, 'decompressed-size mismatch should be rejected')

  console.log('zipReader.ts: all assertions passed (' + entries.length + ' entries parsed, stored + deflate round-trip, 4 malformed-input cases)')
}

run().catch((error) => {
  console.error('zipReader.ts test FAILED:', error)
  process.exitCode = 1
})
