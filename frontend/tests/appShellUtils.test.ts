import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getAdminPageFromPath, getMountedPageLimit, isAdminAppPath, isPublicCatalogPath, updateMountedPages } from '../src/app/appShellUtils.ts'

let failed = 0
const appContextSource = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const httpSource = readFileSync(new URL('../src/api/http.ts', import.meta.url), 'utf8')
const websocketSource = readFileSync(new URL('../src/api/websocket.ts', import.meta.url), 'utf8')

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('isPublicCatalogPath leaves admin routes for the authenticated app shell', () => {
  assert.equal(isPublicCatalogPath('/public'), true)
  assert.equal(isPublicCatalogPath('/customer-portal'), true)
  assert.equal(isPublicCatalogPath('/leang-cosmetics'), true)
  assert.equal(isPublicCatalogPath('/catalog'), false)
  assert.equal(isPublicCatalogPath('/products/new'), false)
  assert.equal(isPublicCatalogPath('/inventory'), false)
  assert.equal(isPublicCatalogPath('/login'), false)
  assert.equal(isPublicCatalogPath('/'), false)
  assert.equal(isPublicCatalogPath('/health'), false)
  assert.equal(isPublicCatalogPath('/api/products'), false)
  assert.equal(isPublicCatalogPath('/uploads/image.jpg'), false)
  assert.equal(isPublicCatalogPath('/assets/app.js'), false)
})

runTest('admin path helpers map direct admin URLs to app pages', () => {
  assert.equal(isAdminAppPath('/products'), true)
  assert.equal(isAdminAppPath('/public'), false)
  assert.equal(getAdminPageFromPath('/products'), 'products')
  assert.equal(getAdminPageFromPath('/inventory/movements'), 'inventory')
  assert.equal(getAdminPageFromPath('/point-of-sale'), 'pos')
  // E3 (Part 403): the standalone audit page merged into Review & Logs --
  // the old URL keeps working by landing on the host page (which opens
  // its Audit section for this segment).
  assert.equal(getAdminPageFromPath('/audit-log'), 'review')
  assert.equal(getAdminPageFromPath('/users'), 'settings')
  assert.equal(getAdminPageFromPath('/backup'), 'settings')
  // E2: Returns and Fees merged into the Sales hub the same way -- their
  // old URLs land on the sales page (which opens the matching section).
  assert.equal(getAdminPageFromPath('/returns'), 'sales')
  assert.equal(getAdminPageFromPath('/fees'), 'sales')
  assert.equal(getAdminPageFromPath('/login'), '')
})

runTest('updateMountedPages keeps order and max size while de-duplicating', () => {
  const first = updateMountedPages(['dashboard', 'sales'], 'products', 3)
  assert.deepEqual(first, ['dashboard', 'sales', 'products'])

  const withExisting = updateMountedPages(first, 'sales', 3)
  assert.deepEqual(withExisting, ['dashboard', 'products', 'sales'])

  const overflow = updateMountedPages(withExisting, 'users', 3)
  assert.deepEqual(overflow, ['products', 'sales', 'users'])
})

runTest('mobile shells keep fewer hidden pages mounted', () => {
  assert.equal(getMountedPageLimit({ viewportWidth: 390 }), 3)
  assert.equal(getMountedPageLimit({ viewportWidth: 390, maxPages: 5 }), 3)
  assert.equal(getMountedPageLimit({ viewportWidth: 1280 }), 8)
  assert.equal(getMountedPageLimit({ viewportWidth: 1280, coarsePointer: true }), 3)
})

runTest('app shell does not render floating page info help', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /PageHelpButton/)
})

runTest('startup registers the offline app shell service worker', () => {
  const source = readFileSync(new URL('../src/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /registerOfflineAppShell/)
  assert.doesNotMatch(source, /disableServiceWorkerCaching/)
  assert.doesNotMatch(source, /getRegistrations\(\)[\s\S]*unregister/)
})

runTest('service worker serves cached app shell for offline navigations only', () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.match(source, /APP_SHELL_CACHE/)
  assert.match(source, /APP_SHELL_URLS/)
  assert.match(source, /request\.mode === 'navigate'/)
  assert.match(source, /appShellFallback/)
  assert.match(source, /isNeverCachedPath/)
  assert.match(source, /\/api\//)
  assert.match(source, /\/uploads\//)
  assert.match(source, /fetch\(request, \{ cache: 'no-store' \}\)/)
  assert.match(source, /!response\.redirected/)
  assert.match(source, /Cached shell is only for true offline failure/)
  assert.doesNotMatch(source, /if \(cached\) return cached\s+return response/)
})

runTest('successful login reconnects websocket writes immediately', () => {
  // AppContext calls resumeWS() rather than reconnectWS() directly so a fresh
  // login also clears any WS backoff/suppression window left over from a
  // prior session (e.g. a revoked session after a password change). resumeWS
  // itself clears that suppression and then calls reconnectWS() internally.
  assert.match(appContextSource, /import \{ isWSConnected, resumeWS \} from '\.\/api\/websocket\.ts'/)
  assert.match(appContextSource, /cacheClearAll\(\)\s+getAppApi\(\)\.ensureSessionRecoveryListeners\?\.\(\)[\s\S]*?\n\s+resumeWS\(\)\s+startHealthCheck\(\)/)
})

runTest('guest startup ignores expected unauthorized websocket probes', () => {
  assert.match(appContextSource, /const hasRecoverableSession = !!\(user\?\.id \|\| getStoredUserPayload\(\)\)/)
  assert.match(appContextSource, /if \(!hasRecoverableSession\) \{\s+setSyncConnected\(false\)\s+setSyncServerUnreachable\(false\)\s+return undefined\s+\}/)
  assert.match(appContextSource, /ensureSyncUpdateCacheListener\(\)[\s\S]*const onUpdate = \(e: Event\) =>/)
  assert.match(httpSource, /export function ensureSyncUpdateCacheListener\(\): void/)
  assert.doesNotMatch(httpSource, /if \(typeof window !== 'undefined'\) \{\s*window\.addEventListener\('sync:update'/)
  assert.match(appContextSource, /const quickCheck = window\.setTimeout\(poll, 100\)[\s\S]*pollTimer = window\.setInterval\(poll, pollRate\)/)
  assert.match(websocketSource, /export function ensureWebSocketLifecycleListeners\(\): void \{[\s\S]*!hasStoredAuthSession\(\)[\s\S]*window\.addEventListener\('auth:unauthorized'/)
  assert.match(websocketSource, /export function resumeWS\(\): void \{[\s\S]*wsSuppressReconnectUntil = 0[\s\S]*reconnectAttempts = 0[\s\S]*reconnectWS\(\)/)
  assert.doesNotMatch(websocketSource, /window\.addEventListener\('online'[\s\S]{0,160}connectWS/)
  assert.doesNotMatch(websocketSource, /if \(typeof window !== 'undefined'[\s\S]{0,120}\) \{\s*window\.addEventListener\('auth:unauthorized'/)
})

runTest('Khmer buttons use a stronger but not extra-bold weight', () => {
  const source = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  assert.match(source, /body\.lang-km:not\(\[data-public-portal='true'\]\) button/)
  assert.match(source, /font-weight:\s*600 !important/)
})

if (failed > 0) {
  process.exitCode = 1
}
