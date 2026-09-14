import { expect, type Page } from '@playwright/test'
import { ADMIN_ORIGIN } from './harness'

/**
 * e2e/support/session.ts -- signing in and out of the admin shell.
 *
 * Sign-in goes through the REAL login form and the REAL POST /api/auth/login,
 * and the fixture server answers with the REAL session cookie name
 * (cloudflare/src/lib/auth.ts SESSION_COOKIE_NAME = 'bos_session'). Nothing
 * here writes `businessos_user` by hand.
 *
 * That matters most for storage-isolation.spec.ts: the whole question there is
 * what the app does to on-device state when identity CHANGES, and a test that
 * installs the signed-in state itself has already skipped the code under test.
 */

/** The accounts the fixture server knows (e2e/server/fixtureServer.mjs SESSION_USERS). */
export const E2E_ACCOUNTS = {
  admin: { username: 'admin', id: 1, name: 'E2E Admin' },
  cashierA: { username: 'cashier_a', id: 11, name: 'Cashier A' },
  cashierB: { username: 'cashier_b', id: 12, name: 'Cashier B' },
} as const

export type E2EAccount = typeof E2E_ACCOUNTS[keyof typeof E2E_ACCOUNTS]

/** The signed-in shell's root element (App.tsx). */
export const APP_ROOT = '#app-root'
export const USERNAME_FIELD = '#login-username'
export const PASSWORD_FIELD = '#login-password'

/**
 * Type into a login field and make sure it STAYS typed.
 *
 * Logging out from a deep page (say /pos) drops the app back to the login
 * route, and the form can re-mount once more as the organization resolves.
 * A value written into the pre-remount node then disappears, and the login
 * silently submits an empty username. Measured on ios-webkit in the
 * A -> logout -> B handover: the captured page snapshot showed the password
 * field holding "e2e-password" while the username field was empty, and the
 * shell never appeared.
 *
 * A person retypes when that happens; so does this.
 */
async function fillCredential(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector)
  await expect(field).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    try {
      if ((await field.inputValue()) !== value) await field.fill(value)
      return await field.inputValue()
    } catch { return '' }
  }, { message: `${selector} must hold the typed value`, timeout: 15_000 }).toBe(value)
}

/**
 * Fill in the login form and wait for the shell.
 *
 * The password is irrelevant to the fixture server (only the username selects
 * an account) but must be non-empty, because the real route rejects a blank
 * one and the form must be exercised the way a person uses it.
 */
export async function signIn(page: Page, account: E2EAccount): Promise<void> {
  if (!page.url().startsWith(ADMIN_ORIGIN)) {
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
  }
  await expect(page.locator(USERNAME_FIELD)).toBeVisible()
  await fillCredential(page, USERNAME_FIELD, account.username)
  await fillCredential(page, PASSWORD_FIELD, 'e2e-password')
  await page.getByRole('button', { name: /^Login$/ }).click()
  await expect(page.locator(APP_ROOT)).toBeVisible({ timeout: 30_000 })
  // The shell paints before the account is resolved, so wait for the IDENTITY
  // as well -- otherwise a spec that switches users can assert against the
  // previous one.
  //
  // Read from the app's stored session rather than from the chrome. The
  // signed-in name is rendered in full beside the sidebar on a wide viewport
  // but collapses to a single-letter avatar on a phone, so a text locator
  // passes on one project and hangs on the other two. (Measured: this hung on
  // android-chromium and ios-webkit while passing on desktop-chromium.)
  await expect.poll(
    () => page.evaluate(() => {
      try {
        const raw = window.sessionStorage.getItem('businessos_user')
          || window.localStorage.getItem('businessos_user')
        return raw ? String((JSON.parse(raw) as { username?: string }).username || '') : ''
      } catch { return '' }
    }),
    { message: `the app must have ${account.username} as its signed-in user`, timeout: 30_000 },
  ).toBe(account.username)
}

/**
 * Go to an admin page by its REAL URL (frontend/src/app/pathRouting.ts
 * ADMIN_PATH_BY_PAGE: '/pos', '/products', '/sales', ...).
 *
 * Deliberately not "click the nav item". The navigation chrome is different on
 * every project -- a desktop sidebar, and on a phone either a fixed bottom bar
 * or an inline sheet depending on the ui_mobile_section_nav setting -- so a
 * click-based helper passes on one project and hangs on the others (measured:
 * [data-bos-nav-id="pos"] is simply absent on a Pixel 7 in the default 'pages'
 * mode). Going by URL also exercises the deep-link path a bookmarked till
 * actually uses.
 */
export async function gotoAdminPage(page: Page, path: string): Promise<void> {
  await page.goto(`${ADMIN_ORIGIN}${path}`, { waitUntil: 'load' })
  await expect(page.locator(APP_ROOT)).toBeVisible({ timeout: 30_000 })
}

/**
 * Sign out the way a cashier does: the account menu, then Logout.
 *
 * Deliberately NOT `page.request.post('/api/auth/logout')`. The app's own
 * logout is where any on-device cleanup lives, so calling the endpoint
 * directly would prove nothing about what the next cashier can see.
 */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.locator(USERNAME_FIELD)).toBeVisible({ timeout: 30_000 })
}
