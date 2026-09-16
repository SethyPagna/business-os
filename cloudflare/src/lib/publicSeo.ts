/**
 * robots.txt and sitemap.xml for the two hosts one Worker serves (P3-L3, E).
 *
 * The storefront host (leangbeauty.com) is a public website and should be
 * findable: it gets a permissive robots.txt that points at a minimal
 * sitemap -- the home page and the three legal pages, which are the only
 * URLs that are their own destination (products open in a flyout on the
 * home page, and the catalog is search-driven). The admin host is an
 * internal app and must never appear in a search index: it answers
 * `Disallow: /` and has no sitemap.
 *
 * Both are pure functions of (hostname, origin) so that the pure test runs
 * them without workerd, and both handlers in src/index.ts are registered
 * above the D1 middleware: a crawler fetching robots.txt must never cost a
 * database round trip (free plan: 10 ms CPU per invocation).
 */
import { isAdminDocumentHost } from './adminDocumentIdentity'

// The legal pages are addressed by query, not by path (LegalPages.tsx,
// LEGAL_QUERY_PARAM), so the sitemap has to list them that way.
export const PUBLIC_SITEMAP_PATHS: readonly string[] = ['/', '/?legal=privacy', '/?legal=terms', '/?legal=cookies']

export function robotsTxt(hostname: string, origin: string): string {
  if (isAdminDocumentHost(hostname)) return 'User-agent: *\nDisallow: /\n'
  return `User-agent: *\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`
}

/** null on an admin host: there is nothing to index, and the route 404s. */
export function sitemapXml(hostname: string, origin: string): string | null {
  if (isAdminDocumentHost(hostname)) return null
  const urls = PUBLIC_SITEMAP_PATHS
    .map((path) => `  <url><loc>${escapeXml(origin + path)}</loc></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
