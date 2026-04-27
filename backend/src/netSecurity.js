'use strict'

const net = require('net')

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google.internal.',
  '0',
])

const BLOCKED_SUFFIXES = [
  '.internal',
  '.internal.',
  '.local',
  '.localdomain',
  '.lan',
  '.home',
  '.corp',
]

const IMAGE_REF_RE = /\.(png|jpe?g|webp|gif|bmp)(\?.*)?$/i
const ALLOWED_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,/i

function trim(value) {
  return String(value || '').trim()
}

function normalizeHostname(hostname) {
  return trim(hostname).toLowerCase().replace(/\.+$/, '')
}

function isPrivateIpv4(hostname) {
  const parts = normalizeHostname(hostname).split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  if (parts[0] === 10) return true
  if (parts[0] === 127) return true
  if (parts[0] === 0) return true
  if (parts[0] === 169 && parts[1] === 254) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true
  return false
}

function isPrivateIpv6(hostname) {
  const value = normalizeHostname(hostname)
  return (
    value === '::1'
    || value === '::'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('fe80:')
  )
}

function isBlockedHostname(hostname) {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return true
  if (BLOCKED_HOSTS.has(normalized)) return true
  if (BLOCKED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return true
  const ipType = net.isIP(normalized)
  if (ipType === 4) return isPrivateIpv4(normalized)
  if (ipType === 6) return isPrivateIpv6(normalized)
  return false
}

function assertSafeOutboundUrl(rawUrl, options = {}) {
  const value = trim(rawUrl)
  if (!value) throw new Error('A valid URL is required')

  let parsed = null
  try {
    parsed = new URL(value)
  } catch (_) {
    throw new Error('A valid URL is required')
  }

  const allowedProtocols = Array.isArray(options.allowedProtocols) && options.allowedProtocols.length
    ? options.allowedProtocols
    : ['https:']

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`Only ${allowedProtocols.join(', ')} URLs are allowed`)
  }
  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials are not allowed in URLs')
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('Private, local, or internal network destinations are not allowed')
  }

  return parsed.toString()
}

function isSafeExternalImageReference(value) {
  const raw = trim(value)
  if (!raw) return false
  if (raw.startsWith('/uploads/')) return true
  if (ALLOWED_DATA_IMAGE_RE.test(raw)) return true
  try {
    const normalized = assertSafeOutboundUrl(raw)
    return IMAGE_REF_RE.test(normalized)
  } catch (_) {
    return false
  }
}

module.exports = {
  assertSafeOutboundUrl,
  isBlockedHostname,
  isSafeExternalImageReference,
}
