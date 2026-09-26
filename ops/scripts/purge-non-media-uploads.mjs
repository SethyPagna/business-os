#!/usr/bin/env node
// purge-non-media-uploads.mjs -- OWNER-RUN. Removes stored files that are
// not images or videos (owner ruling 2026-09-26: "delete them all").
//
// =====================================================================
//  HOW TO RUN IT (step by step, from YOUR OWN terminal)
// =====================================================================
//  Before you start: you need Node.js 18 or newer. Check with `node -v`.
//  Nothing is deleted unless you add --delete in step 5.
//
//  1. Make a Cloudflare API token (one time).
//     - Open https://dash.cloudflare.com/profile/api-tokens
//     - Click "Create Token", then "Create Custom Token".
//     - Name it: purge-uploads
//     - Permissions, add two rows:
//         Account | Workers R2 Storage | Edit
//         Account | D1                 | Edit
//     - Account Resources: Include | (your account)
//     - Click "Continue to summary", then "Create Token".
//     - Copy the token. Keep the page open until step 3 is done.
//
//  2. Open a terminal in the business-os-v1 folder (the folder that holds
//     the "ops" and "cloudflare" folders). In Windows Explorer: open that
//     folder, click the address bar, type  powershell  and press Enter.
//
//  3. Do a DRY RUN (lists and counts, changes nothing):
//         node ops/scripts/purge-non-media-uploads.mjs
//     It asks "Cloudflare API token:". Paste the token (right-click pastes
//     in PowerShell). Nothing appears while you paste; that is on purpose.
//     Press Enter.
//
//  4. Read what it printed. It shows, per kind, how many files it KEEPS,
//     how many it keeps but wants you to REVIEW, and how many it would
//     PURGE, and the folder where it saved the full list (manifest.json).
//     If the numbers look wrong, STOP and send the printout.
//
//  5. Delete for real:
//         node ops/scripts/purge-non-media-uploads.mjs --delete
//     Paste the token again. It saves a fresh list first, then asks you
//     to type DELETE to confirm. Type DELETE (capitals) and press Enter.
//     Deleted files cannot be brought back; the saved list records them.
//
//  6. When it prints "Done", send the last lines of the printout. You can
//     then delete the token on the API tokens page (it is not needed again).
//
//  If anything prints "FAILED", nothing further is changed; send the
//  printout. Running it again is safe: it starts over from what is left.
// =====================================================================
//
// What it does
//   (a) Lists every object in R2 bucket business-os-assets under uploads/,
//       private/ and imports/ through the Cloudflare API, with the token you
//       paste (read from a hidden prompt, or from CLOUDFLARE_API_TOKEN if
//       that is already set). The token is never printed or written.
//   (b) Classifies each object from its BYTES, never from its name
//       (S-uploads2a, 2026-09-26: the first version went by the name and
//       would have deleted real photos saved as .jfif, .jpe, .bin or with
//       no extension, .m4v videos and older QuickTime movies):
//         KEEP    every image and video the app accepts (the Worker's own
//                 check, mirrored below), whatever the file is called; every
//                 other photo, video or audio format it recognises (HEIC,
//                 BMP, TIFF, camera raw, AVI, MP3, M4A...); and the files of
//                 imports that are still running;
//         REVIEW  images with web-page code inside, files stored compressed,
//                 and files it cannot identify -- kept, and listed for you;
//         PURGE   only files it positively recognises as documents (PDF,
//                 Word, Excel...), web pages, SVG, XML, text, CSV, JSON,
//                 scripts, archives (ZIP...), programs or fonts.
//   (c) Writes manifest.json first: key, size, decision, group, format, and
//       the matching file_assets / import_job_files row ids.
//   (d) Without --delete: dry run, prints counts only. With --delete: after
//       you type DELETE, deletes the PURGE files, then updates D1 through a
//       SQL file (d1-changes.sql, saved next to the manifest) whose guard
//       statements refuse to run unless the row counts are exactly what the
//       manifest expects, and checks the counts again afterwards:
//         - file_assets rows of purged Library files are removed (their
//           import_job_files links are cleared first) -- never a row that
//           also points at a file that is kept;
//         - import_job_files rows of purged files are marked 'purged'.
//
// Read-only on anything else. It never touches objects outside the three
// prefixes (backups, exports, etc.). Written for the owner's terminal
// because Claude-launched processes cannot reach the Cloudflare API
// reliably through the VPN.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

export const BUCKET = 'business-os-assets'
export const PREFIXES = ['uploads/', 'private/', 'imports/']
const API = 'https://api.cloudflare.com/client/v4'
// Every object's first bytes are read; that is enough to identify it.
export const HEAD_BYTES = 4096
// An image the app accepts is read whole up to this size, so web-page code
// hidden anywhere in it is found.
export const FULL_SCAN_MAX_BYTES = 25 * 1024 * 1024
// Jobs whose incoming file must survive (same set as the Worker's
// lib/importIncomingFiles.ts IMPORT_ACTIVE_STATUSES).
export const ACTIVE_JOB_STATUSES = ['pending', 'created', 'queued', 'analyzing', 'running', 'awaiting_review', 'approved', 'applying', 'cancelling']

// =====================================================================
// BEGIN mirror of cloudflare/src/lib/uploadSecurity.ts
// detectUploadFormat and containsEmbeddedMarkup, with every function and
// constant they use, as plain JavaScript so this script runs on Node
// without TypeScript. Keep it identical to the Worker, token for token
// once the types are removed: cloudflare/scripts/
// test-upload-classifier-parity-pure.cjs computes the set of declarations
// the two functions reach in uploadSecurity.ts, requires each one here
// unchanged, and runs both on the same fixtures. Edit both together.
// =====================================================================
function bufferStartsWith(bytes, signature) {
  if (bytes.length < signature.length) return false
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false
  }
  return true
}

function bufferStartsWithAt(bytes, offset, signature) {
  if (offset < 0 || bytes.length < offset + signature.length) return false
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false
  }
  return true
}

function asciiAt(bytes, start, end) {
  if (bytes.length < end) return ''
  return String.fromCharCode(...bytes.subarray(start, end))
}

function readU32BE(bytes, offset) {
  return bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
}

function readU32LE(bytes, offset) {
  return bytes[offset + 3] * 0x1000000 + ((bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset])
}

function isFourCcAt(bytes, offset) {
  if (offset + 4 > bytes.length) return false
  for (let index = offset; index < offset + 4; index += 1) {
    const byte = bytes[index]
    if (!((byte >= 0x20 && byte <= 0x7e) || byte === 0xa9)) return false
  }
  return true
}

export const MP4_VIDEO_BRANDS = [
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
  'mp41', 'mp42', 'mp71', 'avc1', 'dash', 'cmfc', 'cmf2', 'mmp4', 'f4v ',
  'm4v ', 'm4vh', 'm4vp', 'msnv', 'xavc',
  'ndsc', 'ndsh', 'ndsm', 'ndsp', 'ndss', 'ndxc', 'ndxh', 'ndxm', 'ndxp', 'ndxs',
  '3gp4', '3gp5', '3gp6', '3gp7', '3gp8', '3gp9', '3gg6', '3g2a', '3g2b', '3g2c', 'kddi',
]
export const QUICKTIME_BRAND = 'qt  '
export const AVIF_BRANDS = ['avif', 'avis']
export const HEIF_STRUCTURAL_BRANDS = ['mif1', 'msf1']
export const HEVC_IMAGE_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']

function readFtypBrands(bytes) {
  if (bytes.length < 12 || asciiAt(bytes, 4, 8) !== 'ftyp') return null
  const major = asciiAt(bytes, 8, 12).toLowerCase()
  const boxEnd = Math.min(bytes.length, Math.max(16, readU32BE(bytes, 0)), 16 + 4 * 64)
  const compatible = []
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) compatible.push(asciiAt(bytes, offset, offset + 4).toLowerCase())
  return { major, compatible }
}

function detectIsoBmff(bytes) {
  const ftyp = readFtypBrands(bytes)
  if (!ftyp) return null
  const { major, compatible } = ftyp
  if (AVIF_BRANDS.includes(major)) return { kind: 'image', mime: 'image/avif', extension: '.avif' }
  if (HEIF_STRUCTURAL_BRANDS.includes(major)
    && compatible.some((brand) => AVIF_BRANDS.includes(brand))
    && !compatible.some((brand) => HEVC_IMAGE_BRANDS.includes(brand))) {
    return { kind: 'image', mime: 'image/avif', extension: '.avif' }
  }
  if (major === QUICKTIME_BRAND) return { kind: 'video', mime: 'video/quicktime', extension: '.mov' }
  if (MP4_VIDEO_BRANDS.includes(major)) return { kind: 'video', mime: 'video/mp4', extension: '.mp4' }
  return 'rejected'
}

export const QUICKTIME_LEADING_ATOMS = ['wide', 'mdat', 'moov', 'free', 'skip', 'pnot']

function detectQuickTimeAtoms(bytes) {
  if (bytes.length < 8 || !QUICKTIME_LEADING_ATOMS.includes(asciiAt(bytes, 4, 8))) return null
  if (readU32BE(bytes, 0) > bytes.length && [0, 1, 2, 3].every((index) => bytes[index] >= 0x20 && bytes[index] <= 0x7e)) return null
  let offset = 0
  let sawMovie = false
  for (let atoms = 0; atoms < 64 && offset + 8 <= bytes.length; atoms += 1) {
    if (!isFourCcAt(bytes, offset + 4)) return null
    const type = asciiAt(bytes, offset + 4, offset + 8)
    if (type === 'moov' || type === 'mdat') sawMovie = true
    let size = readU32BE(bytes, offset)
    if (size === 0) break
    if (size === 1) {
      if (offset + 16 > bytes.length) break
      size = readU32BE(bytes, offset + 8) * 0x100000000 + readU32BE(bytes, offset + 12)
      if (size < 16) return null
    } else if (size < 8) {
      return null
    }
    offset += size
  }
  return sawMovie ? { kind: 'video', mime: 'video/quicktime', extension: '.mov' } : null
}

export const EMBEDDED_MARKUP_TOKENS = [
  '<script', '<html', '<svg', '<iframe', '<body', '<object', '<embed', '<!doctype html', '<meta', '<img', '<a href', 'javascript:',
  '<style', '<form', '<link', '<base', '<frame', '<frameset', '<applet', '<math',
]
export const MARKUP_TAG_TERMINATORS = [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x2f, 0x3d, 0x3e]
export const MARKUP_TOKEN_SEPARATORS = [0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x2f]
export const MARKUP_SNIFF_WINDOW_BYTES = 1445
export const MARKUP_PAYLOAD_MIN_TOKEN_LENGTH = 6
export const C2PA_MANIFEST_IGNORED_TOKENS = ['<svg', '<img', '<style', '<a href']
export const EVENT_HANDLER_PRECEDERS = [0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x2f, 0x22, 0x27]
export const C2PA_UUID = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81]
const MARKUP_MAX_NESTED_IMAGES = 8
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_PAYLOAD_CHUNKS = ['IDAT', 'fdAT']
const WEBP_PAYLOAD_CHUNKS = ['VP8 ', 'VP8L', 'ALPH', 'ANMF']

function groupMarkupTokens(tokens) {
  const groups = new Map()
  for (const token of tokens) {
    const first = token.charCodeAt(0)
    for (const byte of first >= 0x61 && first <= 0x7a ? [first, first - 0x20] : [first]) {
      groups.set(byte, [...(groups.get(byte) || []), token])
    }
  }
  return [...groups.entries()]
}

const MARKUP_TOKEN_GROUPS = {
  full: groupMarkupTokens(EMBEDDED_MARKUP_TOKENS),
  payload: groupMarkupTokens(EMBEDDED_MARKUP_TOKENS.filter((token) => token.length >= MARKUP_PAYLOAD_MIN_TOKEN_LENGTH)),
  manifest: groupMarkupTokens(EMBEDDED_MARKUP_TOKENS.filter((token) => !C2PA_MANIFEST_IGNORED_TOKENS.includes(token))),
}

function lowerAscii(byte) {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte
}

function isAsciiLetter(byte) {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
}

function eventHandlerAt(bytes, start, step) {
  const charAt = (at) => (at >= 0 && at < bytes.length && (step === 1 || bytes[at + 1] === 0x00) ? bytes[at] : -1)
  if (charAt(start) === -1 || !EVENT_HANDLER_PRECEDERS.includes(charAt(start - step))) return false
  if (lowerAscii(charAt(start + step)) !== 0x6e) return false
  let position = start + 2 * step
  let letters = 0
  while (isAsciiLetter(charAt(position))) { position += step; letters += 1 }
  if (letters < 3) return false
  while (MARKUP_TOKEN_SEPARATORS.includes(charAt(position)) && charAt(position) !== 0x2f) position += step
  return charAt(position) === 0x3d
}

function eventHandlerInRange(bytes, start, end) {
  for (const first of [0x6f, 0x4f]) {
    for (let index = bytes.indexOf(first, start); index !== -1 && index < end; index = bytes.indexOf(first, index + 1)) {
      if (eventHandlerAt(bytes, index, 1) || eventHandlerAt(bytes, index, 2)) return true
    }
  }
  return false
}

function markupTokenAt(bytes, start, token, step) {
  const charAt = (at) => (at < bytes.length && (step === 1 || bytes[at + 1] === 0x00) ? bytes[at] : -1)
  let position = start
  for (let index = 0; index < token.length; index += 1) {
    const want = token.charCodeAt(index)
    if (want === 0x20) {
      let run = 0
      while (MARKUP_TOKEN_SEPARATORS.includes(charAt(position))) { position += step; run += 1 }
      if (!run) return false
      continue
    }
    if (lowerAscii(charAt(position)) !== want) return false
    position += step
  }
  if (token.charCodeAt(0) !== 0x3c || position >= bytes.length) return true
  return MARKUP_TAG_TERMINATORS.includes(bytes[position])
}

function markupInRange(bytes, start, end, mode) {
  for (const [first, tokens] of MARKUP_TOKEN_GROUPS[mode]) {
    for (let index = bytes.indexOf(first, start); index !== -1 && index < end; index = bytes.indexOf(first, index + 1)) {
      for (const token of tokens) {
        if (markupTokenAt(bytes, index, token, 1) || markupTokenAt(bytes, index, token, 2)) return true
      }
    }
  }
  return mode === 'manifest' && eventHandlerInRange(bytes, start, end)
}

function walkMarkupTrailer(bytes, offset, add, depth) {
  if (offset >= bytes.length) return
  if (depth >= MARKUP_MAX_NESTED_IMAGES) { add(offset, bytes.length, 'full'); return }
  let jpegStart = offset
  const paddingEnd = Math.min(bytes.length, offset + 4096)
  while (jpegStart < paddingEnd && bytes[jpegStart] === 0x00) jpegStart += 1
  if (bufferStartsWithAt(bytes, jpegStart, [0xff, 0xd8, 0xff])) { walkJpegMarkup(bytes, jpegStart, add, depth + 1); return }
  const lastBoxStart = Math.min(bytes.length - 8, offset + 64)
  for (let box = offset; box <= lastBoxStart; box += 1) {
    if (bytes[box + 4] === 0x66 && bytes[box + 5] === 0x74 && bytes[box + 6] === 0x79 && bytes[box + 7] === 0x70) {
      add(offset, box, 'full')
      walkIsoBoxMarkup(bytes, box, add)
      return
    }
  }
  add(offset, bytes.length, 'full')
}

function walkJpegMarkup(bytes, start, add, depth) {
  let offset = start + 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) { add(offset, bytes.length, 'full'); return }
    const markerStart = offset
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9) { walkMarkupTrailer(bytes, offset, add, depth); return }
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) continue
    if (marker === 0x00 || offset + 2 > bytes.length) { add(markerStart, bytes.length, 'full'); return }
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2) { add(markerStart, bytes.length, 'full'); return }
    const jumbf = marker === 0xeb && bytes[offset + 2] === 0x4a && bytes[offset + 3] === 0x50
    add(offset + 2, offset + length, jumbf ? 'manifest' : 'full')
    offset += length
    if (marker === 0xda) {
      let end = offset
      for (;;) {
        end = bytes.indexOf(0xff, end)
        if (end === -1 || end + 1 >= bytes.length) { end = bytes.length; break }
        const next = bytes[end + 1]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) end += 2
        else if (next === 0xff) end += 1
        else break
      }
      add(offset, end, 'payload')
      offset = end
    }
  }
}

function walkPngMarkup(bytes, start, add, depth) {
  let offset = start + 8
  while (offset + 12 <= bytes.length) {
    for (let index = offset + 4; index < offset + 8; index += 1) {
      if (!isAsciiLetter(bytes[index])) { add(offset, bytes.length, 'full'); return }
    }
    const type = asciiAt(bytes, offset + 4, offset + 8)
    const dataEnd = offset + 8 + readU32BE(bytes, offset)
    if (dataEnd + 4 > bytes.length) { add(offset, bytes.length, 'full'); return }
    add(offset + 8, dataEnd, PNG_PAYLOAD_CHUNKS.includes(type) ? 'payload' : type === 'caBX' ? 'manifest' : 'full')
    offset = dataEnd + 4
    if (type === 'IEND') { walkMarkupTrailer(bytes, offset, add, depth); return }
  }
  add(offset, bytes.length, 'full')
}

function gifColourTableBytes(packed) {
  return packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0
}

function skipGifSubBlocks(bytes, offset) {
  let position = offset
  while (position < bytes.length) {
    const size = bytes[position]
    if (size === 0) return position + 1
    position += 1 + size
  }
  return -1
}

function walkGifMarkup(bytes, start, add, depth) {
  if (start + 13 > bytes.length) { add(start, bytes.length, 'full'); return }
  let offset = start + 13 + gifColourTableBytes(bytes[start + 10])
  add(start, offset, 'full')
  while (offset < bytes.length) {
    const introducer = bytes[offset]
    if (introducer === 0x3b) { walkMarkupTrailer(bytes, offset + 1, add, depth); return }
    if (introducer === 0x21) {
      const end = skipGifSubBlocks(bytes, offset + 2)
      if (end < 0) { add(offset, bytes.length, 'full'); return }
      add(offset + 1, end, 'full')
      offset = end
    } else if (introducer === 0x2c && offset + 11 <= bytes.length) {
      const dataStart = offset + 11 + gifColourTableBytes(bytes[offset + 9])
      const end = dataStart <= bytes.length ? skipGifSubBlocks(bytes, dataStart) : -1
      if (end < 0) { add(offset, bytes.length, 'full'); return }
      add(offset + 1, dataStart, 'full')
      add(dataStart, end, 'payload')
      offset = end
    } else {
      add(offset, bytes.length, 'full')
      return
    }
  }
}

function walkWebpMarkup(bytes, start, add, depth) {
  const riffEnd = Math.min(bytes.length, start + 8 + readU32LE(bytes, start + 4))
  let offset = start + 12
  while (offset + 8 <= riffEnd) {
    if (!isFourCcAt(bytes, offset)) { add(offset, bytes.length, 'full'); return }
    const fourcc = asciiAt(bytes, offset, offset + 4)
    const size = readU32LE(bytes, offset + 4)
    const dataEnd = offset + 8 + size
    if (dataEnd > bytes.length) { add(offset, bytes.length, 'full'); return }
    add(offset + 8, dataEnd, WEBP_PAYLOAD_CHUNKS.includes(fourcc) ? 'payload' : fourcc === 'C2PA' ? 'manifest' : 'full')
    offset = dataEnd + (size % 2)
  }
  if (offset < riffEnd) add(offset, riffEnd, 'full')
  walkMarkupTrailer(bytes, Math.max(offset, riffEnd), add, depth)
}

function walkIsoBoxMarkup(bytes, start, add) {
  let offset = start
  while (offset + 8 <= bytes.length) {
    if (!isFourCcAt(bytes, offset + 4)) { add(offset, bytes.length, 'full'); return }
    const type = asciiAt(bytes, offset + 4, offset + 8)
    let size = readU32BE(bytes, offset)
    let header = 8
    if (size === 1) {
      if (offset + 16 > bytes.length) { add(offset, bytes.length, 'full'); return }
      size = readU32BE(bytes, offset + 8) * 0x100000000 + readU32BE(bytes, offset + 12)
      header = 16
    } else if (size === 0) {
      size = bytes.length - offset
    }
    if (size < header) { add(offset, bytes.length, 'full'); return }
    const c2pa = type === 'uuid' && bufferStartsWithAt(bytes, offset + header, [...C2PA_UUID])
    add(offset + header, offset + size, type === 'mdat' ? 'payload' : c2pa ? 'manifest' : 'full')
    offset += size
  }
  add(offset, bytes.length, 'full')
}

function planMarkupScan(bytes) {
  const regions = []
  const add = (start, end, mode) => {
    const clipped = Math.min(end, bytes.length)
    if (clipped > start) regions.push({ start, end: clipped, mode })
  }
  const gif = asciiAt(bytes, 0, 6)
  if (bufferStartsWith(bytes, [0xff, 0xd8, 0xff])) walkJpegMarkup(bytes, 0, add, 0)
  else if (bufferStartsWith(bytes, PNG_SIGNATURE)) walkPngMarkup(bytes, 0, add, 0)
  else if (gif === 'GIF87a' || gif === 'GIF89a') walkGifMarkup(bytes, 0, add, 0)
  else if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') walkWebpMarkup(bytes, 0, add, 0)
  else if (asciiAt(bytes, 4, 8) === 'ftyp') walkIsoBoxMarkup(bytes, 0, add)
  else add(0, bytes.length, 'full')
  const manifests = regions.filter((region) => region.mode === 'manifest' && region.start < MARKUP_SNIFF_WINDOW_BYTES).sort((a, b) => a.start - b.start)
  let windowStart = 0
  for (const manifest of manifests) {
    add(windowStart, Math.min(manifest.start, MARKUP_SNIFF_WINDOW_BYTES), 'full')
    windowStart = Math.max(windowStart, manifest.end)
  }
  add(windowStart, MARKUP_SNIFF_WINDOW_BYTES, 'full')
  return regions
}

export function containsEmbeddedMarkup(bytes) {
  if (!bytes || bytes.length === 0) return false
  for (const region of planMarkupScan(bytes)) {
    if (markupInRange(bytes, region.start, region.end, region.mode)) return true
  }
  return false
}

export function detectUploadFormat(bytes) {
  if (!bytes || bytes.length === 0) return null
  if (bufferStartsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', extension: '.jpg' }
  if (bufferStartsWith(bytes, PNG_SIGNATURE)) return { kind: 'image', mime: 'image/png', extension: '.png' }
  const gif = asciiAt(bytes, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return { kind: 'image', mime: 'image/gif', extension: '.gif' }
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', extension: '.webp' }
  if (bufferStartsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm', extension: '.webm' }
  const isoBmff = detectIsoBmff(bytes)
  if (isoBmff === 'rejected') return null
  if (isoBmff) return isoBmff
  return detectQuickTimeAtoms(bytes)
}
// =====================================================================
// END mirror of cloudflare/src/lib/uploadSecurity.ts
// =====================================================================

const u16leAt = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8)
const u16beAt = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1]
const textAt = (bytes, offset, text) => asciiAt(bytes, offset, offset + text.length) === text
const latin1Head = (bytes, limit) => String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, limit)))
const isPrintableAscii = (byte) => byte >= 0x20 && byte <= 0x7e
const printable = (text) => text.replace(/[^\x20-\x7e]/g, '?')

// The first entry of a ZIP file: its name and, when stored uncompressed,
// its data (an ODF/EPUB/OpenRaster `mimetype` entry is stored first).
function zipFirstEntry(bytes) {
  if (bytes.length < 30 || !bufferStartsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return null
  const method = u16leAt(bytes, 8)
  const compressedSize = readU32LE(bytes, 18)
  const nameLength = u16leAt(bytes, 26)
  const extraLength = u16leAt(bytes, 28)
  if (30 + nameLength > bytes.length) return null
  const name = String.fromCharCode(...bytes.subarray(30, 30 + nameLength))
  const dataStart = 30 + nameLength + extraLength
  const data = method === 0 ? bytes.subarray(dataStart, Math.min(bytes.length, dataStart + compressedSize)) : null
  return { name, data }
}

function zipMimetype(bytes) {
  const entry = zipFirstEntry(bytes)
  if (!entry || entry.name !== 'mimetype' || !entry.data) return null
  return String.fromCharCode(...entry.data.subarray(0, 100))
}

// ------------------------------------------- other media: always kept
// Photos, videos and recordings the upload allowlist does not take (new
// uploads of these are refused), but a stored one is somebody's photo or
// clip. Generous on purpose: a wrong match here only keeps a file.
const OTHER_HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'mif2', 'mif3', 'miaf', 'heif', 'avif', 'avis', 'avci', 'avcs', 'jpeg', 'jpgs', 'vvic', 'vvis', 'evbi', 'evbs', 'j2ki', 'j2is']
const ISO_AUDIO_BRANDS = ['m4a ', 'm4b ', 'm4p ', 'f4a ', 'f4b ']
const BMP_HEADER_SIZES = [12, 16, 40, 52, 56, 64, 108, 124]

function isNetpbm(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] < 0x31 || bytes[1] > 0x37) return false
  if (bytes[1] === 0x37) return /^P7\s+(WIDTH|HEIGHT|DEPTH|MAXVAL|TUPLTYPE|ENDHDR|#)/.test(latin1Head(bytes, 64))
  if (![0x09, 0x0a, 0x0d, 0x20].includes(bytes[2])) return false
  let offset = 2
  while (offset < bytes.length) {
    if ([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20].includes(bytes[offset])) offset += 1
    else if (bytes[offset] === 0x23) { while (offset < bytes.length && bytes[offset] !== 0x0a) offset += 1 }
    else break
  }
  return offset < bytes.length && bytes[offset] >= 0x30 && bytes[offset] <= 0x39
}

// { kind: 'photo' | 'video-audio', format } or null. `totalSize` is the
// object's size when only its first bytes were read.
export function detectOtherMedia(bytes, totalSize = bytes ? bytes.length : 0) {
  if (!bytes || bytes.length < 2) return null
  const photo = (format) => ({ kind: 'photo', format })
  const media = (format) => ({ kind: 'video-audio', format })
  const at = (offset, signature) => bufferStartsWithAt(bytes, offset, signature)
  const has = (offset, text) => textAt(bytes, offset, text)

  // ISO BMFF the allowlist refused: HEIC/HEIF, Canon CR3, M4A, any brand.
  const ftyp = readFtypBrands(bytes)
  if (ftyp) {
    if (ftyp.major === 'crx ') return photo('camera raw (CR3)')
    if (ISO_AUDIO_BRANDS.includes(ftyp.major)) return media('M4A/M4B audio')
    if ([ftyp.major, ...ftyp.compatible].some((brand) => OTHER_HEIF_BRANDS.includes(brand))) return photo('HEIC/HEIF')
    return media(`MP4 family (brand ${printable(ftyp.major)})`)
  }
  // QuickTime atoms that do not chain within the bytes read. Text whose
  // bytes 4-8 spell an atom name has a printable "size" larger than the file.
  if (bytes.length >= 8 && QUICKTIME_LEADING_ATOMS.includes(asciiAt(bytes, 4, 8))) {
    const sizeIsText = [0, 1, 2, 3].every((index) => isPrintableAscii(bytes[index]))
    if (!(sizeIsText && readU32BE(bytes, 0) > totalSize)) return media('QuickTime')
  }
  if (has(0, 'RIFF') || has(0, 'RIFX')) {
    const form = asciiAt(bytes, 8, 12)
    if (form === 'AVI ' || form === 'AVIX') return media('AVI')
    if (form === 'CDXA') return media('Video CD')
    if (form === 'WAVE' || form === 'RMP3') return media('WAV')
    if (form === 'RMID') return media('MIDI')
    if (form === 'QLCM') return media('QCELP')
    if (form === 'ACON') return photo('animated cursor')
  }
  if (has(0, 'FORM')) {
    const form = asciiAt(bytes, 8, 12)
    if (form === 'AIFF' || form === 'AIFC' || form === '8SVX') return media('AIFF')
    if (form === 'ILBM' || form === 'PBM ' || form === 'ACBM') return photo('IFF image')
  }
  // Video.
  if (at(0, [0, 0, 1, 0xba]) || at(0, [0, 0, 1, 0xb3])) return media('MPEG')
  for (const [first, stride] of [[0, 188], [4, 192]]) {
    if (bytes.length > first + 2 * stride && [0, 1, 2].every((packet) => bytes[first + packet * stride] === 0x47)) return media('MPEG transport stream')
  }
  if (has(0, 'FLV') && bytes[3] === 1) return media('Flash video (FLV)')
  if (at(0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return media('Windows Media (WMV/WMA)')
  if (has(0, '.RMF')) return media('RealMedia')
  if (has(0, 'OggS') && bytes[4] === 0) return media('Ogg')
  // Audio. 0xFF 0xFE is a UTF-16 byte order mark, not an MPEG frame.
  if (has(0, 'ID3') && bytes.length >= 10 && bytes[3] >= 2 && bytes[3] <= 4 && bytes[4] !== 0xff) return media('MP3')
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return media('AAC')
  if (bytes.length >= 3 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && bytes[1] !== 0xfe && bytes[1] !== 0xff
    && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0 && (bytes[2] >> 4) !== 0x0f && ((bytes[2] >> 2) & 0x03) !== 0x03) return media('MP3')
  if (has(0, 'fLaC') && (bytes[4] & 0x7f) === 0) return media('FLAC')
  if (has(0, 'MThd') && bytes.length >= 8 && readU32BE(bytes, 4) === 6) return media('MIDI')
  if (has(0, '#!AMR')) return media('AMR')
  if (has(0, 'caff') && bytes.length >= 6 && u16beAt(bytes, 4) === 1) return media('Core Audio (CAF)')
  if (has(0, '.snd') && bytes.length >= 8 && readU32BE(bytes, 4) >= 24 && readU32BE(bytes, 4) < 65536) return media('AU')
  if (has(0, 'MAC ') && bytes.length >= 6 && u16leAt(bytes, 4) >= 3800 && u16leAt(bytes, 4) <= 4200) return media("Monkey's Audio")
  if (has(0, 'wvpk')) return media('WavPack')
  if (has(0, 'DSD ') && bytes.length >= 12 && bytes[4] === 28 && [5, 6, 7, 8, 9, 10, 11].every((index) => bytes[index] === 0)) return media('DSD')
  if (has(0, 'MPCK')) return media('Musepack')
  if (at(0, [0x0b, 0x77])) return media('AC-3')
  if (at(0, [0x7f, 0xfe, 0x80, 0x01])) return media('DTS')
  // Photos and other images.
  if (has(0, 'BM') && bytes.length >= 18 && BMP_HEADER_SIZES.includes(readU32LE(bytes, 14))) return photo('BMP')
  if (at(0, [0x49, 0x49, 0x2a, 0x00]) || at(0, [0x4d, 0x4d, 0x00, 0x2a]) || at(0, [0x49, 0x49, 0x2b, 0x00]) || at(0, [0x4d, 0x4d, 0x00, 0x2b])) return photo('TIFF or camera raw')
  if (has(0, 'IIRO') || has(0, 'IIRS') || has(0, 'MMOR') || at(0, [0x49, 0x49, 0x55, 0x00])) return photo('camera raw')
  if (has(0, 'FUJIFILMCCD-RAW')) return photo('camera raw (RAF)')
  if (at(0, [0x49, 0x49, 0x1a, 0, 0, 0]) && has(6, 'HEAPCCDR')) return photo('camera raw (CRW)')
  if (has(0, 'FOVb')) return photo('camera raw (X3F)')
  if (at(0, [0x00, 0x4d, 0x52, 0x4d])) return photo('camera raw (MRW)')
  if ((at(0, [0, 0, 1, 0]) || at(0, [0, 0, 2, 0])) && bytes.length >= 22) {
    const count = u16leAt(bytes, 4)
    if (count >= 1 && count <= 256 && bytes[9] === 0 && readU32LE(bytes, 18) >= 6 + 16 * count) return photo('icon (ICO/CUR)')
  }
  if (has(0, '8BPS') && bytes.length >= 6 && [1, 2].includes(u16beAt(bytes, 4))) return photo('Photoshop (PSD)')
  if (at(0, [0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]) || at(0, [0xff, 0x4f, 0xff, 0x51])) return photo('JPEG 2000')
  if (at(0, [0xff, 0x0a]) || at(0, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return photo('JPEG XL')
  if (at(0, [0x49, 0x49, 0xbc])) return photo('JPEG XR')
  if (has(0, 'gimp xcf ')) return photo('GIMP (XCF)')
  if (has(0, 'qoif')) return photo('QOI')
  if (has(0, 'DDS ') && bytes.length >= 8 && readU32LE(bytes, 4) === 124) return photo('DDS')
  if (at(0, [0x76, 0x2f, 0x31, 0x01])) return photo('OpenEXR')
  if (has(0, '#?RADIANCE') || has(0, '#?RGBE')) return photo('Radiance HDR')
  if (at(0, [0x42, 0x50, 0x47, 0xfb])) return photo('BPG')
  if (has(0, 'icns') && bytes.length >= 8 && readU32BE(bytes, 4) <= totalSize) return photo('Apple icon (ICNS)')
  if (has(0, 'FLIF')) return photo('FLIF')
  if (has(0, 'farbfeld')) return photo('farbfeld')
  if (has(0, 'SIMPLE  =')) return photo('FITS')
  if (at(0, [0xd7, 0xcd, 0xc6, 0x9a]) || at(0, [1, 0, 9, 0, 0, 3]) || at(0, [2, 0, 9, 0, 0, 3])) return photo('Windows metafile (WMF)')
  if (at(0, [1, 0, 0, 0]) && has(40, ' EMF')) return photo('Windows metafile (EMF)')
  if (bytes.length >= 4 && bytes[0] === 0x0a && [0, 2, 3, 4, 5].includes(bytes[1]) && bytes[2] === 1 && [1, 2, 4, 8].includes(bytes[3])) return photo('PCX')
  if (isNetpbm(bytes)) return photo('NetPBM')
  if (has(0, '/* XPM */')) return photo('XPM')
  if (/^#define [A-Za-z0-9_]+_width [0-9]+/.test(latin1Head(bytes, 96))) return photo('XBM')
  if ((zipMimetype(bytes) || '').startsWith('image/')) return photo('OpenRaster')
  return null
}

// ---------------------------- recognised non-media: purge candidates
// Strict on purpose: only a format recognised with certainty is a purge
// candidate. Anything unsure stays, on the review list.
const TEXT_SAMPLE_BYTES = 4096
// Tab, line feed, vertical tab, form feed, carriage return.
const TEXT_WHITESPACE = [0x09, 0x0a, 0x0b, 0x0c, 0x0d]
const isTextCode = (code) => TEXT_WHITESPACE.includes(code)
  || (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f) && code !== 0xfffe && code !== 0xffff)

function utf16Units(bytes, start, littleEndian) {
  const units = []
  for (let offset = start; offset + 1 < bytes.length; offset += 2) {
    units.push(littleEndian ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1])
  }
  return units
}

// End of the last complete UTF-8 sequence (a read may stop mid-character).
function utf8CompleteEnd(bytes, start) {
  const end = bytes.length
  for (let back = 1; back <= 3 && end - back >= start; back += 1) {
    const byte = bytes[end - back]
    if ((byte & 0xc0) === 0x80) continue
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return need > back ? end - back : end
  }
  return end
}

// The text of `bytes`, or null when they are not text: UTF-8 (optional
// BOM), UTF-16 with a BOM, or 8-bit text in a legacy code page that is
// mostly ASCII -- with no control character except tab, line feed,
// vertical tab, form feed and carriage return (a DOS end-of-file byte may
// end the file). Binary data, every media format among it, has control
// bytes within its first few bytes. Only the first 4 KB are examined.
export function decodeText(bytes, complete = true) {
  const whole = complete && bytes.length <= TEXT_SAMPLE_BYTES
  let sample = bytes.subarray(0, TEXT_SAMPLE_BYTES)
  if (whole && sample.length && sample[sample.length - 1] === 0x1a) sample = sample.subarray(0, sample.length - 1)
  if (bufferStartsWith(sample, [0xff, 0xfe]) || bufferStartsWith(sample, [0xfe, 0xff])) {
    if (whole && sample.length % 2) return null
    const units = utf16Units(sample, 2, sample[0] === 0xff)
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index]
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = units[index + 1]
        if (next === undefined && !whole) break
        if (next === undefined || next < 0xdc00 || next > 0xdfff) return null
        index += 1
      } else if ((unit >= 0xdc00 && unit <= 0xdfff) || !isTextCode(unit)) {
        return null
      }
    }
    return String.fromCharCode(...units)
  }
  const start = bufferStartsWith(sample, [0xef, 0xbb, 0xbf]) ? 3 : 0
  const end = whole ? sample.length : utf8CompleteEnd(sample, start)
  let text = null
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(start, end)) } catch { text = null }
  if (text !== null) {
    for (const char of text) if (!isTextCode(char.codePointAt(0))) return null
    return text
  }
  // Legacy 8-bit text (a Windows-1252 CSV export): no control bytes, and
  // at least three quarters plain ASCII.
  let asciiBytes = 0
  for (const byte of sample) {
    if ((byte < 0x20 && !TEXT_WHITESPACE.includes(byte)) || byte === 0x7f) return null
    if (byte < 0x80) asciiBytes += 1
  }
  return asciiBytes >= sample.length * 0.75 ? String.fromCharCode(...sample) : null
}

// The start of the data as text (UTF-16 decoded when it has a BOM).
function leadingText(bytes, limit) {
  if (bufferStartsWith(bytes, [0xff, 0xfe]) || bufferStartsWith(bytes, [0xfe, 0xff])) {
    return String.fromCharCode(...utf16Units(bytes.subarray(0, 2 + 2 * limit), 2, bytes[0] === 0xff))
  }
  const start = bufferStartsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0
  return String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + limit)))
}

// A web page, SVG or XML document from its first tag. Decisive even when
// binary bytes follow: a browser sniffing the file renders it as markup.
const MARKUP_STARTS = [['<!doctype html', 'HTML'], ['<html', 'HTML'], ['<head', 'HTML'], ['<body', 'HTML'], ['<script', 'HTML'], ['<iframe', 'HTML'], ['<svg', 'SVG'], ['<?xml', 'XML'], ['<?php', 'PHP']]
function markupStartFormat(bytes) {
  const text = leadingText(bytes, 1024).replace(/^[\t\n\f\r ]+/, '').toLowerCase()
  for (const [start, format] of MARKUP_STARTS) {
    if (!text.startsWith(start)) continue
    const next = text.charAt(start.length)
    if (next !== '' && !/[\s>/?]/.test(next)) continue
    if (format !== 'XML') return format
    return /<svg[\s>/]/.test(text) ? 'SVG' : /<html[\s>/]/.test(text) ? 'HTML' : 'XML'
  }
  return null
}

function isSfntDirectory(bytes) {
  if (bytes.length < 12) return false
  const tables = u16beAt(bytes, 4)
  if (tables < 1 || tables > 64) return false
  let power = 1
  while (power * 2 <= tables) power *= 2
  return u16beAt(bytes, 6) === power * 16
}

// { group, format } or null. Groups: documents, web-pages, text, archives,
// programs.
export function detectNonMedia(bytes, complete = true) {
  if (!bytes || bytes.length === 0) return null
  const at = (offset, signature) => bufferStartsWithAt(bytes, offset, signature)
  const has = (offset, text) => textAt(bytes, offset, text)
  const found = (group, format) => ({ group, format })
  // Documents.
  if (has(0, '%PDF-')) return found('documents', 'PDF')
  if (at(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return found('documents', 'Word/Excel/PowerPoint 97-2003')
  if (at(0, [0x50, 0x4b, 0x03, 0x04]) || at(0, [0x50, 0x4b, 0x05, 0x06]) || at(0, [0x50, 0x4b, 0x07, 0x08])) {
    const entry = zipFirstEntry(bytes)
    const name = entry ? entry.name : ''
    if (name === '[Content_Types].xml' || /^(_rels|docProps|word|xl|ppt)\//.test(name)) return found('documents', 'Word/Excel/PowerPoint')
    const mimetype = zipMimetype(bytes) || ''
    if (mimetype.startsWith('application/vnd.oasis.opendocument')) return found('documents', 'OpenDocument')
    if (mimetype.startsWith('application/epub')) return found('documents', 'EPUB')
    return found('archives', 'ZIP')
  }
  if (has(0, '{\\rtf')) return found('documents', 'RTF')
  if (has(0, '%!PS') || at(0, [0xc5, 0xd0, 0xd3, 0xc6])) return found('documents', 'PostScript/EPS')
  if (has(0, 'SQLite format 3\0')) return found('documents', 'SQLite database')
  // Archives.
  if (at(0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return found('archives', 'RAR')
  if (at(0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return found('archives', '7z')
  if (at(0, [0x1f, 0x8b, 0x08])) return found('archives', 'gzip')
  if (/^BZh[1-9](1AY&SY|\x17rE8P\x90)/.test(latin1Head(bytes, 10))) return found('archives', 'bzip2')
  if (at(0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return found('archives', 'xz')
  if (at(0, [0x28, 0xb5, 0x2f, 0xfd])) return found('archives', 'zstd')
  if (has(257, 'ustar') && (bytes[262] === 0x00 || bytes[262] === 0x20)) return found('archives', 'tar')
  if (has(0, 'MSCF') && at(4, [0, 0, 0, 0])) return found('archives', 'CAB')
  if (has(0, 'LZIP')) return found('archives', 'lzip')
  if (at(0, [0x04, 0x22, 0x4d, 0x18])) return found('archives', 'lz4')
  if (has(0, 'xar!')) return found('archives', 'xar')
  // Programs and fonts.
  if (has(0, 'MZ') && bytes.length >= 64 && at(readU32LE(bytes, 0x3c), [0x50, 0x45, 0x00, 0x00])) return found('programs', 'Windows program')
  if (at(0, [0x7f, 0x45, 0x4c, 0x46]) && [1, 2].includes(bytes[4]) && [1, 2].includes(bytes[5])) return found('programs', 'Linux program (ELF)')
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe]].some((signature) => at(0, signature))) return found('programs', 'Mac program')
  if (at(0, [0xca, 0xfe, 0xba, 0xbe])) return found('programs', 'Java class or Mac program')
  if (at(0, [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])) return found('programs', 'WebAssembly')
  if (has(0, 'dex\n') && bytes[7] === 0) return found('programs', 'Android program (DEX)')
  if ((has(0, 'FWS') || has(0, 'CWS') || has(0, 'ZWS')) && bytes[3] >= 1 && bytes[3] <= 60) return found('programs', 'Flash (SWF)')
  if ((has(0, 'wOFF') || has(0, 'wOF2')) && bytes.length >= 8 && (readU32BE(bytes, 4) === 0x00010000 || has(4, 'OTTO') || has(4, 'true'))) return found('programs', 'web font (WOFF)')
  if ((at(0, [0, 1, 0, 0]) || has(0, 'OTTO') || has(0, 'true') || has(0, 'typ1')) && isSfntDirectory(bytes)) return found('programs', 'font (TTF/OTF)')
  if (has(0, 'ttcf') && bytes.length >= 8 && [0x00010000, 0x00020000].includes(readU32BE(bytes, 4))) return found('programs', 'font collection (TTC)')
  // Web pages, SVG, XML; then any other text.
  const markup = markupStartFormat(bytes)
  if (markup) return found('web-pages', markup)
  const text = decodeText(bytes, complete)
  if (text === null) return null
  const trimmed = text.replace(/^\s+/, '')
  if (trimmed.startsWith('<')) return found('web-pages', 'markup')
  if (/^[{[]/.test(trimmed)) return found('text', 'JSON')
  if (trimmed.startsWith('#!')) return found('text', 'script')
  return found('text', 'text')
}

// ------------------------------------------------------ classification
export function extensionOf(key) {
  const name = String(key).split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function jobIdOfImportKey(key) {
  const match = /^imports\/([^/]+)\//.exec(String(key))
  return match ? match[1] : null
}

// The names an image or video is normally stored under.
const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.mp4', '.mov', '.webm'])
// Names that claim a document, page, script, archive or program. Media
// stored under one is kept and listed as "misleading".
const NON_MEDIA_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.xht', '.shtml', '.mht', '.mhtml', '.svg', '.svgz', '.xml', '.xsl', '.xslt',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.css', '.json', '.php', '.asp', '.aspx', '.jsp', '.cgi', '.pl', '.py', '.sh',
  '.bat', '.cmd', '.ps1', '.vbs', '.exe', '.dll', '.msi', '.com', '.scr', '.jar', '.apk', '.swf', '.wasm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.eps', '.ps',
  '.txt', '.csv', '.tsv', '.md', '.log', '.ini', '.zip', '.rar', '.7z', '.gz', '.tgz', '.bz2', '.xz', '.tar', '.zst',
  '.ttf', '.otf', '.woff', '.woff2',
])

// Every object lands in exactly one group; `action` is what happens to it.
export const GROUPS = [
  { id: 'images', action: 'keep', label: 'images (JPEG, PNG, GIF, WebP, AVIF)' },
  { id: 'videos', action: 'keep', label: 'videos (MP4, MOV, WebM)' },
  { id: 'unusual-name', action: 'keep', label: 'images and videos with an unusual or no file extension' },
  { id: 'misleading-name', action: 'keep', label: 'media with a misleading name' },
  { id: 'other-images', action: 'keep', label: 'photos in formats not every browser shows (HEIC/BMP/TIFF)' },
  { id: 'other-video-audio', action: 'keep', label: 'other video and audio formats' },
  { id: 'running-import', action: 'keep', label: 'files of imports that are still running' },
  { id: 'image-with-code', action: 'review', label: 'images containing web-page code' },
  { id: 'compressed', action: 'review', label: 'files stored compressed (content-encoding), not checked' },
  { id: 'unrecognised', action: 'review', label: 'files of a type this script does not recognise' },
  { id: 'empty', action: 'review', label: 'empty files' },
  { id: 'documents', action: 'purge', label: 'documents (PDF, Word, Excel, PowerPoint, RTF...)' },
  { id: 'web-pages', action: 'purge', label: 'web pages, SVG and XML' },
  { id: 'text', action: 'purge', label: 'text, CSV, JSON and scripts' },
  { id: 'archives', action: 'purge', label: 'archives (ZIP, RAR, 7z, gzip...)' },
  { id: 'programs', action: 'purge', label: 'programs and fonts' },
]
const GROUP_BY_ID = new Map(GROUPS.map((group) => [group.id, group]))

// What the bytes are, for the manifest (import files of running jobs).
function describeBytes(bytes, totalSize) {
  const allowed = detectUploadFormat(bytes)
  if (allowed) return allowed.mime
  const other = detectOtherMedia(bytes, totalSize)
  if (other) return other.format
  const nonMedia = detectNonMedia(bytes, bytes.length >= totalSize)
  return nonMedia ? nonMedia.format : ''
}

// Returns { action: 'keep' | 'review' | 'purge', group, format, extension,
// checked? }. `bytes` are the object's first bytes, or all of it when
// `complete`; `size` is the object's size.
export function classifyObject({ key, size, bytes, complete = true, activeJobIds = new Set(), contentEncoding = '' }) {
  const total = Number.isFinite(size) ? size : bytes.length
  const extension = extensionOf(key)
  const verdict = (group, format = '', extra = {}) => ({ action: GROUP_BY_ID.get(group).action, group, format, extension, ...extra })
  const jobId = jobIdOfImportKey(key)
  if (jobId && activeJobIds.has(jobId)) return verdict('running-import', describeBytes(bytes, total))
  const encoding = String(contentEncoding || '').trim().toLowerCase()
  // Node's fetch decodes a compressed body on the way in, so these bytes
  // are not the stored bytes: never judged, never moved.
  if (encoding && encoding !== 'identity') return verdict('compressed', printable(encoding))
  if (total === 0) return verdict('empty')
  if (!bytes.length) return verdict('unrecognised', 'not read')
  const media = (group, format, extra = {}) => {
    if (NON_MEDIA_EXTENSIONS.has(extension)) return verdict('misleading-name', format, extra)
    if ((group === 'images' || group === 'videos') && !MEDIA_EXTENSIONS.has(extension)) return verdict('unusual-name', format, extra)
    return verdict(group, format, extra)
  }
  const allowed = detectUploadFormat(bytes)
  if (allowed) {
    if (allowed.kind === 'video') return media('videos', allowed.mime)
    const checked = { checked: complete ? 'whole file' : `first ${bytes.length} bytes` }
    if (containsEmbeddedMarkup(bytes)) return verdict('image-with-code', allowed.mime, checked)
    return media('images', allowed.mime, checked)
  }
  const other = detectOtherMedia(bytes, total)
  if (other) return media(other.kind === 'photo' ? 'other-images' : 'other-video-audio', other.format)
  const nonMedia = detectNonMedia(bytes, complete)
  if (nonMedia) return verdict(nonMedia.group, nonMedia.format)
  return verdict('unrecognised')
}

// The storage keys a Library row can point at.
export function assetKeys(row) {
  const keys = new Set()
  const publicPath = String(row.public_path || '')
  if (publicPath.startsWith('/uploads/')) {
    keys.add(publicPath.slice(1))
    try { keys.add(decodeURIComponent(publicPath.slice(1))) } catch { /* not percent-encoded */ }
  }
  if (row.stored_name) {
    keys.add(`uploads/${row.stored_name}`)
    keys.add(`private/library/${row.stored_name}`)
  }
  return [...keys]
}

// The database rows that change when the purged objects go. A Library
// row is removed only when an object it points at is purged and NONE of
// the objects it points at is kept -- so a photo's row survives even when
// a same-named document is purged. Import rows of purged objects are
// marked 'purged' (the removal of a Library row clears its import links).
export function planRowChanges(entries, assetRows, jobFileRows) {
  const actionByKey = new Map(entries.map((entry) => [entry.key, entry.action]))
  const fileAssetIds = []
  for (const row of assetRows) {
    const actions = assetKeys(row).map((key) => actionByKey.get(key)).filter(Boolean)
    if (actions.includes('purge') && actions.every((action) => action === 'purge')) fileAssetIds.push(Number(row.id))
  }
  const removed = new Set(fileAssetIds)
  const importFileIds = jobFileRows
    .filter((row) => actionByKey.get(String(row.stored_path)) === 'purge' && !removed.has(Number(row.file_asset_id)))
    .map((row) => Number(row.id))
  return { fileAssetIds: [...new Set(fileAssetIds)], importFileIds: [...new Set(importFileIds)] }
}

// ------------------------------------------------------------- report
const megabytes = (count) => (count / 1048576).toFixed(1)
const LISTED_GROUPS = new Set(['unusual-name', 'misleading-name', 'image-with-code', 'compressed', 'unrecognised', 'empty'])
const LIST_LIMIT = 10
const INDENT = ' '.repeat(26)

function breakdownOf(members, byExtension) {
  const counts = new Map()
  for (const entry of members) {
    const label = byExtension ? entry.extension || '(none)' : entry.format || 'unknown'
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  if (counts.size === 1 && counts.has('unknown')) return ''
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([label, count]) => `${label} ${count}`).join(', ')
}

// The printed summary: one line per group, in three sections.
export function formatReport(entries, { purgeTitle, rowPlan = null, manifestPath = '' } = {}) {
  const lines = []
  const sections = [
    ['keep', 'KEEP -- these stay where they are', ': kept'],
    ['review', 'REVIEW -- also kept; look at these yourself', ': kept, check them'],
    ['purge', purgeTitle || 'PURGE', ''],
  ]
  for (const [action, title, suffix] of sections) {
    lines.push('', title)
    for (const group of GROUPS.filter((candidate) => candidate.action === action)) {
      const members = entries.filter((entry) => entry.group === group.id)
      const bytesTotal = members.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0)
      let line = `  ${String(members.length).padStart(6)} ${members.length === 1 ? 'file ' : 'files'} ${megabytes(bytesTotal).padStart(9)} MB  ${group.label}${suffix}`
      const breakdown = members.length ? breakdownOf(members, group.id === 'unusual-name' || group.id === 'misleading-name') : ''
      if (breakdown) line += `  [${breakdown}]`
      lines.push(line)
      if (!LISTED_GROUPS.has(group.id)) continue
      for (const entry of members.slice(0, LIST_LIMIT)) lines.push(`${INDENT}${printable(entry.key)}${entry.format ? `  (${entry.format})` : ''}`)
      if (members.length > LIST_LIMIT) lines.push(`${INDENT}...and ${members.length - LIST_LIMIT} more (all listed in manifest.json)`)
      if (group.id === 'unusual-name' && members.length) lines.push(`${INDENT}(the website shows uploads only under their usual names; these stay stored as they are)`)
    }
    if (action === 'keep') {
      const partial = entries.filter((entry) => entry.action === 'keep' && String(entry.checked || '').startsWith('first')).length
      if (partial) lines.push(`  ${partial} large ${partial === 1 ? 'image was' : 'images were'} checked from ${partial === 1 ? 'its' : 'their'} first bytes only.`)
    }
  }
  if (rowPlan) {
    lines.push(`  Library rows of these files: ${rowPlan.fileAssetIds.length}`)
    lines.push(`  Import rows of these files:  ${rowPlan.importFileIds.length}`)
  }
  if (manifestPath) lines.push('', `Full list saved: ${manifestPath}`)
  return lines
}

// ------------------------------------------------------------------- SQL
const safeIds = (ids) => {
  for (const id of ids) if (!Number.isSafeInteger(id) || id < 0) throw new Error('refusing a non-integer row id')
  return [...new Set(ids)].sort((a, b) => a - b)
}
const chunk = (items, size) => {
  const out = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}
// A guard statement: evaluates json('') (malformed JSON -> error) and so
// aborts the file unless `countSql` equals `expected`.
const guard = (label, countSql, expected) =>
  `-- guard: ${label} must be ${expected}\nSELECT CASE WHEN (${countSql}) = ${expected} THEN 1 ELSE json('guard failed: ${label}') END AS guard;`

export function buildD1Sql({ fileAssetIds, importFileIds }) {
  const assets = safeIds(fileAssetIds)
  const importFiles = safeIds(importFileIds)
  const inList = (ids) => ids.join(', ')
  const lines = ['-- purge-non-media-uploads.mjs D1 changes. Generated; do not edit.']
  const assetCount = (ids) => `SELECT COUNT(*) FROM file_assets WHERE id IN (${inList(ids)})`
  const fileCount = (ids, purged) => `SELECT COUNT(*) FROM import_job_files WHERE id IN (${inList(ids)})${purged ? " AND status = 'purged'" : ''}`
  const pre = []
  const change = []
  const post = []
  for (const ids of chunk(assets, 400)) {
    pre.push(guard('file_assets rows present before', assetCount(ids), ids.length))
    change.push(`UPDATE import_job_files SET file_asset_id = NULL, status = 'purged', updated_at = CURRENT_TIMESTAMP WHERE file_asset_id IN (${inList(ids)});`)
    change.push(`DELETE FROM file_assets WHERE id IN (${inList(ids)});`)
    post.push(guard('file_assets rows left after', assetCount(ids), 0))
  }
  for (const ids of chunk(importFiles, 400)) {
    pre.push(guard('import_job_files rows present before', fileCount(ids, false), ids.length))
    change.push(`UPDATE import_job_files SET status = 'purged', updated_at = CURRENT_TIMESTAMP WHERE id IN (${inList(ids)});`)
    post.push(guard('import_job_files rows purged after', fileCount(ids, true), ids.length))
  }
  if (!change.length) return null
  return [...lines, '-- pre-assertions', ...pre, '-- changes', ...change, '-- post-assertions', ...post, ''].join('\n')
}

// ------------------------------------------------------------ Cloudflare
function readWranglerIds() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const tomlPath = path.resolve(here, '..', '..', 'cloudflare', 'wrangler.toml')
  const text = fs.readFileSync(tomlPath, 'utf8')
  const accountId = /^account_id\s*=\s*"([0-9a-f]{32})"/m.exec(text)?.[1]
  const dbBlock = /database_name\s*=\s*"business-os"\s*\r?\ndatabase_id\s*=\s*"([0-9a-f-]{36})"/.exec(text)?.[1]
  return { accountId, databaseId: dbBlock }
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = function writeToOutput(text) {
      // Show the question, hide whatever is typed or pasted.
      if (text.includes(question)) rl.output.write(text)
    }
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()) })
  })
}
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()) })
  })
}

function makeClient(token, accountId, databaseId) {
  const headers = { Authorization: `Bearer ${token}` }
  const r2Base = `${API}/accounts/${accountId}/r2/buckets/${BUCKET}/objects`
  async function json(url, init = {}) {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.success === false) {
      const reason = body?.errors?.map((error) => `${error.code}: ${error.message}`).join('; ') || `HTTP ${response.status}`
      throw new Error(`Cloudflare API refused ${init.method || 'GET'} ${url.replace(API, '')}: ${reason}`)
    }
    return body
  }
  return {
    async listObjects(prefix) {
      const objects = []
      let cursor = ''
      for (;;) {
        const query = new URLSearchParams({ prefix, per_page: '1000' })
        if (cursor) query.set('cursor', cursor)
        const body = await json(`${r2Base}?${query}`)
        const page = Array.isArray(body.result) ? body.result : body.result?.objects || []
        for (const object of page) objects.push({ key: object.key, size: Number(object.size || 0), uploaded: object.last_modified || object.uploaded || null })
        const info = body.result_info || {}
        cursor = info.cursor || body.result?.cursor || ''
        const truncated = info.is_truncated ?? body.result?.truncated ?? Boolean(cursor && page.length)
        if (!truncated || !cursor) break
      }
      return objects
    },
    // First `limit` bytes of an object (the stream is cancelled after), and
    // its content-encoding (fetch decodes compressed bodies on the way in).
    async readHead(key, limit) {
      const response = await fetch(`${r2Base}/${encodeURIComponent(key)}`, { headers: { ...headers, Range: `bytes=0-${limit - 1}` } })
      if (!response.ok) throw new Error(`could not read ${key}: HTTP ${response.status}`)
      const contentEncoding = response.headers.get('content-encoding') || ''
      const reader = response.body.getReader()
      const parts = []
      let total = 0
      while (total < limit) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        total += value.length
      }
      await reader.cancel().catch(() => {})
      const out = new Uint8Array(Math.min(total, limit))
      let offset = 0
      for (const part of parts) {
        const slice = part.subarray(0, Math.min(part.length, out.length - offset))
        out.set(slice, offset)
        offset += slice.length
        if (offset >= out.length) break
      }
      return { bytes: out, contentEncoding }
    },
    async deleteObject(key) {
      await json(`${r2Base}/${encodeURIComponent(key)}`, { method: 'DELETE' })
    },
    async d1(sql, params = []) {
      const body = await json(`${API}/accounts/${accountId}/d1/database/${databaseId}/query`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }),
      })
      return body.result
    },
  }
}

const rowsOf = (result) => (Array.isArray(result) ? result.flatMap((statement) => statement?.results || []) : [])

// ------------------------------------------------------------------ main
async function main() {
  const doDelete = process.argv.includes('--delete')
  const fromToml = (() => { try { return readWranglerIds() } catch { return {} } })()
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || fromToml.accountId
  const databaseId = process.env.BUSINESS_OS_D1_DATABASE_ID || fromToml.databaseId
  if (!accountId || !databaseId) {
    console.error('FAILED: could not read the account id / database id from cloudflare/wrangler.toml. Run this from the business-os-v1 folder.')
    process.exit(1)
  }
  const token = process.env.CLOUDFLARE_API_TOKEN || await promptHidden('Cloudflare API token: ')
  if (!token) { console.error('FAILED: no token given.'); process.exit(1) }
  const cf = makeClient(token, accountId, databaseId)

  console.log(doDelete ? 'Mode: DELETE (asks before changing anything)' : 'Mode: DRY RUN (changes nothing)')
  console.log('Reading the database (read-only)...')
  const activeJobIds = new Set(rowsOf(await cf.d1(
    `SELECT id FROM import_jobs WHERE status IN (${ACTIVE_JOB_STATUSES.map(() => '?').join(', ')})`, ACTIVE_JOB_STATUSES,
  )).map((row) => String(row.id)))
  const assetRows = rowsOf(await cf.d1('SELECT id, stored_name, public_path FROM file_assets'))
  const jobFileRows = rowsOf(await cf.d1("SELECT id, job_id, stored_path, file_asset_id FROM import_job_files WHERE stored_path LIKE 'uploads/%' OR stored_path LIKE 'private/%' OR stored_path LIKE 'imports/%'"))
  const assetsByKey = new Map()
  for (const row of assetRows) {
    for (const key of assetKeys(row)) {
      if (!assetsByKey.has(key)) assetsByKey.set(key, [])
      assetsByKey.get(key).push(Number(row.id))
    }
  }
  const jobFilesByKey = new Map()
  for (const row of jobFileRows) {
    const key = String(row.stored_path)
    if (!jobFilesByKey.has(key)) jobFilesByKey.set(key, [])
    jobFilesByKey.get(key).push(Number(row.id))
  }

  console.log('Listing and checking stored files...')
  const entries = []
  for (const prefix of PREFIXES) {
    const objects = await cf.listObjects(prefix)
    for (const object of objects) {
      let read = object.size > 0 ? await cf.readHead(object.key, Math.min(object.size, HEAD_BYTES)) : { bytes: new Uint8Array(0), contentEncoding: '' }
      // An image the app accepts is read whole, so hidden markup anywhere
      // in it is found.
      if (!read.contentEncoding && read.bytes.length < object.size && object.size <= FULL_SCAN_MAX_BYTES && detectUploadFormat(read.bytes)?.kind === 'image') {
        read = await cf.readHead(object.key, object.size)
      }
      const verdict = classifyObject({
        key: object.key, size: object.size, bytes: read.bytes, complete: read.bytes.length >= object.size, activeJobIds, contentEncoding: read.contentEncoding,
      })
      entries.push({
        key: object.key, size: object.size, uploaded: object.uploaded, ...verdict,
        file_asset_ids: assetsByKey.get(object.key) || [],
        import_job_file_ids: jobFilesByKey.get(object.key) || [],
      })
      if (entries.length % 200 === 0) console.log(`  ...${entries.length} checked`)
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(os.homedir(), 'business-os-purge', stamp)
  fs.mkdirSync(outDir, { recursive: true })
  const manifestPath = path.join(outDir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify({ bucket: BUCKET, prefixes: PREFIXES, mode: doDelete ? 'delete' : 'dry-run', createdAt: new Date().toISOString(), entries }, null, 2))

  const toPurge = entries.filter((entry) => entry.action === 'purge')
  const rowPlan = planRowChanges(entries, assetRows, jobFileRows)
  for (const line of formatReport(entries, { purgeTitle: 'PURGE -- deleted with --delete', rowPlan, manifestPath })) console.log(line)

  if (!doDelete) {
    console.log('\nDry run finished. Nothing was changed. To delete, run again with --delete.')
    return
  }
  if (!toPurge.length) { console.log('\nNothing to delete. Done.'); return }
  const answer = await prompt(`\nType DELETE to permanently delete ${toPurge.length} files: `)
  if (answer !== 'DELETE') { console.log('Not confirmed. Nothing was changed.'); return }

  const deleted = []
  const failed = []
  for (const entry of toPurge) {
    try { await cf.deleteObject(entry.key); deleted.push(entry) } catch (error) { failed.push({ key: entry.key, error: String(error.message || error) }) }
    if ((deleted.length + failed.length) % 100 === 0) console.log(`  ...${deleted.length + failed.length} of ${toPurge.length}`)
  }
  fs.writeFileSync(path.join(outDir, 'deleted.json'), JSON.stringify({ deleted: deleted.map((entry) => entry.key), failed }, null, 2))
  console.log(`Deleted ${deleted.length} files${failed.length ? `; FAILED to delete ${failed.length} (listed in deleted.json)` : ''}.`)

  // D1: only rows whose file really was deleted (a failed delete counts as kept).
  const deletedKeys = new Set(deleted.map((entry) => entry.key))
  const outcome = entries.map((entry) => (entry.action === 'purge' && !deletedKeys.has(entry.key) ? { ...entry, action: 'keep' } : entry))
  const { fileAssetIds, importFileIds } = planRowChanges(outcome, assetRows, jobFileRows)
  const sql = buildD1Sql({ fileAssetIds, importFileIds })
  if (!sql) { console.log('No database rows to change. Done.'); return }
  const sqlPath = path.join(outDir, 'd1-changes.sql')
  fs.writeFileSync(sqlPath, sql)
  console.log(`Database changes saved: ${sqlPath}`)
  try {
    await cf.d1(sql)
  } catch (error) {
    console.error(`FAILED: the database changes were refused (${error.message}).`)
    console.error('The files above are already deleted; the database was not changed by the refused step. Send this printout.')
    process.exit(1)
  }
  // Post-check read back independently of the file's own guards.
  const leftAssets = fileAssetIds.length ? rowsOf(await cf.d1(`SELECT COUNT(*) AS n FROM file_assets WHERE id IN (${fileAssetIds.join(', ')})`))[0]?.n : 0
  if (Number(leftAssets || 0) !== 0) { console.error(`FAILED: ${leftAssets} Library rows are still present.`); process.exit(1) }
  console.log(`Removed ${fileAssetIds.length} Library rows; marked ${importFileIds.length} import rows purged.`)
  console.log('Done.')
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    // Never echo the token: error messages here come from the API or fs.
    console.error(`FAILED: ${String(error?.message || error)}`)
    process.exit(1)
  })
}
