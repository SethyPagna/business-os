'use strict'

const fs = require('fs')
let sharp = null
try { sharp = require('sharp') } catch (_) {}

const MAX_IMAGE_DIMENSION = 12_000
const MAX_IMAGE_PIXELS = 40_000_000
const MAX_IMAGE_FRAMES = 120

function bufferStartsWith(buffer, bytes = []) {
  return bytes.every((value, index) => buffer[index] === value)
}

function isLikelyCsvBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false
  let invalidControls = 0
  let separators = 0
  for (const byte of buffer) {
    if (byte === 0) return false
    if (byte === 44 || byte === 59 || byte === 9) separators += 1
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13
    if (byte < 32 && !isAllowedControl) invalidControls += 1
  }
  return invalidControls === 0 && separators > 0
}

function detectBufferKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return 'unknown'
  if (bufferStartsWith(buffer, [0xFF, 0xD8, 0xFF])) return 'image'
  if (bufferStartsWith(buffer, [0x89, 0x50, 0x4E, 0x47])) return 'image'
  if (bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'image'
  if (bufferStartsWith(buffer, [0x42, 0x4D])) return 'image'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image'
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'document'
  if (buffer.subarray(0, 4).toString('hex').toLowerCase() === '1a45dfa3') return 'video'
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video'
  if (isLikelyCsvBuffer(buffer.subarray(0, Math.min(buffer.length, 8192)))) return 'document'
  return 'unknown'
}

function getExpectedUploadedKind(file = {}) {
  const mime = String(file?.mimetype || '').toLowerCase()
  const name = String(file?.originalname || file?.filename || '').toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return 'image'
  if (mime.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name)) return 'video'
  if (mime === 'application/pdf' || mime === 'text/csv' || mime === 'application/csv' || mime === 'application/vnd.ms-excel' || /\.(pdf|csv)$/i.test(name)) return 'document'
  return 'unknown'
}

async function validateImageMetadata(bufferOrPath) {
  if (!sharp) return
  const metadata = await sharp(bufferOrPath, { animated: true, limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
  const width = Number(metadata?.width || 0)
  const height = Number(metadata?.height || 0)
  const frames = Number(metadata?.pages || metadata?.frames || 1)
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || (width * height) > MAX_IMAGE_PIXELS) {
    throw new Error('Image dimensions are too large.')
  }
  if (frames > MAX_IMAGE_FRAMES) {
    throw new Error('Animated images contain too many frames.')
  }
}

async function validateUploadedBuffer(buffer, file = {}) {
  const expectedKind = getExpectedUploadedKind(file)
  const actualKind = detectBufferKind(buffer)
  if (expectedKind !== 'unknown' && actualKind !== expectedKind) {
    throw new Error('Uploaded file contents do not match the selected file type. Please choose a valid image, video, PDF, or CSV file.')
  }
  if (actualKind === 'image') {
    await validateImageMetadata(buffer)
  }
}

async function validateUploadedPath(filePath, file = {}) {
  const buffer = fs.readFileSync(filePath)
  await validateUploadedBuffer(buffer, file)
}

module.exports = {
  detectBufferKind,
  getExpectedUploadedKind,
  validateUploadedBuffer,
  validateUploadedPath,
}
