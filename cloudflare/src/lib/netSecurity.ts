// Ported from backend/src/netSecurity.ts. The legacy version's only Node
// dependency was `net.isIP()`, used purely as a literal-string IPv4/IPv6
// classifier (no DNS resolution happens anywhere in this file) -- so unlike
// the SSRF check dropped in portal.ts (checkpoint 10, which really did rely
// on DNS resolution), this one ports directly. `isIPv4Literal`/`isIPv6Literal`
// below reimplement just enough of `net.isIP()`'s literal-matching behavior
// for this module's needs.

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

function trim(value: unknown): string {
  return String(value || '').trim()
}

function normalizeHostname(hostname: unknown): string {
  return trim(hostname).toLowerCase().replace(/\.+$/, '')
}

function isIPv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}

function isIPv6Literal(hostname: string): boolean {
  // Loose literal check: hex groups and ':', at least one '::' or enough
  // groups -- sufficient here since we only branch on it, never parse further.
  return hostname.includes(':') && /^[0-9a-f:]+$/i.test(hostname)
}

function isPrivateIpv4(hostname: string): boolean {
  const parts: number[] = []
  for (const part of normalizeHostname(hostname).split('.')) {
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0 || value > 255) return false
    parts.push(value)
  }
  if (parts.length !== 4) return false
  if (parts[0] === 10) return true
  if (parts[0] === 127) return true
  if (parts[0] === 0) return true
  if (parts[0] === 169 && parts[1] === 254) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true
  return false
}

function isPrivateIpv6(hostname: string): boolean {
  const value = normalizeHostname(hostname)
  return (
    value === '::1'
    || value === '::'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('fe80:')
  )
}

export function isBlockedHostname(hostname: unknown): boolean {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return true
  if (BLOCKED_HOSTS.has(normalized)) return true
  for (const suffix of BLOCKED_SUFFIXES) {
    if (normalized.endsWith(suffix)) return true
  }
  if (isIPv4Literal(normalized)) return isPrivateIpv4(normalized)
  if (isIPv6Literal(normalized)) return isPrivateIpv6(normalized)
  return false
}

export function assertSafeOutboundUrl(rawUrl: unknown, options: { allowedProtocols?: string[] } = {}): string {
  const value = trim(rawUrl)
  if (!value) throw new Error('A valid URL is required')

  let parsed: URL
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

export function isSafeExternalImageReference(value: unknown): boolean {
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
