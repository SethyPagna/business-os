// Pure-JS ZIP reader for the Workers V8 isolate -- no `unzipper`/Node zip
// package (native/stream-based, doesn't run here), no Container. Reads the
// central directory (authoritative entry list + sizes) rather than
// streaming local headers sequentially, then extracts on demand via the
// Web-standard `DecompressionStream('deflate-raw')`, which workerd has
// supported for a long time and this project's `compatibility_date`
// comfortably clears. Method 0 (stored/uncompressed) and method 8
// (deflate) cover effectively every ZIP a phone/desktop image-export tool
// produces; anything else is reported per-entry rather than failing the
// whole archive, so one odd entry doesn't sink the rest of the import.
//
// This intentionally mirrors the import signature the previous, unfinished
// pass already wired into `routes/importJobs.ts`
// (`readCentralDirectory`/`extractZipEntry`/`isRealFileEntry`/
// `ZipFormatError`) -- that import was removed as dead code in an earlier
// session because this file didn't exist yet; this implements it for real
// against that same contract instead of changing the call site.

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipFormatError'
  }
}

export interface ZipEntry {
  fileName: string
  isDirectory: boolean
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  crc32: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const EOCD_MIN_SIZE = 22
// ZIP comment field can be up to 65535 bytes, so the EOCD record can sit
// that far before the end of the file -- search the whole possible window.
const EOCD_SEARCH_WINDOW = 65535 + EOCD_MIN_SIZE

// Per-entry decompressed-size cap. Central-directory sizes are attacker-
// controlled (a crafted ZIP can claim a huge uncompressed size for a tiny
// compressed payload -- a decompression bomb), so this is checked BEFORE
// decompressing, not after. 100MB comfortably covers any real product
// photo; there's no legitimate reason for a single image inside one of
// these archives to exceed it.
const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

// Finds the End Of Central Directory record by scanning backward for its
// signature -- the only reliable anchor, since everything else in a ZIP is
// located relative to offsets recorded inside the EOCD itself.
function findEocd(view: DataView, bytes: Uint8Array): number {
  const start = Math.max(0, bytes.byteLength - EOCD_SEARCH_WINDOW)
  for (let offset = bytes.byteLength - EOCD_MIN_SIZE; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset
  }
  throw new ZipFormatError('Not a valid ZIP file (no end-of-central-directory record found)')
}

// Reads the central directory -- the authoritative list of every entry in
// the archive, including sizes and where each entry's local header lives.
// Deliberately does NOT stream local headers sequentially: a truncated or
// slightly malformed local header on one entry would otherwise throw off
// every entry after it. The central directory is self-contained.
export function readCentralDirectory(buffer: ArrayBuffer | Uint8Array): ZipEntry[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.byteLength < EOCD_MIN_SIZE) throw new ZipFormatError('File is too small to be a ZIP archive')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const eocdOffset = findEocd(view, bytes)
  const diskEntryCount = view.getUint16(eocdOffset + 8, true)
  const totalEntryCount = view.getUint16(eocdOffset + 10, true)
  const centralDirSize = view.getUint32(eocdOffset + 12, true)
  const centralDirOffset = view.getUint32(eocdOffset + 16, true)

  if (diskEntryCount !== totalEntryCount) {
    // Multi-disk/split archives aren't something a browser image-export
    // flow produces; rather than mis-parse one, fail clearly.
    throw new ZipFormatError('Multi-part ZIP archives are not supported')
  }
  if (centralDirOffset + centralDirSize > bytes.byteLength) {
    throw new ZipFormatError('ZIP central directory is truncated or corrupt')
  }

  const entries: ZipEntry[] = []
  let offset = centralDirOffset
  const end = centralDirOffset + centralDirSize

  for (let i = 0; i < totalEntryCount; i += 1) {
    if (offset + 46 > end) throw new ZipFormatError('ZIP central directory is truncated or corrupt')
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new ZipFormatError('ZIP central directory entry has an invalid signature')
    }
    const compressionMethod = view.getUint16(offset + 10, true)
    const crc32 = view.getUint32(offset + 16, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const fileNameLength = view.getUint16(offset + 28, true)
    const extraFieldLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const externalAttrs = view.getUint32(offset + 38, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)

    const nameStart = offset + 46
    const nameEnd = nameStart + fileNameLength
    if (nameEnd > end) throw new ZipFormatError('ZIP central directory entry has a truncated file name')
    const fileName = utf8Decode(bytes.subarray(nameStart, nameEnd))

    // A directory entry is marked either by a trailing slash in the name
    // (universal convention) or the MS-DOS directory attribute bit in the
    // upper 16 bits of externalAttrs (some zippers omit the trailing slash).
    const isDirectory = fileName.endsWith('/') || (externalAttrs & 0x10) !== 0

    entries.push({
      fileName,
      isDirectory,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      crc32,
    })

    offset = nameEnd + extraFieldLength + commentLength
  }

  return entries
}

// True for entries worth importing as real files: not a directory marker,
// not zero-byte, and not one of the noise entries macOS/Windows zippers
// routinely add (resource-fork shadow files, folder metadata) that would
// otherwise show up as bogus "products" during filename matching.
export function isRealFileEntry(entry: ZipEntry): boolean {
  if (entry.isDirectory) return false
  if (entry.uncompressedSize === 0) return false
  const base = entry.fileName.split('/').pop() || entry.fileName
  if (base.startsWith('.')) return false // .DS_Store, ._AppleDouble shadow files, etc.
  if (entry.fileName.startsWith('__MACOSX/')) return false
  return true
}

// Extracts and decompresses a single entry's bytes. Reads that entry's own
// local header first (its filename/extra-field lengths can legitimately
// differ in length from the central directory's copy, even though the
// content is the same) purely to find where the compressed data actually
// starts, then decompresses per compressionMethod.
export async function extractZipEntry(buffer: ArrayBuffer | Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    throw new ZipFormatError(`"${entry.fileName}" is too large to extract (${Math.floor(entry.uncompressedSize / (1024 * 1024))}MB, max ${MAX_ENTRY_UNCOMPRESSED_BYTES / (1024 * 1024)}MB)`)
  }

  const lho = entry.localHeaderOffset
  if (lho + 30 > bytes.byteLength || view.getUint32(lho, true) !== LOCAL_FILE_SIGNATURE) {
    throw new ZipFormatError(`"${entry.fileName}" has an invalid local file header`)
  }
  const localNameLength = view.getUint16(lho + 26, true)
  const localExtraLength = view.getUint16(lho + 28, true)
  const dataStart = lho + 30 + localNameLength + localExtraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > bytes.byteLength) throw new ZipFormatError(`"${entry.fileName}" data is truncated`)

  const compressed = bytes.subarray(dataStart, dataEnd)

  if (entry.compressionMethod === 0) {
    // Stored (no compression) -- copy out of the shared backing buffer so
    // the caller gets an independent, exact-length Uint8Array.
    return compressed.slice()
  }
  if (entry.compressionMethod === 8) {
    // Raw DEFLATE (no zlib/gzip header or trailer), same as ZIP always
    // uses for method 8 -- 'deflate-raw' is the matching Web Streams codec.
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const decompressed = new Uint8Array(await new Response(stream).arrayBuffer())
    if (decompressed.byteLength !== entry.uncompressedSize) {
      throw new ZipFormatError(`"${entry.fileName}" decompressed to an unexpected size (possibly corrupt)`)
    }
    return decompressed
  }
  throw new ZipFormatError(`"${entry.fileName}" uses unsupported ZIP compression method ${entry.compressionMethod} (only stored/deflate are supported)`)
}
