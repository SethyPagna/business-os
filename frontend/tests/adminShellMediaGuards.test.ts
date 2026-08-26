import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../src/platform/runtime/clientRuntime.ts', import.meta.url), 'utf8')
const webApiSource = readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const localDbSource = readFileSync(new URL('../src/api/localDb.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8')
const catalogSource = readFileSync(new URL('../src/components/catalog/CatalogPage.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const userProfileSource = readFileSync(new URL('../src/components/users/UserProfileModal.tsx', import.meta.url), 'utf8')

// The manifest link was previously omitted here specifically because this
// whole origin sits behind Cloudflare Access, and an unauthenticated first
// load (or any load where the Access session cookie isn't sent along with
// the manifest fetch) used to mean the browser's <link rel="manifest">
// request could resolve to Access's own HTML redirect instead of JSON.
// Re-added as part of "make PWA installable" work: a same-origin
// <link rel="manifest"> fetch sends the browser's normal cookies (no
// crossorigin attribute here, so no anonymous-CORS mode is forced), so an
// already-authenticated session's manifest request carries the same Access
// cookie every other in-app asset request already relies on. An
// unauthenticated fetch failing to parse as a manifest is graceful
// (browsers silently skip the install prompt on a bad/missing manifest,
// they don't error the page) rather than a hard breakage. Worth confirming
// against a real Cloudflare Access deploy before fully trusting this, but
// nothing here should regress the original concern for a signed-in user.
assert.match(
  indexSource,
  /rel="manifest"/,
  'Admin shell should request its PWA manifest so install prompts work for signed-in users',
)

// The SW deliberately caches manifest.json now (see service-worker.ts's
// isCacheableStaticPath) as part of the same "make PWA installable" work
// as the index.html assertion above -- it's a small static same-origin
// asset like the other entries already listed here, not something that
// needs to skip the app shell cache.
assert.match(
  swSource,
  /pathname === '\/manifest\.json'/,
  'Service worker should treat manifest.json as a cacheable static asset alongside the icons',
)

assert.doesNotMatch(
  runtimeSource,
  /current\.serverStartTime && next\.serverStartTime && current\.serverStartTime !== next\.serverStartTime/,
  'Client runtime resets should not trigger on every server restart timestamp change',
)

assert.match(
  runtimeSource,
  /const preserveAuth = options\.preserveAuth === true \|\| options\.clearAuth === false/,
  'Runtime resets should preserve the signed-in session unless the caller explicitly clears auth',
)

assert.match(
  runtimeSource,
  /const RUNTIME_CLEANUP_CONCURRENCY = 2/,
  'Runtime reset cleanup should use a small bounded worker count',
)

assert.match(
  runtimeSource,
  /async function mapRuntimeCleanup/,
  'Runtime reset cleanup should share a bounded cleanup helper',
)

assert.match(
  runtimeSource,
  /Math\.min\(RUNTIME_CLEANUP_CONCURRENCY, queue\.length\)/,
  'Runtime reset cleanup should cap service worker and cache cleanup workers',
)

assert.doesNotMatch(
  runtimeSource,
  /Promise\.all\(registrations\.map\(/,
  'Runtime reset should not unregister every service worker registration at once',
)

assert.doesNotMatch(
  runtimeSource,
  /Promise\.all\(\s*cacheKeys[\s\S]{0,160}\.map\(/,
  'Runtime reset should not delete every Business OS cache at once',
)

assert.match(
  webApiSource,
  /import \{[^}]*getSyncServerUrl[^}]*\} from '\.\/api\/http\.ts'/s,
  'window.api.getSyncServerUrl must use the synchronous http module export, not the lazy async methods proxy',
)

assert.match(
  webApiSource,
  /getSyncServerUrl\(\) \{\s*return getSyncServerUrl\(\)\s*\}/s,
  'window.api.getSyncServerUrl should return a plain string so upload image URLs never become [object Promise]/uploads/...',
)

assert.doesNotMatch(
  localDbSource,
  /await dexieDb\.delete\(\)/,
  'Local mirror resets should clear tables in place instead of deleting IndexedDB during normal runtime refreshes',
)

assert.match(
  localDbSource,
  /export async function clearLocalMirrorTables\(tableNames: unknown\[\] = \[\]\): Promise<void>[\s\S]*const names: string\[\] = \[\][\s\S]*const seenNames = new Set<string>\(\)[\s\S]*for \(const value of Array\.isArray\(tableNames\) \? tableNames : \[\]\)[\s\S]*const tables: LocalTable\[\] = \[\][\s\S]*for \(const name of names\)/,
  'Local mirror table cleanup should normalize and resolve table names with direct loops',
)

assert.doesNotMatch(
  localDbSource,
  /\[\.\.\.new Set\(tableNames\.map\(\(name\) => String\(name \|\| ''\)\.trim\(\)\)\.filter\(Boolean\)\)\]/,
  'Local mirror table cleanup should not allocate map/filter arrays before de-duping table names',
)

assert.match(
  settingsSource,
  /sanitizePersistedMediaPath\(form\.ui_app_favicon_image, toStringValue\(settings\.ui_app_favicon_image\)\)/,
  'Settings save should sanitize favicon preview URLs before persisting',
)

assert.match(
  settingsSource,
  /if \(uploadingImage\) \{/,
  'Settings save should block while uploads are still in progress',
)

assert.match(
  catalogSource,
  /if \(hasActiveMediaUpload\) \{/,
  'Portal save should block while media uploads are still in progress',
)

assert.match(
  catalogSource,
  /sanitizePortalMediaValue\(editorDraft\.customer_portal_logo_image, previewConfig\.logoImage \|\| ''\)/,
  'Portal save should sanitize temporary preview URLs before persisting logo media',
)

assert.match(
  catalogSource,
  /if \(raw\.startsWith\('blob:'\) \|\| raw\.startsWith\('data:'\)\) return raw/,
  'Portal preview cache-busting should not append version params onto temporary blob or data URLs',
)

// The custom-favicon feature (src/utils/favicon.ts, the Settings favicon
// crop controls, and App.tsx's live tab-icon swap) was REMOVED (11.14-16):
// the favicon/PWA icon is app-default branding, not per-merchant editable.
// Guard that none of it comes back -- a reintroduced favicon swap is both a
// first-paint cost and the admin/portal image bleed 11.14 fixed.
assert.doesNotMatch(
  settingsSource,
  /createCircularFaviconDataUrl|ui_app_favicon_fit/,
  'Settings must not reintroduce favicon crop controls -- the tab icon is app default; Settings edits only the topbar logo',
)
assert.doesNotMatch(
  appSource,
  /createCircularFaviconDataUrl|const faviconFit =/,
  'the admin shell must not swap its tab icon from saved favicon settings -- the favicon is app default',
)

assert.match(
  userProfileSource,
  /url\.origin !== window\.location\.origin[\s\S]*img\.crossOrigin = 'anonymous'/,
  'Avatar crop editing should only enable anonymous CORS for external images',
)

console.log('PASS admin shell and media save guards protect Cloudflare Access and blob previews')
