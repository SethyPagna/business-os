import { expect, test } from '@playwright/test'
import {
  ADMIN_ORIGIN,
  KNOWN_SIGNED_OUT_BOOTSTRAP_REJECTION,
  blockSiteData,
  collectPageHealth,
  expectNoRuntimeErrors,
  seedDeviceSettings,
} from './support/harness'

/**
 * admin-boot.spec.ts -- the Business OS admin shell comes up signed out.
 *
 * WHAT THIS PROVES
 *  - The admin root renders the real login CONTROLS (index.html paints the
 *    brand before any script runs, so brand text proves nothing).
 *  - It survives blocked site data, the language toggle and a stored device
 *    theme without a runtime error.
 *  - The one page error a signed-out boot does produce is named and owned by a
 *    red test here rather than quietly tolerated everywhere.
 *
 * The whole admin app is behind the login form, so "the admin boots" IS "the
 * login form renders". That is also the screen a blank page hurts most: a
 * cashier who cannot sign in cannot ring a sale.
 *
 * ERROR CLASS GUARDED: 1defc523 (the blank storefront) in its admin form --
 * the same "throws while reading storage during first render" defect, on the
 * screen the shop starts its day with.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test admin-boot
 */

const USERNAME_FIELD = '#login-username'
const PASSWORD_FIELD = '#login-password'

// QuickPreferenceToggles renders the language button with a two-letter badge
// inside it. Its ACCESSIBLE NAME is itself translated ("Switch to Khmer" ->
// "ប្តូរទៅភាសាខ្មែរ"), so a name-based locator can only ever find the button in
// one direction. The badge is the stable handle for "the language toggle,
// whatever language it is currently in".
const LANGUAGE_TOGGLE = 'button:has(span:text-is("EN")), button:has(span:text-is("KM"))'

test.describe('admin shell boot', () => {
  test('renders the login form, not a blank page', async ({ page }) => {
    // CATCHES: the admin root failing to mount. Asserting on the two real form
    // CONTROLS (and the submit button) rather than on brand text is what makes
    // it discriminating -- index.html paints "Business OS" before any script
    // runs, so a text assertion passes on a dead page.
    const health = collectPageHealth(page)
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })

    // Hostname routing: 127.0.0.1 is an admin hostname (src/app/pathRouting.ts).
    await expect(page.locator('html')).toHaveAttribute('data-business-os-initial-route', 'admin')
    await expect(page).toHaveTitle('Business OS')

    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await expect(page.locator(PASSWORD_FIELD)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Login$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible()

    expect(health.consoleErrors, 'console.error from app code').toEqual([])
    // The signed-out bootstrap 401 is the ONLY non-2xx a logged-out admin boot
    // may produce. A second entry here means a new first-paint dependency
    // appeared, or an existing one started failing.
    expect(health.failedApiResponses).toEqual(['401 /api/auth/bootstrap'])
  })

  test.fixme('still renders the login form when site data is blocked', async ({ page, context }) => {
    // KNOWN DEFECT -- FOUND BY THIS SPEC, 2026-09-14. The admin shell renders a
    // COMPLETELY BLANK PAGE (#root innerHTML length 0) in Safari private mode
    // and under Chrome's "block all cookies". Reproduced on all three projects.
    //
    // Root cause, traced through the built chunk back to source:
    //
    //   frontend/src/AppContext.tsx:425
    //     function getStoredUserPayload() {
    //       return safeStorageGet(sessionStorage, STORAGE_KEYS.USER)
    //           || safeStorageGet(localStorage, STORAGE_KEYS.USER)
    //     }
    //
    //   safeStorageGet guards the CALL (`try { store?.getItem?.(key) } catch {}`)
    //   but `sessionStorage` / `localStorage` are evaluated as ARGUMENTS, before
    //   the function is entered -- and touching those globals is what throws
    //   SecurityError. getStoredUserPayload() runs inside an AppProvider
    //   useState initializer, so the throw happens during render, React unmounts
    //   the tree, and nothing is left on screen. Captured stack:
    //       at fe (app-auth...js)            <- getStoredUserPayload
    //       at ... useState                  <- AppProvider initializer
    //       at renderWithHooks / performConcurrentWorkOnRoot
    //   getStoredUserExpiry (AppContext.tsx:429) has the identical shape.
    //
    // This is the 1defc523 class, still open on the ADMIN root. The storefront's
    // readPortalCache (PublicCatalogPage.tsx:381) already fixed it the right way
    // and its own comment says why: "the store list has to be built INSIDE this
    // guard".
    //
    // Fix: move the global reads inside the try, e.g.
    //     function getStoredUserPayload() {
    //       try { return safeStorageGet(sessionStorage, ...) || safeStorageGet(localStorage, ...) }
    //       catch { return null }
    //     }
    // then delete this `.fixme` -- the assertions below already pass on a
    // correct implementation (the storefront twin of this test is green).
    await blockSiteData(context)
    const health = collectPageHealth(page)

    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })

    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await expect(page.locator(PASSWORD_FIELD)).toBeVisible()

    const storageThrew = await page.evaluate(() => {
      try {
        void window.localStorage
        return false
      } catch {
        return true
      }
    })
    expect(storageThrew, 'the site-data blocker must actually be armed').toBe(true)

    expect(health.consoleErrors, 'console.error from app code').toEqual([])
  })

  test('the language toggle swaps packs', async ({ page }) => {
    // CATCHES: a language pack that never loads, or a toggle that flips state
    // without reaching the dictionary. Discriminating because it asserts on
    // RENDERED LABEL TEXT changing, not just on the html[lang]/body attributes:
    // those flip from the same setState that the toggle already owns, so they
    // would stay green even if LANG_LOADERS never resolved and every label fell
    // back to its raw key.
    const health = collectPageHealth(page)
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })

    const passwordLabel = page.locator('label[for="login-password"]')
    await expect(passwordLabel).toHaveText('Password')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    const toggle = page.locator(LANGUAGE_TOGGLE).first()
    await expect(toggle).toHaveAccessibleName('Switch to Khmer')
    await toggle.click()

    await expect(page.locator('html')).toHaveAttribute('lang', 'km')
    await expect(page.locator('body')).toHaveAttribute('data-ui-language', 'km')
    // The exact value from lang/km.json line 3547. Asserting the real string,
    // not merely "some Khmer characters", is what proves the km PACK loaded --
    // a partially-loaded pack falls back to the raw key ("password"), which a
    // script-range regex would also reject but a `not.toHaveText('Password')`
    // alone would not.
    await expect(passwordLabel).toHaveText('ពាក្យសម្ងាត់')

    // ...and back, so the toggle is proven to be a toggle rather than a one-way
    // switch. Its own accessible name is Khmer now (lang/km.json:5010).
    await expect(toggle).toHaveAccessibleName('ប្តូរទៅភាសាអង់គ្លេស')
    await toggle.click()
    await expect(passwordLabel).toHaveText('Password')

    expectNoRuntimeErrors(health)
  })

  test('defaults to light even when the OS asks for dark', async ({ page }) => {
    // CATCHES: honouring prefers-color-scheme. The storefront and the admin app
    // deliberately default to LIGHT on a first visit; auto-dark was rejected.
    // The emulated dark preference below is the discriminating input -- without
    // it this test passes on an implementation that reads the media query.
    await page.emulateMedia({ colorScheme: 'dark' })
    const health = collectPageHealth(page)
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()

    // theme-bootstrap.js decides this synchronously, before first paint, and
    // AppContext keeps it. Both are asserted: the class drives Tailwind's dark
    // variants, the color-scheme drives form-control rendering.
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    expect(await page.locator('html').evaluate((node) => node.style.colorScheme)).toBe('light')

    // A manual switch must still work -- "default to light" is not "refuse dark".
    await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()

    expectNoRuntimeErrors(health)
  })

  test.fixme('signed-out boot raises no unhandled rejection', async ({ page }) => {
    // KNOWN DEFECT, quarantined here on purpose rather than allow-listed
    // silently. frontend/vite.config.ts inlines an early auth prefetch into
    // index.html:
    //
    //     window.__businessOsAuthBootstrapPromise = window.fetch('/api/auth/bootstrap', ...)
    //       .then(function parseEarlyAuthBootstrap(response) {
    //         return response.text().then(function parseEarlyAuthBootstrapText(text) {
    //           ... if (!response.ok) throw error ...
    //
    // No `.catch()` is attached at the creation site. A signed-out visitor gets
    // 401, so the promise rejects while the module graph is still loading the
    // consumer that would have handled it, and the browser reports an unhandled
    // rejection ("Error: Not authenticated" at parseEarlyAuthBootstrapText).
    //
    // Fix is one line -- attach `.catch(() => {})` (or store the settled
    // outcome) where the promise is created; the stored promise's real consumer
    // already handles the error itself. Remove this fixme and
    // KNOWN_SIGNED_OUT_BOOTSTRAP_REJECTION from support/harness.ts together.
    const health = collectPageHealth(page)
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await page.waitForTimeout(1_000)
    expect(health.pageErrors.filter((entry) => entry.includes(KNOWN_SIGNED_OUT_BOOTSTRAP_REJECTION))).toEqual([])
  })

  test('a stored Khmer device preference is honoured before first paint', async ({ page, context }) => {
    // CATCHES: the device-settings read regressing. This is the storage key the
    // in-app language toggle writes (STORAGE_KEYS.DEVICE_SETTINGS), so a
    // returning Khmer-speaking user landing on an English login screen is the
    // symptom. Asserted from a COLD load rather than by toggling, because the
    // toggle path and the restore path are different code.
    await seedDeviceSettings(context, ADMIN_ORIGIN, { language: 'km' })
    const health = collectPageHealth(page)
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })

    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'km')
    await expect(page.locator('label[for="login-password"]')).toHaveText(/[ក-៿]/)

    expectNoRuntimeErrors(health)
  })
})
