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

/** The organization the fixtures describe (e2e/fixtures/admin-session.json). */
export const E2E_ORGANIZATION = { name: 'Leang Beauty', publicId: 'e2e-org' } as const

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
 * frontend/src/components/auth/Login.tsx:1094 -- the organization box.
 *
 * Login.tsx fills it from GET /api/organizations/bootstrap in a mount effect
 * (:458) and refuses to submit without it (:766 "Please choose your
 * organization first."). The Login BUTTON is live the whole time, so a submit
 * that arrives before that fetch resolves is rejected with a message about a
 * field the cashier can see is being filled in for them.
 *
 * That is a real, if small, product observation -- the form does not await its
 * own prerequisite -- and it is also why this helper waits for the box to hold
 * a value instead of typing into it. Typing would bypass the code under test.
 */
const ORGANIZATION_FIELD = '#organization-search'

/**
 * "Has the organization arrived?" -- true for BOTH shapes the form can take.
 *
 * Login.tsx:1039 renders a collapsed row with a lock/"Switch organization"
 * control once the bootstrap says the organization is fixed
 * (organizationCreationEnabled false), and the editable #organization-search
 * box only while it is expanded. An earlier version of this wait polled the
 * input's value alone; in the collapsed shape that element does not exist,
 * inputValue() threw on every poll, and the helper burned its whole budget
 * waiting for an organization that had already been resolved -- which is how a
 * "wait for readiness" turns into the slowest possible sleep.
 */
function organizationReady(page: Page): () => Promise<boolean> {
  return async () => {
    if (await page.getByRole('button', { name: /Switch organization|Change/i }).count()) return true
    const typed = await page.locator(ORGANIZATION_FIELD).inputValue().catch(() => '')
    return typed.trim() !== ''
  }
}

/**
 * Type the credentials, wait for the form's own prerequisite, submit, and keep
 * submitting until the shell appears.
 *
 * Retries in a test suite are usually a way of hiding a defect, so: what is
 * retried here, and why is it harness business rather than product business?
 *
 * MEASURED, twice, under --workers=4 and never in isolation:
 *  1. The second sign-in of a handover failed with the login screen still up,
 *     showing "Please choose your organization first." and an EMPTY
 *     organization box -- the bootstrap fetch had not landed yet. The wait
 *     below removes that case entirely.
 *  2. Signing out from a deep page re-mounts the form once more as the
 *     organization resolves, and a submit landing in that window is lost: the
 *     click reaches a node about to be replaced, and the fresh form comes up
 *     with nothing in flight. fillCredential covers the half where the typed
 *     value disappears; this loop covers the half where the click does.
 *
 * A cashier who taps Login and still sees the login screen taps it again. That
 * is all this does: no storage writes, no direct API calls, and it gives up
 * after 60 s. What storage-isolation.spec.ts is testing is what the app KEEPS
 * across a handover, not whether a re-mounting form swallows one click.
 */
/**
 * frontend/src/App.tsx:1683 installActorSessionQuarantineDom() -- the
 * full-screen "Sign-in changed" lock.
 *
 * It is not decoration: it sets `inert`, `visibility:hidden !important` and
 * `aria-hidden` on every other body child and swallows every input event, so
 * while it is up the login form is neither visible nor clickable. A wait for
 * #login-username or #app-root therefore reports "in flight" until it times
 * out, which tells the reader nothing about why.
 *
 * OBSERVED once in a full run (android-chromium, storage-isolation.spec.ts,
 * the FIRST sign-in of a fresh context): the lock came up reading "Another
 * account is signed in. Sign back into the original account in the other tab,
 * then retry." -- with no other tab, and no account ever signed in.
 *
 * Mechanism, read out of the source: every login goes through
 * api/actorReadScope.ts:62 finishActorCookieMutation(marker, true, user),
 * which deliberately RAISES the quarantine (`quarantined = true`,
 * status 'checking') and relies on :83 acknowledgeActorCookieUser(user)
 * clearing it -- and that only accepts the exact user object of the completed
 * login. If that object is never consumed (a slow or re-mounting login form
 * drops it), the quarantine stays up and AppContext.tsx:983 decides what to
 * say with
 *     const sameActor = !!user?.id && String(nextUser?.id) === String(user.id) ...
 * On the login screen `user` is null, so the first operand is false and :985
 * reports 'different-account' without ever comparing anything. The Retry
 * button re-runs the same comparison and can never succeed; only Reload
 * escapes. Reported as a finding.
 *
 * Here it is recovered the only way that works, and LOUDLY: every occurrence
 * prints to the run log, so the rate stays visible instead of being absorbed.
 */
const SESSION_QUARANTINE = '#businessos-session-quarantine'

async function escapeSessionQuarantine(page: Page): Promise<boolean> {
  const host = page.locator(SESSION_QUARANTINE)
  if (!(await host.isVisible().catch(() => false))) return false
  const shown = (await host.locator('p').first().innerText().catch(() => '')).split('/')[0].trim()
  console.log(`[finding] actor-session quarantine locked the login screen: "${shown}"`)
  await host.getByRole('button', { name: /^Reload/ }).click({ timeout: 30_000 }).catch(() => { /* the lock swallows events; fall through */ })
  await page.waitForTimeout(2_000)
  // App.tsx:1745 refuses the reload when hasDirtyWork() -- then only a fresh
  // document clears the module state that holds the lock.
  if (await host.isVisible().catch(() => false)) {
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' }).catch(() => {})
  }
  await expect(page.locator(USERNAME_FIELD)).toBeVisible({ timeout: 30_000 })
  return true
}

async function submitLogin(page: Page, account: E2EAccount): Promise<void> {
  // Bounded, and deliberately not fatal: if the organization never arrives the
  // submit below still happens and fails with the product's own message, which
  // is far more informative than a timeout on a field nobody was asserting on.
  await expect.poll(organizationReady(page), {
    message: 'the organization bootstrap must land before Login is usable',
    timeout: 20_000,
  }).toBe(true).catch(() => { /* handled below */ })

  // If it never arrived, do what the cashier in front of this screen would do:
  // type the organization. Login.tsx:765 resolves it as
  // `organizationId || organizationSearch`, so the typed name is accepted.
  //
  // OBSERVED, not theoretical: in one full run the second sign-in of a handover
  // sat on "Please choose your organization first." with an empty, expanded
  // organization box for a full 60 s of retries, on desktop-chromium, while the
  // identical flow in a quiet browser repopulated it in under a second (probed
  // directly: GET /api/organizations/bootstrap -> 200 with the organization,
  // and the collapsed "Switch organization" row back within 1 s of logout).
  // The bootstrap effect at Login.tsx:458 runs ONCE on mount and swallows every
  // failure (`} catch (_) {}`), so if that one call is slow past its 20 s
  // withLoaderTimeout or fails for any reason, the login screen stays unusable
  // until the page is reloaded -- there is no retry and no message about it.
  // That is reported as a finding; the suite must not sit in it.
  if (!(await organizationReady(page)())) {
    const box = page.locator(ORGANIZATION_FIELD)
    if (await box.count()) await box.fill(E2E_ORGANIZATION.name)
  }
  await expect.poll(async () => {
    if (await page.locator(APP_ROOT).count()) return 'shell'
    if (await escapeSessionQuarantine(page)) return 'was locked'
    if (!(await page.locator(USERNAME_FIELD).isVisible().catch(() => false))) return 'in flight'
    await fillCredential(page, USERNAME_FIELD, account.username)
    await fillCredential(page, PASSWORD_FIELD, 'e2e-password')
    await page.getByRole('button', { name: /^Login$/ }).click({ timeout: 15_000 }).catch(() => { /* the form may be re-mounting */ })
    await page.waitForTimeout(1_500)
    return (await page.locator(APP_ROOT).count()) ? 'shell' : 'login form'
  }, { message: `${account.username} must reach the signed-in shell`, timeout: 60_000, intervals: [500, 1_000, 2_000] }).toBe('shell')
  await expect(page.locator(APP_ROOT)).toBeVisible({ timeout: 30_000 })
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
  await submitLogin(page, account)
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
