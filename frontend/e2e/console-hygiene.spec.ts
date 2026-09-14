import { expect, test, type Page } from '@playwright/test'
import {
  ADMIN_ORIGIN,
  STOREFRONT_ORIGIN,
  collectPageHealth,
  consoleErrorsExcludingKnown,
  pageErrorsExcludingKnown,
  storefrontCards,
  type PageHealth,
} from './support/harness'

/**
 * console-hygiene.spec.ts -- the pages a stranger can reach, and what they log.
 *
 * WHAT THIS PROVES
 *  - Every public storefront surface and every signed-out admin route boots with
 *    no uncaught exception, no unhandled rejection, and no console.error.
 *  - No surface 404s a resource it needs. A missing chunk or icon is invisible
 *    until the day it is the reason the page is blank.
 *  - No surface calls an API the server does not have. The fixture server
 *    answers unknown /api paths with an explicit 404 marker instead of an empty
 *    200, precisely so a new boot dependency shows up here as a failure rather
 *    than as a silently empty screen.
 *
 * WHY IT IS ITS OWN FILE. Every other spec asserts hygiene as a side effect of
 * whatever it was doing. This one WALKS the surface -- if a customer can reach
 * it, it is checked, including the places no other spec has a reason to visit
 * (the three legal policies reachable from the footer, the forgot-password
 * screen, the non-product tabs).
 *
 * ERROR CLASS GUARDED: 1defc523 (the blank storefront) at its earliest
 * observable moment. That page was blank because something threw; nobody was
 * watching the console, so the first report came from a customer.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test console-hygiene
 */

/**
 * Public surfaces that have their own URL.
 *
 * The storefront's tabs are NOT urls (PublicCatalogPage keeps the active tab in
 * component state), so they are visited as taps further down. The three legal
 * policies ARE addressable, but through a query parameter rather than a path:
 * frontend/src/components/catalog/legal/LegalPages.tsx:30 exports
 * LEGAL_QUERY_PARAM = 'legal' and the reader is keyed `?legal=privacy|terms|
 * cookies` "so the browser Back button returns to the catalogue and a policy
 * link can be copied and sent to someone". Writing these as /privacy, /terms,
 * /cookies -- which is what they look like they ought to be -- silently lands
 * on the catalogue instead, and the spec then passes without ever opening a
 * policy.
 */
const PUBLIC_SURFACES: ReadonlyArray<{ path: string; ready: string }> = [
  { path: '/', ready: '#root' },
  { path: '/?legal=privacy', ready: '[data-portal-legal-page="privacy"]' },
  { path: '/?legal=terms', ready: '[data-portal-legal-page="terms"]' },
  { path: '/?legal=cookies', ready: '[data-portal-legal-page="cookies"]' },
]

/** Signed-out admin routes. Everything else redirects to the login screen. */
const SIGNED_OUT_ADMIN_ROUTES = ['/', '/pos', '/settings'] as const

/**
 * The endpoints a SIGNED-OUT visitor is allowed to be refused by.
 *
 * Anything answering 401 to someone with no session is the system working. The
 * list is explicit rather than "ignore all 401s" so that a 401 from an endpoint
 * nobody expected -- which is how a permissions bug looks from the outside --
 * still fails this file.
 */
const EXPECTED_SIGNED_OUT_401 = /\/api\/(auth\/bootstrap|settings|shifts\/current|dashboard\/startup|import-jobs|sales|products)/

/** Every non-2xx API response that is NOT an expected signed-out 401. */
function unexpectedApiFailures(health: PageHealth): string[] {
  return health.failedApiResponses.filter((entry) => !(entry.startsWith('401 ') && EXPECTED_SIGNED_OUT_401.test(entry)))
}

/**
 * Failed resource loads, minus the browser's narration of those same expected
 * 401s.
 *
 * support/harness.ts collects "Failed to load resource: ..." apart from real
 * console.error on purpose -- it is the BROWSER talking, not the app -- and a
 * signed-out /api/auth/bootstrap produces one on every single boot. Asserting
 * that this channel is empty would therefore be permanently red, and deleting
 * the assertion would lose the thing it is actually for: a 404 on a chunk, an
 * icon, a font or the manifest. So the expected 401 narration is filtered out
 * by the SAME allow-list the API channel uses, and everything else still fails.
 */
function unexpectedResourceErrors(health: PageHealth): string[] {
  return health.resourceErrors.filter((entry) => !(/status of 401\b/.test(entry) && EXPECTED_SIGNED_OUT_401.test(entry)))
}

function describeHealth(health: PageHealth): string {
  return [
    `pageErrors=${JSON.stringify(pageErrorsExcludingKnown(health))}`,
    `consoleErrors=${JSON.stringify(consoleErrorsExcludingKnown(health))}`,
    `resourceErrors=${JSON.stringify(health.resourceErrors)}`,
    `failedApi=${JSON.stringify(health.failedApiResponses)}`,
  ].join(' ')
}

function expectQuiet(health: PageHealth, where: string): void {
  expect(pageErrorsExcludingKnown(health), `uncaught errors on ${where} -- ${describeHealth(health)}`).toEqual([])
  expect(consoleErrorsExcludingKnown(health), `console.error on ${where} -- ${describeHealth(health)}`).toEqual([])
  expect(unexpectedResourceErrors(health), `failed resource loads on ${where} -- ${describeHealth(health)}`).toEqual([])
  expect(unexpectedApiFailures(health), `unexpected API failures on ${where} -- ${describeHealth(health)}`).toEqual([])
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(2_000)
}

test.describe('console hygiene', () => {
  for (const surface of PUBLIC_SURFACES) {
    test(`the storefront surface ${surface.path} boots silently`, async ({ page }) => {
      // CATCHES: a throw during boot, a 404 chunk, an API the page needs and
      // the server does not serve. Discriminating because it asserts on FOUR
      // separate channels -- a page can be visibly fine and still be logging,
      // and it is the logging that predicts tomorrow's blank screen. The
      // `ready` locator is what makes the legal rows discriminating at all: it
      // fails if the policy reader does not open, so a run that merely landed
      // on the catalogue cannot pass.
      const health = collectPageHealth(page)
      await page.goto(`${STOREFRONT_ORIGIN}${surface.path}`, { waitUntil: 'load' })
      await expect(page.locator(surface.ready)).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('#root')).not.toBeEmpty()
      await settle(page)

      expectQuiet(health, `storefront ${surface.path}`)
    })
  }

  test('walking the storefront tabs stays silent', async ({ page }) => {
    // The tabs are where a customer actually goes, and the non-product ones are
    // separate lazy chunks -- the failure mode this catches (a chunk that 404s
    // after a deploy) cannot happen on the landing route at all.
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator('#root')).not.toBeEmpty()

    // Products first, and assert the grid, so the walk starts from a proven
    // state. (Asserting the grid AFTER the walk instead was wrong: the last tab
    // visited is not the product tab, so the "missing" cards read as a product
    // defect when they are simply not that tab's content.)
    const products = page.getByRole('button', { name: 'Products', exact: true })
    await expect(products).toBeVisible({ timeout: 30_000 })
    await products.click()
    await expect(page.locator(storefrontCards).first()).toBeVisible({ timeout: 30_000 })

    const visited: string[] = []
    for (const tab of ['About', 'FAQ', 'Membership']) {
      const button = page.getByRole('button', { name: tab, exact: true })
      if (!(await button.count())) continue
      await button.first().click()
      await settle(page)
      visited.push(tab)
    }
    // A walk that visited nothing is a green test that proves nothing.
    expect(visited.length, 'storefront secondary tabs actually visited').toBeGreaterThan(0)

    await products.click()
    await expect(page.locator(storefrontCards).first()).toBeVisible({ timeout: 30_000 })

    expectQuiet(health, `the storefront tabs (${visited.join(', ')})`)
  })

  for (const route of SIGNED_OUT_ADMIN_ROUTES) {
    test(`the signed-out admin route ${route} boots to a login form silently`, async ({ page }) => {
      // CATCHES: a deep link opened by someone whose session has expired --
      // the single most common way an admin route is reached signed out, and
      // the one nobody tests by hand.
      const health = collectPageHealth(page)
      await page.goto(`${ADMIN_ORIGIN}${route}`, { waitUntil: 'load' })
      await expect(page.locator('#login-username')).toBeVisible({ timeout: 30_000 })
      await settle(page)

      expectQuiet(health, `admin ${route}`)
    })
  }

  test('the forgot-password screen boots silently', async ({ page }) => {
    // A screen reached only by someone already having a bad day, and one no
    // other spec opens. frontend/src/components/auth/Login.tsx:1242 renders the
    // trigger as tr('reset_password_with_email', ...) = "Forgot password?"
    // (frontend/src/lang/en.json:4255); the recovery form is what must appear.
    const health = collectPageHealth(page)
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 30_000 })
    const forgot = page.getByRole('button', { name: /Forgot password/i })
    await expect(forgot).toBeVisible({ timeout: 30_000 })
    await forgot.click()
    await expect(page.locator('#email-reset-identifier')).toBeVisible({ timeout: 30_000 })
    await settle(page)

    expectQuiet(health, 'the forgot-password screen')
  })

  test('no surface asks the server for something it does not have', async ({ page }) => {
    // The fixture server answers an unmocked /api path with
    //     404 { error: 'No e2e fixture for this route', code: 'e2e_unmocked' }
    // deliberately, instead of an empty 200. So this test does double duty: it
    // catches a new boot dependency in the product, AND it catches a fixture
    // that has fallen behind the product -- both of which are things somebody
    // needs to look at, and neither of which shows up as a broken screen.
    const health = collectPageHealth(page)
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator('#root')).not.toBeEmpty()
    await settle(page)
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 30_000 })
    await settle(page)

    const unmocked = health.failedApiResponses.filter((entry) => entry.startsWith('404 '))
    expect(unmocked, 'routes with no fixture (product grew a dependency, or the fixture fell behind)').toEqual([])
  })
})
