// Frontend twin of cloudflare/src/lib/safeLinkUrl.ts. Same rule, same
// answers -- tests/promotionLinkUrlParity.test.ts fails if they diverge.
//
// The Worker refuses to STORE an unsafe promotion link. This exists because
// rows written before that guard are still in the table, and because
// `window.location.assign('javascript:...')` executes it: a stored value has
// to be re-checked at the moment it is followed, not only when it is saved
// (N45).

export const MAX_LINK_URL_LENGTH = 500

// Browsers strip tab and newline before reading the scheme, so 'java\tscript:alert(1)' runs.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
// URL parsing reads '\' as '/', so '/\host' opens another origin just like '//host'.
const PROTOCOL_RELATIVE_START = /^\/(?:[/\\]|%2f|%5c)/i

/**
 * Returns the trimmed value if it is safe to navigate to, otherwise null:
 * an absolute http(s) URL that parses, or a site-relative path starting with
 * a single '/'. Protocol-relative '//host' is refused -- it reads as a path
 * and behaves as another origin. Never throws.
 */
export function safeLinkUrl(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > MAX_LINK_URL_LENGTH) return null
  if (CONTROL_CHARACTER.test(raw) || raw.includes('\\') || PROTOCOL_RELATIVE_START.test(raw)) return null
  if (raw.startsWith('/')) return raw
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return raw
}

export function isSafeLinkUrl(value: unknown): boolean {
  return safeLinkUrl(value) !== null
}
