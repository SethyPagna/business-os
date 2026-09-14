import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { PROJECT_CONTEXT_USE } from '../playwright.config'
import { ADMIN_ORIGIN, STOREFRONT_ORIGIN, storefrontCards } from './support/harness'
import { E2E_ACCOUNTS, APP_ROOT, USERNAME_FIELD, PASSWORD_FIELD } from './support/session'

/**
 * perf-budget.spec.ts -- how long the first useful screen takes, and how many
 * requests it costs.
 *
 * WHAT THIS PROVES
 *  - A customer opening the storefront reaches the store, and a cashier reaches
 *    a usable till, within a budget measured ON THIS MACHINE rather than copied
 *    from a blog post.
 *  - The REQUEST COUNT before first product paint does not grow. This is the
 *    load-bearing assertion of the file: wall-clock on a laptop running three
 *    browsers at once is noisy, but "the POS now makes 90 requests instead of
 *    75 before it can sell anything" is a fact, and it is exactly how a boot
 *    gets slow one innocuous fetch at a time.
 *
 * ERROR CLASS GUARDED: "slowness" from the owner's standing list, and its usual
 * cause -- a new dependency added to the boot path by someone who only ever
 * measured it on a fast machine with a warm cache.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test perf-budget
 *
 * ---------------------------------------------------------------------------
 * HOW THE NUMBERS ARE TAKEN, AND WHY IT IS BEST-OF-THREE
 *
 * Measured sequentially (one project at a time, three runs, worst of three) the
 * screens below cost:
 *
 *                       desktop-chromium  android-chromium  ios-webkit
 *   storefront landing        353 ms            370 ms        1101 ms
 *   storefront grid (tap)     432 ms            308 ms        1070 ms
 *   requests to landing        33                33             34
 *   API calls to landing        2                 2              2
 *   login -> shell            304 ms            308 ms         991 ms
 *   POS first tile           1011 ms            963 ms        1829 ms
 *   requests to POS tile       72                74             75
 *
 * The suite, however, runs three browser projects CONCURRENTLY on one machine
 * against one single-threaded fixture server, and the same screens under that
 * load measured up to 6.5x those numbers -- and varied 2.7x between two runs on
 * the same machine. Three separate attempts at a budget proved it:
 *
 *   - "+50% of the sequential measurement" failed on contention immediately.
 *   - "worst observed under load +50%" still went red on the next run
 *     (ios-webkit login: 2024 ms, then 2670 ms, then 4276 ms against a 3400 ms
 *     ceiling) and desktop and android each failed a different row on a
 *     different run.
 *   - Raising it far enough to never flake produced a ceiling several times the
 *     real cost, i.e. a gate that no longer detects anything. That is how perf
 *     tests get deleted six weeks later.
 *
 * So each timed screen is measured N times (E2E_PERF_ATTEMPTS, default 3) IN A
 * FRESH BROWSER CONTEXT each time -- a cold cache, cold storage, no session --
 * and the BEST attempt is the sample. The reasoning is asymmetric on purpose:
 * contention can only make an attempt slower, never faster, so the minimum is
 * the closest estimate of the app's own cost that this machine can produce;
 * while a real regression -- a blocking fetch added to the boot path -- slows
 * down every attempt including the best one. A test that took the worst sample
 * would be measuring the laptop; this one measures the app.
 *
 * It works. Two full parallel runs of this file with three attempts each
 * measured, for example, desktop's storefront landing at [1522, 658, 838] and
 * then [843, 2917, 1029] -- a 4.4x spread within one run, and a best that moved
 * by 28%. The same two runs' login-to-shell: [6240, 429, 1031] and
 * [1606, 674, 723]. The worst sample is unusable as a gate; the best is stable
 * to within a few hundred milliseconds.
 *
 * Counts are reduced the other way (worst attempt), because a count is
 * deterministic and the only way it varies is a request that had not been
 * issued yet when the screen painted -- and undercounting is exactly what a
 * request budget must not do.
 *
 * Re-measure with: npx playwright test perf-budget --workers=3
 * (every number prints as a [perf] line whether the test passes or fails).
 */

type Budget = {
  landingMs: number
  gridMs: number
  landingRequests: number
  landingApi: number
  loginMs: number
  posMs: number
  posRequests: number
}

/**
 * Time budgets: the worst BEST-OF-THREE observed under full parallel load,
 * +50%. Request budgets: the worst count observed, +50% (they do not move with
 * load at all, so they are the tight half of this file).
 */
const BUDGETS: Record<string, Budget> = {
  'desktop-chromium': { landingMs: 1_500, gridMs: 1_500, landingRequests: 50, landingApi: 3, loginMs: 1_600, posMs: 4_500, posRequests: 116 },
  'android-chromium': { landingMs: 1_500, gridMs: 1_500, landingRequests: 50, landingApi: 3, loginMs: 1_600, posMs: 4_500, posRequests: 116 },
  // ios-webkit's grid budget is the one outlier: the Products tap re-lays out
  // the whole card grid, and WebKit under contention took 4101 ms even as its
  // best of three on one run (1751 ms on the next). Sequentially the same tap
  // costs ~1070 ms. The ceiling is the worst best-of-three, +50%.
  'ios-webkit': { landingMs: 2_600, gridMs: 6_200, landingRequests: 51, landingApi: 3, loginMs: 3_000, posMs: 6_500, posRequests: 124 },
}

/** Three cold attempts per screen; override for a quick local loop. */
const ATTEMPTS = Math.max(1, Number(process.env.E2E_PERF_ATTEMPTS || 3))

function budgetFor(testInfo: TestInfo): Budget {
  const budget = BUDGETS[testInfo.project.name]
  if (!budget) throw new Error(`perf-budget has no measured baseline for project "${testInfo.project.name}" -- measure it, do not guess`)
  return budget
}

/**
 * One attempt, in a brand-new context built from the SAME device descriptor the
 * project uses (imported from playwright.config.ts rather than re-typed, so a
 * viewport change cannot silently make this file measure a different device).
 */
async function coldAttempt<T>(browser: Browser, testInfo: TestInfo, fn: (page: Page) => Promise<T>): Promise<T> {
  const options = PROJECT_CONTEXT_USE[testInfo.project.name as keyof typeof PROJECT_CONTEXT_USE]
  if (!options) throw new Error(`perf-budget has no context options for project "${testInfo.project.name}"`)
  const context = await browser.newContext({ ...options })
  try {
    return await fn(await context.newPage())
  } finally {
    await context.close()
  }
}

type Sample = Record<string, number>

async function sampleColdBoot<T extends Sample>(
  browser: Browser,
  testInfo: TestInfo,
  fn: (page: Page) => Promise<T>,
): Promise<{ best: (key: keyof T) => number; worst: (key: keyof T) => number; all: T[] }> {
  const samples: T[] = []
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    samples.push(await coldAttempt(browser, testInfo, fn))
  }
  return {
    best: (key) => Math.min(...samples.map((sample) => Number(sample[key]))),
    worst: (key) => Math.max(...samples.map((sample) => Number(sample[key]))),
    all: samples,
  }
}

/** Put the measurement in the report, pass or fail. A budget nobody can see the margin of is a budget nobody maintains. */
function record(testInfo: TestInfo, label: string, value: number, budget: number, unit: string, spread?: number[]): void {
  const detail = spread && spread.length > 1 ? ` [attempts ${spread.join(', ')}]` : ''
  const line = `${label}: ${value}${unit} (budget ${budget}${unit}, ${Math.round((value / budget) * 100)}% of it)${detail}`
  testInfo.annotations.push({ type: 'measured', description: line })
  // eslint-disable-next-line no-console
  console.log(`    [perf] ${testInfo.project.name} ${line}`)
}

function countRequests(page: Page): { all: string[] } {
  const all: string[] = []
  page.on('request', (request) => { all.push(request.url()) })
  return { all }
}

async function signInQuickly(page: Page): Promise<number> {
  await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
  await expect(page.locator(USERNAME_FIELD)).toBeVisible({ timeout: 30_000 })
  await page.fill(USERNAME_FIELD, E2E_ACCOUNTS.cashierA.username)
  await page.fill(PASSWORD_FIELD, 'e2e-password')
  const started = Date.now()
  // Explicit, generous action timeout: the default 15 s is a fine ceiling for a
  // functional spec, but here three browsers are hammering one fixture server on
  // purpose, and a contended click that times out reports itself as a broken
  // test rather than as the slow sample it actually is.
  await page.getByRole('button', { name: /^Login$/ }).click({ timeout: 60_000 })
  await expect(page.locator(APP_ROOT)).toBeVisible({ timeout: 30_000 })
  return Date.now() - started
}

test.describe('first-screen budgets', () => {
  test('the storefront lands, and its grid fills, within budget', async ({ browser }, testInfo) => {
    // CATCHES: a boot that grows a blocking dependency. Discriminating on the
    // REQUEST COUNT, which is deterministic -- an implementation that adds one
    // more await before first paint fails this even on a fast machine, where a
    // wall-clock assertion would still pass.
    test.setTimeout(180_000)
    const budget = budgetFor(testInfo)

    const runs = await sampleColdBoot(browser, testInfo, async (page) => {
      const traffic = countRequests(page)
      const started = Date.now()
      await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'commit' })
      const productsTab = page.getByRole('button', { name: 'Products', exact: true })
      await expect(productsTab).toBeVisible({ timeout: 30_000 })
      const landingMs = Date.now() - started
      const landingRequests = traffic.all.length
      const landingApi = traffic.all.filter((url) => url.includes('/api/')).length

      const gridStarted = Date.now()
      await productsTab.click({ timeout: 60_000 })
      await expect(page.locator(storefrontCards).first()).toBeVisible({ timeout: 30_000 })
      const gridMs = Date.now() - gridStarted

      return { landingMs, gridMs, landingRequests, landingApi }
    })

    const landingMs = runs.best('landingMs')
    const gridMs = runs.best('gridMs')
    const landingRequests = runs.worst('landingRequests')
    const landingApi = runs.worst('landingApi')

    record(testInfo, 'storefront landing', landingMs, budget.landingMs, 'ms', runs.all.map((s) => s.landingMs))
    record(testInfo, 'storefront grid', gridMs, budget.gridMs, 'ms', runs.all.map((s) => s.gridMs))
    record(testInfo, 'requests before landing', landingRequests, budget.landingRequests, '', runs.all.map((s) => s.landingRequests))
    record(testInfo, 'API calls before landing', landingApi, budget.landingApi, '', runs.all.map((s) => s.landingApi))

    expect(landingRequests, 'requests before the storefront paints').toBeLessThanOrEqual(budget.landingRequests)
    expect(landingApi, 'API calls before the storefront paints').toBeLessThanOrEqual(budget.landingApi)
    expect(landingMs, 'storefront landing (best of the cold attempts)').toBeLessThanOrEqual(budget.landingMs)
    expect(gridMs, 'storefront grid after the Products tap (best of the cold attempts)').toBeLessThanOrEqual(budget.gridMs)
  })

  test('the till is usable within budget', async ({ browser }, testInfo) => {
    // CATCHES: the slow morning. A cashier opening the till waits for login
    // AND for the first product tile; both are measured, and the request count
    // to reach a sellable screen is capped.
    test.setTimeout(240_000)
    const budget = budgetFor(testInfo)

    const runs = await sampleColdBoot(browser, testInfo, async (page) => {
      const traffic = countRequests(page)
      const loginMs = await signInQuickly(page)

      const before = traffic.all.length
      const started = Date.now()
      await page.goto(`${ADMIN_ORIGIN}/pos`, { waitUntil: 'commit' })
      await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })
      return { loginMs, posMs: Date.now() - started, posRequests: traffic.all.length - before }
    })

    const loginMs = runs.best('loginMs')
    const posMs = runs.best('posMs')
    const posRequests = runs.worst('posRequests')

    record(testInfo, 'login -> shell', loginMs, budget.loginMs, 'ms', runs.all.map((s) => s.loginMs))
    record(testInfo, 'POS first tile', posMs, budget.posMs, 'ms', runs.all.map((s) => s.posMs))
    record(testInfo, 'requests before the first tile', posRequests, budget.posRequests, '', runs.all.map((s) => s.posRequests))

    expect(posRequests, 'requests before the POS can sell anything').toBeLessThanOrEqual(budget.posRequests)
    expect(loginMs, 'login to shell (best of the cold attempts)').toBeLessThanOrEqual(budget.loginMs)
    expect(posMs, 'POS first product tile (best of the cold attempts)').toBeLessThanOrEqual(budget.posMs)
  })

  test('nothing is fetched twice before the first product tile', async ({ page }, testInfo) => {
    // CATCHES the cheapest kind of slowness there is: the same endpoint called
    // several times on one boot because two components each own a copy of the
    // same state. Discriminating because it reports the DUPLICATED URLS, not a
    // count -- and because it allows the one duplicate the app legitimately
    // makes (see below) instead of being switched off entirely.
    const traffic = countRequests(page)
    await signInQuickly(page)
    // Count ONE page load, not the whole test. Measured while writing this:
    // counting from the start reported "/api/auth/bootstrap x4" purely because
    // the test loads two pages (the login screen, then /pos) and each load
    // legitimately costs two -- index.html's early prefetch plus the app's own
    // call. A duplicate-request check that counts across navigations measures
    // the test, not the product.
    const firstOfThisLoad = traffic.all.length
    await page.goto(`${ADMIN_ORIGIN}/pos`, { waitUntil: 'commit' })
    await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })

    const counts = new Map<string, number>()
    for (const url of traffic.all.slice(firstOfThisLoad)) {
      if (!url.includes('/api/')) continue
      // Query strings differ legitimately (paging, filters); the endpoint is
      // what must not repeat.
      const key = new URL(url).pathname
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    const repeated = [...counts.entries()]
      .filter(([, count]) => count > 2)
      .map(([path, count]) => `${path} x${count}`)
      .sort()

    const breakdown = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p} x${c}`).join(', ')
    testInfo.annotations.push({ type: 'measured', description: `api endpoints on the boot path: ${breakdown}` })
    // eslint-disable-next-line no-console
    console.log(`    [perf] ${testInfo.project.name} POS boot endpoints: ${breakdown}`)

    // The threshold is >2, not >1, on purpose: the boot legitimately calls
    // /api/auth/bootstrap twice (index.html's early prefetch plus the app's
    // own call once the module graph is up) and /api/products/bootstrap twice
    // (once for the shell, once when the POS mounts with its branch filter).
    // Anything hit three or more times is a duplicate nobody intended.
    expect(repeated, 'endpoints fetched three or more times before the till is usable').toEqual([])
  })
})
