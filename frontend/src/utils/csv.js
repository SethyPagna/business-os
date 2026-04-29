// ── CSV Export Utility ─────────────────────────────────────────────────────────
// Shared CSV download helper used across Dashboard, Products, Contacts, and Utils.

function escapeCsvValue(value) {
  if (value == null) return ''
  let text = String(value)
  if (/^[=+\-@]/.test(text) || /^[\t\r]/.test(text)) {
    text = `'${text}`
  }
  return text.includes(',') || text.includes('"') || text.includes('\n')
    ? `"${text.replace(/"/g, '""')}"`
    : text
}

export function buildCSV(rows) {
  if (!Array.isArray(rows) || !rows.length) return ''
  const headers = Object.keys(rows[0])
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\n')
}

export function downloadBlob(filename, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * Trigger a browser CSV download from an array of row objects.
 * Column headers are derived from the keys of the first row.
 * @param {string} filename - Desired download filename (e.g. 'products-2024-01-01.csv')
 * @param {Object[]} rows   - Array of plain objects (all rows must share the same keys)
 */
export function downloadCSV(filename, rows) {
  const csv = buildCSV(rows)
  if (!csv) return
  downloadBlob(filename, new Blob([csv], { type: 'text/csv' }))
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

function crc32(bytes) {
  let crc = 0xFFFFFFFF
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value & 0xFFFF, true)
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true)
}

function encodeZipTimestamp(date = new Date()) {
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

export function buildZip(files = []) {
  const encoder = new TextEncoder()
  const normalizedFiles = files
    .filter((file) => file && file.name && file.content !== undefined && file.content !== null)
    .map((file) => ({
      name: String(file.name),
      bytes: encoder.encode(String(file.content)),
    }))
  if (!normalizedFiles.length) return null

  const localParts = []
  const centralParts = []
  let offset = 0
  const { time, date } = encodeZipTimestamp(new Date())

  normalizedFiles.forEach((file) => {
    const nameBytes = encoder.encode(file.name)
    const contentBytes = file.bytes
    const checksum = crc32(contentBytes)

    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)
    writeUint32(localView, 0, 0x04034b50)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0)
    writeUint16(localView, 8, 0)
    writeUint16(localView, 10, time)
    writeUint16(localView, 12, date)
    writeUint32(localView, 14, checksum)
    writeUint32(localView, 18, contentBytes.length)
    writeUint32(localView, 22, contentBytes.length)
    writeUint16(localView, 26, nameBytes.length)
    writeUint16(localView, 28, 0)
    localHeader.set(nameBytes, 30)
    localParts.push(localHeader, contentBytes)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    writeUint32(centralView, 0, 0x02014b50)
    writeUint16(centralView, 4, 20)
    writeUint16(centralView, 6, 20)
    writeUint16(centralView, 8, 0)
    writeUint16(centralView, 10, 0)
    writeUint16(centralView, 12, time)
    writeUint16(centralView, 14, date)
    writeUint32(centralView, 16, checksum)
    writeUint32(centralView, 20, contentBytes.length)
    writeUint32(centralView, 24, contentBytes.length)
    writeUint16(centralView, 28, nameBytes.length)
    writeUint16(centralView, 30, 0)
    writeUint16(centralView, 32, 0)
    writeUint16(centralView, 34, 0)
    writeUint16(centralView, 36, 0)
    writeUint32(centralView, 38, 0)
    writeUint32(centralView, 42, offset)
    centralHeader.set(nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + contentBytes.length
  })

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, normalizedFiles.length)
  writeUint16(endView, 10, normalizedFiles.length)
  writeUint32(endView, 12, centralSize)
  writeUint32(endView, 16, offset)
  writeUint16(endView, 20, 0)

  return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' })
}

export function downloadZipFiles(filename, files = []) {
  const blob = buildZip(files)
  if (!blob) return
  downloadBlob(filename, blob)
}
