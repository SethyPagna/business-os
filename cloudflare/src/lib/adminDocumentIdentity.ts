/**
 * Admin-host document identity (G4).
 *
 * One built index.html serves BOTH hosts. Its static <head> is deliberately
 * storefront-first -- manifest, icons, title and Apple app title all name
 * Leang Beauty -- and a synchronous inline bootstrap swaps them to the
 * Business OS admin set on admin hosts before first paint. That bootstrap is
 * still the right default for the storefront, but index.html's own comment
 * records why it is not enough on iOS: "Add to Home Screen" can read the RAW
 * HTML (the file as served, before any script runs), so an admin user
 * installing admin.leangbeauty.com could get a home-screen app called Leang
 * Beauty, wearing the storefront icon, pointed at the storefront manifest.
 *
 * The Worker fixes it where the raw bytes are produced. FREE PLAN RULES apply
 * here (10 ms CPU, no custom cpu_ms): the document is never buffered, parsed
 * or copied -- src/index.ts pipes the asset response through HTMLRewriter,
 * which streams, and these rules only set attributes on a handful of head
 * elements. There is no KV, D1 or subrequest on this path, and nothing but a
 * document response on an admin host reaches it: shouldRewriteAdminDocument()
 * below is the single gate, and every other request falls through to the asset
 * binding untouched.
 *
 * The rules are expressed against a minimal element shape rather than
 * HTMLRewriter's own type so that scripts/test-admin-host-document-rewrite-
 * pure.cjs runs the REAL handlers on a stub element; HTMLRewriter itself does
 * not exist outside workerd.
 */

export const ADMIN_DOCUMENT_TITLE = 'Business OS'
export const ADMIN_DOCUMENT_DESCRIPTION = 'Business OS - Offline-first POS, inventory and analytics'
export const ADMIN_DOCUMENT_MANIFEST_HREF = '/manifest.json'
export const ADMIN_DOCUMENT_APPLE_TOUCH_ICON_HREF = '/apple-touch-icon.png'

// Keyed by the <link rel="icon"> tag's own sizes attribute, exactly as
// index.html's admin branch keys it. '' is the unsized favicon.
const ADMIN_DOCUMENT_ICONS: Record<string, { href: string; type: string }> = {
  '192x192': { href: '/icon-192.png', type: 'image/png' },
  '512x512': { href: '/icon-512.png', type: 'image/png' },
  '': { href: '/favicon.ico?v=business-os', type: 'image/x-icon' },
}

// EXACT hostnames, not a prefix test: this list is the admin half of
// wrangler.toml's routes, and a hostname that is not on it is served the
// storefront document unchanged (the in-page bootstrap still brands it), which
// is the safe direction to be wrong in. The pure test fails if wrangler.toml
// grows an admin route this list does not carry.
export const ADMIN_DOCUMENT_HOSTS: readonly string[] = [
  'admin.leangbeauty.com',
  // Local development serves the admin app, matching
  // frontend/src/app/pathRouting.ts's isAdminHostname().
  'localhost',
  '127.0.0.1',
  '[::1]',
]

export function isAdminDocumentHost(hostname: unknown): boolean {
  return ADMIN_DOCUMENT_HOSTS.includes(String(hostname || '').toLowerCase().trim())
}

/**
 * Does this request/response pair describe a DOCUMENT on an admin host?
 *
 * Everything is checked before a single byte is touched: a non-admin host, a
 * non-HTML response, an error or a 304 all fall through untouched, and so does
 * any client that explicitly asked for something other than HTML.
 *
 * A wildcard Accept header, and a missing one, count as document-shaped on
 * purpose: the service worker precaches the app shell with cache.add(new
 * Request('/index.html', { cache: 'reload' })), which sends a wildcard Accept.
 * Excluding it would cache the STOREFRONT identity as the admin app's offline
 * shell -- the exact bug this rewrite exists to prevent, reintroduced offline.
 */
export function shouldRewriteAdminDocument(input: {
  hostname: unknown
  method: unknown
  accept: unknown
  contentType: unknown
  ok: unknown
}): boolean {
  if (!isAdminDocumentHost(input.hostname)) return false
  // HEAD carries no body to rewrite; anything other than a read is not a
  // navigation at all.
  if (String(input.method || '').toUpperCase() !== 'GET') return false
  if (input.ok !== true) return false
  if (!String(input.contentType || '').toLowerCase().includes('text/html')) return false
  const accept = String(input.accept || '').toLowerCase().trim()
  if (!accept) return true
  return accept.includes('text/html') || accept.includes('*/*')
}

export type RewritableElement = {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  setInnerContent(content: string): void
}

export type DocumentElementRewrite = {
  selector: string
  element(element: RewritableElement): void
}

// Open Graph and the canonical URL on the admin host: index.html's og:* tags
// and its <link rel="canonical"> all name the storefront on its primary host
// (a link to the shop pasted into a chat should preview as the shop, and the
// alias host folds into the primary one), and a crawler or chat app reading
// the ADMIN host's raw HTML must not get that preview -- or be told that this
// document's canonical address is the shop's front page.
//
// Both replacements are RELATIVE, which is the same deliberate asymmetry
// index.html's head comment records: an absolute value would have to name one
// admin host, and there are four (two domains plus localhost and 127.0.0.1).
// Nothing should ever preview or index the admin app -- robots.txt answers
// `Disallow: /` on every admin host (lib/publicSeo.ts) -- so the only thing
// that matters here is that the value is not Leang Beauty.
const ADMIN_DOCUMENT_OG_IMAGE = '/icon-512.png'
const ADMIN_DOCUMENT_SELF_URL = '/'

/** The six tags iOS reads when it installs a home-screen app, plus the
 * Open Graph tags a link preview reads and the canonical URL a search
 * crawler reads. */
export const ADMIN_DOCUMENT_REWRITES: readonly DocumentElementRewrite[] = [
  {
    selector: 'title',
    element(element) { element.setInnerContent(ADMIN_DOCUMENT_TITLE) },
  },
  {
    selector: 'meta[name="apple-mobile-web-app-title"]',
    element(element) { element.setAttribute('content', ADMIN_DOCUMENT_TITLE) },
  },
  {
    selector: 'meta[name="description"]',
    element(element) { element.setAttribute('content', ADMIN_DOCUMENT_DESCRIPTION) },
  },
  {
    selector: 'link[rel="manifest"]',
    element(element) { element.setAttribute('href', ADMIN_DOCUMENT_MANIFEST_HREF) },
  },
  {
    selector: 'link[rel="apple-touch-icon"]',
    element(element) { element.setAttribute('href', ADMIN_DOCUMENT_APPLE_TOUCH_ICON_HREF) },
  },
  {
    selector: 'link[rel="icon"]',
    element(element) {
      const icon = ADMIN_DOCUMENT_ICONS[element.getAttribute('sizes') || ''] || ADMIN_DOCUMENT_ICONS['']
      element.setAttribute('href', icon.href)
      element.setAttribute('type', icon.type)
    },
  },
  {
    selector: 'meta[property="og:site_name"]',
    element(element) { element.setAttribute('content', ADMIN_DOCUMENT_TITLE) },
  },
  {
    selector: 'meta[property="og:title"]',
    element(element) { element.setAttribute('content', ADMIN_DOCUMENT_TITLE) },
  },
  {
    selector: 'meta[property="og:description"]',
    element(element) { element.setAttribute('content', ADMIN_DOCUMENT_DESCRIPTION) },
  },
  {
    selector: 'meta[property="og:image"]',
    element(element) { element.setAttribute('content', ADMIN_DOCUMENT_OG_IMAGE) },
  },
  {
    selector: 'meta[property="og:url"]',
    element(element) { element.setAttribute('content', ADMIN_DOCUMENT_SELF_URL) },
  },
  {
    selector: 'link[rel="canonical"]',
    element(element) { element.setAttribute('href', ADMIN_DOCUMENT_SELF_URL) },
  },
]

// The SPA's document routes. Every one of these serves the same index.html,
// so every one of them is a URL someone can be sitting on when they tap Add
// to Home Screen -- which is why the rewrite cannot be limited to '/'.
//
// These segments mirror frontend/src/app/pathRouting.ts's
// ADMIN_ROUTE_PAGE_BY_SEGMENT plus ADMIN_AUTH_ROUTE_SEGMENTS; the pure test
// fails if the two lists drift apart or if wrangler.toml's run_worker_first
// stops covering them (a path routed to the Worker without a handler here
// would 404 the whole page, and a path handled here without being in
// run_worker_first never reaches the Worker at all).
export const ADMIN_DOCUMENT_SEGMENTS: readonly string[] = [
  'admin', 'app', 'login',
  'audit', 'audit-log', 'backup', 'backups', 'branches', 'catalog', 'contacts',
  'dashboard', 'delivery-contacts', 'fees', 'files', 'inventory', 'library',
  'loyalty', 'loyalty-points', 'notes', 'point-of-sale', 'pos', 'product',
  'products', 'promos', 'promotions', 'receipt-settings', 'receipts', 'returns',
  'review', 'review-queue', 'sales', 'server', 'settings', 'users',
]

export const APP_DOCUMENT_ROUTES: readonly string[] = [
  '/',
  '/index.html',
  ...ADMIN_DOCUMENT_SEGMENTS.flatMap((segment) => ['/' + segment, '/' + segment + '/*']),
]
