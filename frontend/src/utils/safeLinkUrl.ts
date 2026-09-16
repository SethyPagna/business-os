// Frontend twin of cloudflare/src/lib/safeLinkUrl.ts. Same rule, same
// answers -- tests/promotionLinkUrlParity.test.ts fails if they diverge.
//
// The Worker refuses to STORE an unsafe promotion link. This exists because
// rows written before that guard are still in the table, and because
// `window.location.assign('javascript:...')` executes it: a stored value has
// to be re-checked at the moment it is followed, not only when it is saved
// (N45).

export const MAX_LINK_URL_LENGTH = 500

/**
 * Returns the trimmed value if it is safe to navigate to, otherwise null:
 * an absolute http(s) URL that parses, or a site-relative path starting with
 * a single '/'. Protocol-relative '//host' is refused -- it reads as a path
 * and behaves as another origin. Never throws.
 */
export function safeLinkUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > MAX_LINK_URL_LENGTH) return null
  // Browsers strip tabs and newlines out of a URL before resolving its
  // scheme, so 'java\tscript:alert(1)' is a working javascript: URL.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  if (raw.startsWith('//')) return null
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
