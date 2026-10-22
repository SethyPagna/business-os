/**
 * App document identity (G4), for both hosts.
 *
 * One built index.html serves the shop host and the admin host, and it names
 * no client: its static head and identity block carry the neutral Business OS
 * identity (lib/clientIdentity.ts). This Worker writes the deployment's own
 * identity into every app document it serves, in the raw bytes, because iOS
 * "Add to Home Screen" can read the HTML before any script runs: an admin
 * installing the staff app must get the staff name, icon and manifest, and a
 * customer installing the shop must get the shop's.
 *
 * FREE PLAN RULES apply here (10 ms CPU, no custom cpu_ms): the document is
 * never buffered, parsed or copied -- src/index.ts pipes the asset response
 * through HTMLRewriter, which streams, and these rules only set attributes and
 * text on a handful of elements. There is no KV, D1 or subrequest on this
 * path; the identity is a pure function of the deployment's [vars].
 *
 * The rules are expressed against a minimal element shape rather than
 * HTMLRewriter's own type so that scripts/test-admin-host-document-rewrite-
 * pure.cjs runs the REAL handlers on a stub element; HTMLRewriter itself does
 * not exist outside workerd.
 */
import { STAFF_ICONS, clientIdentityJson, type ClientIdentity } from './clientIdentity'
import { isStaffHostname } from './publicHostGate'

export const ADMIN_DOCUMENT_THEME_COLOR = '#fffdf8'
export const ADMIN_DOCUMENT_MANIFEST_HREF = '/manifest.json'
// The staff app is a till, not a page to pinch: the locked viewport index.html's bootstrap sets on admin routes. The
// storefront keeps the zoomable one the static head carries.
export const ADMIN_DOCUMENT_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'

/**
 * Does this request/response pair describe an app DOCUMENT?
 *
 * Everything is checked before a single byte is touched: a non-HTML response,
 * an error or a 304 all fall through untouched, and so does any client that
 * explicitly asked for something other than HTML.
 *
 * A wildcard Accept header, and a missing one, count as document-shaped on
 * purpose: the service worker precaches the app shell with
 * fetch(new Request('/index.html', { cache: 'reload' })), which sends a
 * wildcard Accept. Excluding it would cache the neutral identity as the
 * app's offline shell -- the exact bug this rewrite exists to prevent,
 * reintroduced offline.
 */
export function shouldRewriteAppDocument(input: {
  method: unknown
  accept: unknown
  contentType: unknown
  ok: unknown
}): boolean {
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
  setInnerContent(content: string, options?: { html: boolean }): void
}

export type DocumentElementRewrite = {
  selector: string
  element(element: RewritableElement): void
}

type IconSet = { favicon: string; icon192: string; icon512: string }

// Keyed by the <link rel="icon"> tag's own sizes attribute, exactly as
// index.html's bootstrap keys it. No sizes is the favicon.
function iconRewrite(icons: IconSet): DocumentElementRewrite {
  return {
    selector: 'link[rel="icon"]',
    element(element) {
      const sizes = element.getAttribute('sizes') || ''
      const href = sizes === '192x192' ? icons.icon192 : sizes === '512x512' ? icons.icon512 : icons.favicon
      element.setAttribute('href', href)
      element.setAttribute('type', sizes ? 'image/png' : 'image/x-icon')
    },
  }
}

function contentRewrite(selector: string, value: string): DocumentElementRewrite {
  return { selector, element(element) { element.setAttribute('content', value) } }
}

function hrefRewrite(selector: string, value: string): DocumentElementRewrite {
  return { selector, element(element) { element.setAttribute('href', value) } }
}

function textRewrite(selector: string, value: string): DocumentElementRewrite {
  return { selector, element(element) { element.setInnerContent(value) } }
}

// Shared by both hosts: the identity block the inline bootstrap and the app
// read, and the loading shell's two names (CSS shows the one for the route).
function identityRewrites(identity: ClientIdentity): DocumentElementRewrite[] {
  const json = clientIdentityJson(identity)
  return [
    {
      selector: 'script#business-os-identity',
      element(element) { element.setInnerContent(json, { html: true }) },
    },
    textRewrite('[data-business-os-identity="adminTitle"]', identity.adminTitle),
    textRewrite('[data-business-os-identity="shopName"]', identity.shopName),
  ]
}

// Open Graph and the canonical URL on the admin host are RELATIVE on purpose:
// nothing should ever preview or index the admin app -- robots.txt answers
// `Disallow: /` on every admin host (lib/publicSeo.ts) -- so the only thing
// that matters there is that the value is not the shop's.
function staffRewrites(identity: ClientIdentity): DocumentElementRewrite[] {
  return [
    textRewrite('title', identity.adminTitle),
    contentRewrite('meta[name="apple-mobile-web-app-title"]', identity.adminShortName),
    contentRewrite('meta[name="theme-color"]', ADMIN_DOCUMENT_THEME_COLOR),
    contentRewrite('meta[name="viewport"]', ADMIN_DOCUMENT_VIEWPORT),
    contentRewrite('meta[name="description"]', identity.adminDescription),
    hrefRewrite('link[rel="manifest"]', ADMIN_DOCUMENT_MANIFEST_HREF),
    hrefRewrite('link[rel="apple-touch-icon"]', STAFF_ICONS.appleTouch),
    iconRewrite(STAFF_ICONS),
    contentRewrite('meta[property="og:site_name"]', identity.adminTitle),
    contentRewrite('meta[property="og:title"]', identity.adminTitle),
    contentRewrite('meta[property="og:description"]', identity.adminDescription),
    contentRewrite('meta[property="og:image"]', STAFF_ICONS.icon512),
    contentRewrite('meta[property="og:url"]', '/'),
    hrefRewrite('link[rel="canonical"]', '/'),
    ...identityRewrites(identity),
  ]
}

// The shop's canonical and link-preview values are ABSOLUTE and name the
// configured public address: crawlers do not resolve relative URLs, and any
// alias host serving this same document folds into the primary one. The
// static head already carries the shop's manifest, theme colour and zoomable
// viewport.
function shopRewrites(identity: ClientIdentity, shopOrigin: string): DocumentElementRewrite[] {
  const home = `${shopOrigin}/`
  return [
    textRewrite('title', identity.shopName),
    contentRewrite('meta[name="apple-mobile-web-app-title"]', identity.shopName),
    contentRewrite('meta[name="description"]', identity.shopDescription),
    hrefRewrite('link[rel="apple-touch-icon"]', identity.shopIcons.appleTouch),
    iconRewrite(identity.shopIcons),
    contentRewrite('meta[property="og:site_name"]', identity.shopName),
    contentRewrite('meta[property="og:title"]', identity.shopName),
    contentRewrite('meta[property="og:description"]', identity.shopDescription),
    contentRewrite('meta[property="og:image"]', new URL(identity.shopIcons.icon512, home).toString()),
    contentRewrite('meta[property="og:url"]', home),
    hrefRewrite('link[rel="canonical"]', home),
    ...identityRewrites(identity),
  ]
}

/** The configured public origin, or the request's own when none is set (local runs). */
export function shopOriginFrom(publicUrl: unknown, requestUrl: string): string {
  try {
    return new URL(String(publicUrl || '')).origin
  } catch {
    return new URL(requestUrl).origin
  }
}

// The staff identity on a staff host (the same rule as the API gate), the
// shop's everywhere else.
export function documentRewrites(input: {
  identity: ClientIdentity
  hostname: string
  shopOrigin: string
}): DocumentElementRewrite[] {
  return isStaffHostname(input.hostname, input.identity.staffHost)
    ? staffRewrites(input.identity)
    : shopRewrites(input.identity, input.shopOrigin)
}
