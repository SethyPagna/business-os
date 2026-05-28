import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../src/platform/runtime/clientRuntime.ts', import.meta.url), 'utf8')
const webApiSource = readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const localDbSource = readFileSync(new URL('../src/api/localDb.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/utils-settings/Settings.jsx', import.meta.url), 'utf8')
const catalogSource = readFileSync(new URL('../src/components/catalog/CatalogPage.jsx', import.meta.url), 'utf8')
const faviconSource = readFileSync(new URL('../src/utils/favicon.ts', import.meta.url), 'utf8')
const userProfileSource = readFileSync(new URL('../src/components/users/UserProfileModal.jsx', import.meta.url), 'utf8')

assert.doesNotMatch(
  indexSource,
  /rel="manifest"/,
  'Admin shell should not request a protected manifest behind Cloudflare Access',
)

assert.doesNotMatch(
  swSource,
  /pathname === '\/manifest\.json'/,
  'Service worker should not intercept manifest.json as a cacheable static asset',
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
  /import \{[^}]*getSyncServerUrl[^}]*\} from '\.\/api\/http\.js'/s,
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
  /sanitizePersistedMediaPath\(form\.ui_app_favicon_image, settings\.ui_app_favicon_image \|\| ''\)/,
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

assert.match(
  faviconSource,
  /function shouldUseAnonymousCors\(source: unknown\)/,
  'Favicon canvas processing should decide CORS per URL instead of forcing protected same-origin uploads through anonymous CORS',
)

assert.match(
  faviconSource,
  /url\.origin !== window\.location\.origin/,
  'Same-origin upload favicons should load without anonymous CORS so Cloudflare Access redirects do not become CORS cascades',
)

assert.match(
  userProfileSource,
  /url\.origin !== window\.location\.origin[\s\S]*img\.crossOrigin = 'anonymous'/,
  'Avatar crop editing should only enable anonymous CORS for external images',
)

console.log('PASS admin shell and media save guards protect Cloudflare Access and blob previews')
