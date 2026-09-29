// One answer to "is this string safe to navigate a visitor to?", shared by
// the Worker that stores promotion links and the storefront that follows them.
//
// WHY (N45). A promotion's link_url was stored as any trimmed string up to 500
// characters, and the storefront banner did
// `window.location.assign(promo.link_url)` for anything that did not start
// http(s). `javascript:...` starts with neither, so a promotion row was a
// script-execution primitive aimed at every visitor to the public storefront
// -- staff-authored, but staff accounts get compromised, and a shop owner
// pasting a link they were sent is exactly the case this has to survive.
// `data:text/html,...` is the same problem with a different scheme.
//
// The rule is an allowlist, because a denylist of dangerous schemes is a list
// somebody has to keep complete forever:
//   - an absolute http:// or https:// URL that actually parses, or
//   - a site-relative path beginning with a single '/', resolved or not
// and nothing else. Protocol-relative '//host' is refused too: it reads as a
// path and behaves as an absolute URL to another origin.

export const MAX_LINK_URL_LENGTH = 500

// Browsers strip tab and newline before reading the scheme, so 'java\tscript:alert(1)' runs.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
// URL parsing reads '\' as '/', so '/\host' opens another origin just like '//host'.
const PROTOCOL_RELATIVE_START = /^\/(?:[/\\]|%2f|%5c)/i
const ANY_ORIGIN = 'https://site.invalid'

// '/.//host' stays on this site as written, but its resolved path '//host' is another origin
// wherever something re-emits that path as a link.
function resolvesToProtocolRelativePath(sitePath: string): boolean {
  return new URL(sitePath, ANY_ORIGIN).pathname.startsWith('//')
}

export function isSafeLinkUrl(value: unknown): boolean {
  return normalizeSafeLinkUrl(value) !== null
}

/**
 * Returns the trimmed value if it is safe to navigate to, otherwise null.
 * Never throws, never rewrites the value into something else -- a link that
 * has to be "fixed" to be safe is a link the author should be shown an error
 * for, not one that is silently turned into a different destination.
 */
export function normalizeSafeLinkUrl(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > MAX_LINK_URL_LENGTH) return null
  if (CONTROL_CHARACTER.test(raw) || raw.includes('\\') || PROTOCOL_RELATIVE_START.test(raw)) return null
  if (raw.startsWith('/')) return resolvesToProtocolRelativePath(raw) ? null : raw

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    // Not an absolute URL and not site-relative: refuse rather than guess at
    // an origin for it.
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return raw
}

// Stricter than normalizeSafeLinkUrl: a picture served by another host would
// let that host log every storefront visitor.
const MAX_UPLOAD_PATH_LENGTH = 500
const UPLOADS_PREFIX = '/uploads/'
// Zero-width characters stay allowed: a Khmer keyboard types U+200B between words, and a browser
// percent-encodes them in a src. Bidi controls would reorder how the stored name reads.
const UNSAFE_UPLOAD_PATH_CHARACTER = /[\p{Cc}\u202A-\u202E\u2066-\u2069\uFEFF\\]/u
// GET /uploads/* serves a '%' that starts no escape as a literal '%' (Hono's tryDecode).
const PERCENT_STARTING_NO_ESCAPE = /%(?![0-9a-f]{2})/gi

function percentDecoded(text: string): string | null {
  try {
    return decodeURIComponent(text.replace(PERCENT_STARTING_NO_ESCAPE, '%25'))
  } catch {
    return null
  }
}

function isFileNameSegment(segment: string): boolean {
  const name = percentDecoded(segment)
  return name !== null && name !== '.' && name !== '..' && !name.includes('/')
}

export function normalizePortalUploadPath(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > MAX_UPLOAD_PATH_LENGTH || raw.includes('//')) return null
  const decoded = percentDecoded(raw)
  if (decoded === null || UNSAFE_UPLOAD_PATH_CHARACTER.test(decoded)) return null
  const pathPart = raw.split(/[?#]/)[0]
  if (!pathPart.startsWith(UPLOADS_PREFIX) || pathPart.length <= UPLOADS_PREFIX.length) return null
  return pathPart.split('/').every(isFileNameSegment) ? raw : null
}
