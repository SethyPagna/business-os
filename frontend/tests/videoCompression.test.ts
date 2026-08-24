import assert from 'node:assert/strict'
import { buildCompressedVideoFileName, compressVideoFile, isCompressibleVideoFile } from '../src/utils/videoCompression.ts'

// isCompressibleVideoFile -- format gate, no DOM/ffmpeg involved.
assert.equal(isCompressibleVideoFile({ type: 'video/mp4', name: 'a.mp4' }), true)
assert.equal(isCompressibleVideoFile({ type: 'video/quicktime', name: 'a.mov' }), true)
assert.equal(isCompressibleVideoFile({ type: 'video/webm', name: 'a.webm' }), true)
assert.equal(isCompressibleVideoFile({ type: '', name: 'clip.MOV' }), true, 'falls back to extension when the browser gave no MIME type')
assert.equal(isCompressibleVideoFile({ type: '', name: 'clip.mkv' }), true)
assert.equal(isCompressibleVideoFile({ type: 'video/x-custom-codec', name: 'clip.xyz' }), true, 'any video/* MIME is accepted even off the known-extension list')
assert.equal(isCompressibleVideoFile({ type: 'image/jpeg', name: 'a.jpg' }), false, 'images are never treated as compressible here')
assert.equal(isCompressibleVideoFile({ type: 'application/pdf', name: 'a.pdf' }), false)
assert.equal(isCompressibleVideoFile({ type: '', name: 'a' }), false, 'no MIME and no recognizable extension is rejected')

console.log('PASS videoCompression isCompressibleVideoFile format gate')

// buildCompressedVideoFileName -- rename logic mirrors imageCompression's
// buildCompressedFileName, but always lands on .mp4 (the one format this
// module ever outputs), regardless of the source extension.
assert.equal(
  buildCompressedVideoFileName('My Clip.mov', undefined),
  'My Clip.mp4',
  'keeps the original base name when no rename target is given, swapping in .mp4',
)
assert.equal(
  buildCompressedVideoFileName('IMG_0099.MOV', 'Coca-Cola 330ml'),
  'Coca-Cola 330ml.mp4',
  'renames the uploaded file to the matched product name ("same clip name = same product name")',
)
assert.equal(
  buildCompressedVideoFileName('clip.mp4', 'Weird / Name: Test*?'),
  'Weird-Name-Test.mp4',
  'strips path separators and control/reserved characters from a rename target, substituting a single \'-\' (Part 242) rather than a space',
)
assert.equal(
  buildCompressedVideoFileName('', undefined),
  'video.mp4',
  'falls back to a safe default name when nothing usable is available',
)

console.log('PASS videoCompression buildCompressedVideoFileName')

// compressVideoFile -- fallback contract: whenever compression isn't
// possible or isn't worthwhile, the original File instance comes back
// untouched (no throw, no hang), same "always safe to send what this
// returns" contract as compressImageFile.
async function run(): Promise<void> {
  const fakeInput = { name: 'not-a-real-file.mp4' } as File
  const notAFileResult = await compressVideoFile(fakeInput)
  assert.equal(notAFileResult, fakeInput, 'a non-File-instance input is handed back unchanged rather than throwing')

  const nonVideo = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })
  const nonVideoResult = await compressVideoFile(nonVideo)
  assert.equal(nonVideoResult, nonVideo, 'a non-video file is returned untouched')

  const tinyVideo = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' })
  const tinyResult = await compressVideoFile(tinyVideo)
  assert.equal(tinyResult, tinyVideo, 'a video under the minimum-savings size threshold is returned untouched, without attempting to load ffmpeg')

  console.log('PASS videoCompression compressVideoFile fallback contract')
}

await run()
