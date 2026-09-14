import { expect, test, type Page } from '@playwright/test'

/**
 * TIER "SYSTEM" -- the real Worker, the real D1, the real bcrypt.
 *
 *   cd cloudflare
 *   node scripts/apply-local-migrations.cjs --persist-to <dir>
 *   npx wrangler dev --local --port 4319 --ip 127.0.0.1 --persist-to <dir>
 *   node scripts/seed-e2e-local.cjs --persist-to <dir>
 *   cd ../frontend
 *   E2E_SYSTEM=1 npx playwright test e2e/system --project=desktop-chromium
 *
 * Run it by hand:
 *   E2E_SYSTEM=1 npx playwright test e2e/system
 *
 * WHY THIS FILE EXISTS WHEN TIER "app" ALREADY COVERS THE TILL
 *
 * Tier "app" answers fixtures, so it proves what the FRONTEND does with a
 * given response shape. It cannot prove that POST /api/sales accepts what the
 * till sends, that the sale it writes is the sale Sales reads back, or that
 * the money survives the round trip. Every one of those has its own way of
 * being wrong while both halves look correct in isolation -- which is exactly
 * the class this tier is for, and exactly the class a fixture can never catch
 * because the fixture is written from the same assumption as the caller.
 *
 * It is opt-in because it needs a Worker: playwright.config.ts collects
 * e2e/system/** only when E2E_SYSTEM=1, and suppresses the fixture server in
 * that mode so it cannot shadow the real one.
 *
 * Nothing here can reach production: the origin is loopback and is asserted to
 * be loopback before the first navigation.
 */

const SYSTEM_ORIGIN = process.env.E2E_SYSTEM_ORIGIN || 'http://127.0.0.1:4319'
const E2E_USER = { username: 'e2e_admin', password: 'e2e-password' }
/** cloudflare/scripts/seed-e2e-local.cjs PRODUCTS[1] -- $7.25. */
const PRODUCT = { name: 'E2E Product 002 Belle Roux', priceUsd: 7.25 }

const APP_ROOT = '#app-root'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.describe('system: a real sale through the real Worker', () => {
  /**
   * ONE browser, on purpose -- and not because the other two cannot do it.
   *
   * MEASURED: running this file on all three projects at once failed on
   * android-chromium and ios-webkit with the server's own words, "Too many
   * login attempts for this account. Please try again later." That is the
   * REAL rate limiter working exactly as designed:
   * cloudflare/src/routes/auth.ts:56 LOGIN_USER_LIMIT_MAX = 8 per account per
   * 15 minutes (and :54 LOGIN_IP_LIMIT_MAX = 20 per IP), and three browsers
   * plus reruns share one account and one loopback IP.
   *
   * The wrong resolutions are (a) raising the limit for tests, which deletes a
   * real security property from the build under test, and (b) seeding three
   * accounts, which hides the IP limit until a fourth browser is added. The
   * right one is that this tier answers "does the whole stack work", which is
   * a per-STACK question, not a per-engine one -- the per-engine questions
   * live in tier "app", which needs no login at all.
   *
   * Override with E2E_SYSTEM_PROJECT if a specific engine is under suspicion;
   * run it alone, and mind the limiter.
   */
  const systemProject = process.env.E2E_SYSTEM_PROJECT || 'desktop-chromium'
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== systemProject,
      `tier "system" runs on ${systemProject} only -- the real per-account login limiter (auth.ts:56, 8 per 15 min) is shared by every project`)
  })

  test.beforeAll(() => {
    // A test that can reach production is a test that will, one day, on
    // someone else's machine. Fail before the first navigation, not after.
    const host = new URL(SYSTEM_ORIGIN).hostname
    expect(host === '127.0.0.1' || host === 'localhost' || host === '::1', `E2E_SYSTEM_ORIGIN must be loopback, got ${SYSTEM_ORIGIN}`).toBe(true)
  })

  test('a cashier signs in, rings a sale, and finds it in Sales', async ({ page }) => {
    await signInForReal(page)

    await page.goto(`${SYSTEM_ORIGIN}/pos`, { waitUntil: 'load' })
    await expect(page.locator(APP_ROOT)).toBeVisible({ timeout: 60_000 })

    // Tap the NAME, not the tile's centre: the POS tile is a <button> that
    // contains a second <button> for the image preview, so a centre tap lands
    // on the preview and never reaches the add-to-cart handler. (Same
    // measurement as storage-isolation.spec.ts in tier "app".)
    const tile = page.getByText(PRODUCT.name).first()
    await expect(tile, 'the seeded product must reach the till from real D1').toBeVisible({ timeout: 60_000 })

    // Positive control BEFORE the money claim: without this, a till that adds
    // nothing would sail through a "the total is right" assertion on an empty
    // cart showing $0.00, and a sale of nothing would be recorded as a pass.
    //
    // The tap is retried because the catalogue re-renders as its later loads
    // land (measured: the identical tap added the item on one run and hit a
    // re-rendering tile on the next, with the cart still reading "Cart is
    // empty"). A cashier whose tap does nothing taps again.
    await expect.poll(async () => {
      if (!(await page.getByText('Cart is empty').count())) return 'holding the item'
      await tile.click({ timeout: 30_000 }).catch(() => { /* mid-render */ })
      await page.waitForTimeout(500)
      return (await page.getByText('Cart is empty').count()) ? 'empty' : 'holding the item'
    }, { message: 'the cart must actually hold the item', timeout: 60_000 }).toBe('holding the item')

    // The local database accumulates across runs, so identify the new sale by
    // IDENTITY, not by count or by "the first row" -- an ordering assumption
    // would quietly test the wrong row the first time the list is sorted
    // differently.
    const before = new Set((await fetchSales(page)).map((sale) => sale.id))
    const stockBefore = await branchQuantity(page, PRODUCT.name)
    expect(stockBefore, 'the seeded product must have shop stock to sell').toBeGreaterThan(0)

    // Hand over the money. POS.tsx:3110 refuses any paid status while
    // totalPaid < totalUsd - 0.005, so a test that skips this step is not
    // testing a sale, it is testing the guard -- measured: the first run of
    // this spec never reached POST /api/sales for exactly that reason, and the
    // worker log showed only the login. "Exact $" is the one-tap cash path.
    await page.getByRole('button', { name: 'Exact $', exact: true }).click({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Complete Sale' }).click({ timeout: 60_000 })
    await expect(page.getByText('Record Sale As')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /^Completed/ }).click({ timeout: 30_000 })

    // The sale is only real once the SERVER has it. Read it back from the API
    // the Sales page uses, not from the till's own optimistic state -- an app
    // that renders a sale it never managed to POST is precisely the failure
    // this tier exists to catch.
    // If the till refuses instead of selling, SAY SO. The refusal is a toast
    // (App.tsx:1175 role="alert") that disappears on its own, so a bare poll
    // on the sale count would time out 60 s later with the reason already gone
    // from the screen and from the failure screenshot.
    let created: SaleRow | undefined
    await expect
      .poll(async () => {
        const fresh = (await fetchSales(page)).filter((sale) => !before.has(sale.id))
        created = fresh[0]
        if (fresh.length) return 'recorded'
        const refusal = await page.getByRole('alert').first().innerText().catch(() => '')
        return refusal.trim() ? `the till refused: ${refusal.trim().replace(/\s+/g, ' ')}` : 'nothing yet'
      }, { message: 'POST /api/sales must have created exactly one new sale', timeout: 60_000 })
      .toBe('recorded')
    expect((await fetchSales(page)).filter((sale) => !before.has(sale.id)), 'one tap must create ONE sale, not two')
      .toHaveLength(1)

    const latest = created as SaleRow
    expect(Number(latest.total_usd), 'the money must survive the round trip unchanged').toBeCloseTo(PRODUCT.priceUsd, 2)
    expect(String(latest.sale_status), 'the status the cashier chose is the status that was stored').toBe('completed')
    // Identity, not just money: the sale must carry the item that was rung,
    // the cashier who rang it and the branch that sold it. A sale with the
    // right total and the wrong item, or with no cashier, is a reconciliation
    // problem that only shows up weeks later in a report.
    expect(latest.items.map((item) => item.product_name)).toEqual([PRODUCT.name])
    expect(Number(latest.items[0].quantity)).toBe(1)
    expect(String(latest.cashier_name)).toBe(E2E_USER.username)
    expect(String(latest.branch_name), 'the shop sells; the warehouse never does').toBe('shop')

    // And the stock ledger moved. This is the half a fixture can never assert:
    // POST /api/sales must deduct from the branch that sold, in the same
    // transaction, or the till and the stock sheet disagree from here on.
    await expect
      .poll(() => branchQuantity(page, PRODUCT.name), { message: 'the sale must deduct one from shop stock', timeout: 30_000 })
      .toBe(stockBefore - 1)

    // And the human-visible half: the receipt the cashier can point at.
    await page.goto(`${SYSTEM_ORIGIN}/sales`, { waitUntil: 'load' })
    await expect(page.getByText(String(latest.receipt_number)).first(), 'the new sale must be visible on the Sales page')
      .toBeVisible({ timeout: 60_000 })
  })
})

/** The REAL login form against the REAL POST /api/auth/login: the password is
 * verified by bcrypt.compareSync in cloudflare/src/routes/auth.ts:223 against
 * a hash the seed generated at 10 rounds. Nothing is stubbed. */
async function signInForReal(page: Page): Promise<void> {
  await page.goto(`${SYSTEM_ORIGIN}/`, { waitUntil: 'load' })
  await expect(page.locator('#login-username')).toBeVisible({ timeout: 60_000 })
  await page.locator('#login-username').fill(E2E_USER.username)
  await page.locator('#login-password').fill(E2E_USER.password)
  await page.getByRole('button', { name: /^Login$/ }).click()
  await expect(page.locator(APP_ROOT), 'the real login must reach the signed-in shell').toBeVisible({ timeout: 60_000 })
}

/** The shape GET /api/sales actually returns on this Worker -- read off the
 * running one, not guessed. Note `sale_status`, not `status`: the first draft
 * of this spec asserted `status` and got `undefined`, which is exactly the
 * class of mistake a fixture written by the same hand as the caller cannot
 * catch, and the reason this tier exists. */
type SaleRow = {
  id: number
  total_usd: number
  sale_status: string
  receipt_number: string
  branch_name: string
  cashier_name: string
  items: Array<{ product_name: string; quantity: number; applied_price_usd: number }>
}

/** Read through the page's own cookie jar, so this is the signed-in cashier
 * asking, not a privileged side channel. */
/** Stock at the SHOP branch, as GET /api/products/bootstrap reports it --
 * branch_stock[], not the product's rolled-up stock_quantity, because this
 * business keeps two ledgers and the rolled-up number can agree while the
 * branch ledger has forked. */
async function branchQuantity(page: Page, productName: string): Promise<number> {
  return page.evaluate(async ([origin, name]) => {
    const res = await fetch(`${origin}/api/products/bootstrap`, { credentials: 'include' })
    if (!res.ok) return -1
    const body = await res.json() as { items?: Array<{ name: string; branch_stock?: Array<{ branch_name: string; quantity: number }> }> }
    const product = (body.items || []).find((item) => item.name === name)
    const shop = (product?.branch_stock || []).find((row) => row.branch_name === 'shop')
    return shop ? Number(shop.quantity) : -1
  }, [SYSTEM_ORIGIN, productName] as const)
}

async function fetchSales(page: Page): Promise<SaleRow[]> {
  return page.evaluate(async (origin) => {
    // GET /api/sales answers a BARE ARRAY on this Worker (verified against the
    // running one, not assumed); the object shapes are tolerated so a later
    // envelope change fails on the assertion, not on a silent [].
    const res = await fetch(`${origin}/api/sales?limit=200`, { credentials: 'include' })
    if (!res.ok) return []
    const body = await res.json() as SaleRow[] | { items?: SaleRow[]; sales?: SaleRow[] }
    if (Array.isArray(body)) return body
    return body.items || body.sales || []
  }, SYSTEM_ORIGIN)
}
