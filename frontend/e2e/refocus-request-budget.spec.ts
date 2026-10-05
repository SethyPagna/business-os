import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { ADMIN_ORIGIN } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * refocus-request-budget.spec.ts -- what an idle and a returning admin tab
 * costs in requests (G39 items 4 and 7).
 *
 * Measured, not modelled: every /api/* and /health request the page makes is
 * recorded per phase.
 *  - idle: a visible Dashboard left alone for two minutes.
 *  - refocus: the tab is hidden for 60 s and shown again, once with the sync
 *    socket open the whole time and once with the socket dropped while hidden.
 *  - page activation: opening Products, which used to read action history.
 *
 * Opt-in (E2E_REQUEST_BUDGET=1, ~5 min) and desktop Chromium only, because
 * the phases are wall-clock (the hidden period has to cross web-api.ts's 45 s
 * FOREGROUND_REFRESH_AFTER_MS for real).
 * E4_MEASURE_ONLY=1 records without asserting (used to measure the old build);
 * E4_EVIDENCE_FILE writes the per-phase log as JSON.
 *
 * RUN:  cd frontend && E2E_REQUEST_BUDGET=1 npx playwright test refocus-request-budget --project=desktop-chromium
 */

type Hit = { phase: string; path: string; at: number }

const MEASURE_ONLY = process.env.E4_MEASURE_ONLY === '1'

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((next) => {
    ;(window as unknown as { __e2eVisibility: string }).__e2eVisibility = next
    document.dispatchEvent(new Event('visibilitychange'))
    if (next === 'visible') window.dispatchEvent(new Event('focus'))
  }, state)
}

function count(hits: Hit[], phase: string, match?: RegExp): number {
  return hits.filter((hit) => hit.phase === phase && (!match || match.test(hit.path))).length
}

test.describe('request budget of an idle and a returning admin tab', () => {
  test('idle Dashboard, refocus after 60 s (socket open / dropped), Products activation', async ({ page }) => {
    test.skip(process.env.E2E_REQUEST_BUDGET !== '1', 'opt-in: about five minutes of wall clock (E2E_REQUEST_BUDGET=1)')
    test.skip(test.info().project.name !== 'desktop-chromium', 'wall-clock measurement, desktop Chromium only')
    test.setTimeout(600_000)
    const hits: Hit[] = []
    let phase = 'boot'
    const sockets: WebSocketRoute[] = []
    await page.routeWebSocket(/\/ws/, (ws) => {
      sockets.push(ws)
      ws.connectToServer()
    })
    await page.addInitScript(() => {
      const read = () => (window as unknown as { __e2eVisibility?: string }).__e2eVisibility || 'visible'
      Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: read })
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => read() === 'hidden' })
    })
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/') || url.pathname === '/health') hits.push({ phase, path: `${url.pathname}${url.search}`, at: Date.now() })
    })

    // A shared, busy machine can take well over the default 15 s to first paint.
    await page.goto(ADMIN_ORIGIN + '/', { waitUntil: 'load' })
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 120_000 })
    // cashier_a carries the fixture admin's role. The 'admin' account's fixture
    // username is e2e_admin, which signIn's identity check does not match.
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/')
    // Mount the deferred import tracker now instead of at +180 s; any
    // import-job:activity wakes it (App.tsx isImportTrackerWakeEvent).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('import-job:activity', { detail: { action: 'e2e-probe' } })))
    // Past the bell's +30 s deferred mount and every first-paint read.
    await page.waitForTimeout(45_000)

    phase = 'idle-120s'
    await page.waitForTimeout(120_000)

    phase = 'hidden-60s'
    await setVisibility(page, 'hidden')
    await page.waitForTimeout(60_000)
    phase = 'refocus-socket-open'
    await setVisibility(page, 'visible')
    await page.waitForTimeout(15_000)

    phase = 'hidden-60s-drop'
    await setVisibility(page, 'hidden')
    await page.waitForTimeout(5_000)
    expect(sockets.length, 'the app opened its sync socket').toBeGreaterThan(0)
    await sockets[sockets.length - 1].close({ code: 1006 }).catch(() => {})
    await page.waitForTimeout(55_000)
    phase = 'refocus-after-drop'
    await setVisibility(page, 'visible')
    await page.waitForTimeout(15_000)

    phase = 'products-activation'
    await gotoAdminPage(page, '/products')
    await page.waitForTimeout(10_000)
    phase = 'done'

    const phases = ['boot', 'idle-120s', 'hidden-60s', 'refocus-socket-open', 'hidden-60s-drop', 'refocus-after-drop', 'products-activation']
    const summary = Object.fromEntries(phases.map((name) => [name, {
      total: count(hits, name),
      importJobs: count(hits, name, /^\/api\/import-jobs/),
      actionHistory: count(hits, name, /^\/api\/action-history/),
      bootstrap: count(hits, name, /^\/api\/auth\/bootstrap/),
      settings: count(hits, name, /^\/api\/settings/),
      health: count(hits, name, /^\/health/),
      paths: hits.filter((hit) => hit.phase === name).map((hit) => hit.path),
    }]))
    const evidence = { build: process.env.E4_BUILD_LABEL || 'unlabelled', measuredAt: new Date().toISOString(), summary }
    if (process.env.E4_EVIDENCE_FILE) writeFileSync(process.env.E4_EVIDENCE_FILE, JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(Object.fromEntries(Object.entries(summary).map(([name, row]) => [name, { ...row, paths: undefined }]))))
    if (MEASURE_ONLY) return

    expect(summary['idle-120s'].importJobs, 'an idle tab does not poll import jobs').toBe(0)
    expect(summary['idle-120s'].actionHistory, 'nor action history').toBe(0)
    expect(summary['hidden-60s'].total, 'a hidden tab makes no request').toBe(0)
    const open = summary['refocus-socket-open']
    expect(open.bootstrap, 'refocus with the socket open re-reads no bootstrap').toBe(0)
    expect(open.settings, 'nor settings').toBe(0)
    expect(open.health, 'one forced health ping').toBe(1)
    expect(open.total, 'health + the active page only').toBeLessThanOrEqual(4)
    const dropped = summary['refocus-after-drop']
    expect(dropped.bootstrap, 'a socket gap verifies the session with one bootstrap read').toBe(1)
    expect(summary['products-activation'].actionHistory, 'opening a page reads no action history').toBe(0)
  })
})
