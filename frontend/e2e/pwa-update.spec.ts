import { expect, test, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth, expectNoRuntimeErrors } from './support/harness'

/**
 * pwa-update.spec.ts -- the "Restart now" bar, end to end, against the REAL
 * service worker.
 *
 * WHAT THIS PROVES
 *  - A deployed change is DETECTED by a tab that was already open, and the
 *    "Restart now" bar appears.
 *  - Taking the update actually replaces the old cached index -- the new build
 *    hash is what the page serves afterwards, not the one it booted with.
 *  - A sale queued offline in IndexedDB SURVIVES that update. An update path
 *    that silently drops the outbox loses real money.
 *
 * ERROR CLASS GUARDED: the stale bundle. A till tab stays open for weeks; if
 * nothing re-checks sw.js the shop runs last month's code through every deploy
 * and nobody finds out until the numbers disagree.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test pwa-update
 *
 * Nothing here is simulated. The fixture server serves frontend/dist/sw.js
 * verbatim, and POST /__e2e/sw/bump rewrites the build-hash constant that file
 * baked in -- byte-for-byte what a deploy does. The browser's own update check,
 * the worker's own install handler, the page's own postMessage listener and
 * App.tsx's own banner all run unmodified.
 *
 * Why that matters: every cheaper version of this test (dispatching
 * `sync:app-update-available` by hand, or stubbing navigator.serviceWorker)
 * passes on a build where sw.js is never re-fetched at all -- which is the
 * exact failure this feature exists to prevent. A till tab stays open for
 * weeks; if nothing re-checks sw.js, the shop runs a stale bundle across every
 * deploy and no bar ever appears.
 *
 * Surface: the ADMIN login screen. App.tsx mounts AppUpdateBanner in all three
 * of its branches (loading shell, signed-out, signed-in) precisely so a till
 * parked on the login screen still gets told -- see the comment on the
 * `sync:app-update-available` effect. Testing it signed out is therefore not a
 * shortcut around auth; it is the branch most likely to be forgotten.
 */

const UPDATE_BAR = '[role="alert"]:has-text("Restart now")'
const USERNAME_FIELD = '#login-username'

/**
 * Tap "Restart now".
 *
 * The generous timeout is not padding: this click deliberately RELOADS the
 * document, and Playwright's post-click settle waits for that reload. Under
 * full parallel load (measured at --workers=4) the reload took longer than the
 * default 15 s action timeout and the call log ended with "click action done"
 * followed by a timeout -- i.e. the product did the right thing and the test
 * gave up on it. The reload is still PROVEN, by the __e2eGeneration marker at
 * every call site: a value set on window cannot survive a real document
 * reload, so nothing here is taken on trust.
 */
async function takeTheUpdate(page: Page): Promise<void> {
  await page.locator(UPDATE_BAR).getByRole('button', { name: 'Restart now' }).click({ timeout: 60_000 })
}

/**
 * Wait until a worker is ACTIVE -- the incumbent the next install compares
 * against (service-worker.ts only announces an update when one exists).
 *
 * expect.poll + page.evaluate, NOT page.waitForFunction. Measured while
 * building this file: waitForFunction with an ASYNC predicate returns on the
 * first poll, because the pending Promise the predicate returns is itself
 * truthy. Every such wait in this suite is a silent no-op, and the tests that
 * depended on one failed later with a confusing "no active worker" instead of
 * waiting. Anything that has to await inside the page is polled this way.
 */
async function waitForActiveServiceWorker(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported'
      const registration = await navigator.serviceWorker.getRegistration('/')
      return registration?.active?.state ?? 'none'
    }),
    { message: 'a service worker must be active before an update can be announced', timeout: 30_000 },
  ).toBe('activated')
}

/**
 * Serve a genuinely different build to THIS context from now on.
 *
 * Scoped to the browser context by cookie rather than flipped on the server,
 * because all three projects run this file at the same time. That was not a
 * precaution, it was a measured failure: with a global switch, one project's
 * deploy reached another project's "a first install never nags" test and
 * failed it against correct product code.
 */
async function deployNewBuild(page: Page, generation = 1): Promise<number> {
  await page.context().addCookies([{
    name: 'e2e_sw_generation',
    value: String(generation),
    url: ADMIN_ORIGIN,
  }])
  return generation
}

/** Wait until the worker has actually precached the navigation shell. */
async function waitForPrecachedShell(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (!name.startsWith('business-os-app-shell-')) continue
        const cache = await caches.open(name)
        if (await cache.match('/index.html')) return true
      }
      return false
    }),
    { message: 'the app shell must be precached', timeout: 30_000 },
  ).toBe(true)
}

/**
 * Which build generation is sitting in the app-shell cache the page's CURRENT
 * controller owns.
 *
 * Read from the controlling worker's own cache rather than from "any cache
 * that exists", because the activate handler deliberately retains the previous
 * generation (service-worker.ts: an older tab may still be mid-checkout). A
 * naive "does a generation-1 cache exist" check would go green the instant the
 * new worker installed, before it controlled anything.
 */
async function readCachedShellGeneration(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/')
    const scriptUrl = registration?.active?.scriptURL
    if (!scriptUrl) return -1
    const workerSource = await (await fetch(scriptUrl, { cache: 'no-store' })).text()
    const hash = /const BUILD_HASH = '([^']*)'/.exec(workerSource)?.[1]
    if (!hash) return -2
    const cache = await caches.open(`business-os-app-shell-${hash}`)
    const shell = await cache.match('/index.html')
    if (!shell) return -3
    const html = await shell.text()
    const stamped = /name="e2e-build-generation" content="(\d+)"/.exec(html)
    return stamped ? Number(stamped[1]) : 0
  })
}

/**
 * Let the app notice on its own.
 *
 * index.tsx's watchForNewAppShell() re-checks sw.js on a 15-minute interval
 * (plus visibilitychange and online). Playwright's clock jumps past that
 * interval and fires it ONCE, so what triggers the update here is the
 * application's own poll -- delete watchForNewAppShell and this stops working,
 * which is the point. Calling registration.update() from the test instead
 * would keep passing on exactly that regression.
 */
async function letTheAppPoll(page: Page): Promise<void> {
  await page.clock.fastForward('16:00')
}

test.describe('pwa update bar', () => {
  test('a first install never nags', async ({ page }) => {
    // CATCHES: dropping the build-hash equality guard in App.tsx's
    // acceptAppUpdate. A device's FIRST activation broadcasts
    // BUSINESS_OS_APP_UPDATE_AVAILABLE for the build the page is already
    // running (service-worker.ts activate handler, unconditional). Without the
    // guard every brand-new visitor is told a new version is ready, and the
    // one bar the shop must trust becomes noise.
    //
    // Discriminating because the broadcast really does happen here: the
    // assertion is not "no service worker", it is "the announcement arrived and
    // was correctly ignored".
    const health = collectPageHealth(page)
    await page.clock.install()
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await waitForActiveServiceWorker(page)

    // The activate broadcast is fire-and-forget; give it room to land.
    await page.waitForTimeout(1_000)
    await expect(page.locator(UPDATE_BAR)).toHaveCount(0)

    expectNoRuntimeErrors(health)
  })

  test('a newer build raises the full-width Restart bar', async ({ page }) => {
    // CATCHES: (a) sw.js never being re-fetched by a long-lived tab, (b) the
    // worker's install handler losing its broadcast, (c) web-api.ts dropping
    // the postMessage -> window CustomEvent forwarding, (d) App.tsx not
    // rendering the banner on the signed-out branch. Any one of those breaks
    // the chain and the bar never appears.
    const health = collectPageHealth(page)
    await page.clock.install()
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await waitForActiveServiceWorker(page)

    await deployNewBuild(page)
    await letTheAppPoll(page)

    const bar = page.locator(UPDATE_BAR)
    await expect(bar).toBeVisible({ timeout: 30_000 })
    await expect(bar).toContainText('A new version is ready.')
    await expect(bar.getByRole('button', { name: 'Restart now' })).toBeVisible()
    // The owner's word for this bar is "full-width". Asserted geometrically,
    // because a centred card with the same text would satisfy every text
    // assertion above while looking nothing like the agreed design.
    const box = await bar.boundingBox()
    const viewport = page.viewportSize()
    expect(box, 'the update bar must be laid out').not.toBeNull()
    expect(Math.round(box!.width), 'update bar width').toBe(viewport!.width)
    expect(Math.round(box!.y), 'update bar must sit at the very top').toBe(0)

    // It must stay dismissible -- a bar that cannot be closed blocks the top of
    // a POS screen until the cashier gives in.
    await expect(bar.getByRole('button', { name: 'Dismiss notification' })).toBeVisible()

    expectNoRuntimeErrors(health)
  })

  test('Restart now activates the waiting worker and reloads', async ({ page }) => {
    // CATCHES: a Restart button that only calls location.reload(). That LOOKS
    // right -- the bar goes away -- while the waiting worker is still waiting,
    // so the tab comes back on the OLD shell and the bar returns on the next
    // poll. The discriminating assertion is on the CACHE NAMES after the
    // reload: the new build's cache (named from the bumped hash) only exists
    // once the new worker actually installed, and it can only be CONTROLLING
    // the page if skip-waiting really happened.
    const health = collectPageHealth(page)
    await page.clock.install()
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await waitForActiveServiceWorker(page)

    const generation = await deployNewBuild(page)
    await letTheAppPoll(page)
    await expect(page.locator(UPDATE_BAR)).toBeVisible({ timeout: 30_000 })

    // A value that cannot survive a document reload, so "did it reload?" is
    // answered by the browser rather than by a timeout.
    await page.evaluate(() => { (window as unknown as { __e2eGeneration?: number }).__e2eGeneration = 1 })

    await takeTheUpdate(page)

    await page.waitForFunction(
      () => (window as unknown as { __e2eGeneration?: number }).__e2eGeneration === undefined,
      undefined,
      { timeout: 30_000 },
    )
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()

    // The reloaded page is controlled by the NEW worker.
    const controllingScript = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const worker = registration?.active
      if (!worker) return 'no active worker'
      const response = await fetch(worker.scriptURL, { cache: 'no-store' })
      return (await response.text()).slice(0, 200)
    })
    expect(controllingScript, 'the controlling worker must be the bumped build')
      .toContain(`e2e build generation ${generation}`)

    const cacheKeys = await page.evaluate(() => caches.keys())
    expect(
      cacheKeys.filter((key) => key.includes(`-e2e${generation}`)),
      `app-shell cache for the bumped build (saw ${cacheKeys.join(', ')})`,
    ).not.toEqual([])

    // ...and the bar is gone, because the announced hash now IS the running one.
    await expect(page.locator(UPDATE_BAR)).toHaveCount(0)

    expectNoRuntimeErrors(health)
  })

  test('the update replaces the cached document, so no stale shell is served offline', async ({ page, context, browserName }) => {
    // CATCHES: a new worker that installs and flips the bar but leaves the OLD
    // index.html in the cache it actually serves from. The shop would restart,
    // see the bar disappear, and keep booting yesterday's document forever --
    // the worst version of this bug, because every visible signal says the
    // update worked.
    //
    // Discriminating input: the fixture server stamps index.html with the build
    // generation, so the two documents are distinguishable bytes. Without that
    // stamp this assertion would be comparing a file to itself and would pass
    // on an implementation that never re-cached anything.
    const health = collectPageHealth(page)
    await page.clock.install()
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await waitForActiveServiceWorker(page)
    await waitForPrecachedShell(page)

    // Generation 0 is what is cached right now. Prove it, so the later
    // assertion is a CHANGE rather than a coincidence.
    expect(await readCachedShellGeneration(page), 'cached shell before the update').toBe(0)

    const generation = await deployNewBuild(page)
    await letTheAppPoll(page)
    await expect(page.locator(UPDATE_BAR)).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => { (window as unknown as { __e2eGeneration?: number }).__e2eGeneration = 1 })
    await takeTheUpdate(page)
    await page.waitForFunction(
      () => (window as unknown as { __e2eGeneration?: number }).__e2eGeneration === undefined,
      undefined,
      { timeout: 30_000 },
    )
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()

    await expect.poll(
      () => readCachedShellGeneration(page),
      { message: 'cached shell after the update', timeout: 30_000 },
    ).toBe(generation)

    // Everything up to here happened online, so the page must be clean.
    expectNoRuntimeErrors(health)

    if (browserName === 'chromium') {
      // The end-to-end version of the same claim: with the network gone, the
      // document the till gets is the NEW one. (WebKit is excluded for the
      // measured reason recorded in storefront-boot.spec.ts -- page.reload()
      // under Playwright's offline emulation fails inside WebKit itself.)
      const offlineHealth = collectPageHealth(page)
      await context.setOffline(true)
      try {
        await page.reload({ waitUntil: 'load' })
        await expect(page.locator('meta[name="e2e-build-generation"]'))
          .toHaveAttribute('content', String(generation))
      } finally {
        await context.setOffline(false)
      }

      // An offline boot is ALLOWED to have failing requests -- that is what
      // offline means -- but it must not produce any other kind of error, and
      // it must never call console.error. The filter is deliberately narrow
      // (the network rejection text of each engine) rather than "ignore errors
      // while offline", so a genuine offline crash still fails here.
      //
      // Note for the record: those rejections are UNHANDLED, and they come
      // from the same unguarded early prefetch as
      // KNOWN_SIGNED_OUT_BOOTSTRAP_REJECTION -- offline it rejects with
      // "Failed to fetch" before the named parse step is ever reached. One
      // `.catch()` at the creation site in frontend/vite.config.ts removes
      // both this noise and the fixme in admin-boot.spec.ts.
      const unexpected = offlineHealth.pageErrors
        .filter((entry) => !/Failed to fetch|Load failed|NetworkError|network connection was lost/i.test(entry))
      expect(unexpected, 'offline boot must raise nothing but network failures').toEqual([])
      expect(offlineHealth.consoleErrors, 'console.error while offline').toEqual([])
    }
  })

  test('a queued offline sale survives the update', async ({ page }) => {
    // CATCHES: the deploy-time data loss the owner is actually afraid of. The
    // worker's activate handler sweeps old caches by prefix
    // (`key.startsWith('business-os-')`), and the tempting "also clear the old
    // data" addition next to it -- indexedDB.deleteDatabase('BusinessOS'), or
    // widening that sweep -- would silently destroy sales a cashier rang while
    // the shop's internet was down but had not yet synced.
    //
    // PROVEN TO DISCRIMINATE, not assumed: the fixture server was temporarily
    // taught to splice `indexedDB.deleteDatabase("BusinessOS")` into the new
    // worker's activate handler, and this test failed on
    // "the offline database must survive an app update" (expected false,
    // received true). The splice was then removed.
    //
    // The row goes into the database THE APP BUILT, never one of the test's
    // own making. That distinction is not cosmetic -- it was measured. A
    // hand-rolled `indexedDB.open('BusinessOS', 1)` with a lookalike
    // sync_outbox store reported the sale as lost, and the culprit was Dexie
    // upgrading that fake version 1 to the app's real version 50 and dropping
    // the mismatched store. The test would have reported a data-loss defect
    // that the product does not have. So: wait for the app to open its own
    // schema (frontend/src/api/localDb.ts:120 declares sync_outbox), then
    // write into it.
    const health = collectPageHealth(page)
    await page.clock.install()
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await waitForActiveServiceWorker(page)
    await waitForPrecachedShell(page)

    // The app opens its local database on its own startup timers rather than
    // during first paint; one minute of app time is enough.
    await page.clock.fastForward('01:00')
    await expect.poll(
      () => page.evaluate(async () => {
        const entry = (await indexedDB.databases()).find((database) => database.name === 'BusinessOS')
        return entry?.version ?? 0
      }),
      { message: "the app's own local database must exist before we queue into it", timeout: 30_000 },
    ).toBeGreaterThan(1)

    const queuedReceipt = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        // No version argument: open whatever the app created, and never
        // trigger an upgrade of our own.
        const request = indexedDB.open('BusinessOS')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (!db.objectStoreNames.contains('sync_outbox')) {
        db.close()
        throw new Error(`sync_outbox missing; stores are ${Array.from(db.objectStoreNames).join(', ')}`)
      }
      const receipt = '20260914-101500'
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sync_outbox', 'readwrite')
        tx.objectStore('sync_outbox').add({
          channel: 'sales:create',
          status: 'pending',
          entity_table: 'sales',
          created_at: new Date().toISOString(),
          payload: { receipt_number: receipt, total: 12.5 },
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
      return receipt
    })

    const generation = await deployNewBuild(page)
    await letTheAppPoll(page)
    await expect(page.locator(UPDATE_BAR)).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => { (window as unknown as { __e2eGeneration?: number }).__e2eGeneration = 1 })
    await takeTheUpdate(page)
    await page.waitForFunction(
      () => (window as unknown as { __e2eGeneration?: number }).__e2eGeneration === undefined,
      undefined,
      { timeout: 30_000 },
    )
    await expect(page.locator(USERNAME_FIELD)).toBeVisible()
    await expect.poll(
      () => readCachedShellGeneration(page),
      { message: 'the update must really have landed before we claim the sale survived it', timeout: 30_000 },
    ).toBe(generation)

    const survivors = await page.evaluate(async () => {
      const names = (await indexedDB.databases()).map((entry) => entry.name)
      if (!names.includes('BusinessOS')) return { databaseGone: true, receipts: [] as string[] }
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('BusinessOS')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (!db.objectStoreNames.contains('sync_outbox')) {
        db.close()
        return { databaseGone: false, storeGone: true, receipts: [] as string[] }
      }
      const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const tx = db.transaction('sync_outbox', 'readonly')
        const request = tx.objectStore('sync_outbox').getAll()
        request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>)
        request.onerror = () => reject(request.error)
      })
      db.close()
      return {
        databaseGone: false,
        storeGone: false,
        receipts: rows.map((row) => String((row.payload as { receipt_number?: string })?.receipt_number || '')),
      }
    })

    expect(survivors.databaseGone, 'the offline database must survive an app update').toBe(false)
    expect(survivors.storeGone, 'the outbox store must survive an app update').toBe(false)
    expect(survivors.receipts, 'the queued sale must still be there after restarting').toContain(queuedReceipt)

    expectNoRuntimeErrors(health)
  })
})
