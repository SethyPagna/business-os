export const UTF8_BOM = '\uFEFF'

const ZIP_EXPORT_WORKER_TIMEOUT_MS = 30000

type ZipFileInput = {
  name?: unknown
  filename?: unknown
  content?: unknown
  rows?: unknown[]
}

type NormalizedZipFile = {
  name: string
  content: string
}

export function escapeCsvValue(value: unknown): string {
  if (value == null) return ''
  let text = String(value)
  if (/^[=+\-@]/.test(text) || /^[\t\r]/.test(text)) {
    text = `'${text}`
  }
  return text.includes(',') || text.includes('"') || text.includes('\n')
    ? `"${text.replace(/"/g, '""')}"`
    : text
}

export function buildCSV(rows: unknown[] = []): string {
  if (!Array.isArray(rows) || !rows.length) return ''
  const headers = Object.keys((rows[0] || {}) as object)
  return [
    headers.join(','),
    ...rows.map((row) => {
      const values = row && typeof row === 'object' ? row as Record<string, unknown> : {}
      return headers.map((header) => escapeCsvValue(values[header])).join(',')
    }),
  ].join('\n')
}

export function downloadBlob(filename: string, blob: Blob): void {
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}

export function downloadCSV(filename: string, rows: unknown[]): void {
  const csv = buildCSV(rows)
  if (!csv) return
  downloadBlob(filename, new Blob([UTF8_BOM, csv], { type: 'text/csv;charset=utf-8' }))
}

function normalizeZipFile(file: ZipFileInput | null | undefined): NormalizedZipFile | null {
  if (!file) return null
  const name = String(file.name || file.filename || '').trim()
  if (!name) return null
  let content = file.content
  if ((content === undefined || content === null) && Array.isArray(file.rows)) {
    content = buildCSV(file.rows)
  }
  if (content === undefined || content === null) return null
  return { name, content: String(content) }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1)
    }
    table[index] = crc >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xFFFF, true)
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

function toBlobPart(bytes: Uint8Array): BlobPart {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function encodeZipTimestamp(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const seconds = Math.floor(date.getSeconds() / 2)
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  }
}

// ZIP compression method codes. STORE (0) writes bytes as-is; DEFLATE (8) is
// the one non-stored method cloudflare/src/lib/zipReader.ts already knows how
// to decompress (it uses the same `DecompressionStream('deflate-raw')` this
// module's `deflateRaw` mirrors), so a report package built here would still
// open correctly if it ever needed to round-trip through that reader.
const ZIP_METHOD_STORE = 0
const ZIP_METHOD_DEFLATE = 8

function supportsDeflate(): boolean {
  return typeof CompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function'
}

// Deflates one entry's bytes via the browser/runtime's built-in
// CompressionStream -- no bundled zip library needed, same "use what the
// platform already gives us" approach as zipReader.ts's DecompressionStream
// use on the read side. Returns null (never throws) when unsupported or on
// any encoding failure, so callers always have a safe STORE fallback -- the
// same never-block-on-a-compression-failure contract as
// imageCompression.ts/videoCompression.ts.
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!supportsDeflate()) return null
  try {
    const stream = new Blob([toBlobPart(bytes)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    const buffer = await new Response(stream).arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

type ZipEntry = {
  name: string
  storedBytes: Uint8Array
  uncompressedSize: number
  method: number
  checksum: number
}

// Compresses every entry (CSV/HTML report text compresses very well, often
// 70-90% smaller) and picks STORE per-file instead when deflate doesn't
// actually help -- tiny files or already-dense content can grow slightly
// under deflate's per-block overhead, so this never ships something bigger
// than the uncompressed bytes, mirroring compressImageFile's "never ship
// bigger than what was already there" rule. Deflate is byte-exact and
// reversible, so a compressed entry decompresses to identical content --
// nothing here can silently corrupt or truncate a row.
async function buildZipEntries(files: ZipFileInput[]): Promise<{ entries: ZipEntry[]; encoder: TextEncoder }> {
  const encoder = new TextEncoder()
  const normalizedFiles = files
    .map(normalizeZipFile)
    .filter((file): file is NormalizedZipFile => Boolean(file))
    .map((file) => ({ name: file.name, bytes: encoder.encode(file.content) }))

  const entries = await Promise.all(normalizedFiles.map(async (file) => {
    const checksum = crc32(file.bytes)
    const deflated = file.bytes.length ? await deflateRaw(file.bytes) : null
    if (deflated && deflated.length < file.bytes.length) {
      return { name: file.name, storedBytes: deflated, uncompressedSize: file.bytes.length, method: ZIP_METHOD_DEFLATE, checksum }
    }
    return { name: file.name, storedBytes: file.bytes, uncompressedSize: file.bytes.length, method: ZIP_METHOD_STORE, checksum }
  }))

  return { entries, encoder }
}

export async function buildZip(files: ZipFileInput[] = []): Promise<Blob | null> {
  const { entries, encoder } = await buildZipEntries(files)
  if (!entries.length) return null

  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  const { time, date } = encodeZipTimestamp(new Date())

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name)
    const compressedBytes = entry.storedBytes

    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    writeUint32(localView, 0, 0x04034b50)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0)
    writeUint16(localView, 8, entry.method)
    writeUint16(localView, 10, time)
    writeUint16(localView, 12, date)
    writeUint32(localView, 14, entry.checksum)
    writeUint32(localView, 18, compressedBytes.length)
    writeUint32(localView, 22, entry.uncompressedSize)
    writeUint16(localView, 26, nameBytes.length)
    writeUint16(localView, 28, 0)
    localHeader.set(nameBytes, 30)
    localParts.push(localHeader, compressedBytes)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    writeUint32(centralView, 0, 0x02014b50)
    writeUint16(centralView, 4, 20)
    writeUint16(centralView, 6, 20)
    writeUint16(centralView, 8, 0)
    writeUint16(centralView, 10, entry.method)
    writeUint16(centralView, 12, time)
    writeUint16(centralView, 14, date)
    writeUint32(centralView, 16, entry.checksum)
    writeUint32(centralView, 20, compressedBytes.length)
    writeUint32(centralView, 24, entry.uncompressedSize)
    writeUint16(centralView, 28, nameBytes.length)
    writeUint16(centralView, 30, 0)
    writeUint16(centralView, 32, 0)
    writeUint16(centralView, 34, 0)
    writeUint16(centralView, 36, 0)
    writeUint32(centralView, 38, 0)
    writeUint32(centralView, 42, offset)
    centralHeader.set(nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + compressedBytes.length
  })

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, entries.length)
  writeUint16(endView, 10, entries.length)
  writeUint32(endView, 12, centralSize)
  writeUint32(endView, 16, offset)
  writeUint16(endView, 20, 0)

  return new Blob([...localParts, ...centralParts, endRecord].map(toBlobPart), { type: 'application/zip' })
}

export function buildZipInWorker(files: ZipFileInput[] = [], options: { timeoutMs?: unknown } = {}): Promise<Blob | null> {
  const timeoutMs = Number(options.timeoutMs || ZIP_EXPORT_WORKER_TIMEOUT_MS)
  if (typeof Worker !== 'function') return buildZip(files)
  return new Promise((resolve) => {
    let worker: Worker | null = null
    let settled = false
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null
    const finish = (blob: Blob | null | Promise<Blob | null>): void => {
      if (settled) return
      settled = true
      if (timeout != null) globalThis.clearTimeout(timeout)
      worker?.terminate()
      Promise.resolve(blob).then((resolved) => resolve(resolved || buildZip(files))).catch(() => resolve(buildZip(files)))
    }
    timeout = globalThis.setTimeout(() => finish(buildZip(files)), timeoutMs)
    try {
      worker = new Worker(new URL('./csvExportWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event) => {
        const message = event?.data || {}
        finish(message.type === 'result' ? message.blob : null)
      }
      worker.onerror = () => finish(buildZip(files))
      worker.postMessage({ id: `${Date.now()}:${Math.random()}`, files })
    } catch (_) {
      finish(buildZip(files))
    }
  })
}

export async function downloadZipFiles(filename: string, files: ZipFileInput[] = []): Promise<void> {
  const blob = await buildZip(files)
  if (!blob) return
  downloadBlob(filename, blob)
}

export async function downloadZipFilesAsync(
  filename: string,
  files: ZipFileInput[] = [],
  options: { timeoutMs?: unknown } = {},
): Promise<void> {
  const blob = await buildZipInWorker(files, options)
  if (!blob) return
  downloadBlob(filename, blob)
}
