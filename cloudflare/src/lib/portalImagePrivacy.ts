// Metadata minimization for customer-supplied screenshots.
//
// Browser-side canvas conversion is useful presentation hygiene, but it is
// not a privacy boundary: clients can call the public route directly. This
// parser removes metadata containers from the encoded bytes before R2 sees
// them, while preserving the compressed image payload. Malformed input fails
// closed and is never stored.

export type SanitizedPortalImage = {
  bytes: Uint8Array
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + ((bytes[offset + 3] << 24) >>> 0)) >>> 0
}

function readExifOrientation(payload: Uint8Array): number | null {
  if (payload.length < 14 || ascii(payload, 0, 6) !== 'Exif\0\0') return null
  const tiff = 6
  const little = payload[tiff] === 0x49 && payload[tiff + 1] === 0x49
  const big = payload[tiff] === 0x4d && payload[tiff + 1] === 0x4d
  if (!little && !big) return null
  const u16 = (offset: number) => little
    ? payload[offset] | (payload[offset + 1] << 8)
    : (payload[offset] << 8) | payload[offset + 1]
  const u32 = (offset: number) => little ? readU32Le(payload, offset) : readU32Be(payload, offset)
  if (u16(tiff + 2) !== 42) return null
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > payload.length) return null
  const entries = u16(ifd)
  if (entries > 512 || ifd + 2 + entries * 12 > payload.length) return null
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (u16(entry) !== 0x0112 || u16(entry + 2) !== 3 || u32(entry + 4) !== 1) continue
    const value = u16(entry + 8)
    return value >= 1 && value <= 8 ? value : null
  }
  return null
}

function minimalOrientationSegment(orientation: number): Uint8Array {
  // One little-endian TIFF IFD containing only Orientation. This preserves
  // visible rotation/mirroring without carrying camera, time, GPS, author,
  // thumbnail, or XMP fields into storage.
  return new Uint8Array([
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
    orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ])
}

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const parts: Uint8Array[] = [bytes.slice(0, 2)]
  let orientation: number | null = null
  let offset = 2
  while (offset < bytes.length) {
    const markerStart = offset
    if (bytes[offset] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd9) {
      if (orientation && orientation !== 1) parts.splice(1, 0, minimalOrientationSegment(orientation))
      parts.push(bytes.slice(markerStart, offset))
      return concat(parts)
    }
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return null
      const length = (bytes[offset] << 8) | bytes[offset + 1]
      if (length < 2 || offset + length > bytes.length) return null
      // Entropy-coded scan data can contain marker-looking bytes. Copy the
      // complete remainder after validating the SOS header.
      if (orientation && orientation !== 1) parts.splice(1, 0, minimalOrientationSegment(orientation))
      parts.push(bytes.slice(markerStart))
      return concat(parts)
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.slice(markerStart, offset))
      continue
    }
    if (offset + 2 > bytes.length) return null
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return null
    const segmentEnd = offset + length
    // APP1 carries EXIF/GPS and XMP; APP2-APP13/APP15 may carry ICC, IPTC,
    // Photoshop, or vendor metadata; COM is arbitrary text. APP0 (JFIF) and
    // APP14 (Adobe colour transform) are retained because they affect basic
    // decoding rather than identify the person or device.
    if (marker === 0xe1 && orientation === null) {
      orientation = readExifOrientation(bytes.subarray(offset + 2, segmentEnd))
    }
    const metadata = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe
    if (!metadata) parts.push(bytes.slice(markerStart, segmentEnd))
    offset = segmentEnd
  }
  return null
}

function stripPng(bytes: Uint8Array): Uint8Array | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 20 || !signature.every((value, index) => bytes[index] === value)) return null
  const parts = [bytes.slice(0, 8)]
  const safeAncillary = new Set(['tRNS', 'cHRM', 'gAMA', 'sRGB', 'acTL', 'fcTL', 'fdAT'])
  let offset = 8
  let sawHeader = false
  let sawImage = false
  while (offset + 12 <= bytes.length) {
    const length = readU32Be(bytes, offset)
    const chunkEnd = offset + 12 + length
    if (chunkEnd > bytes.length) return null
    const type = ascii(bytes, offset + 4, 4)
    if (!/^[A-Za-z]{4}$/.test(type)) return null
    if (type === 'IHDR') sawHeader = true
    if (type === 'IDAT' || type === 'fdAT') sawImage = true
    const critical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90
    if (critical || safeAncillary.has(type)) parts.push(bytes.slice(offset, chunkEnd))
    offset = chunkEnd
    if (type === 'IEND') {
      if (offset !== bytes.length || !sawHeader || !sawImage) return null
      return concat(parts)
    }
  }
  return null
}

function stripWebp(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const declaredEnd = readU32Le(bytes, 4) + 8
  if (declaredEnd !== bytes.length) return null
  const parts: Uint8Array[] = [bytes.slice(0, 12)]
  let offset = 12
  let sawImage = false
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4)
    const length = readU32Le(bytes, offset + 4)
    const paddedEnd = offset + 8 + length + (length % 2)
    if (paddedEnd > bytes.length) return null
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') sawImage = true
    if (!['EXIF', 'XMP ', 'ICCP'].includes(type)) {
      const chunk = bytes.slice(offset, paddedEnd)
      if (type === 'VP8X' && length >= 1) {
        // Clear the flags for the removed ICC, EXIF, and XMP chunks while
        // preserving alpha and animation flags.
        chunk[8] &= ~0x2c
      }
      parts.push(chunk)
    }
    offset = paddedEnd
  }
  if (offset !== bytes.length || !sawImage) return null
  const output = concat(parts)
  const riffLength = output.length - 8
  output[4] = riffLength & 0xff
  output[5] = (riffLength >>> 8) & 0xff
  output[6] = (riffLength >>> 16) & 0xff
  output[7] = (riffLength >>> 24) & 0xff
  return output
}

function readGifSubBlocks(bytes: Uint8Array, start: number): number | null {
  let offset = start
  while (offset < bytes.length) {
    const length = bytes[offset]
    offset += 1
    if (length === 0) return offset
    if (offset + length > bytes.length) return null
    offset += length
  }
  return null
}

function stripGif(bytes: Uint8Array): Uint8Array | null {
  const version = ascii(bytes, 0, 6)
  if (bytes.length < 14 || (version !== 'GIF87a' && version !== 'GIF89a')) return null
  const globalTable = (bytes[10] & 0x80) !== 0 ? 3 * (2 ** ((bytes[10] & 0x07) + 1)) : 0
  let offset = 13 + globalTable
  if (offset > bytes.length) return null
  const parts = [bytes.slice(0, offset)]
  let sawImage = false
  while (offset < bytes.length) {
    const start = offset
    const marker = bytes[offset]
    if (marker === 0x3b) {
      if (!sawImage || offset + 1 !== bytes.length) return null
      parts.push(bytes.slice(offset, offset + 1))
      return concat(parts)
    }
    if (marker === 0x2c) {
      if (offset + 10 > bytes.length) return null
      const localTable = (bytes[offset + 9] & 0x80) !== 0 ? 3 * (2 ** ((bytes[offset + 9] & 0x07) + 1)) : 0
      const dataStart = offset + 10 + localTable
      if (dataStart + 1 > bytes.length) return null
      const end = readGifSubBlocks(bytes, dataStart + 1)
      if (end === null) return null
      parts.push(bytes.slice(start, end))
      offset = end
      sawImage = true
      continue
    }
    if (marker !== 0x21 || offset + 2 > bytes.length) return null
    const label = bytes[offset + 1]
    offset += 2
    if (label === 0xf9) {
      const blockSize = bytes[offset]
      const end = offset + 1 + blockSize + 1
      if (blockSize !== 4 || end > bytes.length || bytes[end - 1] !== 0) return null
      parts.push(bytes.slice(start, end))
      offset = end
      continue
    }
    const fixedSize = bytes[offset]
    if (offset + 1 + fixedSize > bytes.length) return null
    const identifier = label === 0xff ? ascii(bytes, offset + 1, fixedSize) : ''
    const end = readGifSubBlocks(bytes, offset + 1 + fixedSize)
    if (end === null) return null
    // Comments, plain text, and vendor application blocks can contain names,
    // locations, or arbitrary strings. Keep only the standard loop extension
    // needed for animation playback.
    if (label === 0xff && (identifier === 'NETSCAPE2.0' || identifier === 'ANIMEXTS1.0')) {
      parts.push(bytes.slice(start, end))
    }
    offset = end
  }
  return null
}

export function sanitizePortalImageMetadata(bytes: Uint8Array): SanitizedPortalImage | null {
  const jpeg = stripJpeg(bytes)
  if (jpeg) return { bytes: jpeg, contentType: 'image/jpeg' }
  const png = stripPng(bytes)
  if (png) return { bytes: png, contentType: 'image/png' }
  const webp = stripWebp(bytes)
  if (webp) return { bytes: webp, contentType: 'image/webp' }
  const gif = stripGif(bytes)
  if (gif) return { bytes: gif, contentType: 'image/gif' }
  return null
}
