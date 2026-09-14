import { expect, type Browser, type BrowserContext, type ConsoleMessage, type Page, type Response } from '@playwright/test'
import { ADMIN_ORIGIN, STOREFRONT_ORIGIN } from '../../playwright.config'

export { ADMIN_ORIGIN, STOREFRONT_ORIGIN }

/**
 * e2e/support/harness.ts -- the one place a spec gets its page from.
 *
 * Everything here exists because of a specific past failure:
 *  - collectPageHealth: "blank page / white screen" was always accompanied by a
 *    thrown error nobody was watching for, so every spec watches.
 *  - blockSiteData: the 1defc523 regression -- touching window.localStorage
 *    THROWS in Safari private mode and under "block all cookies", and a throw
 *    inside a useRef initializer escaped PublicCatalogRoot's Suspense boundary
 *    (which is not an error boundary) and rendered nothing at all.
 *  - seedStorefrontCache / seedViewerPageSize: the a1d55f12 over-fill glitch
 *    only happens to a RETURNING visitor whose stored page size disagrees with
 *    the store's bootstrap cut, so the specs have to reconstruct that visitor.
 */

// --- keys, copied from the source that owns them -----------------------------
/** frontend/src/components/catalog/catalogPagination.tsx */
export const PAGE_SIZE_STORAGE_KEY = 'business-os-portal-page-size-v1'
/** frontend/src/components/catalog/PublicCatalogPage.tsx */
export const PORTAL_CACHE_KEY = 'business-os-catalog-portal-cache'
/** frontend/src/constants.ts STORAGE_KEYS.DEVICE_SETTINGS */
export const DEVICE_SETTINGS_KEY = 'businessos_device_settings'
/** frontend/src/constants.ts STORAGE_KEYS.USER */
export const USER_STORAGE_KEY = 'businessos_user'
/** frontend/src/constants.ts STORAGE_KEYS.USER_EXPIRY */
export const USER_EXPIRY_STORAGE_KEY = 'businessos_user_expiry'

export type PageHealth = {
  /** Uncaught exceptions and unhandled rejections. */
  pageErrors: string[]
  /** console.error / console.warn raised BY THE APP (see appConsoleErrors). */
  consoleErrors: string[]
  /** Browser-level "Failed to load resource: ... 404" lines, kept separate. */
  resourceErrors: string[]
  /** Every non-2xx API response, with status. */
  failedApiResponses: string[]
  /** Every request URL the page made, in order. */
  requests: string[]
}

// A console "error" is two very different things. `console.error(...)` from app
// code is a defect. "Failed to load resource: the server responded with a
// status of 401" is the BROWSER narrating a response the app may be handling
// perfectly well (a signed-out /api/auth/bootstrap is exactly that). Folding
// them together produces a check that is either permanently red or silently
// allows real console.error calls, so they are collected apart.
const RESOURCE_ERROR_RE = /^Failed to load resource\b/

// Playwright itself prints this when serviceWorkers: 'block' is in effect. It
// is harness noise, not app output.
const HARNESS_NOISE_RE = /Service Worker registration blocked by Playwright/

export function collectPageHealth(page: Page): PageHealth {
  const health: PageHealth = {
    pageErrors: [],
    consoleErrors: [],
    resourceErrors: [],
    failedApiResponses: [],
    requests: [],
  }

  page.on('pageerror', (error) => {
    health.pageErrors.push(`${error.name}: ${error.message}\n${error.stack || ''}`)
  })

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return
    const text = message.text()
    if (HARNESS_NOISE_RE.test(text)) return
    if (RESOURCE_ERROR_RE.test(text)) {
      health.resourceErrors.push(`${text} @ ${message.location().url}`)
      return
    }
    if (message.type() === 'error') health.consoleErrors.push(text)
  })

  page.on('request', (request) => { health.requests.push(request.url()) })

  page.on('response', (response: Response) => {
    if (!response.url().includes('/api/')) return
    if (response.status() < 400) return
    health.failedApiResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })

  return health
}

/**
 * The ONE known, reproduced unhandled rejection on a signed-out admin boot.
 *
 * frontend/vite.config.ts builds an early `/api/auth/bootstrap` prefetch into
 * index.html and stores it on window.__businessOsAuthBootstrapPromise WITHOUT
 * attaching a rejection handler at the creation site (the inner function is
 * literally named parseEarlyAuthBootstrapText, which is why the fingerprint can
 * be this precise). A signed-out visitor gets 401, the promise rejects before
 * the module graph has finished loading the consumer that would have caught it,
 * and the browser reports an unhandled rejection.
 *
 * This is quarantined, NOT accepted: admin-boot.spec.ts carries a test.fixme
 * that names it, and every spec still fails on any OTHER page error. Delete
 * this constant the moment the prefetch gets its `.catch()`.
 */
export const KNOWN_SIGNED_OUT_BOOTSTRAP_REJECTION = 'parseEarlyAuthBootstrapText'

/**
 * The ONE known, reproduced console.error on a slow admin boot.
 *
 * frontend/src/api/actorReadScope.ts authority() folds getSyncServerUrl() into
 * the read identity, and that value is an in-memory module variable
 * (frontend/src/api/httpState.ts:1 `let syncServerUrl = ''`) which the app sets
 * only AFTER first paint -- deliberately, see the comment at
 * frontend/src/AppContext.tsx:688 "Persisting it can wait until after first
 * paint". Any actor-scoped read issued before that moment and resolving after
 * it is fenced by assertActorReadScope (actorReadScope.ts:220) with
 * `code: 'stale_read_scope'`.
 *
 * POS.tsx treats that fence as a hard failure in two places -- :1436 catalog
 * and :2121 batch tracking -- so a slow network turns a benign re-scope into
 * console.error plus the amber "Batch and expiry tracking could not be loaded"
 * banner, which then routes every product through the detail sheet instead of
 * one-tap add. REPRODUCED DETERMINISTICALLY, with a negative control, and
 * owned by a red test: storage-isolation.spec.ts
 * "an account handover does not surface the read fence to the cashier".
 *
 * Quarantined here only because it makes every OTHER spec flaky under parallel
 * load (measured: 1 failure in 36 scanner runs at --workers=3). Delete this
 * constant the moment those two handlers ignore `stale_read_scope`.
 */
export const KNOWN_STALE_READ_SCOPE_LOG = 'Read belongs to an earlier account'

/**
 * The ONE known, reproduced console.error on a deliberate logout.
 *
 * Signing out cancels nothing: a POS catalog read already in flight comes back
 * 401 a moment later. frontend/src/components/dashboard/Dashboard.tsx:844
 * handles exactly that --
 *     if (!isInvalidSessionError(error)) console.error('[Dashboard] startup failed:', message)
 * -- but frontend/src/components/pos/POS.tsx:1436 logs unconditionally and
 * additionally calls setCatalogLoadError(), so the till flashes "Could not load
 * products" on its way to the login screen. Same defect family as
 * KNOWN_STALE_READ_SCOPE_LOG: a normal, expected condition reported as a
 * failure. Owned by a red test: storage-isolation.spec.ts
 * "signing out is not an error".
 *
 * Measured on ios-webkit during the A -> logout -> B handover. Delete this
 * constant when POS.tsx gets the guard Dashboard.tsx already has.
 */
export const KNOWN_SIGNED_OUT_POS_CATALOG_LOG = '[POS] catalog load failed: Not authenticated'

/**
 * A HARNESS artifact, not app output: under parallel load the single-threaded
 * fixture server occasionally drops the /sw.js fetch, and WebKit reports that
 * as a page-level "Cannot load ... due to access control checks." that no
 * application code can catch (index.tsx:96 already wraps register() in
 * try/catch and .catch()es every update()).
 *
 * Measured before quarantining: 1 occurrence in 36 scanner runs at
 * --workers=3, and 0 in 6 consecutive ios-webkit runs of the same file in
 * isolation, including 3 that navigated away mid-registration on purpose.
 * Scoped to /sw.js so nothing else hides behind it, and pwa-update.spec.ts
 * still asserts POSITIVELY that a worker reaches 'activated', so a real
 * service-worker failure cannot pass unnoticed.
 */
// NB: Playwright renders a WebKit page error as `${name}: ${message}`, and
// WebKit puts the whole sentence in the name, so the recorded string reads
// "Cannot load http: /127.0.0.1:4318/sw.js due to access control checks." --
// the "//" of the URL becomes ": /". Matched loosely for that reason.
const FIXTURE_SW_FETCH_ARTIFACT = /Cannot load [^\n]*\/sw\.js due to access control checks/

export function pageErrorsExcludingKnown(health: PageHealth): string[] {
  return health.pageErrors.filter((entry) => (
    !entry.includes(KNOWN_SIGNED_OUT_BOOTSTRAP_REJECTION) && !FIXTURE_SW_FETCH_ARTIFACT.test(entry)
  ))
}

export function consoleErrorsExcludingKnown(health: PageHealth): string[] {
  return health.consoleErrors.filter((entry) => (
    !entry.includes(KNOWN_STALE_READ_SCOPE_LOG) && !entry.includes(KNOWN_SIGNED_OUT_POS_CATALOG_LOG)
  ))
}

/** Assert the page is alive and quiet. Used by nearly every spec. */
export function expectNoRuntimeErrors(health: PageHealth): void {
  expect(pageErrorsExcludingKnown(health), 'uncaught page errors').toEqual([])
  expect(consoleErrorsExcludingKnown(health), 'console.error from app code').toEqual([])
}

/**
 * Make every web-storage API throw SecurityError, the way Safari private mode
 * and Chrome's "block all cookies" do.
 *
 * Deliberately defined as a THROWING GETTER rather than a stub that returns
 * null: the regression this reproduces is a throw escaping a React ref
 * initializer, and a null-returning stub would not reproduce it at all.
 *
 * document.cookie is deliberately NOT blocked. Neither browser throws there --
 * Chrome's "block all cookies" makes `document.cookie` read as an empty string
 * and Safari private mode keeps a per-session jar -- so a throwing cookie getter
 * models no real browser. Measured while building this file: adding one turned
 * the storefront blank and would have reported a defect that cannot happen.
 */
export async function blockSiteData(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const boom = () => {
      // DOMException is what the real browsers throw; an ordinary Error would
      // let code that narrows on `error instanceof DOMException` pass here and
      // still break in Safari.
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    for (const key of ['localStorage', 'sessionStorage'] as const) {
      Object.defineProperty(window, key, { configurable: true, get: boom })
    }
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: boom })
  })
}

/** Remember a shopper's 20/50/100 choice before the first paint. */
export async function seedViewerPageSize(context: BrowserContext, origin: string, pageSize: number): Promise<void> {
  await context.addInitScript(({ key, value, target }) => {
    if (window.location.origin !== target) return
    try { window.localStorage.setItem(key, String(value)) } catch { /* blocked storage */ }
  }, { key: PAGE_SIZE_STORAGE_KEY, value: pageSize, target: origin })
}

/**
 * Reconstruct a RETURNING storefront visitor: a cached bootstrap snapshot, cut
 * at the store's own page size, already in both storages.
 *
 * PublicCatalogPage.readPortalCache reads sessionStorage first, then
 * localStorage, and rejects anything older than 20 minutes -- so `cachedAt` has
 * to be written at page time, not at seed time.
 */
export async function seedStorefrontCache(
  context: BrowserContext,
  origin: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await context.addInitScript(({ key, value, target }) => {
    if (window.location.origin !== target) return
    const serialized = JSON.stringify({ ...(value as Record<string, unknown>), cachedAt: Date.now() })
    try { window.sessionStorage.setItem(key, serialized) } catch { /* blocked storage */ }
    try { window.localStorage.setItem(key, serialized) } catch { /* blocked storage */ }
  }, { key: PORTAL_CACHE_KEY, value: payload, target: origin })
}

/** Write device settings (language / theme) -- what the in-app toggles persist. */
export async function seedDeviceSettings(
  context: BrowserContext,
  origin: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await context.addInitScript(({ key, value, target }) => {
    if (window.location.origin !== target) return
    try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* blocked storage */ }
  }, { key: DEVICE_SETTINGS_KEY, value: settings, target: origin })
}

/**
 * Fetch the storefront bootstrap the fixture server would serve, so a spec can
 * seed the cache with the REAL payload shape instead of a hand-written one.
 */
export async function fetchBootstrapPayload(browser: Browser, origin: string): Promise<Record<string, unknown>> {
  const request = await browser.newContext()
  try {
    const response = await request.request.get(`${origin}/api/portal/bootstrap`)
    expect(response.ok(), 'fixture server must serve /api/portal/bootstrap').toBeTruthy()
    return await response.json() as Record<string, unknown>
  } finally {
    await request.close()
  }
}

/** Reset the fixture server's mutable state (service-worker generation, log). */
export async function resetFixtureServer(page: Page): Promise<void> {
  await page.request.post(`${ADMIN_ORIGIN}/__e2e/reset`)
}

export const storefrontCards = 'article[data-product-card="true"]'
export const productSkeletons = 'div.aspect-square.animate-pulse'
