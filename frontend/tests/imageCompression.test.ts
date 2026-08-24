import assert from 'node:assert/strict'
import {
  buildCompressedFileName,
  computeTargetDimensions,
  isCompressibleImageFile,
  renameFileIfRequested,
} from '../src/utils/imageCompression.ts'

// computeTargetDimensions -- the resize decision, no DOM/Canvas involved.
assert.deepEqual(
  computeTargetDimensions(4000, 3000, 2560),
  { width: 2560, height: 1920, scaled: true },
  'oversized images are scaled down proportionally to the longest edge',
)
assert.deepEqual(
  computeTargetDimensions(800, 600, 2560),
  { width: 800, height: 600, scaled: false },
  'images already under the max dimension are left untouched',
)
assert.deepEqual(
  computeTargetDimensions(2560, 2560, 2560),
  { width: 2560, height: 2560, scaled: false },
  'an image exactly at the max dimension is not treated as needing a resize',
)

// buildCompressedFileName -- rename logic (product-name matching), no DOM.
assert.equal(
  buildCompressedFileName('My Photo.png', undefined, 'webp'),
  'My Photo.webp',
  'keeps the original base name when no rename target is given, swapping in the new extension',
)
assert.equal(
  buildCompressedFileName('IMG_00123.jpg', 'Coca-Cola 330ml', 'webp'),
  'Coca-Cola 330ml.webp',
  'renames the uploaded file to the matched product name ("same image name = same product name")',
)
assert.equal(
  buildCompressedFileName('photo.jpg', 'Weird / Name: Test*?', 'jpg'),
  'Weird-Name-Test.jpg',
  'strips path separators and control/reserved characters from a rename target, substituting a single \'-\' (Part 242) rather than a space',
)
assert.equal(
  buildCompressedFileName('', undefined, 'jpg'),
  'image.jpg',
  'falls back to a safe default name when nothing usable is available',
)

// isCompressibleImageFile -- format gate, no DOM.
assert.equal(isCompressibleImageFile({ type: 'image/jpeg', name: 'a.jpg' }), true)
assert.equal(isCompressibleImageFile({ type: 'image/png', name: 'a.png' }), true)
assert.equal(isCompressibleImageFile({ type: '', name: 'a.WEBP' }), true, 'falls back to extension when the browser gave no MIME type')
assert.equal(isCompressibleImageFile({ type: 'video/mp4', name: 'a.mp4' }), false, 'video is never treated as compressible here')
assert.equal(isCompressibleImageFile({ type: 'application/pdf', name: 'a.pdf' }), false)

console.log('PASS imageCompression pure helpers (dimensions, renaming, format gate)')

// renameFileIfRequested -- the fix for the reported "random filename" bug:
// a file must be renamed to the product name even when it is never
// recompressed (already small, no savings, unsupported browser, encode
// failure) -- every path that used to bail out with the untouched original
// file needs this applied too, not just the "compression succeeded" branch.
const original = new File([new Uint8Array([1, 2, 3])], 'IMG_00987.JPG', { type: 'image/jpeg' })
const renamed = renameFileIfRequested(original, 'Coca-Cola 330ml')
assert.equal(renamed.name, 'Coca-Cola 330ml.jpg', 'renames the file to the product name, keeping the original extension (lowercased), without re-encoding')
assert.equal(renamed.type, 'image/jpeg', 'preserves the original mime type when only renaming')
assert.equal(renamed.size, original.size, 'preserves the original bytes when only renaming (no re-encode)')

const untouched = renameFileIfRequested(original, undefined)
assert.equal(untouched, original, 'returns the exact same File instance when no rename target is given')

const alreadyNamed = new File([new Uint8Array([1])], 'Coca-Cola 330ml.jpg', { type: 'image/jpeg' })
assert.equal(renameFileIfRequested(alreadyNamed, 'Coca-Cola 330ml'), alreadyNamed, 'is a no-op when the file already has the target name')

console.log('PASS imageCompression renameFileIfRequested fallback path')
