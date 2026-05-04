'use strict'

const assert = require('node:assert/strict')
const sharp = require('sharp')
const {
  MAX_IMAGE_ASSET_BYTES,
  buildVideoOptimizationArgs,
  compressBufferForAsset,
} = require('../src/fileAssets')

let failed = 0
const pendingTests = new Set()

function runTest(name, fn) {
  pendingTests.add(name)
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`)
    })
    .catch((error) => {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    })
    .finally(() => {
      pendingTests.delete(name)
      if (pendingTests.size === 0 && failed > 0) {
        process.exitCode = 1
      }
    })
}

function buildDeterministicPixels(width, height, channels = 3) {
  const pixels = Buffer.alloc(width * height * channels)
  let seed = 123456789
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0
    pixels[index] = (seed >>> 24) & 0xff
  }
  return pixels
}

function buildLogoPixels(width, height) {
  const pixels = Buffer.alloc(width * height * 4)
  const colors = [
    [18, 35, 72, 255],
    [32, 115, 185, 255],
    [245, 246, 248, 255],
    [226, 55, 68, 255],
  ]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const color = colors[(Math.floor(x / 80) + Math.floor(y / 80)) % colors.length]
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = color[3]
    }
  }
  return pixels
}

runTest('image asset compression enforces the 40KB budget for photos and logos', async () => {
  const source = await sharp(buildDeterministicPixels(900, 900), {
    raw: { width: 900, height: 900, channels: 3 },
  }).jpeg({ quality: 96 }).toBuffer()
  assert.equal(source.length > MAX_IMAGE_ASSET_BYTES, true, 'fixture must start above the asset budget')

  const optimized = await compressBufferForAsset(source, {
    fileName: 'brand-logo.jpg',
    mimeType: 'image/jpeg',
  })

  assert.equal(optimized.optimization_status, 'optimized')
  assert.equal(optimized.optimized_byte_size <= MAX_IMAGE_ASSET_BYTES, true)
  assert.equal(optimized.buffer.length <= MAX_IMAGE_ASSET_BYTES, true)

  const logoSource = await sharp(buildLogoPixels(900, 420), {
    raw: { width: 900, height: 420, channels: 4 },
  }).png({ compressionLevel: 0 }).toBuffer()
  assert.equal(logoSource.length > MAX_IMAGE_ASSET_BYTES, true, 'logo fixture must start above the asset budget')

  const logoOptimized = await compressBufferForAsset(logoSource, {
    fileName: 'brand-logo.png',
    mimeType: 'image/png',
  })

  assert.equal(logoOptimized.optimization_status, 'optimized')
  assert.equal(logoOptimized.optimized_byte_size <= MAX_IMAGE_ASSET_BYTES, true)
  assert.equal(logoOptimized.buffer.length <= MAX_IMAGE_ASSET_BYTES, true)

  const uncompressible = await compressBufferForAsset(Buffer.alloc(MAX_IMAGE_ASSET_BYTES + 1), {
    fileName: 'animated-logo.gif',
    mimeType: 'image/gif',
  })
  assert.equal(uncompressible.optimization_status, 'over_budget')
  assert.equal(uncompressible.over_budget, true)
})

runTest('video optimization uses slower clear transcode settings for compact mp4 output', () => {
  const args = buildVideoOptimizationArgs({
    inputPath: 'input.mp4',
    outputPath: 'output.mp4',
  })
  assert.deepEqual(args.slice(0, 3), ['-y', '-i', 'input.mp4'])
  assert.equal(args.includes('libx264'), true)
  assert.equal(args.includes('slow'), true)
  assert.equal(args.includes('veryfast'), false)
  assert.equal(args.includes('24'), true)
  assert.equal(args.includes('96k'), true)
  const hasScaleLimit = args.some((value) => String(value).includes('1280'))
  assert.equal(hasScaleLimit, true)
  assert.equal(args.includes('+faststart'), true)
  assert.equal(args.at(-1), 'output.mp4')
})
