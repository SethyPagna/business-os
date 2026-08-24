// Upload content-type validation, ported from backend/src/uploadSecurity.ts.
//
// detectBufferKind does magic-byte sniffing (checking the actual file
// signature, not trusting the client-supplied MIME type or extension) --
// pure buffer inspection with no native dependencies, so it ports directly
// and unchanged in spirit.
//
// NOT ported: backend/src/uploadSecurity.ts's validateImageMetadata, which
// uses `sharp` (a native binary) to check image dimensions/frame count and
// reject decompression-bomb-style images. Sharp cannot run in a Workers V8
// isolate at all -- same category of gap as ffmpeg (see queue.ts), not a
// simple oversight. The magic-byte check below still catches the more
// common attack (a disguised executable/script uploaded with a spoofed
// image extension); dimension-bomb protection would need Cloudflare Images
// or a Container to restore.

export type UploadedFileKind = 'image' | 'video' | 'document' | 'unknown'

function bufferStartsWith(bytes: Uint8Array, signature: number[]): boolean {
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false
  }
  return true
}

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function isLikelyCsvBuffer(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  let invalidControls = 0
  let separators = 0
  for (const byte of bytes) {
    if (byte === 0) return false
    if (byte === 44 || byte === 59 || byte === 9) separators += 1
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13
    if (byte < 32 && !isAllowedControl) invalidControls += 1
  }
  return invalidControls === 0 && separators > 0
}

export function detectBufferKind(bytes: Uint8Array): UploadedFileKind {
  if (bytes.length === 0) return 'unknown'
  if (bufferStartsWith(bytes, [0xff, 0xd8, 0xff])) return 'image'
  if (bufferStartsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image'
  if (bufferStartsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image'
  if (bufferStartsWith(bytes, [0x42, 0x4d])) return 'image'
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') return 'image'
  if (asciiAt(bytes, 0, 5) === '%PDF-') return 'document'
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video'
  if (bytes.length >= 12 && asciiAt(bytes, 4, 8) === 'ftyp') return 'video'
  if (isLikelyCsvBuffer(bytes.subarray(0, Math.min(bytes.length, 8192)))) return 'document'
  return 'unknown'
}

export function getExpectedUploadedKind(mimeType: string, fileName: string): UploadedFileKind {
  const mime = mimeType.toLowerCase()
  const name = fileName.toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return 'image'
  if (mime.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name)) return 'video'
  if (mime === 'application/pdf' || mime === 'text/csv' || mime === 'application/csv' || mime === 'application/vnd.ms-excel' || /\.(pdf|csv)$/i.test(name)) return 'document'
  return 'unknown'
}

export function validateUploadedBuffer(bytes: Uint8Array, mimeType: string, fileName: string): void {
  const expectedKind = getExpectedUploadedKind(mimeType, fileName)
  const actualKind = detectBufferKind(bytes)
  if (expectedKind !== 'unknown' && actualKind !== expectedKind) {
    throw new Error('Uploaded file contents do not match the selected file type. Please choose a valid image, video, PDF, or CSV file.')
  }
}
