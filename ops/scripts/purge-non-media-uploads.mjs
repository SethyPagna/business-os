#!/usr/bin/env node
// purge-non-media-uploads.mjs -- OWNER-RUN. Moves stored files that are
// not images or videos out of the website's storage (owner ruling
// 2026-09-26: "delete them all"; everything must stay recoverable). They go
// to quarantine/ in the same bucket, from where --restore puts them back.
//
// =====================================================================
//  HOW TO RUN IT (step by step, from YOUR OWN terminal)
// =====================================================================
//  Before you start: you need Node.js 18 or newer. Check with `node -v`.
//  Nothing is changed unless you add --move in step 5 and type MOVE.
//  `node ops/scripts/purge-non-media-uploads.mjs --help` shows the options.
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
//     PURGE, and the folder where it saved the full list (listing.json).
//     If the numbers look wrong, STOP and send the printout.
//
//  5. Move the PURGE files to quarantine:
//         node ops/scripts/purge-non-media-uploads.mjs --move
//     Paste the token again. It checks everything again, prints the same
//     summary, then asks you to type MOVE. Type MOVE (capitals) and press
//     Enter. Each file is copied to quarantine/<time>/, the copy is checked
//     byte for byte, and only then is the original removed.
//
//  6. When it prints "Done", send the last lines of the printout. KEEP the
//     folder it names: its manifest.json is the record of what moved where
//     and of the database rows it changed, and --restore needs it. You can
//     then delete the token on the API tokens page.
//
//  To put everything back (any time before the quarantine is deleted):
//         node ops/scripts/purge-non-media-uploads.mjs --restore "<the manifest.json path it printed>"
//     Type RESTORE when asked. Running it again is safe.
//
//  If anything prints "FAILED", it stops; files not yet removed stay where
//  they are. Send the printout; --restore undoes whatever was done.
//
//  Deleting the quarantine for good (only when you are sure, for example a
//  month later -- after this, --restore cannot bring those files back):
//  this script never does it. In the Cloudflare dashboard open R2 >
//  business-os-assets > Settings > Object lifecycle rules > Add rule; set
//  the prefix to the quarantine folder it printed (quarantine/<time>/),
//  choose to delete objects 1 day after upload, and save. Remove the rule
//  once the folder is empty.
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
//                 text that starts like a media file, and files it cannot
//                 identify -- kept, and listed for you;
//         PURGE   only files it positively recognises as documents (PDF,
//                 Word, Excel...), web pages, SVG, XML, text, CSV, JSON,
//                 scripts, archives (ZIP...), programs or fonts.
//   (c) Saves listing.json: every file's key, size, decision, group, format
//       and matching file_assets / import_job_files row ids. A dry run stops
//       here.
//   (d) --move, after you type MOVE, in this order, so that a failure at
//       any point leaves nothing --restore cannot undo:
//         1. writes manifest.json (the recovery record) before anything else;
//         2. per PURGE file: reads it whole, re-checks the whole file is
//            still a PURGE file, copies it to quarantine/<time>/<its key>,
//            reads the copy back and compares SHA-256 and size, and records
//            key, quarantine key, size, SHA-256 and content type. Originals
//            are untouched in this step; a file that cannot be copied
//            exactly stays where it is;
//         3. records every column of every database row it will change in
//            manifest.json, then changes them in guarded batches: a guard
//            refuses a batch unless the rows are exactly the recorded ones,
//            and the counts are read back afterwards --
//              - file_assets rows of moved Library files are removed (their
//                import_job_files links are cleared first) -- never a row
//                that also points at a file that is kept;
//              - import_job_files rows of moved files are marked 'purged';
//            if the database refuses anything, it stops here and removes no
//            original;
//         4. removes each original, only if it is still byte for byte the
//            file that was copied.
//   (e) --restore <manifest.json or its folder>, after you type RESTORE:
//       puts every recorded file back under its key (SHA-256 checked before
//       and after), removes its quarantine copy, removes quarantine copies a
//       stopped run did not record when their original is in place, then
//       puts the Library rows back with every recorded column and the import
//       rows' status, file_asset_id and updated_at. It never overwrites a
//       different file, and running it again changes nothing. It writes
//       restore-<time>.json next to the manifest. A manifest recording a
//       row that belongs to none of its moved files (an edited file) is
//       refused before anything is written (restorableRows).
//
// Read-only on anything else. It never touches objects outside the three
// prefixes (backups, exports, etc.) and its own quarantine/<time>/ folder.
// The website never serves quarantine/: /uploads/* always reads the key
// uploads/<path> (cloudflare/scripts/test-quarantine-unreachable-pure.cjs).
// Written for the owner's terminal because Claude-launched processes cannot
// reach the Cloudflare API reliably through the VPN.

import { createHash } from 'node:crypto'
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
// 'moov' and 'mdat' as a big-endian number.
const QUICKTIME_MOVIE_ATOMS = [0x6d6f6f76, 0x6d646174]

// S-uploads4: what the atoms hold must be binary data (see uploadSecurity.ts).
function detectQuickTimeAtoms(bytes) {
  if (bytes.length < 8 || !QUICKTIME_LEADING_ATOMS.includes(asciiAt(bytes, 4, 8))) return null
  if (readU32BE(bytes, 0) > bytes.length && [0, 1, 2, 3].every((index) => bytes[index] >= 0x20 && bytes[index] <= 0x7e)) return null
  let offset = 0
  let sawMovie = false
  const content = []
  while (offset + 8 <= bytes.length) {
    if (!isFourCcAt(bytes, offset + 4)) return null
    if (QUICKTIME_MOVIE_ATOMS.includes(readU32BE(bytes, offset + 4))) sawMovie = true
    let size = readU32BE(bytes, offset)
    let header = 8
    if (size === 1) {
      if (offset + 16 > bytes.length) break
      size = readU32BE(bytes, offset + 8) * 0x100000000 + readU32BE(bytes, offset + 12)
      header = 16
    } else if (size === 0) {
      size = bytes.length - offset
    }
    if (size < header) return null
    sampleContent(content, bytes, offset + header, offset + size)
    offset += size
  }
  return sawMovie && content.length > 0 && !sampleLooksLikeText(content, false) ? { kind: 'video', mime: 'video/quicktime', extension: '.mov' } : null
}

export const EMBEDDED_MARKUP_TOKENS = [
  '<script', '<html', '<svg', '<iframe', '<body', '<object', '<embed', '<!doctype html', '<meta', '<img', '<a href', 'javascript:',
  '<style', '<form', '<link', '<base', '<frame', '<frameset', '<applet', '<math',
  '<details', '<input', '<video', '<audio', '<marquee', '<textarea', '<select', '<noscript', '<template', '<button', '<dialog',
  '<keygen', '<isindex', '<source', '<bgsound',
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

function tagStartAt(bytes, index) {
  return isAsciiLetter(bytes[index + 1]) || (bytes[index + 1] === 0x00 && isAsciiLetter(bytes[index + 2]) && bytes[index + 3] === 0x00)
}

// S-uploads3/4: an event handler in a 'full' region after a tag start
// anywhere before it, at any distance (see uploadSecurity.ts).
function firstTagStart(bytes) {
  for (let index = bytes.indexOf(0x3c); index !== -1; index = bytes.indexOf(0x3c, index + 1)) {
    if (tagStartAt(bytes, index)) return index
  }
  return -1
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
  const regions = planMarkupScan(bytes)
  for (const region of regions) {
    if (markupInRange(bytes, region.start, region.end, region.mode)) return true
  }
  const tagStart = firstTagStart(bytes)
  if (tagStart === -1) return false
  return regions.some((region) => region.mode === 'full' && eventHandlerInRange(bytes, Math.max(region.start, tagStart + 2), region.end))
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
// END mirror of cloudflare/src/lib/uploadSecurity.ts (upload allowlist)
// =====================================================================
// ALSO MIRRORED (S-uploads3, 2026-09-27): detectOtherMedia and
// otherMediaLooksLikeText below, with every declaration they use
// (zipFirstEntry, isNetpbm, quickTimeAtomsFit, id3TagFits, decodeText...).
// The Worker judges STORED files -- /uploads/* serving and the backup
// restore -- with the same code, so a restore puts back exactly what this
// script keeps. The same parity test holds them token-identical.

const u16leAt = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8)
const u16beAt = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1]
const textAt = (bytes, offset, text) => asciiAt(bytes, offset, offset + text.length) === text
const latin1Head = (bytes, limit) => String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, limit)))
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

// S-uploads3 (2026-09-27): the loose QuickTime and MP3 signatures below
// kept crafted text as media (R-uploads2: `\0\0\0\x08free` followed by
// notes, `ID3\x03\x00` followed by notes). Every atom header within the
// bytes read must be a four-character type with a size that stays inside
// the file; the last one may run past the bytes read.
// S-uploads4 (R-uploads3): text still passed behind a size-0 atom (it runs
// to the end of the file), an atom sized to the whole file or more than 64
// empty atoms -- the zero bytes of the headers kept otherMediaLooksLikeText
// from seeing it. Every atom is walked, and what the atoms hold, their
// headers set aside, must be binary data, as in a real movie: not text, and
// not nothing (empty atoms up to the end of the bytes read hide the rest).
function quickTimeAtomsFit(bytes, totalSize) {
  let offset = 0
  const content = []
  while (offset + 8 <= bytes.length) {
    if (!isFourCcAt(bytes, offset + 4)) return false
    let size = readU32BE(bytes, offset)
    let header = 8
    if (size === 1) {
      if (offset + 16 > bytes.length) break
      size = readU32BE(bytes, offset + 8) * 0x100000000 + readU32BE(bytes, offset + 12)
      header = 16
    } else if (size === 0) {
      size = totalSize - offset // runs to the end of the file
    }
    if (size < header || offset + size > totalSize) return false
    sampleContent(content, bytes, offset + header, offset + size)
    offset += size
  }
  return content.length > 0 && !sampleLooksLikeText(content, sampleIsWhole(bytes, totalSize))
}

// An ID3v2 header: version 2-4, only the flag bits that version defines,
// a sync-safe size (every byte under 0x80) and a tag that fits in the file.
// S-uploads4 (R-uploads3): neither the tag (frames and zero padding in a
// real file) nor what follows it (the audio) may be text -- an empty or
// padded tag in front of notes kept them as an MP3.
const ID3_UNDEFINED_FLAG_BITS = [0x3f, 0x1f, 0x0f]
function id3TagFits(bytes, totalSize) {
  if (bytes.length < 10 || bytes[3] < 2 || bytes[3] > 4 || bytes[4] === 0xff) return false
  if (bytes[5] & ID3_UNDEFINED_FLAG_BITS[bytes[3] - 2]) return false
  if ([6, 7, 8, 9].some((index) => bytes[index] >= 0x80)) return false
  const tagEnd = 10 + bytes[6] * 0x200000 + bytes[7] * 0x4000 + bytes[8] * 0x80 + bytes[9]
  if (tagEnd > totalSize) return false
  return [[10, tagEnd], [tagEnd, totalSize]].every(([start, end]) => {
    const content = []
    sampleContent(content, bytes, start, end)
    return !sampleLooksLikeText(content, sampleIsWhole(bytes, end))
  })
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
    return media('MP4 family (brand ' + printable(ftyp.major) + ')')
  }
  // QuickTime atoms that do not chain within the bytes read, as long as
  // every atom header that is read fits in the file (see quickTimeAtomsFit).
  if (bytes.length >= 8 && QUICKTIME_LEADING_ATOMS.includes(asciiAt(bytes, 4, 8)) && quickTimeAtomsFit(bytes, totalSize)) return media('QuickTime')
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
  if (has(0, 'ID3') && id3TagFits(bytes, totalSize)) return media('MP3')
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
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(sample.subarray(start, end)) } catch { text = null }
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

// S-uploads4 (2026-09-27): what a container holds, its own headers set
// aside, judged as text (QuickTime atoms, an ID3 tag). `sample` collects it
// from each part in turn. S-uploads5 (R-S-uploads4 F10): only what lies in
// the file's first TEXT_SAMPLE_BYTES is collected -- the head every caller
// reads -- so a whole file and its first 4 KB give the same sample. Before,
// a whole-file read also sampled content past that head, and the same
// object could be text in the head and a movie in the whole file. The sample
// is complete when the file ends inside the head (see sampleIsWhole).
function sampleContent(sample, bytes, start, end) {
  for (let index = start; index < Math.min(end, bytes.length, TEXT_SAMPLE_BYTES); index += 1) sample.push(bytes[index])
}

// True when the content sampled up to `end` is all there is: it ends
// inside the head and inside the bytes read.
function sampleIsWhole(bytes, end) {
  return end <= Math.min(bytes.length, TEXT_SAMPLE_BYTES)
}

function sampleLooksLikeText(sample, complete) {
  return sample.length > 0 && decodeText(Uint8Array.from(sample), complete) !== null
}

// Media formats that are plain text by design.
const TEXT_MEDIA_FORMATS = ['XPM', 'XBM', 'NetPBM', 'Radiance HDR', 'FITS']

// S-uploads3 (2026-09-27): some signatures detectOtherMedia accepts are
// loose enough for text to meet them -- MPEG transport-stream sync bytes
// ('G') 188 apart in a CSV, the AC-3 sync word (vertical tab, 'w'). Media of
// every other format has control bytes within its first bytes, so when the
// data also decodes as text it is neither kept as media nor purged as text:
// it goes to review.
export function otherMediaLooksLikeText(other, bytes, complete = true) {
  return !TEXT_MEDIA_FORMATS.includes(other.format) && decodeText(bytes, complete) !== null
}

// ------------------------------------------- stored media: one verdict
// S-uploads5 (2026-09-28, refuter R-S-uploads4 F10). Three callers judge an
// object already in storage: /uploads/* for a key whose name says nothing
// (the Worker's lib/r2.ts), this script and the backup restore
// (lib/backup.ts). Each put the detectors above together itself, on as many
// bytes as it had read -- 64 for /uploads, HEAD_BYTES here, the whole file
// for the restore -- so a classic QuickTime movie whose first free/skip atom
// holds 56+ bytes of encoder text was text to /uploads (a 404) and a movie
// here and in the restore. This is the one judgement all three use, and it
// looks only at the object's first STORED_MEDIA_HEAD_BYTES, which each of
// them reads (or the whole object when it is smaller): they cannot disagree
// about the same object. The head is decodeText's and sampleContent's
// window too. 'allowed' says only what an image is: whoever keeps or writes
// one still scans all of it with containsEmbeddedMarkup.
export const STORED_MEDIA_HEAD_BYTES = TEXT_SAMPLE_BYTES

// `complete`: `bytes` is the whole object; `totalSize` is its size.
// Returns { kind: 'allowed', format } (on the upload allowlist),
// { kind: 'other', media } (other media, kept), { kind: 'text', media }
// (starts like other media, reads as text: review) or null.
export function judgeStoredMedia(bytes, totalSize, complete = bytes.length >= totalSize) {
  const head = bytes.subarray(0, STORED_MEDIA_HEAD_BYTES)
  const format = detectUploadFormat(head)
  if (format) return { kind: 'allowed', format }
  const media = detectOtherMedia(head, totalSize)
  if (!media) return null
  return otherMediaLooksLikeText(media, head, complete && head.length === bytes.length) ? { kind: 'text', media } : { kind: 'other', media }
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
  // The same judgement /uploads/* and the backup restore make (see
  // judgeStoredMedia); an image is still scanned whole for markup.
  const stored = judgeStoredMedia(bytes, total, complete)
  if (stored && stored.kind === 'allowed') {
    const allowed = stored.format
    if (allowed.kind === 'video') return media('videos', allowed.mime)
    const checked = { checked: complete ? 'whole file' : `first ${bytes.length} bytes` }
    if (containsEmbeddedMarkup(bytes)) return verdict('image-with-code', allowed.mime, checked)
    return media('images', allowed.mime, checked)
  }
  if (stored && stored.kind === 'text') return verdict('unrecognised', `text that starts like ${stored.media.format}`)
  if (stored) return media(stored.media.kind === 'photo' ? 'other-images' : 'other-video-audio', stored.media.format)
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

// The guarded SQL for one batch of row changes. `linkedImportFileIds`, when
// given, are the import rows linked to these Library rows as recorded in
// manifest.json: a guard refuses the batch unless they are exactly the rows
// the first UPDATE touches, so --restore can put every changed row back.
export function buildD1Sql({ fileAssetIds, importFileIds, linkedImportFileIds = null }) {
  const assets = safeIds(fileAssetIds)
  const importFiles = safeIds(importFileIds)
  const linked = linkedImportFileIds === null ? null : safeIds(linkedImportFileIds)
  const inList = (ids) => ids.join(', ')
  const lines = ['-- purge-non-media-uploads.mjs D1 changes. Generated; do not edit.']
  const assetCount = (ids) => `SELECT COUNT(*) FROM file_assets WHERE id IN (${inList(ids)})`
  const fileCount = (ids, purged) => `SELECT COUNT(*) FROM import_job_files WHERE id IN (${inList(ids)})${purged ? " AND status = 'purged'" : ''}`
  const pre = []
  const change = []
  const post = []
  if (linked && assets.length) {
    const linkedCount = `SELECT COUNT(*) FROM import_job_files WHERE file_asset_id IN (${inList(assets)})`
    pre.push(guard('import_job_files rows linked before', linkedCount, linked.length))
    if (linked.length) pre.push(guard('import_job_files linked rows are the recorded ones', `${linkedCount} AND id IN (${inList(linked)})`, linked.length))
  }
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

// The row changes as batches small enough for one D1 request each, built
// from the recorded rows: every Library row and every import row a batch
// touches is in `snapshot`.
export function planD1Batches(snapshot, importFileIds, size = 100) {
  const batches = []
  const assetIds = safeIds(snapshot.file_assets.map((row) => Number(row.id)))
  for (const ids of chunk(assetIds, size)) {
    const inBatch = new Set(ids)
    const linked = snapshot.import_job_files.filter((row) => inBatch.has(Number(row.file_asset_id))).map((row) => Number(row.id))
    batches.push({ fileAssetIds: ids, importFileIds: [], linkedImportFileIds: safeIds(linked) })
  }
  const recorded = new Set(snapshot.import_job_files.map((row) => Number(row.id)))
  const linkedToRemoved = new Set(snapshot.import_job_files.filter((row) => assetIds.includes(Number(row.file_asset_id))).map((row) => Number(row.id)))
  const importIds = safeIds(importFileIds).filter((id) => recorded.has(id) && !linkedToRemoved.has(id))
  for (const ids of chunk(importIds, size)) batches.push({ fileAssetIds: [], importFileIds: ids, linkedImportFileIds: null })
  return batches
}

// ------------------------------------------------------------ quarantine
// Where --move puts files: quarantine/<time>/<the file's own key>. Nothing
// the website serves can reach it (/uploads/* always reads uploads/<path>;
// see cloudflare/scripts/test-quarantine-unreachable-pure.cjs), and this
// script never lists it as a purge candidate.
export const QUARANTINE_ROOT = 'quarantine/'
// The API moves a file in one request; a larger file stays where it is.
export const MOVE_MAX_BYTES = 300 * 1024 * 1024
const R2_KEY_MAX_BYTES = 1024
export const MANIFEST_TOOL = 'purge-non-media-uploads'
export const MANIFEST_FORMAT = 2
const STAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z$/
const COLUMN_PATTERN = /^[a-z_][a-z0-9_]*$/
// The HTTP metadata R2 keeps with a file and the request header for each.
const HTTP_METADATA_HEADERS = [
  ['contentType', 'content-type'], ['contentDisposition', 'content-disposition'],
  ['contentLanguage', 'content-language'], ['cacheControl', 'cache-control'],
]

export const stampOf = (date) => date.toISOString().replace(/[:.]/g, '-')
export const quarantineKeyFor = (stamp, key) => `${QUARANTINE_ROOT}${stamp}/${key}`
// Each segment of a key is percent-encoded; the slashes between them stay.
export const objectPath = (key) => String(key).split('/').map((segment) => encodeURIComponent(segment)).join('/')
export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')

function normalizeHttpMetadata(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const [field, header] of HTTP_METADATA_HEADERS) {
    const value = source[field] ?? source[header.replace('-', '_')] ?? source[header]
    if (typeof value === 'string' && value) out[field] = value
  }
  return out
}

// Problems that make a manifest unusable for --restore (empty when fine).
// Keys, quarantine keys, hashes and row columns are all checked, so an
// edited file cannot make --restore write anywhere else.
export function validateManifest(manifest) {
  const problems = []
  if (!manifest || manifest.tool !== MANIFEST_TOOL) return ['it was not written by this script']
  if (manifest.format !== MANIFEST_FORMAT) problems.push(`format ${manifest.format} is not ${MANIFEST_FORMAT}`)
  if (manifest.bucket !== BUCKET) problems.push(`it is for bucket ${manifest.bucket}, not ${BUCKET}`)
  if (manifest.mode !== 'move') problems.push('it records a dry run, so nothing was moved')
  const stamp = String(manifest.stamp || '')
  if (!STAMP_PATTERN.test(stamp)) problems.push('its time stamp is malformed')
  if (manifest.quarantinePrefix !== quarantineKeyFor(stamp, '')) problems.push('its quarantine folder does not match its time stamp')
  if (!Array.isArray(manifest.moves)) problems.push('it has no list of moved files')
  for (const move of Array.isArray(manifest.moves) ? manifest.moves : []) {
    const key = String(move?.key ?? '')
    if (!PREFIXES.some((prefix) => key.startsWith(prefix)) || key.length <= 0) problems.push(`a file outside ${PREFIXES.join(', ')}: ${printable(key)}`)
    else if (move.quarantineKey !== quarantineKeyFor(stamp, key)) problems.push(`the quarantine name of ${printable(key)} does not match`)
    if (!/^[0-9a-f]{64}$/.test(String(move?.sha256 ?? ''))) problems.push(`no SHA-256 for ${printable(key)}`)
    if (!Number.isSafeInteger(move?.size) || move.size < 0) problems.push(`no size for ${printable(key)}`)
  }
  const rows = manifest.rows && typeof manifest.rows === 'object' ? manifest.rows : {}
  for (const [table, list] of Object.entries(rows)) {
    if (table !== 'file_assets' && table !== 'import_job_files') { problems.push(`an unexpected table ${printable(table)}`); continue }
    for (const row of Array.isArray(list) ? list : []) {
      if (!Number.isSafeInteger(row?.id)) problems.push(`a ${table} row without a numeric id`)
      for (const [column, value] of Object.entries(row || {})) {
        if (!COLUMN_PATTERN.test(column)) problems.push(`a ${table} column named ${printable(column)}`)
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') problems.push(`a ${table} value that is not text or a number`)
      }
    }
  }
  for (const refused of restorableRows(manifest).refused) {
    problems.push(`a recorded ${refused.table === 'file_assets' ? 'Library' : 'import'} row (id ${printable(String(refused.id))}) ${refused.reason}`)
  }
  return [...new Set(problems)].slice(0, 12)
}

// S-uploads3 (R-uploads2): the recorded rows --restore may write back. --move
// records only rows of files it moved, so a row that belongs to no move in
// the SAME manifest was not written by it: a Library row is put back only
// when it points at a moved file, its public path is that file (or the same
// stored name) under /uploads/, and its type columns are plain types; an
// import row only when its own file was moved or it links to such a Library
// row. Anything else (say an added row id 999 for /uploads/evil.html) is
// refused, and validateManifest names it, so the whole file is refused.
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i
const MEDIA_KIND_PATTERN = /^[a-z]+$/
function libraryRowProblem(row, moved) {
  const publicPath = typeof row?.public_path === 'string' ? row.public_path : ''
  if (!publicPath.startsWith('/uploads/')) return 'has a public path outside /uploads/'
  if (!assetKeys(row).some((key) => moved.has(key))) return 'matches no moved file'
  const own = [publicPath.slice(1)]
  try { own.push(decodeURIComponent(publicPath.slice(1))) } catch { /* not percent-encoded */ }
  if (!own.some((key) => moved.has(key) || (typeof row.stored_name === 'string' && key === `uploads/${row.stored_name}`))) return 'has a public path to a file that was not moved'
  if (row.mime_type != null && !MIME_TYPE_PATTERN.test(String(row.mime_type))) return 'has a mime_type that is not a media type'
  if (row.media_type != null && !MEDIA_KIND_PATTERN.test(String(row.media_type))) return 'has a media_type that is not a plain word'
  return null
}
export function restorableRows(manifest) {
  const moved = new Set((Array.isArray(manifest?.moves) ? manifest.moves : []).map((move) => String(move?.key ?? '')).filter(Boolean))
  const rows = manifest?.rows && typeof manifest.rows === 'object' ? manifest.rows : {}
  const refused = []
  const fileAssets = []
  for (const row of Array.isArray(rows.file_assets) ? rows.file_assets : []) {
    const reason = libraryRowProblem(row, moved)
    if (reason) refused.push({ table: 'file_assets', id: row?.id ?? null, reason })
    else fileAssets.push(row)
  }
  const assetIds = new Set(fileAssets.map((row) => Number(row.id)))
  const importFiles = []
  for (const row of Array.isArray(rows.import_job_files) ? rows.import_job_files : []) {
    const linked = row?.file_asset_id != null && assetIds.has(Number(row.file_asset_id))
    if (moved.has(String(row?.stored_path ?? '')) || linked) importFiles.push(row)
    else refused.push({ table: 'import_job_files', id: row?.id ?? null, reason: 'matches no moved file' })
  }
  return { file_assets: fileAssets, import_job_files: importFiles, refused }
}

// Writes JSON so that a crash leaves either the old file or the new one,
// never half of each, and refuses to write the token.
async function writeJsonAtomic(file, value, secret) {
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (secret && text.includes(secret)) throw new Error(`refusing to write ${path.basename(file)}: it would contain the API token`)
  const temporary = `${file}.tmp`
  const handle = fs.openSync(temporary, 'w')
  try {
    fs.writeSync(handle, text)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(temporary, file)
      return
    } catch (error) {
      // Windows: another program may hold the file open for a moment.
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    }
  }
}

// One save at a time, in order, even when called from parallel work.
function makeSaver(file, value, secret) {
  let chain = Promise.resolve()
  return () => {
    chain = chain.then(() => writeJsonAtomic(file, value(), secret))
    return chain
  }
}

// Runs `worker` over `items`, `limit` at a time. The first error stops the
// remaining work and is thrown once every running item has finished.
async function mapLimit(items, limit, worker) {
  let next = 0
  let failure = null
  const runner = async () => {
    while (!failure && next < items.length) {
      const index = next
      next += 1
      try { await worker(items[index], index) } catch (error) { failure = failure || error }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runner))
  if (failure) throw failure
}

// Files larger than this are handled one at a time: each is held in memory
// whole, twice while its copy is checked.
export const LARGE_FILE_BYTES = 32 * 1024 * 1024
// mapLimit for files: the small ones `limit` at a time, then the large ones
// one by one. `worker` gets each item with its index in `items`.
async function mapBySize(items, sizeOf, limit, largeFileBytes, worker) {
  const indexed = items.map((item, index) => ({ item, index }))
  const large = (entry) => Number(sizeOf(entry.item)) > largeFileBytes
  await mapLimit(indexed.filter((entry) => !large(entry)), limit, (entry) => worker(entry.item, entry.index))
  await mapLimit(indexed.filter(large), 1, (entry) => worker(entry.item, entry.index))
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

// The Cloudflare API with the token. Error messages name the method and
// the path, never a header, so the token cannot appear in one.
export function makeClient({ token, accountId, databaseId, fetchImpl = globalThis.fetch }) {
  const headers = { Authorization: `Bearer ${token}` }
  const r2Base = `${API}/accounts/${accountId}/r2/buckets/${BUCKET}/objects`
  const objectUrl = (key) => `${r2Base}/${objectPath(key)}`
  const call = (url, init = {}) => fetchImpl(url, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const refusalOf = (body, status, method, url) => {
    const reason = body?.errors?.map((error) => `${error.code}: ${error.message}`).join('; ') || `HTTP ${status}`
    return new Error(`Cloudflare API refused ${method} ${url.replace(API, '')}: ${reason}`)
  }
  const refusal = async (response, method, url) => refusalOf(await response.json().catch(() => null), response.status, method, url)
  async function json(url, init = {}) {
    const response = await call(url, init)
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.success === false) throw refusalOf(body, response.status, init.method || 'GET', url)
    return body
  }
  async function readBody(response, limit) {
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
    return out
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
        for (const object of page) {
          objects.push({
            key: object.key, size: Number(object.size || 0), uploaded: object.last_modified || object.uploaded || null,
            etag: object.etag || '', httpMetadata: normalizeHttpMetadata(object.http_metadata || object.httpMetadata),
          })
        }
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
      const url = objectUrl(key)
      const response = await call(url, { headers: { Range: `bytes=0-${limit - 1}` } })
      if (!response.ok) throw await refusal(response, 'GET', url)
      const contentEncoding = response.headers.get('content-encoding') || ''
      return { bytes: await readBody(response, limit), contentEncoding }
    },
    // The whole object, or null when there is none under `key`.
    async getObject(key) {
      const url = objectUrl(key)
      const response = await call(url)
      if (response.status === 404) { await response.body?.cancel().catch(() => {}); return null }
      if (!response.ok) throw await refusal(response, 'GET', url)
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') || '',
        contentEncoding: response.headers.get('content-encoding') || '',
        etag: response.headers.get('etag') || '',
      }
    },
    async putObject(key, bytes, httpMetadata = {}) {
      const extra = {}
      for (const [field, header] of HTTP_METADATA_HEADERS) if (httpMetadata[field]) extra[header] = String(httpMetadata[field])
      await json(objectUrl(key), { method: 'PUT', headers: extra, body: bytes })
    },
    // True when an object was there; false when there was none.
    async deleteObject(key) {
      const url = objectUrl(key)
      const response = await call(url, { method: 'DELETE' })
      if (response.status === 404) { await response.body?.cancel().catch(() => {}); return false }
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success === false) throw refusalOf(body, response.status, 'DELETE', url)
      return true
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

async function readActiveJobIds(cf) {
  return new Set(rowsOf(await cf.d1(
    `SELECT id FROM import_jobs WHERE status IN (${ACTIVE_JOB_STATUSES.map(() => '?').join(', ')})`, ACTIVE_JOB_STATUSES,
  )).map((row) => String(row.id)))
}

async function readRowIndex(cf) {
  const assetRows = rowsOf(await cf.d1('SELECT id, stored_name, public_path FROM file_assets'))
  const jobFileRows = rowsOf(await cf.d1("SELECT id, job_id, stored_path, file_asset_id FROM import_job_files WHERE stored_path LIKE 'uploads/%' OR stored_path LIKE 'private/%' OR stored_path LIKE 'imports/%'"))
  return { assetRows, jobFileRows }
}

// Every column of every row the change will touch, read just before it.
async function snapshotRows(cf, plan) {
  const fileAssets = []
  for (const ids of chunk(safeIds(plan.fileAssetIds), 100)) {
    fileAssets.push(...rowsOf(await cf.d1(`SELECT * FROM file_assets WHERE id IN (${ids.join(', ')}) ORDER BY id`)))
  }
  const importRows = new Map()
  for (const ids of chunk(safeIds(fileAssets.map((row) => Number(row.id))), 100)) {
    for (const row of rowsOf(await cf.d1(`SELECT * FROM import_job_files WHERE file_asset_id IN (${ids.join(', ')}) ORDER BY id`))) importRows.set(Number(row.id), row)
  }
  for (const ids of chunk(safeIds(plan.importFileIds), 100)) {
    for (const row of rowsOf(await cf.d1(`SELECT * FROM import_job_files WHERE id IN (${ids.join(', ')}) ORDER BY id`))) importRows.set(Number(row.id), row)
  }
  return { file_assets: fileAssets, import_job_files: [...importRows.values()].sort((a, b) => Number(a.id) - Number(b.id)) }
}

// ------------------------------------------------------------------ help
export const HELP = `purge-non-media-uploads.mjs -- keeps images and videos, moves everything
else out of the website's storage into quarantine/, where it can be put back.

  node ops/scripts/purge-non-media-uploads.mjs
      Dry run (the default): lists and checks every file, prints what it
      would keep and move, saves listing.json. Changes nothing.

  node ops/scripts/purge-non-media-uploads.mjs --move
      Asks you to type MOVE, then for each PURGE file: copies it to
      quarantine/<time>/<its name> in the same bucket, reads the copy back
      and compares it byte for byte (SHA-256), records it in manifest.json,
      records the database rows it will change (with all their old values),
      changes those rows, and only then removes the original. Files it cannot
      copy exactly stay where they are.

  node ops/scripts/purge-non-media-uploads.mjs --restore <manifest.json or its folder>
      Asks you to type RESTORE, then puts every file that --move moved back
      under its old name (checked byte for byte), removes its quarantine
      copy, and puts the database rows back. Never overwrites a different
      file. Safe to run again.

  --help   shows this.

There is no --delete: the quarantine copies stay until you delete them
yourself, which this script never does (see "Deleting the quarantine for
good" at the top of the script). Until then --restore can undo a --move.

The token is read from CLOUDFLARE_API_TOKEN or asked for (hidden). It is
never printed and never written to any file.`

function parseArgs(argv) {
  const options = { mode: 'dry-run', restorePath: '', help: false, errors: [] }
  const setMode = (mode) => {
    if (options.mode !== 'dry-run' && options.mode !== mode) options.errors.push('Use either --move or --restore, not both.')
    options.mode = mode
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index])
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--move') setMode('move')
    else if (arg === '--restore' || arg.startsWith('--restore=')) {
      setMode('restore')
      options.restorePath = arg === '--restore' ? String(argv[++index] ?? '') : arg.slice('--restore='.length)
      if (!options.restorePath) options.errors.push('--restore needs the manifest.json path (or its folder) that --move printed.')
    } else if (arg === '--delete') {
      options.errors.push('There is no --delete any more: --move moves the files to quarantine/ so that --restore can put them back.')
    } else options.errors.push(`Unknown option: ${printable(arg)}`)
  }
  return options
}

// ------------------------------------------------------------------- run
// The whole program; everything outside it is passed in, so it can run
// against a mocked API. Returns the exit code.
export async function run({
  argv = [], env = {}, fetchImpl = globalThis.fetch, prompts = { hidden: promptHidden, visible: prompt }, out = console,
  homeDir = os.homedir(), now = () => new Date(), concurrency = 4, moveMaxBytes = MOVE_MAX_BYTES, largeFileBytes = LARGE_FILE_BYTES,
} = {}) {
  let token = ''
  const redact = (text) => (token ? String(text).split(token).join('[token]') : String(text))
  const log = (line = '') => out.log(redact(line))
  const fail = (line) => { out.error(redact(`FAILED: ${line}`)); return 1 }
  const options = parseArgs(argv)
  if (options.help) { log(HELP); return 0 }
  if (options.errors.length) {
    for (const error of options.errors) out.error(error)
    out.error('Run with --help to see how to use it.')
    return 1
  }
  let manifest = null
  let manifestPath = ''
  if (options.mode === 'restore') {
    manifestPath = path.resolve(options.restorePath)
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isDirectory()) manifestPath = path.join(manifestPath, 'manifest.json')
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch (error) { return fail(`could not read ${manifestPath}: ${error.message}`) }
    const problems = validateManifest(manifest)
    if (problems.length) return fail(`${manifestPath} cannot be used: ${problems.join('; ')}.`)
  }
  let accountId = env.CLOUDFLARE_ACCOUNT_ID
  let databaseId = env.BUSINESS_OS_D1_DATABASE_ID
  if (!accountId || !databaseId) {
    const fromToml = (() => { try { return readWranglerIds() } catch { return {} } })()
    accountId = accountId || fromToml.accountId
    databaseId = databaseId || fromToml.databaseId
  }
  if (!accountId || !databaseId) return fail('could not read the account id / database id from cloudflare/wrangler.toml. Run this from the business-os-v1 folder.')
  token = String(env.CLOUDFLARE_API_TOKEN || await prompts.hidden('Cloudflare API token: ') || '').trim()
  if (!token) return fail('no token given.')
  const context = {
    cf: makeClient({ token, accountId, databaseId, fetchImpl }), log, fail, prompts, homeDir, now, token,
    concurrency: Math.max(1, Math.floor(concurrency) || 1), moveMaxBytes, largeFileBytes,
  }
  try {
    if (options.mode === 'restore') return await restoreRun({ ...context, manifest, manifestPath })
    return await purgeRun({ ...context, move: options.mode === 'move' })
  } catch (error) {
    return fail(String(error?.message || error))
  }
}

async function purgeRun({ cf, log, prompts, homeDir, now, token, concurrency, moveMaxBytes, largeFileBytes, move }) {
  log(move ? 'Mode: MOVE to quarantine (asks before changing anything)' : 'Mode: DRY RUN (changes nothing)')
  log('Reading the database (read-only)...')
  const activeJobIds = await readActiveJobIds(cf)
  const { assetRows, jobFileRows } = await readRowIndex(cf)
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

  log('Listing and checking stored files...')
  const objects = []
  for (const prefix of PREFIXES) objects.push(...await cf.listObjects(prefix))
  const entries = new Array(objects.length)
  let checked = 0
  await mapLimit(objects, concurrency * 2, async (object, index) => {
    let read = object.size > 0 ? await cf.readHead(object.key, Math.min(object.size, HEAD_BYTES)) : { bytes: new Uint8Array(0), contentEncoding: '' }
    // An image the app accepts is read whole, so hidden markup anywhere
    // in it is found.
    if (!read.contentEncoding && read.bytes.length < object.size && object.size <= FULL_SCAN_MAX_BYTES && detectUploadFormat(read.bytes)?.kind === 'image') {
      read = await cf.readHead(object.key, object.size)
    }
    const verdict = classifyObject({
      key: object.key, size: object.size, bytes: read.bytes, complete: read.bytes.length >= object.size, activeJobIds, contentEncoding: read.contentEncoding,
    })
    entries[index] = {
      key: object.key, size: object.size, uploaded: object.uploaded, etag: object.etag, httpMetadata: object.httpMetadata, ...verdict,
      file_asset_ids: assetsByKey.get(object.key) || [],
      import_job_file_ids: jobFilesByKey.get(object.key) || [],
    }
    checked += 1
    if (checked % 200 === 0) log(`  ...${checked} checked`)
  })

  const stamp = stampOf(now())
  const outDir = path.join(homeDir, 'business-os-purge', stamp)
  fs.mkdirSync(outDir, { recursive: true })
  const listPath = path.join(outDir, 'listing.json')
  await writeJsonAtomic(listPath, { tool: MANIFEST_TOOL, bucket: BUCKET, prefixes: PREFIXES, mode: move ? 'move' : 'dry-run', stamp, createdAt: now().toISOString(), entries }, token)
  const rowPlan = planRowChanges(entries, assetRows, jobFileRows)
  for (const line of formatReport(entries, { purgeTitle: 'PURGE -- moved to quarantine/ with --move (can be put back with --restore)', rowPlan, manifestPath: listPath })) log(line)

  if (!move) {
    log('\nDry run finished. Nothing was changed. To move the PURGE files to quarantine/, run again with --move.')
    return 0
  }
  const candidates = entries.filter((entry) => entry.action === 'purge')
  if (!candidates.length) { log('\nNothing to move. Done.'); return 0 }
  const totalBytes = candidates.reduce((sum, entry) => sum + entry.size, 0)
  const answer = String(await prompts.visible(`\nType MOVE to move ${candidates.length} files (${megabytes(totalBytes)} MB) to ${quarantineKeyFor(stamp, '')} -- --restore can put them back: `) || '').trim()
  if (answer !== 'MOVE') { log('Not confirmed. Nothing was changed.'); return 0 }
  return moveToQuarantine({ cf, log, now, token, concurrency, moveMaxBytes, largeFileBytes, entries, candidates, stamp, outDir })
}

// Copies one file to quarantine and checks the copy. The original is not
// touched here. Returns { move } when a copy was attempted, else { skip }.
async function copyToQuarantine(cf, entry, stamp, moveMaxBytes) {
  const quarantineKey = quarantineKeyFor(stamp, entry.key)
  const skip = (reason) => ({ skip: { key: entry.key, reason } })
  if (Buffer.byteLength(quarantineKey, 'utf8') > R2_KEY_MAX_BYTES) return skip('its name is too long to put under quarantine/')
  if (entry.size > moveMaxBytes) return skip(`larger than ${Math.round(moveMaxBytes / 1048576)} MB; move it by hand if it must go`)
  const original = await cf.getObject(entry.key)
  if (!original) return skip('it is no longer there')
  if (original.contentEncoding && original.contentEncoding.trim().toLowerCase() !== 'identity') return skip(`it is stored compressed (${printable(original.contentEncoding)})`)
  if (original.bytes.length !== entry.size) return skip('its size changed since the listing')
  // The whole file must still be a purge candidate, not just its start.
  const recheck = classifyObject({ key: entry.key, size: original.bytes.length, bytes: original.bytes, complete: true })
  if (recheck.action !== 'purge') return skip(`the whole file checks as ${recheck.group}`)
  const httpMetadata = { ...(entry.httpMetadata || {}) }
  if (!httpMetadata.contentType && original.contentType) httpMetadata.contentType = original.contentType
  const move = {
    key: entry.key, quarantineKey, size: original.bytes.length, sha256: sha256Hex(original.bytes),
    contentType: httpMetadata.contentType || '', httpMetadata, etag: original.etag || entry.etag || '',
    group: entry.group, format: entry.format, state: 'copying',
  }
  try {
    await cf.putObject(quarantineKey, original.bytes, httpMetadata)
    const copy = await cf.getObject(quarantineKey)
    if (!copy) throw new Error('the copy is not there after writing it')
    if (copy.bytes.length !== move.size || sha256Hex(copy.bytes) !== move.sha256) throw new Error('the copy is not identical to the original')
    move.state = 'copied'
  } catch (error) {
    move.state = 'copy-failed'
    move.error = String(error?.message || error)
    move.copyRemoved = await cf.deleteObject(quarantineKey).then(() => true, () => false)
  }
  return { move }
}

async function moveToQuarantine({ cf, log, now, token, concurrency, moveMaxBytes, largeFileBytes, entries, candidates, stamp, outDir }) {
  const manifestPath = path.join(outDir, 'manifest.json')
  const manifest = {
    tool: MANIFEST_TOOL, format: MANIFEST_FORMAT, bucket: BUCKET, mode: 'move', stamp,
    quarantinePrefix: quarantineKeyFor(stamp, ''), createdAt: now().toISOString(), updatedAt: '', phase: 'copying',
    restoreWith: `node ops/scripts/purge-non-media-uploads.mjs --restore "${manifestPath}"`,
    moves: [], skipped: [], rows: { file_assets: [], import_job_files: [] },
    database: { state: 'not started', batches: [] },
  }
  const writeManifest = makeSaver(manifestPath, () => ({ ...manifest, updatedAt: now().toISOString() }), token)
  const save = async (phase) => { if (phase) manifest.phase = phase; await writeManifest() }
  // The recovery record exists before the first copy.
  await save()
  const stop = async (message) => {
    await save('stopped')
    log(`FAILED: ${message}`)
    log('Every file not yet removed is still where it was. To undo what was done:')
    log(`  node ops/scripts/purge-non-media-uploads.mjs --restore "${manifestPath}"`)
    return 1
  }

  // 1. Copy and check. No original is touched in this step.
  const activeAtStart = await readActiveJobIds(cf)
  const work = []
  for (const entry of candidates) {
    const jobId = jobIdOfImportKey(entry.key)
    if (jobId && activeAtStart.has(jobId)) manifest.skipped.push({ key: entry.key, reason: 'its import is running again' })
    else work.push(entry)
  }
  log(`Copying ${work.length} files to ${manifest.quarantinePrefix} and checking each copy...`)
  let copiedCount = 0
  await mapBySize(work, (entry) => entry.size, concurrency, largeFileBytes, async (entry) => {
    const result = await copyToQuarantine(cf, entry, stamp, moveMaxBytes)
    if (result.skip) manifest.skipped.push(result.skip)
    if (result.move) manifest.moves.push(result.move)
    copiedCount += 1
    if (copiedCount % 50 === 0) {
      log(`  ...${copiedCount} of ${work.length}`)
      await save()
    }
  })
  manifest.moves.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  await save('copied')
  const copied = manifest.moves.filter((move) => move.state === 'copied')
  const copyFailures = manifest.moves.filter((move) => move.state === 'copy-failed')
  if (copyFailures.length) log(`  ${copyFailures.length} files could not be copied exactly; they stay where they are (listed in manifest.json).`)
  if (!copied.length) {
    await save('done')
    log('No file was copied, so nothing else was changed.')
    return copyFailures.length ? 1 : 0
  }

  // 2. The database rows: recorded in full, then changed in guarded batches.
  log('Recording the database rows of these files...')
  const copiedKeys = new Set(copied.map((move) => move.key))
  const outcome = entries.map((entry) => ({ key: entry.key, action: entry.action === 'purge' && !copiedKeys.has(entry.key) ? 'keep' : entry.action }))
  const fresh = await readRowIndex(cf)
  const plan = planRowChanges(outcome, fresh.assetRows, fresh.jobFileRows)
  manifest.rows = await snapshotRows(cf, plan)
  manifest.database = { state: 'applying', batches: planD1Batches(manifest.rows, plan.importFileIds).map((batch) => ({ ...batch, state: 'pending' })) }
  // The old values are on disk before any row changes.
  await save('database')
  for (const batch of manifest.database.batches) {
    try {
      await cf.d1(buildD1Sql(batch))
      batch.state = 'applied'
    } catch (error) {
      batch.state = 'failed'
      batch.error = String(error?.message || error)
      manifest.database.state = 'failed'
      return stop(`the database refused a change (${batch.error}). No original file was removed.`)
    }
    await save()
  }
  // Read back, independently of the guards inside each batch.
  const removedIds = manifest.database.batches.flatMap((batch) => batch.fileAssetIds)
  const purgedIds = manifest.database.batches.flatMap((batch) => [...batch.importFileIds, ...(batch.linkedImportFileIds || [])])
  let leftAssets = 0
  for (const ids of chunk(removedIds, 100)) leftAssets += Number(rowsOf(await cf.d1(`SELECT COUNT(*) AS n FROM file_assets WHERE id IN (${ids.join(', ')})`))[0]?.n || 0)
  let purgedRows = 0
  for (const ids of chunk(purgedIds, 100)) purgedRows += Number(rowsOf(await cf.d1(`SELECT COUNT(*) AS n FROM import_job_files WHERE id IN (${ids.join(', ')}) AND status = 'purged'`))[0]?.n || 0)
  if (leftAssets !== 0 || purgedRows !== purgedIds.length) {
    manifest.database.state = 'failed'
    return stop(`the database does not show the expected changes (${leftAssets} Library rows still there, ${purgedRows} of ${purgedIds.length} import rows purged). No original file was removed.`)
  }
  manifest.database.state = 'applied'
  await save('deleting')

  // 3. Remove each original, only if it is still exactly the copied file.
  log(`Removing the ${copied.length} originals...`)
  const activeNow = await readActiveJobIds(cf)
  let removedCount = 0
  await mapBySize(copied, (move) => move.size, concurrency, largeFileBytes, async (move) => {
    const jobId = jobIdOfImportKey(move.key)
    try {
      if (jobId && activeNow.has(jobId)) {
        move.state = 'original-kept'
        move.note = 'its import is running again'
      } else {
        const current = await cf.getObject(move.key)
        if (!current) {
          move.state = 'moved'
          move.note = 'the original was already gone'
        } else if (sha256Hex(current.bytes) !== move.sha256) {
          move.state = 'original-kept'
          move.note = 'the original changed after it was copied'
        } else {
          await cf.deleteObject(move.key)
          move.state = 'moved'
        }
      }
    } catch (error) {
      move.state = 'delete-failed'
      move.error = String(error?.message || error)
    }
    removedCount += 1
    if (removedCount % 50 === 0) {
      log(`  ...${removedCount} of ${copied.length}`)
      await save()
    }
  })
  await save('done')

  const moved = manifest.moves.filter((move) => move.state === 'moved')
  const notMoved = manifest.moves.length - moved.length + manifest.skipped.length
  log('')
  log(`Moved ${moved.length} files (${megabytes(moved.reduce((sum, move) => sum + move.size, 0))} MB) to ${manifest.quarantinePrefix}`)
  if (notMoved) log(`Not moved, still in place: ${notMoved} (see "skipped" and each "state" in manifest.json)`)
  log(`Library rows removed: ${removedIds.length}. Import rows marked purged: ${purgedIds.length}.`)
  log(`Recovery record: ${manifestPath}`)
  log('To put everything back:')
  log(`  node ops/scripts/purge-non-media-uploads.mjs --restore "${manifestPath}"`)
  log('Done.')
  return manifest.moves.some((move) => move.state === 'delete-failed' || move.state === 'copy-failed') ? 1 : 0
}

// ---------------------------------------------------------------- restore
async function restoreObject(cf, move) {
  const result = { key: move.key, quarantineKey: move.quarantineKey }
  const current = await cf.getObject(move.key)
  if (current) {
    // The original is there (never removed, or already restored). A copy
    // that failed its check is never trusted over it.
    if (sha256Hex(current.bytes) === move.sha256 || move.state === 'copy-failed') {
      const removed = await cf.deleteObject(move.quarantineKey)
      return { ...result, outcome: 'in place', quarantineCopyRemoved: removed }
    }
    return { ...result, outcome: 'conflict', note: 'a different file is stored under this name now; the quarantine copy was left' }
  }
  const copy = await cf.getObject(move.quarantineKey)
  if (!copy) return { ...result, outcome: 'missing', note: 'neither the file nor its quarantine copy exists' }
  if (copy.bytes.length !== move.size || sha256Hex(copy.bytes) !== move.sha256) {
    return { ...result, outcome: 'failed', note: 'the quarantine copy does not match manifest.json; it was left' }
  }
  const httpMetadata = { ...normalizeHttpMetadata(move.httpMetadata) }
  if (!httpMetadata.contentType && move.contentType) httpMetadata.contentType = move.contentType
  await cf.putObject(move.key, copy.bytes, httpMetadata)
  const back = await cf.getObject(move.key)
  if (!back || back.bytes.length !== move.size || sha256Hex(back.bytes) !== move.sha256) {
    // What was just written is removed again, so the next --restore starts
    // from the quarantine copy instead of meeting a "different file".
    const removed = await cf.deleteObject(move.key).then(() => true, () => false)
    return {
      ...result, outcome: 'failed',
      note: `the restored file did not read back identical${removed ? ', so it was removed again' : ' and could not be removed'}; the quarantine copy was left`,
    }
  }
  await cf.deleteObject(move.quarantineKey)
  return { ...result, outcome: 'restored' }
}

// Library rows go back with every recorded column (a row that is already
// there is left alone); import rows get back the three columns --move
// changed, only while they still say 'purged'. Only the rows
// restorableRows accepts are written (validateManifest already refused a
// manifest with any other; this holds even if it is called some other way),
// and an import row's file_asset_id is only set back to a Library row this
// restore puts back -- --move never changed any other link.
async function restoreRows(cf, manifest) {
  const result = { fileAssets: { recorded: 0, present: 0, failed: [] }, importFiles: { recorded: 0, restored: 0, failed: [] }, refused: [] }
  const accepted = restorableRows(manifest)
  result.refused = accepted.refused
  const fileAssets = accepted.file_assets
  const importFiles = accepted.import_job_files
  const assetIds = new Set(fileAssets.map((row) => Number(row.id)))
  const relinks = (row) => row.file_asset_id != null && assetIds.has(Number(row.file_asset_id))
  result.fileAssets.recorded = fileAssets.length
  result.importFiles.recorded = importFiles.length
  for (const row of fileAssets) {
    const columns = Object.keys(row)
    const sql = `INSERT INTO file_assets (${columns.join(', ')}) SELECT ${columns.map(() => '?').join(', ')} WHERE NOT EXISTS (SELECT 1 FROM file_assets WHERE id = ?)`
    try { await cf.d1(sql, [...columns.map((column) => row[column]), row.id]) } catch (error) { result.fileAssets.failed.push({ id: row.id, error: String(error?.message || error) }) }
  }
  for (const row of importFiles) {
    const [sql, params] = relinks(row)
      ? ["UPDATE import_job_files SET status = ?, file_asset_id = ?, updated_at = ? WHERE id = ? AND status = 'purged'", [row.status ?? null, row.file_asset_id, row.updated_at ?? null, row.id]]
      : ["UPDATE import_job_files SET status = ?, updated_at = ? WHERE id = ? AND status = 'purged'", [row.status ?? null, row.updated_at ?? null, row.id]]
    try { await cf.d1(sql, params) } catch (error) { result.importFiles.failed.push({ id: row.id, error: String(error?.message || error) }) }
  }
  // Read back what is there now.
  for (const ids of chunk(safeIds(fileAssets.map((row) => row.id)), 100)) {
    result.fileAssets.present += Number(rowsOf(await cf.d1(`SELECT COUNT(*) AS n FROM file_assets WHERE id IN (${ids.join(', ')})`))[0]?.n || 0)
  }
  const wanted = new Map(importFiles.map((row) => [Number(row.id), row]))
  for (const ids of chunk([...wanted.keys()], 100)) {
    for (const row of rowsOf(await cf.d1(`SELECT id, status, file_asset_id, updated_at FROM import_job_files WHERE id IN (${ids.join(', ')})`))) {
      const recorded = wanted.get(Number(row.id))
      if ((row.status ?? null) === (recorded.status ?? null) && (row.file_asset_id ?? null) === (recorded.file_asset_id ?? null)) result.importFiles.restored += 1
    }
  }
  return result
}

async function restoreRun({ cf, log, prompts, now, token, concurrency, largeFileBytes, manifest, manifestPath }) {
  const moves = manifest.moves
  const rows = manifest.rows || {}
  log(`Restore from ${manifestPath}`)
  log(`  files recorded: ${moves.length}; Library rows: ${(rows.file_assets || []).length}; import rows: ${(rows.import_job_files || []).length}`)
  const answer = String(await prompts.visible('Type RESTORE to put them back: ') || '').trim()
  if (answer !== 'RESTORE') { log('Not confirmed. Nothing was changed.'); return 0 }

  // Files first, so a restored row never points at a missing file.
  const objects = new Array(moves.length)
  await mapBySize(moves, (move) => move.size, concurrency, largeFileBytes, async (move, index) => {
    try { objects[index] = await restoreObject(cf, move) } catch (error) {
      objects[index] = { key: move.key, quarantineKey: move.quarantineKey, outcome: 'failed', note: String(error?.message || error) }
    }
  })
  // Copies a run made but never recorded (it stopped before saving): each
  // one is removed when its original is there and identical, else left.
  const recorded = new Set(moves.map((move) => move.quarantineKey))
  const strays = []
  for (const object of await cf.listObjects(manifest.quarantinePrefix)) {
    if (recorded.has(object.key)) continue
    const key = object.key.slice(manifest.quarantinePrefix.length)
    const stray = { quarantineKey: object.key, key }
    try {
      const [original, copy] = [await cf.getObject(key), await cf.getObject(object.key)]
      if (PREFIXES.some((prefix) => key.startsWith(prefix)) && original && copy && sha256Hex(original.bytes) === sha256Hex(copy.bytes)) {
        await cf.deleteObject(object.key)
        stray.outcome = 'removed (the original is in place)'
      } else stray.outcome = 'left (no identical original)'
    } catch (error) { stray.outcome = `left (${String(error?.message || error)})` }
    strays.push(stray)
  }
  const rowResult = await restoreRows(cf, manifest)

  const count = (outcome) => objects.filter((object) => object.outcome === outcome).length
  const reportPath = path.join(path.dirname(manifestPath), `restore-${stampOf(now())}.json`)
  await writeJsonAtomic(reportPath, { tool: MANIFEST_TOOL, manifest: manifestPath, restoredAt: now().toISOString(), objects, strays, rows: rowResult }, token)
  log('')
  log(`Files put back: ${count('restored')}; already in place: ${count('in place')}; conflicts: ${count('conflict')}; missing: ${count('missing')}; failed: ${count('failed')}.`)
  const leftStrays = strays.filter((stray) => stray.outcome.startsWith('left'))
  if (strays.length) log(`Unrecorded quarantine copies: ${strays.length} (${leftStrays.length} left).`)
  log(`Library rows present: ${rowResult.fileAssets.present} of ${rowResult.fileAssets.recorded}. Import rows back as they were: ${rowResult.importFiles.restored} of ${rowResult.importFiles.recorded}.`)
  for (const object of objects.filter((item) => item.outcome !== 'restored' && item.outcome !== 'in place').slice(0, 20)) log(`  ${object.outcome}: ${printable(object.key)} -- ${object.note}`)
  for (const refused of rowResult.refused.slice(0, 20)) log(`  refused: a recorded ${refused.table} row (id ${printable(String(refused.id))}) ${refused.reason}; it was not written`)
  log(`Report saved: ${reportPath}`)
  const clean = count('conflict') + count('missing') + count('failed') + leftStrays.length + rowResult.refused.length === 0
    && rowResult.fileAssets.failed.length === 0 && rowResult.importFiles.failed.length === 0
    && rowResult.fileAssets.present === rowResult.fileAssets.recorded && rowResult.importFiles.restored === rowResult.importFiles.recorded
  log(clean ? 'Done.' : 'FAILED: not everything could be put back; see above and the report. Running --restore again retries it and never overwrites a different file.')
  return clean ? 0 : 1
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  run({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => { process.exitCode = code },
    (error) => {
      // Never echo the token: error messages here come from the API or fs.
      console.error(`FAILED: ${String(error?.message || error)}`)
      process.exitCode = 1
    },
  )
}
