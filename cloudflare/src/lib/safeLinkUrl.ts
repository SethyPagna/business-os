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
//   - a site-relative path beginning with a single '/'
// and nothing else. Protocol-relative '//host' is refused too: it reads as a
// path and behaves as an absolute URL to another origin.

export const MAX_LINK_URL_LENGTH = 500

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
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > MAX_LINK_URL_LENGTH) return null
  // Control characters (including the tab/newline browsers strip out of a
  // URL before resolving the scheme -- 'java\tscript:alert(1)' is a working
  // javascript: URL in several engines).
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null

  if (raw.startsWith('//')) return null
  if (raw.startsWith('/')) return raw

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
