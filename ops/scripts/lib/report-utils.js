'use strict'

const { createHash } = require('crypto')

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function stableDigest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

function summarizeReportValue(value) {
  const text = String(value)
  if (text.length <= 120) return text
  let sizeLabel = `chars:${text.length}`
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) sizeLabel = `items:${parsed.length}`
    else if (parsed && typeof parsed === 'object') sizeLabel = `keys:${Object.keys(parsed).length}`
  } catch (_) {
    // Non-JSON strings still get a digest and preview.
  }
  return `${sizeLabel}; sha256:${stableDigest(text)}; preview:${text.slice(0, 96)}...`
}

function outputTail(value, limit = 4000) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length <= limit) return text
  return `...${text.slice(text.length - limit)}`
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

module.exports = {
  markdownTable,
  stableDigest,
  summarizeReportValue,
  outputTail,
  formatBytes,
}
