import { expect, test, type Page } from '@playwright/test'
import { collectPageHealth, expectNoRuntimeErrors } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn, signOut } from './support/session'

/**
 * storage-isolation.spec.ts -- the shared till, handed from one cashier to the
 * next on the SAME device and the SAME browser tab.
 *
 * WHAT THIS PROVES
 *  - Signing out really removes the account-scoped on-device state the app
 *    wrote (carts, drafts, cached identity), instead of leaving it for
 *    whoever logs in next.
 *  - The next cashier boots a clean POS: no inherited cart, no inherited
 *    search, no inherited draft.
 *  - The keys that ARE deliberately scoped by user id stay scoped, so the
 *    isolation is by construction and not by luck.
 *  - Two of those claims are currently FALSE on this source and carry
 *    test.fixme with the exact lines that decide them.
 *
 * ERROR CLASS GUARDED: "another cashier's data on my screen" -- the same
 * family as 1defc523 (blank storefront) and a1d55f12 (pager over-fill) in that
 * the defect only exists for a RETURNING/second user, so any test that boots
 * one fresh context per assertion can never see it. Every test here performs a
 * real UI login, a real UI logout, and a second real UI login in one context.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storage-isolation
 */

/** frontend/src/components/pos/POS.tsx:697-699 -- scoped by `user?.id`. */
const posScopedKeys = (userId: number) => [
  `businessos_pos_orders_${userId}`,
  `businessos_pos_active_${userId}`,
  `businessos_pos_counter_${userId}`,
]

/**
 * frontend/src/components/pos/POS.tsx:700 readPosDraft() falls back to these
 * UNSCOPED sessionStorage keys, and POS.tsx:728 seeds the search box from
 * `pos_search`. They predate the per-user scoping, so an upgraded till still
 * carries them.
 */
const LEGACY_POS_KEYS = ['bos_pos_orders', 'bos_pos_active', 'bos_pos_counter']
const POS_SEARCH_KEY = 'pos_search'

/** frontend/src/components/dashboard/Dashboard.tsx:278 */
const DASHBOARD_FILTER_PREFIX = 'bos_dashboard_filters:'

/** frontend/src/utils/workDrafts.ts scopedWorkDraftKey(): org + user + base. */
const workDraftKey = (org: string, userId: number, base: string) => `businessos_draft_${org}_${userId}_${base}`

const POS_SEARCH_BOX = /Search\s+products/i

type StorageDump = { local: Record<string, string>; session: Record<string, string> }

/** Read the keys this spec reasons about, from both storages, in one hop. */
async function dumpStorage(page: Page): Promise<StorageDump> {
  return page.evaluate(() => {
    const interesting = /^(pos_|bos_|businessos_pos_|businessos_draft_|businessos_user$)/
    const pick = (storage: Storage) => {
      const out: Record<string, string> = {}
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index)
          if (!key || !interesting.test(key)) continue
          out[key] = String(storage.getItem(key) ?? '')
        }
      } catch { /* blocked storage is covered by admin-boot.spec.ts */ }
      return out
    }
    return { local: pick(window.localStorage), session: pick(window.sessionStorage) }
  })
}

/**
 * Put cashier A's fingerprints on the device.
 *
 * The POS-scoped keys and the draft key are written by the APP itself once A
 * uses the till; this only adds the two things a real handover also leaves
 * behind and that no automated flow would otherwise produce in 30 seconds: a
 * typed search, and the pre-upgrade cart keys an older build wrote.
 */
async function leaveTracesOfCashierA(page: Page): Promise<void> {
  await page.getByPlaceholder(POS_SEARCH_BOX).first().fill('aurelia-typed-by-cashier-A')
  await page.evaluate(({ legacy, filterPrefix, draftKey }) => {
    window.sessionStorage.setItem(legacy[0], JSON.stringify([{ id: 1, label: 'Order 1', cart: [{ id: 1, product_id: 1, name: 'A private cart line', quantity: 1, price: 5 }] }]))
    window.sessionStorage.setItem(legacy[1], '1')
    window.sessionStorage.setItem(legacy[2], '7')
    window.localStorage.setItem(`${filterPrefix}11`, JSON.stringify({ preset: 'A-only' }))
    window.localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), data: { name: 'A half-typed product' } }))
  }, {
    legacy: LEGACY_POS_KEYS,
    filterPrefix: DASHBOARD_FILTER_PREFIX,
    draftKey: workDraftKey('e2e-org', E2E_ACCOUNTS.cashierA.id, 'product_form'),
  })
}

/**
 * Bring the cart into view.
 *
 * On a phone the cart lives behind its own tab, so the empty-state copy is in
 * the DOM but off-screen (measured: android-chromium and ios-webkit both
 * resolved the node as `hidden`). Tapping the tab is what a cashier does.
 *
 * The wait for a product tile FIRST is the part that matters. An earlier
 * version asked `cartTab.count()` immediately after navigating, which is an
 * instantaneous check with no retry: under --workers=4 the till had not
 * finished mounting, the tab did not exist yet, the tap was silently skipped
 * and the test then failed on a cart it had never opened -- a harness defect
 * wearing the costume of a product defect.
 */
async function showCartPane(page: Page): Promise<void> {
  await expect(page.getByText('E2E Product 001 Aurelia').first(), 'the till must be mounted before its tabs exist').toBeVisible({ timeout: 60_000 })
  const cartTab = page.getByRole('button', { name: 'Cart', exact: true })
  if (await cartTab.count()) await cartTab.first().click()
}

test.describe('same-device account handover', () => {
  // Every test here signs in TWICE, walks to the till twice, and signs out in
  // between -- the most navigation-heavy file in the suite. The default 60 s
  // is enough in isolation (measured: 58 s for all three projects together)
  // and is not enough when four workers share one fixture server, where the
  // failure reads as a timeout rather than as the contention it is.
  test.describe.configure({ timeout: 150_000 })

  test('cashier A leaves no scoped state behind for cashier B', async ({ page }) => {
    // CATCHES: a logout that forgets the per-user POS cart or the per-user
    // work draft. Discriminating because it first PROVES those keys existed
    // while A was signed in -- a harness that silently wrote nothing would
    // otherwise pass this test by accident.
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/pos')
    await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })
    await leaveTracesOfCashierA(page)

    const duringA = await dumpStorage(page)
    const aKeys = [...Object.keys(duringA.local), ...Object.keys(duringA.session)]
    expect(aKeys.filter((key) => posScopedKeys(E2E_ACCOUNTS.cashierA.id).includes(key)).length,
      'the POS must actually have written A-scoped cart keys, or this test proves nothing').toBeGreaterThan(0)
    expect(aKeys, 'A half-typed product form must be on the device').toContain(
      workDraftKey('e2e-org', E2E_ACCOUNTS.cashierA.id, 'product_form'),
    )

    await signOut(page)
    await signIn(page, E2E_ACCOUNTS.cashierB)

    const duringB = await dumpStorage(page)
    const bKeys = [...Object.keys(duringB.local), ...Object.keys(duringB.session)]
    for (const key of posScopedKeys(E2E_ACCOUNTS.cashierA.id)) {
      expect(bKeys, `${key} is cashier A's cart and must not survive the handover`).not.toContain(key)
    }
    expect(bKeys, "A's work draft must not survive the handover").not.toContain(
      workDraftKey('e2e-org', E2E_ACCOUNTS.cashierA.id, 'product_form'),
    )
    // ...and the app is now B, read from the app's own store rather than from
    // the chrome (which renders a one-letter avatar on a phone).
    expect(duringB.local.businessos_user || duringB.session.businessos_user || '')
      .toContain(`"username":"${E2E_ACCOUNTS.cashierB.username}"`)
  })

  test('B inherits no cart from A', async ({ page }) => {
    // The user-visible half of the first test, and the half that matters most
    // at a till: A rings items up, walks away without completing the sale, B
    // takes over. B must not be holding A's cart.
    //
    // Discriminating because it first proves A's cart was NON-empty. Without
    // that positive control an app that never manages to add anything would
    // pass this test permanently.
    const health = collectPageHealth(page)
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/pos')
    // Click the NAME, not the tile's centre. The POS tile is a <button> that
    // CONTAINS a second <button> for the image preview (measured -- see the
    // nested "Preview product images" button in any POS page snapshot), so a
    // centre click lands on the preview and never reaches the add-to-cart
    // handler. Tapping the product name is also what a cashier does.
    const firstProduct = page.getByText('E2E Product 002 Belle Roux').first()
    await expect(firstProduct).toBeVisible({ timeout: 30_000 })
    await firstProduct.click()
    await expect(page.getByText('Cart is empty'), "A's cart must actually hold something").toHaveCount(0)

    await signOut(page)
    await signIn(page, E2E_ACCOUNTS.cashierB)
    await gotoAdminPage(page, '/pos')

    await showCartPane(page)
    await expect(page.getByText('Cart is empty').first(), "B must start from an empty cart").toBeVisible({ timeout: 30_000 })

    expectNoRuntimeErrors(health)
  })

  test('B opens an empty till, not A\'s', async ({ page }) => {
    // Historical regression, reproduced before the explicit legacy cleanup:
    // because it is what the next cashier actually sees.
    //
    // A types a product name into the POS search box. POS.tsx:3411 writes every
    // keystroke to sessionStorage['pos_search'] and POS.tsx:728 seeds the box
    // back from it on mount. That key has no `businessos_` prefix, so logout
    // does not clear it (see the sibling fixme below for the exact line), and
    // it is not scoped by user either.
    //
    // MEASURED: after A -> logout -> B, cashier B's till opens already
    // filtered by A's typing and the product grid reads
    //     "No products match your filters"
    // with an empty cart beside it. B has a full catalogue and an empty
    // screen, and nothing on it explains why. (Captured page snapshot:
    // test-results/storage-isolation-...-B-opens-an-empty-till-not-A-s-*/
    // error-context.md, line 85.)
    //
    // The assertion order below is deliberate: the search box is checked
    // BEFORE the products, so when this goes green it goes green for the right
    // reason rather than because a retry cleared the filter.
    const health = collectPageHealth(page)
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/pos')
    await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })
    await page.getByPlaceholder(POS_SEARCH_BOX).first().fill('aurelia-typed-by-cashier-A')

    await signOut(page)
    await signIn(page, E2E_ACCOUNTS.cashierB)
    await gotoAdminPage(page, '/pos')

    await expect(page.getByPlaceholder(POS_SEARCH_BOX).first(),
      "B's search box must be empty, not seeded with A's typing").toHaveValue('')
    await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('No products match your filters')).toHaveCount(0)
    await expect(page.getByText('A private cart line')).toHaveCount(0)

    expectNoRuntimeErrors(health)
  })

  test('the till is wiped of A\'s UNPREFIXED keys too', async ({ page }) => {
    // Historical regression, now covered by explicit legacy-key cleanup.
    //
    // frontend/src/platform/runtime/clientRuntime.ts:46
    //     const BUSINESS_OS_STORAGE_PREFIXES = ['businessos_', 'business_os_']
    // ...and clearStorage() (:221) deletes ONLY keys matching that prefix.
    //
    // Everything the POS stores WITHOUT the prefix therefore outlives logout:
    //   pos_search, pos_cat, pos_brand, pos_branch, pos_stock, pos_group,
    //   pos_supplier, pos_initial            (POS.tsx:796 lists them)
    //   bos_pos_orders / bos_pos_active / bos_pos_counter
    //                                        (POS.tsx:700 still READS these)
    //   bos_dashboard_filters:<id>           (Dashboard.tsx:278)
    //
    // MEASURED on this harness: after A signs out through the UI,
    // sessionStorage still holds pos_search="aurelia-typed-by-cashier-A",
    // bos_pos_orders, bos_pos_active and bos_pos_counter, and localStorage
    // still holds bos_dashboard_filters:11 -- while every businessos_* key is
    // correctly gone. The scoping work was done; these keys were left out of
    // it.
    //
    // Severity is not uniform: bos_dashboard_filters:<id> is id-scoped so B
    // cannot READ A's, but the legacy cart keys are the fallback branch of
    // POS.tsx:700 readPosDraft(), so on a till upgraded from an older build
    // cashier B inherits cashier A's cart outright.
    //
    // Cleanup must match exact legacy keys, not all pos_/bos_ keys; preserve
    // device preferences and protected pending financial-operation evidence.
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/pos')
    await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })
    await leaveTracesOfCashierA(page)

    await signOut(page)

    const afterLogout = await dumpStorage(page)
    const leftBehind = [...Object.keys(afterLogout.local), ...Object.keys(afterLogout.session)]
    for (const key of [...LEGACY_POS_KEYS, POS_SEARCH_KEY, `${DASHBOARD_FILTER_PREFIX}${E2E_ACCOUNTS.cashierA.id}`]) {
      expect(leftBehind, `${key} belongs to cashier A and must not outlive the logout`).not.toContain(key)
    }
  })

  test.fixme('signing out is not an error', async ({ page }) => {
    // EXPECTED RED ON THIS SOURCE, and a one-line fix with a sibling that
    // already does it right.
    //
    // Logging out cancels nothing that is already in flight: the POS catalog
    // read the cashier's last screen started comes back 401 a moment later.
    //
    //   Dashboard.tsx:844   if (!isInvalidSessionError(error)) console.error(...)
    //   POS.tsx:1436        console.error('[POS] catalog load failed:', ...)
    //                       setCatalogLoadError(...)
    //
    // So the same 401, on the same deliberate action, is silent on one surface
    // and a logged error plus a red "Could not load products" flash on the
    // other. MEASURED on ios-webkit during the handover below:
    //     "[POS] catalog load failed: Not authenticated"
    //
    // When POS.tsx gets the guard Dashboard.tsx already has, delete this
    // `.fixme` AND the KNOWN_SIGNED_OUT_POS_CATALOG_LOG quarantine in
    // e2e/support/harness.ts.
    const health = collectPageHealth(page)
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/pos')
    await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })

    await signOut(page)
    // Give the in-flight reads time to come back 401 and be handled.
    await expect.poll(() => health.consoleErrors.length, { timeout: 8_000, intervals: [1_000] }).toBeGreaterThanOrEqual(0)

    expect(health.consoleErrors.filter((entry) => entry.includes('Not authenticated')),
      'a deliberate logout must not be reported as a failure').toEqual([])
  })

  test.fixme('an account handover does not surface the read fence to the cashier', async ({ page }) => {
    // EXPECTED RED ON THIS SOURCE, and the most user-visible defect this
    // suite found. Reproduced deterministically, with a negative control (a
    // single login in a fresh context never shows it).
    //
    // frontend/src/api/actorReadScope.ts:220 fences a read whose identity
    // changed while it was in flight:
    //     throw Object.assign(new Error('Read belongs to an earlier account
    //       or refresh. Please try again.'),
    //       { name: 'AbortError', code: 'stale_read_scope' })
    // That fence is CORRECT and deliberate -- it is what stops one account's
    // response from painting into another's screen. It is not an error; the
    // caller is supposed to re-read under the new scope.
    //
    // Three callers treat it as a hard failure instead:
    //   Dashboard.tsx:838-848  -- checks isInvalidSessionError() and nothing
    //                             else, so it console.errors and sets
    //                             summaryError + analyticsError
    //   POS.tsx:1436           -- console.error + setCatalogLoadError
    //   POS.tsx:2121           -- console.error + batch tracking 'failed'
    //
    // MEASURED: signing in as A, signing out, then signing in as B in the same
    // tab lands on the dashboard showing the red panel
    //     "Dashboard summary unavailable
    //      Read belongs to an earlier account or refresh. Please try again."
    // with a Refresh button -- to cashier B, on a healthy network, on the
    // single most common action a shared till performs.
    //
    // The same fence fires on a SLOW first load with no handover at all,
    // because actorReadScope.authority() folds getSyncServerUrl() into the
    // identity and httpState.ts:1 starts that as '' until AppContext sets it
    // after first paint (AppContext.tsx:688 "Persisting it can wait until
    // after first paint"). Then POS.tsx:2121 leaves the amber "Batch and
    // expiry tracking could not be loaded" banner up, which downgrades every
    // product from one-tap add to the detail sheet.
    //
    // THE FIX: treat `code === 'stale_read_scope'` the way isInvalidSessionError
    // is treated -- no console.error, no error state, re-read instead. The
    // sibling surfaces with the same shape are TransferModal.tsx:577 and
    // SaleDetailModal.tsx:748.
    //
    // When it lands, delete this `.fixme` AND the KNOWN_STALE_READ_SCOPE_LOG
    // quarantine in e2e/support/harness.ts.
    const health = collectPageHealth(page)
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/pos')
    await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })

    await signOut(page)
    await signIn(page, E2E_ACCOUNTS.cashierB)
    await gotoAdminPage(page, '/')

    // The banner the cashier actually sees.
    await expect(page.getByText('Dashboard summary unavailable')).toHaveCount(0)
    await expect(page.getByText('Read belongs to an earlier account')).toHaveCount(0)
    // ...and the log line behind it. Deliberately reading the RAW console
    // errors, not the quarantined view, so this test is the one place the
    // quarantine cannot hide.
    expect(health.consoleErrors.filter((entry) => entry.includes('Read belongs to an earlier account')),
      'the read fence is internal bookkeeping and must never reach the console').toEqual([])
  })
})
