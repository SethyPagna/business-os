// Server-side privacy regression for portal screenshot encodings.
// Run from cloudflare/: node scripts/test-portal-image-privacy-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'portalImagePrivacy.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
})
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
  moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
)
const { sanitizePortalImageMetadata } = moduleObj.exports

const asText = (value) => Buffer.from(value).toString('latin1')
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

function jpegSegment(marker, payload) {
  const out = Buffer.alloc(payload.length + 4)
  out[0] = 0xff
  out[1] = marker
  out.writeUInt16BE(payload.length + 2, 2)
  Buffer.from(payload).copy(out, 4)
  return out
}

function exifWithOrientationAndSentinel(orientation, sentinel) {
  return Buffer.concat([
    Buffer.from('Exif\0\0', 'latin1'),
    Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00,
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
      orientation, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]),
    Buffer.from(sentinel, 'latin1'),
  ])
}

check('JPEG removes EXIF/IPTC/comments, keeps scan bytes, and preserves only orientation', () => {
  const sentinel = 'GPS=11.5564,104.9282;Artist=private-person'
  const scan = Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x11, 0x22, 0xff, 0, 0x33, 0xff, 0xd9])
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, exifWithOrientationAndSentinel(6, sentinel)),
    jpegSegment(0xed, Buffer.from(`IPTC ${sentinel}`)),
    jpegSegment(0xfe, Buffer.from(`Comment ${sentinel}`)),
    scan,
  ])
  const result = sanitizePortalImageMetadata(jpeg)
  assert.ok(result)
  assert.strictEqual(result.contentType, 'image/jpeg')
  assert.doesNotMatch(asText(result.bytes), /GPS=|Artist=|private-person|IPTC|Comment/)
  assert.ok(Buffer.from(result.bytes).subarray(-scan.length).equals(scan), 'compressed scan bytes changed')
  const text = asText(result.bytes)
  assert.strictEqual((text.match(/Exif\0\0/g) || []).length, 1, 'expected one minimized EXIF segment')
  assert.ok(Buffer.from(result.bytes).includes(Buffer.from([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 6, 0, 0, 0])), 'orientation 6 was not retained')
})

check('PNG removes text/EXIF chunks and keeps the valid pixel-data chunk', () => {
  const base = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  const sentinel = Buffer.from('Comment\0GPS=private-location')
  const chunk = Buffer.alloc(12 + sentinel.length)
  chunk.writeUInt32BE(sentinel.length, 0)
  chunk.write('tEXt', 4, 'ascii')
  sentinel.copy(chunk, 8)
  const input = Buffer.concat([base.subarray(0, -12), chunk, base.subarray(-12)])
  const result = sanitizePortalImageMetadata(input)
  assert.ok(result)
  assert.strictEqual(result.contentType, 'image/png')
  assert.doesNotMatch(asText(result.bytes), /GPS=private-location|tEXt/)
  assert.ok(Buffer.from(result.bytes).includes(Buffer.from('IDAT')), 'pixel data was removed')
})

function webpChunk(type, payload) {
  const pad = payload.length % 2
  const out = Buffer.alloc(8 + payload.length + pad)
  out.write(type, 0, 'ascii')
  out.writeUInt32LE(payload.length, 4)
  Buffer.from(payload).copy(out, 8)
  return out
}

check('WebP removes EXIF/XMP/ICC chunks and fixes the RIFF size and flags', () => {
  const vp8x = Buffer.from([0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const body = Buffer.concat([
    webpChunk('VP8X', vp8x),
    webpChunk('EXIF', Buffer.from('GPS=private-location')),
    webpChunk('XMP ', Buffer.from('Artist=private-person')),
    webpChunk('ICCP', Buffer.from('profile-name')),
    webpChunk('VP8 ', Buffer.from([1, 2, 3, 4])),
  ])
  const input = Buffer.alloc(12 + body.length)
  input.write('RIFF', 0, 'ascii')
  input.writeUInt32LE(input.length - 8, 4)
  input.write('WEBP', 8, 'ascii')
  body.copy(input, 12)
  const result = sanitizePortalImageMetadata(input)
  assert.ok(result)
  assert.strictEqual(result.contentType, 'image/webp')
  assert.doesNotMatch(asText(result.bytes), /EXIF|XMP |ICCP|private-/)
  assert.strictEqual(Buffer.from(result.bytes).readUInt32LE(4), result.bytes.length - 8)
  assert.strictEqual(result.bytes[20] & 0x2c, 0, 'removed metadata flags remain set')
})

check('animated GIF keeps its image/loop blocks while removing comments and vendor extensions', () => {
  const base = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  const comment = Buffer.from([0x21, 0xfe, 0x12, ...Buffer.from('private GPS Artist'), 0x00])
  const vendor = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('PRIVATEAPP1'), 0x03, 1, 2, 3, 0])
  const input = Buffer.concat([base.subarray(0, -1), comment, vendor, base.subarray(-1)])
  const result = sanitizePortalImageMetadata(input)
  assert.ok(result)
  assert.strictEqual(result.contentType, 'image/gif')
  assert.doesNotMatch(asText(result.bytes), /private|GPS|Artist|PRIVATEAPP/i)
  assert.ok(Buffer.from(result.bytes).includes(Buffer.from([0x2c])), 'image descriptor was removed')
})

check('malformed or mislabeled bytes fail closed', () => {
  assert.strictEqual(sanitizePortalImageMetadata(Buffer.from('not an image')), null)
  const truncatedPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 99])
  assert.strictEqual(sanitizePortalImageMetadata(truncatedPng), null)
})

console.log(`PASS ${passed} portal image privacy checks`)
