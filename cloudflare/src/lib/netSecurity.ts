// Ported from backend/src/netSecurity.ts. The legacy version's only Node
// dependency was `net.isIP()`, used purely as a literal-string IPv4/IPv6
// classifier (no DNS resolution happens anywhere in this file) -- so unlike
// the SSRF check dropped in portal.ts (checkpoint 10, which really did rely
// on DNS resolution), this one ports directly. `isIPv4Literal`/`parseIpv6`
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

// URL.hostname keeps the brackets of an IPv6 literal ('[::1]').
function normalizeHostname(hostname: unknown): string {
  return trim(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
}

function isIPv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}

function parseIpv6Part(part: string): number[] | null {
  if (!part) return []
  const groups: number[] = []
  const pieces = part.split(':')
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i]
    if (piece.includes('.')) {
      if (i !== pieces.length - 1 || !isIPv4Literal(piece)) return null
      const octets = piece.split('.').map(Number)
      if (octets.some((octet) => octet > 255)) return null
      groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
    } else {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null
      groups.push(parseInt(piece, 16))
    }
  }
  return groups
}

// Eight 16-bit groups, or null when the text is not a well-formed IPv6 literal.
function parseIpv6(hostname: string): number[] | null {
  if (!hostname.includes(':') || !/^[0-9a-f:.]+$/.test(hostname)) return null
  const halves = hostname.split('::')
  if (halves.length > 2) return null
  const head = parseIpv6Part(halves[0])
  if (!head) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const tail = parseIpv6Part(halves[1])
  if (!tail) return null
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...tail]
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

// A text that has a ':' but is not a well-formed literal cannot be a DNS name,
// so it is refused rather than treated as a public host.
function isPrivateIpv6(hostname: string): boolean {
  const groups = parseIpv6(normalizeHostname(hostname))
  if (!groups) return true
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] <= 1) return true
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isPrivateIpv4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`)
  }
  if ((groups[0] & 0xffc0) === 0xfe80) return true
  if ((groups[0] & 0xfe00) === 0xfc00) return true
  return false
}

export function isBlockedHostname(hostname: unknown): boolean {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return true
  if (BLOCKED_HOSTS.has(normalized)) return true
  for (const suffix of BLOCKED_SUFFIXES) {
    if (normalized.endsWith(suffix)) return true
  }
  if (isIPv4Literal(normalized)) return isPrivateIpv4(normalized)
  if (normalized.includes(':')) return isPrivateIpv6(normalized)
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
