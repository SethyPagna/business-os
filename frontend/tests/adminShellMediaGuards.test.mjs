import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../src/platform/runtime/clientRuntime.js', import.meta.url), 'utf8')
const localDbSource = readFileSync(new URL('../src/api/localDb.js', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/utils-settings/Settings.jsx', import.meta.url), 'utf8')
const catalogSource = readFileSync(new URL('../src/components/catalog/CatalogPage.jsx', import.meta.url), 'utf8')

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

assert.doesNotMatch(
  localDbSource,
  /await dexieDb\.delete\(\)/,
  'Local mirror resets should clear tables in place instead of deleting IndexedDB during normal runtime refreshes',
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

console.log('PASS admin shell and media save guards protect Cloudflare Access and blob previews')
